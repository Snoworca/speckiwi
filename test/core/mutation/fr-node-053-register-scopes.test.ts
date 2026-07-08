import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
// registerScopes is the FR-NODE-053 core mutation introduced by the green task (T-PH003-72).
// It lives in src/core/mutation/register-scopes.ts and does not exist yet, so this import
// fails at collection time — the red signal for the whole suite. RegisterScopesInput /
// RegisterScopesItemPlan / RegisterScopesOutput are the public contract types the cases below
// assert against.
import {
  registerScopes,
  type RegisterScopesInput,
  type RegisterScopesItemPlan,
  type RegisterScopesOutput
} from "../../../src/core/mutation/register-scopes.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

// FR-NODE-053 — register-scopes core registers unregistered scope documents.
//
// The index-drift-unregistered-srs fixture is the canonical SRS-W018 case: it ships a registered
// scope document (10.product-architecture.srs.md, Scope Map prefix ARCH) and one *unregistered*
// scope document, 20.unregistered.srs.md, which holds FR-EXTRA-001 (inferred prefix EXTRA) and is
// absent from the index Scope Map. registerScopes must add that document as a Scope Map row,
// inferring its prefix from the requirement id prefixes, while defaulting to dry-run and reporting
// a skip reason for prefix conflicts.

const INDEX_REL = path.join("docs", "spec", "00.index.md");
const UNREGISTERED_DOC = "20.unregistered.srs.md";

function indexPath(rootPath: string): string {
  return path.join(rootPath, INDEX_REL);
}

/** Locates the per-item plan entry for a given scope document in a registerScopes result. */
function planFor(output: RegisterScopesOutput, document: string): RegisterScopesItemPlan | undefined {
  return output.items.find((item) => item.document === document || item.document.endsWith(document));
}

/**
 * Writes an extra unregistered scope document whose single requirement's inferred prefix is `prefix`.
 * Used by AC-3 to force a prefix collision against an already-registered Scope Map prefix.
 */
async function addUnregisteredScopeDoc(rootPath: string, fileName: string, prefix: string): Promise<void> {
  const specDir = path.join(rootPath, "docs", "spec");
  await mkdir(specDir, { recursive: true });
  const body = [
    "# Collision Scope",
    "",
    "## 4. Requirements",
    "",
    `### FR-${prefix}-099 — Collision fixture`,
    "",
    "| Field | Value |",
    "| --- | --- |",
    "| Type | functional |",
    "| Target | v1.2.0 |",
    "| Status | planned |",
    `| Scope | ${prefix} |`,
    "",
    "#### Requirement",
    "",
    "This unregistered scope document infers a colliding prefix.",
    "",
    "#### Acceptance Criteria",
    "",
    "- [ ] AC-1: The fixture is parsed.",
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
    ""
  ].join("\n");
  await writeFile(path.join(specDir, fileName), body, "utf8");
}

