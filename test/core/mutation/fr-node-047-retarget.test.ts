import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, expectTypeOf, it } from "vitest";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
// retarget is the FR-NODE-059 core mutation introduced by the green task (T-PH003-60).
// It does not exist yet, so this import fails at collection time — the red signal for the
// whole suite. RetargetInput / RetargetItemPlan / RetargetOutput are the public contract
// types asserted by the structural-exclusion criterion (AC-1).
import {
  retarget,
  type RetargetInput,
  type RetargetItemPlan,
  type RetargetOutput
} from "../../../src/core/mutation/retarget.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

// FR-NODE-059 — retarget core mutation with per-item loop dry-run and req-scoped schema.
// Red-phase suite (T-PH003-59): one test case per acceptance criterion (AC-1..AC-6),
// asserted against the future retarget contract. Each case fails before the mutation and
// its input type exist in src/core/mutation/retarget.ts.

const SPEC_FILE = path.join("docs", "spec", "10.product-architecture.srs.md");

async function specPath(rootPath: string): Promise<string> {
  return path.join(rootPath, SPEC_FILE);
}

/** Rewrites the single fixture metadata row for FR-ARCH-001 (e.g. Status / Stability / Target). */
async function setMetadataValue(rootPath: string, field: string, value: string): Promise<void> {
  const file = await specPath(rootPath);
  const text = await readFile(file, "utf8");
  const re = new RegExp(`\\| ${field} \\| [^|]*\\|`);
  const replaced = text.replace(re, `| ${field} | ${value} |`);
  await writeFile(file, replaced, "utf8");
}

/** Locates the per-item plan entry for a given requirement id in a retarget result. */
function planFor(output: RetargetOutput, id: string): RetargetItemPlan | undefined {
  return output.items.find((item) => item.id === id);
}

