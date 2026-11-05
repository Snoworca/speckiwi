import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// @req FR-FLOW-203 — kiwi-review-fix-loop keeps only run-proven findings, drops severity
// labels, and ends when none survive. Scope is kiwi-review-fix-loop only (kiwi-srs,
// kiwi-srs-feasibility and kiwi-coder keep their severity models). The AC numbers below are the
// FR-FLOW-203 block in docs/spec/60.workflow-release.srs.md, which is canonical.
//
// This file pins the keep/drop contract as EXACT sentences, following the file-class test's
// approach: a vocabulary-presence check does not survive an inversion, so each rule is an exact
// string and all four renderings must carry it. Before this file was written none of these
// sentences shipped in any variant, so every presence assertion below is red on the current tree.

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

const COPIES = ["skills/claude", "skills/codex", "skills/etc", ".agents/skills"].map(
  (root) => `${root}/kiwi-review-fix-loop/SKILL.md`
);

const ETC_COPY = "skills/etc/kiwi-review-fix-loop/SKILL.md";

const read = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8");

// Exact sentences the keep/drop contract introduces. Each must appear verbatim in every rendering.
// Removing or rewording one turns its assertion red — that is the mutation guard.
const PINNED: ReadonlyArray<readonly [string, string, string]> = [
  // [AC, label, exact string]
  ["AC-1", "keep only when a run proves it", "finding 은 **실행이 입증할 때만 keep** 한다 — 실패하는 테스트·재현 절차·반례가 그 실패를 보이고 그 실패가 의도를 깨뜨릴 때다."],
  ["AC-1", "drop non-functional, no severity labels for termination", "실행으로 입증하지 못한 것과 스타일·명명·순서·주석류는 **drop** 하며, 심각도 라벨(CRITICAL·HIGH·MEDIUM·LOW)은 종료 판정에 쓰지 않는다."],
  ["AC-2", "gate is zero blocking kept findings; record findings do not block", "종료 게이트는 **차단 kept finding 이 0** 일 때만 통과하고 기록(`declared_limit`) finding 은 통과를 막지 않는다 — 이것이 기존 `CRITICAL=0 + HIGH=0` 게이트를 대체한다."],
  ["AC-2", "an unresolved blocking finding keeps the loop going within its bounds", "차단 kept finding 이 하나라도 남아 있으면 루프는 라운드 상한·토큰 예산·수렴 가드 안에서 계속 돈다."],
  ["AC-3", "unproven functional claim becomes residual", "기능 결함이라 **주장**했으나 실행으로 입증하지 못한 finding 은 drop 하지 않고 **residual 로 사용자 결정**에 올린다."],
  ["AC-3", "a record finding is run-proven and never residual", "기록 finding 은 실행으로 입증된 것이므로 residual 로 올리지 않는다."],
  ["AC-4", "drop and residual are reported", "drop 한 finding 은 **사유와 함께** 보고하고 residual 은 **목록으로** 보고한다 — silent truncation 은 하지 않는다."],
  ["AC-6", "numeric round cap at the loop definition", "기본 라운드 상한은 **Normal 5 / `--max` 8 / `--mini` 3** 이며, 차단 kept finding 이 남은 채 상한에 닿거나 토큰 예산을 넘으면 통과가 아니라 차단·기록 목록과 함께 `NEEDS_USER` 로 끝난다."],
  ["AC-5", "one reviewer in every mode; --max is intensity only", "까칠 리뷰어는 **전 모드에서 1개**이며, `--max` 는 리뷰어 수가 아니라 검증 강도(뮤테이션·적대적 실행)만 올린다."],
  ["AC-8", "kept evidence becomes the regression test", "keep 의 증거로 제출한 테스트는 현재 코드에서 **red 임을 실행으로 확인**한 뒤에만 인정하고, 그 테스트가 회귀 테스트가 되어 fix 후 green·뮤테이션으로 확인한다."],
  ["AC-9", "--auto maps blocking/record/dropped/residual and never raises a record finding", "`--auto` 에서는 **차단 kept→자동 수정 / 기록 kept→선언된 한계로 자동 보고(고치지 않음) / dropped→자동 보고 / residual→사용자 결정**으로 가르며, `--auto` 는 기록 finding 을 차단으로 올리지 않는다."],
  ["AC-10", "coverage comparison stays in the conjunction", "종료는 리뷰 커버리지 대조(FR-FLOW-171)가 차단 kept 0 게이트와 **함께** 통과할 때만 허용한다."],
  ["AC-7", "the earlier-round-fix majority stop runs every round beside the streak", "앞 회차 수정이 만든 차단의 과반 멈춤(FR-FLOW-229 AC-6)은 연속 횟수와 별개로 매 회차 검사하며, 먼저 걸린 쪽이 실행을 끝낸다."],
  ["AC-11", "cap, budget, guard and majority stops end NEEDS_USER", "라운드 상한에 닿거나 토큰 예산을 넘거나, 차단 kept finding 이 남은 채 수렴 가드로 끝나거나, 앞 회차 수정이 만든 차단이 과반이어서 멈춘 실행도 `TASK_DONE` 이 아니라 `NEEDS_USER` 로 끝난다."],
];

