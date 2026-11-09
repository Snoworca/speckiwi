import { readFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough, Readable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { buildProgram, main } from "../../src/cli/index.js";
import { expandInputJsonArgv } from "../../src/cli/input-json.js";
import { findSpecByCliName } from "../../src/mcp/schemas.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";
import { snapshotTree } from "../support/discarded-target-fixture.js";

// @req FR-NODE-281 — an --input-json value the channel cannot write as given is refused, not
// written as [object Object] or dropped.

const SPEC_FILE = "docs/spec/10.product-architecture.srs.md";

interface Envelope {
  ok?: boolean;
  error?: { code: string; message: string };
  value?: { written?: boolean; record?: { title?: string; rationale?: string; metadata?: Record<string, string> } };
}

const originalStdin = process.stdin;

afterEach(() => {
  Object.defineProperty(process, "stdin", { value: originalStdin, configurable: true });
});

/** Runs `speckiwi --root <root> <args> --input-json - --json` with `payload` on stdin. */
async function runWithPayload(rootPath: string, args: string[], payload: Record<string, unknown>): Promise<{ code: number; envelope: Envelope }> {
  const fake = Readable.from([JSON.stringify(payload)]) as unknown as NodeJS.ReadStream;
  (fake as unknown as { isTTY: boolean }).isTTY = false;
  Object.defineProperty(process, "stdin", { value: fake, configurable: true });
  const streams = { stdout: new PassThrough(), stderr: new PassThrough() };
  const code = await main(["--root", rootPath, ...args, "--input-json", "-", "--json"], streams);
  return { code, envelope: JSON.parse(streams.stdout.read()?.toString() ?? "{}") as Envelope };
}

const BASE_REQUIREMENT = {
  type: "functional",
  scope: "ARCH",
  target: "v1.0.0",
  title: "Trace object repro",
  statement: "The system SHALL keep trace rows.",
  acceptanceCriteria: ["THE SYSTEM SHALL keep trace rows."]
};

async function expectRefusedAndUnchanged(args: string[], payload: Record<string, unknown>, named: readonly string[]): Promise<void> {
  const rootPath = await copyFixtureWorkspace("mutation-target");
  const before = await snapshotTree(rootPath);
  const { code, envelope } = await runWithPayload(rootPath, args, payload);
  expect(code).not.toBe(0);
  expect(envelope.ok).toBe(false);
  expect(envelope.error?.code).toMatch(/USAGE/);
  for (const text of named) expect(envelope.error?.message).toContain(text);
  expect(await snapshotTree(rootPath)).toEqual(before);
}

describe("FR-NODE-281 — --input-json refuses a value it cannot write as given", () => {
  // @req FR-NODE-281 AC-1
  it("refuses an object trace row, naming trace and the string row form", async () => {
    await expectRefusedAndUnchanged(
      ["add-requirement"],
      { ...BASE_REQUIREMENT, trace: [{ type: "Code", reference: "src/app.ts", relation: "implements", notes: "n" }] },
      ["trace", "type|reference|relation|notes"]
    );
  });

  // @req FR-NODE-281 AC-2
  it("refuses an object evidence row, naming evidence", async () => {
    await expectRefusedAndUnchanged(
      ["add-requirement"],
      { ...BASE_REQUIREMENT, evidence: [{ type: "test", reference: "test/app.test.ts", covers: "AC-1", notes: "n" }] },
      ["evidence"]
    );
  });

  // @req FR-NODE-281 AC-3
  it.each([
    { key: "acceptanceCriteria", value: [{ text: "a" }] },
    { key: "relatedDocs", value: [{ path: "x.md" }] },
    { key: "acceptanceCriteria", value: [["a"]] },
    { key: "acceptanceCriteria", value: [null] },
    { key: "title", value: { text: "a" } },
    { key: "rationale", value: null }
  ])("refuses $key = $value, naming the key", async ({ key, value }) => {
    await expectRefusedAndUnchanged(["add-requirement"], { ...BASE_REQUIREMENT, [key]: value }, [key]);
  });

  // @req FR-NODE-281 AC-3 — a positional takes text the same way an option does.
  it("refuses an object positional, naming the key", async () => {
    await expectRefusedAndUnchanged(["update-status"], { id: { value: "FR-ARCH-001" }, status: "implemented" }, ["id"]);
  });

  // @req FR-NODE-281 AC-3
  it("still passes a number or a boolean as its text", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const { code, envelope } = await runWithPayload(rootPath, ["add-requirement"], {
      ...BASE_REQUIREMENT,
      title: 12345,
      githubIssue: 42,
      rationale: true,
      dryRun: true
    });
    expect(code, JSON.stringify(envelope.error)).toBe(0);
    expect(envelope.value?.record?.title).toBe("12345");
    expect(envelope.value?.record?.metadata?.["GitHub Issue"]).toBe("42");
    expect(envelope.value?.record?.rationale).toBe("true");
  });

  // @req FR-NODE-281 AC-4
  it("keeps the string row forms working", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const { code, envelope } = await runWithPayload(rootPath, ["add-requirement"], {
      ...BASE_REQUIREMENT,
      trace: ["Code|src/app.ts|implements|n"],
      evidence: ["test|test/app.test.ts|AC-1|n"]
    });
    expect(code, JSON.stringify(envelope.error)).toBe(0);
    const text = await readFile(path.join(rootPath, SPEC_FILE), "utf8");
    expect(text).toContain("| Code | src/app.ts | implements | n |");
    expect(text).toContain("| VE-1 | test | test/app.test.ts | AC-1 | n |");
  });

  // @req FR-NODE-281 AC-5
  it("refuses a key the command does not declare instead of dropping it", async () => {
    await expectRefusedAndUnchanged(["update-status"], { id: "FR-ARCH-001", status: "implemented", "dry-run": true }, ["dry-run"]);
  });

  // @req FR-NODE-281 AC-5
  it("refuses the MCP-only spelling traceLinks on add-requirement", async () => {
    await expectRefusedAndUnchanged(["add-requirement"], { ...BASE_REQUIREMENT, traceLinks: ["Code|src/app.ts|implements|n"] }, ["traceLinks"]);
  });
});

