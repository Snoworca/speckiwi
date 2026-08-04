import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { summarizeReleaseReadiness } from "../../../src/core/workflow/release-readiness.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

// @req FR-NODE-175 — release readiness admits an enumerated residue.
//
// The gate demanded every requirement in a target reach `verified`, which stranded 137 requirements
// at `implemented` across seven targets and stalled two of them on the same undischargeable criterion.
// A gate that never closes is abandoned in practice while still standing on paper. The residue makes
// the abandonment explicit and auditable instead — but only if it cannot become a rubber stamp, which
// is why a row must name a criterion that is actually unticked on the requirement it excuses.

const TARGET = "v1.0.0";
const REQ = "FR-ARCH-001";

async function fixture(): Promise<{ root: Awaited<ReturnType<typeof resolveProjectRoot>>; indexPath: string }> {
  const rootPath = await copyFixtureWorkspace("valid-basic");
  return { root: await resolveProjectRoot(rootPath), indexPath: path.join(rootPath, "docs", "spec", "00.index.md") };
}

/**
 * Leaves FR-ARCH-001 at `implemented` with AC-1 ticked and AC-2 not, so a residue row has something
 * real to name. An evidence row is added because an `implemented` requirement with none trips
 * `missingEvidence`, a different blocker — these cases are about the residue and nothing else.
 */
async function leaveImplemented(root: Awaited<ReturnType<typeof resolveProjectRoot>>): Promise<void> {
  const { setAcceptanceCriteriaChecked } = await import("../../../src/core/mutation/check-ac.js");
  const { updateStatus } = await import("../../../src/core/mutation/update-status.js");
  const { addVerificationEvidence } = await import("../../../src/core/mutation/add-evidence.js");
  expect((await setAcceptanceCriteriaChecked(root, { id: REQ, acIds: ["AC-1"], checked: true })).ok).toBe(true);
  expect(
    (await addVerificationEvidence(root, { id: REQ, type: "test", reference: "docs/spec/90.appendix.md", covers: "AC-1" })).ok
  ).toBe(true);
  expect((await updateStatus(root, { id: REQ, status: "implemented" })).ok).toBe(true);
}

async function writeResidue(indexPath: string, rows: string[]): Promise<void> {
  const body = await readFile(indexPath, "utf8");
  const section = [
    "",
    "## 12. Release Residue",
    "",
    "| Target | Requirement | Criterion | Reason |",
    "| --- | --- | --- | --- |",
    ...rows,
    ""
  ].join("\n");
  await writeFile(indexPath, `${body}${section}`, "utf8");
}

async function readiness(root: Awaited<ReturnType<typeof resolveProjectRoot>>) {
  return summarizeReleaseReadiness(await parseWorkspace(root), { target: TARGET });
}

describe("FR-NODE-175 — an implemented requirement blocks unless the residue names it", () => {
  it("AC-1: blocks when no residue row exists, as before", async () => {
    const { root } = await fixture();
    await leaveImplemented(root);

    const summary = await readiness(root);

    expect(summary.implementedNotVerified, "the fixture did not reach the blocking state").toContain(REQ);
    expect(summary.ready, "an implemented requirement passed with no residue row").toBe(false);
  });

  it("AC-2: does not block when a row names its target, id, an unticked criterion and a reason", async () => {
    const { root, indexPath } = await fixture();
    await leaveImplemented(root);
    await writeResidue(indexPath, [`| ${TARGET} | ${REQ} | AC-2 | Carried: the criterion needs work scheduled for the next target. |`]);

    const summary = await readiness(root);

    expect(summary.ready, summary.ready ? "" : `still blocked: ${JSON.stringify(summary.acceptedResidue ?? [])}`).toBe(true);
  });

  it("AC-6: the accepted residue is reported separately, naming requirement, criterion and reason", async () => {
    const { root, indexPath } = await fixture();
    await leaveImplemented(root);
    await writeResidue(indexPath, [`| ${TARGET} | ${REQ} | AC-2 | Carried to the next target. |`]);

    const summary = await readiness(root);

    expect(summary.acceptedResidue).toEqual([
      { requirementId: REQ, criterion: "AC-2", reason: "Carried to the next target." }
    ]);
    // What still blocks and what was accepted must be separable by a reader.
    expect(summary.implementedNotVerified, "an accepted requirement is still reported as blocking").not.toContain(REQ);
  });
});

