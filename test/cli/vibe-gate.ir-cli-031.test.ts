import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

// IR-CLI-049 — speckiwi vibe-gate check CI subcommand.
//
// Red-phase suite (T-PH004-07): one test case per acceptance criterion
// (AC-1..AC-3). The green task (T-PH004-08) wires `speckiwi vibe-gate check`
// (src/cli/commands/mutations.ts, src/cli/index.ts) onto the core unsynthesized-
// vibe gate (src/core/mutation/internal.ts). Because that subcommand does not yet
// exist, commander rejects the unknown `vibe-gate` command and the suite is red
// until the green task registers it.
//
// Contract under test (from the requirement body and AC, SSOT
// docs/spec/30.cli-interface.srs.md IR-CLI-049):
//
//   The CLI exposes `speckiwi vibe-gate` with a check option which exits non-zero
//   when Mode is vibe and an Active Task is set without a corresponding
//   synthesized step directory, intended for wiring into a remote required status
//   check so that unsynthesized vibe commits are blocked where local hooks can be
//   bypassed.
//
//   - AC-1: `speckiwi vibe-gate check` exits non-zero for a vibe Active Task with
//           no synthesized step directory.
//   - AC-2: `speckiwi vibe-gate check` exits zero when no unsynthesized vibe task
//           exists.
//   - AC-3: The command is documented for use as a remote required status check.
//
// The "synthesized step directory" is the per-task step SRS directory
// docs/spec/steps/<ActiveTask>/ that the synthesis engine (FR-NODE-056 AC-1/AC-2)
// writes; its existence marks the active vibe task as synthesized. This mirrors
// the FR-NODE-055 pre-commit gate, exposed here as a CI-wireable subcommand.

function io() {
  return { stdout: new PassThrough() as NodeJS.WriteStream, stderr: new PassThrough() as NodeJS.WriteStream };
}

const SPEC_STEPS_REL = path.join("docs", "spec", "steps");
const STATE_MD_REL = path.join(SPEC_STEPS_REL, "state.md");

/** Reads everything a stream has buffered (the CLI writes synchronously before main resolves). */
function drain(stream: NodeJS.WriteStream): string {
  return (stream as unknown as PassThrough).read()?.toString() ?? "";
}

/**
 * Seeds docs/spec/steps/state.md with a top-of-file work-mode metadata block (the
 * Mode and, for vibe, the Active Task lines above the step-state table, matching
 * the FR-PARSE-026/FR-PARSE-031 layout). parseStepState reads these back, so this
 * is what `speckiwi vibe-gate check` resolves the current work mode from.
 */
async function writeStateMd(root: string, opts: { mode: string; activeTask?: string }): Promise<void> {
  const stepsDir = path.join(root, SPEC_STEPS_REL);
  await mkdir(stepsDir, { recursive: true });
  const header = ["# Step State", "", `Mode: ${opts.mode}`];
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
 * synthesis engine leaves behind, FR-NODE-056 AC-1).
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

describe("IR-CLI-049 — speckiwi vibe-gate check CI subcommand", () => {
  // AC-1: `speckiwi vibe-gate check` exits non-zero for a vibe Active Task with no
  // synthesized step directory.
  it("IR-CLI-049 AC-1: exits non-zero for a vibe Active Task with no synthesized step directory", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    const activeTask = "polish-login";
    await writeStateMd(root, { mode: "vibe", activeTask });
    // Deliberately do NOT create docs/spec/steps/polish-login/ (unsynthesized).

    // Control: the *synthesized* form of the very same command exits zero, proving
    // the subcommand is recognized. This distinguishes "exits non-zero because the
    // vibe gate blocked" (the AC) from "exits non-zero because vibe-gate check is
    // an unknown command".
    const okRoot = await copyFixtureWorkspace("valid-basic");
    await writeStateMd(okRoot, { mode: "vibe", activeTask });
    await writeStepDir(okRoot, activeTask);
    const okCode = await main(["--root", okRoot, "vibe-gate", "check"], io());
    expect(okCode).toBe(0);

    const streams = io();
    const code = await main(["--root", root, "vibe-gate", "check"], streams);

    // An unsynthesized active vibe task is blocked with a non-zero exit code.
    expect(code).not.toBe(0);
  });

  // AC-2: `speckiwi vibe-gate check` exits zero when no unsynthesized vibe task
  // exists. Covered in two ways: (a) the active vibe task has been synthesized, and
  // (b) Mode is not vibe so the gate never engages.
  it("IR-CLI-049 AC-2: exits zero when no unsynthesized vibe task exists", async () => {
    const activeTask = "polish-login";

    // (a) Synthesized: the matching step directory exists.
    const synthesized = await copyFixtureWorkspace("valid-basic");
    await writeStateMd(synthesized, { mode: "vibe", activeTask });
    await writeStepDir(synthesized, activeTask);
    expect(await main(["--root", synthesized, "vibe-gate", "check"], io())).toBe(0);

    // (b) Not vibe: the unsynthesized-vibe gate never engages even with no step dir.
    const sdd = await copyFixtureWorkspace("valid-basic");
    await writeStateMd(sdd, { mode: "sdd", activeTask });
    expect(await main(["--root", sdd, "vibe-gate", "check"], io())).toBe(0);
  });

  // AC-3: The command is documented for use as a remote required status check.
  // The subcommand help text describes its intended CI wiring as a required status
  // check, so the contract is discoverable from the CLI itself.
  it("IR-CLI-049 AC-3: documents use as a remote required status check", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    await writeStateMd(root, { mode: "wait" });

    const streams = io();
    const code = await main(["--root", root, "vibe-gate", "--help"], streams);

    // Help display is not an error (commander's exitOverride is caught as exit 0).
    expect(code).toBe(0);
    const help = drain(streams.stdout).toLowerCase();
    // The help documents the command's purpose as a (remote) required status check.
    expect(help).toContain("status check");
  });
});
