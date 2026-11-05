import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

// Independent verification of FR-FLOW-208..223 (5.3.0), final round 5, skills bundle.
// Nothing in the repository is changed: mutation runs use a temporary copy.

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (rel: string): string => readFileSync(path.join(REPO, rel), "utf8").replace(/\r\n/g, "\n");

// ---- mutation runs of the skill contract tests (all of test/skills) on temporary copies of the repository ----------

const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: "v", GIT_AUTHOR_EMAIL: "v@example.invalid", GIT_COMMITTER_NAME: "v", GIT_COMMITTER_EMAIL: "v@example.invalid" };
const COPIED = ["bin", "dist", "docs", "scripts", "skills", ".agents", "src", "test", "package.json", "package-lock.json", "tsconfig.json", "tsconfig.test.json", "vitest.config.ts", "CLAUDE.md", "AGENTS.md", "agents.md", "README.md", ".gitignore"];

function makeSandbox(): string {
  const sandbox = mkdtempSync(path.join(tmpdir(), "verify-v530-r5-skills-"));
  for (const rel of COPIED) if (existsSync(path.join(REPO, rel))) cpSync(path.join(REPO, rel), path.join(sandbox, rel), { recursive: true });
  rmSync(path.join(sandbox, "test", "verify"), { recursive: true, force: true });
  symlinkSync(path.join(REPO, "node_modules"), path.join(sandbox, "node_modules"), "junction");
  for (const args of [["init", "-q"], ["add", "-A"], ["commit", "-q", "-m", "copy"]]) spawnSync("git", args, { cwd: sandbox, env: GIT_ENV });
  return sandbox;
}

/** Runs all of test/skills in `sandbox`; resolves to the exit status. */
function runContracts(sandbox: string): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(REPO, "node_modules/vitest/vitest.mjs"), "run", "test/skills", "--testTimeout", "60000", "--maxWorkers", "6", "--root", sandbox], { cwd: sandbox, env: GIT_ENV, stdio: "ignore" });
    child.on("close", (code) => resolve(code ?? 1));
  });
}

