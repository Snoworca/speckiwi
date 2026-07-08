import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";
import { addCompatibilityCheck } from "../../../src/core/mutation/add-compatibility-check.js";
import { addVerificationEvidence } from "../../../src/core/mutation/add-evidence.js";
import { setAcceptanceCriteriaChecked } from "../../../src/core/mutation/check-ac.js";
// The green task (T-PH003-28) introduces a new export `supersedeRequirement` in
// src/core/mutation/supersede-requirement.ts. Importing the not-yet-existing
// module makes the whole suite red (missing module/export) until the green task
// implements it.
import { supersedeRequirement } from "../../../src/core/mutation/supersede-requirement.js";

// FR-NODE-045 — supersede_requirement strict two-call mutation with guards and
// A1 invalidation.
//
// Red-phase suite (T-PH003-27): one test case per acceptance criterion
// (AC-1..AC-5). These cases describe the future contract of supersedeRequirement
// before src/core/mutation/supersede-requirement.ts exports it, so the whole
// suite fails until the green task (T-PH003-28) implements it.
//
// Contract under test (from the requirement body and AC):
//   supersedeRequirement(root, { oldId, scope, title, statement,
//     acceptanceCriteria, reason?, confirmDiscardVerified?, dryRun? })
//   performs the strict ordered two-call sequence:
//     T1 add_requirement (id unspecified, a `supersedes oldId` trace row),
//        capturing the newly minted newId from T1, then
//     T2 hardened updateStatus(oldId, "discarded").
//   It enforces self-reference, reverse-direction-duplicate, and N>1 successor
//   ambiguity guards, keeps journal resumption idempotent (no duplicate Change
//   Notes row), and invalidates the oldId endpoint's compatibility rows via
//   revoke_compatibility_check after supersede.

const SPEC_DIR = path.join("docs", "spec");
const ARCH_FILE = path.join(SPEC_DIR, "10.product-architecture.srs.md");
const COMPATIBLE_RELATION = "checked_compatible";

/**
 * Renders a minimal ARCH-scope requirement block in the canonical SRS layout,
 * with optional Status / Stability and Trace Links rows so a test can stage a
 * supersede target, an existing successor, or a reverse-direction trace.
 */
function renderReqBlock(options: {
  id: string;
  title: string;
  status?: string;
  stability?: string;
  traceRows?: string[];
}): string {
  const status = options.status ?? "planned";
  const stability = options.stability ?? "evolving";
  return [
    `### ${options.id} — ${options.title}`,
    "",
    "| Field | Value |",
    "| --- | --- |",
    "| Type | functional |",
    "| Target | v1.0.0 |",
    `| Status | ${status} |`,
    "| Priority | high |",
    "| Tags | fixture |",
    "| Risk | low |",
    `| Stability | ${stability} |`,
    "| Verification Method | test |",
    "| GitHub Issue | - |",
    "| Related Docs | - |",
    "",
    "#### Requirement",
    "",
    `Fixture requirement ${options.id}.`,
    "",
    "#### Rationale",
    "",
    "- -",
    "",
    "#### Acceptance Criteria",
    "",
    "- [ ] AC-1: Fixture criterion.",
    "",
    "#### Verification Evidence",
    "",
    "| Evidence ID | Type | Reference | Covers | Notes |",
    "| --- | --- | --- | --- | --- |",
    "",
    "#### Trace Links",
    "",
    "| Type | Reference | Relation | Notes |",
    "| --- | --- | --- | --- |",
    ...(options.traceRows ?? []),
    "",
    "#### Research / Analysis",
    "",
    "- -",
    "",
    "#### Implementation Notes",
    "",
    "- -",
    "",
    "#### Change Notes",
    "",
    "| Date | Change | Reason |",
    "| --- | --- | --- |",
    "| 2026-06-04 | Created | Fixture |"
  ].join("\n");
}

/** Appends one or more requirement blocks to the ARCH scope file of a fixture. */
async function appendReqBlocks(
  rootPath: string,
  blocks: Array<Parameters<typeof renderReqBlock>[0]>
): Promise<void> {
  const archFile = path.join(rootPath, ARCH_FILE);
  const existing = await readFile(archFile, "utf8");
  const rendered = blocks.map((block) => renderReqBlock(block)).join("\n\n");
  await writeFile(archFile, `${existing}\n\n${rendered}\n`, "utf8");
}

/** Returns the parsed requirement record for `id`, or undefined when absent. */
async function recordById(rootPath: string, id: string) {
  const root = await resolveProjectRoot(rootPath);
  const workspace = await parseWorkspace(root);
  return workspace.records.find((record) => record.id === id);
}

/** Counts how many `supersedes` trace rows in the workspace reference `oldId`. */
async function incomingSupersedesCount(rootPath: string, oldId: string): Promise<number> {
  const root = await resolveProjectRoot(rootPath);
  const workspace = await parseWorkspace(root);
  let count = 0;
  for (const record of workspace.records) {
    for (const link of record.traceLinks) {
      if (link.type === "Requirement" && link.relation === "supersedes" && link.reference === oldId) {
        count += 1;
      }
    }
  }
  return count;
}

