import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "./kiwi-orchestrator-variants.js";
import { RENDERINGS } from "./kiwi-renderings.js";

// Lane-branch preparation lives in `_shared/kiwi/worktree-lane.md` §2 alone (FR-FLOW-122). Rounds 2–4 of
// the 5.3.0 verification each found the same rule written five times and one copy left behind; this file
// counts every command that makes or moves a `kiwi/orch/` branch and pins the one section that may hold it.

const read = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8").replace(/\r\n/g, "\n");
const LANE = RENDERINGS.map((root) => `${root}/_shared/kiwi/worktree-lane.md`);
const PARALLEL = RENDERINGS.map((root) => `${root}/_shared/kiwi/parallel-waves.md`);
const korean = (rel: string): boolean => rel.startsWith("skills/claude/");

/** worktree-lane.md §2 as a line range [start, end) of the file. */
function sectionTwo(lines: readonly string[]): [number, number] {
  const start = lines.findIndex((line) => line.startsWith("## 2."));
  if (start < 0) return [0, 0];
  const next = lines.findIndex((line, i) => i > start && line.startsWith("## "));
  return [start, next < 0 ? lines.length : next];
}

function markdownFiles(dir: string): string[] {
  return readdirSync(path.join(REPO_ROOT, dir)).flatMap((entry) => {
    const rel = `${dir}/${entry}`;
    if (statSync(path.join(REPO_ROOT, rel)).isDirectory()) return markdownFiles(rel);
    return entry.endsWith(".md") ? [rel] : [];
  });
}

/** A command that makes or moves a branch, on a line that names a lane branch. */
const MOVES = /worktree add|switch -C|checkout -B|branch -f|git branch /;
const LANE_BRANCH = /kiwi\/orch\/|<branch>/;

describe("FR-FLOW-122 AC-8 — the lane-branch commands exist in worktree-lane.md §2 and nowhere else", () => {
  it("every line that makes or moves a kiwi/orch branch lies inside worktree-lane.md §2", () => {
    // @req FR-FLOW-122 AC-8 — neither skill restates the procedure in place of referencing it.
    const outside: string[] = [];
    let inside = 0;
    for (const root of RENDERINGS) {
      for (const rel of markdownFiles(root)) {
        const lines = read(rel).split("\n");
        const [start, end] = rel.endsWith("/_shared/kiwi/worktree-lane.md") ? sectionTwo(lines) : [0, 0];
        lines.forEach((line, i) => {
          if (!MOVES.test(line) || !LANE_BRANCH.test(line)) return;
          if (i >= start && i < end) inside += 1;
          else outside.push(`${rel}:${i + 1}: ${line.trim().slice(0, 160)}`);
        });
      }
    }
    expect(outside, "lane-branch commands outside worktree-lane.md §2").toEqual([]);
    // Five per rendering: the make-or-remake of each of the three cases and the attach of cases 1 and 2.
    expect(inside, "the §2 denominator").toBe(RENDERINGS.length * 5);
  });

  const REFERENCES: ReadonlyArray<readonly [string, string]> = [
    ...PARALLEL.map((rel) => [
      rel,
      korean(rel)
        ? "1. 레인 브랜치 준비는 `worktree-lane.md` §2 를 따른다 — 붙일지 `<base_sha>` 에서 다시 만들지는 그 절의 조상 판정이 정한다. 런타임이 만든 워크트리의 기본 HEAD 를 믿지 않는다."
        : "1. Lane-branch preparation follows `worktree-lane.md` §2 — its ancestor test decides whether to attach or to recreate at `<base_sha>`. Never trust the default HEAD of a worktree the runtime created."
    ] as const),
    ...PARALLEL.map((rel) => [
      rel,
      korean(rel)
        ? "재시도 브랜치 `…/{laneId}-r2` 준비는 `worktree-lane.md` §2 를 따르고, 그 워커는 §6 의 재개 커서대로 실패한 요구부터 이어 간다."
        : "Preparing the retry branch `…/{laneId}-r2` follows `worktree-lane.md` §2, and that worker resumes at the failed requirement through §6's resume cursor."
    ] as const),
    ...RENDERINGS.map((root) => [
      `${root}/kiwi-orchestrator/SKILL.md`,
      "1. **만든다** — 레인 브랜치 준비는 `worktree-lane.md` §2 를 따른다. 그 절의 조상 판정이 붙일지 `<base_sha>` 에서 다시 만들지 정하고, 다시 만들 때는 base 를 같은 명령의 인자로 준다(호스트가 만들면 `git worktree add -B`, 런타임이 건넨 워크트리면 `switch -C` — 둘 다 `<base_sha>` 가 마지막 인자다). base 를 따로 체크아웃하지 않는다. `<base_sha>` 는 그 wave 의 dispatch base — 3.d 의 입력 커밋 sha 다."
    ] as const),
    ...RENDERINGS.filter((root) => root.startsWith("skills/")).map((root) => [
      `${root}/kiwi-wave-master/SKILL.md`,
      "1. **만든다** — 레인 브랜치 준비는 `worktree-lane.md` §2 를 따른다. 그 절의 조상 판정이 붙일지 `<base_sha>` 에서 다시 만들지 정하고, 다시 만들 때는 base 를 같은 명령의 인자로 준다(호스트가 만들면 `git worktree add -B`, 런타임이 건넨 워크트리면 `switch -C` — 둘 다 `<base_sha>` 가 마지막 인자다). base 를 따로 체크아웃하지 않는다. `<base_sha>` 는 그 wave 의 입력 커밋 sha 다."
    ] as const)
  ];
  it.each(REFERENCES)("%s points at worktree-lane.md §2 in one sentence", (rel, sentence) => {
    // @req FR-FLOW-122 AC-8 — @req FR-FLOW-123 AC-2: the procedure step keeps the base on the worktree command by reference.
    expect(read(rel)).toContain(sentence);
  });
});

