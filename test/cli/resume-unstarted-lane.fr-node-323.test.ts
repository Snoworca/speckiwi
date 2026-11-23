import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterAll, describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { resumeCardPath, type ResumeCard } from "../../src/core/orchestrator/resume-card.js";
import { frozenBlock, minimalCard } from "../core/orchestrator/resume-fixtures.js";
import { sdsWorkspace, writeUnder } from "../core/orchestrator/sds-fixtures.js";
import { pinResumeRunRoot } from "./support/resume-run-root.js";

// @req FR-NODE-323 AC-3 — `orchestrate resume` collects the full base sha and each lane worktree's
// cleanliness itself, so a lane that never started resumes with dispatch-lane in a real repository.

const created: string[] = [];

afterAll(async () => {
  for (const directory of created) await rm(directory, { recursive: true, force: true });
});

function git(root: string, ...args: string[]): string {
  return execFileSync("git", ["-C", root, "-c", "user.email=t@example.com", "-c", "user.name=t", ...args], { stdio: "pipe" }).toString().trim();
}

interface Answer {
  pointer?: string;
  gate?: string;
  violations?: Array<{ klass?: string }>;
  resume: { nextAction: { verb: string | null; args: { lane?: string; base_sha?: string; branch?: string; worktree?: string } } };
}

async function cli(argv: string[]): Promise<{ exit: number; payload: Answer }> {
  const pipes = { stdout: new PassThrough(), stderr: new PassThrough() };
  const exit = await main(argv, pipes);
  const text = pipes.stdout.read()?.toString() ?? "";
  return { exit, payload: text.length > 0 ? JSON.parse(text) : {} };
}

const RUN = "r1";
const LANE = `lane-${RUN}-wave-1`;
const BRANCH = `kiwi/orch/${RUN}/w1s1/${LANE}`;
const V20 = { schema_version: "2.0.0", run_id: RUN, engine: "kiwi-orchestrator", writer: "speckiwi-orchestrate/test" } as const;

/**
 * A run whose lane was dispatched from the seed commit and whose worker died before its first commit:
 * the run files are committed after the seed, so the integration head is one commit past the base.
 */
async function deadLaneRun(shortBase: boolean): Promise<{ root: string; base: string; worktree: string }> {
  const root = await sdsWorkspace([]);
  created.push(root);
  git(root, "init", "-q");
  expect(path.resolve(git(root, "rev-parse", "--show-toplevel")).toLowerCase()).toBe(path.resolve(realpathSync(root)).toLowerCase());
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "seed");
  const base = git(root, "rev-parse", "HEAD");
  const branch = git(root, "rev-parse", "--abbrev-ref", "HEAD");
  const written = shortBase ? base.slice(0, 7) : base;
  const lane = { ...V20, ts: "2026-11-22T00:00:00.000Z", wave: "wave-1", stage: 1, lane: LANE, verb: "dispatch-lane" };
  const journal = [
    { ...V20, ts: "2026-11-22T00:00:00.000Z", wave: "wave-1", order: 1, target: "5.7.1", status: "in_progress", summary: "in_progress" },
    { ...lane, event: "intent", inputs_digest: "sha256:in" },
    { ...lane, event: "result", isolation: { profile: "worktree-parallel", base_sha: written }, proof: { kind: "git-ref", ref: BRANCH } }
  ];
  await writeUnder(root, "waves/waves.json", JSON.stringify({ schema_version: "1.0.0", waves: [{ wave: "wave-1", files: ["src/w1.ts"], requirements: ["FR-ARCH-001"] }] }));
  await writeUnder(root, "existing.json", "[]");
  await writeUnder(root, "kiwi/waves.jsonl", `${journal.map((entry) => JSON.stringify(entry)).join("\n")}\n`);
  const scheduled = await cli(["--root", root, "orchestrate", "schedule", "waves", "--waves", "waves/waves.json", "--run-id", RUN, "--existing-paths", "existing.json", "--out", "waves/stage-1/lanes.lock.json", "--json"]);
  expect(scheduled.exit, JSON.stringify(scheduled.payload)).toBe(0);
  await writeUnder(root, "design-body.json", JSON.stringify({ design_items: [], integration_items: [], out_of_scope: [] }));
  const design = await cli(["--root", root, "orchestrate", "freeze", "design", "--body", "design-body.json", "--document", "docs/spec/00.index.md", "--head", base, "--run-id", RUN, "--out", "design/00.design.lock.json", "--json"]);
  expect(design.exit, JSON.stringify(design.payload)).toBe(0);
  const frozen = frozenBlock({ integration_branch: branch, design_lock: design.payload.pointer, waves_lock: undefined, lane_lock: { "wave-1": scheduled.payload.pointer } } as never);
  delete (frozen as Record<string, unknown>).waves_lock;
  const card = await pinResumeRunRoot(minimalCard({ run_id: RUN, frozen } as Partial<ResumeCard>), root);
  await writeUnder(root, resumeCardPath(RUN), `${JSON.stringify(card, null, 2)}\n`);
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "run files");
  const worktree = path.join(root, ".lanes", LANE);
  git(root, "worktree", "add", "-q", "-b", BRANCH, worktree, base);
  expect(git(root, "rev-parse", BRANCH)).toBe(base);
  return { root, base, worktree };
}

