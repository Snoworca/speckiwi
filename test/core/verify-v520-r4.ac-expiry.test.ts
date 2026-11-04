import { describe, expect, it } from "vitest";
import { expireAcceptanceCriterion } from "../../src/core/mutation/expire-ac.js";
import { supersedeRequirement } from "../../src/core/mutation/supersede-requirement.js";
import { updateStatus } from "../../src/core/mutation/update-status.js";
import { parseWorkspace } from "../../src/core/parser/workspace-parser.js";
import { resolveProjectRoot } from "../../src/core/project-root.js";
import { validateWorkspace } from "../../src/core/validator/validate-workspace.js";
import { acFixture } from "./ac-expiry-fixture.js";

// Rules §21.7.1: no tool removes or edits an expired marker; §21.7.6 / FR-PARSE-044 AC-4: a marker
// whose successor is discarded is SRS-E012. Retiring the successor through the tools therefore
// leaves an error that only a forbidden hand edit of the marker can clear.

const THREE_LIVE = ["- [x] AC-1: first", "- [ ] AC-2: second", "- [x] AC-3: third"];

async function danglingSuccessors(rootPath: string): Promise<string[]> {
  const workspace = await parseWorkspace(await resolveProjectRoot(rootPath));
  return validateWorkspace(workspace).diagnostics.filter((d) => d.code === "SRS-E012").map((d) => d.message);
}

async function expiredIntoSuccessor(): Promise<string> {
  const rootPath = await acFixture({ acLines: THREE_LIVE });
  const expired = await expireAcceptanceCriterion(await resolveProjectRoot(rootPath), { id: "FR-ARCH-001", acId: "AC-2", reason: "moved", successor: "FR-ARCH-002" });
  expect(expired.ok).toBe(true);
  expect(await danglingSuccessors(rootPath)).toEqual([]);
  return rootPath;
}

describe("verify r4 — retiring the successor an expired marker names", () => {
  it("update_status discarded on the successor either refuses or leaves no SRS-E012 behind", async () => {
    const rootPath = await expiredIntoSuccessor();
    const discarded = await updateStatus(await resolveProjectRoot(rootPath), { id: "FR-ARCH-002", status: "discarded", reason: "merged elsewhere", confirmDiscardVerified: true });
    if (discarded.ok) expect(await danglingSuccessors(rootPath)).toEqual([]);
  });

  it("supersede_requirement of the successor carries the marker to the new successor (or refuses)", async () => {
    const rootPath = await expiredIntoSuccessor();
    const result = await supersedeRequirement(await resolveProjectRoot(rootPath), {
      oldId: "FR-ARCH-002",
      scope: "ARCH",
      target: "v1.0.0",
      title: "New successor",
      statement: "SpecKiwi must carry this.",
      acceptanceCriteria: ["The new successor exists."],
      reason: "replaced",
      confirmDiscardVerified: true
    });
    if (result.ok) expect(await danglingSuccessors(rootPath)).toEqual([]);
  });
});