describe("FR-NODE-175 — the register cannot become a rubber stamp", () => {
  it("AC-3: a row naming a ticked criterion blocks and is reported stale", async () => {
    const { root, indexPath } = await fixture();
    await leaveImplemented(root);
    // AC-1 is ticked, so this excuse no longer describes a gap.
    await writeResidue(indexPath, [`| ${TARGET} | ${REQ} | AC-1 | Stale: this criterion has since been met. |`]);

    const summary = await readiness(root);

    expect(summary.ready, "a stale excuse opened the gate").toBe(false);
    expect(summary.residueProblems?.join(" ") ?? "", "the stale row was not reported").toContain("AC-1");
  });

  it("AC-4: a row naming a criterion the requirement does not declare blocks and is reported", async () => {
    const { root, indexPath } = await fixture();
    await leaveImplemented(root);
    await writeResidue(indexPath, [`| ${TARGET} | ${REQ} | AC-99 | Names nothing. |`]);

    const summary = await readiness(root);

    expect(summary.ready, "a row naming a nonexistent criterion opened the gate").toBe(false);
    expect(summary.residueProblems?.join(" ") ?? "").toContain("AC-99");
  });

  it("AC-5: a row for a requirement that is not implemented blocks and is reported", async () => {
    const { root, indexPath } = await fixture();
    // FR-ARCH-001 is left at its fixture status; the row excuses nothing.
    await writeResidue(indexPath, [`| ${TARGET} | FR-ARCH-404 | AC-1 | Excuses a requirement that is not here. |`]);

    const summary = await readiness(root);

    expect(summary.ready, "a row that excuses nothing opened the gate").toBe(false);
    expect(summary.residueProblems?.join(" ") ?? "").toContain("FR-ARCH-404");
  });

  it("AC-5: a row for a DISCARDED requirement blocks and is reported", async () => {
    // AC-5 names three populations — never present, verified, discarded — and says each is
    // constructed by a test rather than represented by the absent one alone. An audit measured that
    // sentence false: `grep -in discard` over both files returned nothing, so the discarded arm was
    // the criterion's own claim about its coverage rather than coverage. This is that population.
    const { root, indexPath } = await fixture();
    const { updateStatus } = await import("../../../src/core/mutation/update-status.js");
    // `confirmDiscardVerified` is the verified-regression guard's explicit override; without it the
    // discard is denied and this case would assert over a requirement that never changed.
    const discarded = await updateStatus(root, {
      id: REQ,
      status: "discarded",
      reason: "Discarded for this case.",
      confirmDiscardVerified: true
    });
    expect(discarded.ok, "the fixture could not be discarded, so this case would assert nothing").toBe(true);
    await writeResidue(indexPath, [`| ${TARGET} | ${REQ} | AC-1 | Excuses a requirement that was discarded. |`]);

    const summary = await readiness(root);

    expect(summary.residueProblems?.join(" ") ?? "", "a row excusing a discarded requirement said nothing").toContain(REQ);
    expect((summary.acceptedResidue ?? []).map((row) => row.requirementId)).not.toContain(REQ);
  });

  it("AC-5: a row naming an empty reason blocks", async () => {
    const { root, indexPath } = await fixture();
    await leaveImplemented(root);
    await writeResidue(indexPath, [`| ${TARGET} | ${REQ} | AC-2 |  |`]);

    const summary = await readiness(root);

    expect(summary.ready, "a reasonless row opened the gate").toBe(false);
  });

  it("AC-7: a row is scoped to the target it names", async () => {
    const { root, indexPath } = await fixture();
    await leaveImplemented(root);
    await writeResidue(indexPath, [`| some-other-target | ${REQ} | AC-2 | Accepted for a different release. |`]);

    const summary = await readiness(root);

    expect(summary.ready, "a row written for another target opened this one").toBe(false);
    expect(summary.implementedNotVerified).toContain(REQ);
  });
});