describe("FR-FLOW-203 — review-fix-loop keep/drop termination", () => {
  for (const [ac, label, needle] of PINNED) {
    // @req FR-FLOW-203 ${ac}
    it(`${ac}: every rendering carries — ${label}`, () => {
      const missing = COPIES.filter((rel) => !read(rel).includes(needle));
      expect(missing, `renderings missing the ${ac} sentence`).toEqual([]);
    });
  }

  // @req FR-FLOW-203 AC-7 — convergence streak is 2 rounds by default and 3 for the etc
  // single-worker profile (FR-FLOW-120). The count differs per rendering, so each is pinned alone
  // and a rendering carrying the other count is red.
  const convergence = (n: number): string =>
    `수렴 가드는 finding-hash 일치가 아니라 **새로 해소된 차단 kept 가 0 인 라운드가 ${n}회 연속**이면 종료하며, 차단 kept finding 이 남은 채 수렴 가드로 끝난 실행은 통과가 아니라 \`NEEDS_USER\` 로 끝난다.`;
  for (const rel of COPIES.filter((c) => c !== ETC_COPY)) {
    it(`AC-7: ${rel} converges after 2 consecutive rounds with no newly resolved kept finding`, () => {
      const text = read(rel);
      expect(text).toContain(convergence(2));
      expect(text).not.toContain(convergence(3));
    });
  }
  it("AC-7: the etc rendering converges after 3 consecutive rounds with no newly resolved kept finding", () => {
    const text = read(ETC_COPY);
    expect(text).toContain(convergence(3));
    expect(text).not.toContain(convergence(2));
  });

  // @req FR-FLOW-203 AC-2 — the old severity PASS condition is gone as a termination rule.
  it("AC-2: no rendering keeps '2 라운드 연속 MEDIUM=0' as a pass condition", () => {
    const offenders = COPIES.filter((rel) => /2\s*라운드\s*연속\s*MEDIUM\s*=\s*0/.test(read(rel)));
    expect(offenders, "a MEDIUM-zero streak still decides termination").toEqual([]);
  });

  // @req FR-FLOW-203 AC-5 — the --max reviewer ×2 fan-out row is gone.
  it("AC-5: no rendering carries the review-fix-loop '--max | × 2' reviewer row", () => {
    const offenders = COPIES.filter((rel) => /\|\s*`--max`\s*\|\s*×\s*2/.test(read(rel)));
    expect(offenders, "a --max ×2 reviewer fan-out row still ships").toEqual([]);
  });

  // @req FR-FLOW-203 AC-1 — the reviewer finding schema no longer classifies by a severity enum.
  it("AC-1: no rendering declares a CRITICAL|HIGH|MEDIUM|LOW finding-severity enum", () => {
    const offenders = COPIES.filter((rel) => /"severity":\s*"CRITICAL\|HIGH\|MEDIUM\|LOW"/.test(read(rel)));
    expect(offenders, "a finding-severity enum still drives classification").toEqual([]);
  });

  // @req FR-FLOW-203 AC-1 AC-5 — the SKILL.md-only view left the references file free to keep the old
  // severity exit. Each references file must state the kept-zero exit and its convergence streak, and
  // must not state a severity-based exit. Scoped to the "Exit criteria" list so severity words that are
  // not termination conditions (preservation-scan CRITICAL, the finding schema, --auto reclassification)
  // are not flagged.
  const REFERENCES = [
    ["skills/codex/kiwi-review-fix-loop/references/extended-workflow.md", "two"],
    ["skills/etc/kiwi-review-fix-loop/references/extended-workflow.md", "three"],
  ] as const;

  const exitCriteria = (rel: string): string => {
    const text = read(rel);
    const start = text.indexOf("Exit criteria:");
    expect(start, `${rel} has an Exit criteria list`).toBeGreaterThanOrEqual(0);
    const end = text.indexOf("Repeated failure gates:", start);
    expect(end, `${rel} Exit criteria is followed by the failure gates`).toBeGreaterThan(start);
    return text.slice(start, end);
  };

  for (const [rel, streak] of REFERENCES) {
    it(`${rel}: exit criteria are kept-zero plus a ${streak}-round convergence guard`, () => {
      const criteria = exitCriteria(rel).replace(/\s+/g, " ");
      expect(criteria).toContain("no blocking kept finding remains");
      expect(criteria).toContain(
        `${streak} consecutive rounds that resolve no blocking kept finding end the loop, and a run the guard ends while a blocking kept finding remains ends \`NEEDS_USER\`, not a pass`
      );
    });

    it(`${rel}: exit criteria carry no severity-based termination`, () => {
      const criteria = exitCriteria(rel);
      expect(criteria).not.toMatch(/\bHIGH\s*=\s*0\b/);
      expect(criteria).not.toMatch(/\bCRITICAL\s*=\s*0\b/);
      expect(criteria).not.toMatch(/MEDIUM[- ]zero/i);
    });
  }
});

