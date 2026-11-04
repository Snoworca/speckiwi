import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadPrdFile, parsePrd, prdCoverage } from "../../../src/core/prd/index.js";
import type { RequirementRecord } from "../../../src/core/types.js";
import { buildPrd } from "./prd-fixture.js";

const PRD_PATH = "docs/prd/2026-11-04.reset.prd.md";
const CASE_INSENSITIVE = process.platform === "win32" || process.platform === "darwin";
let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "speckiwi-prd-files-"));
  await mkdir(path.join(root, "docs", "prd"), { recursive: true });
  await writeFile(path.join(root, ...PRD_PATH.split("/")), buildPrd(), "utf8");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 5 });
});

function citing(rationale: string): RequirementRecord {
  return {
    id: "FR-AUTH-001", title: "t", type: "functional", target: "1.0.0", status: "planned", scope: "AUTH",
    filePath: "docs/spec/10.auth.srs.md", headingLine: 1, metadata: {}, requirement: "statement", rationale,
    acceptanceCriteria: [{ id: "AC-1", text: "a", checked: false }], verificationEvidence: [], traceLinks: [], changeNotes: [], tags: []
  } as unknown as RequirementRecord;
}

describe("FR-NODE-242 PRD path spelling", () => {
  // @req FR-NODE-242 AC-2
  it.runIf(process.platform === "win32")("names a PRD typed in another case by the spelling on disk, in its path and its pointer", async () => {
    const loaded = await loadPrdFile(root, "Docs/PRD/2026-11-04.Reset.prd.md");
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.path).toBe(PRD_PATH);
    expect(loaded.value.pointer.startsWith(`${PRD_PATH}@sha256:`)).toBe(true);
  });

  // @req FR-NODE-240 AC-1, FR-NODE-242 AC-1
  it("refuses to load a file whose suffix is not the lower-case .prd.md, even where the file system would open it", async () => {
    const loaded = await loadPrdFile(root, PRD_PATH.replace(".prd.md", ".PRD.md"));
    expect(!loaded.ok && loaded.error.code).toBe("USAGE");
  });

  // @req FR-NODE-242 AC-2
  it.runIf(CASE_INSENSITIVE)("counts a citation whose path differs only in case on a case-insensitive file system", () => {
    const doc = parsePrd(buildPrd(), PRD_PATH);
    const report = prdCoverage(doc, [citing("AC-1 ← Docs/PRD/2026-11-04.Reset.prd.md#PRD-2")], { target: "1.0.0" });
    expect(report.ungroundedCriteria).toEqual([]);
  });
});
