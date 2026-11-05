import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { laneProcedure, runLaneProcedure } from "./lane-branch-ssot.js";

// Independent verification of FR-FLOW-208..223 (5.3.0), final round 2, skills bundle.
// Every test here is meant to be red. Nothing in the repository is changed: git runs in temporary directories.

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (rel: string): string => readFileSync(path.join(REPO, rel), "utf8").replace(/\r\n/g, "\n");

const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: "v", GIT_AUTHOR_EMAIL: "v@example.invalid", GIT_COMMITTER_NAME: "v", GIT_COMMITTER_EMAIL: "v@example.invalid" };
function git(cwd: string, args: readonly string[]): string {
  const run = spawnSync("git", args, { cwd, env: GIT_ENV, encoding: "utf8" });
  if (run.status !== 0) throw new Error(`git ${args.join(" ")}: ${run.stderr}`);
  return run.stdout;
}

/** A commit as kiwi-pm §1.5 makes it under --commit-lane-work: REQ and Commit-Kind plus the run coordinates as trailers. */
function laneCommit(cwd: string, file: string, req: string, kind: "test" | "implementation"): void {
  writeFileSync(path.join(cwd, file), `// ${req} ${kind}\n`);
  git(cwd, ["add", "--", file]);
  const trailers = `REQ: ${req}\nCommit-Kind: ${kind}\nOrch-Run: r1\nOrch-Wave: wave-1\nOrch-Stage: 1\nOrch-Lane: lane-1`;
  git(cwd, ["commit", "-q", "-m", `${kind} for ${req}`, "-m", trailers]);
}

/** The §6 resume cursor: the requirements with an implementation commit on the lane branch, and those with only a test commit. */
function cursor(cwd: string, branch: string): { done: string[]; testOnly: string[] } {
  const rows = git(cwd, ["log", branch, "--format=%(trailers:key=REQ,valueonly,separator=)%x1f%(trailers:key=Commit-Kind,valueonly,separator=)%x1e"])
    .split("\x1e")
    .map((row) => row.trim().split("\x1f").map((cell) => cell.trim()))
    .filter(([req]) => req !== undefined && req !== "");
  const kinds = new Map<string, Set<string>>();
  for (const [req, kind] of rows) kinds.set(req as string, (kinds.get(req as string) ?? new Set()).add(kind ?? ""));
  const done = [...kinds].filter(([, set]) => set.has("implementation")).map(([req]) => req).sort();
  const testOnly = [...kinds].filter(([, set]) => set.has("test") && !set.has("implementation")).map(([req]) => req).sort();
  return { done, testOnly };
}

describe("FR-FLOW-216 AC-3 — a re-dispatched worker, doing PW-6 in order, still finds its requirement-ID commits", () => {
  // Corpus: skills/{claude,codex,etc}/_shared/kiwi/parallel-waves.md and .agents/skills/_shared/kiwi/parallel-waves.md —
  // PW-6 step 1 (`git -C <worktree> switch -C kiwi/orch/{run_id}/{laneId} <base_sha>`, unconditional, "in this order")
  // and §6 (the resume cursor is the REQ / Commit-Kind trailer commits on the lane branch); the lane worktree is made
  // with `git worktree add <lane-root> -b kiwi/orch/{run_id}/{laneId} <base_sha>` (skills/claude/_shared/kiwi/worktree-lane.md §2),
  // the trailers are skills/claude/kiwi-pm/SKILL.md §1.5.
  const CONTRACTS = ["skills/claude", "skills/codex", "skills/etc", ".agents/skills"];
  for (const root of CONTRACTS) {
    // @req FR-FLOW-216 AC-3 — ON resume, THE worker SHALL treat as done each requirement whose implementation commit with
    // its ID trailer is on the lane branch, SHALL resume a requirement that has only its test commit at its implementation.
    it(`${root}: after PW-6 step 1 the lane branch still shows the landed requirement done and the test-only one resumable`, () => {
      // Lead decision (final round 4): PW-6 step 1 cites worktree-lane.md §2, the one place holding the lane-branch commands.
      // The property kept is the defect's: a re-dispatched worker preparing its lane as the contract orders keeps the cursor.
      expect(read(`${root}/_shared/kiwi/parallel-waves.md`), `${root}: PW-6 cites worktree-lane.md §2`).toMatch(/worktree-lane\.md` ?§2/);
      const procedure = laneProcedure(root, "runtime");
      expect([procedure.probe, procedure.attach, procedure.recreate].every((c) => c !== ""), `${root}: §2 runtime case commands`).toBe(true);

      const scratch = mkdtempSync(path.join(tmpdir(), "verify-v530-r2-skills-"));
      try {
        const main = path.join(scratch, "repo");
        const lane = path.join(scratch, "lane-1");
        spawnSync("git", ["init", "-q", "-b", "main", main], { env: GIT_ENV });
        git(main, ["commit", "-q", "--allow-empty", "-m", "dispatch base"]);
        const base = git(main, ["rev-parse", "HEAD"]).trim();
        git(main, ["worktree", "add", "-q", lane, "-b", "kiwi/orch/r1/lane-1", base]);
        // The first worker landed FR-X-001 and committed only the test of FR-X-002, then stopped.
        laneCommit(lane, "a.test.ts", "FR-X-001", "test");
        laneCommit(lane, "a.ts", "FR-X-001", "implementation");
        laneCommit(lane, "b.test.ts", "FR-X-002", "test");
        expect(cursor(lane, "kiwi/orch/r1/lane-1"), "control: the cursor before the re-dispatch").toEqual({ done: ["FR-X-001"], testOnly: ["FR-X-002"] });

        // The re-dispatched worker runs PW-6 from step 1, as the contract writes it.
        const chosen = runLaneProcedure(procedure, lane, { laneRoot: lane, branch: "kiwi/orch/r1/lane-1", base }, GIT_ENV);

        expect(cursor(lane, "kiwi/orch/r1/lane-1"), `${root}: the §6 cursor after \`${chosen}\``).toEqual({ done: ["FR-X-001"], testOnly: ["FR-X-002"] });
      } finally {
        spawnSync("git", ["-C", path.join(scratch, "repo"), "worktree", "remove", "--force", path.join(scratch, "lane-1")], { env: GIT_ENV });
        rmSync(scratch, { recursive: true, force: true });
      }
    });
  }
});

