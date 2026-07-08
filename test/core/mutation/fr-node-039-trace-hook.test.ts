import { execFile } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

// FR-NODE-054 — trace.mjs per-edit hook script mode-aware with per-writer shard
// and fail-open.
//
// Red-phase suite (T-PH003-45): one test case per acceptance criterion
// (AC-1..AC-6). The green task (T-PH003-46) installs the standalone hook
// script docs/.kiwi/hooks/trace.mjs, which Claude/Codex invoke as
//   node "$CLAUDE_PROJECT_DIR/docs/.kiwi/hooks/trace.mjs"
// feeding the hook payload on stdin. Because that script does not yet exist,
// spawning it makes every case fail (node exits non-zero on a missing module),
// so the whole suite is red until the green task creates the script.
//
// Contract under test (from the requirement body and AC, SSOT
// docs/spec/50.nodejs-implementation.srs.md#FR-NODE-054):
//   The installed docs/.kiwi/hooks/trace.mjs reads the hook payload on stdin,
//   reads work mode from state.md, and only when Mode is vibe appends one JSONL
//   record per edit to docs/.kiwi/trace/<ActiveTask>/trace.<sessionId>.jsonl,
//   branching on tool_name to read the Claude tool_input file path or to parse
//   the Codex apply_patch patch body for changed paths, treating any read or
//   parse failure or non-vibe mode as a safe no-op that never blocks the edit.
//     - AC-1: appends a record only when state.md Mode is vibe.
//     - AC-2: writes to a per-session shard trace.<sessionId>.jsonl under the
//             Active Task directory.
//     - AC-3: reads file paths from the Claude tool_input file path and from
//             the Codex apply_patch patch body.
//     - AC-4: a missing/unparseable state.md or non-vibe mode is a no-op that
//             never blocks the edit (exit 0, no record).
//     - AC-5: each appended JSONL line conforms to the contract fields ts,
//             agent, sessionId, optional turnId, tool, files, op, intentRef.
//     - AC-6: when Mode is vibe and Active Task is set but the task intent.md is
//             missing, it is a no-op that prints intent-recovery guidance and
//             never appends a record.

// The hook script lives at this fixed, installed location relative to the
// project root the script is run against (the requirement body and the
// FR-NODE-052/038 settings markers both pin docs/.kiwi/hooks/trace.mjs).
const HOOK_REL = path.join("docs", ".kiwi", "hooks", "trace.mjs");
const SPEC_STEPS_REL = path.join("docs", "spec", "steps");
const STATE_MD_REL = path.join(SPEC_STEPS_REL, "state.md");

/**
 * Result of spawning the installed trace.mjs hook against a project root.
 */
interface HookResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * Spawns the installed docs/.kiwi/hooks/trace.mjs against `root` exactly the way
 * the Claude/Codex PostToolUse hook does: node runs the script with the project
 * directory exported on CLAUDE_PROJECT_DIR / CODEX_PROJECT_DIR (and cwd set to
 * the root), with the hook payload written to the child's stdin. The child's
 * exit code, stdout, and stderr are captured. The hook MUST never throw a
 * non-zero exit for an edit, so callers assert exitCode === 0.
 */
