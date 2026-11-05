import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { parseWorkspace } from "../../src/core/parser/workspace-parser.js";
import { resolveProjectRoot } from "../../src/core/project-root.js";
import { validateWorkspace } from "../../src/core/validator/validate-workspace.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

// IR-CLI-116 — `set-active-target --create` was the only way to add a Target Map row, and it always
// activates the row it adds. These cases drive `main()`, which returns the exit code a shell sees.

const INDEX = ["docs", "spec", "00.index.md"] as const;

function pipes() {
  return { stdout: new PassThrough(), stderr: new PassThrough() };
}

async function indexOf(rootPath: string): Promise<string> {
  return readFile(path.join(rootPath, ...INDEX), "utf8");
}

async function run(rootPath: string, args: string[]): Promise<{ code: number; stdout: string }> {
  const io = pipes();
  const code = await main(["--root", rootPath, "register-target", ...args], io);
  return { code, stdout: io.stdout.read()?.toString() ?? "" };
}

async function errorCount(rootPath: string): Promise<number> {
  const workspace = await parseWorkspace(await resolveProjectRoot(rootPath));
  return [...workspace.diagnostics, ...validateWorkspace(workspace).diagnostics].filter((entry) => entry.severity === "error").length;
}

describe("IR-CLI-116 AC-1 — a planned row is appended and nothing else moves", () => {
  // @req IR-CLI-116 AC-1
  it("appends one planned row with the given name, type and description, leaving the Active Target and the other rows alone", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const before = (await indexOf(rootPath)).split(/\r?\n/);

    const { code } = await run(rootPath, ["v2.0.0", "--type", "milestone", "--description", "Future milestone", "--json"]);

    expect(code, "a registration must exit zero").toBe(0);
    const after = (await indexOf(rootPath)).split(/\r?\n/);
    const lastRow = before.indexOf("| v1.1.0 | version | planned | Next fixture target |");
    expect(lastRow, "the fixture's last Target Map row").toBeGreaterThan(-1);
    // Exactly one line was added, right after the last Target Map row; every other line is unchanged,
    // which covers the Active Target line and both existing rows.
    expect(after).toEqual([...before.slice(0, lastRow + 1), "| v2.0.0 | milestone | planned | Future milestone |", ...before.slice(lastRow + 1)]);
    expect(after).toContain("| Active Target | v1.0.0 |");
    expect(after).toContain("| v1.0.0 | release | active | Fixture release |");
  });

  // @req IR-CLI-116 AC-1
  it("runs under the SRS mutation lock and writes nothing while another mutation holds it", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    await mkdir(path.join(rootPath, "kiwi"), { recursive: true });
    const now = Date.now();
    await writeFile(
      path.join(rootPath, "kiwi", ".srs.lock"),
      JSON.stringify({ schemaVersion: "1.0.0", owner: "other:1", operation: "other", requestId: "r", acquiredAt: new Date(now).toISOString(), expiresAt: new Date(now + 60_000).toISOString() }),
      "utf8"
    );
    const before = await indexOf(rootPath);

    const { code, stdout } = await run(rootPath, ["v2.0.0", "--type", "version", "--description", "Locked", "--json"]);

    expect(code).not.toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({ ok: false, error: { code: "SRS_LOCKED" } });
    await expect(indexOf(rootPath)).resolves.toBe(before);
  });
});

describe("IR-CLI-116 AC-2 — a bad registration is refused and writes nothing", () => {
  const refusals: Array<{ name: string; args: string[] }> = [
    { name: "an already registered name", args: ["v1.1.0", "--type", "version", "--description", "Again"] },
    { name: "the Active Target's name", args: ["v1.0.0", "--type", "release", "--description", "Again"] },
    { name: "a type outside the target types", args: ["v2.0.0", "--type", "sprint", "--description", "Bad type"] },
    { name: "a description holding a pipe", args: ["v2.0.0", "--type", "version", "--description", "a | b"] },
    { name: "a description holding a line feed", args: ["v2.0.0", "--type", "version", "--description", "a\nb"] },
    { name: "a description holding a carriage return", args: ["v2.0.0", "--type", "version", "--description", "a\rb"] }
  ];

  // @req IR-CLI-116 AC-2
  it.each(refusals)("refuses $name with a non-zero exit", async ({ args }) => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const before = await indexOf(rootPath);

    const { code, stdout } = await run(rootPath, [...args, "--json"]);

    expect(code).not.toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({ ok: false });
    await expect(indexOf(rootPath)).resolves.toBe(before);
  });
});

describe("IR-CLI-116 AC-3 — preview, JSON and a valid result", () => {
  // @req IR-CLI-116 AC-3
  it("previews under --dry-run without writing", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const before = await indexOf(rootPath);

    const { code, stdout } = await run(rootPath, ["v2.0.0", "--type", "version", "--description", "Preview", "--dry-run", "--json"]);

    expect(code).toBe(0);
    const parsed = JSON.parse(stdout) as { ok: boolean; value: Record<string, unknown>; mutation: { dryRun: boolean; written: boolean; operations: unknown[] } };
    expect(parsed).toMatchObject({ ok: true, value: { target: "v2.0.0", status: "planned", written: false }, mutation: { dryRun: true, written: false } });
    expect(parsed.mutation.operations).toHaveLength(1);
    await expect(indexOf(rootPath)).resolves.toBe(before);
  });

  // @req IR-CLI-116 AC-3
  it("prints its result as JSON under --json", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");

    const { stdout } = await run(rootPath, ["v2.0.0", "--type", "experiment", "--description", "Json", "--json"]);

    expect(JSON.parse(stdout)).toMatchObject({ ok: true, value: { target: "v2.0.0", type: "experiment", status: "planned", written: true } });
  });

  // @req IR-CLI-116 AC-3
  it("leaves validate with no new errors after it writes", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const before = await errorCount(rootPath);

    const { code } = await run(rootPath, ["v2.0.0", "--type", "phase", "--description", "Validated", "--json"]);

    expect(code).toBe(0);
    expect(await errorCount(rootPath)).toBe(before);
    const workspace = await parseWorkspace(await resolveProjectRoot(rootPath));
    expect(workspace.index.targets.find((entry) => entry.target === "v2.0.0")).toMatchObject({ type: "phase", status: "planned" });
    expect(workspace.index.activeTarget).toBe("v1.0.0");
  });
});
