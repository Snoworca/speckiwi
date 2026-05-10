import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { addCompletedWork } from "../../../src/core/mutation/add-completed-work.js";
import { addVerificationEvidence } from "../../../src/core/mutation/add-evidence.js";
import { addRequirement, type AddRequirementInput } from "../../../src/core/mutation/add-requirement.js";
import { addTraceLink } from "../../../src/core/mutation/add-trace.js";
import { assertSafeMarkdownTableCell, assertSafeMarkdownTableCells } from "../../../src/core/mutation/table-cell.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

describe("Markdown table cell mutation safety", () => {
  it("uses one helper to reject pipe and newline characters", () => {
    expect(assertSafeMarkdownTableCell("Summary", "safe value")).toBeUndefined();
    expect(assertSafeMarkdownTableCell("Summary", "bad|value")).toMatchObject({ ok: false, error: { code: "MUTATION_DENIED" } });
    expect(assertSafeMarkdownTableCell("Summary", "bad\nvalue")).toMatchObject({ ok: false, error: { code: "MUTATION_DENIED" } });
    expect(assertSafeMarkdownTableCells({ Summary: "bad\rvalue" })).toMatchObject({ ok: false, error: { code: "MUTATION_DENIED" } });
  });

  it("rejects unsafe completed-work cells without changing the index", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const root = await resolveProjectRoot(rootPath);
    const indexPath = path.join(rootPath, "docs", "spec", "00.index.md");
    const before = await readFile(indexPath, "utf8");

    const result = await addCompletedWork(root, {
      date: "2026-05-10",
      summary: "Unsafe completed work row.",
      requirementIds: ["FR-ARCH-001\nFR-ARCH-002"]
    });

    expect(result).toMatchObject({ ok: false, error: { code: "MUTATION_DENIED" } });
    await expect(readFile(indexPath, "utf8")).resolves.toBe(before);
  });

  it("rejects unsafe evidence and trace cells without changing the requirement file", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const root = await resolveProjectRoot(rootPath);
    const requirementPath = path.join(rootPath, "docs", "spec", "10.product-architecture.srs.md");
    const before = await readFile(requirementPath, "utf8");

    await expect(addVerificationEvidence(root, { id: "FR-ARCH-001", type: "test", reference: "bad|reference" })).resolves.toMatchObject({
      ok: false,
      error: { code: "MUTATION_DENIED" }
    });
    await expect(addTraceLink(root, { id: "FR-ARCH-001", type: "Document", reference: "docs/spec.md", relation: "bad\rrelation" })).resolves.toMatchObject({
      ok: false,
      error: { code: "MUTATION_DENIED" }
    });
    await expect(readFile(requirementPath, "utf8")).resolves.toBe(before);
  });

  it("rejects unsafe add-requirement table cells before writing", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const root = await resolveProjectRoot(rootPath);
    const requirementPath = path.join(rootPath, "docs", "spec", "10.product-architecture.srs.md");
    const before = await readFile(requirementPath, "utf8");
    const base: AddRequirementInput = {
      type: "functional",
      scope: "ARCH",
      target: "v1.0.0",
      title: "Unsafe table input",
      statement: "Unsafe table input must be rejected.",
      acceptanceCriteria: ["rejected"]
    };

    const cases: AddRequirementInput[] = [
      { ...base, relatedDocs: ["docs|bad"] },
      { ...base, evidence: [{ type: "test", reference: "bad\nreference" }] },
      { ...base, trace: [{ type: "Document", reference: "docs/spec.md", relation: "bad\rrelation" }] },
      { ...base, changeNotes: "2026-05-10 | Added | bad\nreason" }
    ];

    for (const input of cases) {
      await expect(addRequirement(root, input)).resolves.toMatchObject({ ok: false, error: { code: "MUTATION_DENIED" } });
      await expect(readFile(requirementPath, "utf8")).resolves.toBe(before);
    }
  });
});
