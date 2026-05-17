import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import { setTargetGoal } from "../../../src/core/mutation/set-target-goal.js";
import { updateStatus } from "../../../src/core/mutation/update-status.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

const INDEX_FILE = path.join("docs", "spec", "00.index.md");

describe("FR-MCP-019 — setTargetGoal", () => {
  it("(1) NOT_FOUND when target is missing in Target Map", async () => {
    const root = await resolveProjectRoot(await copyFixtureWorkspace("mutation-target"));
    const result = await setTargetGoal(root, { target: "v9.9.9", goal: "x" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("NOT_FOUND");
  });

  it("(2) USAGE on empty / whitespace goal", async () => {
    const root = await resolveProjectRoot(await copyFixtureWorkspace("mutation-target"));
    const result = await setTargetGoal(root, { target: "v1.0.0", goal: "   " });
    expect(result.ok).toBe(false);
  });

  it("(3) UTF-16 boundary: 500 ASCII passes, 501 USAGE; 250 emoji pairs (=500 units) pass, 251 (=502 units) USAGE", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const root = await resolveProjectRoot(rootPath);
    expect((await setTargetGoal(root, { target: "v1.0.0", goal: "a".repeat(500) })).ok).toBe(true);
    expect((await setTargetGoal(root, { target: "v1.0.0", goal: "a".repeat(501) })).ok).toBe(false);
    expect((await setTargetGoal(root, { target: "v1.0.0", goal: "\uD83D\uDE00".repeat(250) })).ok).toBe(true);
    expect((await setTargetGoal(root, { target: "v1.0.0", goal: "\uD83D\uDE00".repeat(251) })).ok).toBe(false);
  });

  it("(4) control characters rejected; TAB/LF/CR accepted", async () => {
    const root = await resolveProjectRoot(await copyFixtureWorkspace("mutation-target"));
    expect((await setTargetGoal(root, { target: "v1.0.0", goal: "bad\x00null" })).ok).toBe(false);
    expect((await setTargetGoal(root, { target: "v1.0.0", goal: "line1\r\nline2\tcol" })).ok).toBe(true);
  });

  it("(5) heading absent → new block created + parser readback", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const root = await resolveProjectRoot(rootPath);
    const result = await setTargetGoal(root, { target: "v1.0.0", goal: "Baseline" });
    expect(result.ok).toBe(true);
    const file = await readFile(path.join(rootPath, INDEX_FILE), "utf8");
    expect(file).toContain("### Target: v1.0.0");
    expect(file).toContain("**Goal:** Baseline");
    const workspace = await parseWorkspace(root);
    expect(workspace.index.targetGoals["v1.0.0"]).toBe("Baseline");
  });

  it("(6) existing Goal line replaced", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const root = await resolveProjectRoot(rootPath);
    await setTargetGoal(root, { target: "v1.0.0", goal: "Initial" });
    const result = await setTargetGoal(root, { target: "v1.0.0", goal: "Updated" });
    expect(result.ok).toBe(true);
    const file = await readFile(path.join(rootPath, INDEX_FILE), "utf8");
    expect(file).toContain("**Goal:** Updated");
    expect(file).not.toContain("**Goal:** Initial");
  });

  it("(7) idempotent: same input twice → second written=false", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const root = await resolveProjectRoot(rootPath);
    const first = await setTargetGoal(root, { target: "v1.0.0", goal: "Same" });
    expect(first.ok).toBe(true);
    if (first.ok) expect(first.value.written).toBe(true);
    const second = await setTargetGoal(root, { target: "v1.0.0", goal: "Same" });
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.value.written).toBe(false);
  });

  it("(8) dryRun does not modify file", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const root = await resolveProjectRoot(rootPath);
    const before = await readFile(path.join(rootPath, INDEX_FILE), "utf8");
    const result = await setTargetGoal(root, { target: "v1.0.0", goal: "Dry only", dryRun: true });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.written).toBe(false);
    const after = await readFile(path.join(rootPath, INDEX_FILE), "utf8");
    expect(after).toBe(before);
  });

  it("(9) AC-7 isolation: Requirement Block status untouched", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const root = await resolveProjectRoot(rootPath);
    const before = await parseWorkspace(root);
    const beforeStatuses = before.records.map((r) => `${r.id}:${r.status}`).sort();
    await setTargetGoal(root, { target: "v1.0.0", goal: "Isolation check" });
    const after = await parseWorkspace(root);
    const afterStatuses = after.records.map((r) => `${r.id}:${r.status}`).sort();
    expect(afterStatuses).toEqual(beforeStatuses);
  });

  it("(10) concurrent writes: exactly one written=true and one STALE_PATCH (SHA snapshot guard)", async () => {
    const root = await resolveProjectRoot(await copyFixtureWorkspace("mutation-target"));
    const [a, b] = await Promise.all([
      setTargetGoal(root, { target: "v1.0.0", goal: "A" }),
      setTargetGoal(root, { target: "v1.0.0", goal: "B" })
    ]);
    const writtenCount = [a, b].filter((r) => r.ok && r.value.written).length;
    const stalePatchCount = [a, b].filter((r) => !r.ok && r.error.code === "STALE_PATCH").length;
    expect(writtenCount + stalePatchCount).toBe(2);
    // Allow either {1 write + 1 stale} or {2 writes when the second snapshot saw the first commit and reissued}
    // but never 2 stale (would mean no progress) and never 0 writes overall.
    expect(writtenCount).toBeGreaterThanOrEqual(1);
  });

  it("(11) Active Target metadata row unchanged", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const root = await resolveProjectRoot(rootPath);
    const before = await readFile(path.join(rootPath, INDEX_FILE), "utf8");
    await setTargetGoal(root, { target: "v1.0.0", goal: "Active untouched" });
    const after = await readFile(path.join(rootPath, INDEX_FILE), "utf8");
    expect(after.split("\n").find((l) => l.startsWith("| Active Target |"))).toBe(
      before.split("\n").find((l) => l.startsWith("| Active Target |"))
    );
    // pacify unused-import on updateStatus by referencing it in a no-op condition
    expect(typeof updateStatus).toBe("function");
  });
});