describe("FR-NODE-059 retarget core mutation", () => {
  // AC-1: The retarget input type has no status field and no active-target field, so a
  // caller cannot pass either through the public mutation contract. Asserted at the type
  // level: 'status', 'activeTarget', and 'active-target' must not be keys of RetargetInput.
  it("FR-NODE-059 AC-1: input type structurally excludes status and active-target fields", () => {
    type InputKeys = keyof RetargetInput;
    // The key set must not contain any status / active-target field.
    expectTypeOf<Extract<InputKeys, "status">>().toEqualTypeOf<never>();
    expectTypeOf<Extract<InputKeys, "activeTarget">>().toEqualTypeOf<never>();
    expectTypeOf<Extract<InputKeys, "active-target">>().toEqualTypeOf<never>();
    // The contract still exposes the destination target and the requirement id set.
    expectTypeOf<RetargetInput>().toHaveProperty("toTarget");
    expectTypeOf<RetargetInput["ids"]>().toEqualTypeOf<string[]>();
  });

  // AC-2: retarget defaults to dry-run and returns a per-item plan listing each requirement
  // id with either a planned Target rewrite or a skipReason, before any file is written.
  it("FR-NODE-059 AC-2: defaults to dry-run and returns a per-item plan without writing", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const root = await resolveProjectRoot(rootPath);
    const before = await readFile(await specPath(rootPath), "utf8");

    // No dryRun flag supplied — the mutation must default to dry-run.
    const result = await retarget(root, { ids: ["FR-ARCH-001"], toTarget: "v1.1.0" });
    expect(result.ok).toBe(true);
    if (result.ok !== true || result.value === undefined) throw new Error("expected ok result");

    expect(result.value.dryRun).toBe(true);
    const item = planFor(result.value, "FR-ARCH-001");
    expect(item).toBeDefined();
    // The entry carries exactly one of: a planned Target rewrite, or a skipReason.
    expect(item?.id).toBe("FR-ARCH-001");
    expect(item?.toTarget).toBe("v1.1.0");
    expect(item?.fromTarget).toBe("v1.0.0");
    expect(item?.skipReason).toBeUndefined();

    // No file was written during the default dry-run.
    const after = await readFile(await specPath(rootPath), "utf8");
    expect(after).toBe(before);
  });

  // AC-3: A requirement whose destination target is not present in the index Target Map
  // yields a per-item skipReason of 'target-not-registered' and is not rewritten.
  it("FR-NODE-059 AC-3: unregistered destination target yields target-not-registered skip", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const root = await resolveProjectRoot(rootPath);
    const before = await readFile(await specPath(rootPath), "utf8");

    // v9.9.9 is not in the fixture Target Map (only v1.0.0 / v1.1.0 are registered).
    const result = await retarget(root, { ids: ["FR-ARCH-001"], toTarget: "v9.9.9", dryRun: false });
    expect(result.ok).toBe(true);
    if (result.ok !== true || result.value === undefined) throw new Error("expected ok result");

    const item = planFor(result.value, "FR-ARCH-001");
    expect(item?.skipReason).toBe("target-not-registered");
    expect(item?.toTarget).toBeUndefined();

    // Not rewritten even with dry-run disabled.
    const after = await readFile(await specPath(rootPath), "utf8");
    expect(after).toBe(before);
    expect(after).toContain("| Target | v1.0.0 |");
  });

  // AC-4: A requirement whose block is frozen (SRS section 16 rule 5) yields a per-item
  // skipReason of 'frozen-needs-change-note' unless a reason is supplied; when supplied the
  // reason is appended to that requirement's Change Notes.
  it("FR-NODE-059 AC-4: frozen block needs a change-note reason, which is appended when supplied", async () => {
    // Without a reason: skip.
    const skipRoot = await copyFixtureWorkspace("mutation-target");
    await setMetadataValue(skipRoot, "Stability", "frozen");
    const rootA = await resolveProjectRoot(skipRoot);
    const skipResult = await retarget(rootA, { ids: ["FR-ARCH-001"], toTarget: "v1.1.0", dryRun: false });
    expect(skipResult.ok).toBe(true);
    if (skipResult.ok !== true || skipResult.value === undefined) throw new Error("expected ok result");
    expect(planFor(skipResult.value, "FR-ARCH-001")?.skipReason).toBe("frozen-needs-change-note");
    expect(await readFile(await specPath(skipRoot), "utf8")).toContain("| Target | v1.0.0 |");

    // With a reason: the rewrite proceeds and the reason is appended to Change Notes.
    const okRoot = await copyFixtureWorkspace("mutation-target");
    await setMetadataValue(okRoot, "Stability", "frozen");
    const rootB = await resolveProjectRoot(okRoot);
    const okResult = await retarget(rootB, {
      ids: ["FR-ARCH-001"],
      toTarget: "v1.1.0",
      reason: "Retargeted to v1.1.0 per release re-scoping",
      dryRun: false
    });
    expect(okResult.ok).toBe(true);
    if (okResult.ok !== true || okResult.value === undefined) throw new Error("expected ok result");
    expect(planFor(okResult.value, "FR-ARCH-001")?.skipReason).toBeUndefined();

    const written = await readFile(await specPath(okRoot), "utf8");
    expect(written).toContain("| Target | v1.1.0 |");
    expect(written).toContain("Retargeted to v1.1.0 per release re-scoping");
  });

  // AC-5: By default retarget includes requirements whose status is verified, and an explicit
  // exclude list removes only the listed ids from the rewrite set.
  it("FR-NODE-059 AC-5: includes verified by default; exclude list removes only listed ids", async () => {
    // Default: a verified requirement is included in the rewrite plan.
    const includeRoot = await copyFixtureWorkspace("mutation-target");
    await setMetadataValue(includeRoot, "Status", "verified");
    const rootA = await resolveProjectRoot(includeRoot);
    const included = await retarget(rootA, { ids: ["FR-ARCH-001"], toTarget: "v1.1.0" });
    expect(included.ok).toBe(true);
    if (included.ok !== true || included.value === undefined) throw new Error("expected ok result");
    const includedItem = planFor(included.value, "FR-ARCH-001");
    expect(includedItem?.toTarget).toBe("v1.1.0");
    expect(includedItem?.skipReason).toBeUndefined();

    // Exclude list: the listed id is removed from the rewrite set.
    const excludeRoot = await copyFixtureWorkspace("mutation-target");
    await setMetadataValue(excludeRoot, "Status", "verified");
    const rootB = await resolveProjectRoot(excludeRoot);
    const excluded = await retarget(rootB, {
      ids: ["FR-ARCH-001"],
      toTarget: "v1.1.0",
      exclude: ["FR-ARCH-001"]
    });
    expect(excluded.ok).toBe(true);
    if (excluded.ok !== true || excluded.value === undefined) throw new Error("expected ok result");
    const excludedItem = planFor(excluded.value, "FR-ARCH-001");
    expect(excludedItem?.skipReason).toBe("excluded");
    expect(excludedItem?.toTarget).toBeUndefined();
  });

  // AC-6: Only with dry-run disabled does retarget write Target metadata rewrites, and it
  // preserves each file's existing newline style.
  it("FR-NODE-059 AC-6: only writes when dry-run disabled and preserves newline style", async () => {
    // dry-run disabled on an LF fixture: the Target row is rewritten and LF is preserved.
    const lfRoot = await copyFixtureWorkspace("mutation-target");
    const rootA = await resolveProjectRoot(lfRoot);
    const applied = await retarget(rootA, { ids: ["FR-ARCH-001"], toTarget: "v1.1.0", dryRun: false });
    expect(applied.ok).toBe(true);
    if (applied.ok !== true || applied.value === undefined) throw new Error("expected ok result");
    expect(applied.value.dryRun).toBe(false);

    const lfText = await readFile(await specPath(lfRoot), "utf8");
    expect(lfText).toContain("| Target | v1.1.0 |");
    expect(lfText).not.toContain("| Target | v1.0.0 |");
    // LF newline style preserved (no CRLF introduced).
    expect(lfText.includes("\r\n")).toBe(false);

    // dry-run disabled on a CRLF fixture: the rewrite preserves CRLF newlines.
    const crlfRoot = await copyFixtureWorkspace("mutation-target");
    const crlfFile = await specPath(crlfRoot);
    const lf = await readFile(crlfFile, "utf8");
    await writeFile(crlfFile, lf.replace(/\r?\n/g, "\r\n"), "utf8");
    const rootB = await resolveProjectRoot(crlfRoot);
    const crlfApplied = await retarget(rootB, { ids: ["FR-ARCH-001"], toTarget: "v1.1.0", dryRun: false });
    expect(crlfApplied.ok).toBe(true);

    const crlfText = await readFile(crlfFile, "utf8");
    expect(crlfText).toContain("| Target | v1.1.0 |");
    // CRLF newline style preserved: every LF is paired with a preceding CR.
    expect(/[^\r]\n/.test(crlfText)).toBe(false);
  });
});
