import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { laneIdOf } from "../../src/core/orchestrator/lane-plan.js";
import { laneProcedure, runLaneProcedure } from "./lane-branch-ssot.js";

// Independent verification of FR-FLOW-208..223 (5.3.0), final round 4, skills bundle.
// Nothing in the repository is changed: git runs in temporary directories.

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (rel: string): string => readFileSync(path.join(REPO, rel), "utf8").replace(/\r\n/g, "\n");

const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: "v", GIT_AUTHOR_EMAIL: "v@example.invalid", GIT_COMMITTER_NAME: "v", GIT_COMMITTER_EMAIL: "v@example.invalid" };
function git(cwd: string, args: readonly string[]): string {
  const run = spawnSync("git", args, { cwd, env: GIT_ENV, encoding: "utf8" });
  if (run.status !== 0) throw new Error(`git ${args.join(" ")}: ${run.stderr}`);
  return run.stdout;
}
const isAncestor = (cwd: string, a: string, b: string): boolean => spawnSync("git", ["merge-base", "--is-ancestor", a, b], { cwd, env: GIT_ENV }).status === 0;

/** A commit as kiwi-pm §1.5 makes it under --commit-lane-work: REQ and Commit-Kind plus the run coordinates as trailers. */
function laneCommit(cwd: string, file: string, req: string, kind: "test" | "implementation", lane: string): void {
  writeFileSync(path.join(cwd, file), `// ${req} ${kind}\n`);
  git(cwd, ["add", "--", file]);
  const trailers = `REQ: ${req}\nCommit-Kind: ${kind}\nOrch-Run: r1\nOrch-Wave: wave-1\nOrch-Stage: 1\nOrch-Lane: ${lane}`;
  git(cwd, ["commit", "-q", "-m", `${kind} for ${req}`, "-m", trailers]);
}

describe("FR-FLOW-216 AC-3 — kiwi-wave-master §11 step 1 recreates the lane branch at a re-entry's dispatch base", () => {
  // Corpus: skills/{claude,codex,etc}/kiwi-wave-master/SKILL.md §11 step 1 (the host makes the lane worktree with
  // `git worktree add <lane-root> -b kiwi/orch/{run_id}/{laneId} <base_sha>`; kiwi-wave-master has no .agents mirror),
  // skills/claude/_shared/kiwi/parallel-waves.md §3 (a re-entry is a stage holding that wave alone, its input commit is the
  // new dispatch base), PW-9 (--no-ff merge) and PW-11 (`git worktree remove`, the lane branch stays). The lane id is
  // laneIdOf(waveId) in src/core/orchestrator/lane-plan.ts — the same for the first dispatch of wave-1 and for its re-entry.
  const RENDERINGS = ["skills/claude", "skills/codex", "skills/etc"];
  for (const root of RENDERINGS) {
    // @req FR-FLOW-216 AC-3 — … otherwise the lane branch SHALL be created or recreated at `<base_sha>` (a first dispatch,
    // or a re-entry `r{m}`).
    it(`${root}: §11 step 1's worktree command, run for a re-entry r1, leaves the lane on the re-entry dispatch base`, () => {
      // Lead decision (final round 4): §11 step 1 cites worktree-lane.md §2, the one place holding the lane-branch commands
      // (it had its own `-b` command). The property kept is the defect's: the host preparing a re-entry lane as the contract
      // orders leaves it on the re-entry dispatch base.
      expect(read(`${root}/kiwi-wave-master/SKILL.md`), `${root}: §11 cites worktree-lane.md §2`).toMatch(/worktree-lane\.md` ?§2/);
      const procedure = laneProcedure(root, "host");
      expect([procedure.probe, procedure.attach, procedure.recreate].every((c) => c !== ""), `${root}: §2 host case commands`).toBe(true);

      const laneId = laneIdOf("r1-wave-1");
      const branch = `kiwi/orch/r1/${laneId}`;
      const scratch = mkdtempSync(path.join(tmpdir(), "verify-v530-r4-skills-"));
      const main = path.join(scratch, "repo");
      try {
        spawnSync("git", ["init", "-q", "-b", "main", main], { env: GIT_ENV });
        mkdirSync(path.join(main, "docs", "spec"), { recursive: true });
        writeFileSync(path.join(main, "docs", "spec", "60.flow.srs.md"), "AC-1: WHEN x THE SYSTEM SHALL y.\n");
        git(main, ["add", "-A"]);
        git(main, ["commit", "-q", "-m", "wave-1 inputs"]);
        const firstBase = git(main, ["rev-parse", "HEAD"]).trim();

        // First dispatch of wave-1, with the worktree made by §11 step 1 itself; the worker lands FR-X-001.
        const lane1 = path.join(scratch, "lane-1");
        runLaneProcedure(procedure, main, { laneRoot: lane1, branch, base: firstBase }, GIT_ENV);
        laneCommit(lane1, "a.test.ts", "FR-X-001", "test", laneId);
        laneCommit(lane1, "a.ts", "FR-X-001", "implementation", laneId);
        git(main, ["merge", "-q", "--no-ff", "-m", "integrate wave-1", `kiwi/orch/r1/${laneId}`]); // PW-9
        git(main, ["worktree", "remove", "--force", lane1]); // PW-11 — the lane branch stays

        // An AC edit routed to re-entry r1 (FR-FLOW-218 AC-4): PW-3's input commit is the re-entry dispatch base.
        writeFileSync(path.join(main, "docs", "spec", "60.flow.srs.md"), "AC-1: WHEN x THE SYSTEM SHALL z.\n");
        git(main, ["commit", "-q", "-am", "re-entry r1 inputs"]);
        const reentryBase = git(main, ["rev-parse", "HEAD"]).trim();

        // The host prepares the re-entry lane as §2 orders.
        const lane2 = path.join(scratch, "lane-2");
        const chosen = runLaneProcedure(procedure, main, { laneRoot: lane2, branch, base: reentryBase }, GIT_ENV);
        expect(isAncestor(lane2, reentryBase, "HEAD"), `${root}: the re-entry lane after \`${chosen}\``).toBe(true);
      } finally {
        spawnSync("git", ["-C", main, "worktree", "prune"], { env: GIT_ENV });
        rmSync(scratch, { recursive: true, force: true });
      }
    });
  }
});

