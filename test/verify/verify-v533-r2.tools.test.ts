import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";

// Independent verification, 5.3.3 round 2 — `speckiwi review-round check` over a real repository
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
  const index = path.join(os.tmpdir(), `verify-533-r2-index-${process.pid}-${Date.now()}`);
  const env = { GIT_INDEX_FILE: index };
  git(root, ["read-tree", "HEAD"], env);
  git(root, ["add", "-A"], env);
  const tree = git(root, ["write-tree"], env);
  await rm(index, { force: true });
  return tree;
}

/** The kept_tiers[] item shape of skills/claude/kiwi-review-fix-loop/SKILL.md §5, copied into rounds[].findings[]. */
function finding(id: string, tier: "block" | "record", introduced: number | null): Record<string, unknown> {
  return { id, tier, family: "f", introduced_by_round: introduced, family_action: null };
}

/** A rounds[] entry in the shape skills/claude/kiwi-review-fix-loop/SKILL.md §3.2 writes. */
function round(n: number, tree: string, files: string[], findings: unknown[]): Record<string, unknown> {
  return { round: n, tree_sha: tree, scope: n === 1 ? "full" : "since-prev", scope_widen_reason: null, files, tokens_used: 1000, residual_count: 0, coverage_passed: true, findings };
}

async function writeState(root: string, roundCap: number, rounds: unknown[]): Promise<void> {
  await mkdir(path.join(root, ".kiwi", "sessions", RUN), { recursive: true });
  await writeFile(path.join(root, STATE), JSON.stringify({ run_id: RUN, skill: "kiwi-review-fix-loop", limits: { round_cap: roundCap, token_budget: null }, rounds }), "utf8");
}

async function cli(root: string): Promise<{ code: number; stdout: string }> {
  const streams = { stdout: new PassThrough(), stderr: new PassThrough() };
  const code = await main(["--root", root, "review-round", "check", "--run-id", RUN, "--json"], streams);
  return { code, stdout: streams.stdout.read()?.toString() ?? "" };
}

async function repoWith(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "verify-533-r2-"));
  roots.push(root);
  git(root, ["init", "-q"]);
  for (const [name, text] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await writeFile(path.join(root, name), text, "utf8");
  }
  git(root, ["add", "-A"]);
  git(root, ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "base"]);
  return root;
}

describe("verify 5.3.3 r2 — review-round check", () => {
  // @req FR-NODE-274 AC-2
  // Input: src/core/review/code-file-class.ts — a real source file of this repository, deleted by round 1's fix.
  it("names a code file the round-1 fix deleted that round 2's files[] omits, and continues on scope", async () => {
    const source = await readFile(path.join(REPO_ROOT, "src", "core", "review", "code-file-class.ts"), "utf8");
    const root = await repoWith({ "src/core/review/code-file-class.ts": source, "a.ts": "export const a = 1;\n" });
    const first = await snapshot(root);
    await rm(path.join(root, "src", "core", "review", "code-file-class.ts"));
    const second = await snapshot(root);
    await writeState(root, 5, [round(1, first, ["a.ts", "src/core/review/code-file-class.ts"], [finding("FND-001", "block", null)]), round(2, second, [], [])]);
    const answer = await cli(root);
    expect(answer.code).toBe(0);
    const report = JSON.parse(answer.stdout) as { verdict: string; reasons: string[]; scope: { missingFiles: string[] } };
    expect(report.scope.missingFiles).toEqual(["src/core/review/code-file-class.ts"]);
    expect(report.verdict).toBe("CONTINUE");
    expect(report.reasons).toEqual(["scope"]);
  });

  // @req FR-NODE-274 AC-2 AC-3
  // Input: src/core/review/review-round.ts — a real source file of this repository, edited by round 1's fix.
  it("stops NEEDS_USER with scope among the reasons when a scope failure meets the earlier-round-fix majority", async () => {
    const source = await readFile(path.join(REPO_ROOT, "src", "core", "review", "review-round.ts"), "utf8");
    const root = await repoWith({ "src/core/review/review-round.ts": source });
    const first = await snapshot(root);
    await writeFile(path.join(root, "src", "core", "review", "review-round.ts"), `${source}// fixed\n`, "utf8");
    const second = await snapshot(root);
    await writeState(root, 5, [
      round(1, first, ["src/core/review/review-round.ts"], [finding("FND-001", "block", null)]),
      round(2, second, [], [finding("FND-002", "block", 1), finding("FND-003", "block", 1), finding("FND-004", "block", null)])
    ]);
    const report = JSON.parse((await cli(root)).stdout) as { verdict: string; reasons: string[]; counts: { block: number; blockIntroducedEarlier: number } };
    expect(report.verdict).toBe("NEEDS_USER");
    expect(report.reasons).toContain("scope");
    expect(report.reasons).toContain("earlier-fix-majority");
    expect(report.counts.block).toBe(3);
    expect(report.counts.blockIntroducedEarlier).toBe(2);
  });
});
