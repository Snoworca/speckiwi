import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { findSpecByCliName } from "../../src/mcp/schemas.js";
import { expireAcceptanceCriterion } from "../../src/core/mutation/expire-ac.js";
import { parseWorkspace } from "../../src/core/parser/workspace-parser.js";
import { resolveProjectRoot } from "../../src/core/project-root.js";
import { liteSdsReferenceDiagnostics, parseLiteSds, type LiteSdsRequirement } from "../../src/core/sds/lite-sds.js";
import { summarizeReleaseReadiness } from "../../src/core/workflow/release-readiness.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

// @req FR-NODE-243 AC-2 AC-7 FR-PARSE-044 AC-1 — what a user reads about an expired criterion must
// match what the tool does: the tool description names every refusal, and a reference to an expired
// criterion is called expired, not missing.

describe("expire_acceptance_criterion description", () => {
  const description = findSpecByCliName("expire-ac")?.description ?? "";

  // @req FR-NODE-243 AC-2
  it("names the successor refusals: missing, the requirement itself, discarded", () => {
    expect(description).toMatch(/successor[^.]*does not exist/);
    expect(description).toMatch(/successor[^.]*the requirement itself/);
    expect(description).toMatch(/successor[^.]*withdrawn by a discard/);
  });

  // @req FR-NODE-243 AC-7
  it("says a successor named by a marker can be retired only through supersede, which moves the marker", () => {
    expect(description).toMatch(/a status change that would discard that successor is refused/);
    expect(description).toMatch(/supersede_requirement moves the marker/);
  });
});

describe("SDS-E063 on an expired criterion", () => {
  const SDS = [
    "# SDS: demo",
    "",
    "| Field | Value |",
    "|---|---|",
    "| Document Type | sds |",
    "| Profile | lite |",
    "| Target | v1.0.0 |",
    "| Status | draft |",
    "| Date | 2026-11-04 |",
    "",
    "## Interfaces",
    "",
    "### Files",
    "",
    "- `src/a.ts` — a @req FR-ARCH-001",
    "  - `run(): void` — runs",
    "",
    "## Acceptance Contracts",
    "",
    "- SDS-AC-1 (FR-ARCH-001 AC-2): WHEN x THE SYSTEM SHALL y → `run`",
    "- SDS-AC-2 (FR-ARCH-001 AC-9): WHEN x THE SYSTEM SHALL y → `run`",
    "",
    "## Test Plan",
    "",
    "| SDS-AC | Test file | Case summary |",
    "|---|---|---|",
    "| SDS-AC-1 | `test/a.test.ts` | a |",
    "| SDS-AC-2 | `test/a.test.ts` | b |",
    ""
  ].join("\n");
  const requirements: LiteSdsRequirement[] = [
    { id: "FR-ARCH-001", target: "v1.0.0", status: "planned", acceptanceCriteria: [{ id: "AC-1" }], expiredAcceptanceCriteria: [{ id: "AC-2" }] }
  ];

  // @req FR-PARSE-044 AC-1
  it("says the criterion is expired, and keeps 'has no' for one that never existed", () => {
    const parsed = parseLiteSds(SDS, "docs/sds/demo.sds.md");
    const messages = liteSdsReferenceDiagnostics(parsed.document, requirements).filter((item) => item.code === "SDS-E063").map((item) => item.message);
    expect(messages).toEqual([
      "SDS-AC-1 interprets FR-ARCH-001 AC-2, but FR-ARCH-001 AC-2 is expired",
      "SDS-AC-2 interprets FR-ARCH-001 AC-9, but FR-ARCH-001 has no AC-9"
    ]);
  });
});

describe("release residue on an expired criterion", () => {
  // @req FR-PARSE-044 AC-1
  it("says the criterion is expired instead of undeclared", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");
    const root = await resolveProjectRoot(rootPath);
    const { setAcceptanceCriteriaChecked } = await import("../../src/core/mutation/check-ac.js");
    const { updateStatus } = await import("../../src/core/mutation/update-status.js");
    const { addVerificationEvidence } = await import("../../src/core/mutation/add-evidence.js");
    expect((await setAcceptanceCriteriaChecked(root, { id: "FR-ARCH-001", acIds: ["AC-1"], checked: true })).ok).toBe(true);
    expect((await addVerificationEvidence(root, { id: "FR-ARCH-001", type: "test", reference: "docs/spec/90.appendix.md", covers: "AC-1" })).ok).toBe(true);
    expect((await updateStatus(root, { id: "FR-ARCH-001", status: "implemented" })).ok).toBe(true);
    expect((await expireAcceptanceCriterion(root, { id: "FR-ARCH-001", acId: "AC-2", reason: "moved" })).ok).toBe(true);
    const indexPath = path.join(rootPath, "docs", "spec", "00.index.md");
    const residue = ["", "## 12. Release Residue", "", "| Target | Requirement | Criterion | Reason |", "| --- | --- | --- | --- |", "| v1.0.0 | FR-ARCH-001 | AC-2 | Waiting on it. |", ""];
    await writeFile(indexPath, `${await readFile(indexPath, "utf8")}${residue.join("\n")}`, "utf8");
    const summary = summarizeReleaseReadiness(await parseWorkspace(root), { target: "v1.0.0" });
    expect(summary.residueProblems).toContain("FR-ARCH-001: names AC-2, which is expired");
  });
});
