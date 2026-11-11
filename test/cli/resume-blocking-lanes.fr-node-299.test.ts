import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterAll, describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { resumeCardPath, type ResumeCard } from "../../src/core/orchestrator/resume-card.js";
import type { GitFacts } from "../../src/core/orchestrator/resume.js";
import { createMcpServer } from "../../src/mcp/server.js";
import { emptyDriftInputs, emptyGitFacts, frozenBlock, minimalCard } from "../core/orchestrator/resume-fixtures.js";
import { sdsWorkspace, writeUnder } from "../core/orchestrator/sds-fixtures.js";
import { pinResumeRunRoot } from "./support/resume-run-root.js";

// @req FR-NODE-299 — a resume refused by lane reconciliation lists the lanes that refused it and why.
//
// SSO-run-close-4908 (2026-11-11): `orchestrate resume --json` answered `interrupted-external-action`
// with `violations: []` while a lane worktree was locked by its running worker.

const created: string[] = [];

afterAll(async () => {
  for (const directory of created) await rm(directory, { recursive: true, force: true });
});

function git(root: string, ...args: string[]): string {
  return execFileSync("git", ["-C", root, "-c", "user.email=t@example.com", "-c", "user.name=t", ...args], { stdio: "pipe" }).toString().trim();
}

/** A fresh directory made a git repository first and checked to be its own top level. */
async function gitRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "speckiwi-fr-node-299-"));
  created.push(root);
  git(root, "init", "-q");
  expect(path.resolve(git(root, "rev-parse", "--show-toplevel"))).toBe(path.resolve(await import("node:fs").then((fs) => fs.realpathSync(root))));
  return root;
}

interface Refusal {
  exit: number;
  payload: { ok?: boolean; gate?: string; violations?: Array<Record<string, unknown>>; resume?: unknown };
}

async function cli(argv: string[]): Promise<Refusal> {
  const pipes = { stdout: new PassThrough(), stderr: new PassThrough() };
  const exit = await main(argv, pipes);
  const text = pipes.stdout.read()?.toString() ?? "";
  return { exit, payload: text.length > 0 ? JSON.parse(text) : {} };
}

const V20 = { schema_version: "2.0.0", run_id: "run-a", engine: "kiwi-orchestrator", writer: "speckiwi-orchestrate/test" } as const;
const VERIFY = { ...V20, wave: "wave-1", order: 1, target: "wave-1", phase: "wave-verify", status: "in_progress", summary: "verify", verification: { verdict: "pass" } };
const DISPATCH_INTENT = { ...V20, wave: "wave-1", stage: 1, lane: "lane-1", verb: "dispatch-lane", event: "intent", inputs_digest: "sha256:in" };
const DISPATCH_RESULT = { ...V20, wave: "wave-1", stage: 1, lane: "lane-1", verb: "dispatch-lane", event: "result", proof: { kind: "digest", ref: "sha256:x" } };

/** `orchestrate resume --facts` over a journal and injected facts, in a git-initialised root. */
async function resumeWithFacts(journal: Array<Record<string, unknown>>, gitFacts: GitFacts, driftInputs = emptyDriftInputs()): Promise<Refusal> {
  const root = await gitRoot();
  const put = async (relative: string, text: string) => {
    await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
    await writeFile(path.join(root, relative), text, "utf8");
  };
  await put("kiwi/waves.jsonl", `${journal.map((line) => JSON.stringify(line)).join("\n")}\n`);
  await put("card.json", JSON.stringify(await pinResumeRunRoot(minimalCard(), root)));
  await put("facts.json", JSON.stringify({ gitFacts, driftInputs }));
  return cli(["--root", root, "orchestrate", "resume", "--run-id", "run-a", "--card", "card.json", "--facts", "facts.json", "--json"]);
}

