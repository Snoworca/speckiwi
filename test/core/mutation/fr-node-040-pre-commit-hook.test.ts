import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

// FR-NODE-040 — pre-commit.mjs local best-effort gate for unsynthesized vibe
// trace.
//
// Red-phase suite (T-PH003-47): one test case per acceptance criterion
// (AC-1..AC-3). The green task (T-PH003-48) installs the standalone hook script
// docs/.kiwi/hooks/pre-commit.mjs, which .git/hooks/pre-commit invokes as
//   node "$CLAUDE_PROJECT_DIR/docs/.kiwi/hooks/pre-commit.mjs"
// against the repository root. Because that script does not yet exist, spawning
// it makes every case fail (node exits non-zero on a missing module entry
// point), so the whole suite is red until the green task creates the script.
//
// Contract under test (from the requirement body and AC, SSOT
// docs/spec/50.nodejs-implementation.srs.md#FR-NODE-040):
//   The installed docs/.kiwi/hooks/pre-commit.mjs, invoked from
//   .git/hooks/pre-commit, exits non-zero to block a commit when state.md Mode
//   is vibe and an Active Task is set but no corresponding step directory exists
//   (unsynthesized), printing guidance to run the synthesis skill, and exits
//   zero otherwise; it is documented as a best-effort local gate that can be
//   bypassed.
//     - AC-1: exits non-zero when Mode is vibe and Active Task is set with no
//             matching step directory.
//     - AC-2: exits zero once the matching step directory exists.
//     - AC-3: prints guidance to run the synthesis skill on block.
//
// The "matching step directory" is the per-task step SRS directory
// docs/spec/steps/<ActiveTask>/ that the synthesis engine (FR-NODE-041 AC-1/AC-2)
// writes; its existence marks the active vibe task as synthesized.

// The hook script lives at this fixed, installed location relative to the
// project root the script is run against (the requirement body pins
// docs/.kiwi/hooks/pre-commit.mjs).
const HOOK_REL = path.join("docs", ".kiwi", "hooks", "pre-commit.mjs");
const SPEC_STEPS_REL = path.join("docs", "spec", "steps");
const STATE_MD_REL = path.join(SPEC_STEPS_REL, "state.md");

/**
 * Result of spawning the installed pre-commit.mjs hook against a project root.
 */
interface HookResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * Spawns the installed docs/.kiwi/hooks/pre-commit.mjs against `root` exactly the
 * way the git pre-commit hook does: node runs the script with the project
 * directory exported on CLAUDE_PROJECT_DIR / CODEX_PROJECT_DIR and cwd set to the
 * root. The child's exit code, stdout, and stderr are captured. A blocked commit
 * MUST surface a non-zero exit; an allowed commit MUST exit zero.
 */
function runPreCommitHook(root: string): Promise<HookResult> {
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [path.join(root, HOOK_REL)],
      {
        cwd: root,
        env: {
          ...process.env,
          CLAUDE_PROJECT_DIR: root,
          CODEX_PROJECT_DIR: root
        },
        timeout: 15000
      },
      (error, stdout, stderr) => {
        if (error && typeof (error as { code?: unknown }).code !== "number") {
          // Spawn-level failure (e.g. node could not start at all).
          reject(error);
          return;
        }
        const exitCode =
          error && typeof (error as { code?: unknown }).code === "number"
            ? (error as { code: number }).code
            : 0;
        resolve({ exitCode, stdout: String(stdout), stderr: String(stderr) });
      }
    );
  });
}

/**
 * Seeds docs/spec/steps/state.md with a top-of-file work-mode metadata block
 * (Mode / Active Task lines above the step-state table, matching the
 * FR-PARSE-023/FR-PARSE-028 layout). When `mode` is undefined the Mode line is
 * omitted; when `raw` is supplied it is written verbatim (malformed block).
 */
async function writeStateMd(
  root: string,
  opts: { mode?: string; activeTask?: string; raw?: string }
): Promise<void> {
  const stepsDir = path.join(root, SPEC_STEPS_REL);
  await mkdir(stepsDir, { recursive: true });
  if (opts.raw !== undefined) {
    await writeFile(path.join(root, STATE_MD_REL), opts.raw, "utf8");
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
    "| polish-login | active | - | ARCH | FR-ARCH-001 | 2026-06-01 | 2026-06-02 |",
    ""
  ].join("\n");
  await writeFile(path.join(root, STATE_MD_REL), content, "utf8");
}