/** Standard non-protected (evolving) supersede target so the FR-NODE-035 guard is open. */
const OLD_ID = "FR-ARCH-100";

/** The minimal new-requirement payload that T1 add_requirement consumes. */
function supersedeInput(oldId: string, overrides: Record<string, unknown> = {}) {
  return {
    oldId,
    scope: "ARCH",
    target: "v1.0.0",
    title: `Successor of ${oldId}`,
    statement: `Replacement statement superseding ${oldId}.`,
    acceptanceCriteria: ["Successor criterion."],
    ...overrides
  };
}

describe("FR-NODE-045 AC-1 — strict T1 add_requirement then T2 updateStatus, capturing newId", () => {
  it("AC-1: executes add_requirement then discards oldId in that order and captures the newId", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");
    // A non-protected (evolving) supersede target so the discard in T2 is allowed.
    await appendReqBlocks(rootPath, [{ id: OLD_ID, title: "Supersede target", stability: "evolving" }]);
    const root = await resolveProjectRoot(rootPath);

    const result = await supersedeRequirement(root, supersedeInput(OLD_ID));
    expect(result.ok).toBe(true);

    // T1 minted a new requirement id and the call surfaced it.
    const newId = result.ok === true ? (result.value as { newId?: string }).newId : undefined;
    expect(typeof newId).toBe("string");
    expect(newId).not.toBe(OLD_ID);

    // The newly minted requirement exists and carries a `supersedes oldId` trace row.
    const successor = await recordById(rootPath, newId as string);
    expect(successor).toBeDefined();
    expect(
      successor!.traceLinks.some(
        (link) => link.relation === "supersedes" && link.reference === OLD_ID
      )
    ).toBe(true);

    // T2 discarded the old requirement (ordered after T1).
    const oldRecord = await recordById(rootPath, OLD_ID);
    expect(oldRecord?.status).toBe("discarded");
  });
});

describe("FR-NODE-045 AC-2 — self-reference, reverse-duplicate, and N>1 ambiguity guards", () => {
  it("AC-2: rejects a self-referential supersede", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");
    await appendReqBlocks(rootPath, [{ id: OLD_ID, title: "Supersede target" }]);
    const root = await resolveProjectRoot(rootPath);
    const before = await readFile(path.join(rootPath, ARCH_FILE), "utf8");

    // Self-reference: the caller pins the successor to the very id it is
    // superseding (successorId === oldId), so the new requirement would
    // supersede itself. This is a usage rejection.
    const result = await supersedeRequirement(
      root,
      supersedeInput(OLD_ID, { successorId: OLD_ID })
    );
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.error.message.length).toBeGreaterThan(0);
    }

    // No mutation occurred for the rejected self-reference path.
    const after = await readFile(path.join(rootPath, ARCH_FILE), "utf8");
    expect(after).toBe(before);
  });

  it("AC-2: rejects a reverse-direction duplicate supersede", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");
    // oldId already supersedes `peer`; superseding oldId *with* peer as the
    // successor identity would create a reverse-direction duplicate edge.
    await appendReqBlocks(rootPath, [
      {
        id: OLD_ID,
        title: "Already a successor",
        traceRows: ["| Requirement | FR-ARCH-200 | supersedes | - |"]
      },
      { id: "FR-ARCH-200", title: "Reverse endpoint" }
    ]);
    const root = await resolveProjectRoot(rootPath);
    const before = await readFile(path.join(rootPath, ARCH_FILE), "utf8");

    const result = await supersedeRequirement(
      root,
      supersedeInput("FR-ARCH-200", { reverseOf: OLD_ID })
    );
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.error.message.length).toBeGreaterThan(0);
    }
    const after = await readFile(path.join(rootPath, ARCH_FILE), "utf8");
    expect(after).toBe(before);
  });

  it("AC-2: rejects an ambiguous supersede when N>1 successors already exist", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");
    // Two distinct requirements already supersede OLD_ID — the successor is
    // ambiguous, so a further supersede must be denied.
    await appendReqBlocks(rootPath, [
      { id: OLD_ID, title: "Supersede target" },
      {
        id: "FR-ARCH-201",
        title: "Successor A",
        traceRows: [`| Requirement | ${OLD_ID} | supersedes | - |`]
      },
      {
        id: "FR-ARCH-202",
        title: "Successor B",
        traceRows: [`| Requirement | ${OLD_ID} | supersedes | - |`]
      }
    ]);
    const root = await resolveProjectRoot(rootPath);
    expect(await incomingSupersedesCount(rootPath, OLD_ID)).toBe(2);
    const before = await readFile(path.join(rootPath, ARCH_FILE), "utf8");

    const result = await supersedeRequirement(root, supersedeInput(OLD_ID));
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.error.message.length).toBeGreaterThan(0);
    }
    // The denied ambiguous supersede left the document untouched.
    const after = await readFile(path.join(rootPath, ARCH_FILE), "utf8");
    expect(after).toBe(before);
  });
});

