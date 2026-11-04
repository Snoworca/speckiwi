import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseAcceptanceCriteria } from "../../../src/core/parser/ac-parser.js";
import type { SectionRange } from "../../../src/core/parser/section-parser.js";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { validateWorkspace } from "../../../src/core/validator/validate-workspace.js";
import { collectAcCoverageGaps } from "../../../src/core/workflow/release-readiness.js";
import { checkTestSufficiency } from "../../../src/core/testing/test-sufficiency.js";
import { updateStatus } from "../../../src/core/mutation/update-status.js";
import { deriveCanonicalRequirementReadiness, parseRequirementSnapshot, type SpecRequirementRecord } from "../../../src/core/orchestrator/readiness.js";
import { cliPayload, content, record as readinessRecord, TARGET } from "../orchestrator/support/readiness-fixture.js";
import { acFixture } from "../ac-expiry-fixture.js";

function section(lines: string[]): SectionRange {
  return { name: "Acceptance Criteria", startLine: 10, contentStartLine: 11, endLine: 11 + lines.length, lines };
}

async function recordOf(rootPath: string, id = "FR-ARCH-001") {
  const workspace = await parseWorkspace(await resolveProjectRoot(rootPath));
  return { workspace, record: workspace.records.find((record) => record.id === id)! };
}

describe("FR-PARSE-044 AC-1 — an expired line leaves the live criteria", () => {
  // @req FR-PARSE-044 AC-1
  it("returns the expired line with id, text, checked state, date and successor outside the live list", () => {
    const parsed = parseAcceptanceCriteria(
      section([
        "- [x] AC-1: live one",
        "- [x] AC-2: ~~moved away~~ [EXPIRED 2026-11-03 → FR-FLOW-204]",
        "- [ ] AC-3: ~~gone~~ [EXPIRED 2026-11-04]",
        "- [ ] AC-4: last live"
      ])
    );
    expect(parsed.criteria.map((criterion) => criterion.id)).toEqual(["AC-1", "AC-4"]);
    expect(parsed.expired).toEqual([
      { id: "AC-2", text: "moved away", checked: true, line: 12, expiredOn: "2026-11-03", successor: "FR-FLOW-204" },
      { id: "AC-3", text: "gone", checked: false, line: 13, expiredOn: "2026-11-04" }
    ]);
  });

  // @req FR-PARSE-044 AC-1
  it("keeps a line that does not match the grammar as a live criterion", () => {
    const lines = [
      "- [x] AC-1: ~~struck but no marker~~",
      "- [x] AC-2: plain [EXPIRED 2026-11-03]",
      "- [x] AC-3: ~~bad date~~ [EXPIRED 2026-1-3]",
      "- [x] ~~AC-4: id inside the strike~~ [EXPIRED 2026-11-03]",
      "- [x] AC-5: ~~lowercase~~ [expired 2026-11-03]"
    ];
    const parsed = parseAcceptanceCriteria(section(lines));
    expect(parsed.expired).toEqual([]);
    expect(parsed.criteria).toHaveLength(5);
  });

  // @req FR-PARSE-044 AC-1
  it("keeps a marker whose date is not a real calendar date as a live criterion", () => {
    const parsed = parseAcceptanceCriteria(
      section(["- [x] AC-1: ~~a~~ [EXPIRED 2026-13-45]", "- [x] AC-2: ~~b~~ [EXPIRED 2026-02-30]", "- [x] AC-3: ~~c~~ [EXPIRED 2024-02-29]"])
    );
    expect(parsed.criteria.map((criterion) => criterion.id)).toEqual(["AC-1", "AC-2"]);
    expect(parsed.expired.map((criterion) => criterion.id)).toEqual(["AC-3"]);
  });

  // @req FR-PARSE-044 AC-1
  it("puts the expired list on the requirement record and keeps acceptanceCriteria live-only", async () => {
    const rootPath = await acFixture({
      acLines: ["- [x] AC-1: live", "- [x] AC-2: ~~old~~ [EXPIRED 2026-11-03 → FR-ARCH-002]"]
    });
    const { record } = await recordOf(rootPath);
    expect(record.acceptanceCriteria.map((criterion) => criterion.id)).toEqual(["AC-1"]);
    expect(record.expiredAcceptanceCriteria?.map((criterion) => [criterion.id, criterion.expiredOn, criterion.successor])).toEqual([
      ["AC-2", "2026-11-03", "FR-ARCH-002"]
    ]);
  });
});

