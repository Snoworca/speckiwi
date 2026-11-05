import { cp, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";

// verify-v532-r3 (independent verification, round 3). No red test was found in this round; the
// cases below are the green checks that were kept, run against a copy of the repository's own SRS.

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const CODE = "SRS-W081";
const made: string[] = [];

interface TraceRow {
  readonly reference: string;
  readonly relation: string;
  /** 1-based line in the file. */
  readonly line: number;
}

interface Block {
  readonly id: string;
  readonly file: string;
  readonly status: string;
  /** 0-based index of the `| Status |` line in the file. */
  readonly statusIndex: number;
  readonly rows: readonly TraceRow[];
}

async function copyRealSpec(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "verify-v532-r3-"));
  made.push(dir);
  await cp(path.join(REPO_ROOT, "docs"), path.join(dir, "docs"), { recursive: true });
  return dir;
}

/** Reads the requirement blocks of the copy's scope SRS files straight from the Markdown text. */
async function readBlocks(root: string): Promise<Block[]> {
  const specDir = path.join(root, "docs", "spec");
  const blocks: Block[] = [];
  for (const name of (await readdir(specDir)).filter((entry) => entry.endsWith(".srs.md")).sort()) {
    const lines = (await readFile(path.join(specDir, name), "utf8")).split(/\r?\n/);
    let current: { id: string; status: string; statusIndex: number; rows: TraceRow[]; inTrace: boolean } | undefined;
    const close = () => {
      if (current) blocks.push({ id: current.id, file: `docs/spec/${name}`, status: current.status, statusIndex: current.statusIndex, rows: current.rows });
      current = undefined;
    };
    lines.forEach((line, index) => {
      if (/^#{2,3} /.test(line)) {
        close();
        const heading = /^### (?:~~)?([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-\d+) — /.exec(line);
        if (heading) current = { id: heading[1]!, status: "", statusIndex: -1, rows: [], inTrace: false };
        return;
      }
      if (!current) return;
      const status = /^\| Status \| ([a-z_]+) \|/.exec(line);
      if (status && current.statusIndex < 0) {
        current.status = status[1]!;
        current.statusIndex = index;
      }
      if (line.startsWith("#### ")) current.inTrace = line === "#### Trace Links";
      const row = current.inTrace ? /^\| Requirement \| ([^|]+?) \| ([^|]+?) \|/.exec(line) : null;
      if (row) current.rows.push({ reference: row[1]!, relation: row[2]!, line: index + 1 });
    });
    close();
  }
  return blocks;
}

async function cli(rootPath: string, args: string[]): Promise<{ exitCode: number; json: Record<string, unknown> }> {
  const streams = { stdout: new PassThrough(), stderr: new PassThrough() };
  const exitCode = await main(["--root", rootPath, ...args, "--json"], streams);
  const chunks: Buffer[] = [];
  let chunk: Buffer | null;
  while ((chunk = streams.stdout.read() as Buffer | null) !== null) chunks.push(chunk);
  return { exitCode, json: JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as Record<string, unknown> };
}

async function reported(root: string): Promise<{ links: string[]; validate: string[] }> {
  const links = ((await cli(root, ["links", "check"])).json.broken as Array<{ requirementId: string; reference: string; code: string }>)
    .filter((entry) => entry.code === CODE)
    .map((entry) => `${entry.requirementId}>${entry.reference}`)
    .sort();
  const validate = ((await cli(root, ["validate"])).json.warnings as Array<{ code: string; requirementId?: string; line?: number; details?: { discardedId?: string } }>)
    .filter((entry) => entry.code === CODE)
    .map((entry) => `${entry.requirementId}>${entry.details?.discardedId}@${entry.line}`)
    .sort();
  return { links, validate };
}

/** The rows AC-5 is about: Requirement rows to a discarded ID, with a relation the AC does not otherwise exclude. */
function rowsToDiscarded(blocks: readonly Block[]): Array<{ holder: Block; row: TraceRow }> {
  const discarded = new Set(blocks.filter((block) => block.status === "discarded").map((block) => block.id));
  const excluded = new Set(["supersedes", "superseded_by", "checked_compatible"]);
  return blocks.flatMap((holder) =>
    holder.rows.filter((row) => discarded.has(row.reference) && !excluded.has(row.relation)).map((row) => ({ holder, row }))
  );
}

afterEach(async () => {
  for (const dir of made.splice(0)) await rm(dir, { recursive: true, force: true });
});

describe("verify-v532-r3 — FR-PARSE-049 AC-5 on the repository's own SRS", () => {
  // @req FR-PARSE-049 AC-5
  // Input: docs/spec (the repository SRS, whose discarded requirements hold extends/depends_on/related_to rows to other discarded requirements).
  it("rows held by discarded requirements stay in the file and are not reported; the same holder made live is reported at each row", async () => {
    const root = await copyRealSpec();
    const before = rowsToDiscarded(await readBlocks(root));
    const held = before.filter(({ holder }) => holder.status === "discarded");
    expect(held.length).toBeGreaterThan(0);
    expect(before.filter(({ holder }) => holder.status !== "discarded")).toEqual([]);
    expect(await reported(root)).toEqual({ links: [], validate: [] });

    // Make one discarded holder live by its Status field only; its rows become a live requirement's links.
    const holder = held[0]!.holder;
    const file = path.join(root, holder.file);
    const lines = (await readFile(file, "utf8")).split("\n");
    lines[holder.statusIndex] = lines[holder.statusIndex]!.replace("| Status | discarded |", "| Status | implemented |");
    await writeFile(file, lines.join("\n"), "utf8");

    const expected = held.filter((entry) => entry.holder.id === holder.id).map(({ row }) => row);
    expect(expected.length).toBeGreaterThan(0);
    const after = await reported(root);
    expect(after.links).toEqual(expected.map((row) => `${holder.id}>${row.reference}`).sort());
    expect(after.validate).toEqual(expected.map((row) => `${holder.id}>${row.reference}@${row.line}`).sort());
  });
});
