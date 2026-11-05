import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { digestOf, orchestrate, workGraphWorkspace } from "../cli/wave-graph-fixtures.js";
import { COMPACTION_TOKEN_BUDGET, estimateTokens } from "../skills/skill-token-estimate.js";

// Final round 7 — skills bundle (FR-FLOW-208 .. FR-FLOW-223). The commands and git steps the skills write are
// run as written in a temporary workspace, and the result is checked against the AC.

const REPO = path.resolve(import.meta.dirname, "../..");
const read = (relative: string): string => readFileSync(path.join(REPO, relative), "utf8");

const ARTIFACT_ROOT = "docs/analysis/kiwi-wave-master-r1/";
const GRAPH_PATH = `${ARTIFACT_ROOT}waves/waves.json`;
const LANE = "kiwi/orch/r1/lane-r1-wave-1";

function git(root: string, ...args: string[]): string {
  const run = spawnSync("git", ["-C", root, "-c", "user.email=v@v", "-c", "user.name=v", "-c", "core.autocrlf=false", ...args], { encoding: "utf8" });
  if (run.status !== 0) throw new Error(`git ${args.join(" ")}: ${run.stderr}`);
  return run.stdout.trim();
}

function isAncestor(root: string, base: string, branch: string): boolean {
  return spawnSync("git", ["-C", root, "merge-base", "--is-ancestor", base, branch]).status === 0;
}

/** A kiwi-wave-master worker dispatch line (kiwi-wave-master §5.5.6): lane, stage, isolation.base_sha, sds_id. */
function dispatchLine(extra: Record<string, unknown>): Record<string, unknown> {
  return {
    schema_version: "2.0.0",
    run_id: "r1",
    engine: "kiwi-wave-master",
    wave: "wave-1",
    order: 1,
    target: "v1.0.0",
    status: "in_progress",
    phase: "worker",
    lane: "lane-r1-wave-1",
    summary: "wave-1 dispatched",
    ...extra
  };
}

/** parallel-waves §6: a requirement is done when an implementation commit with its REQ trailer lies in `<base_sha>..<lane branch>`. */
function doneInRange(root: string, base: string, requirement: string): boolean {
  const bodies = git(root, "log", "--format=%B%x00", `${base}..${LANE}`).split("\0");
  return bodies.some((body) => body.includes(`REQ: ${requirement}`) && body.includes("Commit-Kind: implementation"));
}

