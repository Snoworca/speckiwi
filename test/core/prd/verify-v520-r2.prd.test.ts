import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendPrdLedger, readPrdLedger } from "../../../src/core/prd/ledger.js";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "speckiwi-verify-v520-r2-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 5 });
});

async function ledgerFile(name: string, text: string): Promise<string> {
  const file = path.join(root, "kiwi", "prd", name);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text, "utf8");
  return file;
}

const RESET = '{"event":"reset","prd":"p@sha256:a","direction":"prd-to-srs","round":2,"ts":"t"}';
// Parses as JSON but is not a ledger entry (index is a string). An interrupted append of the writer's
// own `JSON.stringify` output cannot produce it: the only prefix of an object that parses is the whole object.
const NOT_AN_ENTRY = '{"event":"verdict","prd":"p@sha256:a","direction":"prd-to-srs","round":1,"index":"1","item":"PRD-1","verdict":"accepted"}';

describe("verify 5.2.0 round 2 — PRD ledger torn tail", () => {
  // @req FR-NODE-241 AC-3
  it("refuses a last line that parses but is not an entry, with or without its line break", async () => {
    const withBreak = await readPrdLedger(await ledgerFile("a.jsonl", `${RESET}\n${NOT_AN_ENTRY}\n`));
    const withoutBreak = await readPrdLedger(await ledgerFile("b.jsonl", `${RESET}\n${NOT_AN_ENTRY}`));
    expect(withBreak.ok).toBe(false);
    expect(withoutBreak.ok).toBe(false);
  });

  // @req FR-NODE-241 AC-3
  it("does not delete a complete last line that parses when the next line is appended", async () => {
    const file = await ledgerFile("c.jsonl", NOT_AN_ENTRY);
    await appendPrdLedger(file, { event: "reset", prd: "p@sha256:a", direction: "prd-to-srs", round: 2, ts: "t" });
    expect(await readFile(file, "utf8")).toContain(NOT_AN_ENTRY);
  });
});