const KO = {
  intro: [
    "**레인 브랜치 준비는 이 절 한 곳이 정한다.** `parallel-waves.md` PW-6 1단계 · PW-8 재시도와 `kiwi-orchestrator` · `kiwi-wave-master` 의 워크트리 절차는 명령을 다시 적지 않고 이 절을 따른다. `<branch>` 는 레인 브랜치 `kiwi/orch/{run_id}/{laneId}` 다.",
    "세 경우 모두 먼저 **조상 판정**을 한다 — 레인 브랜치가 있고 이번 `<base_sha>` 가 그 조상이면 `git merge-base --is-ancestor` 가 0 으로 끝난다. 0 이면 중단 뒤 재개 · PW-8 재시도이므로 **붙이고 브랜치는 움직이지 않는다**. 그 밖의 경우 — 레인 브랜치가 없거나 `<base_sha>` 가 그 조상이 아니면(첫 dispatch · 재진입 `r{m}`) — **`<base_sha>` 에서 만들거나 다시 만든다**(3 은 실패한 레인 브랜치의 끝에서). 첫 dispatch 와 재진입은 레인 id 가 같으므로 브랜치가 있다는 사실만으로는 재개가 아니다. 붙인 브랜치의 `<base_sha>..` 범위 `REQ` · `Commit-Kind` trailer 커밋이 `parallel-waves.md §6` 의 재개 커서다."
  ],
  cases: [
    [
      "1. **호스트가 워크트리를 만든다.**",
      "   - 판정: `git merge-base --is-ancestor <base_sha> <branch>`",
      "   - 붙인다: `git worktree add <lane-root> <branch>`",
      "   - 만들거나 다시 만든다: `git worktree add <lane-root> -B <branch> <base_sha>`"
    ],
    [
      "2. **런타임이 워크트리를 이미 만들어 건넸다** — 한 줄로 만들 수 없는 곳이다.",
      "   - 판정: `git -C <lane-root> merge-base --is-ancestor <base_sha> <branch>`",
      "   - 붙인다: `git -C <lane-root> switch -C <branch> <branch>` 로 브랜치를 움직이지 않는다.",
      "   - 만들거나 다시 만든다: `git -C <lane-root> switch -C <branch> <base_sha>`"
    ],
    [
      "3. **재시도 브랜치를 만든다**(PW-8 판정 재시도 · PW-9 병합 재시도) — `<branch>-r2` 는 base 가 아니라 실패한 레인 브랜치의 끝에서 만든다. base 에서 만들면 재개 커서가 읽을 trailer 커밋이 없다.",
      "   - 판정: `git merge-base --is-ancestor <base_sha> <branch>-r2`",
      "   - 붙인다: 이미 있는 `<branch>-r2` 를 그대로 둔다(재시도 워커의 중단 뒤 재개).",
      "   - 만들거나 다시 만든다: `git branch -f <branch>-r2 <branch>` — 실패한 레인 브랜치의 끝에서 만든다. PW-8 판정 재시도는 같은 `<base_sha>` 위에서 돌므로 그 끝이 base 를 조상으로 가지고, 재시도 워커는 `<branch>-r2` 를 레인 브랜치로 삼아 1 · 2 의 판정에서 붙여 `parallel-waves.md §6` 의 재개 커서대로 실패한 요구부터 이어 간다. 병합 충돌 · 병합 뒤 회귀의 재시도(PW-9)는 새 base 위에서 돌고 새 base 는 그 끝의 조상이 아니므로, 1 · 2 의 판정이 `<branch>-r2` 를 새 base 에서 다시 만든다."
    ]
  ],
  outro: "어느 경우든 HEAD 를 그 브랜치에 **붙인 채로** 둔다. `checkout <sha>` 는 어느 경우에도 답이 아니다."
} as const;

