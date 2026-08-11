import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_POLLUTION_SENTINELS, auditRepoAgainstBaseline, snapshotSentinels } from "./repo-hermeticity.js";

// Guards test-suite hermeticity: a test MUST operate on an isolated temp root, never on the
// real repository working tree. `auditRepoAgainstBaseline` is the primitive the suite-wide
// afterEach guard uses to turn a silent, racy "some test wrote SpecKiwi init/skill artifacts
// into the repo root" leak into a deterministic, named failure. The baseline argument is what
// keeps it from also flagging the developer's own install — see FR-NODE-184.

describe("auditRepoAgainstBaseline — repo working-tree hermeticity primitive", () => {
  it("reports nothing for a clean root with no init/skill artifacts", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "hermeticity-clean-"));
    const baseline = snapshotSentinels(root);

    expect(auditRepoAgainstBaseline(root, baseline)).toEqual({ added: [], modified: [] });
  });

  it("flags a root that a non-isolated test polluted with SpecKiwi init/skill artifacts", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "hermeticity-dirty-"));
    const baseline = snapshotSentinels(root);

    // Simulate a non-isolated test running a full `speckiwi init` against the repo root.
    await writeFile(path.join(root, ".mcp.json"), "{}\n", "utf8");
    await mkdir(path.join(root, "docs", "spec", "steps"), { recursive: true });
    await mkdir(path.join(root, ".claude", "skills"), { recursive: true });

    const { added, modified } = auditRepoAgainstBaseline(root, baseline);
    expect(added).toContain(".mcp.json");
    expect(added).toContain("docs/spec/steps");
    expect(added).toContain(".claude/skills");
    expect(added).not.toContain(".codex/hooks.json");
    expect(modified).toEqual([]);
  });

  it("exposes a non-empty sentinel list the suite-wide guard watches", () => {
    expect(Array.isArray(REPO_POLLUTION_SENTINELS)).toBe(true);
    expect(REPO_POLLUTION_SENTINELS.length).toBeGreaterThan(0);
    expect(REPO_POLLUTION_SENTINELS).toContain(".mcp.json");
  });
});