describe("FR-NODE-299 AC-1 — a locked lane worktree is named with its path and lock reason", () => {
  it("lists the lane from --facts, with the lock reason when the facts carry one", async () => {
    const worktree = { path: "/w/lane-1", branch: "kiwi/orch/run-a/w1s1/lane-1", locked: true, lockReason: "pid 1234" };
    const refused = await resumeWithFacts([VERIFY, DISPATCH_INTENT, DISPATCH_RESULT], emptyGitFacts({ worktrees: [worktree] as GitFacts["worktrees"] }));
    expect(refused.exit).toBe(2);
    expect(refused.payload.gate).toBe("interrupted-external-action");
    expect(refused.payload.violations).toEqual([
      {
        lane: "lane-1",
        wave: 1,
        stage: 1,
        klass: "lane-possibly-live",
        evidence: { reason: "locked-worktree", worktree: "/w/lane-1", lockReason: "pid 1234" }
      }
    ]);
  });

  it("names the worktree and git's lock reason when the tool collects the facts itself", async () => {
    const RUN = "r1";
    const LANE = `lane-${RUN}-wave-1`;
    const root = await sdsWorkspace([]);
    created.push(root);
    git(root, "init", "-q");
    expect(path.resolve(git(root, "rev-parse", "--show-toplevel")).toLowerCase()).toBe(path.resolve((await import("node:fs")).realpathSync(root)).toLowerCase());
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "seed");
    const branch = git(root, "rev-parse", "--abbrev-ref", "HEAD");
    const line = (n: number, status: string) => ({ ...V20, run_id: RUN, ts: "2026-11-11T00:00:00.000Z", wave: `wave-${n}`, order: n, target: "5.4.1", status, summary: status });
    await writeUnder(root, "waves/waves.json", JSON.stringify({ schema_version: "1.0.0", waves: [{ wave: "wave-1", files: ["src/w1.ts"], requirements: ["FR-ARCH-001"] }] }));
    await writeUnder(root, "existing.json", "[]");
    const dispatched = { ...DISPATCH_RESULT, run_id: RUN, lane: LANE };
    await writeUnder(root, "kiwi/waves.jsonl", `${[line(1, "in_progress"), dispatched].map((entry) => JSON.stringify(entry)).join("\n")}\n`);
    const scheduled = await cli(["--root", root, "orchestrate", "schedule", "waves", "--waves", "waves/waves.json", "--run-id", RUN, "--existing-paths", "existing.json", "--out", "waves/stage-1/lanes.lock.json", "--json"]);
    expect(scheduled.exit, JSON.stringify(scheduled.payload)).toBe(0);
    await writeUnder(root, "design-body.json", JSON.stringify({ design_items: [], integration_items: [], out_of_scope: [] }));
    const designFrozen = await cli(["--root", root, "orchestrate", "freeze", "design", "--body", "design-body.json", "--document", "docs/spec/00.index.md", "--head", git(root, "rev-parse", "HEAD"), "--run-id", RUN, "--out", "design/00.design.lock.json", "--json"]);
    expect(designFrozen.exit, JSON.stringify(designFrozen.payload)).toBe(0);
    const frozen = frozenBlock({ integration_branch: branch, design_lock: designFrozen.payload.pointer, waves_lock: undefined, lane_lock: { "wave-1": scheduled.payload.pointer } } as never);
    delete (frozen as Record<string, unknown>).waves_lock;
    const card = await pinResumeRunRoot(minimalCard({ run_id: RUN, frozen } as Partial<ResumeCard>), root);
    await writeUnder(root, resumeCardPath(RUN), `${JSON.stringify(card, null, 2)}\n`);
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "run files");

    const before = await cli(["--root", root, "orchestrate", "resume", "--json"]);
    expect(before.exit, JSON.stringify(before.payload)).toBe(0);

    // A worker's worktree, inside the temporary repository, locked the way an isolated agent locks it.
    const worktreePath = path.join(root, ".lanes", LANE);
    git(root, "worktree", "add", "-q", "-b", `kiwi/orch/${RUN}/w1s1/${LANE}`, worktreePath);
    git(root, "worktree", "lock", "--reason", "pid 4242", worktreePath);
    const refused = await cli(["--root", root, "orchestrate", "resume", "--json"]);
    expect(refused.exit, JSON.stringify(refused.payload)).toBe(2);
    expect(refused.payload.gate).toBe("interrupted-external-action");
    const entry = refused.payload.violations?.[0] as { lane: string; klass: string; evidence: { reason: string; worktree: string; lockReason?: string } };
    expect(entry.lane).toBe(LANE);
    expect(entry.klass).toBe("lane-possibly-live");
    expect(entry.evidence.reason).toBe("locked-worktree");
    expect(path.resolve(entry.evidence.worktree).toLowerCase()).toBe(path.resolve(worktreePath).toLowerCase());
    expect(entry.evidence.lockReason).toBe("pid 4242");
    git(root, "worktree", "unlock", worktreePath);
    git(root, "worktree", "remove", "--force", worktreePath);
  }, 120_000);

  it("answers the same through MCP orchestrate_resume", async () => {
    const root = await gitRoot();
    await mkdir(path.join(root, "kiwi"), { recursive: true });
    await writeFile(path.join(root, "kiwi/waves.jsonl"), `${[VERIFY, DISPATCH_INTENT, DISPATCH_RESULT].map((line) => JSON.stringify(line)).join("\n")}\n`);
    await writeFile(path.join(root, "card.json"), JSON.stringify(await pinResumeRunRoot(minimalCard(), root)));
    await writeFile(
      path.join(root, "facts.json"),
      JSON.stringify({ gitFacts: emptyGitFacts({ worktrees: [{ path: "/w/lane-1", branch: "kiwi/orch/run-a/w1s1/lane-1", locked: true }] }), driftInputs: emptyDriftInputs() })
    );
    const answer = await createMcpServer({ root }).callTool("orchestrate_resume", { runId: "run-a", card: "card.json", facts: "facts.json" });
    expect(JSON.stringify(answer)).toContain("\"klass\":\"lane-possibly-live\"");
    expect(JSON.stringify(answer)).toContain("\"reason\":\"locked-worktree\"");
  });
});