describe("FR-NODE-281 AC-5 — every key the command takes through a flag is taken through the payload", () => {
  async function expectAccepted(args: string[], payload: Record<string, unknown>): Promise<Envelope> {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const before = await snapshotTree(rootPath);
    const { code, envelope } = await runWithPayload(rootPath, args, payload);
    expect(code, JSON.stringify(envelope.error)).toBe(0);
    expect(envelope.ok).toBe(true);
    expect(await snapshotTree(rootPath)).toEqual(before);
    return envelope;
  }

  // @req FR-NODE-281 AC-5 — `--json` is a global option and an option of every command.
  it("accepts json on add-requirement", async () => {
    await expectAccepted(["add-requirement"], { ...BASE_REQUIREMENT, dryRun: true, json: true });
  });

  // @req FR-NODE-281 AC-5 — options commander declares that the registry row leaves out.
  it("accepts init's dryRun, skills and mcp, and writes nothing", async () => {
    const envelope = (await expectAccepted(["init"], { dryRun: true, skills: false, mcp: false })) as Envelope & { value?: { onboarding?: unknown } };
    // `skills: false` and `mcp: false` are the `--no-skills` and `--no-mcp` flags: no onboarding step runs.
    expect(envelope.value?.onboarding).toBeUndefined();
  });

  // @req FR-NODE-281 AC-5
  it("accepts update-status's confirmDiscardVerified", async () => {
    await expectAccepted(["update-status"], { id: "FR-ARCH-001", status: "implemented", confirmDiscardVerified: true, dryRun: true });
  });

  // @req FR-NODE-281 AC-5
  it("accepts add-completed-work's requirements and report", async () => {
    await expectAccepted(["add-completed-work"], {
      date: "2026-11-09",
      summary: "Probe",
      target: "v1.0.0",
      scope: "ARCH",
      requirements: "FR-ARCH-001",
      report: ["docs/report.md"],
      allowIncomplete: true,
      dryRun: true
    });
  });

  // @req FR-NODE-281 AC-5 — a flag written with a short alias ("-g, --global") is emitted as its long flag.
  it("accepts remove's global, a flag with a short alias", async () => {
    await expectAccepted(["remove"], { global: true, dryRun: true });
  });

  // @req FR-NODE-281 AC-5 — the program's --version prints the version instead of running the command.
  it("refuses version, which would skip the command", async () => {
    await expectRefusedAndUnchanged(["update-status"], { id: "FR-ARCH-001", status: "implemented", version: true }, ["version"]);
  });

  // @req FR-NODE-281 AC-5 — a global option is a payload key too: `root` picks the project.
  it("accepts the global root", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const fake = Readable.from([JSON.stringify({ ...BASE_REQUIREMENT, dryRun: true, root: rootPath })]) as unknown as NodeJS.ReadStream;
    (fake as unknown as { isTTY: boolean }).isTTY = false;
    Object.defineProperty(process, "stdin", { value: fake, configurable: true });
    const streams = { stdout: new PassThrough(), stderr: new PassThrough() };
    const code = await main(["add-requirement", "--input-json", "-", "--json"], streams);
    const envelope = JSON.parse(streams.stdout.read()?.toString() ?? "{}") as Envelope & { value?: { requirementId?: string } };
    expect(code, JSON.stringify(envelope.error)).toBe(0);
    // The id the fixture allocates, not the one this repository's own ARCH scope would.
    const viaFlag = await runWithPayload(rootPath, ["add-requirement"], { ...BASE_REQUIREMENT, dryRun: true });
    const expectedId = (viaFlag.envelope as Envelope & { value?: { requirementId?: string } }).value?.requirementId;
    expect(expectedId).toMatch(/^FR-ARCH-\d+$/);
    expect(envelope.value?.requirementId).toBe(expectedId);
  });
});