describe("FR-FLOW-222 AC-5 — kiwi-wave-master reads resume state through wave status, not waves.jsonl", () => {
  // Corpus: skills/{claude,codex,etc}/kiwi-wave-master/SKILL.md, the paragraph under the Phase overview
  // ("재개 시 Phase 0 에서 `waves.jsonl` 을 읽어 첫 미완료 wave 로 곧바로 점프하고 …").
  for (const rel of ["skills/claude/kiwi-wave-master/SKILL.md", "skills/codex/kiwi-wave-master/SKILL.md", "skills/etc/kiwi-wave-master/SKILL.md"]) {
    // @req FR-FLOW-222 AC-5 — BOTH skills SHALL read progress and resume state through `speckiwi orchestrate wave status --json`
    // and SHALL NOT read `kiwi/waves.jsonl` or the graph file by hand.
    it(`${rel}: no line tells the resume to read waves.jsonl itself`, () => {
      const handReads = read(rel)
        .split("\n")
        .filter((line) => /재개|resume/i.test(line) && /`(?:\.\/)?(?:kiwi\/)?waves\.jsonl` ?을 읽/.test(line));
      expect(handReads).toEqual([]);
    });
  }
});

describe("FR-FLOW-220 AC-7 — kiwi-orchestrator's final verification has no design-baseline denominator", () => {
  // Corpus: skills/{claude,codex,etc}/kiwi-orchestrator/SKILL.md and .agents/skills/kiwi-orchestrator/SKILL.md — §6.1
  // ("적게 센 `design_items[]` 는 loop D·P·F 의 모든 동결 분모를 줄이는데") and §13.4 amend-design step 4
  // ("옛 설계 항목 위에 동결되었던 loop W · P · F 의 분모를 새 lock 에서 다시 동결").
  for (const rel of ["skills/claude/kiwi-orchestrator/SKILL.md", "skills/codex/kiwi-orchestrator/SKILL.md", "skills/etc/kiwi-orchestrator/SKILL.md", ".agents/skills/kiwi-orchestrator/SKILL.md"]) {
    // @req FR-FLOW-220 AC-7 — THE final verification after the last node SHALL use the same checks and verifier model over the
    // union of the run's ACs and every integration item, with no design-baseline denominator.
    it(`${rel}: no line freezes loop F's denominator over the design items`, () => {
      const designDenominators = read(rel)
        .split("\n")
        .filter((line) => /loop\s*\**\s*(?:[DWP]\s*·\s*)*F\b/.test(line) && line.includes("분모") && /design_items|설계 항목/.test(line) && !line.includes("분모는 없다"));
      expect(designDenominators).toEqual([]);
    });
  }
});