function runTraceHook(root: string, payload: unknown): Promise<HookResult> {
  return new Promise((resolve, reject) => {
    const child = execFile(
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
    child.stdin?.end(typeof payload === "string" ? payload : JSON.stringify(payload));
  });
}

/**
 * Seeds docs/spec/steps/state.md with a top-of-file work-mode metadata block
 * (Mode / Active Task lines above the step-state table, matching the
 * FR-PARSE-026/FR-PARSE-031 layout). When `mode` is undefined the Mode line is
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
 * Creates the per-task intent.md under docs/spec/steps/<activeTask>/intent.md so
 * the trace hook can resolve a non-missing intent (its intentRef target).
 */
async function writeIntentMd(root: string, activeTask: string): Promise<void> {
  const taskDir = path.join(root, SPEC_STEPS_REL, activeTask);
  await mkdir(taskDir, { recursive: true });
  await writeFile(
    path.join(taskDir, "intent.md"),
    ["# Intent", "", "Polish the login screen.", ""].join("\n"),
    "utf8"
  );
}

/**
 * Reads every JSONL record from the per-session shard
 * docs/.kiwi/trace/<activeTask>/trace.<sessionId>.jsonl. Returns [] when the
 * shard file does not exist (the no-op contract).
 */
async function readShardRecords(
  root: string,
  activeTask: string,
  sessionId: string
): Promise<Array<Record<string, unknown>>> {
  const shard = path.join(
    root,
    "docs",
    ".kiwi",
    "trace",
    activeTask,
    `trace.${sessionId}.jsonl`
  );
  const raw = await readFile(shard, "utf8").catch(() => undefined);
  if (raw === undefined) {
    return [];
  }
  return raw
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

/**
 * Lists the trace files written under docs/.kiwi/trace/<activeTask>/, returning
 * [] when the directory was never created.
 */
async function listTraceDir(root: string, activeTask: string): Promise<string[]> {
  const dir = path.join(root, "docs", ".kiwi", "trace", activeTask);
  return readdir(dir).catch(() => [] as string[]);
}

/**
 * Builds a Claude-style PostToolUse payload: tool_name=Write and a tool_input
 * carrying the edited file path, plus session/turn identifiers.
 */
function claudePayload(opts: {
  sessionId: string;
  turnId?: string;
  filePath: string;
}): Record<string, unknown> {
  return {
    tool_name: "Write",
    session_id: opts.sessionId,
    ...(opts.turnId === undefined ? {} : { turn_id: opts.turnId }),
    tool_input: {
      file_path: opts.filePath,
      content: "console.log('edit');\n"
    }
  };
}

/**
 * Builds a Codex-style apply_patch payload: tool_name=apply_patch and a
 * tool_input carrying the raw patch body whose changed paths must be parsed.
 */
function codexApplyPatchPayload(opts: {
  sessionId: string;
  changedPath: string;
}): Record<string, unknown> {
  const patch = [
    "*** Begin Patch",
    `*** Update File: ${opts.changedPath}`,
    "@@",
    "-old line",
    "+new line",
    "*** End Patch",
    ""
  ].join("\n");
  return {
    tool_name: "apply_patch",
    session_id: opts.sessionId,
    tool_input: {
      input: patch
    }
  };
}

describe("FR-NODE-054 AC-1 — trace.mjs appends a record only when state.md Mode is vibe", () => {
  it("appends exactly one record when Mode is vibe", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    const sessionId = "sess-vibe-1";
    const activeTask = "polish-login";
    await writeStateMd(root, { mode: "vibe", activeTask });
    await writeIntentMd(root, activeTask);

    const result = await runTraceHook(
      root,
      claudePayload({ sessionId, filePath: "src/auth/login.ts" })
    );

    expect(result.exitCode).toBe(0);
    const records = await readShardRecords(root, activeTask, sessionId);
    expect(records).toHaveLength(1);
  });

  it("appends no record when Mode is sdd (non-vibe)", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    const sessionId = "sess-sdd-1";
    const activeTask = "polish-login";
    await writeStateMd(root, { mode: "sdd", activeTask });
    await writeIntentMd(root, activeTask);

    const result = await runTraceHook(
      root,
      claudePayload({ sessionId, filePath: "src/auth/login.ts" })
    );

    expect(result.exitCode).toBe(0);
    // No trace shard is created for a non-vibe mode.
    expect(await listTraceDir(root, activeTask)).toEqual([]);
  });
});

describe("FR-NODE-054 AC-2 — trace.mjs writes to a per-session shard trace.sessionId.jsonl under the Active Task directory", () => {
  it("isolates records from two sessions into two distinct per-session shards", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    const activeTask = "polish-login";
    await writeStateMd(root, { mode: "vibe", activeTask });
    await writeIntentMd(root, activeTask);

    await runTraceHook(
      root,
      claudePayload({ sessionId: "sess-A", filePath: "src/a.ts" })
    );
    await runTraceHook(
      root,
      claudePayload({ sessionId: "sess-B", filePath: "src/b.ts" })
    );

    const files = (await listTraceDir(root, activeTask)).sort();
    expect(files).toEqual(["trace.sess-A.jsonl", "trace.sess-B.jsonl"]);
    // Each writer's shard holds only its own record (no cross-writer interleave).
    expect(await readShardRecords(root, activeTask, "sess-A")).toHaveLength(1);
    expect(await readShardRecords(root, activeTask, "sess-B")).toHaveLength(1);
  });
});