// Mutation runs of the skill contract tests (all of test/skills) on a temporary copy of the repository.
let sandbox = "";
function runContracts() {
  return spawnSync(process.execPath, [path.join(REPO, "node_modules/vitest/vitest.mjs"), "run", "test/skills", "--testTimeout", "30000", "--root", sandbox], { cwd: sandbox, encoding: "utf8", env: GIT_ENV });
}

/** Runs the contract tests with each `[rel, from, to]` applied; true when they fail. */
function contractsFailWith(edits: ReadonlyArray<readonly [string, string, string]>): boolean {
  const originals = edits.map(([rel, from, to]) => {
    const file = path.join(sandbox, rel);
    const original = readFileSync(file, "utf8");
    expect(original.split(from).length - 1, `${rel}: the mutated sentence occurs once`).toBe(1);
    writeFileSync(file, original.replace(from, to));
    return [file, original] as const;
  });
  try {
    return runContracts().status !== 0;
  } finally {
    for (const [file, original] of originals) writeFileSync(file, original);
  }
}

describe("the contract tests turn red when a lane-branch rule sentence added in round 3 is reversed or deleted", () => {
  beforeAll(() => {
    sandbox = mkdtempSync(path.join(tmpdir(), "verify-v530-r4-skills-mut-"));
    for (const rel of ["bin", "dist", "docs", "scripts", "skills", ".agents", "src", "test", "package.json", "package-lock.json", "tsconfig.json", "tsconfig.test.json", "vitest.config.ts", "CLAUDE.md", "AGENTS.md", "agents.md", "README.md", ".gitignore"]) {
      if (existsSync(path.join(REPO, rel))) cpSync(path.join(REPO, rel), path.join(sandbox, rel), { recursive: true });
    }
    rmSync(path.join(sandbox, "test", "verify"), { recursive: true, force: true });
    symlinkSync(path.join(REPO, "node_modules"), path.join(sandbox, "node_modules"), "junction");
    git(sandbox, ["init", "-q"]);
    git(sandbox, ["add", "-A"]);
    git(sandbox, ["commit", "-q", "-m", "copy"]);
    // Baseline: the unmutated copy must pass, or a red mutation run proves nothing.
    const baseline = runContracts();
    if (baseline.status !== 0) throw new Error(`the contract tests do not pass on the unmutated copy: ${baseline.stdout.slice(-2000)}`);
  }, 600000);
  afterAll(() => {
    if (sandbox !== "") rmSync(sandbox, { recursive: true, force: true });
  });

  // worktree-lane.md §2 ("만들기 — 기본 HEAD 를 믿지 않는다"): the rule for a worktree the runtime already made.
  const LANE_KO = ["`git -C <lane-root> switch -C <branch> <branch>` 로 브랜치를 움직이지 않는다", "`git -C <lane-root> switch -C <branch> <base_sha>` 로 브랜치를 base 로 되돌린다"] as const;
  const LANE_EN = ["`git -C <lane-root> switch -C <branch> <branch>` leaves the branch where it is", "`git -C <lane-root> switch -C <branch> <base_sha>` resets the branch"] as const;
  const LANE_CASES: ReadonlyArray<readonly [string, ReadonlyArray<readonly [string, string, string]>]> = [
    ["skills/claude", [["skills/claude/_shared/kiwi/worktree-lane.md", ...LANE_KO]]],
    ["skills/etc", [["skills/etc/_shared/kiwi/worktree-lane.md", ...LANE_EN]]],
    ["skills/codex and its .agents mirror", [["skills/codex/_shared/kiwi/worktree-lane.md", ...LANE_EN], [".agents/skills/_shared/kiwi/worktree-lane.md", ...LANE_EN]]]
  ];
  for (const [label, edits] of LANE_CASES) {
    // Corpus: skills/{claude,codex,etc}/_shared/kiwi/worktree-lane.md §2 and .agents/skills/_shared/kiwi/worktree-lane.md §2.
    // @req FR-FLOW-216 AC-3 — … SHALL keep the lane branch where it is only when `<base_sha>` is its ancestor.
    it(`${label}: reversing worktree-lane §2's runtime-worktree attach rule fails the contract tests`, () => {
      expect(contractsFailWith(edits), `${label}: worktree-lane §2 runtime line reversed`).toBe(true);
    }, 300000);
  }

  // Lead decision (final round 4): the kiwi-orchestrator §18 sentence is gone — §18 cites worktree-lane.md §2, the one place
  // holding the lane-branch commands. The property kept is the defect's: removing the host's attach rule (the command that
  // checks an existing lane branch out without moving it) turns the contract tests red.
  const HOST_ATTACH_KO = ["   - 붙인다: `git worktree add <lane-root> <branch>`\n", ""] as const;
  const HOST_ATTACH_EN = ["   - Attach: `git worktree add <lane-root> <branch>`\n", ""] as const;
  const ORCH_CASES: ReadonlyArray<readonly [string, ReadonlyArray<readonly [string, string, string]>]> = [
    ["skills/claude", [["skills/claude/_shared/kiwi/worktree-lane.md", ...HOST_ATTACH_KO]]],
    ["skills/etc", [["skills/etc/_shared/kiwi/worktree-lane.md", ...HOST_ATTACH_EN]]],
    ["skills/codex and its .agents mirror", [["skills/codex/_shared/kiwi/worktree-lane.md", ...HOST_ATTACH_EN], [".agents/skills/_shared/kiwi/worktree-lane.md", ...HOST_ATTACH_EN]]]
  ];
  for (const [label, edits] of ORCH_CASES) {
    // Corpus: skills/{claude,codex,etc}/_shared/kiwi/worktree-lane.md §2 case 1 and .agents/skills/_shared/kiwi/worktree-lane.md §2.
    // @req FR-FLOW-216 AC-3 — … SHALL keep the lane branch where it is only when `<base_sha>` is its ancestor.
    it(`${label}: deleting worktree-lane §2's host attach command fails the contract tests`, () => {
      expect(contractsFailWith(edits), `${label}: worktree-lane §2 host attach line deleted`).toBe(true);
    }, 300000);
  }
});