describe("FR-FLOW-216 AC-3 — the dispatch base kiwi-wave-master reads for the resume cursor after a re-entry r{m}", () => {
  // Corpus: skills/{claude,codex,etc}/_shared/kiwi/parallel-waves.md §6 (and the .agents mirror): a caller without a card
  // (kiwi-wave-master) reads `<base_sha>` as the dispatch line's `isolation.base_sha` from the journal list of
  // `speckiwi orchestrate wave show --wave wave-{n} --full --json`; parallel-waves.md §3 (a re-entry runs PW-3 again and its
  // input commit is the new dispatch base) and PW-3 (the dispatch base is recorded in the journal `isolation.base_sha`);
  // skills/*/kiwi-wave-master/SKILL.md §5.5.6 (each worker dispatch appends a `phase="worker"` line carrying
  // `isolation.base_sha`; every worker and re-entry dispatch appends its line); worktree-lane.md §2 (a re-entry recreates
  // the lane branch at the new base); kiwi-pm `--commit-lane-work` trailers `REQ:` and `Commit-Kind:`.
  for (const root of ["skills/claude", "skills/codex", "skills/etc", ".agents/skills"]) {
    // @req FR-FLOW-216 AC-3
    it(`${root}: after a re-entry r1 is dispatched and interrupted, the base read from wave show --full does not count the first dispatch's merged implementation as done`, async () => {
      const contract = read(`${root}/_shared/kiwi/parallel-waves.md`);
      // Lead decision (round 7): §6 now reads the resume base from the node row's `base_sha` of `wave status` (IR-CLI-113 AC-11,
      // the latest dispatch line's isolation.base_sha) instead of the journal list of `wave show --full`. The property kept is
      // the defect's: the base the contract reads after an interrupted re-entry counts the first dispatch's merged work as not done.
      const lines = contract.split("\n");
      const ruleLine = lines.find((line) => line.includes("`base_sha`") && line.includes("`wave status`") && line.includes("isolation.base_sha")) ?? "";
      expect(ruleLine, `${root}: §6 base rule`).not.toBe("");
      const statusLine = lines.find((line) => /`speckiwi orchestrate wave status [^`]*--run-id \{run_id\}[^`]*`/.test(line)) ?? "";
      const command = /`speckiwi orchestrate (wave status [^`]*)`/.exec(statusLine)?.[1] ?? "";
      expect(command, `${root}: §6 wave status command`).not.toBe("");

      const graph = {
        schema_version: "2.0.0",
        run_id: "r1",
        title: "graph",
        scope: { target: "v1.0.0" },
        nodes: [{ wave: "wave-1", title: "node 1", purpose: "purpose 1", acs: ["FR-ARCH-001 AC-1"], done_when: [], files: ["src/a.ts"] }],
        edges: []
      };
      const graphText = `${JSON.stringify(graph, null, 2)}\n`;
      const { root: ws } = await workGraphWorkspace({
        requirements: [{ id: "FR-ARCH-001", acs: [{ n: 1 }] }],
        noJournal: true,
        files: { [GRAPH_PATH]: graphText, "src/a.ts": "export const a = 1;\n", ".gitignore": "kiwi/\n" }
      });
      git(ws, "init", "-q", "-b", "main");
      git(ws, "add", "-A");
      git(ws, "commit", "-qm", "base");

      // First dispatch: PW-3 input commit = dispatch base B0, recorded on the worker line (§5.5.6).
      git(ws, "commit", "-q", "--allow-empty", "-m", "commit-wave-inputs wave-1", "-m", "Orch-Run: r1\nOrch-Verb: commit-wave-inputs\nOrch-Wave: wave-1");
      const b0 = git(ws, "rev-parse", "HEAD");
      const first = await orchestrate(ws, ["journal", "append", "--run-id", "r1", "--payload", JSON.stringify(dispatchLine({ ts: "2026-11-05T01:00:00.000Z", stage: 1, sds_id: "r1-wave-1", isolation: { base_sha: b0 }, graph: { path: GRAPH_PATH, digest: digestOf(graphText) } }))]);
      expect(first.exit, JSON.stringify(first.payload)).toBe(0);
      // worktree-lane §2: no lane branch -> create it at B0. The worker leaves a test commit and an implementation commit.
      git(ws, "branch", LANE, b0);
      git(ws, "switch", "-q", LANE);
      await import("node:fs/promises").then((fs) => fs.writeFile(path.join(ws, "src/a.test.ts"), "// FR-ARCH-001 AC-1\n"));
      git(ws, "add", "src/a.test.ts");
      git(ws, "commit", "-qm", "test FR-ARCH-001", "-m", "REQ: FR-ARCH-001\nCommit-Kind: test\nOrch-Run: r1");
      await import("node:fs/promises").then((fs) => fs.writeFile(path.join(ws, "src/a.ts"), "export const a = 2;\n"));
      git(ws, "add", "src/a.ts");
      git(ws, "commit", "-qm", "impl FR-ARCH-001", "-m", "REQ: FR-ARCH-001\nCommit-Kind: implementation\nOrch-Run: r1");
      // PW-9: --no-ff merge into the integration branch.
      git(ws, "switch", "-q", "main");
      git(ws, "merge", "-q", "--no-ff", "-m", "merge wave-1", LANE);

      // Re-entry r1 (an AC change on the current wave's requirement): PW-3 again, new dispatch base B1, a new worker line.
      git(ws, "commit", "-q", "--allow-empty", "-m", "commit-wave-inputs wave-1 r1", "-m", "Orch-Run: r1\nOrch-Verb: commit-wave-inputs\nOrch-Wave: wave-1");
      const b1 = git(ws, "rev-parse", "HEAD");
      const second = await orchestrate(ws, ["journal", "append", "--run-id", "r1", "--payload", JSON.stringify(dispatchLine({ ts: "2026-11-05T02:00:00.000Z", stage: 2, sds_id: "r1-wave-1-r1", isolation: { base_sha: b1 } }))]);
      expect(second.exit, JSON.stringify(second.payload)).toBe(0);
      // worktree-lane §2: B1 is not an ancestor of the lane branch -> recreate it at B1. The worker is interrupted before any commit.
      expect(isAncestor(ws, b1, LANE)).toBe(false);
      git(ws, "branch", "-f", LANE, b1);

      // Resume: the §6 command as written, with kiwi-wave-master's engine argument (kiwi-wave-master §5).
      const argv = command
        .replaceAll("{artifact_root}waves/waves.json", GRAPH_PATH)
        .replaceAll("{run_id}", "r1")
        .split(/\s+/)
        .filter((token) => token !== "--json");
      const shown = await orchestrate(ws, [...argv, "--engine", "kiwi-wave-master"]);
      expect(shown.exit, JSON.stringify(shown.payload)).toBe(0);
      const row = ((shown.payload.waves as Array<Record<string, unknown>>) ?? []).find((entry) => entry.wave === "wave-1");
      const candidates = typeof row?.base_sha === "string" ? [row.base_sha] : [];
      expect(candidates.length, `${root}: wave-1 row base_sha`).toBeGreaterThan(0);

      // Control: the re-entry's own base counts nothing as done.
      expect(doneInRange(ws, b1, "FR-ARCH-001")).toBe(false);
      // AC-3: the requirement has no implementation commit of this dispatch, so it is not done — whichever dispatch line the rule reads.
      const verdicts = Object.fromEntries(candidates.map((base) => [base === b0 ? "first-dispatch base" : base === b1 ? "re-entry base" : base, doneInRange(ws, base, "FR-ARCH-001")]));
      expect(verdicts, `${root}: the base the §6 rule reads (wave status base_sha)`).toEqual(
        Object.fromEntries(Object.keys(verdicts).map((key) => [key, false]))
      );
    });
  }
});

describe("FR-FLOW-223 AC-1 — the resume rule of kiwi-wave-master's core rules block", () => {
  // Corpus: skills/{claude,codex,etc}/kiwi-wave-master/SKILL.md, the core rules block within the first 5,000 estimated tokens.
  for (const root of ["skills/claude", "skills/codex", "skills/etc"]) {
    // @req FR-FLOW-223 AC-1
    it(`${root}: the core block's resume rule reads resume state with speckiwi orchestrate wave status --json only`, () => {
      const text = read(`${root}/kiwi-wave-master/SKILL.md`);
      const resume = text.split("\n").find((line) => line.startsWith("- **재개**") || line.startsWith("- **Resume**")) ?? "";
      expect(resume, `${root}: resume bullet`).not.toBe("");
      expect(estimateTokens(text.slice(0, text.indexOf(resume) + resume.length))).toBeLessThanOrEqual(COMPACTION_TOKEN_BUDGET);
      const commands = [...resume.matchAll(/`((?:speckiwi orchestrate )?wave [a-z]+[^`]*)`/g)].map((match) => (match[1] as string).replace(/^speckiwi orchestrate /, ""));
      expect(commands, `${root}: ${resume}`).toEqual(["wave status --json"]);
    });
  }
});