describe("FR-NODE-299 — the refusal lists only the lanes its gate came from", () => {
  it("leaves a landed lane out of an interrupted-external-action refusal raised by a locked one", async () => {
    const lane2 = { ...DISPATCH_RESULT, lane: "lane-2" };
    const refused = await resumeWithFacts(
      [VERIFY, DISPATCH_INTENT, DISPATCH_RESULT, lane2],
      emptyGitFacts({
        worktrees: [{ path: "/w/lane-1", branch: "kiwi/orch/run-a/w1s1/lane-1", locked: true }],
        branches: [{ name: "kiwi/orch/run-a/w1s1/lane-2", sha: "7bd41f0", ancestorOfIntegration: true }]
      })
    );
    expect(refused.payload.gate).toBe("interrupted-external-action");
    expect(refused.payload.violations?.map((entry) => [entry.lane, entry.klass])).toEqual([["lane-1", "lane-possibly-live"]]);
  });
});

describe("FR-NODE-299 AC-2 — an unattributed worktree during an unmatched intent names the verb and its line", () => {
  it("lists the interrupted verb, its journal line and the detached worktree", async () => {
    const refused = await resumeWithFacts([VERIFY, DISPATCH_INTENT], emptyGitFacts({ worktrees: [{ path: "/w/detached", branch: null, locked: false }] }));
    expect(refused.payload.gate).toBe("interrupted-external-action");
    expect(refused.payload.violations).toEqual([
      {
        lane: "lane-1",
        wave: 1,
        stage: 1,
        klass: "lane-possibly-live",
        evidence: { reason: "unmatched-external-intent", interruptedVerb: "dispatch-lane", journalLine: 2, detachedWorktrees: ["/w/detached"] }
      }
    ]);
  });
});

