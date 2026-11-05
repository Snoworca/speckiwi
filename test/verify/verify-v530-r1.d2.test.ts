import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { firstLineFor, graphOf, node, orchestrate, waveLine, workGraphWorkspace, type RequirementSpec } from "../cli/wave-graph-fixtures.js";

// Independent verification of FR-FLOW-212..223 (5.3.0), round 1, bundle d2.
// Every test here is meant to be red. Nothing in the repository is changed: the tool runs on temporary
// workspaces and the mutation runs on a temporary copy of the skills.

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (rel: string): string => readFileSync(path.join(REPO, rel), "utf8").replace(/\r\n/g, "\n");

describe("FR-FLOW-216 AC-2 — kiwi-pm's close-out makes the per-requirement commits §1.5 defines", () => {
  // Corpus: skills/claude/kiwi-pm/SKILL.md §6.1; skills/{codex,etc}/kiwi-pm/references/extended-workflow.md
  // and .agents/skills/kiwi-pm/references/extended-workflow.md §6.1.
  const SECTION_6_1 = ["skills/claude/kiwi-pm/SKILL.md", "skills/codex/kiwi-pm/references/extended-workflow.md", "skills/etc/kiwi-pm/references/extended-workflow.md", ".agents/skills/kiwi-pm/references/extended-workflow.md"];
  for (const rel of SECTION_6_1) {
    // @req FR-FLOW-216 AC-2 — --commit-lane-work produces two commits per requirement (test, then implementation).
    // §6.1 is where the run's result is fixed and the commit is made; it must not tell kiwi-pm to make one commit.
    it(`${rel}: §6.1 does not make a single --commit-lane-work commit`, () => {
      const sentence = read(rel).split("\n").find((line) => line.includes("`--commit-lane-work` 가 있고 `run.status = \"done\"` 이면")) ?? "";
      expect(sentence, `${rel}: §6.1 commit sentence`).not.toBe("");
      expect(sentence).not.toMatch(/commit 1개/);
    });
  }
});

