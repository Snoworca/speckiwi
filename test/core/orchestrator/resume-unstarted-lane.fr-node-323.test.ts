import { describe, expect, it } from "vitest";
import { computeResumeState, type GitFacts } from "../../../src/core/orchestrator/resume.js";
import { parseWavesJournal } from "../../../src/core/orchestrator/waves-journal.js";
import { emptyDriftInputs, emptyGitFacts, minimalCard } from "./resume-fixtures.js";
import { intent, journalRoot, result, waveVerify, type Json } from "./waves-fixtures.js";

// @req FR-NODE-323 — a lane branch still at its dispatch base is a lane never started, not a landed lane.
//
// OG (2026-11-22): a worker died right after start; its branch sat at the dispatch base with no commit,
// change or lock, and resume refused with journal-behind-git / landed-without-integrate-result.

const V14 = { schema_version: "1.4.0", engine: "kiwi-orchestrator", writer: "speckiwi-orchestrate/2.4.1" } as const;
const BASE = "e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3";
const SHORT = BASE.slice(0, 7);
const OTHER = "7bd41f0aa1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6";
const BRANCH = "kiwi/orch/run-a/w1s1/lane-1";
const TREE = "/w/lane-1";

async function view(lines: Json[]) {
  return parseWavesJournal(await journalRoot(lines), { runId: "run-a", engine: "kiwi-orchestrator" });
}

function dispatched(base: string | null): Json[] {
  const isolation = base === null ? {} : { isolation: { profile: "worktree-parallel", base_sha: base } };
  return [
    waveVerify(V14),
    intent("dispatch-lane", { stage: 1, lane: "lane-1" }),
    result("dispatch-lane", { stage: 1, lane: "lane-1", ...isolation })
  ];
}

function facts(overrides: { tip?: string; worktree?: GitFacts["worktrees"][number] | null; resolved?: Record<string, string>; witness?: boolean } = {}): GitFacts {
  const worktree = overrides.worktree === undefined ? { path: TREE, branch: BRANCH, locked: false, clean: true } : overrides.worktree;
  return emptyGitFacts({
    branches: [{ name: BRANCH, sha: overrides.tip ?? BASE, ancestorOfIntegration: true }],
    worktrees: worktree === null ? [] : [worktree],
    resolvedShas: overrides.resolved ?? { [BASE]: BASE, [SHORT]: BASE },
    integrationCommits: overrides.witness
      ? [{ commit: OTHER, trailers: { "Orch-Run": "run-a", "Orch-Wave": "1", "Orch-Stage": "1", "Orch-Lane": "lane-1" } }]
      : []
  });
}

async function lane(lines: Json[], gitFacts: GitFacts) {
  const state = computeResumeState(await view(lines), minimalCard(), gitFacts, emptyDriftInputs());
  return { state, entry: state.classification.find((item) => item.lane === "lane-1") };
}

describe("FR-NODE-323 AC-1 — a zero-commit, unlocked, clean lane at its base is dispatched again", () => {
  // @req FR-NODE-323 AC-1
  it("classifies not-dispatched with dispatch-lane and carries the base, branch and worktree", async () => {
    const { state, entry } = await lane(dispatched(BASE), facts());
    expect(entry?.klass).toBe("not-dispatched");
    expect(entry?.nextVerb).toBe("dispatch-lane");
    expect(state.blocking).toBeNull();
    expect(state.nextAction.verb).toBe("dispatch-lane");
    expect(state.nextAction.args).toEqual({ wave: 1, stage: 1, lane: "lane-1", base_sha: BASE, branch: BRANCH, worktree: TREE });
  });

  // @req FR-NODE-323 AC-1
  it("accepts a short base the facts resolve to the branch tip", async () => {
    const { state, entry } = await lane(dispatched(SHORT), facts());
    expect(entry?.klass).toBe("not-dispatched");
    expect(state.nextAction.args.base_sha).toBe(BASE);
  });

  // @req FR-NODE-323 AC-1
  it("re-dispatches a lane whose worktree was removed, with no worktree in the next action", async () => {
    const { state, entry } = await lane(dispatched(BASE), facts({ worktree: null }));
    expect(entry?.klass).toBe("not-dispatched");
    expect(state.blocking).toBeNull();
    expect(state.nextAction.args).toEqual({ wave: 1, stage: 1, lane: "lane-1", base_sha: BASE, branch: BRANCH });
  });

  // @req FR-NODE-323 AC-1
  it("reads the base of the lane's last dispatch-lane line, not an earlier one", async () => {
    const lines = [...dispatched(OTHER), intent("dispatch-lane", { stage: 1, lane: "lane-1" }), result("dispatch-lane", { stage: 1, lane: "lane-1", isolation: { base_sha: BASE } })];
    const { entry } = await lane(lines, facts({ resolved: { [BASE]: BASE, [OTHER]: OTHER } }));
    expect(entry?.klass).toBe("not-dispatched");
    const earlier = [...dispatched(BASE), intent("dispatch-lane", { stage: 1, lane: "lane-1" }), result("dispatch-lane", { stage: 1, lane: "lane-1", isolation: { base_sha: OTHER } })];
    expect((await lane(earlier, facts({ resolved: { [BASE]: BASE, [OTHER]: OTHER } }))).entry?.klass).toBe("journal-behind-git");
  });
});

