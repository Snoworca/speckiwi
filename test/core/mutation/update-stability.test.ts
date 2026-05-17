import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { updateStability } from "../../../src/core/mutation/update-stability.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

const ARCH_FILE = path.join("docs", "spec", "10.product-architecture.srs.md");

describe("FR-PARSE-017 — updateStability", () => {
  it("AC-1: applies stable→frozen with reason in single transaction", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const root = await resolveProjectRoot(rootPath);
    const result = await updateStability(root, { id: "FR-ARCH-001", stability: "frozen", reason: "spec frozen for release" });
    expect(result.ok).toBe(true);
    const file = await readFile(path.join(rootPath, ARCH_FILE), "utf8");
    expect(file).toContain("| Stability | frozen |");
    expect(file).toMatch(/\|\s*\d{4}-\d{2}-\d{2}\s*\|\s*Stability -> frozen\s*\|\s*spec frozen for release\s*\|/);
  });

  it("AC-4: rejects frozen transition without reason", async () => {
    const root = await resolveProjectRoot(await copyFixtureWorkspace("mutation-target"));
    const result = await updateStability(root, { id: "FR-ARCH-001", stability: "frozen" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("USAGE");
  });

  it("AC-2: returns 'skip-forward' warning but applies mutation (stable→deprecated)", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const root = await resolveProjectRoot(rootPath);
    const result = await updateStability(root, { id: "FR-ARCH-001", stability: "deprecated" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.warnings).toContain("skip-forward");
    const file = await readFile(path.join(rootPath, ARCH_FILE), "utf8");
    expect(file).toContain("| Stability | deprecated |");
  });

  it("AC-8: dryRun=true does not modify the file", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const root = await resolveProjectRoot(rootPath);
    const before = await readFile(path.join(rootPath, ARCH_FILE), "utf8");
    const result = await updateStability(root, { id: "FR-ARCH-001", stability: "evolving", dryRun: true });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.written).toBe(false);
    const after = await readFile(path.join(rootPath, ARCH_FILE), "utf8");
    expect(after).toBe(before);
  });

  it("AC-7: rejects reason longer than 500 UTF-16 code units", async () => {
    const root = await resolveProjectRoot(await copyFixtureWorkspace("mutation-target"));
    const result = await updateStability(root, { id: "FR-ARCH-001", stability: "frozen", reason: "x".repeat(501) });
    expect(result.ok).toBe(false);
  });

  it("AC-7: rejects reason containing forbidden control characters", async () => {
    const root = await resolveProjectRoot(await copyFixtureWorkspace("mutation-target"));
    const result = await updateStability(root, { id: "FR-ARCH-001", stability: "frozen", reason: "bad\x00null" });
    expect(result.ok).toBe(false);
  });

  it("rejects invalid stability enum value", async () => {
    const root = await resolveProjectRoot(await copyFixtureWorkspace("mutation-target"));
    const result = await updateStability(root, { id: "FR-ARCH-001", stability: "bogus" as never });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("USAGE");
  });

  it("AC-5: stable→draft transition applies [DRAFT — pending decision] heading marker", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const root = await resolveProjectRoot(rootPath);
    const result = await updateStability(root, { id: "FR-ARCH-001", stability: "draft" });
    expect(result.ok).toBe(true);
    const file = await readFile(path.join(rootPath, ARCH_FILE), "utf8");
    expect(file).toContain("| Stability | draft |");
    expect(file).toMatch(/### FR-ARCH-001 — [^\n]+ \[DRAFT — pending decision\]/);
  });

  it("AC-6: draft→stable transition removes [DRAFT ...] heading marker", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const root = await resolveProjectRoot(rootPath);
    const firstDraft = await updateStability(root, { id: "FR-ARCH-001", stability: "draft" });
    expect(firstDraft.ok).toBe(true);
    const backToStable = await updateStability(root, { id: "FR-ARCH-001", stability: "stable" });
    expect(backToStable.ok).toBe(true);
    const file = await readFile(path.join(rootPath, ARCH_FILE), "utf8");
    expect(file).toContain("| Stability | stable |");
    expect(file).not.toMatch(/\[DRAFT/);
  });

  it("returns NOT_FOUND for missing requirement id", async () => {
    const root = await resolveProjectRoot(await copyFixtureWorkspace("mutation-target"));
    const result = await updateStability(root, { id: "FR-DOES-NOT-EXIST", stability: "draft" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("NOT_FOUND");
  });
});
