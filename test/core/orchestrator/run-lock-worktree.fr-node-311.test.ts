import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { cp, readFile, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  acquire,
  readHolder,
  release,
  resolveGitCommonDir,
  resolveRunLockGitDir,
  runLockPath,
  type RunLock
} from "../../../src/core/orchestrator/run-lock.js";
import { computeResumeState } from "../../../src/core/orchestrator/resume.js";
import { parseWavesJournal } from "../../../src/core/orchestrator/waves-journal.js";
import { TYPE_STRIPPING_ARGS } from "../../support/node-type-stripping.js";
import { cleanupFixtures, commitAll, initRepo, rawGit, tempDir } from "./support/git-fixture.js";
import { emptyDriftInputs, emptyGitFacts, minimalCard } from "./resume-fixtures.js";
import { intent, journalRoot, waveVerify } from "./waves-fixtures.js";

// @req FR-NODE-311 — the orchestrator run lock belongs to one worktree (one run root), not to the
// repository. A batch of 17 linked worktrees of one repository each ran its own orchestrator run,
// and the first to take `.git/speckiwi/orchestrator-run.lock` held every other one off for hours.

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const CLI = path.join(REPO_ROOT, "bin", "speckiwi");
const RUN_LOCK_MODULE = path.join(REPO_ROOT, "src", "core", "orchestrator", "run-lock.ts");
const CHILD_SCRIPT = path.join(import.meta.dirname, "support", "run-lock-child.mjs");
const SPEC_FIXTURE = path.join(REPO_ROOT, "test", "fixtures", "workspaces", "valid-basic", "docs", "spec");
const SKILL_COPIES = ["skills/claude", "skills/codex", "skills/etc", ".agents/skills"].map((dir) => path.join(REPO_ROOT, dir, "kiwi-orchestrator", "SKILL.md"));
const RECOVERY_LINE = [
  "복구: `git rev-parse --verify {frozen.integration_branch}` — 있으면 채택, 없으면 `--base-branch` 에서 생성.",
  "채택은 이 run 의 재개에만 한다.",
  "재개 카드 `kiwi/orchestrator/{run_id}/resume-card.json` 이 `frozen.integration_branch` 를 기록했으면 그 브랜치를 채택한다.",
  "카드에 기록이 없는데 `kiwi/orch/{run_id}/` 아래 브랜치가 이미 있으면, 그 브랜치가 `kiwi/orch/{run_id}/integration` 하나뿐이고, 이 run root 의 저널 `kiwi/waves.jsonl` 에 그 `run_id` 의 짝 없는 `create-integration-branch` intent 가 있고, 그 끝이 `--base-branch` 의 조상일 때(`git merge-base --is-ancestor kiwi/orch/{run_id}/integration <base-branch>` 가 0)만 채택한다 — 브랜치를 만든 뒤 result 를 쓰기 전에 끊긴 이 run 의 것이고, 자기 커밋이 없어 새로 만든 것과 같다.",
  "그 밖의 경우는 같은 `run_id` 로 돈 다른 run 의 것으로 보고 채택하지 않고 `integration-branch-unavailable` 로 멈춘다 — 이어 쓰면 남의 통합 브랜치에 병합하고, 재시도가 남의 `-r2` 브랜치를 조용히 옮긴다.",
  "짝 없는 intent 만으로는 가르지 않는다 — 이 게이트로 멈춘 run 도 그 intent 를 남기고, `--resume` 은 그 run 을 다시 이 검사로 데려온다. 저널의 다른 줄로도 가르지 않는다 — Preflight 가 0.b 전에 이미 쓴다."
].join(" ");

const held: RunLock[] = [];
const children: ChildProcessWithoutNullStreams[] = [];

beforeAll(async () => {
  for (const [source, compiled] of [
    ["src/core/orchestrator/run-lock.ts", "dist/core/orchestrator/run-lock.js"],
    ["src/cli/commands/orchestrate.ts", "dist/cli/commands/orchestrate.js"]
  ] as const) {
    const compiledStat = await stat(path.join(REPO_ROOT, compiled)).catch(() => null);
    expect(compiledStat, `${compiled} is missing; run \`npm run build\``).not.toBeNull();
    expect((compiledStat as Awaited<ReturnType<typeof stat>>).mtimeMs, `${compiled} is older than ${source}; run \`npm run build\``)
      .toBeGreaterThanOrEqual((await stat(path.join(REPO_ROOT, source))).mtimeMs);
  }
});

