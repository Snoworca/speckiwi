import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { laneProcedure, runLaneProcedure } from "./lane-branch-ssot.js";
import { laneIdOf } from "../../src/core/orchestrator/lane-plan.js";
import { appendFile } from "node:fs/promises";
import { writeUnder } from "../core/orchestrator/sds-fixtures.js";
import { digestOf, graphOf, node, orchestrate, waveLine, workGraphWorkspace, type RequirementSpec } from "../cli/wave-graph-fixtures.js";

// Independent verification of FR-FLOW-208..223 (5.3.0), final round 3, skills bundle.
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

describe("FR-FLOW-218 AC-4 — a wave re-entry r{m} runs on its own dispatch base after PW-6 step 1", () => {
  // Corpus: skills/{claude,codex,etc}/_shared/kiwi/parallel-waves.md and .agents/skills/_shared/kiwi/parallel-waves.md —
  // §3 (a re-entry is a stage holding that wave node alone, its input commit is the new dispatch base, a new stage lock is
  // written), PW-5 (the card's branch is kiwi/orch/{run_id}/{laneId} from the lock), PW-6 step 1 (when the lane branch
  // exists, `switch -C <branch> <branch>` and leave it where it is), PW-8 ("base 가 head 의 조상이다"), PW-9 (--no-ff merge),
  // PW-11 (`git worktree remove`, the branch stays). The lane id the lock gives a wave is laneIdOf(waveId) in
  // src/core/orchestrator/lane-plan.ts — the same for the first dispatch of wave-1 and for its re-entry.
  const CONTRACTS = ["skills/claude", "skills/codex", "skills/etc", ".agents/skills"];
  for (const root of CONTRACTS) {
    // @req FR-FLOW-218 AC-4 — an AC change on a requirement of the current wave that is not verified [is routed] to an AC
    // edit and re-entry `r{m}` of that wave.
    it(`${root}: after PW-6 step 1 the re-entry worker's HEAD holds the re-entry dispatch base`, () => {
      // Lead decision (final round 4): PW-6 step 1 cites worktree-lane.md §2, the one place holding the lane-branch commands
      // (round 3 had them inline). The property kept is the defect's: after the lane is prepared as the contract orders, the
      // re-entry worker's HEAD holds the re-entry dispatch base.
      expect(read(`${root}/_shared/kiwi/parallel-waves.md`), `${root}: PW-6 cites worktree-lane.md §2`).toMatch(/worktree-lane\.md` ?§2/);
      const procedure = laneProcedure(root, "runtime");
      expect([procedure.probe, procedure.attach, procedure.recreate].every((c) => c !== ""), `${root}: §2 runtime case commands`).toBe(true);

      const laneId = laneIdOf("r1-wave-1");
      const branch = `kiwi/orch/r1/${laneId}`;
      const scratch = mkdtempSync(path.join(tmpdir(), "verify-v530-r3-skills-"));
      const main = path.join(scratch, "repo");
      try {
        spawnSync("git", ["init", "-q", "-b", "main", main], { env: GIT_ENV });
        mkdirSync(path.join(main, "docs", "spec"), { recursive: true });
        writeFileSync(path.join(main, "docs", "spec", "60.flow.srs.md"), "AC-1: WHEN x THE SYSTEM SHALL y.\n");
        git(main, ["add", "-A"]);
        git(main, ["commit", "-q", "-m", "wave-1 inputs"]);
        const firstBase = git(main, ["rev-parse", "HEAD"]).trim();

        // First dispatch of wave-1: the worker lands FR-X-001 (test commit, then implementation commit).
        const lane1 = path.join(scratch, "lane-1");
        git(main, ["worktree", "add", "-q", lane1, "-b", branch, firstBase]);
        laneCommit(lane1, "a.test.ts", "FR-X-001", "test", laneId);
        laneCommit(lane1, "a.ts", "FR-X-001", "implementation", laneId);
        git(main, ["merge", "-q", "--no-ff", "-m", "integrate wave-1", branch]); // PW-9
        git(main, ["worktree", "remove", "--force", lane1]); // PW-11 — the lane branch stays

        // PW-13 routes an AC change on FR-X-001 to an AC edit and re-entry r1 (PW-3: the input commit is the new base).
        writeFileSync(path.join(main, "docs", "spec", "60.flow.srs.md"), "AC-1: WHEN x THE SYSTEM SHALL z.\n");
        git(main, ["commit", "-q", "-am", "re-entry r1 inputs"]);
        const reentryBase = git(main, ["rev-parse", "HEAD"]).trim();

        // The re-entry worker gets a fresh worktree and runs PW-6 step 1 as written for an existing lane branch.
        const lane2 = path.join(scratch, "lane-2");
        git(main, ["worktree", "add", "-q", "--detach", lane2, reentryBase]);
        const chosen = runLaneProcedure(procedure, lane2, { laneRoot: lane2, branch, base: reentryBase }, GIT_ENV);

        // PW-8: "base 가 head 의 조상이다" — the verdict line the re-entry worker must pass.
        expect(isAncestor(lane2, reentryBase, "HEAD"), `${root}: re-entry base is an ancestor of HEAD after \`${chosen}\``).toBe(true);
      } finally {
        spawnSync("git", ["-C", main, "worktree", "prune"], { env: GIT_ENV });
        rmSync(scratch, { recursive: true, force: true });
      }
    });
  }
});

