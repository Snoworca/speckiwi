import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";

// Independent verification, 5.3.3 round 1 — `speckiwi review-round check` over a real repository
// built in a temporary directory with the skill's own snapshot method.

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const RUN = "kiwi-review-fix-loop-2026-11-06.speckiwi.self";
const STATE = `.kiwi/sessions/${RUN}/state.json`;
const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

function git(root: string, args: string[], env: Record<string, string> = {}): string {
  const clean = { ...process.env };
  for (const name of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR", "GIT_OBJECT_DIRECTORY"]) delete clean[name];
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8", env: { ...clean, ...env } }).trim();
}

/** skills/claude/kiwi-review-fix-loop/SKILL.md §6.3: read-tree HEAD, add -A, write-tree on a temporary index. */
async function snapshot(root: string): Promise<string> {
  const index = path.join(os.tmpdir(), `verify-533-index-${process.pid}-${Date.now()}`);
  const env = { GIT_INDEX_FILE: index };
  git(root, ["read-tree", "HEAD"], env);
  git(root, ["add", "-A"], env);
  const tree = git(root, ["write-tree"], env);
  await rm(index, { force: true });
  return tree;
}

/** A rounds[] entry in the shape skills/claude/kiwi-review-fix-loop/SKILL.md §3.2 writes. */
function round(n: number, tree: string, files: string[]): Record<string, unknown> {
  return {
    round: n,
    tree_sha: tree,
    scope: n === 1 ? "full" : "since-prev",
    scope_widen_reason: null,
    files,
    tokens_used: 1000,
    residual_count: 0,
    coverage_passed: true,
    findings: n === 1 ? [{ id: "FND-001", tier: "block", family: "f", introduced_by_round: null, family_action: null }] : []
  };
}

async function writeState(root: string, rounds: unknown[]): Promise<void> {
  await mkdir(path.join(root, ".kiwi", "sessions", RUN), { recursive: true });
  await writeFile(path.join(root, STATE), JSON.stringify({ run_id: RUN, skill: "kiwi-review-fix-loop", limits: { round_cap: 5, token_budget: null }, rounds }), "utf8");
}

async function cli(root: string): Promise<{ code: number; stdout: string }> {
  const streams = { stdout: new PassThrough(), stderr: new PassThrough() };
  const code = await main(["--root", root, "review-round", "check", "--run-id", RUN, "--json"], streams);
  return { code, stdout: streams.stdout.read()?.toString() ?? "" };
}

describe("verify 5.3.3 r1 — review-round check", () => {
  // @req FR-NODE-274 AC-2
  // Input: bin/speckiwi — this repository's extensionless Node source entry point (`#!/usr/bin/env node`).
  it("names an extensionless source script changed after round 1 that round 2's files[] omits", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "verify-533-"));
    roots.push(root);
    git(root, ["init", "-q"]);
    await mkdir(path.join(root, "bin"), { recursive: true });
    const entry = await readFile(path.join(REPO_ROOT, "bin", "speckiwi"), "utf8");
    await writeFile(path.join(root, "bin", "speckiwi"), entry, "utf8");
    await writeFile(path.join(root, "a.ts"), "export const a = 1;\n", "utf8");
    git(root, ["add", "-A"]);
    git(root, ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "base"]);
    const first = await snapshot(root);
    // round 1's fix edits the entry point
    await writeFile(path.join(root, "bin", "speckiwi"), `${entry}// fixed\n`, "utf8");
    const second = await snapshot(root);
    await writeState(root, [round(1, first, ["a.ts", "bin/speckiwi"]), round(2, second, [])]);

    const answer = await cli(root);
    expect(answer.code).toBe(0);
    const report = JSON.parse(answer.stdout) as { verdict: string; reasons: string[]; scope: { missingFiles: string[] } };
    expect(report.scope.missingFiles).toEqual(["bin/speckiwi"]);
    expect(report.verdict).toBe("CONTINUE");
    expect(report.reasons).toEqual(["scope"]);
  });
});