describe("FR-NODE-054 AC-3 — trace.mjs reads file paths from the Claude tool_input file path and from the Codex apply_patch patch body", () => {
  it("records the Claude tool_input file path", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    const sessionId = "sess-claude";
    const activeTask = "polish-login";
    await writeStateMd(root, { mode: "vibe", activeTask });
    await writeIntentMd(root, activeTask);

    await runTraceHook(
      root,
      claudePayload({ sessionId, filePath: "src/auth/login.ts" })
    );

    const records = await readShardRecords(root, activeTask, sessionId);
    expect(records).toHaveLength(1);
    expect(records[0]?.files).toEqual(["src/auth/login.ts"]);
  });

  it("parses the changed path out of a Codex apply_patch patch body", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    const sessionId = "sess-codex";
    const activeTask = "polish-login";
    await writeStateMd(root, { mode: "vibe", activeTask });
    await writeIntentMd(root, activeTask);

    await runTraceHook(
      root,
      codexApplyPatchPayload({ sessionId, changedPath: "src/core/patched.ts" })
    );

    const records = await readShardRecords(root, activeTask, sessionId);
    expect(records).toHaveLength(1);
    expect(records[0]?.files).toEqual(["src/core/patched.ts"]);
  });
});

describe("FR-NODE-054 AC-4 — trace.mjs treats a missing or unparseable state.md or non-vibe mode as a no-op and never blocks the edit", () => {
  it("exits 0 and writes nothing when state.md is absent", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    const sessionId = "sess-missing-state";
    const activeTask = "polish-login";
    // Deliberately do NOT create docs/spec/steps/state.md.

    const result = await runTraceHook(
      root,
      claudePayload({ sessionId, filePath: "src/auth/login.ts" })
    );

    expect(result.exitCode).toBe(0);
    expect(await listTraceDir(root, activeTask)).toEqual([]);
  });

  it("exits 0 and writes nothing when state.md is unparseable garbage", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    const sessionId = "sess-garbage-state";
    const activeTask = "polish-login";
    await writeStateMd(root, { raw: "  not a state file at all " });

    const result = await runTraceHook(
      root,
      claudePayload({ sessionId, filePath: "src/auth/login.ts" })
    );

    expect(result.exitCode).toBe(0);
    expect(await listTraceDir(root, activeTask)).toEqual([]);
  });
});

describe("FR-NODE-054 AC-5 — each appended JSONL line conforms to the contract fields ts, agent, sessionId, optional turnId, tool, files, op, and intentRef", () => {
  it("emits a record carrying the full required contract field set", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    const sessionId = "sess-contract";
    const turnId = "turn-7";
    const activeTask = "polish-login";
    await writeStateMd(root, { mode: "vibe", activeTask });
    await writeIntentMd(root, activeTask);

    await runTraceHook(
      root,
      claudePayload({ sessionId, turnId, filePath: "src/auth/login.ts" })
    );

    const records = await readShardRecords(root, activeTask, sessionId);
    expect(records).toHaveLength(1);
    const record = records[0] ?? {};
    // Required fields.
    expect(typeof record.ts).toBe("string");
    expect(typeof record.agent).toBe("string");
    expect(record.sessionId).toBe(sessionId);
    expect(record.tool).toBe("Write");
    expect(record.files).toEqual(["src/auth/login.ts"]);
    expect(typeof record.op).toBe("string");
    // intentRef points at the active task's intent.md.
    expect(String(record.intentRef)).toContain(activeTask);
    // Optional turnId, when present in the payload, is propagated.
    expect(record.turnId).toBe(turnId);
  });
});

describe("FR-NODE-054 AC-6 — when Mode is vibe and Active Task is set but the task intent.md is missing, trace.mjs is a no-op and prints intent-recovery guidance, never appending a record", () => {
  it("appends no record and prints intent-recovery guidance when intent.md is missing", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    const sessionId = "sess-no-intent";
    const activeTask = "polish-login";
    await writeStateMd(root, { mode: "vibe", activeTask });
    // Deliberately do NOT create docs/spec/steps/polish-login/intent.md.

    const result = await runTraceHook(
      root,
      claudePayload({ sessionId, filePath: "src/auth/login.ts" })
    );

    expect(result.exitCode).toBe(0);
    // No record is appended (no shard created).
    expect(await listTraceDir(root, activeTask)).toEqual([]);
    // Intent-recovery guidance is surfaced to the operator.
    expect(`${result.stdout}${result.stderr}`.toLowerCase()).toContain("intent");
  });
});

