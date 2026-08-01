import { readFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { setTargetStatus } from "../../../src/core/mutation/set-target-status.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { buildCommand } from "../../../src/cli/command.js";
import { main } from "../../../src/cli/index.js";
import { registerMutationCommands } from "../../../src/cli/commands/mutations.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";
import { documentedTargetStatuses } from "../../support/rules-vocabulary.js";

// FR-NODE-100 / IR-CLI-081 — FR-NODE-099 keeps a departing target honest from now on, but it cannot
// repair a row already carrying a wrong status, and it can never produce `released`, which records a
// release decision the tool has no way to derive.

const SPEC = ["docs", "spec"] as const;

function nullStream(): NodeJS.WriteStream {
  return { write: () => true } as unknown as NodeJS.WriteStream;
}

async function indexOf(rootPath: string): Promise<string> {
  return readFile(path.join(rootPath, ...SPEC, "00.index.md"), "utf8");
}

async function rowFor(rootPath: string, target: string): Promise<string | undefined> {
  return (await indexOf(rootPath)).split(/\r?\n/).find((line) => line.startsWith(`| ${target} |`));
}

describe("FR-NODE-100 AC-1 — only the status cell moves", () => {
  it("records a terminal status without touching the other cells", async () => {
    for (const status of ["completed", "released"]) {
      const rootPath = await copyFixtureWorkspace("mutation-target");
      const result = await setTargetStatus(await resolveProjectRoot(rootPath), { target: "v1.1.0", status });

      expect(result, `setting ${status} must succeed`).toMatchObject({ ok: true, value: { target: "v1.1.0", status, written: true } });
      expect(await rowFor(rootPath, "v1.1.0")).toBe(`| v1.1.0 | version | ${status} | Next fixture target |`);
      // The active row is untouched.
      expect(await rowFor(rootPath, "v1.0.0")).toBe("| v1.0.0 | release | active | Fixture release |");
    }
  });
});

describe("FR-NODE-100 AC-2 — an undocumented status is refused", () => {
  it("fails with USAGE naming the documented vocabulary, and writes nothing", async () => {
    const statuses = await documentedTargetStatuses();
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const before = await indexOf(rootPath);

    const result = await setTargetStatus(await resolveProjectRoot(rootPath), { target: "v1.1.0", status: "shipped" });

    expect(result).toMatchObject({ ok: false, error: { code: "USAGE" } });
    const message = (result as { error: { message: string } }).error.message;
    for (const status of statuses) {
      expect(message, `the refusal must name ${status}`).toContain(status);
    }
    await expect(indexOf(rootPath)).resolves.toBe(before);
  });
});

describe("FR-NODE-100 AC-3 — a second active row is refused", () => {
  it("refuses to make a target active while another already is", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const before = await indexOf(rootPath);

    const result = await setTargetStatus(await resolveProjectRoot(rootPath), { target: "v1.1.0", status: "active" });

    expect(result).toMatchObject({ ok: false, error: { code: "MUTATION_DENIED" } });
    await expect(indexOf(rootPath)).resolves.toBe(before);
  });

  it("allows active when the target is already the active one", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");

    const result = await setTargetStatus(await resolveProjectRoot(rootPath), { target: "v1.0.0", status: "active" });

    expect(result).toMatchObject({ ok: true, value: { written: false } });
  });
});

describe("FR-NODE-100 AC-3 — moving the active target away from active is refused", () => {
  it("refuses to leave the Active Target metadata row naming a non-active row", async () => {
    // The natural first use of this command is "the release is done, mark it released", issued while
    // that target is still active. Target Map rule 5 requires the Active Target row to be `active`,
    // so succeeding here leaves the repository failing its own `validate --fail-on-warning`.
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const before = await indexOf(rootPath);

    const result = await setTargetStatus(await resolveProjectRoot(rootPath), { target: "v1.0.0", status: "released" });

    expect(result).toMatchObject({ ok: false, error: { code: "MUTATION_DENIED" } });
    expect((result as { error: { message: string } }).error.message).toContain("set-active-target");
    await expect(indexOf(rootPath)).resolves.toBe(before);
  });

  it("still allows a status change on a target that is not the active one", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");

    const result = await setTargetStatus(await resolveProjectRoot(rootPath), { target: "v1.1.0", status: "completed" });

    expect(result).toMatchObject({ ok: true, value: { written: true } });
  });
});

