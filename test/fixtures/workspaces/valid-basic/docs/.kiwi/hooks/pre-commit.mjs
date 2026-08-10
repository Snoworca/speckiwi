#!/usr/bin/env node
// @req FR-NODE-040
//
// pre-commit.mjs — local best-effort gate for unsynthesized vibe trace.
//
// .git/hooks/pre-commit invokes this script as
//   node "$CLAUDE_PROJECT_DIR/docs/.kiwi/hooks/pre-commit.mjs"
// against the repository root. It reads the work mode from
// docs/spec/steps/state.md and blocks the commit (non-zero exit) only when Mode
// is vibe and an Active Task is set but the matching per-task step SRS directory
// docs/spec/steps/<ActiveTask>/ does not yet exist (unsynthesized). On a block it
// prints guidance to run the synthesis skill. Every other situation exits zero.
//
// Best-effort contract: a missing or unparseable state.md, a non-vibe mode, no
// active task, or a synthesized active task is a safe pass that exits 0. Any
// unexpected read/parse failure fails open (exit 0) so the gate never blocks a
// commit for the wrong reason; it is documented as bypassable.

import { readFileSync, statSync } from "node:fs";
import path from "node:path";

/** Resolves the project root the hook runs against. */
function resolveProjectRoot() {
  return (
    process.env.CLAUDE_PROJECT_DIR ||
    process.env.CODEX_PROJECT_DIR ||
    process.cwd()
  );
}

/**
 * Parses the Mode and Active Task from the state.md metadata block (the lines
 * above the step-state table). Mirrors the work-mode core: a "Mode:" / "Active
 * Task:" line carries the value. Returns { mode: "wait" } when absent/invalid.
 */
function readWorkMode(root) {
  const stateMd = path.join(root, "docs", "spec", "steps", "state.md");
  let raw;
  try {
    raw = readFileSync(stateMd, "utf8");
  } catch {
    return { mode: "wait" };
  }
  let mode;
  let activeTask;
  for (const line of raw.split(/\r?\n/)) {
    // Stop scanning the metadata block once the step-state table begins.
    if (/^\s*\|/.test(line)) {
      break;
    }
    // FND-004: match the core parseStepStateMode contract — first Mode/Active
    // Task line wins, with a greedy trimmed capture (not last-wins / strict \S+).
    const modeMatch = /^\s*Mode:\s*(.*)$/.exec(line);
    if (modeMatch && mode === undefined) {
      mode = modeMatch[1].trim();
      continue;
    }
    const activeMatch = /^\s*Active Task:\s*(.*)$/.exec(line);
    if (activeMatch && activeTask === undefined) {
      activeTask = activeMatch[1].trim();
    }
  }
  if (mode !== "sdd" && mode !== "vibe" && mode !== "wait") {
    return { mode: "wait" };
  }
  // The core exposes Active Task only for vibe and treats an empty value as absent.
  return mode === "vibe" && activeTask ? { mode, activeTask } : { mode };
}

/** Returns true when docs/spec/steps/<activeTask>/ exists as a directory. */
function stepDirExists(root, activeTask) {
  const taskDir = path.join(root, "docs", "spec", "steps", activeTask);
  try {
    return statSync(taskDir).isDirectory();
  } catch {
    return false;
  }
}

function main() {
  const root = resolveProjectRoot();
  const { mode, activeTask } = readWorkMode(root);

  // The gate only engages for an active vibe task; every other mode passes.
  if (mode !== "vibe" || !activeTask) {
    return 0;
  }

  // A matching step directory marks the active vibe task as synthesized.
  if (stepDirExists(root, activeTask)) {
    return 0;
  }

  // Unsynthesized active vibe task — block with synthesis guidance.
  process.stderr.write(
    `speckiwi: active vibe task "${activeTask}" is unsynthesized — no ` +
      `docs/spec/steps/${activeTask}/ step directory exists. Run the synthesis ` +
      `skill to synthesize the vibe trace into step SRS before committing ` +
      `(best-effort gate; bypass with git commit --no-verify).\n`
  );
  return 1;
}

let exitCode;
try {
  exitCode = main();
} catch {
  // Fail open: never block a commit for an unexpected internal failure.
  exitCode = 0;
}
process.exit(exitCode);
