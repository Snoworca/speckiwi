import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { expireAcceptanceCriterion } from "../../../src/core/mutation/expire-ac.js";
import { supersedeRequirement } from "../../../src/core/mutation/supersede-requirement.js";
import { updateStatus } from "../../../src/core/mutation/update-status.js";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { validateWorkspace } from "../../../src/core/validator/validate-workspace.js";
import { acFixture, scopeText } from "../ac-expiry-fixture.js";

// @req FR-NODE-243 AC-7 — retiring the requirement an expired marker names as its successor must not
// leave a dangling SRS-E012 that only a forbidden hand edit of the marker could clear.

async function citedSuccessor(): Promise<string> {
  const rootPath = await acFixture({ acLines: ["- [x] AC-1: first", "- [ ] AC-2: second", "- [x] AC-3: third"] });
  const expired = await expireAcceptanceCriterion(await resolveProjectRoot(rootPath), { id: "FR-ARCH-001", acId: "AC-2", reason: "moved", successor: "FR-ARCH-002" });
  expect(expired.ok).toBe(true);
  return rootPath;
}

async function dangling(rootPath: string): Promise<string[]> {
  return validateWorkspace(await parseWorkspace(await resolveProjectRoot(rootPath))).errors.filter((item) => item.code === "SRS-E012").map((item) => item.message);
}

const SUPERSEDE = {
  oldId: "FR-ARCH-002",
  scope: "ARCH",
  target: "v1.0.0",
  title: "New successor",
  statement: "SpecKiwi must carry this.",
  acceptanceCriteria: ["The new successor exists."],
  reason: "replaced",
  confirmDiscardVerified: true
};

describe("FR-NODE-243 AC-7 — a cited successor is superseded with its markers or not discarded at all", () => {
  // @req FR-NODE-243 AC-7
  it("update_status discarded refuses a requirement an expired marker cites, names the marker and writes nothing", async () => {
    const rootPath = await citedSuccessor();
    const before = await scopeText(rootPath);
    const result = await updateStatus(await resolveProjectRoot(rootPath), { id: "FR-ARCH-002", status: "discarded", reason: "gone", confirmDiscardVerified: true });
    expect(result.ok).toBe(false);
    expect(result.error?.message).toContain("FR-ARCH-001 AC-2");
    expect(await scopeText(rootPath)).toBe(before);
  });

  // @req FR-NODE-243 AC-7
  it("update_status discarded still works on a requirement no marker cites", async () => {
    const rootPath = await acFixture({ acLines: ["- [x] AC-1: first", "- [ ] AC-2: second"] });
    const result = await updateStatus(await resolveProjectRoot(rootPath), { id: "FR-ARCH-002", status: "discarded", reason: "gone", confirmDiscardVerified: true });
    expect(result.ok).toBe(true);
  });

  // @req FR-NODE-243 AC-7
  it("supersede_requirement moves every citing marker to the new requirement and leaves no SRS-E012", async () => {
    const rootPath = await citedSuccessor();
    const result = await supersedeRequirement(await resolveProjectRoot(rootPath), SUPERSEDE);
    expect(result.ok, JSON.stringify(result.error)).toBe(true);
    const newId = result.value!.newId!;
    const workspace = await parseWorkspace(await resolveProjectRoot(rootPath));
    expect(workspace.records.find((record) => record.id === "FR-ARCH-001")!.expiredAcceptanceCriteria?.map((criterion) => criterion.successor)).toEqual([newId]);
    expect(workspace.records.find((record) => record.id === "FR-ARCH-002")!.status).toBe("discarded");
    // Only markers move: the new requirement's own supersedes row keeps naming the old one.
    expect(workspace.records.find((record) => record.id === newId)!.traceLinks.map((link) => [link.relation, link.reference])).toEqual([["supersedes", "FR-ARCH-002"]]);
    expect(await dangling(rootPath)).toEqual([]);
  });

  // @req FR-NODE-243 AC-7
  it("supersede_requirement on dryRun writes nothing", async () => {
    const rootPath = await citedSuccessor();
    const before = await scopeText(rootPath);
    const result = await supersedeRequirement(await resolveProjectRoot(rootPath), { ...SUPERSEDE, dryRun: true });
    expect(result.ok, JSON.stringify(result.error)).toBe(true);
    expect(await scopeText(rootPath)).toBe(before);
  });

  // @req FR-NODE-243 AC-7 — the denominator: every source file that changes an existing requirement's
  // Status row (a metadata write naming "Status"). A new writer fails here until it is guarded too.
  it("covers every writer of a requirement's Status row", async () => {
    const writesStatus = /planMetadataWrite\([^)]*"Status"/;
    const found: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) await walk(full);
        else if (entry.name.endsWith(".ts") && writesStatus.test(await readFile(full, "utf8"))) found.push(full.replaceAll("\\", "/"));
      }
    };
    await walk("src");
    expect(found.sort()).toEqual(["src/core/mutation/update-status.ts"]);
  });
});