describe("FR-PARSE-044 AC-2 — only live criteria count", () => {
  // @req FR-PARSE-044 AC-2
  it("accepts a verified requirement whose only unchecked criterion is expired", async () => {
    const rootPath = await acFixture({
      acLines: ["- [x] AC-1: live", "- [ ] AC-2: ~~old~~ [EXPIRED 2026-11-03]"],
      status: "verified",
      evidenceRows: ["| EV-1 | test | docs/spec/00.index.md | all | fixture |"]
    });
    const { workspace } = await recordOf(rootPath);
    const errors = validateWorkspace(workspace).errors.filter((item) => item.code === "SRS-E010");
    expect(errors).toEqual([]);
    expect(collectAcCoverageGaps(workspace.records)).toEqual([]);
  });

  // @req FR-PARSE-044 AC-2
  it("lets update_status reach verified while an expired criterion stays unchecked", async () => {
    const rootPath = await acFixture({
      acLines: ["- [x] AC-1: live", "- [ ] AC-2: ~~old~~ [EXPIRED 2026-11-03]"],
      status: "implemented",
      evidenceRows: ["| EV-1 | test | docs/spec/00.index.md | all | fixture |"]
    });
    const result = await updateStatus(await resolveProjectRoot(rootPath), { id: "FR-ARCH-001", status: "verified" });
    expect(result.ok).toBe(true);
  });

  // @req FR-PARSE-044 AC-2
  it("does not accept as verified a requirement whose live criteria are empty", async () => {
    const rootPath = await acFixture({
      acLines: ["- [x] AC-1: ~~old~~ [EXPIRED 2026-11-03]"],
      status: "implemented",
      evidenceRows: ["| EV-1 | test | docs/spec/00.index.md | all | fixture |"]
    });
    const result = await updateStatus(await resolveProjectRoot(rootPath), { id: "FR-ARCH-001", status: "verified" });
    expect(result.ok).toBe(false);

    const verifiedRoot = await acFixture({
      acLines: ["- [x] AC-1: ~~old~~ [EXPIRED 2026-11-03]"],
      status: "verified",
      evidenceRows: ["| EV-1 | test | docs/spec/00.index.md | all | fixture |"]
    });
    const { workspace } = await recordOf(verifiedRoot);
    expect(validateWorkspace(workspace).errors.map((item) => item.code)).toContain("SRS-E010");
  });

  // @req FR-PARSE-044 AC-2
  it("leaves an expired criterion out of the test-sufficiency gaps", async () => {
    const rootPath = await acFixture({ acLines: ["- [x] AC-1: live", "- [ ] AC-2: ~~old~~ [EXPIRED 2026-11-03]"] });
    await mkdir(path.join(rootPath, "test"), { recursive: true });
    await writeFile(path.join(rootPath, "test", "live.test.ts"), "// FR-ARCH-001 AC-1 covers the live one\n", "utf8");
    const report = await checkTestSufficiency(await parseWorkspace(await resolveProjectRoot(rootPath)), { ids: ["FR-ARCH-001"] });
    expect(report.ok && report.value.gaps.requirements).toEqual([]);
    expect(report.ok && report.value.passed).toBe(true);
  });
});

describe("FR-PARSE-044 AC-3 — an expired citation is listed apart and is not coverage", () => {
  // @req FR-PARSE-044 AC-3
  it("lists a test line citing an expired criterion as an expired citation", async () => {
    const rootPath = await acFixture({ acLines: ["- [x] AC-1: live", "- [ ] AC-2: ~~old~~ [EXPIRED 2026-11-03]"] });
    await mkdir(path.join(rootPath, "test"), { recursive: true });
    await writeFile(path.join(rootPath, "test", "old.test.ts"), "// FR-ARCH-001 AC-2 the old behaviour\n", "utf8");
    const report = await checkTestSufficiency(await parseWorkspace(await resolveProjectRoot(rootPath)), { ids: ["FR-ARCH-001"] });
    if (!report.ok) throw new Error("report failed");
    expect(report.value.expiredCitations).toEqual([
      { requirementId: "FR-ARCH-001", acId: "AC-2", citations: [{ file: "test/old.test.ts", line: 1 }] }
    ]);
    expect(report.value.requirements[0]!.acs.map((ac) => ac.acId)).toEqual(["AC-1"]);
    expect(report.value.gaps.requirements).toEqual([{ requirementId: "FR-ARCH-001", acIds: ["AC-1"] }]);
  });
});

describe("FR-PARSE-044 AC-3 — a Covers cell naming an expired criterion is not stale evidence", () => {
  function drift(expiredIds: readonly string[] | undefined): boolean {
    const base = readinessRecord({
      id: "FR-NODE-901",
      acceptanceCriteria: [{ id: "AC-1", checked: true }],
      verificationEvidence: [{ id: "EV-1", type: "test", covers: "AC-1, AC-2", reference: "test/example.test.ts" }]
    });
    // The transport carries the record as `show`/`list --json` prints it.
    const transported = (expiredIds ? { ...base, expiredAcceptanceCriteria: expiredIds.map((id) => ({ id, text: "old", checked: true, line: 1, expiredOn: "2026-11-03" })) } : base) as SpecRequirementRecord;
    const snapshot = parseRequirementSnapshot(cliPayload(content([transported])));
    return deriveCanonicalRequirementReadiness(snapshot, TARGET, ["FR-NODE-901"])[0]!.evidenceDrift;
  }

  // @req FR-PARSE-044 AC-3
  it("reports no evidence drift when the extra Covers id is an expired criterion, and drift when it names nothing", () => {
    expect(drift(["AC-2"])).toBe(false);
    expect(drift(undefined)).toBe(true);
  });
});

