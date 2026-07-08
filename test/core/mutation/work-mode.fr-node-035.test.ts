import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { initProject } from "../../../src/core/bootstrap/init-project.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";
// The green task (T-PH003-38) introduces a new work-mode core exporting
// getWorkMode and setWorkMode in src/core/mutation/work-mode.ts. Importing the
// not-yet-existing module makes the whole suite red until the green task
// implements it.
import { getWorkMode, setWorkMode } from "../../../src/core/mutation/work-mode.js";

// FR-NODE-035 — Work mode model with get and set and fail-open default.
//
// Red-phase suite (T-PH003-37): one test case per acceptance criterion
// (AC-1..AC-4). These cases describe the future contract of getWorkMode /
// setWorkMode over docs/spec/steps/state.md before
// src/core/mutation/work-mode.ts exports them, so the whole suite fails
// (missing module/export) until the green task (T-PH003-38) implements it.
//
// Contract under test (from the requirement body and AC):
//   A work-mode core provides getWorkMode and setWorkMode over state.md, where
//   Mode is one of {sdd, vibe, wait} and Active Task names the current vibe task.
//     - AC-1: getWorkMode returns the persisted Mode and, for vibe, the Active Task.
//     - AC-2: getWorkMode returns wait when state.md is absent or invalid (fail-open).
//     - AC-3: setWorkMode persists Mode into the state.md metadata block.
//     - AC-4: setWorkMode to vibe persists the Active Task name alongside Mode.

const SPEC_DIR = path.join("docs", "spec");
const STATE_MD_REL = path.join(SPEC_DIR, "steps", "state.md");

/**
 * Writes a docs/spec/steps/state.md seeded with the supplied top-of-file
 * work-mode metadata block (Mode / Active Task lines above the step-state
 * table). Columns of the table match the FR-PARSE-023 layout
 * (Step, Status, DependsOn, TouchesScope, TouchesReq, Created, Updated).
 *
 * When `mode` is undefined the Mode line is omitted entirely so the
 * fail-open-to-wait path can be exercised. When `raw` is supplied it is
 * written verbatim (used to seed a malformed/unparseable metadata block).
 */
async function writeStateMd(
  root: string,
  opts: { mode?: string; activeTask?: string; raw?: string }
): Promise<void> {
  const stepsDir = path.join(root, SPEC_DIR, "steps");
  await mkdir(stepsDir, { recursive: true });
  if (opts.raw !== undefined) {
    await writeFile(path.join(stepsDir, "state.md"), opts.raw, "utf8");
    return;
  }
  const header = ["# Step State", ""];
  if (opts.mode !== undefined) {
    header.push(`Mode: ${opts.mode}`);
  }
  if (opts.activeTask !== undefined) {
    header.push(`Active Task: ${opts.activeTask}`);
  }
  header.push("");
  const content = [
    ...header,
    "| Step | Status | DependsOn | TouchesScope | TouchesReq | Created | Updated |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    "| feature-x | active | - | ARCH | FR-ARCH-001 | 2026-06-01 | 2026-06-02 |",
    ""
  ].join("\n");
  await writeFile(path.join(stepsDir, "state.md"), content, "utf8");
}

async function readStateMd(root: string): Promise<string> {
  return readFile(path.join(root, STATE_MD_REL), "utf8");
}

describe("FR-NODE-035 AC-1 — getWorkMode returns the persisted Mode and, for vibe, the Active Task", () => {
  it("returns the persisted non-vibe Mode read from the state.md metadata block", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    await writeStateMd(root, { mode: "sdd" });
    const projectRoot = await resolveProjectRoot(root);

    const result = await getWorkMode(projectRoot);

    expect(result.mode).toBe("sdd");
    // Active Task is only meaningful for vibe; it must be absent for sdd.
    expect(result.activeTask).toBeUndefined();
  });

  it("returns Mode=vibe together with the persisted Active Task name", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    await writeStateMd(root, { mode: "vibe", activeTask: "polish-login" });
    const projectRoot = await resolveProjectRoot(root);

    const result = await getWorkMode(projectRoot);

    expect(result.mode).toBe("vibe");
    expect(result.activeTask).toBe("polish-login");
  });
});

describe("FR-NODE-035 AC-2 — getWorkMode returns wait when state.md is absent or invalid (fail-open)", () => {
  it("returns Mode=wait without throwing when state.md is absent", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    // Deliberately do NOT create docs/spec/steps/state.md.
    const projectRoot = await resolveProjectRoot(root);

    const result = await getWorkMode(projectRoot);

    expect(result.mode).toBe("wait");
    expect(result.activeTask).toBeUndefined();
  });

  it("returns Mode=wait without throwing when the Mode value is outside {sdd, vibe, wait}", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    await writeStateMd(root, { mode: "bogus-mode" });
    const projectRoot = await resolveProjectRoot(root);

    const result = await getWorkMode(projectRoot);

    expect(result.mode).toBe("wait");
  });
});

