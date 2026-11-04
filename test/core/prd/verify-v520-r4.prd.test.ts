import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPrdCursor, prdCursorItems } from "../../../src/core/prd/cursor.js";
import { parsePrd } from "../../../src/core/prd/parse.js";
import { buildPrd } from "./prd-fixture.js";

// Round 4 of the 5.2.0 PRD tool verification.

const PRD_PATH = "docs/prd/2026-11-04.reset.prd.md";
let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "speckiwi-verify-v520-r4-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 5 });
});

async function ledgerWith(runId: string, lines: string[]): Promise<void> {
  const dir = path.join(root, "kiwi", "prd");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `${runId}.jsonl`), lines.map((line) => `${line}\n`).join(""), "utf8");
}

describe("verify 5.2.0 round 4 — PRD tools", () => {
  // @req FR-NODE-241 AC-3
  it("refuses a verdict line that names no item as a corrupt ledger", async () => {
    const doc = parsePrd(buildPrd(), PRD_PATH);
    await ledgerWith("noitem", [
      JSON.stringify({ event: "verdict", prd: doc.pointer, direction: "prd-to-srs", round: 1, index: 1, verdict: "accepted", refs: [], note: "", ts: "2026-11-04T00:00:00Z" })
    ]);
    const cursor = createPrdCursor({ root, runId: "noitem", direction: "prd-to-srs", prd: doc.pointer, items: prdCursorItems(doc) });
    const opened = await cursor.current();
    expect(opened.ok).toBe(false);
    if (!opened.ok) expect(opened.error.code).toBe("PRD_LEDGER_CORRUPT");
  });

  // @req FR-NODE-241 AC-3
  it("refuses a line whose direction is not a cursor direction as a corrupt ledger", async () => {
    const doc = parsePrd(buildPrd(), PRD_PATH);
    await ledgerWith("baddir", [
      JSON.stringify({ event: "verdict", prd: doc.pointer, direction: "sideways", round: 1, index: 1, item: "PRD-1", verdict: "accepted", refs: [], note: "", ts: "2026-11-04T00:00:00Z" })
    ]);
    const cursor = createPrdCursor({ root, runId: "baddir", direction: "prd-to-srs", prd: doc.pointer, items: prdCursorItems(doc) });
    const opened = await cursor.current();
    expect(opened.ok).toBe(false);
    if (!opened.ok) expect(opened.error.code).toBe("PRD_LEDGER_CORRUPT");
  });
});