describe("FR-PARSE-044 AC-4 — AC number collisions and missing successors are errors", () => {
  // @req FR-PARSE-044 AC-4
  it("reports SRS-E078 when a live and an expired criterion share a number", async () => {
    const rootPath = await acFixture({ acLines: ["- [x] AC-1: live", "- [x] AC-1: ~~old~~ [EXPIRED 2026-11-03]"] });
    const { workspace } = await recordOf(rootPath);
    const found = validateWorkspace(workspace).errors.filter((item) => item.code === "SRS-E078");
    expect(found).toHaveLength(1);
    expect(found[0]!.requirementId).toBe("FR-ARCH-001");
  });

  // @req FR-PARSE-044 AC-4
  it("reports SRS-E078 when two live criteria share a number", async () => {
    const rootPath = await acFixture({ acLines: ["- [x] AC-1: one", "- [x] AC-1: two"] });
    const { workspace } = await recordOf(rootPath);
    expect(validateWorkspace(workspace).errors.filter((item) => item.code === "SRS-E078")).toHaveLength(1);
  });

  // @req FR-PARSE-044 AC-4
  it("reports SRS-E012 for an expired marker naming a successor that does not exist, and nothing for one that does", async () => {
    const missingRoot = await acFixture({ acLines: ["- [x] AC-1: live", "- [x] AC-2: ~~old~~ [EXPIRED 2026-11-03 → FR-ARCH-999]"] });
    const missing = validateWorkspace((await recordOf(missingRoot)).workspace).errors.filter((item) => item.code === "SRS-E012");
    expect(missing).toHaveLength(1);
    expect(missing[0]!.message).toContain("FR-ARCH-999");

    const presentRoot = await acFixture({ acLines: ["- [x] AC-1: live", "- [x] AC-2: ~~old~~ [EXPIRED 2026-11-03 → FR-ARCH-002]"] });
    const present = validateWorkspace((await recordOf(presentRoot)).workspace).errors.filter((item) => item.code === "SRS-E012" || item.code === "SRS-E078");
    expect(present).toEqual([]);
  });
});

describe("FR-PARSE-044 AC-4 — a successor that is the requirement itself or discarded is reported like a missing one", () => {
  // @req FR-PARSE-044 AC-4
  it("reports SRS-E012 for a self successor", async () => {
    const rootPath = await acFixture({ acLines: ["- [x] AC-1: live", "- [x] AC-2: ~~old~~ [EXPIRED 2026-11-03 → FR-ARCH-001]"] });
    const found = validateWorkspace((await recordOf(rootPath)).workspace).errors.filter((item) => item.code === "SRS-E012");
    expect(found.map((item) => item.message)).toEqual([expect.stringMatching(/FR-ARCH-001.*itself/)]);
  });

  // @req FR-PARSE-044 AC-4
  it("reports SRS-E012 for a discarded successor", async () => {
    const rootPath = await acFixture({ acLines: ["- [x] AC-1: live", "- [x] AC-2: ~~old~~ [EXPIRED 2026-11-03 → FR-ARCH-002]"], successorStatus: "discarded" });
    const found = validateWorkspace((await recordOf(rootPath)).workspace).errors.filter((item) => item.code === "SRS-E012");
    expect(found.map((item) => item.message)).toEqual([expect.stringMatching(/FR-ARCH-002.*discarded/)]);
  });
});

describe("FR-PARSE-044 AC-5 — the bundled rules document states the expiry rules", () => {
  async function acSection(): Promise<string> {
    const text = await readFile(path.join("docs", "rule", "SRS-MD-Rules-v2.6.0.md"), "utf8");
    const start = text.indexOf("## 21. Acceptance Criteria Rules");
    const end = text.indexOf("\n## 22.", start);
    return text.slice(start, end);
  }

  // @req FR-PARSE-044 AC-5
  it("says AC numbers are never renumbered or reused", async () => {
    const rules = await acSection();
    expect(rules).toContain("AC numbers are never renumbered or reused");
    expect(rules).not.toContain("renumbering is allowed");
  });

  // @req FR-PARSE-044 AC-5
  it("says only the tool writes and removes the expired marker", async () => {
    expect(await acSection()).toContain("The expired marker is written and removed only by the tool");
  });

  // @req FR-PARSE-044 AC-5
  it("forbids expiring a criterion to meet the verified conditions", async () => {
    // One item states both refusals, so "that purpose" can only mean meeting the verified conditions.
    expect(await acSection()).toMatch(/Deleting an AC in order to meet the `verified` conditions is forbidden\.[^\n]*Expiring an AC for that purpose is forbidden/);
  });
});
