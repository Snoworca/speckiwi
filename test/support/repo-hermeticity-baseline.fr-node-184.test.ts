import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { auditRepoAfterTest } from "./hermeticity-guard.js";
import {
  auditRepoAgainstBaseline,
  cleanupAddedPaths,
  snapshotSentinels
} from "./repo-hermeticity.js";

// @req FR-NODE-184
//
// The guard used to equate "sentinel path exists" with "the test that just ran created it".
// That is false in this repository, which dogfoods its own product: `.mcp.json`,
// `docs/spec/steps`, `.claude/skills` and `.codex/hooks.json` are permanent `speckiwi init`
// output and untracked, so the guard deleted them and blamed whichever test happened to run
// first. Every case below drives the audit functions directly (AC-7) against an isolated
// mkdtemp root — none of them touch the real repository.

const SENTINELS = [".mcp.json", "docs/spec/steps", ".claude/skills"] as const;

function digestOf(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

async function tempRoot(label: string): Promise<string> {
  return mkdtemp(path.join(tmpdir(), `hermeticity-${label}-`));
}

/** A root shaped like this repository: init output already present before any test runs. */
async function dogfoodedRoot(label: string): Promise<string> {
  const root = await tempRoot(label);
  await writeFile(path.join(root, ".mcp.json"), '{"mcpServers":{}}\n', "utf8");
  await mkdir(path.join(root, "docs", "spec", "steps"), { recursive: true });
  await writeFile(path.join(root, "docs", "spec", "steps", "state.md"), "# Step State\n\nMode: wait\n", "utf8");
  await mkdir(path.join(root, ".claude", "skills", "kiwi-srs"), { recursive: true });
  await writeFile(path.join(root, ".claude", "skills", "kiwi-srs", "SKILL.md"), "# kiwi-srs\n", "utf8");
  return root;
}

describe("FR-NODE-184 — hermeticity audit against a pre-suite baseline", () => {
  it("AC-1: a run that creates nothing is clean even though every sentinel already exists", async () => {
    const root = await dogfoodedRoot("ac1");
    const baseline = snapshotSentinels(root, SENTINELS);

    const audit = auditRepoAgainstBaseline(root, baseline, SENTINELS);

    expect(audit.added).toEqual([]);
    expect(audit.modified).toEqual([]);
  });

  it("AC-2: a sentinel absent from the baseline and present afterwards is added", async () => {
    const root = await tempRoot("ac2");
    const baseline = snapshotSentinels(root, SENTINELS);

    await writeFile(path.join(root, ".mcp.json"), "{}\n", "utf8");
    const audit = auditRepoAgainstBaseline(root, baseline, SENTINELS);

    expect(audit.added).toEqual([".mcp.json"]);
    expect(audit.modified).toEqual([]);
  });

  it("AC-3: a file created inside a sentinel directory the baseline held is added, named by its inner path", async () => {
    const root = await dogfoodedRoot("ac3");
    const baseline = snapshotSentinels(root, SENTINELS);

    // The exact shape a bad restore produced on 2026-08-11: a nested copy inside a
    // sentinel directory that already existed. Presence-only detection cannot see this.
    await mkdir(path.join(root, "docs", "spec", "steps", "steps"), { recursive: true });
    await writeFile(path.join(root, "docs", "spec", "steps", "steps", "state.md"), "nested\n", "utf8");

    const audit = auditRepoAgainstBaseline(root, baseline, SENTINELS);

    expect(audit.added).toEqual(["docs/spec/steps/steps/state.md"]);
    expect(audit.modified).toEqual([]);
  });

  it("AC-4: cleanup removes only added paths and leaves every baseline path byte-identical", async () => {
    const root = await dogfoodedRoot("ac4");
    const baseline = snapshotSentinels(root, SENTINELS);
    const mcpPath = path.join(root, ".mcp.json");
    const statePath = path.join(root, "docs", "spec", "steps", "state.md");
    const skillPath = path.join(root, ".claude", "skills", "kiwi-srs", "SKILL.md");
    const before = [digestOf(mcpPath), digestOf(statePath), digestOf(skillPath)];

    await mkdir(path.join(root, ".claude", "skills", "leaked"), { recursive: true });
    await writeFile(path.join(root, ".claude", "skills", "leaked", "SKILL.md"), "leak\n", "utf8");

    const audit = auditRepoAgainstBaseline(root, baseline, SENTINELS);
    const removed = cleanupAddedPaths(root, audit, baseline);

    expect(removed).toEqual([".claude/skills/leaked/SKILL.md"]);
    expect(existsSync(path.join(root, ".claude", "skills", "leaked", "SKILL.md"))).toBe(false);
    expect([digestOf(mcpPath), digestOf(statePath), digestOf(skillPath)]).toEqual(before);
  });

  it("AC-5: a baseline path whose content changed is reported as modified and is NOT deleted", async () => {
    const root = await dogfoodedRoot("ac5");
    const baseline = snapshotSentinels(root, SENTINELS);
    const mcpPath = path.join(root, ".mcp.json");

    await writeFile(mcpPath, '{"mcpServers":{"speckiwi":{}}}\n', "utf8");

    const audit = auditRepoAgainstBaseline(root, baseline, SENTINELS);
    expect(audit.modified).toEqual([".mcp.json"]);
    expect(audit.added).toEqual([]);

    const removed = cleanupAddedPaths(root, audit, baseline);
    expect(removed).toEqual([]);
    // Deleting it would destroy the only copy — the guard holds no backup to restore.
    expect(existsSync(mcpPath)).toBe(true);
    expect(readFileSync(mcpPath, "utf8")).toContain("speckiwi");
  });

  it("AC-7: the guard's own afterEach path spares the baseline and removes only the leak", async () => {
    // Drives the exported guard function rather than reading its source: a source scan
    // cannot show that the cleanup actually spares what the developer already had.
    const root = await dogfoodedRoot("ac7");
    const baseline = snapshotSentinels(root, SENTINELS);
    const statePath = path.join(root, "docs", "spec", "steps", "state.md");
    const stateBefore = digestOf(statePath);

    await writeFile(path.join(root, "docs", "spec", "steps", "leaked.md"), "leak\n", "utf8");

    const result = auditRepoAfterTest(root, baseline, 'test "x" in y.test.ts', SENTINELS);

    expect(result).not.toBeNull();
    expect(result?.removed).toEqual(["docs/spec/steps/leaked.md"]);
    expect(result?.detail).toContain("docs/spec/steps/leaked.md");
    expect(existsSync(path.join(root, "docs", "spec", "steps", "leaked.md"))).toBe(false);
    expect(digestOf(statePath)).toBe(stateBefore);
  });

  it("AC-7: the guard's afterEach path reports nothing when the run added nothing", async () => {
    const root = await dogfoodedRoot("ac7-clean");
    const baseline = snapshotSentinels(root, SENTINELS);

    expect(auditRepoAfterTest(root, baseline, 'test "x" in y.test.ts', SENTINELS)).toBeNull();
  });

  it("AC-6: with no baseline the audit reports what it found and cleanup deletes nothing", async () => {
    const root = await dogfoodedRoot("ac6");
    const mcpPath = path.join(root, ".mcp.json");

    const audit = auditRepoAgainstBaseline(root, null, SENTINELS);
    expect(audit.added).toContain(".mcp.json");

    const removed = cleanupAddedPaths(root, audit, null);
    expect(removed).toEqual([]);
    expect(existsSync(mcpPath)).toBe(true);
    expect(existsSync(path.join(root, ".claude", "skills", "kiwi-srs", "SKILL.md"))).toBe(true);
  });
});
