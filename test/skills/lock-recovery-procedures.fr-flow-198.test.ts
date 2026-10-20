import { describe, expect, it } from "vitest";

import { criticalGateRows, section, stripFrontmatter, tableRows } from "./kiwi-orchestrator-variants.js";
import { RENDERINGS, readRepoFile, scanUnits, skillDirs } from "./kiwi-renderings.js";

// @req FR-FLOW-198 — for each lock a run can meet, the skills say what the agent can observe, which
// recovery is safe and which step needs the user. A P.5 lease is released only through the session that
// acquired it, `halt` keeps it, and a lane whose worktree is `locked` is never re-dispatched without
// the user, even under `--auto`. Also the skill-text parts of FR-NODE-221 and IR-CLI-105.
//
// Every rendering that carries a file is read on its own bytes, the `.agents` mirror included.
// kiwi-orchestrator, kiwi-pm and the shared contracts are Korean in claude; the shared contracts
// parallel-waves.md and worktree-lane.md are English in codex, etc and the mirror.

const read = (relPath: string): string => stripFrontmatter(readRepoFile(relPath).replace(/\r\n/g, "\n"));

const ORCHESTRATORS = RENDERINGS.filter((rendering) => skillDirs(rendering).includes("kiwi-orchestrator")).map(
  (rendering) => `${rendering}/kiwi-orchestrator/SKILL.md`
);
const PMS = RENDERINGS.map((rendering) => `${rendering}/kiwi-pm/SKILL.md`);
const shared = (file: string): string[] => RENDERINGS.map((rendering) => `${rendering}/_shared/kiwi/${file}`);