const EN = {
  intro: [
    "**This section alone owns lane-branch preparation.** `parallel-waves.md` PW-6 step 1 and the PW-8 retry, and the worktree procedures of `kiwi-orchestrator` and `kiwi-wave-master`, do not write the commands again; they follow this section. `<branch>` is the lane branch `kiwi/orch/{run_id}/{laneId}`.",
    "Every case starts with the **ancestor test** — `git merge-base --is-ancestor` exits 0 when the lane branch exists and this `<base_sha>` is its ancestor. On 0 it is a resume after an interruption, or a PW-8 retry, so **attach and leave the branch where it is**. Otherwise — no lane branch, or `<base_sha>` is not its ancestor (a first dispatch, or a re-entry `r{m}`) — **create or recreate the branch at `<base_sha>`** (case 3 at the failed lane branch's tip). A first dispatch and its re-entry share the lane id, so an existing branch alone does not mean a resume. On an attached branch, the `REQ` · `Commit-Kind` trailer commits in `<base_sha>..` are `parallel-waves.md §6`'s resume cursor."
  ],
  cases: [
    [
      "1. **The host creates the worktree.**",
      "   - Test: `git merge-base --is-ancestor <base_sha> <branch>`",
      "   - Attach: `git worktree add <lane-root> <branch>`",
      "   - Create or recreate: `git worktree add <lane-root> -B <branch> <base_sha>`"
    ],
    [
      "2. **A runtime handed you the worktree already made** — a single command is not possible.",
      "   - Test: `git -C <lane-root> merge-base --is-ancestor <base_sha> <branch>`",
      "   - Attach: `git -C <lane-root> switch -C <branch> <branch>` leaves the branch where it is.",
      "   - Create or recreate: `git -C <lane-root> switch -C <branch> <base_sha>`"
    ],
    [
      "3. **The retry branch** (a PW-8 verdict retry, or a PW-9 merge retry) — `<branch>-r2` starts at the tip of the failed lane branch, not at the base: made at the base, it holds no trailer commit for the resume cursor to read.",
      "   - Test: `git merge-base --is-ancestor <base_sha> <branch>-r2`",
      "   - Attach: leave the existing `<branch>-r2` where it is (the retry worker resuming after an interruption).",
      "   - Create or recreate: `git branch -f <branch>-r2 <branch>` — at the failed lane branch's tip. A PW-8 verdict retry runs on the same `<base_sha>`, so that tip has the base as its ancestor: the retry worker, taking `<branch>-r2` as its lane branch, attaches through the test of case 1 or 2 and resumes at the failed requirement through `parallel-waves.md §6`'s resume cursor. A merge-conflict or post-merge-regression retry (PW-9) runs on a new base, which is not that tip's ancestor, so the test of case 1 or 2 recreates `<branch>-r2` at the new base."
    ]
  ],
  outro: "Either way HEAD stays ATTACHED to the branch. `checkout <sha>` is never the answer."
} as const;

/** The three bullets of case n in §2: [test, attach, make-or-remake] lines, or "" when absent. */
function caseLines(rel: string, n: number): string[] {
  const lines = read(rel).split("\n");
  const [start, end] = sectionTwo(lines);
  const head = lines.findIndex((line, i) => i >= start && i < end && line.startsWith(`${n}. **`));
  return head < 0 ? ["", "", "", ""] : lines.slice(head, head + 4);
}

describe("FR-FLOW-216 AC-3 · FR-FLOW-218 AC-4 — each §2 case tests the ancestor, attaches on a resume and remakes otherwise", () => {
  it.each(LANE)("%s: §2 opens with the one-place rule and the ancestor test", (rel) => {
    // @req FR-FLOW-216 AC-3 — @req FR-FLOW-218 AC-4: a re-entry shares the lane id, so an existing branch is not a resume.
    const text = korean(rel) ? KO : EN;
    const lines = read(rel).split("\n");
    const [start, end] = sectionTwo(lines);
    const body = lines.slice(start, end);
    for (const line of [...text.intro, text.outro]) expect(body, `${rel}: ${line.slice(0, 60)}`).toContain(line);
  });

  for (const n of [1, 2, 3]) {
    it.each(LANE)(`%s: case ${n} names its test, its attach and its make-or-remake`, (rel) => {
      // @req FR-FLOW-216 AC-3 — @req FR-FLOW-218 AC-4
      expect(caseLines(rel, n)).toEqual((korean(rel) ? KO : EN).cases[n - 1]);
    });
  }
});