describe("FR-NODE-053 registerScopes core mutation", () => {
  // AC-1: registerScopes in dry-run lists the unregistered scope documents it would add and
  // writes no file. dry-run is the default (no apply flag), and the per-item plan must name the
  // unregistered 20.unregistered.srs.md while the index file on disk stays byte-identical.
  it("FR-NODE-053 AC-1: dry-run lists unregistered scope documents and writes nothing", async () => {
    const rootPath = await copyFixtureWorkspace("index-drift-unregistered-srs");
    const root = await resolveProjectRoot(rootPath);
    const before = await readFile(indexPath(rootPath), "utf8");

    // No apply flag supplied — the mutation must default to dry-run.
    const result = await registerScopes(root, {} satisfies RegisterScopesInput);
    expect(result.ok).toBe(true);
    if (result.ok !== true || result.value === undefined) throw new Error("expected ok result");

    expect(result.value.dryRun).toBe(true);
    const item = planFor(result.value, UNREGISTERED_DOC);
    expect(item).toBeDefined();
    expect(item?.skipReason).toBeUndefined();
    // The inferred prefix comes from the requirement id prefixes in that document (FR-EXTRA-001).
    expect(item?.prefix).toBe("EXTRA");

    // No file was written during the default dry-run.
    const after = await readFile(indexPath(rootPath), "utf8");
    expect(after).toBe(before);
    expect(after).not.toContain(UNREGISTERED_DOC);
  });

  // AC-2: registerScopes with apply inserts one Scope Map row for each unregistered scope
  // document. After apply, the index Scope Map names 20.unregistered.srs.md exactly once with its
  // inferred prefix.
  it("FR-NODE-053 AC-2: apply inserts one Scope Map row per unregistered scope document", async () => {
    const rootPath = await copyFixtureWorkspace("index-drift-unregistered-srs");
    const root = await resolveProjectRoot(rootPath);

    const result = await registerScopes(root, { apply: true });
    expect(result.ok).toBe(true);
    if (result.ok !== true || result.value === undefined) throw new Error("expected ok result");

    expect(result.value.dryRun).toBe(false);
    const item = planFor(result.value, UNREGISTERED_DOC);
    expect(item?.skipReason).toBeUndefined();
    expect(item?.prefix).toBe("EXTRA");

    const after = await readFile(indexPath(rootPath), "utf8");
    // Exactly one Scope Map row references the newly registered document.
    const occurrences = after.split(UNREGISTERED_DOC).length - 1;
    expect(occurrences).toBe(1);
    expect(after).toContain("EXTRA");
  });

  // AC-3: A scope document whose inferred prefix collides with an existing Scope Map prefix is
  // skipped with a skip reason and not added. The fixture already registers prefix ARCH, so an
  // extra unregistered document inferring ARCH must be skipped (not written).
  it("FR-NODE-053 AC-3: prefix collision is skipped with a skip reason and not added", async () => {
    const rootPath = await copyFixtureWorkspace("index-drift-unregistered-srs");
    // 10.product-architecture.srs.md is registered with prefix ARCH; add a colliding document.
    await addUnregisteredScopeDoc(rootPath, "30.collision.srs.md", "ARCH");
    const root = await resolveProjectRoot(rootPath);

    const result = await registerScopes(root, { apply: true });
    expect(result.ok).toBe(true);
    if (result.ok !== true || result.value === undefined) throw new Error("expected ok result");

    const collision = planFor(result.value, "30.collision.srs.md");
    expect(collision).toBeDefined();
    expect(collision?.skipReason).toBe("prefix-conflict");

    const after = await readFile(indexPath(rootPath), "utf8");
    // The colliding document is not added as a Scope Map row.
    expect(after).not.toContain("30.collision.srs.md");
    // The non-colliding unregistered document is still registered in the same run.
    expect(after).toContain(UNREGISTERED_DOC);
  });

  // AC-4: registerScopes modifies no Requirement Block and no Status or Type summary count.
  // After apply, every requirement block in the scope documents and the index Status Summary /
  // Requirement Type Summary count tables are byte-identical to before.
  it("FR-NODE-053 AC-4: leaves requirement blocks and summary counts unchanged", async () => {
    const rootPath = await copyFixtureWorkspace("index-drift-unregistered-srs");
    const root = await resolveProjectRoot(rootPath);

    const archRel = path.join("docs", "spec", "10.product-architecture.srs.md");
    const unregRel = path.join("docs", "spec", UNREGISTERED_DOC);
    const archBefore = await readFile(path.join(rootPath, archRel), "utf8");
    const unregBefore = await readFile(path.join(rootPath, unregRel), "utf8");
    const indexBefore = await readFile(indexPath(rootPath), "utf8");

    const result = await registerScopes(root, { apply: true });
    expect(result.ok).toBe(true);
    if (result.ok !== true || result.value === undefined) throw new Error("expected ok result");

    // No Requirement Block in any scope document was touched.
    expect(await readFile(path.join(rootPath, archRel), "utf8")).toBe(archBefore);
    expect(await readFile(path.join(rootPath, unregRel), "utf8")).toBe(unregBefore);

    // The Status Summary and Requirement Type Summary count tables in the index are unchanged.
    const indexAfter = await readFile(indexPath(rootPath), "utf8");
    const summarySection = (text: string, heading: RegExp): string => {
      const lines = text.split(/\r?\n/);
      const start = lines.findIndex((line) => heading.test(line.trim()));
      if (start === -1) return "";
      const rows: string[] = [];
      for (let i = start + 1; i < lines.length; i += 1) {
        const line = lines[i] ?? "";
        if (/^##\s/.test(line)) break;
        if (line.startsWith("|")) rows.push(line);
      }
      return rows.join("\n");
    };
    expect(summarySection(indexAfter, /^##\s+\d+\.\s+Status Summary$/)).toBe(
      summarySection(indexBefore, /^##\s+\d+\.\s+Status Summary$/)
    );
    expect(summarySection(indexAfter, /^##\s+\d+\.\s+Requirement Type Summary$/)).toBe(
      summarySection(indexBefore, /^##\s+\d+\.\s+Requirement Type Summary$/)
    );
  });
});