/** The §3.1 section of one kiwi-orchestrator rendering. */
function runLock(relPath: string): string {
  return section(read(relPath), /^###\s*3\.1\s/);
}

function verb(relPath: string, name: string): string {
  return section(read(relPath), new RegExp(`^###\\s*§V\\.${name}\\s*$`));
}

/** The gate the run halts at when a worktree is `locked`, with every element FR-FLOW-198 AC-4 requires. */
const LOCKED_LANE_RULE: ReadonlyArray<readonly [string, RegExp]> = [
  ["no re-dispatch", /다시 dispatch 하지 않|does not re-dispatch/],
  ["no worktree unlock", /`git worktree unlock` 도 하지 않|does not run `git worktree unlock`|잠금도 풀지 않/],
  ["the gate", /`lane-worker-possibly-live`/],
  ["not decided by --auto", /`--auto` 가 결정하지 않는다|`--auto` does not decide/],
  ["NEEDS_USER", /`NEEDS_USER`/],
  ["the worktree path", /워크트리 경로|worktree path/],
  ["pid N", /pid N\b/],
  ["the Windows liveness hint", /`tasklist \/FI "PID eq N"`/],
  ["the POSIX liveness hint", /`kill -0 N`/],
  ["the pid is not established", /확정되지 않았|has not been established/],
  ["WSL can look dead", /WSL/],
  ["only on the user's answer", /사용자의 답|the user's answer/],
  ["FR-FLOW-118", /FR-FLOW-118/]
];

/** Every line of a file that reads `locked … (pid N)` — the census AC-4 holds to the full rule. */
function lockedLaneLines(text: string): string[] {
  return text.split("\n").filter((line) => line.includes("`locked … (pid N)`"));
}

describe("FR-FLOW-198 AC-1 — kiwi-orchestrator §3.1 maps the lock states to actions", () => {
  it.each(ORCHESTRATORS)("FR-FLOW-198 AC-1: %s replaces the claim that unlock never refuses", (relPath) => {
    const text = runLock(relPath);
    expect(text, `${relPath}: §3.1 is missing`).not.toBe("");
    expect(text, `${relPath}: the false unlock sentence survives`).not.toContain("살아 있어도 거절하지 않고 lease 를 해제");
    expect(text, `${relPath}: unlock may refuse`).toMatch(/`unlock` 은[^\n]*`run-lock-held-by-live-session` 으로 거절할 수 있으므로/);
    expect(text, `${relPath}: status reports the fence`).toMatch(/`status` 는 아무것도 바꾸지 않는 조회이며[^\n]*`leaseExpiresAt`[^\n]*`fence`/);
  });

  it.each(ORCHESTRATORS)("FR-FLOW-198 AC-1: %s gives each state its action", (relPath) => {
    const lines = runLock(relPath).split("\n");
    const state = (re: RegExp): string => lines.find((line) => re.test(line)) ?? "";
    expect(state(/^- `holderUnreadable: true`/), `${relPath}: holderUnreadable`).toMatch(/5 초 이상 기다린 뒤 한 번 다시 시도한다/);
    // IR-CLI-105 AC-3 (amended): an MCP server tells this session from another; a CLI process cannot.
    expect(state(/^- `fence: "held-by-this-session"`/), `${relPath}: held by this session`).toMatch(
      /이 세션의 MCP `orchestrate_run_abort` 나, 위의 run lock 도구에 `action` 을 `unlock` 으로 준 호출로 해제한다/
    );
    expect(state(/^- `fence: "held-by-another-session"`/), `${relPath}: held by another session`).toMatch(
      /사용자에게 그 세션에서 해제하거나 그 세션을 닫으라고 요청한다/
    );
    const cli = state(/^- `fence: "held"`/);
    expect(cli, `${relPath}: the CLI's undivided held value`).toMatch(/CLI/);
    expect(cli).toMatch(/보유자를 모르는 것으로 보고 사용자에게 묻는다/);
    // IR-CLI-105 AC-2 (amended): POSIX has no fence; the unlock command keeps the abandoned-only condition.
    const posix = state(/^- `fence: "not-applicable"`/);
    expect(posix, `${relPath}: the POSIX case`).toMatch(/fence 가 없어/);
    expect(posix).toMatch(/보유 run 이 버려진 경우에만/);
    expect(posix).toMatch(/사용자가 그렇다고 답한 뒤에만/);
    expect(posix).toMatch(/두 run 이 한 저장소를 함께 바꾼다/);
    const ghost = state(/^- `fence` 가 held 값\(/);
    expect(ghost, `${relPath}: owner null with a held fence is not explained`).toMatch(/`owner`[^\n]*`null`/);
    expect(ghost).toMatch(/몇 초 넘게 이어지면 열린 세션이 lock 을 쥔 것/);
    const live = state(/^- `run-lock-held-by-live-session` 거절/);
    expect(live, `${relPath}: the live-session refusal`).toMatch(/보유 세션 자신의 MCP 호출과 그 세션을 닫는 것 둘뿐이다/);
    expect(live).toMatch(/lock 파일을 손으로 지우지 않고, 다른 프로세스에서 다시 시도하지 않는다/);
  });
});

describe("FR-FLOW-198 AC-2 — a refusal that offers release asks the user first", () => {
  it.each(ORCHESTRATORS)("FR-FLOW-198 AC-2: %s shows the lease, asks, and releases only on a yes", (relPath) => {
    const rule = scanUnits(runLock(relPath)).find((unit) => unit.text.includes("`releaseIfAbandoned`"))?.text ?? "";
    expect(rule, `${relPath}: §3.1 says nothing about releaseIfAbandoned`).not.toBe("");
    for (const field of ["`pid`", "`host`", "`acquiredAt`", "`leaseExpiresAt`"]) {
      expect(rule, `${relPath}: the user is not shown ${field}`).toContain(field);
    }
    expect(rule, `${relPath}: releaseIfAbandoned is Windows with a free fence`).toMatch(/Windows 에서 `fence: "free"` 인 거절만/);
    expect(rule).toMatch(/버려졌는지 사용자에게 묻는다/);
    expect(rule).toMatch(/사용자가 그렇다고 답한 뒤에만/);
    expect(rule).toMatch(/`run unlock`/);
    expect(rule).toMatch(/MCP `orchestrate_run_lock` 의 `unlock`/);
    expect(rule, `${relPath}: the AC's wording`).toMatch(/보유 run 이 버려진 경우에만/);
    expect(rule, `${relPath}: --auto may decide it`).toMatch(/`--auto` 여도 critical 이다/);
  });
});

describe("FR-FLOW-198 AC-3 — halt keeps the P.5 lease; abort's refusal is named", () => {
  it.each(ORCHESTRATORS)("FR-FLOW-198 AC-3: %s §V.halt keeps the lease and tells the user both ways on", (relPath) => {
    const halt = verb(relPath, "halt");
    expect(halt, `${relPath}: §V.halt is missing`).not.toBe("");
    expect(halt).toMatch(/P\.5 의 lease 는 해제하지 않는다/);
    expect(halt).toMatch(/P\.5 lease 가 아직 잡혀 있다고 적/);
    expect(halt).toMatch(/계속 — `--resume`, 이 세션에서 또는 이 세션을 닫은 뒤/);
    expect(halt).toMatch(/버림 — 이 세션에서 MCP `orchestrate_run_abort` 에 `reason` 을 멈춘 게이트로, `runId` 를 이 run 의 `run_id` 로 주어 부른다/);
  });

  it.each(ORCHESTRATORS)("FR-FLOW-198 AC-3: %s §15 and §V.abort-run name abort's live-session refusal and its way out", (relPath) => {
    const fifteen = section(read(relPath), /^##\s*15\.\s/);
    for (const [where, text] of [["§15", fifteen], ["§V.abort-run", verb(relPath, "abort-run")]] as const) {
      const line = text.split("\n").find((entry) => entry.includes("`run-lock-held-by-live-session`")) ?? "";
      expect(line, `${relPath}: ${where} does not name the refusal`).not.toBe("");
      expect(line, `${relPath}: ${where} does not give the session's own MCP call`).toMatch(/세션(?: 자신)?의 MCP `orchestrate_run_abort`/);
      expect(line, `${relPath}: ${where} does not give closing the session`).toMatch(/세션을 닫/);
      expect(line, `${relPath}: ${where} does not cite §3.1`).toContain("§3.1");
    }
  });
});

describe("FR-FLOW-198 AC-4 — a locked worktree lane is never re-dispatched without the user", () => {
  const PLACES: ReadonlyArray<readonly [string, string[], (text: string) => string]> = [
    ["parallel-waves PW-5", shared("parallel-waves.md"), (text) => text.slice(text.indexOf("**PW-5 ·"), text.indexOf("**PW-6 ·"))],
    ["parallel-waves §6", shared("parallel-waves.md"), (text) => section(text, /^##\s*6\./)],
    ["run-ledger dispatch-lane", shared("run-ledger.md"), (text) => text.split("\n").find((line) => line.startsWith("| `dispatch-lane` |")) ?? ""],
    ["worktree-lane", shared("worktree-lane.md"), (text) => text],
    ["kiwi-orchestrator §V.dispatch-lane", ORCHESTRATORS, (text) => section(text, /^###\s*§V\.dispatch-lane\s*$/)]
  ];

  for (const [where, files, pick] of PLACES) {
    it.each(files)(`FR-FLOW-198 AC-4: ${where} in %s states the rule`, (relPath) => {
      const lines = lockedLaneLines(pick(read(relPath)));
      expect(lines.length, `${relPath}: ${where} does not read \`locked … (pid N)\``).toBeGreaterThan(0);
    });
  }

  const ALL = [...shared("parallel-waves.md"), ...shared("run-ledger.md"), ...shared("worktree-lane.md"), ...ORCHESTRATORS];
  it.each(ALL)("FR-FLOW-198 AC-4: every `locked … (pid N)` line of %s carries the whole rule", (relPath) => {
    for (const line of lockedLaneLines(read(relPath))) {
      for (const [element, re] of LOCKED_LANE_RULE) {
        expect(re.test(line), `${relPath}: a locked-lane sentence lacks ${element}: ${line.slice(0, 160)}`).toBe(true);
      }
    }
  });
});

describe("FR-FLOW-198 AC-5 · FR-NODE-221 AC-10 — the orchestrator declares both new gates", () => {
  it.each(ORCHESTRATORS)("FR-FLOW-198 AC-5: %s declares lane-worker-possibly-live, not decided by --auto", (relPath) => {
    const row = criticalGateRows(read(relPath)).find((entry) => entry.gateId === "lane-worker-possibly-live");
    expect(row, `${relPath}: lane-worker-possibly-live is not in the gate table`).toBeDefined();
    expect(row?.reason).toMatch(/`--auto` 가 결정하지 않는다/);
    expect(row?.reason).toContain("`NEEDS_USER`");
  });

  it.each(ORCHESTRATORS)("FR-NODE-221 AC-10: %s declares run-lock-held-by-live-session", (relPath) => {
    const row = criticalGateRows(read(relPath)).find((entry) => entry.gateId === "run-lock-held-by-live-session");
    expect(row, `${relPath}: run-lock-held-by-live-session is not in the gate table`).toBeDefined();
    expect(row?.reason).toContain("§3.1");
  });
});

describe("FR-FLOW-198 AC-6 — returning a worktree that will not go", () => {
  const PLACES: ReadonlyArray<readonly [string, string[], (text: string) => string]> = [
    ["run-ledger release-lane", shared("run-ledger.md"), (text) => text.split("\n").find((line) => line.startsWith("| `release-lane` |")) ?? ""],
    ["parallel-waves PW-11", shared("parallel-waves.md"), (text) => text.slice(text.indexOf("**PW-11 ·"), text.indexOf("**PW-12 ·"))]
  ];
  const ELEMENTS: ReadonlyArray<readonly [string, RegExp]> = [
    ["Permission denied", /`Permission denied`/],
    ["the processes inside the lane", /(?:셸|shell), vitest, (?:편집기|editor)/],
    ["retry", /다시 시도|retry/],
    ["not a working tree", /`is not a working tree`/],
    ["the half-removed Windows state", /Windows 에서 반쯤 지워진|half-removed on Windows/],
    ["prune", /`git worktree prune`/],
    ["recorded in the run report", /run 리포트에 적|recorded in the run report/],
    ["does not halt", /run 은 멈추지 않는다|does not halt the run/],
    ["a locked worktree goes to the gate first", /`lane-worker-possibly-live`/],
    ["no remove -f -f without the user", /`git worktree remove -f -f` (?:는 사용자의 결정 없이 쓰지 않는다|is never used without the user's decision)/]
  ];

  for (const [where, files, pick] of PLACES) {
    it.each(files)(`FR-FLOW-198 AC-6: ${where} in %s gives the failure handling`, (relPath) => {
      const text = pick(read(relPath));
      expect(text, `${relPath}: ${where} is missing`).not.toBe("");
      for (const [element, re] of ELEMENTS) expect(re.test(text), `${relPath}: ${where} lacks ${element}`).toBe(true);
    });
  }
});

describe("FR-FLOW-198 AC-7 — a leftover git index.lock", () => {
  it.each([...shared("run-ledger.md"), ...shared("parallel-waves.md")])("FR-FLOW-198 AC-7: %s deletes it only when no git process runs", (relPath) => {
    const rule = read(relPath).split("\n").find((line) => line.includes("`index.lock`")) ?? "";
    expect(rule, `${relPath}: says nothing about a leftover index.lock`).not.toBe("");
    expect(rule).toMatch(/git 프로세스가 돌고 있지 않음을 확인한 뒤에만|only after confirming no git process is running/);
    expect(rule).toContain('`tasklist /FI "IMAGENAME eq git.exe"`');
    expect(rule).toContain("`pgrep -x git`");
    expect(rule).toMatch(/기다렸다가 다시 시도한다|wait and retry/);
    expect(rule).toMatch(/WSL[^\n]*(?:사용자에게 묻는다|ask the user)/);
  });
});

describe("FR-FLOW-198 AC-8 — kiwi-pm §2.3 judges pm.lock by its age", () => {
  it.each(PMS)("FR-FLOW-198 AC-8: %s", (relPath) => {
    const lockSection = section(read(relPath), /^###\s*2\.3\s/);
    expect(lockSection, `${relPath}: §2.3 is missing`).not.toBe("");
    expect(lockSection).toMatch(/`started_at` 이 없으면 파일 수정 시각\(mtime\)/);
    const halt = lockSection.split("\n").find((line) => line.includes("HALT") && line.includes("30분 이내")) ?? "";
    expect(halt, `${relPath}: the HALT step is missing`).not.toBe("");
    for (const element of ["lock 파일 경로", "`host`", "`started_at`", "30분이 지날 때까지 기다리", "`--force`"]) {
      expect(halt, `${relPath}: the HALT message does not name ${element}`).toContain(element);
    }
    expect(halt).toMatch(/다른 세션이 끝났음을 사용자가 안 뒤/);
    expect(lockSection, `${relPath}: does not say why pid is not checked`).toMatch(/pid 를 확인하지 않는다 — /);
    // kiwi-coder keeps no coder.lock, so every sentence naming one is stale, not only those in §2.3.
    expect(read(relPath).includes("coder.lock"), `${relPath}: the stale coder.lock sentences survive`).toBe(false);
  });
});

describe("FR-FLOW-198 AC-9 — every rendering carries each file", () => {
  it("FR-FLOW-198 AC-9: the suites above read claude, codex, etc and the mirror", () => {
    expect([...RENDERINGS].sort()).toEqual([".agents/skills", "skills/claude", "skills/codex", "skills/etc"]);
    expect(ORCHESTRATORS).toHaveLength(4);
    for (const relPath of [...ORCHESTRATORS, ...PMS, ...shared("parallel-waves.md"), ...shared("run-ledger.md"), ...shared("worktree-lane.md")]) {
      expect(read(relPath), `${relPath} is missing`).not.toBe("");
    }
    expect(tableRows("| a | b |")).toHaveLength(1);
  });
});