/**
 * Creates the per-task step SRS directory docs/spec/steps/<activeTask>/ with a
 * step SRS file, marking the active vibe task as synthesized (the state the
 * synthesis engine leaves behind, FR-NODE-041 AC-1).
 */
async function writeStepDir(root: string, activeTask: string): Promise<void> {
  const taskDir = path.join(root, SPEC_STEPS_REL, activeTask);
  await mkdir(taskDir, { recursive: true });
  await writeFile(
    path.join(taskDir, "00.index.md"),
    ["# Step SRS", "", "Synthesized step requirements.", ""].join("\n"),
    "utf8"
  );
}

describe("FR-NODE-040 AC-1 — pre-commit.mjs exits non-zero when Mode is vibe and Active Task is set with no matching step directory", () => {
  it("blocks the commit (non-zero exit) for an unsynthesized active vibe task", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    const activeTask = "polish-login";
    await writeStateMd(root, { mode: "vibe", activeTask });
    // Deliberately do NOT create docs/spec/steps/polish-login/ (unsynthesized).

    const result = await runPreCommitHook(root);

    // A blocked commit surfaces a non-zero exit code accompanied by the gate's
    // own guidance, distinguishing an intentional block from an unrelated crash.
    expect(result.exitCode).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`.toLowerCase()).toContain("synth");
  });
});

describe("FR-NODE-040 AC-2 — pre-commit.mjs exits zero once the matching step directory exists", () => {
  it("allows the commit (exit 0) once the active vibe task has been synthesized", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    const activeTask = "polish-login";
    await writeStateMd(root, { mode: "vibe", activeTask });
    // The matching step directory exists — the task has been synthesized.
    await writeStepDir(root, activeTask);

    const result = await runPreCommitHook(root);

    expect(result.exitCode).toBe(0);
  });

  it("allows the commit (exit 0) when Mode is not vibe (gate does not apply)", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    const activeTask = "polish-login";
    // Mode is sdd, so the unsynthesized-vibe gate never engages even without a
    // step directory.
    await writeStateMd(root, { mode: "sdd", activeTask });

    const result = await runPreCommitHook(root);

    expect(result.exitCode).toBe(0);
  });
});

// FND-004 — Mode-line parsing parity with the core. The core
// parseStepStateMode is first-Mode-line-wins; the hook used last-wins, so a
// state.md with two Mode lines (vibe then sdd) was read as vibe by the core but
// sdd by the hook. The gate must agree with the core: the first Mode line wins.
describe("FND-004 — pre-commit.mjs Mode-line parsing matches the core (first Mode line wins)", () => {
  it("blocks an unsynthesized vibe commit using the first Mode line when state.md carries multiple Mode lines", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    const activeTask = "polish-login";
    // First Mode line is vibe; a last-wins hook would read sdd and wrongly pass.
    const raw = [
      "# Step State",
      "",
      "Mode: vibe",
      `Active Task: ${activeTask}`,
      "Mode: sdd",
      "",
      "| Step | Status | DependsOn | TouchesScope | TouchesReq | Created | Updated |",
      "| --- | --- | --- | --- | --- | --- | --- |",
      "| polish-login | active | - | ARCH | FR-ARCH-001 | 2026-06-01 | 2026-06-02 |",
      ""
    ].join("\n");
    await writeStateMd(root, { raw });
    // Deliberately unsynthesized: no docs/spec/steps/polish-login/ directory.

    const result = await runPreCommitHook(root);

    // First Mode line is vibe + unsynthesized => the gate blocks (non-zero).
    expect(result.exitCode).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`.toLowerCase()).toContain("synth");
  });
});

describe("FR-NODE-040 AC-3 — pre-commit.mjs prints guidance to run the synthesis skill on block", () => {
  it("surfaces synthesis-skill guidance when it blocks an unsynthesized vibe commit", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    const activeTask = "polish-login";
    await writeStateMd(root, { mode: "vibe", activeTask });
    // Deliberately unsynthesized: no docs/spec/steps/polish-login/ directory.

    const result = await runPreCommitHook(root);

    // The block is accompanied by guidance pointing at the synthesis skill.
    expect(result.exitCode).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`.toLowerCase()).toContain("synth");
  });
});