describe("FR-NODE-045 AC-3 — T2 hardened updateStatus honors the verified-regression exit guard", () => {
  it("AC-3: denies supersede of a protected (verified) requirement without an override", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");
    await appendReqBlocks(rootPath, [{ id: OLD_ID, title: "Protected target", stability: "stable" }]);
    const root = await resolveProjectRoot(rootPath);

    // Bring OLD_ID to a fully verified, protected state.
    await setAcceptanceCriteriaChecked(root, { id: OLD_ID, acIds: ["all"], checked: true });
    await addVerificationEvidence(root, {
      id: OLD_ID,
      type: "test",
      reference: "test/core/mutation/supersede-requirement.fr-node-030.test.ts",
      covers: "all"
    });
    const file = path.join(rootPath, ARCH_FILE);
    const verifiedText = (await readFile(file, "utf8")).replace(
      new RegExp(`(### ${OLD_ID}[\\s\\S]*?)\\| Status \\| [^|]*\\|`),
      `$1| Status | verified |`
    );
    await writeFile(file, verifiedText, "utf8");

    // Without reason + confirmDiscardVerified, the hardened discard guard blocks T2.
    const denied = await supersedeRequirement(root, supersedeInput(OLD_ID));
    expect(denied.ok).toBe(false);
    if (denied.ok === false) {
      expect(denied.error.code).toBe("MUTATION_DENIED");
    }
    // The protected requirement is still verified (not discarded).
    expect((await recordById(rootPath, OLD_ID))?.status).toBe("verified");

    // With the explicit override, the supersede proceeds and discards OLD_ID.
    const allowed = await supersedeRequirement(
      root,
      supersedeInput(OLD_ID, {
        reason: "Superseded per release decision",
        confirmDiscardVerified: true
      })
    );
    expect(allowed.ok).toBe(true);
    expect((await recordById(rootPath, OLD_ID))?.status).toBe("discarded");
  });
});

describe("FR-NODE-045 AC-4 — idempotent journal resumption (no duplicate Change Notes row)", () => {
  it("AC-4: re-running supersede does not append a duplicate Change Notes row to oldId", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");
    await appendReqBlocks(rootPath, [{ id: OLD_ID, title: "Supersede target", stability: "evolving" }]);
    const root = await resolveProjectRoot(rootPath);

    const first = await supersedeRequirement(
      root,
      supersedeInput(OLD_ID, { reason: "Superseded by successor" })
    );
    expect(first.ok).toBe(true);

    const recordAfterFirst = await recordById(rootPath, OLD_ID);
    const notesAfterFirst = recordAfterFirst?.changeNotes.length ?? 0;

    // Re-running the supersede (journal resumption) must be idempotent: the
    // discard Change Notes row is not appended a second time.
    const second = await supersedeRequirement(
      root,
      supersedeInput(OLD_ID, { reason: "Superseded by successor" })
    );
    // Resumption either no-ops or re-applies without duplicating the journal row.
    const recordAfterSecond = await recordById(rootPath, OLD_ID);
    const notesAfterSecond = recordAfterSecond?.changeNotes.length ?? 0;
    expect(notesAfterSecond).toBe(notesAfterFirst);
    // The status stays discarded regardless of how resumption resolves.
    expect(recordAfterSecond?.status).toBe("discarded");
    expect(typeof second.ok).toBe("boolean");
  });
});

describe("FR-NODE-045 AC-5 — oldId compatibility rows are invalidated via revoke_compatibility_check", () => {
  it("AC-5: revokes the oldId endpoint's checked_compatible rows after supersede", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");
    // OLD_ID and a peer both exist; a compatibility check is recorded between
    // them before the supersede so AC-5 can prove it is invalidated afterwards.
    await appendReqBlocks(rootPath, [
      { id: OLD_ID, title: "Supersede target", stability: "evolving" },
      { id: "FR-ARCH-300", title: "Compatibility peer", stability: "evolving" }
    ]);
    const root = await resolveProjectRoot(rootPath);

    const seeded = await addCompatibilityCheck(root, { aReqId: OLD_ID, bReqId: "FR-ARCH-300" });
    expect(seeded.ok).toBe(true);

    // The compatibility row exists somewhere referencing OLD_ID before supersede.
    const compatBefore = await compatibilityRowsTouching(rootPath, OLD_ID);
    expect(compatBefore).toBeGreaterThan(0);

    const result = await supersedeRequirement(root, supersedeInput(OLD_ID));
    expect(result.ok).toBe(true);

    // After supersede, no checked_compatible row referencing OLD_ID survives.
    const compatAfter = await compatibilityRowsTouching(rootPath, OLD_ID);
    expect(compatAfter).toBe(0);
  });
});

/** Counts checked_compatible trace rows whose holder or reference is `id`. */
async function compatibilityRowsTouching(rootPath: string, id: string): Promise<number> {
  const root = await resolveProjectRoot(rootPath);
  const workspace = await parseWorkspace(root);
  let count = 0;
  for (const record of workspace.records) {
    for (const link of record.traceLinks) {
      if (link.relation !== COMPATIBLE_RELATION) continue;
      if (record.id === id || link.reference === id) count += 1;
    }
  }
  return count;
}