/** Applies `[rel, from, to]` to a fresh copy and runs the contract tests there; true when they fail. */
async function contractsFailWith(rel: string, from: string, to: string): Promise<boolean> {
  const sandbox = makeSandbox();
  try {
    const file = path.join(sandbox, rel);
    const original = readFileSync(file, "utf8");
    expect(original.split(from).length - 1, `${rel}: the mutated sentence occurs once`).toBe(1);
    writeFileSync(file, original.replace(from, to));
    return (await runContracts(sandbox)) !== 0;
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
}

describe("FR-FLOW-221 AC-5 — no shipped kiwi-coder rendering or mirror names a severity in a stop id", () => {
  // Corpus: skills/{claude,codex,etc}/kiwi-coder/SKILL.md and .agents/skills/kiwi-coder/SKILL.md, the
  // `review-hop-start-residual-branches` paragraph, which names the stop id `close-reqs-critical-or-high-residual`.
  const CODER = ["skills/claude", "skills/codex", "skills/etc", ".agents/skills"].map((root) => `${root}/kiwi-coder/SKILL.md`);
  for (const rel of CODER) {
    // @req FR-FLOW-221 AC-5 — NO shipped rendering or mirror of these five documents SHALL contain … a stop id naming a severity.
    it(`${rel}: no stop id naming a severity`, () => {
      const ids = [...read(rel).matchAll(/`([a-z0-9]+(?:-[a-z0-9]+)+)`/g)].map((m) => m[1] ?? "");
      // `high-reasoning` is a reasoning-effort value, not a severity.
      const severityIds = [...new Set(ids.filter((id) => id !== "high-reasoning" && /(?:^|-)(?:critical|high|medium|low)(?:-|$)/.test(id)))];
      expect(severityIds).toEqual([]);
    });
  }
});

// Each row: [name, @req, corpus file, the rule sentence (from), the mutated sentence (to)]. Every mutation stays inside
// the rule's own section and adds an exception (hedge) to the rule sentence; the AC quoted with the row forbids the
// mutated behaviour.
type Mutation = readonly [name: string, req: string, rel: string, from: string, to: string];
const WD = "skills/claude/_shared/kiwi/wave-decomposition.md";
const PW = "skills/claude/_shared/kiwi/parallel-waves.md";
const WSR = "skills/claude/_shared/kiwi/wave-srs-registration.md";
const VL = "skills/claude/_shared/kiwi/verify-loop.md";
const MUTATIONS: readonly Mutation[] = [
  // @req FR-FLOW-213 AC-2 — corpus: skills/claude/_shared/kiwi/parallel-waves.md PW-4
  [
    "PW-4: an --auto exception that dispatches a node without its still-draft requirement",
    "FR-FLOW-213 AC-2 — a requirement still draft after that call SHALL stop the node at the requirement-not-ready refusal … before any worker is dispatched.",
    PW,
    "그 노드는 워커를 띄우기 전에 멈춘다.",
    "그 노드는 워커를 띄우기 전에 멈춘다. `--auto` 면 그 요구를 빼고 남은 요구로 그 노드를 띄운다."
  ],
  // @req FR-FLOW-217 AC-1 — corpus: skills/claude/_shared/kiwi/wave-decomposition.md §6
  [
    "wave-decomposition §6: a user-approval exception to 'a dispatched node's order, scope and dependencies never change'",
    "FR-FLOW-217 AC-1 — the order, scope and dependencies of any other node — dispatched, or already named by a journal line — SHALL NOT change.",
    WD,
    "의 순서 · 범위 · 의존은 바꾸지 않는다.",
    "의 순서 · 범위 · 의존은 바꾸지 않는다 — 사용자가 승인하면 바꿀 수 있다."
  ],
  // @req FR-FLOW-218 AC-2 — corpus: skills/claude/_shared/kiwi/wave-srs-registration.md §2
  [
    "wave-srs-registration §2: an --auto exception that keeps a delta without red-test or command-output evidence",
    "FR-FLOW-218 AC-2 — THE host SHALL drop, and name in its report, a delta whose evidence is not a red test or a command output.",
    WSR,
    "아닌 델타를 버리고 그 델타를 보고에 적는다.",
    "아닌 델타를 버리고 그 델타를 보고에 적는다. 다만 `--auto` 면 그 델타도 남겨 저작에 넣는다."
  ],
  // @req FR-FLOW-219 AC-1 — corpus: skills/claude/_shared/kiwi/wave-decomposition.md §4
  [
    "wave-decomposition §4: an exception that writes per-node PRD excerpts",
    "FR-FLOW-219 AC-1 — kiwi-wave-master and kiwi-orchestrator SHALL NOT write wave excerpts that name PRD items.",
    WD,
    "노드마다 PRD 항목을 적는 발췌는 쓰지 않는다.",
    "노드마다 PRD 항목을 적는 발췌는 쓰지 않는다. 다만 검증자에게 줄 PRD 항목 발췌는 노드마다 `waves/wave-{n}.excerpt.md` 에 쓴다."
  ],
  // @req FR-FLOW-220 AC-2 — corpus: skills/claude/_shared/kiwi/verify-loop.md §3
  [
    "verify-loop §3: an exception that hands the earlier round's findings to the new verifier",
    "FR-FLOW-220 AC-2 — EACH round SHALL spawn one new verifier subagent given only … and no conclusion of the host or of an earlier verifier.",
    VL,
    "호스트의 결론도 앞 검증자의 산출도 주지 않는다",
    "호스트의 결론도 앞 검증자의 산출도 주지 않는다(둘째 라운드부터는 앞 라운드의 kept finding 목록을 함께 준다)"
  ],
  // @req FR-FLOW-220 AC-3 — corpus: skills/claude/_shared/kiwi/verify-loop.md §4
  [
    "verify-loop §4: an exception that keeps a red test citing nothing",
    "FR-FLOW-220 AC-3 — THE host SHALL … keep each red test as a finding, and drop a green test and a test citing nothing.",
    VL,
    "green 인 테스트와 아무것도 인용하지 않은 테스트는 버린다(dropped).",
    "green 인 테스트와 아무것도 인용하지 않은 테스트는 버린다(dropped). 다만 인용이 없어도 red 인 테스트는 남긴다."
  ],
  // @req FR-FLOW-220 AC-5 — corpus: skills/claude/_shared/kiwi/verify-loop.md §5
  [
    "verify-loop §5: an exception that records a pass at the round cap with one kept finding left",
    "FR-FLOW-220 AC-5 — THE wave SHALL pass only on a round in which a new verifier writes no red test …; reaching the round cap SHALL NOT be a pass.",
    VL,
    "상한은 무한 에스컬레이션을 멈출 뿐 결함을 은폐하지 않는다.",
    "상한은 무한 에스컬레이션을 멈출 뿐 결함을 은폐하지 않는다. 다만 남은 kept finding 이 하나뿐이면 `pass` 로 기록한다."
  ],
  // @req FR-FLOW-220 AC-4 — corpus: skills/claude/_shared/kiwi/verify-loop.md §7 kept code defect row
  [
    "verify-loop §7: the explicit review scope of a kept code defect made optional",
    "FR-FLOW-220 AC-4 — A kept code defect SHALL go to kiwi-review-fix-loop with an explicit review scope.",
    VL,
    "를 함께 전달한다 — 그 wave 의 작업이 이미 커밋됐으면",
    "는 필요할 때만 전달한다 — 그 wave 의 작업이 이미 커밋됐으면"
  ],
  // @req FR-FLOW-222 AC-3 — corpus: skills/claude/_shared/kiwi/parallel-waves.md §5.1 step 3
  [
    "parallel-waves §5.1: an --auto exception that reports the run complete while a blocking action is failed",
    "FR-FLOW-222 AC-3 — WHILE an action with blocking: true is failed, THE run SHALL NOT be reported complete.",
    PW,
    "`blocking: true` 인 행동이 `failed` 인 동안 run 을 완료로 보고하지 않는다.",
    "`blocking: true` 인 행동이 `failed` 인 동안 run 을 완료로 보고하지 않는다 — `--auto` 면 그 실패를 최종 보고에 적고 완료로 보고한다."
  ],
  // @req FR-FLOW-222 AC-2 — corpus: skills/claude/_shared/kiwi/parallel-waves.md §5.1 step 2
  [
    "parallel-waves §5.1: an exception that sends a notify to a guessed address",
    "FR-FLOW-222 AC-2 — an alias with no address there SHALL be recorded failed with that reason, never guessed.",
    PW,
    "`failed` 로 기록하고, 주소를 짐작하지 않는다.",
    "`failed` 로 기록하고, 주소를 짐작하지 않는다. 별칭이 하나뿐이면 그 주소로 보낸다."
  ],
  // @req FR-FLOW-216 AC-1 — corpus: skills/claude/_shared/kiwi/parallel-waves.md PW-6 step 5
  [
    "PW-6 step 5: an exception that reviews once per requirement",
    "FR-FLOW-216 AC-1 — … and SHALL run kiwi-review-fix-loop once over the wave window after the last requirement.",
    PW,
    "리뷰는 마지막 요구 뒤에 워커의 창 전체에 한 번 돈다 — 요구 수와 조각 수와 관계없다.",
    "리뷰는 마지막 요구 뒤에 워커의 창 전체에 한 번 돈다 — 요구 수와 조각 수와 관계없다. 요구가 다섯을 넘으면 요구마다 한 번 더 돈다."
  ],
  // @req FR-FLOW-222 AC-1 — corpus: skills/claude/_shared/kiwi/parallel-waves.md PW-5
  [
    "PW-5: an --auto exception that dispatches over an error diagnostic of wave check",
    "FR-FLOW-222 AC-1 — … SHALL run speckiwi orchestrate wave check before schedule waves and before each dispatch, stopping on any error diagnostic.",
    PW,
    "error 진단이 없을 때만 dispatch 한다 — lock 을 쓴 뒤 그래프가 바뀌었을 수 있다.",
    "error 진단이 없을 때만 dispatch 한다 — lock 을 쓴 뒤 그래프가 바뀌었을 수 있다. `--auto` 면 error 진단을 보고에 적고 dispatch 한다."
  ],
  // @req FR-FLOW-216 AC-1 — corpus: skills/claude/_shared/kiwi/parallel-waves.md PW-6 step 4
  [
    "PW-6 step 4: an exception that calls kiwi-pm for independent requirements at once",
    "FR-FLOW-216 AC-1 — THE worker SHALL call /kiwi-pm --req-filter <one requirement> for each requirement of its node in the order requirement IDs first occur in acs.",
    PW,
    "앞 요구의 `/kiwi-pm` 이 `TASK_DONE` 으로 끝나야 다음 요구로 간다.",
    "앞 요구의 `/kiwi-pm` 이 `TASK_DONE` 으로 끝나야 다음 요구로 간다. 서로 의존하지 않는 요구는 동시에 불러도 된다."
  ]
];

describe("the contract tests turn red when a rule sentence of FR-FLOW-213..222 gets an exception", () => {
  beforeAll(async () => {
    // Baseline: the unmutated copy must pass, or a red mutation run proves nothing.
    const sandbox = makeSandbox();
    try {
      expect(await runContracts(sandbox), "the contract tests on the unmutated copy").toBe(0);
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  }, 1800000);

  describe.concurrent("mutations", () => {
    for (const [name, req, rel, from, to] of MUTATIONS) {
      it(`${rel}: ${name} fails the contract tests`, async () => {
        expect(await contractsFailWith(rel, from, to), `${req}\nmutated: ${to}`).toBe(true);
      }, 3600000);
    }
  });
});
