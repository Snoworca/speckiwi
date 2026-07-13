import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_POLLUTION_SENTINELS, detectRepoPollution } from "./repo-hermeticity.js";

// Guards test-suite hermeticity: a test MUST operate on an isolated temp root, never
// on the real repository working tree. `detectRepoPollution` is the primitive the
// suite-wide afterEach guard uses to turn a silent, racy "some test wrote SpecKiwi
// init/skill artifacts into the repo root" leak into a deterministic, named failure.

describe("detectRepoPollution — repo working-tree hermeticity primitive", () => {
  it("returns an empty list for a clean root with no init/skill artifacts", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "hermeticity-clean-"));
    expect(detectRepoPollution(root)).toEqual([]);
  });

  it("flags a root that a non-isolated test polluted with SpecKiwi init/skill artifacts", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "hermeticity-dirty-"));
    // Simulate a non-isolated test running a full `speckiwi init` against the repo root.
    await writeFile(path.join(root, ".mcp.json"), "{}\n", "utf8");
    await mkdir(path.join(root, "docs", "spec", "steps"), { recursive: true });
    await mkdir(path.join(root, ".claude", "skills"), { recursive: true });

    const hits = detectRepoPollution(root);
    expect(hits).toContain(".mcp.json");
    expect(hits).toContain("docs/spec/steps");
    expect(hits).toContain(".claude/skills");
    expect(hits).not.toContain(".codex/hooks.json");
  });

  it("exposes a non-empty sentinel list the suite-wide guard watches", () => {
    expect(Array.isArray(REPO_POLLUTION_SENTINELS)).toBe(true);
    expect(REPO_POLLUTION_SENTINELS.length).toBeGreaterThan(0);
    expect(REPO_POLLUTION_SENTINELS).toContain(".mcp.json");
  });
});
