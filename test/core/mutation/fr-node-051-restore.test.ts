import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { setAcceptanceCriteriaChecked } from "../../../src/core/mutation/check-ac.js";
import { addVerificationEvidence } from "../../../src/core/mutation/add-evidence.js";
import { updateStatus } from "../../../src/core/mutation/update-status.js";
// FR-NODE-051 — restore core un-discards a requirement with required reason.
// The `restore` mutation does not exist yet; importing it makes this suite red
// before the implementation in T-PH003-68. It is expected to live alongside
// updateStatus per the requirement's Code addition_site trace
// (src/core/mutation/update-status.ts).
import { restore } from "../../../src/core/mutation/update-status.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

// Red-phase suite (T-PH003-67): each acceptance criterion (AC-1..AC-5) is asserted
// against the future `restore` behaviour described in FR-NODE-051. These cases fail
// before `restore` exists in src/core/mutation/update-status.ts.

const SPEC_FILE = path.join("docs", "spec", "10.product-architecture.srs.md");
const TARGET_ID = "FR-ARCH-001";

async function specPath(rootPath: string): Promise<string> {
  return path.join(rootPath, SPEC_FILE);
}

/** Rewrites the single fixture metadata row for FR-ARCH-001 (e.g. Status / Stability). */
async function setMetadataValue(rootPath: string, field: string, value: string): Promise<void> {
  const file = await specPath(rootPath);
  const text = await readFile(file, "utf8");
  const re = new RegExp(`\\| ${field} \\| [^|]*\\|`);
  const replaced = text.replace(re, `| ${field} | ${value} |`);
  await writeFile(file, replaced, "utf8");
}

/**
 * Drive FR-ARCH-001 into the discarded state on disk using the real updateStatus
 * mutation (which applies the strikethrough + [DISCARDED] heading marker and sets
 * Status=discarded). Stability is lowered to evolving first so the discard is not
 * blocked by the FR-NODE-019 protected-state guard.
 */
async function makeDiscarded(rootPath: string): Promise<void> {
  await setMetadataValue(rootPath, "Stability", "evolving");
  const root = await resolveProjectRoot(rootPath);
  const result = await updateStatus(root, {
    id: TARGET_ID,
    status: "discarded",
    reason: "Discarded to set up the restore precondition"
  });
  expect(result.ok).toBe(true);
}

/**
 * Bring FR-ARCH-001 to a fully-verified state (all AC checked, one evidence row,
 * Status=verified) and then discard it via the FR-NODE-019 override path. This is the
 * precondition for AC-5: a requirement that was previously verified before discard.
 */
async function makePreviouslyVerifiedThenDiscarded(rootPath: string): Promise<void> {
  await setMetadataValue(rootPath, "Stability", "evolving");
  const root = await resolveProjectRoot(rootPath);
  await setAcceptanceCriteriaChecked(root, { id: TARGET_ID, acIds: ["all"], checked: true });
  await addVerificationEvidence(root, {
    id: TARGET_ID,
    type: "test",
    reference: "test/core/mutation/fr-node-051-restore.test.ts",
    covers: "all"
  });
  await setMetadataValue(rootPath, "Status", "verified");
  const verifiedRoot = await resolveProjectRoot(rootPath);
  const discardResult = await updateStatus(verifiedRoot, {
    id: TARGET_ID,
    status: "discarded",
    reason: "Discarding a verified requirement to set up the restore precondition",
    confirmDiscardVerified: true
  });
  expect(discardResult.ok).toBe(true);
}