describe("FR-NODE-299 AC-3 — a divergent ledger names the lane and what diverged", () => {
  it("names the landed lane branch the journal has not integrated", async () => {
    const refused = await resumeWithFacts(
      [VERIFY, DISPATCH_RESULT],
      emptyGitFacts({ branches: [{ name: "kiwi/orch/run-a/w1s1/lane-1", sha: "7bd41f0", ancestorOfIntegration: true }] })
    );
    expect(refused.payload.gate).toBe("ledger-reconciliation-divergent");
    expect(refused.payload.violations).toEqual([
      {
        lane: "lane-1",
        wave: 1,
        stage: 1,
        klass: "journal-behind-git",
        evidence: { reason: "landed-without-integrate-result", branch: "kiwi/orch/run-a/w1s1/lane-1" }
      }
    ]);
  });

  it("names the merge witness commit when no lane branch shows the landing", async () => {
    const witness = { commit: "deadbeefcafe", trailers: { "Orch-Run": "run-a", "Orch-Wave": "1", "Orch-Stage": "1", "Orch-Lane": "lane-1" } };
    const refused = await resumeWithFacts([VERIFY, DISPATCH_RESULT], emptyGitFacts({ integrationCommits: [witness] }));
    expect(refused.payload.gate).toBe("ledger-reconciliation-divergent");
    expect(refused.payload.violations).toEqual([
      { lane: "lane-1", wave: 1, stage: 1, klass: "journal-behind-git", evidence: { reason: "landed-without-integrate-result", mergeWitness: "deadbeefcafe" } }
    ]);
  });

  it("names the disposition the journal could not read", async () => {
    const bad = { ...V20, wave: "wave-1", stage: 1, lane: "lane-1", verb: "collect-lane", event: "result", status: "complete", lane_disposition: { kind: "vanished", reason: "x" } };
    const refused = await resumeWithFacts([VERIFY, DISPATCH_RESULT, bad], emptyGitFacts());
    expect(refused.payload.gate).toBe("ledger-reconciliation-divergent");
    const entry = refused.payload.violations?.[0] as { klass: string; evidence: { reason: string; detail: string } };
    expect(entry.klass).toBe("divergent");
    expect(entry.evidence.reason).toBe("unreadable-disposition");
    expect(entry.evidence.detail).toContain("\"vanished\"");
  });
});

describe("FR-NODE-299 AC-4 — drift refusals and resumable runs keep their shape", () => {
  it("still lists drift digests when a drift gate outranks a locked lane", async () => {
    const drifted = emptyDriftInputs({ lockDigests: { ...emptyDriftInputs().lockDigests, design: "design/other.lock.json@sha256:0" } });
    const refused = await resumeWithFacts(
      [VERIFY, DISPATCH_INTENT, DISPATCH_RESULT],
      emptyGitFacts({ worktrees: [{ path: "/w/lane-1", branch: "kiwi/orch/run-a/w1s1/lane-1", locked: true }] }),
      drifted
    );
    expect(refused.payload.gate).toBe("run-invariant-drift");
    expect(refused.payload.violations?.every((entry) => typeof entry.index === "number" && entry.gate !== null)).toBe(true);
  });

  it("adds no evidence to a resumable run's classification", async () => {
    const resumed = await resumeWithFacts([VERIFY, DISPATCH_INTENT, DISPATCH_RESULT], emptyGitFacts());
    expect(resumed.exit, JSON.stringify(resumed.payload)).toBe(0);
    expect(JSON.stringify(resumed.payload.resume)).not.toContain("evidence");
  });
});

describe("FR-NODE-299 AC-5 — the skills say how the tool reports a locked lane worktree", () => {
  const files = ["claude", "codex", "etc"].flatMap((tree) => [
    `skills/${tree}/kiwi-orchestrator/SKILL.md`,
    `skills/${tree}/kiwi-wave-master/SKILL.md`,
    `skills/${tree}/_shared/kiwi/parallel-waves.md`,
    `skills/${tree}/_shared/kiwi/worktree-lane.md`,
    `skills/${tree}/_shared/kiwi/run-ledger.md`
  ]);
  it.each(files)("%s names the tool's answer for a locked lane worktree", async (relative) => {
    const text = (await readFile(path.join(process.cwd(), relative), "utf8")).replace(/\r\n/g, "\n");
    const sentence = text.split("\n").find((entry) => entry.includes("`orchestrate resume`") && entry.includes("`interrupted-external-action`") && entry.includes("`lane-possibly-live`"));
    expect(sentence, relative).toBeDefined();
    expect(sentence).toContain("`locked-worktree`");
    expect(sentence).toContain("`lane-worker-possibly-live`");
    // A drift gate outranks the reconciliation gate, so the sentence says when it holds.
    expect(sentence).toContain("`run-invariant-drift`");
  });
});