describe("FR-FLOW-203 — references finding schema and --auto routing carry no severity", () => {
  const REFS = ["skills/codex", "skills/etc"].map((r) => `${r}/kiwi-review-fix-loop/references/extended-workflow.md`);
  for (const rel of REFS) {
    // @req FR-FLOW-203 AC-1 — the reviewer finding schema carries no severity field.
    it(`AC-1: ${rel} finding schema has a verdict field and no severity enum`, () => {
      const text = read(rel);
      expect(text).not.toMatch(/"severity":\s*"CRITICAL\|HIGH\|MEDIUM\|LOW"/);
      expect(text).toContain(`"verdict": "keep|drop|residual"`);
    });
    // @req FR-FLOW-203 AC-9 — --auto routes kept/dropped/residual, not severity.
    it(`AC-9: ${rel} --auto routes kept/dropped/residual`, () => {
      const text = read(rel);
      expect(text).not.toMatch(/In `--auto`, CRITICAL\/HIGH\/MEDIUM/);
      expect(text).toContain("blocking kept findings are fixed automatically, record kept findings are reported as declared limits without a fix, dropped findings are");
    });
  }
});

describe("FR-FLOW-203 — the --close-reqs gate blocks on kept or residual findings, not on severity", () => {
  // @req FR-FLOW-203 AC-13 — the --close-reqs gate blocks promotion while a kept or residual finding remains.
  it("AC-13: claude §0.G7 blocks --close-reqs while a kept or residual finding remains", () => {
    const text = read("skills/claude/kiwi-review-fix-loop/SKILL.md");
    expect(text).toContain("| `--close-reqs` + 차단 kept 또는 residual finding 잔존 (≥1) | 차단 + WARN — 기록(`declared_limit`) finding 은 승급을 막지 않는다");
    expect(text).not.toContain("까칠 리뷰 finding 잔존 (CRITICAL/HIGH ≥1)");
  });
  // @req FR-FLOW-203 AC-13 — the close-reqs gate reason names kept/residual, not severity.
  it("AC-13: every rendering's close-reqs gate reason names kept or residual findings", () => {
    for (const rel of COPIES) {
      const line = read(rel).split("\n").find((l) => l.includes("`close-reqs-critical-or-high-residual`"));
      expect(line, `${rel}: gate row missing`).toBeDefined();
      // Read the reason cell only: the gate id itself contains "residual", so matching the whole row is vacuous.
      const reason = (line ?? "").split("|")[2] ?? "";
      expect(reason, `${rel}: gate reason still keys on severity`).toMatch(/kept/);
      expect(reason, `${rel}: gate reason must name the blocking tier`).toMatch(/차단 kept|blocking kept/);
      expect(reason, `${rel}: gate reason must cover residual`).toMatch(/residual/);
    }
  });
  // @req FR-FLOW-203 AC-13 — codex and etc halt rows key on kept/residual.
  it("AC-13: codex and etc --close-reqs Gate tables halt on kept or residual findings", () => {
    for (const rel of ["skills/codex/kiwi-review-fix-loop/SKILL.md", "skills/etc/kiwi-review-fix-loop/SKILL.md"]) {
      const text = read(rel);
      expect(text).toContain("| blocking kept or residual finding remains | halt; a record (`declared_limit`) finding does not block |");
      expect(text).not.toContain("| kept or residual finding remains | halt |");
      expect(text).not.toContain("| CRITICAL/HIGH finding remains | halt |");
    }
  });
  // @req FR-FLOW-203 AC-2 — the phase overview names the kept counter the gate now uses.
  it("AC-2: the claude phase overview no longer calls Phase 6 a severity counter", () => {
    expect(read("skills/claude/kiwi-review-fix-loop/SKILL.md")).not.toContain("Phase 4-5 반복 (심각도 카운터)");
  });
});

