import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveProjectRoot } from "../../src/core/project-root.js";
import { addRequirement } from "../../src/core/mutation/add-requirement.js";
import { addVerificationEvidence } from "../../src/core/mutation/add-evidence.js";
import { setAcceptanceCriteriaChecked } from "../../src/core/mutation/check-ac.js";
import { updateStability } from "../../src/core/mutation/update-stability.js";
import { updateStatus } from "../../src/core/mutation/update-status.js";
import { parseWorkspace } from "../../src/core/parser/workspace-parser.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

const ARCH_FILE = path.join("docs", "spec", "10.product-architecture.srs.md");

async function readArch(rootPath: string): Promise<string> {
  return readFile(path.join(rootPath, ARCH_FILE), "utf8");
}

describe("update_stability end-to-end (v2.2.1 §5.2)", () => {
  describe("Scenario A — lifecycle round-trip", () => {
    it("applies stable → evolving → frozen → deprecated with readback through parseWorkspace", async () => {
      const rootPath = await copyFixtureWorkspace("mutation-target");
      const root = await resolveProjectRoot(rootPath);

      const t1 = await updateStability(root, { id: "FR-ARCH-001", stability: "evolving", reason: "begin lifecycle e2e" });
      expect(t1.ok).toBe(true);
      const w1 = await parseWorkspace(root);
      expect(w1.records.find((r) => r.id === "FR-ARCH-001")?.stability).toBe("evolving");

      const t2 = await updateStability(root, { id: "FR-ARCH-001", stability: "frozen", reason: "lock for release window" });
      expect(t2.ok).toBe(true);
      const w2 = await parseWorkspace(root);
      expect(w2.records.find((r) => r.id === "FR-ARCH-001")?.stability).toBe("frozen");

      const t3 = await updateStability(root, { id: "FR-ARCH-001", stability: "deprecated", reason: "scheduled removal" });
      expect(t3.ok).toBe(true);
      const w3 = await parseWorkspace(root);
      expect(w3.records.find((r) => r.id === "FR-ARCH-001")?.stability).toBe("deprecated");

      const file = await readArch(rootPath);
      const changeNoteRows = file.split("\n").filter((line) => /Stability ->/.test(line));
      expect(changeNoteRows).toHaveLength(3);
      expect(changeNoteRows[0]).toContain("Stability -> evolving");
      expect(changeNoteRows[1]).toContain("Stability -> frozen");
      expect(changeNoteRows[2]).toContain("Stability -> deprecated");
    });

    it("rejects frozen transition when reason is omitted (AC-4) and does not modify file", async () => {
      const rootPath = await copyFixtureWorkspace("mutation-target");
      const root = await resolveProjectRoot(rootPath);
      const before = await readArch(rootPath);
      const result = await updateStability(root, { id: "FR-ARCH-001", stability: "frozen" });
      expect(result.ok).toBe(false);
      const after = await readArch(rootPath);
      expect(after).toBe(before);
    });
  });

  describe("Scenario B — DRAFT marker simple apply / remove", () => {
    it("applies [DRAFT — pending decision] heading marker on stable → draft", async () => {
      const rootPath = await copyFixtureWorkspace("mutation-target");
      const root = await resolveProjectRoot(rootPath);
      const result = await updateStability(root, { id: "FR-ARCH-001", stability: "draft" });
      expect(result.ok).toBe(true);
      const file = await readArch(rootPath);
      expect(file).toContain("| Stability | draft |");
      expect(file).toMatch(/^### FR-ARCH-001 — Mutable requirement \[DRAFT — pending decision\]\s*$/m);
    });

    it("removes [DRAFT ...] marker on draft → evolving and restores plain heading", async () => {
      const rootPath = await copyFixtureWorkspace("mutation-target");
      const root = await resolveProjectRoot(rootPath);
      const draft = await updateStability(root, { id: "FR-ARCH-001", stability: "draft" });
      expect(draft.ok).toBe(true);
      const back = await updateStability(root, { id: "FR-ARCH-001", stability: "evolving", reason: "decision made" });
      expect(back.ok).toBe(true);
      const file = await readArch(rootPath);
      expect(file).toContain("| Stability | evolving |");
      expect(file).not.toMatch(/\[DRAFT/);
      expect(file).toMatch(/^### FR-ARCH-001 — Mutable requirement\s*$/m);
    });

    it("idempotent: re-applying draft to an already-draft heading does not duplicate marker", async () => {
      const rootPath = await copyFixtureWorkspace("mutation-target");
      const root = await resolveProjectRoot(rootPath);
      await updateStability(root, { id: "FR-ARCH-001", stability: "draft" });
      await updateStability(root, { id: "FR-ARCH-001", stability: "draft" });
      const file = await readArch(rootPath);
      const markerCount = (file.match(/\[DRAFT/g) ?? []).length;
      expect(markerCount).toBe(1);
      const headingCount = file.split("\n").filter((line) => /^### FR-ARCH-001 — Mutable requirement \[DRAFT/.test(line)).length;
      expect(headingCount).toBe(1);
    });
  });

  describe("Scenario C — DRAFT marker + conflicts_with successor decoration (FR-PARSE-017 AC-6)", () => {
    it("decorates [DRAFT → see Y] when a single conflicts_with successor exists", async () => {
      const rootPath = await copyFixtureWorkspace("mutation-target");
      const root = await resolveProjectRoot(rootPath);
      const successor = await addRequirement(root, {
        type: "functional",
        scope: "ARCH",
        target: "v1.0.0",
        title: "Conflicting variant of FR-ARCH-001",
        statement: "Conflicts with the original architecture requirement.",
        acceptanceCriteria: ["AC-1: new variant criterion."],
        trace: [{ type: "Requirement", reference: "FR-ARCH-001", relation: "conflicts_with" }]
      });
      expect(successor.ok).toBe(true);
      const successorId = (successor.value as { requirementId: string }).requirementId;
      const result = await updateStability(root, { id: "FR-ARCH-001", stability: "draft" });
      expect(result.ok).toBe(true);
      const file = await readArch(rootPath);
      expect(file).toContain(`### FR-ARCH-001 — Mutable requirement [DRAFT — pending decision, see ${successorId}]`);
    });

    it("decorates [DRAFT — pending decision, see Y +N] when multiple conflicts_with successors exist", async () => {
      const rootPath = await copyFixtureWorkspace("mutation-target");
      const root = await resolveProjectRoot(rootPath);
      const successors: string[] = [];
      for (let index = 0; index < 3; index += 1) {
        const created = await addRequirement(root, {
          type: "functional",
          scope: "ARCH",
          target: "v1.0.0",
          title: `Conflicting variant ${index + 1}`,
          statement: `Conflicts with FR-ARCH-001 — variant ${index + 1}.`,
          acceptanceCriteria: ["AC-1: variant criterion."],
          trace: [{ type: "Requirement", reference: "FR-ARCH-001", relation: "conflicts_with" }]
        });
        expect(created.ok).toBe(true);
        successors.push((created.value as { requirementId: string }).requirementId);
      }
      const result = await updateStability(root, { id: "FR-ARCH-001", stability: "draft" });
      expect(result.ok).toBe(true);
      const file = await readArch(rootPath);
      expect(file).toContain(`### FR-ARCH-001 — Mutable requirement [DRAFT — pending decision, see ${successors[0]} +2]`);
    });
  });

  describe("Scenario D — verified+draft denial (FR-PARSE-015 AC-7)", () => {
    it("rejects update_stability to draft when status is verified, and leaves the file unchanged", async () => {
      const rootPath = await copyFixtureWorkspace("mutation-target");
      const root = await resolveProjectRoot(rootPath);
      const ac = await setAcceptanceCriteriaChecked(root, { id: "FR-ARCH-001", acIds: ["all"], checked: true });
      expect(ac.ok).toBe(true);
      const evidence = await addVerificationEvidence(root, {
        id: "FR-ARCH-001",
        type: "test",
        // FR-NODE-174: resolved against the fixture workspace, so it must name a file that is there.
        reference: "docs/spec/00.index.md",
        covers: "all",
        notes: "e2e fixture"
      });
      expect(evidence.ok).toBe(true);
      const verified = await updateStatus(root, { id: "FR-ARCH-001", status: "verified", reason: "evidence captured" });
      expect(verified.ok).toBe(true);

      const before = await readArch(rootPath);
      const denial = await updateStability(root, { id: "FR-ARCH-001", stability: "draft" });
      expect(denial.ok).toBe(false);
      if (!denial.ok) expect(denial.error.code).toBe("MUTATION_DENIED");
      const after = await readArch(rootPath);
      expect(after).toBe(before);
    });
  });

  describe("Scenario E — dryRun leaves file untouched", () => {
    it("returns ok with written=false and identical bytes for dryRun stable → evolving (with reason)", async () => {
      const rootPath = await copyFixtureWorkspace("mutation-target");
      const root = await resolveProjectRoot(rootPath);
      const before = await readArch(rootPath);
      const result = await updateStability(root, { id: "FR-ARCH-001", stability: "evolving", reason: "dry only", dryRun: true });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.written).toBe(false);
        expect(result.value.stability).toBe("evolving");
      }
      const after = await readArch(rootPath);
      expect(after).toBe(before);
    });
  });
});