afterAll(async () => {
  for (const child of children.splice(0)) child.kill();
  for (const lock of held.splice(0)) await release(lock).catch(() => undefined);
  await cleanupFixtures();
});

/** A committed repository with an SRS and one linked worktree, each checked to be its own top level. */
async function repositoryWithWorktree(prefix: string): Promise<{ main: string; linked: string }> {
  const main = await initRepo(prefix);
  await cp(SPEC_FIXTURE, path.join(main, "docs", "spec"), { recursive: true });
  await writeFile(path.join(main, "README.md"), "# run lock fixture\n", "utf8");
  await commitAll(main, "test: seed");
  const linked = path.join(await tempDir(`${prefix}-linked`), "laneB");
  await rawGit(main, "worktree", "add", "-b", "laneB", linked);
  expect(path.resolve(await rawGit(main, "rev-parse", "--show-toplevel"))).toBe(path.resolve(main));
  expect(path.resolve(await rawGit(linked, "rev-parse", "--show-toplevel"))).toBe(path.resolve(linked));
  return { main, linked };
}

async function acquireTracked(gitDir: string, owner: string): Promise<RunLock> {
  const lock = await acquire({ gitDir, owner });
  held.push(lock);
  return lock;
}

interface Run {
  exit: number;
  payload: Record<string, unknown>;
}

function cli(root: string, args: readonly string[]): Promise<Run> {
  return new Promise((resolve) => {
    execFile("node", [CLI, "--root", root, "orchestrate", ...args, "--json"], { encoding: "utf8", windowsHide: true }, (error, stdout) => {
      let payload: Record<string, unknown> = {};
      try {
        payload = JSON.parse(stdout) as Record<string, unknown>;
      } catch {
        // The assertions name what was missing.
      }
      resolve({ exit: error ? ((error as { code?: number }).code ?? 1) : 0, payload });
    });
  });
}

function valueOf(run: Run): Record<string, unknown> {
  return (run.payload.value ?? run.payload) as Record<string, unknown>;
}

function holderOf(run: Run): string | null {
  return ((valueOf(run).holder as { owner?: string } | null) ?? null)?.owner ?? null;
}

describe("FR-NODE-311 AC-1 — linked worktrees of one repository each hold their own run lock", { timeout: 120_000 }, () => {
  // @req FR-NODE-311 AC-1
  it("FR-NODE-311 AC-1: both acquisitions are granted, each on a different lock path", async () => {
    const { main, linked } = await repositoryWithWorktree("fr-node-311-core");
    const mainDir = await resolveRunLockGitDir(main);
    const linkedDir = await resolveRunLockGitDir(linked);
    expect(linkedDir).not.toBe(mainDir);

    const first = await acquireTracked(mainDir, "run-main");
    const second = await acquireTracked(linkedDir, "run-linked");
    expect(second.lockPath).not.toBe(first.lockPath);
    await expect(readHolder(mainDir)).resolves.toMatchObject({ owner: "run-main" });
    await expect(readHolder(linkedDir)).resolves.toMatchObject({ owner: "run-linked" });
  });

  // @req FR-NODE-311 AC-1
  it("FR-NODE-311 AC-1: `orchestrate run lock` succeeds in two linked worktrees and reports two lock paths", async () => {
    const { main, linked } = await repositoryWithWorktree("fr-node-311-cli");
    const laneA = path.join(await tempDir("fr-node-311-cli-a"), "laneA");
    await rawGit(main, "worktree", "add", "-b", "laneA", laneA);
    const a = await cli(laneA, ["run", "lock", "--owner", "run-A"]);
    const b = await cli(linked, ["run", "lock", "--owner", "run-B"]);
    expect(a.exit, JSON.stringify(a.payload)).toBe(0);
    expect(b.exit, JSON.stringify(b.payload)).toBe(0);
    expect(valueOf(a).lockPath).not.toBe(valueOf(b).lockPath);
    await cli(laneA, ["run", "unlock"]);
    await cli(linked, ["run", "unlock"]);
  });
});