describe("FR-NODE-281 AC-5 — a --no-x option is read by its payload key the same way for every command", () => {
  function program() {
    return buildProgram({ stdout: new PassThrough(), stderr: new PassThrough() });
  }

  async function expand(command: string, payload: Record<string, unknown>): Promise<string[]> {
    return expandInputJsonArgv([command, "--input-json", JSON.stringify(payload)], program());
  }

  /** Every `--no-x` flag a channel command takes, from its commander options and its registry row. */
  function negatedFlags(): Array<{ command: string; key: string; flag: string }> {
    const found = new Map<string, { command: string; key: string; flag: string }>();
    for (const command of program().commands) {
      const spec = findSpecByCliName(command.name());
      if (!spec) continue;
      const flags = [
        ...command.options.filter((option) => option.negate).map((option) => ({ key: option.attributeName(), flag: option.long as string })),
        ...spec.options.filter((option) => option.flag.startsWith("--no-")).map((option) => ({ key: option.dest, flag: option.flag.split(/\s+/)[0] as string }))
      ];
      for (const { key, flag } of flags) found.set(`${command.name()} ${flag}`, { command: command.name(), key, flag });
    }
    return [...found.values()];
  }

  // @req FR-NODE-281 AC-5
  it("upgrade writes --no-skills and --no-mcp for false and nothing for true", async () => {
    expect(await expand("upgrade", { skills: false, mcp: false })).toEqual(expect.arrayContaining(["--no-skills", "--no-mcp"]));
    const asDefault = await expand("upgrade", { skills: true, mcp: true });
    expect(asDefault).not.toContain("--no-skills");
    expect(asDefault).not.toContain("--no-mcp");
  });

  // @req FR-NODE-281 AC-5
  it("init writes --no-skills and --no-mcp for false and nothing for true", async () => {
    expect(await expand("init", { skills: false, mcp: false })).toEqual(expect.arrayContaining(["--no-skills", "--no-mcp"]));
    const asDefault = await expand("init", { skills: true, mcp: true });
    expect(asDefault).not.toContain("--no-skills");
    expect(asDefault).not.toContain("--no-mcp");
  });

  // @req FR-NODE-281 AC-5 — no command reads a --no-x key the other way round.
  it("every channel command writes its --no-x flag for false and never for true", async () => {
    const negated = negatedFlags();
    expect(negated.map((entry) => `${entry.command} ${entry.flag}`)).toEqual(expect.arrayContaining(["upgrade --no-skills", "init --no-skills"]));
    for (const { command, key, flag } of negated) {
      const expandedFalse = await expand(command, { [key]: false });
      if (expandedFalse.includes("--input-json")) continue; // not admitted to the channel
      expect(expandedFalse, `${command} ${key}: false`).toContain(flag);
      expect(await expand(command, { [key]: true }), `${command} ${key}: true`).not.toContain(flag);
    }
  });
});
