import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";

// FR-NODE-127 AC-5 — when `orchestrate validate` refuses, its violations are the error diagnostics
// `journal append` reports for the same lines except `unstamped-writer` and
// `journal-version-downgrade`, which fail validate only under `--strict` (IR-CLI-083).

interface Diagnostic {
  code: string;
  severity: string;
}

const JOURNAL = "kiwi/waves.jsonl";
const WRITER = "speckiwi-orchestrate/test";
const STAMP_CODES = ["journal-version-downgrade", "unstamped-writer"];

async function run(argv: string[]): Promise<{ exit: number; payload: Record<string, unknown> }> {
  const pipes = { stdout: new PassThrough(), stderr: new PassThrough() };
  const exit = await main([...argv, "--json"], pipes);
  const text = pipes.stdout.read()?.toString() ?? "";
  return { exit, payload: text.length > 0 ? (JSON.parse(text) as Record<string, unknown>) : {} };
}

async function rootWith(lines: readonly Record<string, unknown>[]): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "speckiwi-fr-node-127-ac5-stamp-"));
  await mkdir(path.join(root, "kiwi"), { recursive: true });
  await writeFile(path.join(root, JOURNAL), lines.map((line) => `${JSON.stringify(line)}\n`).join(""), "utf8");
  return root;
}

function errorCodes(entries: unknown): string[] {
  return ((entries ?? []) as Diagnostic[]).filter((entry) => entry.severity === "error").map((entry) => entry.code).sort();
}

const base = { run_id: "run-a", engine: "kiwi-orchestrator", verb: "author-design", event: "intent", wave: "wave-1" };
/** A 1.4.0 line with no writer stamp. */
const UNSTAMPED = { ...base, schema_version: "1.4.0" };
/** A stamped 1.4.0 line followed, in the same run, by a 1.3.0 line: a version downgrade. */
const STAMPED = { ...base, schema_version: "1.4.0", writer: WRITER };
const DOWNGRADED = { ...base, schema_version: "1.3.0" };
/** A 1.3.0 `complete` with no passing verify before it: after UNSTAMPED and STAMPED it adds a downgrade
 * and an error that is not a stamp error. */
const DOWNGRADED_COMPLETE = { ...base, schema_version: "1.3.0", verb: "emit-and-finish", event: "result", status: "complete" };

describe("FR-NODE-127 AC-5 — the two stamp errors fail validate only under --strict", { timeout: 60_000 }, () => {
  it("FR-NODE-127 AC-5: without --strict, a journal whose only errors are unstamped-writer and journal-version-downgrade passes, and reports them", async () => {
    const root = await rootWith([UNSTAMPED, STAMPED, DOWNGRADED]);

    const plain = await run(["--root", root, "orchestrate", "validate", "--run-id", "run-a"]);
    expect(plain.exit, JSON.stringify(plain.payload)).toBe(0);
    expect(errorCodes(plain.payload.diagnostics), "both stamp errors are still reported").toEqual(STAMP_CODES);

    const strict = await run(["--root", root, "orchestrate", "validate", "--run-id", "run-a", "--strict"]);
    expect(strict.exit, JSON.stringify(strict.payload)).toBe(2);
    expect(errorCodes(strict.payload.violations)).toEqual(STAMP_CODES);
  });

  it("FR-NODE-127 AC-5: without --strict, validate refuses with append's error diagnostics minus the stamp errors; under --strict with all of them", async () => {
    const appendRoot = await rootWith([UNSTAMPED, STAMPED]);
    const appended = await run(["--root", appendRoot, "orchestrate", "journal", "append", "--run-id", "run-a", "--payload", JSON.stringify(DOWNGRADED_COMPLETE)]);
    expect(appended.exit, JSON.stringify(appended.payload)).toBe(2);
    const appendErrors = errorCodes(appended.payload.violations);
    expect(appendErrors, "append reports both stamp errors for these lines").toEqual(expect.arrayContaining(STAMP_CODES));
    const otherErrors = appendErrors.filter((code) => !STAMP_CODES.includes(code));
    expect(otherErrors.length, "the probe carries an error that is not a stamp error").toBeGreaterThan(0);

    // The same lines, already in the file.
    const root = await rootWith([UNSTAMPED, STAMPED, DOWNGRADED_COMPLETE]);
    const plain = await run(["--root", root, "orchestrate", "validate", "--run-id", "run-a"]);
    expect(plain.exit, JSON.stringify(plain.payload)).toBe(2);
    expect(errorCodes(plain.payload.violations)).toEqual(otherErrors);

    const strict = await run(["--root", root, "orchestrate", "validate", "--run-id", "run-a", "--strict"]);
    expect(strict.exit, JSON.stringify(strict.payload)).toBe(2);
    expect(errorCodes(strict.payload.violations)).toEqual(appendErrors);
  });
});
