import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { setAcceptanceCriteriaChecked } from "../../../src/core/mutation/check-ac.js";
import { addVerificationEvidence } from "../../../src/core/mutation/add-evidence.js";
import { updateStatus, type UpdateStatusInput } from "../../../src/core/mutation/update-status.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

// FR-NODE-019 — updateStatus verified-regression exit guard with explicit override.
// Red-phase suite (T-PH003-05): each acceptance criterion (AC-1..AC-5) is asserted
// against the future guard behaviour described in the requirement. These cases fail
// before the guard exists in src/core/mutation/update-status.ts.

const SPEC_FILE = path.join("docs", "spec", "10.product-architecture.srs.md");

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
 * Bring FR-ARCH-001 to a fully-verified state on disk: all AC checked, one evidence
 * row, Status=verified. This is the canonical "verified" precondition for AC-1/AC-4.
 */
async function makeVerified(rootPath: string): Promise<void> {
  const root = await resolveProjectRoot(rootPath);
  await setAcceptanceCriteriaChecked(root, { id: "FR-ARCH-001", acIds: ["all"], checked: true });
  await addVerificationEvidence(root, {
    id: "FR-ARCH-001",
    type: "test",
    reference: "test/core/mutation/update-status.fr-node-019.test.ts",
    covers: "all"
  });
  await setMetadataValue(rootPath, "Status", "verified");
}

describe("FR-NODE-019 updateStatus verified-regression exit guard", () => {
  // AC-1: Transitioning a verified requirement to discarded without
  // confirmDiscardVerified returns MUTATION_DENIED.
  it("AC-1: denies verified -> discarded without confirmDiscardVerified", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    await makeVerified(rootPath);
    const root = await resolveProjectRoot(rootPath);
    const result = await updateStatus(root, { id: "FR-ARCH-001", status: "discarded" });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error.code).toBe("MUTATION_DENIED");
  });

  // AC-2: Transitioning a frozen or stable requirement to discarded without
  // confirmDiscardVerified returns MUTATION_DENIED. The fixture FR-ARCH-001 is
  // Stability=stable; this case also exercises frozen.
  it("AC-2: denies stable -> discarded without confirmDiscardVerified", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    // Fixture already has Stability=stable.
    const root = await resolveProjectRoot(rootPath);
    const result = await updateStatus(root, { id: "FR-ARCH-001", status: "discarded" });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error.code).toBe("MUTATION_DENIED");
  });

  it("AC-2: denies frozen -> discarded without confirmDiscardVerified", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    await setMetadataValue(rootPath, "Stability", "frozen");
    const root = await resolveProjectRoot(rootPath);
    const result = await updateStatus(root, { id: "FR-ARCH-001", status: "discarded" });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error.code).toBe("MUTATION_DENIED");
  });

  // AC-3: Transitioning an implemented requirement that has verification evidence to
  // discarded without confirmDiscardVerified returns MUTATION_DENIED.
  it("AC-3: denies implemented-with-evidence -> discarded without confirmDiscardVerified", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    // Use evolving stability so the denial is attributable to the implemented+evidence
    // condition rather than the frozen/stable condition.
    await setMetadataValue(rootPath, "Stability", "evolving");
    const root = await resolveProjectRoot(rootPath);
    await addVerificationEvidence(root, {
      id: "FR-ARCH-001",
      type: "test",
      reference: "test/core/mutation/update-status.fr-node-019.test.ts",
      covers: "all"
    });
    await setMetadataValue(rootPath, "Status", "implemented");
    const result = await updateStatus(root, { id: "FR-ARCH-001", status: "discarded" });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error.code).toBe("MUTATION_DENIED");
  });

  // AC-4: Supplying reason and confirmDiscardVerified=true allows the discard
  // transition to proceed.
  it("AC-4: allows verified -> discarded with reason + confirmDiscardVerified", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    await makeVerified(rootPath);
    const root = await resolveProjectRoot(rootPath);
    const override: UpdateStatusInput = {
      id: "FR-ARCH-001",
      status: "discarded",
      reason: "Superseded; discarding per release decision",
      confirmDiscardVerified: true
    };
    const result = await updateStatus(root, override);
    expect(result.ok).toBe(true);
    const file = await readFile(await specPath(rootPath), "utf8");
    expect(file).toContain("| Status | discarded |");
  });

  // AC-5: A failing test reproducing the denied transition is written before the
  // guard implementation. This reproduces the denied transition and asserts the
  // guard surfaces a MUTATION_DENIED error with an informative message.
  it("AC-5: reproduces the denied transition with an informative MUTATION_DENIED message", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    await makeVerified(rootPath);
    const root = await resolveProjectRoot(rootPath);
    const before = await readFile(await specPath(rootPath), "utf8");
    const result = await updateStatus(root, { id: "FR-ARCH-001", status: "discarded" });
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.error.code).toBe("MUTATION_DENIED");
      expect(result.error.message.length).toBeGreaterThan(0);
    }
    // The denied transition must not mutate the document.
    const after = await readFile(await specPath(rootPath), "utf8");
    expect(after).toBe(before);
  });
});