describe("FR-FLOW-222 AC-2 — a wave-master host can run the completion-action read the shared contract gives", () => {
  // Corpus: skills/{claude,codex,etc}/_shared/kiwi/parallel-waves.md §5.1 (the `wave actions` command) and
  // skills/{claude,codex,etc}/kiwi-wave-master/SKILL.md §3 · §5 (the only places that add `--engine`).
  const DONE: RequirementSpec = { id: "FR-ARCH-001", acs: [{ n: 1, checked: true }], covers: "all" };
  const WM = { engine: "kiwi-wave-master" };
  for (const root of ["skills/claude", "skills/codex", "skills/etc"]) {
    // @req FR-FLOW-222 AC-2 — after a node's complete line the host calls `orchestrate wave actions --json` and
    // performs each due action. kiwi-wave-master journals under engine kiwi-wave-master, the tool defaults to
    // kiwi-orchestrator, and neither §5.1 nor kiwi-wave-master adds `--engine` to this call.
    it(`${root}: the §5.1 wave actions call, as kiwi-wave-master is told to run it, reports the due action`, async () => {
      const contract = read(`${root}/_shared/kiwi/parallel-waves.md`);
      const skill = read(`${root}/kiwi-wave-master/SKILL.md`);
      const command = /`speckiwi orchestrate (wave actions [^`]+)`/.exec(contract)?.[1] ?? "";
      expect(command, `${root}: §5.1 command`).not.toBe("");
      const argv = command.replaceAll("{artifact_root}", "").replaceAll("{run_id}", "r1").split(/\s+/);
      const told = [contract, skill].some((text) => text.split("\n").some((line) => line.includes("wave actions") && line.includes("--engine kiwi-wave-master")));
      if (told) argv.push("--engine", "kiwi-wave-master");

      const graph = graphOf([node(1, ["FR-ARCH-001 AC-1"], { on_complete: [{ kind: "notify", id: "tell", channel: "team-chat" }] })]);
      const graphText = `${JSON.stringify(graph, null, 2)}\n`;
      const { root: ws } = await workGraphWorkspace({
        requirements: [DONE],
        graph,
        firstLine: firstLineFor(graphText, WM),
        lines: [waveLine(1, "complete", WM)],
        files: { "test/cite.test.ts": "// @req FR-ARCH-001 AC-1\n" }
      });
      // Control: the same journal read under its own engine has the action due, so a failure below is the call.
      const control = await orchestrate(ws, [...argv.slice(0, 2), "--waves", "waves/waves.json", "--run-id", "r1", "--engine", "kiwi-wave-master"]);
      expect(control.exit, JSON.stringify(control.payload)).toBe(0);

      const run = await orchestrate(ws, argv);
      expect(run.exit, `${root}: ${argv.join(" ")} -> ${JSON.stringify(run.payload)}`).toBe(0);
      expect((run.payload.actions as Array<{ state: string }> | undefined)?.map((row) => row.state)).toEqual(["due"]);
    });
  }
});

// Mutation runs of this bundle's contract tests on a temporary copy of the skills.
const CONTRACTS = readdirSync(path.join(REPO, "test/skills"))
  .filter((name) => /\.fr-flow-2(1[2-9]|2[0-3])\.test\.ts$/.test(name))
  .map((name) => `test/skills/${name}`);
let sandbox = "";

function runContracts() {
  return spawnSync(process.execPath, [path.join(REPO, "node_modules/vitest/vitest.mjs"), "run", ...CONTRACTS, "--root", sandbox], { cwd: sandbox, encoding: "utf8" });
}

beforeAll(() => {
  sandbox = mkdtempSync(path.join(tmpdir(), "verify-v530-d2-"));
  // Lead decision (final round): the bundle's contract tests now read the SRS, the PRD and the git history too, so the copy
  // holds what the round-4 harness copies (verify-v530-r4.skills.test.ts) and is made a git repository.
  for (const rel of ["bin", "dist", "docs", "scripts", "skills", ".agents", "src", "test", "package.json", "package-lock.json", "tsconfig.json", "vitest.config.ts", "CLAUDE.md", "AGENTS.md", "agents.md", "README.md", ".gitignore"]) {
    if (existsSync(path.join(REPO, rel))) cpSync(path.join(REPO, rel), path.join(sandbox, rel), { recursive: true });
  }
  rmSync(path.join(sandbox, "test", "verify"), { recursive: true, force: true });
  symlinkSync(path.join(REPO, "node_modules"), path.join(sandbox, "node_modules"), "junction");
  for (const args of [["init", "-q"], ["add", "-A"], ["-c", "user.name=v", "-c", "user.email=v@example.invalid", "commit", "-q", "-m", "copy"]]) spawnSync("git", args, { cwd: sandbox });
  // Baseline: the unmutated copy must pass, or a red mutation run proves nothing.
  if (runContracts().status !== 0) throw new Error("the contract tests do not pass on the unmutated copy");
}, 180000);

afterAll(() => {
  if (sandbox !== "") rmSync(sandbox, { recursive: true, force: true });
});

/** Runs the contract tests on the sandbox with `from` replaced by `to` in `rel`; true when they fail. */
function contractsFailWith(rel: string, from: string, to: string): boolean {
  const file = path.join(sandbox, rel);
  const original = readFileSync(file, "utf8");
  expect(original.split(from).length - 1, `${rel}: the mutated sentence occurs once`).toBe(1);
  writeFileSync(file, original.replace(from, to));
  try {
    return runContracts().status !== 0;
  } finally {
    writeFileSync(file, original);
  }
}

describe("the contract tests turn red when a rule sentence of a rule section is reversed, hedged or weakened", () => {
  // Corpus: skills/claude/_shared/kiwi/parallel-waves.md §5 PW-1.
  // @req FR-FLOW-218 AC-3 — the stage's incremental kiwi-srs call runs once, serially; reversing PW-1's ban.
  it("reversing PW-1's 'never in parallel' fails the contract tests", () => {
    expect(contractsFailWith("skills/claude/_shared/kiwi/parallel-waves.md", "**절대 병렬로 돌리지 않는다**", "**병렬로 돌려도 된다**")).toBe(true);
  }, 120000);

  // Corpus: skills/claude/_shared/kiwi/wave-decomposition.md §2 step 8.
  // @req FR-FLOW-222 AC-1 — wave check before dispatch, stopping on any error diagnostic; weakening "any" to "several".
  it("weakening §2 step 8's 'any error diagnostic' fails the contract tests", () => {
    expect(contractsFailWith("skills/claude/_shared/kiwi/wave-decomposition.md", "error 진단이 하나라도 있으면 dispatch 하지 않고", "error 진단이 여럿 있으면 dispatch 하지 않고")).toBe(true);
  }, 120000);

  // Corpus: skills/claude/kiwi-wave-master/SKILL.md §8.
  // @req FR-FLOW-214 AC-1 — sub-issues are PRD item hints and no wave is extracted from them; inserting an exception.
  it("hedging §8's sub-issue rule with an exception fails the contract tests", () => {
    expect(
      contractsFailWith(
        "skills/claude/kiwi-wave-master/SKILL.md",
        "에픽의 하위 이슈는 PRD 항목의 힌트로만 넘긴다",
        "에픽의 하위 이슈는 PRD 항목의 힌트로 넘기거나, 하위 이슈가 많으면 하위 이슈마다 노드 하나로 나눈다"
      )
    ).toBe(true);
  }, 120000);

  // Corpus: skills/claude/_shared/kiwi/parallel-waves.md §5, the paragraph after PW-17.
  // @req FR-FLOW-222 AC-2 — after a node's complete line the host runs the due completion actions; hedging it.
  it("hedging 'then runs §5.1's completion actions' fails the contract tests", () => {
    expect(contractsFailWith("skills/claude/_shared/kiwi/parallel-waves.md", "이어서 §5.1 의 완료 행동을 돈다.", "필요하면 §5.1 의 완료 행동을 돈다.")).toBe(true);
  }, 120000);

  // Corpus: skills/claude/_shared/kiwi/parallel-waves.md §5.1.
  // @req FR-FLOW-222 AC-2 — THE host appends the intent line, performs the action and appends the result line
  // (workers never write the journal, FR-FLOW-223 AC-1); reversing "host only" to "host or worker".
  it("reversing §5.1's 'completion actions are the host's alone' fails the contract tests", () => {
    expect(contractsFailWith("skills/claude/_shared/kiwi/parallel-waves.md", "워커는 저널을 쓰지 않으므로 완료 행동은 호스트만 한다.", "완료 행동은 호스트나 워커가 한다.")).toBe(true);
  }, 120000);
});
