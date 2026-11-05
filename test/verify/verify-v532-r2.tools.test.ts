import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";

// verify-v532-r2 (independent verification, round 2). No red test was found in this round; the
// cases below are the green checks that were kept, run against a copy of the repository's own SRS.
// The repository SRS keeps changing, so each case first writes the part it asserts on into the copy
// (a fixed input), instead of asserting counts the live SRS happened to have on the day.

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const made: string[] = [];

async function copyRealSpec(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "verify-v532-r2-"));
  made.push(dir);
  await cp(path.join(REPO_ROOT, "docs"), path.join(dir, "docs"), { recursive: true });
  return dir;
}

async function cli(rootPath: string, args: string[]): Promise<{ exitCode: number; json: Record<string, unknown> }> {
  const streams = { stdout: new PassThrough(), stderr: new PassThrough() };
  const exitCode = await main(["--root", rootPath, ...args, "--json"], streams);
  const chunks: Buffer[] = [];
  let chunk: Buffer | null;
  while ((chunk = streams.stdout.read() as Buffer | null) !== null) chunks.push(chunk);
  return { exitCode, json: JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as Record<string, unknown> };
}

const PARSER_SRS = "docs/spec/20.parser-validation.srs.md";

/** Returns the copy's lines of `relativePath` and the [start, end) range of the `### <id> — ` block. */
async function blockOf(root: string, relativePath: string, id: string): Promise<{ lines: string[]; start: number; end: number }> {
  const lines = (await readFile(path.join(root, relativePath), "utf8")).split("\n");
  const start = lines.findIndex((line) => line.startsWith(`### ${id} — `));
  expect(start, id).toBeGreaterThanOrEqual(0);
  let end = start + 1;
  while (end < lines.length && !/^#{2,3} /.test(lines[end]!)) end += 1;
  return { lines, start, end };
}

/** Replaces the body of the `#### <section>` subsection of requirement `id` with `body`. */
async function writeSection(root: string, relativePath: string, id: string, section: string, body: string[]): Promise<void> {
  const { lines, start, end } = await blockOf(root, relativePath, id);
  const heading = lines.findIndex((line, index) => index > start && index < end && line.trimEnd() === `#### ${section}`);
  expect(heading, section).toBeGreaterThan(start);
  let next = heading + 1;
  while (next < end && !lines[next]!.startsWith("#### ")) next += 1;
  lines.splice(heading + 1, next - heading - 1, "", ...body, "");
  await writeFile(path.join(root, relativePath), lines.join("\n"), "utf8");
}

/** Appends `rows` to the Trace Links table of requirement `id`, by hand: the writers refuse rows to a discarded requirement. */
async function appendTraceRows(root: string, relativePath: string, id: string, rows: string[]): Promise<void> {
  const { lines, start, end } = await blockOf(root, relativePath, id);
  const header = lines.findIndex((line, index) => index > start && index < end && line.startsWith("| Type | Reference | Relation | Notes |"));
  expect(header, id).toBeGreaterThan(start);
  let after = header + 2;
  while (lines[after]?.startsWith("|")) after += 1;
  lines.splice(after, 0, ...rows);
  await writeFile(path.join(root, relativePath), lines.join("\n"), "utf8");
}

/** The first requirement in `relativePath` whose Status field is discarded, read from the Markdown text. */
async function firstDiscardedId(root: string, relativePath: string): Promise<string> {
  const lines = (await readFile(path.join(root, relativePath), "utf8")).split("\n");
  let id: string | undefined;
  for (const line of lines) {
    const heading = /^### (?:~~)?([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-\d+) — /.exec(line);
    if (heading) id = heading[1];
    else if (/^#{2,3} /.test(line)) id = undefined;
    else if (id && /^\| Status \| discarded \|/.test(line)) return id;
  }
  throw new Error(`no discarded requirement in ${relativePath}`);
}

afterEach(async () => {
  for (const dir of made.splice(0)) await rm(dir, { recursive: true, force: true });
});

describe("verify-v532-r2 — FR-PARSE-049 on the repository's own SRS", () => {
  // @req FR-PARSE-049 AC-2
  // Input: docs/spec (the repository SRS); FR-PARSE-049 (a live requirement) is given an extends and a
  // depends_on row to the first discarded requirement of docs/spec/20.parser-validation.srs.md.
  it("links check and validate report the same discarded-target rows", async () => {
    const root = await copyRealSpec();
    const target = await firstDiscardedId(root, PARSER_SRS);
    await appendTraceRows(root, PARSER_SRS, "FR-PARSE-049", [
      `| Requirement | ${target} | extends | verify-v532-r2 fixed input |`,
      `| Requirement | ${target} | depends_on | verify-v532-r2 fixed input |`
    ]);
    const links = await cli(root, ["links", "check"]);
    const validate = await cli(root, ["validate"]);
    const broken = (links.json.broken as Array<{ requirementId: string; reference: string; code: string }>).filter((entry) => entry.code === "SRS-W081");
    const warnings = (validate.json.warnings as Array<{ code: string; requirementId?: string; details?: { discardedId?: string } }>).filter((entry) => entry.code === "SRS-W081");
    const fromLinks = broken.map((entry) => `${entry.requirementId}>${entry.reference}`).sort();
    const fromValidate = warnings.map((entry) => `${entry.requirementId}>${entry.details?.discardedId}`).sort();
    expect(fromLinks.filter((entry) => entry === `FR-PARSE-049>${target}`)).toHaveLength(2);
    expect(fromValidate).toEqual(fromLinks);
    expect(validate.exitCode).toBe(0);
  });
});

describe("verify-v532-r2 — FR-NODE-270 on the repository's own SRS", () => {
  // @req FR-NODE-270 AC-3 AC-4
  // Input: docs/spec/20.parser-validation.srs.md, FR-PARSE-049 Implementation Notes, rewritten in the copy to
  // two bullet notes (one plain, one dated, the two forms that section uses).
  it("a replace dry run reports both notes, and the unconfirmed write is refused naming the flag and the count", async () => {
    const root = await copyRealSpec();
    await writeSection(root, PARSER_SRS, "FR-PARSE-049", "Implementation Notes", [
      "- verify-v532-r2 fixed note one.",
      "- [2026-11-05] verify-v532-r2 fixed note two."
    ]);
    const args = ["append-note", "FR-PARSE-049", "--section", "implementation_notes", "--mode", "replace", "--text", "one line"];
    const dry = await cli(root, [...args, "--dry-run"]);
    const value = dry.json.value as { removedItems: number; removedLines: string[]; written: boolean };
    expect(value.written).toBe(false);
    expect(value.removedItems).toBe(2);
    expect(value.removedLines.every((line) => line.startsWith("- "))).toBe(true);
    const refused = await cli(root, args);
    const error = refused.json.error as { code: string; message: string };
    expect(error.code).toBe("USAGE");
    expect(error.message).toContain("--confirm-replace");
    expect(error.message).toContain("2 items");
  });
});