describe("FR-NODE-323 AC-3 — the tool collects the base and the lane worktree's status itself", () => {
  it.each([
    ["a short", true],
    ["a full", false]
  ])("resolves %s base_sha and resumes a clean zero-commit lane with dispatch-lane, refusing it once its worktree is dirty", async (_form, shortBase) => {
    const { root, base, worktree } = await deadLaneRun(shortBase as boolean);

    const resumed = await cli(["--root", root, "orchestrate", "resume", "--json"]);
    expect(resumed.exit, JSON.stringify(resumed.payload)).toBe(0);
    const next = resumed.payload.resume.nextAction;
    expect(next.verb).toBe("dispatch-lane");
    expect(next.args.lane).toBe(LANE);
    expect(next.args.base_sha).toBe(base);
    expect(next.args.branch).toBe(BRANCH);
    expect(path.resolve(next.args.worktree).toLowerCase()).toBe(path.resolve(realpathSync(worktree)).toLowerCase());

    await writeFile(path.join(worktree, "half-written.ts"), "export const x = 1;\n");
    const refused = await cli(["--root", root, "orchestrate", "resume", "--json"]);
    expect(refused.exit, JSON.stringify(refused.payload)).toBe(2);
    expect(refused.payload.gate).toBe("ledger-reconciliation-divergent");
    expect(refused.payload.violations?.[0]?.klass).toBe("journal-behind-git");

    git(root, "worktree", "remove", "--force", worktree);
  }, 120_000);

  // @req FR-NODE-323 AC-2 AC-3 — verification rounds 1 and 2: the worker's HEAD left the branch and its
  // commit sits on a detached worktree, or on a branch that is no lane's, while the branch stays at base.
  it.each([
    ["a detached worktree", ["checkout", "-q", "--detach"]],
    ["another branch", ["switch", "-q", "-c", "wip"]]
  ])("refuses a lane whose work sits on %s", async (_where, leave) => {
    const { root, worktree } = await deadLaneRun(false);
    git(worktree, ...(leave as string[]));
    await writeFile(path.join(worktree, "done.ts"), "export const done = true;\n");
    git(worktree, "add", "done.ts");
    git(worktree, "commit", "-q", "-m", "work", "-m", "REQ: FR-ARCH-001\nCommit-Kind: implementation");
    expect(git(root, "rev-parse", BRANCH)).not.toBe(git(worktree, "rev-parse", "HEAD"));

    const refused = await cli(["--root", root, "orchestrate", "resume", "--json"]);
    expect(refused.exit, JSON.stringify(refused.payload)).toBe(2);
    expect(refused.payload.gate).toBe("ledger-reconciliation-divergent");
    git(root, "worktree", "remove", "--force", worktree);
  }, 120_000);
});
