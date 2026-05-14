import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
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
});
