import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import { validateWorkspace } from "../../../src/core/validator/validate-workspace.js";
import { retarget } from "../../../src/core/mutation/retarget.js";
import { buildSrsStatusCache } from "../../../src/core/status-cache.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

// IR-CLI-112 — the requirement retarget half reuses the FR-NODE-059 retarget mutation. These
// cases pin what IR-CLI-112 adds: the Change Notes row names both targets, and the rewrite is
// limited to the Target field plus that row.

const SPEC = path.join("docs", "spec", "10.product-architecture.srs.md");

async function errorCodes(rootPath: string): Promise<string[]> {
  const workspace = await parseWorkspace(await resolveProjectRoot(rootPath));
  return [...workspace.diagnostics, ...validateWorkspace(workspace).diagnostics]
    .filter((item) => item.severity === "error")
    .map((item) => `${item.code}:${item.message}`)
    .sort();
}

describe("IR-CLI-112 requirement retarget", () => {
  // @req IR-CLI-112 AC-3
  it("AC-3: changes only the Target field and adds a Change Notes row naming the old and new target", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const root = await resolveProjectRoot(rootPath);
    const before = (await readFile(path.join(rootPath, SPEC), "utf8")).split("\n");

    const result = await retarget(root, { ids: ["FR-ARCH-001"], toTarget: "v1.1.0", reason: "Moved to the next release", dryRun: false });
    expect(result.ok).toBe(true);

    const after = (await readFile(path.join(rootPath, SPEC), "utf8")).split("\n");
    expect(after).toHaveLength(before.length + 1);
    const changed = after.filter((line) => !before.includes(line));
    const removed = before.filter((line) => !after.includes(line));
    expect(removed).toEqual(["| Target | v1.0.0 |"]);
    expect(changed).toHaveLength(2);
    expect(changed[0]).toBe("| Target | v1.1.0 |");
    expect(changed[1]).toMatch(/^\| \d{4}-\d{2}-\d{2} \| Target v1\.0\.0 -> v1\.1\.0 \| Moved to the next release \|$/);
  });

  // @req IR-CLI-112 AC-3
  it("AC-3: records the Change Notes row even when no reason is given", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const root = await resolveProjectRoot(rootPath);
    const result = await retarget(root, { ids: ["FR-ARCH-001"], toTarget: "v1.1.0", dryRun: false });
    expect(result.ok).toBe(true);
    const text = await readFile(path.join(rootPath, SPEC), "utf8");
    expect(text).toMatch(/\| \d{4}-\d{2}-\d{2} \| Target v1\.0\.0 -> v1\.1\.0 \| - \|/);
  });

  // @req IR-CLI-112 AC-4
  it("AC-4: validate reports no new errors after an applied retarget", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const root = await resolveProjectRoot(rootPath);
    const before = await errorCodes(rootPath);
    expect((await retarget(root, { ids: ["FR-ARCH-001"], toTarget: "v1.1.0", dryRun: false })).ok).toBe(true);
    expect(await errorCodes(rootPath)).toEqual(before);
  });

  // @req IR-CLI-112 AC-3
  it("AC-3: an applied retarget reports written and the lock wrapper refreshes the status cache from the new files", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const root = await resolveProjectRoot(rootPath);
    const result = await retarget(root, { ids: ["FR-ARCH-001"], toTarget: "v1.1.0", dryRun: false });
    expect(result.ok).toBe(true);
    if (!result.ok || !result.value) throw new Error("expected ok");
    expect(result.value.written).toBe(true);
    const cache = JSON.parse(await readFile(path.join(rootPath, "kiwi", ".status.json"), "utf8"));
    // The refresh after the write runs without lock metadata and fingerprints the retargeted files.
    expect(cache.lock.active).toBe(false);
    expect(cache.specFingerprint).toEqual(buildSrsStatusCache(await parseWorkspace(root)).specFingerprint);
  });

  // @req IR-CLI-112 AC-4
  it("AC-4: a dry-run retarget reports not written and leaves no status cache", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const root = await resolveProjectRoot(rootPath);
    const result = await retarget(root, { ids: ["FR-ARCH-001"], toTarget: "v1.1.0" });
    expect(result.ok).toBe(true);
    if (!result.ok || !result.value) throw new Error("expected ok");
    expect(result.value.written).toBe(false);
    expect(existsSync(path.join(rootPath, "kiwi", ".status.json"))).toBe(false);
  });
});
