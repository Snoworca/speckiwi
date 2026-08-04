import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { addTraceLink } from "../../../src/core/mutation/add-trace.js";
import { addVerificationEvidence } from "../../../src/core/mutation/add-evidence.js";
import { updateStatus } from "../../../src/core/mutation/update-status.js";
import { editRequirementTableRows, replaceAcceptanceCriteria, updateRequirementFields } from "../../../src/core/mutation/edit-requirement.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

describe("FR-NODE-019 granular requirement editing services", () => {
  it("updates title, statement, and supported metadata without rewriting unrelated sections", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const root = await resolveProjectRoot(rootPath);
    const specPath = path.join(rootPath, "docs/spec/10.product-architecture.srs.md");
    const before = await readFile(specPath, "utf8");

    const dryRun = await updateRequirementFields(root, {
      id: "FR-ARCH-001",
      title: "Dry run title",
      statement: "Dry run statement.",
      dryRun: true
    });
    expect(dryRun).toMatchObject({ ok: true, value: { written: false }, mutation: { dryRun: true } });
    expect(await readFile(specPath, "utf8")).toBe(before);

    const written = await updateRequirementFields(root, {
      id: "FR-ARCH-001",
      title: "Edited requirement",
      statement: "SpecKiwi must mutate this edited requirement safely.",
      priority: "medium",
      risk: "medium",
      tags: ["fixture", "granular"],
      relatedDocs: ["docs/research/230.md"],
      verificationMethod: "test, inspection",
      githubIssue: "https://github.com/Snoworca/speckiwi/issues/230"
    });

    expect(written).toMatchObject({ ok: true, value: { written: true, updatedFields: expect.arrayContaining(["title", "statement", "Priority", "Risk"]) } });
    const text = await readFile(specPath, "utf8");
    expect(text).toContain("### FR-ARCH-001 — Edited requirement");
    expect(text).toContain("SpecKiwi must mutate this edited requirement safely.");
    expect(text).toContain("| Priority | medium |");
    expect(text).toContain("| Tags | fixture, granular |");
    expect(text).toContain("#### Rationale\n\nMutation tests need a stable target.");
  });

  it("replaces acceptance criteria with deterministic AC numbering for add, update, delete, and reorder cases", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const root = await resolveProjectRoot(rootPath);

    const result = await replaceAcceptanceCriteria(root, {
      id: "FR-ARCH-001",
      items: [
        { text: "Evidence can be rewritten.", checked: true },
        { text: "A new second criterion is added." },
        { text: "Original status criterion moved after edits." }
      ]
    });

    expect(result).toMatchObject({ ok: true, value: { written: true, updatedFields: ["acceptanceCriteria"] } });
    const text = await readFile(path.join(rootPath, "docs/spec/10.product-architecture.srs.md"), "utf8");
    expect(text).toContain("- [x] AC-1: Evidence can be rewritten.");
    expect(text).toContain("- [ ] AC-2: A new second criterion is added.");
    expect(text).toContain("- [ ] AC-3: Original status criterion moved after edits.");
    expect(text).not.toContain("AC-4");
  });

  it("updates and deletes verification evidence and trace rows with table-cell safety", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const root = await resolveProjectRoot(rootPath);
    await addVerificationEvidence(root, { id: "FR-ARCH-001", type: "test", reference: "old.test.ts", covers: "AC-1", notes: "old" });
    await addTraceLink(root, { id: "FR-ARCH-001", type: "Requirement", reference: "FR-ARCH-001", relation: "related_to", notes: "self" });

    const evidence = await editRequirementTableRows(root, {
      id: "FR-ARCH-001",
      section: "verification_evidence",
      operations: [{ kind: "update", rowId: "VE-1", values: { reference: "test/core/mutation/edit-requirement.test.ts", notes: "updated" } }]
    });
    expect(evidence).toMatchObject({ ok: true, value: { written: true } });

    const trace = await editRequirementTableRows(root, {
      id: "FR-ARCH-001",
      section: "trace_links",
      operations: [{ kind: "delete", rowIndex: 0 }]
    });
    expect(trace).toMatchObject({ ok: true, value: { written: true } });

    const text = await readFile(path.join(rootPath, "docs/spec/10.product-architecture.srs.md"), "utf8");
    expect(text).toContain("| VE-1 | test | test/core/mutation/edit-requirement.test.ts | AC-1 | updated |");
    expect(text).not.toContain("| Requirement | FR-ARCH-001 | related_to | self |");

    const unsafe = await editRequirementTableRows(root, {
      id: "FR-ARCH-001",
      section: "verification_evidence",
      operations: [{ kind: "update", rowId: "VE-1", values: { notes: "bad|cell" } }]
    });
    expect(unsafe).toMatchObject({ ok: false, error: { code: "MUTATION_DENIED" } });
  });

  it("denies granular edits for verified requirements", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const root = await resolveProjectRoot(rootPath);
    await replaceAcceptanceCriteria(root, { id: "FR-ARCH-001", items: [{ text: "checked", checked: true }] });
    // FR-NODE-174: the reference must resolve under the fixture root, or the requirement never
    // reaches `verified` and this case silently stops testing the verified-edit guard.
    await addVerificationEvidence(root, { id: "FR-ARCH-001", type: "test", reference: "docs/spec/10.product-architecture.srs.md", covers: "all", notes: "-" });
    const promoted = await updateStatus(root, { id: "FR-ARCH-001", status: "verified" });
    expect(promoted.ok, promoted.ok ? "" : promoted.error.message).toBe(true);

    await expect(updateRequirementFields(root, { id: "FR-ARCH-001", title: "Denied" })).resolves.toMatchObject({ ok: false, error: { code: "MUTATION_DENIED" } });
    await expect(replaceAcceptanceCriteria(root, { id: "FR-ARCH-001", items: [{ text: "Denied" }] })).resolves.toMatchObject({ ok: false, error: { code: "MUTATION_DENIED" } });
  });

  it("validates granular edit input before patch planning", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const root = await resolveProjectRoot(rootPath);

    await expect(updateRequirementFields(root, { id: "FR-ARCH-001", title: "bad\ntitle" })).resolves.toMatchObject({ ok: false, error: { code: "USAGE" } });
    await expect(replaceAcceptanceCriteria(root, { id: "FR-ARCH-001", items: [{ text: undefined as never }] })).resolves.toMatchObject({ ok: false, error: { code: "USAGE" } });
    await expect(editRequirementTableRows(root, { id: "FR-ARCH-001", section: "bogus" as never, operations: [{ kind: "update", rowIndex: 0 }] })).resolves.toMatchObject({
      ok: false,
      error: { code: "USAGE" }
    });
    await expect(editRequirementTableRows(root, { id: "FR-ARCH-001", section: "trace_links", operations: [{ kind: "bogus" as never, rowIndex: 0 }] })).resolves.toMatchObject({
      ok: false,
      error: { code: "USAGE" }
    });
  });
});
