import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPrdCursor, prdCursorItems } from "../../../src/core/prd/cursor.js";
import { parsePrd } from "../../../src/core/prd/parse.js";
import { buildPrd } from "./prd-fixture.js";

// Round 6 of the 5.2.0 PRD tool verification.

const PRD_PATH = "docs/prd/2026-11-04.reset.prd.md";
let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "speckiwi-verify-v520-r6-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 5 });
});

describe("verify 5.2.0 round 6 — PRD tools", () => {
  // @req FR-NODE-241 AC-3, AC-4
  it.each([
    { name: "no hash at all", prd: "docs/prd/2026-11-04.reset.prd.md" },
    { name: "an empty hash", prd: "docs/prd/2026-11-04.reset.prd.md@sha256:" }
  ])("refuses a ledger line whose PRD pointer carries $name instead of reporting it as the previous hash", async ({ prd }) => {
    const doc = parsePrd(buildPrd(), PRD_PATH);
    const line = { event: "verdict", prd, direction: "prd-to-srs", round: 1, index: 1, item: "PRD-1", verdict: "accepted", refs: [], note: "", ts: "2026-11-04T00:00:00.000Z" };
    await mkdir(path.join(root, "kiwi", "prd"), { recursive: true });
    await writeFile(path.join(root, "kiwi", "prd", "r6.jsonl"), `${JSON.stringify(line)}\n`, "utf8");
    const position = await createPrdCursor({ root, runId: "r6", direction: "prd-to-srs", prd: doc.pointer, items: prdCursorItems(doc) }).current();
    expect(position.ok ? position.value.invalidated : position.error.code).toBe("PRD_LEDGER_CORRUPT");
  });
});
