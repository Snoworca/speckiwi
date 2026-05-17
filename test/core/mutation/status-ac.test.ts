import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { addRequirement } from "../../../src/core/mutation/add-requirement.js";
import { setAcceptanceCriteriaChecked } from "../../../src/core/mutation/check-ac.js";
import { updateStatus } from "../../../src/core/mutation/update-status.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

describe("status and AC mutations", () => {
  it("updates status and checks all AC through shared guards", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const root = await resolveProjectRoot(rootPath);
    await setAcceptanceCriteriaChecked(root, { id: "FR-ARCH-001", acIds: ["all"], checked: true });
    const result = await updateStatus(root, { id: "FR-ARCH-001", status: "implemented" });
    expect(result.ok).toBe(true);
    expect(await readFile(path.join(rootPath, "docs", "spec", "10.product-architecture.srs.md"), "utf8")).toContain("| Status | implemented |");
  });

  it("denies verified when evidence is missing", async () => {
    const root = await resolveProjectRoot(await copyFixtureWorkspace("mutation-target"));
    await setAcceptanceCriteriaChecked(root, { id: "FR-ARCH-001", acIds: ["all"], checked: true });
    const result = await updateStatus(root, { id: "FR-ARCH-001", status: "verified" });
    expect(result.ok).toBe(false);
  });

  it("appends a Change Notes row when reason is provided (v1.1.0 §30.3)", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const root = await resolveProjectRoot(rootPath);
    const result = await updateStatus(root, { id: "FR-ARCH-001", status: "blocked", reason: "Waiting on upstream review" });
    expect(result.ok).toBe(true);
    const file = await readFile(path.join(rootPath, "docs", "spec", "10.product-architecture.srs.md"), "utf8");
    expect(file).toContain("| Status | blocked |");
    expect(file).toMatch(/\|\s*\d{4}-\d{2}-\d{2}\s*\|\s*Status -> blocked\s*\|\s*Waiting on upstream review\s*\|/);
  });

  it("does not touch Change Notes when reason is omitted", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const root = await resolveProjectRoot(rootPath);
    const before = await readFile(path.join(rootPath, "docs", "spec", "10.product-architecture.srs.md"), "utf8");
    const result = await updateStatus(root, { id: "FR-ARCH-001", status: "blocked" });
    expect(result.ok).toBe(true);
    const after = await readFile(path.join(rootPath, "docs", "spec", "10.product-architecture.srs.md"), "utf8");
    const changeNotesBefore = before.split("\n").filter((line) => /Status ->/.test(line)).length;
    const changeNotesAfter = after.split("\n").filter((line) => /Status ->/.test(line)).length;
    expect(changeNotesAfter).toBe(changeNotesBefore);
  });

  it("rejects reason longer than 500 UTF-16 code units", async () => {
    const root = await resolveProjectRoot(await copyFixtureWorkspace("mutation-target"));
    const result = await updateStatus(root, { id: "FR-ARCH-001", status: "blocked", reason: "x".repeat(501) });
    expect(result.ok).toBe(false);
  });

  it("rejects reason containing forbidden control characters", async () => {
    const root = await resolveProjectRoot(await copyFixtureWorkspace("mutation-target"));
    const result = await updateStatus(root, { id: "FR-ARCH-001", status: "blocked", reason: "bad\x00null" });
    expect(result.ok).toBe(false);
  });

  it("accepts reason with TAB / LF / CR (Windows CRLF friendly)", async () => {
    const root = await resolveProjectRoot(await copyFixtureWorkspace("mutation-target"));
    const result = await updateStatus(root, { id: "FR-ARCH-001", status: "blocked", reason: "line1\r\nline2\tcol" });
    expect(result.ok).toBe(true);
  });

  it("dry-run with reason returns ok but writes nothing", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const root = await resolveProjectRoot(rootPath);
    const before = await readFile(path.join(rootPath, "docs", "spec", "10.product-architecture.srs.md"), "utf8");
    const result = await updateStatus(root, { id: "FR-ARCH-001", status: "blocked", reason: "dry-only", dryRun: true });
    expect(result.ok).toBe(true);
    const after = await readFile(path.join(rootPath, "docs", "spec", "10.product-architecture.srs.md"), "utf8");
    expect(after).toBe(before);
  });

  it("applies SRS-MD-Rules v1.1.0 §30.1 [DISCARDED] marker when transitioning to discarded", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const root = await resolveProjectRoot(rootPath);
    const result = await updateStatus(root, { id: "FR-ARCH-001", status: "discarded", reason: "merged into FR-ARCH-002" });
    expect(result.ok).toBe(true);
    const file = await readFile(path.join(rootPath, "docs", "spec", "10.product-architecture.srs.md"), "utf8");
    expect(file).toContain("### ~~FR-ARCH-001 — Mutable requirement~~ [DISCARDED]");
    expect(file).toContain("| Status | discarded |");
  });

  it("removes [DISCARDED] marker on revival (discarded -> implemented)", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const root = await resolveProjectRoot(rootPath);
    await updateStatus(root, { id: "FR-ARCH-001", status: "discarded" });
    await setAcceptanceCriteriaChecked(root, { id: "FR-ARCH-001", acIds: ["all"], checked: true });
    const result = await updateStatus(root, { id: "FR-ARCH-001", status: "implemented" });
    expect(result.ok).toBe(true);
    const file = await readFile(path.join(rootPath, "docs", "spec", "10.product-architecture.srs.md"), "utf8");
    expect(file).toContain("### FR-ARCH-001 — Mutable requirement");
    expect(file).not.toContain("~~FR-ARCH-001");
    expect(file).not.toContain("[DISCARDED");
  });

  it("idempotent: re-applying discarded to an already-discarded heading does not duplicate marker", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const root = await resolveProjectRoot(rootPath);
    await updateStatus(root, { id: "FR-ARCH-001", status: "discarded" });
    await readFile(path.join(rootPath, "docs", "spec", "10.product-architecture.srs.md"), "utf8");
    await updateStatus(root, { id: "FR-ARCH-001", status: "discarded" });
    const after2 = await readFile(path.join(rootPath, "docs", "spec", "10.product-architecture.srs.md"), "utf8");
    const count = (after2.match(/\[DISCARDED]/g) ?? []).length;
    expect(count).toBe(1);
    // Status row only differs in append (no reason), heading is stable.
    expect(after2.split("\n").filter((l) => l.startsWith("### ~~FR-ARCH-001")).length).toBe(1);
  });

  it("decorates [DISCARDED] with → see Y when a single supersedes link exists (v1.1.0 §30.1)", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const root = await resolveProjectRoot(rootPath);
    const newReq = await addRequirement(root, {
      type: "functional",
      scope: "ARCH",
      target: "v1.0.0",
      title: "Successor of FR-ARCH-001",
      statement: "Replaces the original architecture requirement.",
      acceptanceCriteria: ["New AC text"],
      trace: [{ type: "Requirement", reference: "FR-ARCH-001", relation: "supersedes" }]
    });
    expect(newReq.ok).toBe(true);
    const successorId = (newReq.value as { requirementId: string }).requirementId;
    const result = await updateStatus(root, { id: "FR-ARCH-001", status: "discarded" });
    expect(result.ok).toBe(true);
    const file = await readFile(path.join(rootPath, "docs", "spec", "10.product-architecture.srs.md"), "utf8");
    expect(file).toContain(`### ~~FR-ARCH-001 — Mutable requirement~~ [DISCARDED → see ${successorId}]`);
  });

  it("decorates with +N when multiple supersedes links exist (v1.1.0 §30.1 FIRST + N)", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const root = await resolveProjectRoot(rootPath);
    const successors: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      const created = await addRequirement(root, {
        type: "functional",
        scope: "ARCH",
        target: "v1.0.0",
        title: `Successor ${index + 1}`,
        statement: `Replaces FR-ARCH-001 — variant ${index + 1}`,
        acceptanceCriteria: ["AC text"],
        trace: [{ type: "Requirement", reference: "FR-ARCH-001", relation: "supersedes" }]
      });
      expect(created.ok).toBe(true);
      successors.push((created.value as { requirementId: string }).requirementId);
    }
    const result = await updateStatus(root, { id: "FR-ARCH-001", status: "discarded" });
    expect(result.ok).toBe(true);
    const file = await readFile(path.join(rootPath, "docs", "spec", "10.product-architecture.srs.md"), "utf8");
    expect(file).toContain(`### ~~FR-ARCH-001 — Mutable requirement~~ [DISCARDED → see ${successors[0]} +2]`);
  });

  it("preserves legacy non-standard brackets in title across status transitions (T8)", async () => {
    // SUB_PARSER_WARNING_FIXTURES captures [TBD] as part of title. update-status must not strip such
    // legacy brackets — that is the responsibility of a follow-up title-residual sub-parser. We just
    // assert non-interference so authors are not surprised when their existing heading round-trips.
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const root = await resolveProjectRoot(rootPath);
    const filePath = path.join(rootPath, "docs", "spec", "10.product-architecture.srs.md");
    const original = await readFile(filePath, "utf8");
    // hand-write a legacy bracket into the heading line via a fresh fixture write
    const mutated = original.replace(
      "### FR-ARCH-001 — Mutable requirement",
      "### FR-ARCH-001 — Mutable requirement [LEGACY]"
    );
    await import("node:fs/promises").then((fs) => fs.writeFile(filePath, mutated, "utf8"));
    const result = await updateStatus(root, { id: "FR-ARCH-001", status: "blocked" });
    expect(result.ok).toBe(true);
    const after = await readFile(filePath, "utf8");
    expect(after).toContain("### FR-ARCH-001 — Mutable requirement [LEGACY]");
  });

  it("revives heading and parser still recognises the plain form", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const root = await resolveProjectRoot(rootPath);
    await updateStatus(root, { id: "FR-ARCH-001", status: "discarded" });
    await setAcceptanceCriteriaChecked(root, { id: "FR-ARCH-001", acIds: ["all"], checked: true });
    const revive = await updateStatus(root, { id: "FR-ARCH-001", status: "implemented" });
    expect(revive.ok).toBe(true);
    const file = await readFile(path.join(rootPath, "docs", "spec", "10.product-architecture.srs.md"), "utf8");
    // round-trip safety: heading line back to plain form, no marker artifacts left over
    expect(file).toMatch(/^### FR-ARCH-001 — Mutable requirement\s*$/m);
  });
});
