#!/usr/bin/env node
// @req FR-NODE-054 — the installed PostToolUse hook script at this exact path.
// (Was annotated FR-NODE-039, which is the compatibility-check pair and unrelated; the test
//  file name still carries that older number. Corrected 2026-08-10 under FR-NODE-183.)
//
// trace.mjs — per-edit PostToolUse trace hook (mode-aware, per-writer shard,
// fail-open).
//
// Claude/Codex invoke this script as
//   node "$CLAUDE_PROJECT_DIR/docs/.kiwi/hooks/trace.mjs"
// feeding the hook payload as JSON on stdin. It reads the work mode from
// docs/spec/steps/state.md and, only when Mode is vibe, appends exactly one JSONL
// record per edit to docs/.kiwi/trace/<ActiveTask>/trace.<sessionId>.jsonl. It
// branches on tool_name to read the Claude tool_input file path or to parse the
// Codex apply_patch patch body for changed paths.
//
// Fail-open contract: any read/parse failure, a missing or unparseable state.md,
// or a non-vibe mode is a safe no-op that exits 0 and never blocks the edit. The
// process therefore always exits 0.

import { appendFileSync, mkdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/** Reads the entire hook payload from stdin synchronously. */
function readStdin() {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

/** Resolves the project root the hook runs against. */
function resolveProjectRoot() {
  return (
    process.env.CLAUDE_PROJECT_DIR ||
    process.env.CODEX_PROJECT_DIR ||
    process.cwd()
  );
}

/**
 * FND-002 — true when `target` resolves to `base` itself or a path nested under
 * it. Used to keep every trace write contained within docs/.kiwi/trace even when
 * the Active Task (read from state.md) carries `..` traversal segments.
 */
function isContained(base, target) {
  const resolvedBase = path.resolve(base);
  const resolvedTarget = path.resolve(target);
  if (resolvedTarget === resolvedBase) {
    return true;
  }
  const rel = path.relative(resolvedBase, resolvedTarget);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
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

/**
 * Extracts the changed file paths and the agent/op descriptors from the hook
 * payload, branching on tool_name. Claude file tools carry tool_input.file_path;
 * the Codex apply_patch tool carries tool_input.input (a raw patch body).
 */
function extractEdit(payload) {
  const toolName = typeof payload.tool_name === "string" ? payload.tool_name : "";
  const toolInput =
    payload.tool_input && typeof payload.tool_input === "object" ? payload.tool_input : {};

  if (toolName === "apply_patch") {
    const patch = typeof toolInput.input === "string" ? toolInput.input : "";
    const files = [];
    for (const line of patch.split(/\r?\n/)) {
      const match = /^\*\*\*\s+(?:Add|Update|Delete) File:\s*(.+?)\s*$/.exec(line);
      if (match) {
        files.push(match[1]);
      }
    }
    return { agent: "codex", op: "apply_patch", files };
  }

  const filePath = typeof toolInput.file_path === "string" ? toolInput.file_path : "";
  return { agent: "claude", op: "edit", files: filePath ? [filePath] : [] };
}

function main() {
  const root = resolveProjectRoot();

  const stdin = readStdin();
  let payload;
  try {
    payload = JSON.parse(stdin);
  } catch {
    return; // unparseable payload — safe no-op.
  }
  if (!payload || typeof payload !== "object") {
    return;
  }

  const { mode, activeTask } = readWorkMode(root);
  // AC-1 / AC-4: only vibe mode records; everything else is a no-op.
  if (mode !== "vibe" || !activeTask) {
    return;
  }

  // AC-6: vibe with an Active Task but a missing task intent.md is a no-op that
  // surfaces intent-recovery guidance and appends no record.
  const intentPath = path.join(root, "docs", "spec", "steps", activeTask, "intent.md");
  try {
    statSync(intentPath);
  } catch {
    process.stdout.write(
      `speckiwi: no intent.md for active task "${activeTask}" — run the synthesis ` +
        `skill to recover the intent before continuing (skipped trace record).\n`
    );
    return;
  }

  const { agent, op, files } = extractEdit(payload);
  if (files.length === 0) {
    return; // nothing to trace — safe no-op.
  }

  // FND-002: the session id becomes part of the shard file name; restrict it to
  // a filename-safe charset so a value like "../../../escape" cannot traverse out
  // of the trace tree via the file name. Sanitize to [A-Za-z0-9._-], collapse any
  // remaining dot-only result, and fall back to "unknown".
  const rawSessionId =
    typeof payload.session_id === "string" && payload.session_id
      ? payload.session_id
      : "unknown";
  const sanitizedSessionId = rawSessionId.replace(/[^A-Za-z0-9._-]/g, "_");
  const sessionId = /[^.]/.test(sanitizedSessionId) ? sanitizedSessionId : "unknown";
  const tool = typeof payload.tool_name === "string" ? payload.tool_name : op;

  // AC-5: contract field set ts, agent, sessionId, optional turnId, tool, files,
  // op, intentRef.
  const record = {
    ts: new Date().toISOString(),
    agent,
    sessionId,
    tool,
    files,
    op,
    intentRef: path.posix.join("docs", "spec", "steps", activeTask, "intent.md")
  };
  if (typeof payload.turn_id === "string" && payload.turn_id) {
    record.turnId = payload.turn_id;
  }

  // AC-2 / FND-002: append to the per-session shard under the Active Task
  // directory, but never outside docs/.kiwi/trace. The Active Task (read from
  // state.md) is attacker-influenceable, so resolve the shard directory and file
  // and confirm both remain contained within the trace root before any write; a
  // traversal attempt is a safe no-op (fail-open).
  const traceRoot = path.resolve(root, "docs", ".kiwi", "trace");
  const shardDir = path.resolve(traceRoot, activeTask);
  const shardFile = path.resolve(shardDir, `trace.${sessionId}.jsonl`);
  if (!isContained(traceRoot, shardDir) || !isContained(traceRoot, shardFile)) {
    return; // traversal attempt — no-op.
  }
  mkdirSync(shardDir, { recursive: true });
  appendFileSync(shardFile, `${JSON.stringify(record)}\n`);
}

try {
  main();
} catch {
  // Fail-open: never block the edit.
}
process.exit(0);
