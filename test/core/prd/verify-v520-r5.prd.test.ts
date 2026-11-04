import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPrdCursor, prdCursorItems } from "../../../src/core/prd/cursor.js";
import { parsePrd } from "../../../src/core/prd/parse.js";
import { buildPrd } from "./prd-fixture.js";

// Round 5 of the 5.2.0 PRD tool verification.

const PRD_PATH = "docs/prd/2026-11-04.reset.prd.md";
let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "speckiwi-verify-v520-r5-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 5 });
});

describe("verify 5.2.0 round 5 — PRD tools", () => {
  // @req FR-NODE-241 AC-4
  it("reports invalidated when the PRD hash differs from the reset line that opened the current round", async () => {
    const original = parsePrd(buildPrd(), PRD_PATH);
    const changed = parsePrd(buildPrd({ approval: "바꿨습니다." }), PRD_PATH);
    const before = createPrdCursor({ root, runId: "rr", direction: "prd-to-srs", prd: original.pointer, items: prdCursorItems(original) });
    expect((await before.next({ verdict: "accepted" })).ok).toBe(true);
    expect((await before.reset()).ok).toBe(true);
    const after = createPrdCursor({ root, runId: "rr", direction: "prd-to-srs", prd: changed.pointer, items: prdCursorItems(changed) });
    const position = await after.current();
    expect(position.ok).toBe(true);
    if (position.ok) expect(position.value.invalidated).toMatchObject({ previous: original.pointer.split("@sha256:")[1], current: changed.pointer.split("@sha256:")[1] });
  });
});
