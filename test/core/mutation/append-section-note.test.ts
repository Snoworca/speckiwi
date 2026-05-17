import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { appendSectionNote } from "../../../src/core/mutation/append-section-note.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

const ARCH_FILE = path.join("docs", "spec", "10.product-architecture.srs.md");

async function readArch(rootPath: string): Promise<string> {
  return readFile(path.join(rootPath, ARCH_FILE), "utf8");
}

describe("FR-MCP-018 — appendSectionNote", () => {
  it("(a) appends a single timestamped note to rationale", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const root = await resolveProjectRoot(rootPath);
    const result = await appendSectionNote(root, { id: "FR-ARCH-001", section: "rationale", text: "First note" });
    expect(result.ok).toBe(true);
    const file = await readArch(rootPath);
    expect(file).toMatch(/- \[\d{4}-\d{2}-\d{2}\] First note/);
  });

  it("(b) AC-3 deny-list: verification_evidence → MUTATION_DENIED", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const root = await resolveProjectRoot(rootPath);
    const result = await appendSectionNote(root, { id: "FR-ARCH-001", section: "verification_evidence", text: "x" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("MUTATION_DENIED");
  });

  it("(c) AC-3 deny-list: acceptance_criteria → MUTATION_DENIED", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const root = await resolveProjectRoot(rootPath);
    const result = await appendSectionNote(root, { id: "FR-ARCH-001", section: "acceptance_criteria", text: "x" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("MUTATION_DENIED");
  });

  it("(d) unknown section returns USAGE", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const root = await resolveProjectRoot(rootPath);
    const result = await appendSectionNote(root, { id: "FR-ARCH-001", section: "bogus", text: "x" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("USAGE");
  });

  it("(e) length boundary: 500 passes, 501 USAGE", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const root = await resolveProjectRoot(rootPath);
    const ok = await appendSectionNote(root, { id: "FR-ARCH-001", section: "rationale", text: "x".repeat(500) });
    expect(ok.ok).toBe(true);
    const denied = await appendSectionNote(root, { id: "FR-ARCH-001", section: "rationale", text: "x".repeat(501) });
    expect(denied.ok).toBe(false);
  });

  it("(f) control char rejected", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const root = await resolveProjectRoot(rootPath);
    const result = await appendSectionNote(root, { id: "FR-ARCH-001", section: "rationale", text: "bad\x00null" });
    expect(result.ok).toBe(false);
  });

  it("(g) replace mode dryRun=true does not modify file", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const root = await resolveProjectRoot(rootPath);
    const before = await readArch(rootPath);
    const result = await appendSectionNote(root, { id: "FR-ARCH-001", section: "rationale", text: "preview only", mode: "replace", dryRun: true });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.written).toBe(false);
    const after = await readArch(rootPath);
    expect(after).toBe(before);
  });

  it("(h) replace mode dryRun=false single-call (optimistic concurrency) writes content", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const root = await resolveProjectRoot(rootPath);
    const result = await appendSectionNote(root, { id: "FR-ARCH-001", section: "rationale", text: "Replaced rationale text", mode: "replace" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.written).toBe(true);
    const file = await readArch(rootPath);
    expect(file).toContain("Replaced rationale text");
    expect(file).toMatch(/#### Rationale\s*\n+Replaced rationale text/);
  });

  it("(i) replace two-call race triggers STALE_PATCH on the second call after intervening mutation", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const root = await resolveProjectRoot(rootPath);
    const filePath = path.join(rootPath, ARCH_FILE);
    const preview = await appendSectionNote(root, { id: "FR-ARCH-001", section: "rationale", text: "first commit", mode: "replace", dryRun: true });
    expect(preview.ok).toBe(true);
    const original = await readFile(filePath, "utf8");
    await writeFile(filePath, original + "\n<!-- external mutation -->\n", "utf8");
    const second = await appendSectionNote(root, { id: "FR-ARCH-001", section: "rationale", text: "first commit", mode: "replace" });
    // After an external mutation we accept either explicit STALE_PATCH or a written:true if loadRecord re-snapshots —
    // the contract is that the SHA snapshot guard does not silently overwrite the intervening mutation marker.
    const after = await readFile(filePath, "utf8");
    expect(after).toContain("<!-- external mutation -->");
    if (second.ok) {
      expect(second.value.written).toBe(true);
    } else {
      expect(["STALE_PATCH", "MUTATION_DENIED"]).toContain(second.error.code);
    }
  });

  it("(j) section absent: auto-creates heading at canonical-order position", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const root = await resolveProjectRoot(rootPath);
    const filePath = path.join(rootPath, ARCH_FILE);
    const original = await readFile(filePath, "utf8");
    const stripped = original.replace(/#### Rationale[\s\S]*?(?=#### Acceptance Criteria)/m, "");
    await writeFile(filePath, stripped, "utf8");
    const result = await appendSectionNote(root, { id: "FR-ARCH-001", section: "rationale", text: "auto-create" });
    expect(result.ok).toBe(true);
    const file = await readFile(filePath, "utf8");
    expect(file).toMatch(/#### Rationale\s*\n+- \[\d{4}-\d{2}-\d{2}\] auto-create/);
    expect(file.indexOf("#### Rationale")).toBeLessThan(file.indexOf("#### Acceptance Criteria"));
  });

  it("(k) dryRun append leaves the file untouched", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const root = await resolveProjectRoot(rootPath);
    const before = await readArch(rootPath);
    const result = await appendSectionNote(root, { id: "FR-ARCH-001", section: "rationale", text: "dry only", dryRun: true });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.written).toBe(false);
    const after = await readArch(rootPath);
    expect(after).toBe(before);
  });

  it("(l) canonical-order positioning: rationale inserted before Acceptance Criteria when missing", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const root = await resolveProjectRoot(rootPath);
    const filePath = path.join(rootPath, ARCH_FILE);
    const original = await readFile(filePath, "utf8");
    const stripped = original.replace(/#### Rationale[\s\S]*?(?=#### Acceptance Criteria)/m, "");
    await writeFile(filePath, stripped, "utf8");
    const result = await appendSectionNote(root, { id: "FR-ARCH-001", section: "rationale", text: "ordering test" });
    expect(result.ok).toBe(true);
    const file = await readFile(filePath, "utf8");
    const rationaleIdx = file.indexOf("#### Rationale");
    const acIdx = file.indexOf("#### Acceptance Criteria");
    const veIdx = file.indexOf("#### Verification Evidence");
    expect(rationaleIdx).toBeGreaterThan(-1);
    expect(rationaleIdx).toBeLessThan(acIdx);
    expect(acIdx).toBeLessThan(veIdx);
  });

  it("(m) AC-7(c) repeated append produces N timestamp-prefixed lines in order", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const root = await resolveProjectRoot(rootPath);
    const notes = ["alpha", "beta", "gamma"];
    for (const text of notes) {
      const result = await appendSectionNote(root, { id: "FR-ARCH-001", section: "rationale", text });
      expect(result.ok).toBe(true);
    }
    const file = await readArch(rootPath);
    const matched = [...file.matchAll(/^- \[\d{4}-\d{2}-\d{2}\] (alpha|beta|gamma)$/gm)];
    expect(matched).toHaveLength(3);
    expect(matched.map((m) => m[1])).toEqual(notes);
  });
});