describe("FR-NODE-051 restore core un-discards a requirement with required reason", () => {
  // AC-1: restore on a discarded requirement sets its Status to the requested active
  // status, defaulting to planned.
  it("FR-NODE-051 AC-1: defaults restored Status to planned, and honours an explicit active status", async () => {
    // Default-to-planned path.
    const defaultRoot = await copyFixtureWorkspace("mutation-target");
    await makeDiscarded(defaultRoot);
    const root = await resolveProjectRoot(defaultRoot);
    const result = await restore(root, {
      id: TARGET_ID,
      reason: "Reactivated for the next milestone"
    });
    expect(result.ok).toBe(true);
    const file = await readFile(await specPath(defaultRoot), "utf8");
    expect(file).toContain("| Status | planned |");
    expect(file).not.toContain("| Status | discarded |");

    // Explicit active status path.
    const explicitRoot = await copyFixtureWorkspace("mutation-target");
    await makeDiscarded(explicitRoot);
    const explicitProjectRoot = await resolveProjectRoot(explicitRoot);
    const explicitResult = await restore(explicitProjectRoot, {
      id: TARGET_ID,
      status: "in_progress",
      reason: "Reactivated and work resumed"
    });
    expect(explicitResult.ok).toBe(true);
    const explicitFile = await readFile(await specPath(explicitRoot), "utf8");
    expect(explicitFile).toContain("| Status | in_progress |");
  });

  // AC-2: restore removes the heading strikethrough and the DISCARDED marker from the
  // requirement heading.
  it("FR-NODE-051 AC-2: removes the heading strikethrough and DISCARDED marker", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    await makeDiscarded(rootPath);
    // Sanity: the discard precondition actually decorated the heading.
    const discardedFile = await readFile(await specPath(rootPath), "utf8");
    expect(discardedFile).toContain("[DISCARDED]");
    expect(discardedFile).toContain(`~~${TARGET_ID} — Mutable requirement~~`);

    const root = await resolveProjectRoot(rootPath);
    const result = await restore(root, {
      id: TARGET_ID,
      reason: "Reactivated; heading must be clean"
    });
    expect(result.ok).toBe(true);

    const file = await readFile(await specPath(rootPath), "utf8");
    expect(file).toContain(`### ${TARGET_ID} — Mutable requirement`);
    expect(file).not.toContain("[DISCARDED]");
    expect(file).not.toContain("~~");
  });

  // AC-3: restore appends one Change Notes row carrying the supplied reason in the same
  // patch.
  it("FR-NODE-051 AC-3: appends exactly one Change Notes row carrying the supplied reason", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    await makeDiscarded(rootPath);
    const before = await readFile(await specPath(rootPath), "utf8");
    const changeNotesRowsBefore = before.split("\n").filter((line) => /^\| \d{4}-\d{2}-\d{2} \|/.test(line)).length;

    const root = await resolveProjectRoot(rootPath);
    const reason = "Restored because the feature returned to scope";
    const result = await restore(root, { id: TARGET_ID, reason });
    expect(result.ok).toBe(true);

    const after = await readFile(await specPath(rootPath), "utf8");
    const changeNotesRowsAfter = after.split("\n").filter((line) => /^\| \d{4}-\d{2}-\d{2} \|/.test(line)).length;
    expect(changeNotesRowsAfter).toBe(changeNotesRowsBefore + 1);
    expect(after).toContain(reason);
  });

  // AC-4: restore without a reason returns ok false and writes no file.
  it("FR-NODE-051 AC-4: without a reason returns ok false and writes no file", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    await makeDiscarded(rootPath);
    const before = await readFile(await specPath(rootPath), "utf8");

    const root = await resolveProjectRoot(rootPath);
    // No reason supplied (and an explicitly empty reason must also be rejected).
    const result = await restore(root, { id: TARGET_ID } as { id: string; reason: string });
    expect(result.ok).toBe(false);

    const emptyResult = await restore(root, { id: TARGET_ID, reason: "" });
    expect(emptyResult.ok).toBe(false);

    const after = await readFile(await specPath(rootPath), "utf8");
    expect(after).toBe(before);
  });

  // AC-5: restoring a requirement that was previously verified emits a stale
  // acceptance-criteria and evidence warning.
  it("FR-NODE-051 AC-5: restoring a previously-verified requirement emits a stale AC/evidence warning", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    await makePreviouslyVerifiedThenDiscarded(rootPath);

    const root = await resolveProjectRoot(rootPath);
    const result = await restore(root, {
      id: TARGET_ID,
      reason: "Reactivating a formerly verified requirement"
    });
    expect(result.ok).toBe(true);

    // The warning may surface either on the result value (the updateStability
    // precedent) or via the top-level diagnostics array (the add-completed-work
    // precedent). Accept either documented channel, but require a warning that
    // mentions stale acceptance criteria / evidence.
    const valueWarnings = ((result.value as { warnings?: unknown } | undefined)?.warnings ?? []) as unknown[];
    const diagnosticWarnings = (result.diagnostics ?? []).filter((entry) => entry.severity === "warning");
    const haystack = JSON.stringify([...valueWarnings, ...diagnosticWarnings]).toLowerCase();

    expect(valueWarnings.length + diagnosticWarnings.length).toBeGreaterThan(0);
    expect(/stale|acceptance|evidence/.test(haystack)).toBe(true);
  });
});