// ---- running §2 as written -------------------------------------------------------------------------------

const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
function git(cwd: string, args: readonly string[]): string {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", env: GIT_ENV });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
}
const status = (cwd: string, args: readonly string[]): number => spawnSync("git", args, { cwd, env: GIT_ENV }).status ?? 1;

/** The backticked git command of a bullet as argv (without `git`), placeholders filled per token. */
function argv(bullet: string, fill: Readonly<Record<string, string>>): string[] {
  const command = /`(git [^`]+)`/.exec(bullet)?.[1] ?? "";
  return command
    .split(/\s+/)
    .slice(1)
    .map((token) => Object.entries(fill).reduce((acc, [key, value]) => acc.replaceAll(key, value), token));
}

/** Runs one case of §2 by its rule: the test, then the attach on 0 or the make-or-remake otherwise. */
function prepare(rel: string, n: number, cwd: string, fill: Readonly<Record<string, string>>): void {
  const [, ancestry, attach, remake] = caseLines(rel, n);
  const resumed = status(cwd, argv(ancestry ?? "", fill)) === 0;
  const chosen = resumed ? attach ?? "" : remake ?? "";
  if (/`git /.test(chosen)) git(cwd, argv(chosen, fill));
}

describe("FR-FLOW-216 AC-3 · FR-FLOW-218 AC-4 — §2 run as written resumes, re-enters, starts fresh and retries correctly", () => {
  const BRANCH = "kiwi/orch/r1/lane-1";
  for (const n of [1, 2]) {
    it.each(LANE)(`%s: case ${n}`, (rel) => {
      // @req FR-FLOW-216 AC-3 — @req FR-FLOW-218 AC-4
      const scratch = mkdtempSync(path.join(tmpdir(), `lane-branch-case${n}-`));
      const main = path.join(scratch, "repo");
      const laneAt = (name: string, base: string): string => {
        const root = path.join(scratch, name);
        if (n === 2) git(main, ["worktree", "add", "-q", "--detach", root, base]); // the runtime made it
        return root;
      };
      const fill = (root: string, base: string, branch = BRANCH) => ({ "<lane-root>": root, "<branch>": branch, "<base_sha>": base });
      try {
        spawnSync("git", ["init", "-q", "-b", "main", main], { env: GIT_ENV });
        git(main, ["commit", "-q", "--allow-empty", "-m", "dispatch base"]);
        const base = git(main, ["rev-parse", "HEAD"]);

        // First dispatch: no lane branch — made at the base, HEAD attached.
        const first = laneAt("lane-a", base);
        prepare(rel, n, n === 2 ? first : main, fill(first, base));
        expect(git(first, ["rev-parse", "HEAD"]), `${rel}: first dispatch base`).toBe(base);
        expect(git(first, ["symbolic-ref", "HEAD"])).toBe(`refs/heads/${BRANCH}`);
        git(first, ["commit", "-q", "--allow-empty", "-m", "test for FR-X-001", "-m", "REQ: FR-X-001\nCommit-Kind: test"]);
        const tip = git(first, ["rev-parse", "HEAD"]);

        // Resume after an interruption: the worktree is gone, the branch and the base are not — the tip stays.
        git(main, ["worktree", "remove", "--force", first]);
        const again = laneAt("lane-b", base);
        prepare(rel, n, n === 2 ? again : main, fill(again, base));
        expect(git(again, ["rev-parse", BRANCH]), `${rel}: the resume moved the lane branch`).toBe(tip);
        expect(git(again, ["symbolic-ref", "HEAD"])).toBe(`refs/heads/${BRANCH}`);

        // Re-entry r1: merged and released; the new input commit is the base and not the branch's ancestor.
        git(main, ["merge", "-q", "--no-ff", "-m", "integrate", BRANCH]);
        git(main, ["worktree", "remove", "--force", again]);
        git(main, ["commit", "-q", "--allow-empty", "-m", "re-entry inputs"]);
        const reentry = git(main, ["rev-parse", "HEAD"]);
        const third = laneAt("lane-c", reentry);
        prepare(rel, n, n === 2 ? third : main, fill(third, reentry));
        expect(git(third, ["rev-parse", "HEAD"]), `${rel}: the re-entry did not start on its own base`).toBe(reentry);
        expect(git(third, ["symbolic-ref", "HEAD"])).toBe(`refs/heads/${BRANCH}`);
      } finally {
        spawnSync("git", ["-C", main, "worktree", "prune"], { env: GIT_ENV });
        rmSync(scratch, { recursive: true, force: true });
      }
    });
  }

  it.each(LANE)("%s: case 3 makes the retry branch at the failed tip, keeps it on a resume, moves a merge retry to the new base and remakes a stale one", (rel) => {
    // @req FR-FLOW-216 AC-3 — a retry branch made at the base has no trailer commit for the cursor to read.
    const scratch = mkdtempSync(path.join(tmpdir(), "lane-branch-case3-"));
    const main = path.join(scratch, "repo");
    const retry = `${BRANCH}-r2`;
    try {
      spawnSync("git", ["init", "-q", "-b", "main", main], { env: GIT_ENV });
      git(main, ["commit", "-q", "--allow-empty", "-m", "dispatch base"]);
      const base = git(main, ["rev-parse", "HEAD"]);
      git(main, ["branch", BRANCH, base]);
      const lane = path.join(scratch, "lane");
      git(main, ["worktree", "add", "-q", lane, BRANCH]);
      git(lane, ["commit", "-q", "--allow-empty", "-m", "test for FR-X-001", "-m", "REQ: FR-X-001\nCommit-Kind: test"]);
      const failedTip = git(lane, ["rev-parse", "HEAD"]);
      git(main, ["worktree", "remove", "--force", lane]);

      prepare(rel, 3, main, { "<branch>": BRANCH, "<base_sha>": base });
      expect(git(main, ["rev-parse", retry]), `${rel}: the retry branch is not at the failed tip`).toBe(failedTip);

      // The retry worker takes the -r2 branch as its lane branch: case 2 attaches and leaves it at the failed tip.
      const worker = path.join(scratch, "retry");
      git(main, ["worktree", "add", "-q", "--detach", worker, base]);
      prepare(rel, 2, worker, { "<lane-root>": worker, "<branch>": retry, "<base_sha>": base });
      expect(git(worker, ["rev-parse", "HEAD"]), `${rel}: the retry worker lost the failed lane's commits`).toBe(failedTip);
      git(worker, ["commit", "-q", "--allow-empty", "-m", "implementation for FR-X-001", "-m", "REQ: FR-X-001\nCommit-Kind: implementation"]);
      const retryTip = git(worker, ["rev-parse", "HEAD"]);
      git(main, ["worktree", "remove", "--force", worker]);

      // The retry worker resumes after an interruption: case 3 leaves the -r2 branch where it is.
      prepare(rel, 3, main, { "<branch>": BRANCH, "<base_sha>": base });
      expect(git(main, ["rev-parse", retry]), `${rel}: the retry resume moved the -r2 branch`).toBe(retryTip);

      // A PW-9 merge retry runs on a new base: case 3 makes -r2 at the failed tip, and case 2 recreates it at the new base.
      git(main, ["commit", "-q", "--allow-empty", "-m", "integration moved on"]);
      const newBase = git(main, ["rev-parse", "HEAD"]);
      prepare(rel, 3, main, { "<branch>": BRANCH, "<base_sha>": newBase });
      expect(git(main, ["rev-parse", retry]), `${rel}: the merge retry's -r2 is not at the failed tip`).toBe(failedTip);
      const merged = path.join(scratch, "merge-retry");
      git(main, ["worktree", "add", "-q", "--detach", merged, newBase]);
      prepare(rel, 2, merged, { "<lane-root>": merged, "<branch>": retry, "<base_sha>": newBase });
      expect(git(merged, ["rev-parse", "HEAD"]), `${rel}: the merge retry did not start on the new base`).toBe(newBase);
      git(main, ["worktree", "remove", "--force", merged]);

      // A stale -r2 branch from an earlier dispatch: this dispatch's base is not its ancestor — remade at the failed tip.
      git(main, ["commit", "-q", "--allow-empty", "-m", "re-entry inputs"]);
      const reentry = git(main, ["rev-parse", "HEAD"]);
      git(main, ["branch", "-f", BRANCH, reentry]);
      prepare(rel, 3, main, { "<branch>": BRANCH, "<base_sha>": reentry });
      expect(git(main, ["rev-parse", retry]), `${rel}: a stale -r2 branch was kept`).toBe(reentry);
    } finally {
      spawnSync("git", ["-C", main, "worktree", "prune"], { env: GIT_ENV });
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});