describe("FR-FLOW-217 AC-3 — after a redecomposition written to another path, the contract's wave check passes on that version", () => {
  // Corpus: skills/{claude,codex,etc}/_shared/kiwi/wave-decomposition.md §6 and .agents/skills/_shared/kiwi/wave-decomposition.md
  // ("변경마다 그래프의 새 판을 같은 경로나 다른 경로에 쓰고, 그 판의 graph {path, digest} 를 실은 phase="redecompose" 줄을 …
  // 덧붙인 뒤, 다음 dispatch 전에 orchestrate wave check 와 orchestrate schedule waves 를 다시 통과시킨다") and
  // parallel-waves.md PW-4, whose wave check call is fixed to `--waves {artifact_root}waves/waves.json`. The redecompose line
  // shape is the one test/cli/orchestrate-wave-actions.fr-node-251.test.ts uses.
  const CONTRACTS = ["skills/claude", "skills/codex", "skills/etc", ".agents/skills"];
  const DISPATCHED: RequirementSpec = { id: "FR-ARCH-001", acs: [{ n: 1, checked: false }] };
  const ADDED: RequirementSpec = { id: "FR-ARCH-002", acs: [{ n: 1, checked: false }] };
  for (const root of CONTRACTS) {
    // @req FR-FLOW-217 AC-3 — EVERY such change SHALL write a new graph version, over the same path or to another path, append a
    // `phase="redecompose"` line that carries that version's `graph {path, digest}`, and pass `orchestrate wave check` and
    // `schedule waves` before the next dispatch.
    it(`${root}: PW-4's wave check, as written, passes on the R3 version written to another path`, async () => {
      const contract = read(`${root}/_shared/kiwi/parallel-waves.md`);
      const check = /`speckiwi (orchestrate wave check [^`]+)`/.exec(contract)?.[1] ?? "";
      expect(check, `${root}: PW-4 wave check`).toContain("--waves {artifact_root}waves/waves.json");
      // Lead decision (round 3): wave-decomposition §6 now writes every new version over the same path, which FR-FLOW-217 AC-3
      // allows. The property kept is the defect's: the version a redecomposition writes, at the path §6 gives, passes PW-4's check.
      const section6 = read(`${root}/_shared/kiwi/wave-decomposition.md`)
        .split("\n")
        .find((line) => line.includes('phase="redecompose"') && line.includes("waves.json")) ?? "";
      const versionPath = /`\{artifact_root\}(waves\/[^`]+\.json)`/.exec(section6)?.[1] ?? "";
      expect(versionPath, `${root}: §6 names the path a new version is written to`).not.toBe("");

      // wave-1 is dispatched; the incremental authoring added FR-ARCH-002 whose files overlap only wave-1, so R3 gives it a new node.
      const { root: ws } = await workGraphWorkspace({
        requirements: [DISPATCHED, ADDED],
        graph: graphOf([node(1, ["FR-ARCH-001 AC-1"])]),
        lines: [waveLine(1, "in_progress", { phase: "worker", stage: 1, lane: "lane-r1-wave-1" })]
      });
      try {
        const v2 = `${JSON.stringify(graphOf([node(1, ["FR-ARCH-001 AC-1"]), node(2, ["FR-ARCH-002 AC-1"])]), null, 2)}\n`;
        await writeUnder(ws, versionPath, v2);
        await appendFile(path.join(ws, "kiwi", "waves.jsonl"), `${JSON.stringify(waveLine(1, "in_progress", { ts: "2026-11-05T02:00:00.000Z", phase: "redecompose", graph: { path: versionPath, digest: digestOf(v2) } }))}\n`);

        const control = await orchestrate(ws, ["wave", "check", "--waves", versionPath, "--run-id", "r1"]);
        expect(control.exit, `control — the R3 version itself: ${JSON.stringify(control.payload)}`).toBe(0);

        const argv = check.replaceAll("{artifact_root}", "").replaceAll("{run_id}", "r1").split(/\s+/).slice(1).filter((arg) => arg !== "--json");
        const run = await orchestrate(ws, argv);
        expect(run.exit, `${root}: \`${check}\` -> ${JSON.stringify(run.payload).slice(0, 400)}`).toBe(0);
      } finally {
        rmSync(ws, { recursive: true, force: true });
      }
    });
  }
});