describe("FR-FLOW-203 — a residual finding cannot leave the run before the user decides it", () => {
  const RETURN_RULE = "residual finding 이 하나라도 남으면 이 실행은 `TASK_DONE` 이 아니라 `NEEDS_USER` 로 끝난다 — 상위 오케스트레이터는 그 residual 을 사용자가 결정하기 전까지 step 승급·lane 병합으로 넘어가지 않는다.";
  const MAPPING = "keep/drop 판정과 4분류는 고정 매핑이다: 차단 kept→`immediate_fix`, 기록 kept→`declared_limit`, residual→`discussion_needed`(`rejected` 로 보낼 수 없다), dropped→`rejected`.";
  // @req FR-FLOW-203 AC-11 — a residual ends the run NEEDS_USER, so a caller cannot promote or merge past it.
  it("AC-11: every rendering ends a run with a residual as NEEDS_USER", () => {
    const missing = COPIES.filter((rel) => !read(rel).includes(RETURN_RULE));
    expect(missing, "renderings missing the residual return rule").toEqual([]);
  });
  // @req FR-FLOW-203 AC-12 — --auto cannot resolve a residual: it is a declared critical gate.
  it("AC-12: every rendering declares the residual-finding-user-decision critical gate", () => {
    for (const rel of COPIES) {
      const row = read(rel).split("\n").find((l) => l.trim().startsWith("| `residual-finding-user-decision` |"));
      expect(row, `${rel}: critical gate row missing`).toBeDefined();
      expect((row ?? "").split("|")[2] ?? "", `${rel}: gate reason must name --auto`).toMatch(/--auto/);
      expect((row ?? "").split("|")[2] ?? "", `${rel}: gate reason must say --auto cannot resolve it`).toMatch(/정리하지 못한다|cannot resolve/);
    }
  });
  // @req FR-FLOW-203 AC-13 — the verdict maps onto the classification; residual is never rejected.
  it("AC-13: every rendering fixes the verdict-to-classification mapping", () => {
    const missing = COPIES.filter((rel) => !read(rel).includes(MAPPING));
    expect(missing, "renderings missing the verdict mapping").toEqual([]);
  });
});

describe("FR-FLOW-203 — kiwi-tdd stops before promotion unless the review hop returns TASK_DONE", () => {
  const TDD = ["skills/claude", "skills/codex", "skills/etc", ".agents/skills"].map((r) => `${r}/kiwi-tdd/SKILL.md`);
  const KO = "리뷰 hop 이 `TASK_DONE` 이 아닌 상태(`NEEDS_USER` · `FAILED`)로 끝나면 Phase 6 승격으로 넘어가지 않는다 — residual 과 남은 finding 을 지명해 중단한다.";
  const EN = "When the review hop ends in any status other than `TASK_DONE` (`NEEDS_USER` or `FAILED`), do not enter Phase 6 promotion — name the residual and remaining findings and stop.";
  // @req FR-FLOW-203 AC-11 — a caller does not promote past a review that did not end TASK_DONE.
  it("AC-11: every kiwi-tdd rendering stops before Phase 6 unless the review hop returned TASK_DONE", () => {
    for (const rel of TDD) {
      const text = read(rel);
      expect(text.includes(KO) || text.includes(EN), `${rel}: status-based stop rule missing`).toBe(true);
      expect(text, `${rel}: the stop rule still keys on severity`).not.toMatch(/CRITICAL 또는 HIGH 를 남긴 채|residual CRITICAL or HIGH finding/);
    }
  });
});

describe("FR-FLOW-203 — the classification table agrees with the fixed verdict mapping", () => {
  const CLAUDE = "skills/claude/kiwi-review-fix-loop/SKILL.md";
  // @req FR-FLOW-203 AC-13 — immediate_fix holds kept (run-proven) findings only; style is dropped, not fixed.
  it("AC-13: claude §0.G5 defines immediate_fix as a kept finding and rejected as including dropped", () => {
    const text = read(CLAUDE);
    const row = (name: string) => text.split("\n").find((l) => l.startsWith(`| **${name}** |`)) ?? "";
    expect(row("immediate_fix")).not.toContain("스타일 위반");
    expect(row("immediate_fix")).toContain("실행으로 입증된 차단 kept finding");
    expect(row("declared_limit")).toContain("기록 kept finding");
    expect(row("rejected")).toContain("dropped");
  });
  // @req FR-FLOW-203 AC-13 — the classifier schema can record a dropped finding and fixes no style finding.
  it("AC-13: claude classifier schema has a dropped rejection category and no style tag on immediate_fix", () => {
    const text = read(CLAUDE);
    expect(text).toContain("\"rejection_category\": \"dropped|out_of_scope|already_intended|external_library|misunderstanding\"");
    expect(text).not.toContain("\"tags\": [\"bug\", \"regression\", \"security\", \"performance\", \"style\", \"naming\", \"doc\"]");
  });
  // @req FR-FLOW-203 AC-12 — --auto never reclassifies a residual.
  it("AC-12: codex and etc references say --auto never reclassifies a residual", () => {
    for (const rel of ["skills/codex", "skills/etc"].map((r) => `${r}/kiwi-review-fix-loop/references/extended-workflow.md`)) {
      expect(read(rel)).toContain("a residual is never reclassified (critical gate `residual-finding-user-decision`)");
    }
  });
});