describe("FR-NODE-311 AC-2 — one worktree still admits one run", { timeout: 120_000 }, () => {
  // @req FR-NODE-311 AC-2
  it("FR-NODE-311 AC-2: a second operating-system process is refused on the same linked worktree", async () => {
    const { linked } = await repositoryWithWorktree("fr-node-311-xproc");
    const gitDir = await resolveRunLockGitDir(linked);
    const lock = await acquireTracked(gitDir, "parent-run");
    const child = spawn(process.execPath, [...TYPE_STRIPPING_ARGS, CHILD_SCRIPT, RUN_LOCK_MODULE, gitDir, "child-run"], { cwd: REPO_ROOT, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    children.push(child);
    let out = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { out += chunk; });
    const exitCode = await new Promise<number | null>((resolve) => child.on("close", resolve));
    expect(out.trim()).toBe("REFUSED orchestrator-run-lock-held");
    expect(exitCode).toBe(3);
    expect(child.pid).not.toBe(process.pid);
    await release(lock);
    held.splice(held.indexOf(lock), 1);
  });
});

describe("FR-NODE-311 AC-3 — the main checkout keeps its lock path", { timeout: 120_000 }, () => {
  // @req FR-NODE-311 AC-3
  it("FR-NODE-311 AC-3: the main checkout's lock path is <git common dir>/speckiwi/orchestrator-run.lock", async () => {
    const { main } = await repositoryWithWorktree("fr-node-311-main");
    const commonDir = await resolveGitCommonDir(main);
    const lock = await acquireTracked(await resolveRunLockGitDir(main), "run-main");
    expect(lock.lockPath).toBe(path.join(commonDir, "speckiwi", "orchestrator-run.lock"));
    expect(runLockPath(commonDir)).toBe(lock.lockPath);
  });

  // @req FR-NODE-311 AC-3
  it("FR-NODE-311 AC-3: a linked worktree's lock lives under its own git dir", async () => {
    const { linked } = await repositoryWithWorktree("fr-node-311-linked-path");
    const gitDir = path.resolve(await rawGit(linked, "rev-parse", "--path-format=absolute", "--git-dir"));
    expect(path.resolve(await resolveRunLockGitDir(linked)).toLowerCase()).toBe(gitDir.toLowerCase());
  });
});

describe("FR-NODE-311 AC-4 — status, unlock and abort act on this worktree's lease alone", { timeout: 180_000 }, () => {
  // @req FR-NODE-311 AC-4
  it("FR-NODE-311 AC-4: status names this worktree's holder, unlock and abort release only it", async () => {
    const { main, linked } = await repositoryWithWorktree("fr-node-311-release");
    expect((await cli(main, ["run", "lock", "--owner", "run-main"])).exit).toBe(0);
    expect((await cli(linked, ["run", "lock", "--owner", "run-linked"])).exit).toBe(0);

    expect(holderOf(await cli(main, ["run", "status"]))).toBe("run-main");
    expect(holderOf(await cli(linked, ["run", "status"]))).toBe("run-linked");

    const unlocked = await cli(linked, ["run", "unlock"]);
    expect(unlocked.exit, JSON.stringify(unlocked.payload)).toBe(0);
    expect(valueOf(unlocked).heldBy).toBe("run-linked");
    expect(holderOf(await cli(linked, ["run", "status"]))).toBeNull();
    expect(holderOf(await cli(main, ["run", "status"]))).toBe("run-main");

    expect((await cli(linked, ["run", "lock", "--owner", "run-linked-2"])).exit).toBe(0);
    const aborted = await cli(linked, ["run", "abort", "--run-id", "run-linked-2", "--reason", "integration-branch-unavailable"]);
    expect(aborted.exit, JSON.stringify(aborted.payload)).toBe(0);
    expect(holderOf(await cli(linked, ["run", "status"]))).toBeNull();
    expect(holderOf(await cli(main, ["run", "status"]))).toBe("run-main");
    const mainLease = path.join(await resolveGitCommonDir(main), "speckiwi", "orchestrator-run.lock");
    expect(existsSync(mainLease)).toBe(true);
    await cli(main, ["run", "unlock"]);
  });
});

describe("FR-NODE-311 AC-5 — resume attributes only its own run's lanes", () => {
  const V14 = { schema_version: "1.4.0", engine: "kiwi-orchestrator", writer: "speckiwi-orchestrate/2.4.1" } as const;
  const OPEN = { open: [{ key: "wave-1/s1/lane-1", state: "executing", base_sha: "e4f5a6b", head_sha: "7bd41f0", journal_line: 2 }] };

  async function midExecution() {
    const root = await journalRoot([waveVerify(V14), intent("dispatch-lane", { stage: 1, lane: "lane-1" })]);
    return parseWavesJournal(root, { runId: "run-a", engine: "kiwi-orchestrator" });
  }

  // @req FR-NODE-311 AC-5
  it("FR-NODE-311 AC-5: another run's locked lane worktree with the same lane id does not refuse run-a's resume", async () => {
    const state = computeResumeState(
      await midExecution(),
      minimalCard(OPEN),
      emptyGitFacts({ worktrees: [{ path: "/repo/.wt/laneB/.lanes/lane-1", branch: "kiwi/orch/run-b/w1s1/lane-1", locked: true, lockReason: "pid 4242" }] }),
      emptyDriftInputs()
    );
    expect(state.blocking).toBeNull();
    expect(state.classification.find((lane) => lane.lane === "lane-1")?.klass).not.toBe("lane-possibly-live");
  });

  // @req FR-NODE-311 AC-5
  it("FR-NODE-311 AC-5: run-a's own locked lane worktree still refuses its resume (control)", async () => {
    const state = computeResumeState(
      await midExecution(),
      minimalCard(OPEN),
      emptyGitFacts({ worktrees: [{ path: "/repo/.lanes/lane-1", branch: "kiwi/orch/run-a/w1s1/lane-1", locked: true }] }),
      emptyDriftInputs()
    );
    expect(state.blocking).toBe("interrupted-external-action");
  });

  // @req FR-NODE-311 AC-5
  it.each(["kiwi/orch/Run_A/w1s1/lane-1", "kiwi/orch/run-a/w1s1/lane-1"])("FR-NODE-311 AC-5: run Run_A owns its lane on %s, the run id as written or as the unit id spells it", async (branch) => {
    const root = await journalRoot([waveVerify(V14), intent("dispatch-lane", { stage: 1, lane: "lane-1" })].map((line) => ({ ...line, run_id: "Run_A" })));
    const view = await parseWavesJournal(root, { runId: "Run_A", engine: "kiwi-orchestrator" });
    const state = computeResumeState(view, minimalCard(OPEN), emptyGitFacts({ worktrees: [{ path: "/repo/.lanes/lane-1", branch, locked: true }] }), emptyDriftInputs());
    expect(state.blocking).toBe("interrupted-external-action");
  });

  // @req FR-NODE-311 AC-5
  it("FR-NODE-311 AC-5: a bare branch named after the lane is not attributed to the run", async () => {
    const state = computeResumeState(
      await midExecution(),
      minimalCard(OPEN),
      emptyGitFacts({ worktrees: [{ path: "/elsewhere/lane-1", branch: "lane-1", locked: true }] }),
      emptyDriftInputs()
    );
    expect(state.blocking).toBeNull();
  });

  // @req FR-NODE-311 AC-5
  it("FR-NODE-311 AC-5: another run's landed lane branch is not run-a's landing", async () => {
    const root = await journalRoot([waveVerify(V14), intent("dispatch-lane", { stage: 1, lane: "lane-1" })]);
    const view = parseWavesJournal(root, { runId: "run-a", engine: "kiwi-orchestrator" });
    const foreign = computeResumeState(await view, minimalCard(OPEN), emptyGitFacts({ branches: [{ name: "kiwi/orch/run-b/w1s1/lane-1", sha: "7bd41f0", ancestorOfIntegration: true }] }), emptyDriftInputs());
    const own = computeResumeState(await view, minimalCard(OPEN), emptyGitFacts({ branches: [{ name: "kiwi/orch/run-a/w1s1/lane-1", sha: "7bd41f0", ancestorOfIntegration: true }] }), emptyDriftInputs());
    expect(foreign.classification.find((lane) => lane.lane === "lane-1")?.klass).not.toBe(own.classification.find((lane) => lane.lane === "lane-1")?.klass);
  });
});

describe("FR-NODE-311 AC-6 — a new run does not adopt another run's branches", () => {
  // @req FR-NODE-311 AC-6
  it.each(SKILL_COPIES)("FR-NODE-311 AC-6: %s §V.create-integration-branch adopts a branch only on this run's resume", async (file) => {
    const text = await readFile(file, "utf8");
    const start = text.indexOf("### §V.create-integration-branch");
    expect(start).toBeGreaterThan(-1);
    const section = text.slice(start, text.indexOf("\n### ", start + 1));
    // The whole recovery line is pinned: each clause decides adoption (the card's record; an unmatched
    // intent AND no commits of the branch's own; every other case refused), so a reworded clause —
    // "and" for "or", a dropped condition, a negated verdict — must turn this red.
    expect(section).toContain(RECOVERY_LINE);
  });

  // @req FR-NODE-311 AC-6
  it.each(SKILL_COPIES)("FR-NODE-311 AC-6: %s no longer keys the run lock on the git common dir", async (file) => {
    expect(await readFile(file, "utf8")).not.toContain("git common dir");
  });
});