describe("FR-NODE-323 AC-2 — every other case stays as it was", () => {
  // @req FR-NODE-323 AC-2
  it("a locked worktree stays lane-possibly-live", async () => {
    const { state, entry } = await lane(dispatched(BASE), facts({ worktree: { path: TREE, branch: BRANCH, locked: true, clean: true } }));
    expect(entry?.klass).toBe("lane-possibly-live");
    expect(state.blocking).toBe("interrupted-external-action");
  });

  const behind: Array<[string, Json[], GitFacts]> = [
    ["a merge witness on the integration branch", dispatched(BASE), facts({ witness: true })],
    ["uncommitted changes in the lane worktree", dispatched(BASE), facts({ worktree: { path: TREE, branch: BRANCH, locked: false, clean: false } })],
    ["a lane worktree with no known status", dispatched(BASE), facts({ worktree: { path: TREE, branch: BRANCH, locked: false } })],
    ["a last dispatch line with no base_sha", dispatched(null), facts()],
    ["a base the facts do not resolve", dispatched(SHORT), facts({ resolved: {} })],
    ["a tip past the base (a lane commit merged by --no-ff or fast-forward)", dispatched(BASE), facts({ tip: OTHER, resolved: { [BASE]: BASE, [OTHER]: OTHER } })]
  ];

  // @req FR-NODE-323 AC-2
  it.each(behind)("%s stays journal-behind-git", async (_name, lines, gitFacts) => {
    const { state, entry } = await lane(lines, gitFacts);
    expect(entry?.klass).toBe("journal-behind-git");
    expect(entry?.evidence).toEqual({ reason: "landed-without-integrate-result", branch: BRANCH, ...(gitFacts.integrationCommits?.length ? { mergeWitness: OTHER } : {}) });
    expect(state.blocking).toBe("ledger-reconciliation-divergent");
  });

  // @req FR-NODE-323 AC-2 — verification round 1: a worker whose HEAD left its branch keeps its work on
  // a detached worktree while the branch stays at the base (worktree-lane.md §2).
  it.each([
    ["holds a commit past the base", { path: "/w/detached", branch: null, locked: false, clean: true, head: OTHER }],
    ["holds an uncommitted change at the base", { path: "/w/detached", branch: null, locked: false, clean: false, head: BASE }],
    ["has no known status", { path: "/w/detached", branch: null, locked: false, head: BASE }]
  ])("a detached worktree that %s keeps the lane journal-behind-git", async (_name, detached) => {
    const gitFacts = facts();
    gitFacts.worktrees.push(detached as GitFacts["worktrees"][number]);
    expect((await lane(dispatched(BASE), gitFacts)).entry?.klass).toBe("journal-behind-git");
  });

  // @req FR-NODE-323 AC-2 — verification round 2: the worker's worktree moved to a branch that is no
  // lane's, which the lane-ref and detached checks both missed.
  it.each([
    ["holds a commit on another branch", { path: "/w/lane-1", branch: "wip", locked: false, clean: true, head: OTHER }],
    ["holds an uncommitted change on another branch at the base", { path: "/w/lane-1", branch: "wip", locked: false, clean: false, head: BASE }]
  ])("a worktree that %s keeps the lane journal-behind-git", async (_name, moved) => {
    expect((await lane(dispatched(BASE), facts({ worktree: moved as GitFacts["worktrees"][number] }))).entry?.klass).toBe("journal-behind-git");
  });

  // @req FR-NODE-323 AC-1
  it("the repository's own worktree and other lanes' worktrees do not hold the lane back", async () => {
    const gitFacts = facts();
    gitFacts.worktrees.push(
      { path: "/repo", branch: "main", locked: false, primary: true, head: OTHER },
      { path: "/w/lane-2", branch: "kiwi/orch/run-a/w1s1/lane-2", locked: false, clean: false, head: OTHER }
    );
    expect((await lane(dispatched(BASE), gitFacts)).entry?.klass).toBe("not-dispatched");
  });

  // @req FR-NODE-323 AC-1
  it("a clean detached worktree at the base does not hold the lane back", async () => {
    const gitFacts = facts();
    gitFacts.worktrees.push({ path: "/w/detached", branch: null, locked: false, clean: true, head: BASE });
    expect((await lane(dispatched(BASE), gitFacts)).entry?.klass).toBe("not-dispatched");
  });

  // @req FR-NODE-323 AC-2 — verification round 1: merging a zero-commit branch makes no commit and no
  // witness, so an integrated lane at its base was dispatched again.
  it("an integrated lane at its base stays lane-landed", async () => {
    const lines = [...dispatched(BASE), intent("integrate-lane", { stage: 1, lane: "lane-1" }), result("integrate-lane", { stage: 1, lane: "lane-1" })];
    const { state, entry } = await lane(lines, facts());
    expect(entry?.klass).toBe("lane-landed");
    expect(entry?.nextVerb).toBeNull();
    expect(state.nextAction.verb).toBeNull();
  });

  // @req FR-NODE-323 AC-2
  it("a lane with a terminal disposition at its base stays journal-behind-git", async () => {
    const lines = [...dispatched(BASE), result("dispatch-lane", { stage: 1, lane: "lane-1", isolation: { base_sha: BASE }, lane_disposition: { kind: "refuted" } })];
    const before = await lane(lines, emptyGitFacts({ branches: [{ name: BRANCH, sha: BASE, ancestorOfIntegration: true }] }));
    const after = await lane(lines, facts());
    expect(after.entry?.klass).toBe(before.entry?.klass);
    expect(after.entry?.klass).toBe("journal-behind-git");
  });

  // @req FR-NODE-323 AC-2
  it("a lane worktree whose clean flag is set but another lane's worktree is dirty is still judged by its own ref", async () => {
    const other = { path: "/w/lane-2", branch: "kiwi/orch/run-a/w1s1/lane-2", locked: false, clean: false };
    const gitFacts = facts();
    gitFacts.worktrees.push(other);
    expect((await lane(dispatched(BASE), gitFacts)).entry?.klass).toBe("not-dispatched");
  });
});