// FND-002 — trace.mjs must contain every write under docs/.kiwi/trace. The
// Active Task (read from state.md) and the session id (from the JSON payload)
// were joined into a directory and file name without sanitization, so a value
// like "../../../escape" could mkdir/append outside the trace tree. Containment
// must hold whether the traversal rides on the Active Task or the session id.
describe("FND-002 — trace.mjs contains all writes within docs/.kiwi/trace (path-traversal safe)", () => {
  const TRACE_REL = path.join("docs", ".kiwi", "trace");

  /**
   * Writes a state.md with an Active Task containing a traversal segment. The
   * standard writeStateMd `Active Task:` capture is `(.+?)`, which preserves the
   * literal `../` sequence verbatim into the metadata block.
   */
  async function writeTraversalState(root: string, activeTask: string): Promise<void> {
    await writeStateMd(root, { mode: "vibe", activeTask });
  }

  /**
   * Recursively lists every regular file under `dir` as a path relative to it.
   * Returns [] when the directory does not exist.
   */
  async function listFilesRecursive(dir: string, base = dir): Promise<string[]> {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    const out: string[] = [];
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        out.push(...(await listFilesRecursive(full, base)));
      } else {
        out.push(path.relative(base, full));
      }
    }
    return out;
  }

  it("writes no trace record outside docs/.kiwi/trace when the Active Task carries a traversal segment", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    const escapeMarker = "fnd002-escape-task";
    const activeTask = `../../../${escapeMarker}`;
    await writeTraversalState(root, activeTask);
    // An attacker who controls state.md could also plant the intent.md gate file
    // at the traversed location; create it so the only remaining guard is path
    // containment, not the intent.md existence check.
    const traversedIntentDir = path.join(root, "docs", "spec", "steps", activeTask);
    await mkdir(traversedIntentDir, { recursive: true });
    await writeFile(path.join(traversedIntentDir, "intent.md"), "# Intent\n", "utf8");

    const result = await runTraceHook(
      root,
      claudePayload({ sessionId: "sess-trav-task", filePath: "src/a.ts" })
    );

    expect(result.exitCode).toBe(0);
    // No .jsonl trace shard may be written outside docs/.kiwi/trace. (The planted
    // intent.md is the test's own gate file, not a write performed by the hook.)
    const allFiles = await listFilesRecursive(root);
    const traceWritesOutside = allFiles.filter(
      (f) =>
        f.endsWith(".jsonl") &&
        !path.normalize(f).startsWith(`${path.normalize(TRACE_REL)}${path.sep}`)
    );
    expect(traceWritesOutside).toEqual([]);
  });

  it("writes no trace record outside docs/.kiwi/trace when the session id carries a traversal segment", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    const activeTask = "polish-login";
    await writeStateMd(root, { mode: "vibe", activeTask });
    await writeIntentMd(root, activeTask);

    const result = await runTraceHook(
      root,
      claudePayload({
        sessionId: "../../../fnd002-escape-session",
        filePath: "src/a.ts"
      })
    );

    expect(result.exitCode).toBe(0);
    // Every .jsonl shard must stay inside docs/.kiwi/trace; the traversing session
    // id must not place a file above the trace tree.
    const allFiles = await listFilesRecursive(root);
    const shardWritesOutside = allFiles.filter(
      (f) =>
        f.endsWith(".jsonl") &&
        !path.normalize(f).startsWith(`${path.normalize(TRACE_REL)}${path.sep}`)
    );
    expect(shardWritesOutside).toEqual([]);
  });
});

// FND-004 — Mode-line parsing parity with the core. The core parseStepStateMode
// is first-Mode-line-wins with a greedy capture; the hook used last-wins with a
// strict \S+ capture, so a state.md with two Mode lines (vibe then sdd) was read
// as vibe by the core but sdd by the hook. The hook must agree with the core:
// the first Mode line wins.
describe("FND-004 — trace.mjs Mode-line parsing matches the core (first Mode line wins)", () => {
  it("uses the first Mode line (vibe) when state.md carries multiple Mode lines", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    const sessionId = "sess-fnd004";
    const activeTask = "polish-login";
    await writeIntentMd(root, activeTask);
    // Two Mode lines: the core takes the first (vibe); a last-wins hook would
    // take the second (sdd) and skip the record.
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

    const result = await runTraceHook(
      root,
      claudePayload({ sessionId, filePath: "src/auth/login.ts" })
    );

    expect(result.exitCode).toBe(0);
    // First Mode line is vibe, so a record is appended (the core's contract).
    const records = await readShardRecords(root, activeTask, sessionId);
    expect(records).toHaveLength(1);
  });
});
