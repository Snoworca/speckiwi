import { appendFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prdCoverage } from "../../../src/core/prd/coverage.js";
import { createPrdCursor, prdCursorItems } from "../../../src/core/prd/cursor.js";
import { loadPrdFile } from "../../../src/core/prd/files.js";
import { parsePrd } from "../../../src/core/prd/parse.js";
import type { RequirementRecord } from "../../../src/core/types.js";
import { buildPrd } from "./prd-fixture.js";

const PRD_PATH = "docs/prd/2026-11-04.reset.prd.md";
let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "speckiwi-verify-v520-r1-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 5 });
});

async function writePrd(text: string, relative = PRD_PATH): Promise<void> {
  const file = path.join(root, ...relative.split("/"));
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text, "utf8");
}

describe("verify 5.2.0 round 1 — PRD tools", () => {
  // @req FR-NODE-241 AC-3
  it("resumes after a crash that left a torn last ledger line", async () => {
    const doc = parsePrd(buildPrd(), PRD_PATH);
    const make = () => createPrdCursor({ root, runId: "crash", direction: "prd-to-srs", prd: doc.pointer, items: prdCursorItems(doc) });
    expect((await make().next({ verdict: "accepted" })).ok).toBe(true);
    // A process killed mid-append leaves a prefix of the next line and no trailing newline.
    await appendFile(path.join(root, "kiwi", "prd", "crash.jsonl"), '{"event":"verdict","prd":"docs/prd/x', "utf8");
    const resumed = await make().current();
    expect(resumed.ok).toBe(true);
    if (resumed.ok) expect(resumed.value.index).toBe(2);
  });

  // @req FR-NODE-242 AC-2
  it.skipIf(process.platform !== "win32")("gives the same coverage whatever case the PRD path is typed in on a case-insensitive file system", async () => {
    await writePrd(buildPrd());
    const citing = {
      id: "FR-AUTH-001", title: "t", type: "functional", target: "1.0.0", status: "planned", scope: "AUTH",
      filePath: "docs/spec/10.auth.srs.md", headingLine: 1, metadata: {}, requirement: "statement",
      rationale: `${PRD_PATH}#PRD-1; ${PRD_PATH}#PRD-2`, acceptanceCriteria: [],
      verificationEvidence: [], traceLinks: [], changeNotes: [], tags: []
    } as unknown as RequirementRecord;
    const typed = await loadPrdFile(root, "Docs/PRD/2026-11-04.Reset.prd.md");
    const canonical = await loadPrdFile(root, PRD_PATH);
    expect(typed.ok && canonical.ok).toBe(true);
    if (!typed.ok || !canonical.ok) return;
    const viaTyped = prdCoverage(typed.value, [citing], { target: "1.0.0" });
    const viaCanonical = prdCoverage(canonical.value, [citing], { target: "1.0.0" });
    expect(viaCanonical.uncitedItems).toEqual([]);
    expect(viaTyped.uncitedItems).toEqual(viaCanonical.uncitedItems);
  });

});