describe("FR-NODE-100 AC-4 — an unregistered target is refused", () => {
  it("fails with NOT_FOUND and writes nothing", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const before = await indexOf(rootPath);

    const result = await setTargetStatus(await resolveProjectRoot(rootPath), { target: "v9.9.9", status: "completed" });

    expect(result).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    await expect(indexOf(rootPath)).resolves.toBe(before);
  });
});

describe("FR-NODE-100 AC-5 — dry-run reports without writing", () => {
  it("plans the operation and leaves the file alone", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const before = await indexOf(rootPath);

    const result = await setTargetStatus(await resolveProjectRoot(rootPath), { target: "v1.1.0", status: "completed", dryRun: true });

    expect(result).toMatchObject({ ok: true, value: { written: false }, mutation: { kind: "set_target_status", dryRun: true, written: false } });
    const operations = (result as { mutation: { operations: unknown[] } }).mutation.operations;
    expect(operations.length).toBe(1);
    await expect(indexOf(rootPath)).resolves.toBe(before);
  });
});

describe("IR-CLI-081 — the command surface", () => {
  function program() {
    const io = { stdout: nullStream(), stderr: nullStream() };
    const command = buildCommand({ io });
    registerMutationCommands(command, io ? { io } : { io });
    return command;
  }

  it("registers set-target-status with a target and a status argument", () => {
    const command = program().commands.find((candidate) => candidate.name() === "set-target-status");

    expect(command, "set-target-status must be registered").toBeDefined();
    const help = command!.helpInformation();
    for (const flag of ["--dry-run", "--ignore-lock", "--json"]) {
      expect(help, `the command must offer ${flag}`).toContain(flag);
    }
  });

  it("names the documented status vocabulary in its help", async () => {
    const statuses = await documentedTargetStatuses();
    const command = program().commands.find((candidate) => candidate.name() === "set-target-status");
    const collapsed = command!.helpInformation().replace(/\s+/g, " ");

    const sentence = statuses.slice(0, -1).join(", ") + ", or " + statuses[statuses.length - 1];
    expect(collapsed, "the help must offer the full documented set").toContain(sentence);
  });

  it("names the same vocabulary in the appendix signature", async () => {
    const statuses = await documentedTargetStatuses();
    const appendix = await readFile(path.join("docs", "spec", "90.appendix.md"), "utf8");

    const signature = appendix
      .split(/\r?\n/)
      .find((line) => line.trimStart().startsWith("speckiwi set-target-status"));
    expect(signature, "the appendix must carry the set-target-status signature").toBeDefined();
    expect(signature).toContain(`<${statuses.join("|")}>`);
  });

  // These go through `main()`, which returns the process exit code, rather than reading
  // `command.opts().exitCode`. Reading the option is vacuous: delete the assignment in the action and
  // the option is simply never set, so `undefined` satisfies both `.not.toBe(0)` and `?? 0 === 0`, and
  // the whole suite stays green while the defect is present. A mutation probe demonstrated exactly
  // that. `main()` observes what a shell would.
  function pipes() {
    return { stdout: new PassThrough() as NodeJS.WriteStream, stderr: new PassThrough() as NodeJS.WriteStream };
  }

  it("applies the mutation through the command, prints JSON and exits zero", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const io = pipes();

    const code = await main(["--root", rootPath, "set-target-status", "v1.1.0", "completed", "--json"], io);

    expect(code, "an applied mutation must exit zero").toBe(0);
    expect(JSON.parse(io.stdout.read()?.toString() ?? "")).toMatchObject({
      ok: true,
      value: { target: "v1.1.0", status: "completed", written: true }
    });
    const index = await readFile(path.join(rootPath, ...SPEC, "00.index.md"), "utf8");
    expect(index).toContain("| v1.1.0 | version | completed | Next fixture target |");
  });

  it("exits non-zero when the mutation is refused", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");

    expect(await main(["--root", rootPath, "set-target-status", "v9.9.9", "completed", "--json"], pipes()), "an unregistered target must not exit zero").toBe(5);
    expect(await main(["--root", rootPath, "set-target-status", "v1.1.0", "shipped", "--json"], pipes()), "an undocumented status must not exit zero").toBe(5);
    expect(await main(["--root", rootPath, "set-target-status", "v1.0.0", "released", "--json"], pipes()), "refusing the Active Target row must not exit zero").toBe(5);
  });

  it("is declared CLI-only in the parity spec, like upgrade", async () => {
    const spec = await readFile(path.join("src", "mcp", "schemas.ts"), "utf8");

    expect(spec).toMatch(/mutationSpec\("set-target-status",\s*undefined/);
  });
});
