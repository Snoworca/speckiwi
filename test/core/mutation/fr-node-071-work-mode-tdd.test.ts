import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getWorkMode, setWorkMode } from "../../../src/core/mutation/work-mode.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

// FR-NODE-071 — work-mode model supports the tdd mode.
//
// Red-phase suite: one test case per acceptance criterion (AC-1..AC-4). AC-1
// fails while getWorkMode only surfaces the Active Task for vibe, and AC-2
// fails while setWorkMode only persists the Active Task line for vibe.
//
// Contract under test (docs/spec/50.nodejs-implementation.srs.md FR-NODE-071):
//   - AC-1: getWorkMode returns {mode:"tdd", activeTask} from state.md.
//   - AC-2: setWorkMode({mode:"tdd", activeTask}) persists both lines.
//   - AC-3: switching from tdd to sdd/wait drops the stale Active Task line.
//   - AC-4: existing sdd/vibe/wait behavior is unchanged.

const STATE_PATH = path.join("docs", "spec", "steps", "state.md");

async function writeStateMd(root: string, options: { mode: string; activeTask?: string }): Promise<void> {
  const stepsDir = path.join(root, "docs", "spec", "steps");
  await mkdir(stepsDir, { recursive: true });
  const lines = [
    "# Step State",
    "",
    `Mode: ${options.mode}`,
    ...(options.activeTask !== undefined ? [`Active Task: ${options.activeTask}`] : []),
    "",
    "| Step | Status | DependsOn | TouchesScope | TouchesReq | Created | Updated |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    "| step-a | active | - | ARCH | - | 2026-06-01 | 2026-06-02 |",
    ""
  ];
  await writeFile(path.join(stepsDir, "state.md"), lines.join("\n"), "utf8");
}

describe("FR-NODE-071 work-mode model supports the tdd mode", () => {
  it("FR-NODE-071 AC-1: getWorkMode returns mode tdd with its Active Task", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");
    await writeStateMd(rootPath, { mode: "tdd", activeTask: "T-TDD-01" });
    const root = await resolveProjectRoot(rootPath);

    const workMode = await getWorkMode(root);
    expect(workMode.mode).toBe("tdd");
    expect(workMode.activeTask).toBe("T-TDD-01");
  });

  it("FR-NODE-071 AC-2: setWorkMode persists Mode and Active Task for tdd", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");
    await writeStateMd(rootPath, { mode: "sdd" });
    const root = await resolveProjectRoot(rootPath);

    const result = await setWorkMode(root, { mode: "tdd", activeTask: "T-TDD-02" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.mode).toBe("tdd");
      expect(result.value.activeTask).toBe("T-TDD-02");
    }

    const persisted = await readFile(path.join(rootPath, STATE_PATH), "utf8");
    expect(persisted).toMatch(/^\s*Mode:\s*tdd\s*$/m);
    expect(persisted).toMatch(/^\s*Active Task:\s*T-TDD-02\s*$/m);
  });

  it("FR-NODE-071 AC-3: switching from tdd to wait drops the stale Active Task line", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");
    await writeStateMd(rootPath, { mode: "tdd", activeTask: "T-TDD-03" });
    const root = await resolveProjectRoot(rootPath);

    const result = await setWorkMode(root, { mode: "wait" });
    expect(result.ok).toBe(true);

    const persisted = await readFile(path.join(rootPath, STATE_PATH), "utf8");
    expect(persisted).toMatch(/^\s*Mode:\s*wait\s*$/m);
    expect(persisted).not.toMatch(/^\s*Active Task:/m);
  });

  it("FR-NODE-071 AC-4: existing vibe Active Task behavior is unchanged", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");
    await writeStateMd(rootPath, { mode: "sdd" });
    const root = await resolveProjectRoot(rootPath);

    const result = await setWorkMode(root, { mode: "vibe", activeTask: "T-VIBE-01" });
    expect(result.ok).toBe(true);

    const persisted = await readFile(path.join(rootPath, STATE_PATH), "utf8");
    expect(persisted).toMatch(/^\s*Mode:\s*vibe\s*$/m);
    expect(persisted).toMatch(/^\s*Active Task:\s*T-VIBE-01\s*$/m);

    const workMode = await getWorkMode(root);
    expect(workMode).toEqual({ mode: "vibe", activeTask: "T-VIBE-01" });
  });
});