describe("FR-NODE-035 AC-3 — setWorkMode persists Mode into the state.md metadata block", () => {
  it("rewrites the Mode value in the state.md metadata block so getWorkMode reads it back", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    await writeStateMd(root, { mode: "sdd" });
    const projectRoot = await resolveProjectRoot(root);

    const result = await setWorkMode(projectRoot, { mode: "wait" });

    expect(result.ok).toBe(true);
    const stateMd = await readStateMd(root);
    // The metadata block now records Mode: wait.
    expect(stateMd).toMatch(/^\s*Mode:\s*wait\s*$/m);
    // The persisted change is observable through the public read API.
    const reread = await getWorkMode(await resolveProjectRoot(root));
    expect(reread.mode).toBe("wait");
  });
});

describe("FR-NODE-035 AC-4 — setWorkMode to vibe persists the Active Task name alongside Mode", () => {
  it("persists both Mode=vibe and the Active Task name into the state.md metadata block", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    await writeStateMd(root, { mode: "sdd" });
    const projectRoot = await resolveProjectRoot(root);

    const result = await setWorkMode(projectRoot, {
      mode: "vibe",
      activeTask: "polish-login"
    });

    expect(result.ok).toBe(true);
    const stateMd = await readStateMd(root);
    expect(stateMd).toMatch(/^\s*Mode:\s*vibe\s*$/m);
    expect(stateMd).toMatch(/^\s*Active Task:\s*polish-login\s*$/m);
    // Both the Mode and the Active Task round-trip through the public read API.
    const reread = await getWorkMode(await resolveProjectRoot(root));
    expect(reread.mode).toBe("vibe");
    expect(reread.activeTask).toBe("polish-login");
  });
});

describe("FND-001 — setWorkMode to a non-vibe mode clears any stale Active Task line", () => {
  it("removes the persisted Active Task line when switching vibe -> wait so state.md is self-consistent", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    await writeStateMd(root, { mode: "vibe", activeTask: "T-OLD" });
    const projectRoot = await resolveProjectRoot(root);

    const result = await setWorkMode(projectRoot, { mode: "wait" });

    expect(result.ok).toBe(true);
    const stateMd = await readStateMd(root);
    // Mode flips to wait and the stale Active Task line must be gone: a `Mode: wait` block must not
    // co-exist with an `Active Task:` line, or vibe-gate would later evaluate a stale task.
    expect(stateMd).toMatch(/^\s*Mode:\s*wait\s*$/m);
    expect(stateMd).not.toMatch(/^\s*Active Task:/m);

    const reread = await getWorkMode(await resolveProjectRoot(root));
    expect(reread.mode).toBe("wait");
    expect(reread.activeTask).toBeUndefined();
  });

  it("removes the persisted Active Task line when switching vibe -> sdd", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    await writeStateMd(root, { mode: "vibe", activeTask: "T-OLD" });
    const projectRoot = await resolveProjectRoot(root);

    const result = await setWorkMode(projectRoot, { mode: "sdd" });

    expect(result.ok).toBe(true);
    const stateMd = await readStateMd(root);
    expect(stateMd).toMatch(/^\s*Mode:\s*sdd\s*$/m);
    expect(stateMd).not.toMatch(/^\s*Active Task:/m);

    const reread = await getWorkMode(await resolveProjectRoot(root));
    expect(reread.mode).toBe("sdd");
    expect(reread.activeTask).toBeUndefined();
  });
});

// FND-001 — init must scaffold state.md at the reader SSOT path
// (docs/spec/steps/state.md) with a parseable Mode line, so that getWorkMode /
// setWorkMode operate on a fresh repo instead of failing-open to wait and
// erroring NOT_FOUND. The prior scaffold targeted docs/.kiwi/state.md (a dead
// file no reader consults), leaving FR-NODE-035 inoperable after init.
describe("FND-001 — speckiwi init scaffolds a usable work-mode state.md at the reader SSOT path", () => {
  async function emptyRepo(): Promise<string> {
    const root = await mkdtemp(path.join(tmpdir(), "speckiwi-fnd001-"));
    await mkdir(path.join(root, ".git"));
    return root;
  }

  it("getWorkMode returns wait (not via the missing-file fallback) and setWorkMode persists vibe to docs/spec/steps/state.md", async () => {
    const rootPath = await emptyRepo();
    const init = await initProject(await resolveProjectRoot(rootPath), {});
    expect(init.ok).toBe(true);

    // The scaffold lives at the reader SSOT path, carrying a parseable Mode line.
    const stateMd = await readFile(
      path.join(rootPath, "docs", "spec", "steps", "state.md"),
      "utf8"
    );
    expect(stateMd).toMatch(/^\s*Mode:\s*wait\s*$/m);

    // getWorkMode reads the scaffolded Mode (wait), not the absent-file fallback.
    const initial = await getWorkMode(await resolveProjectRoot(rootPath));
    expect(initial.mode).toBe("wait");

    // setWorkMode succeeds (no NOT_FOUND) and persists into the same SSOT file.
    const set = await setWorkMode(await resolveProjectRoot(rootPath), {
      mode: "vibe",
      activeTask: "polish-login"
    });
    expect(set.ok).toBe(true);

    const reread = await getWorkMode(await resolveProjectRoot(rootPath));
    expect(reread.mode).toBe("vibe");
    expect(reread.activeTask).toBe("polish-login");
  });
});
