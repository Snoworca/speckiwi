import { describe, expect, it } from "vitest";

import { criticalGateRows, section, tableRows } from "./kiwi-orchestrator-variants.js";
import { MIRROR_EXCLUDED, RENDERINGS, markdownFiles, numberedLists, readRepoFile } from "./kiwi-renderings.js";

// @req FR-FLOW-186 — the test-sufficiency check is defined once in a shared contract, runs as the
// last phase of kiwi-review-fix-loop whenever a requirement scope is known, and runs immediately
// before every other write of `verified` (kiwi-tdd, kiwi-srs-sync, kiwi-hot-fix here; the
// orchestrator's promotion step and the AC-4 rungs are held by their own suites).
//
// A SKILL.md is instruction, not code, so every assertion reads shipped text. Each one is keyed on
// STRUCTURE — a numbered item, a table row, a fenced line, a section — and on language-neutral
// tokens (file paths, gate ids, tool names, flags), because `skills/claude` is Korean and the other
// renderings are English. Order assertions compare positions inside one section, so moving a
// sentence out of the section it governs reddens rather than passing on a mention elsewhere.
//
// WHAT THIS FILE DOES NOT HOLD. It observes no run: that an agent calls the tool is not asserted,
// and neither is the quality of the tests a fill subagent writes. The mirror rows go red until the
// integration step regenerates `.agents/skills` with `speckiwi skills mirror --write`.

const CONTRACT = "_shared/kiwi/test-sufficiency.md";
const GATE = "test-sufficiency-gap";
const MCP_TOOL = "check_test_sufficiency";
const CLI_TOOL = "speckiwi coverage --tests";

/** Either spelling of the tool, the way a step names what it runs. */
const NAMES_TOOL = /check_test_sufficiency|speckiwi coverage --tests/;

/** The test-sufficiency step as a skill names it: the contract path, never a restated procedure. */
const NAMES_CHECK = /test-sufficiency/;

/** The per-criterion naming the review loop's LLM used to do, which AC-2 retires. */
const LLM_NAMING = /name the test identifier that passed it first|테스트 식별자를 먼저 지목한다/i;

/** A delegation of kiwi-hot-fix to kiwi-srs-sync, in each rendering's own call form. */
const SYNC_DELEGATION = /Skill\(skill="kiwi-srs-sync"|Use \$kiwi-srs-sync with|Use the kiwi-srs-sync skill with/;

function read(relPath: string): string {
  return readRepoFile(relPath).replace(/\r\n/g, "\n");
}

/** Every markdown file of a skill joined, SKILL.md first, so a moved section is still found. */
function skillDocs(rendering: string, skill: string): Array<{ relPath: string; text: string }> {
  const files = markdownFiles(rendering, skill);
  files.sort((a, b) => Number(!a.endsWith("/SKILL.md")) - Number(!b.endsWith("/SKILL.md")));
  return files.map((relPath) => ({ relPath, text: read(relPath) }));
}

/** The first section, across a skill's documents, whose heading matches. */
function sectionAcross(rendering: string, skill: string, heading: RegExp): string {
  for (const doc of skillDocs(rendering, skill)) {
    const found = section(doc.text, heading);
    if (found !== "") return found;
  }
  return "";
}

/** The numbered items of every numbered list in `text`, each item with its wrapped lines joined. */
function numberedItems(text: string): string[] {
  const lines = text.split("\n");
  const items: string[] = [];
  for (const list of numberedLists(lines)) {
    let current: string[] = [];
    for (const line of list.text.split("\n")) {
      if (/^ {0,3}\d+\.\s/.test(line)) {
        if (current.length > 0) items.push(current.join(" "));
        current = [line.trim()];
      } else current.push(line.trim());
    }
    if (current.length > 0) items.push(current.join(" "));
  }
  return items;
}

/** The first fenced block in `text` that lists phases starting at `Phase 0`, split into lines. */
function phaseFlowLines(text: string): string[] {
  for (const block of text.matchAll(/```[\s\S]*?```/g)) {
    if (block[0].includes("Phase 0")) return block[0].split("\n");
  }
  return [];
}

/** Whether `rendering`'s copy of `skill` declares `gateId` as a critical gate, table or inline. */
function declaresCriticalGate(rendering: string, skill: string, gateId: string): boolean {
  const body = read(`${rendering}/${skill}/SKILL.md`);
  if (criticalGateRows(body).some((row) => row.gateId === gateId)) return true;
  return new RegExp(`critical_gates[^\\n]*gate_id:\\s*"${gateId}"`).test(body);
}

describe("FR-FLOW-186 — the corpus this suite reads", () => {
  it("reads every shipped rendering and the mirror", () => {
    // A derived denominator can still shrink to nothing; pin its floor.
    expect(RENDERINGS.length).toBeGreaterThanOrEqual(4);
    expect(RENDERINGS).toContain(".agents/skills");
  });
});

describe("FR-FLOW-186 AC-1 — the shared contract defines the procedure once", () => {
  /** The numbered steps of the contract's procedure section. */
  function procedureItems(text: string): string[] {
    return numberedItems(section(text, /^##\s.*(?:절차|Procedure)/));
  }

  it.each(RENDERINGS)("%s ships the contract", (rendering) => {
    expect(read(`${rendering}/${CONTRACT}`).length, `${rendering}/${CONTRACT} is missing or empty`).toBeGreaterThan(0);
  });

  it.each(RENDERINGS)("%s: run the tool, fill once with one test-writing subagent, rerun, then raise the gate", (rendering) => {
    const items = procedureItems(read(`${rendering}/${CONTRACT}`));
    const toolAt = items.findIndex((item) => NAMES_TOOL.test(item));
    const fillAt = items.findIndex((item) => /test-writing subagent|테스트 작성 서브에이전트/.test(item));
    const rerunAt = items.findIndex((item, index) => index > fillAt && NAMES_TOOL.test(item));
    const gateAt = items.findIndex((item) => item.includes(GATE));
    expect(toolAt, "no procedure step runs the tool").toBeGreaterThanOrEqual(0);
    expect(fillAt, "no procedure step spawns the test-writing subagent").toBeGreaterThan(toolAt);
    expect(rerunAt, "no procedure step reruns the tool after the fill").toBeGreaterThan(fillAt);
    expect(gateAt, `the gate step must come after the rerun`).toBeGreaterThan(rerunAt);

    const fill = items[fillAt] as string;
    expect(fill, "the fill cites requirement criteria on the test line").toContain("<REQ-ID> AC-<n>");
    expect(fill, "the fill cites SDS contracts on the test line").toContain("SDS-AC-<n>");
    expect(/(?:one|하나)\b[^.]{0,40}(?:test-writing subagent|서브에이전트)|(?:test-writing subagent|테스트 작성 서브에이전트)\s*하나/.test(fill), "exactly one fill subagent").toBe(true);
    expect(/or more|or several|하나 이상|여럿|여러/.test(fill), "exactly one fill subagent, not one or more").toBe(false);
    expect(
      /(?:never|do not|does not|must not)[^.]{0,80}weaken|약화[^.]{0,30}(?:않는다|않고|금지)/i.test(fill),
      "the fill must forbid weakening existing tests"
    ).toBe(true);
    // A new test that fails is a defect, not a citation: its AC must stay a gap, or a failing test
    // becomes the evidence a verified write rests on.
    expect(/counts as a gap in step 5|5번에서 gap 으로 센다/.test(fill), "a failing new test leaves its AC a gap").toBe(true);

    const gate = items[gateAt] as string;
    expect(/remain|남으면/.test(gate), "the gate fires on gaps that remain after the fill").toBe(true);
    expect(gate, "the gate is critical").toContain("critical");
    expect(/`--auto` does not lift it|`--auto` 도 풀지 못한다/.test(gate), "--auto must not lift the gate").toBe(true);
    expect(/not critical|critical 이 아니|`--auto` (?:lifts|may lift|can lift)|`--auto` 로 풀/.test(gate), "the gate must not be softened").toBe(false);
  });

  it.each(RENDERINGS)("%s: a tool error fails closed, and a run that writes nothing skips the fill", (rendering) => {
    const procedure = section(read(`${rendering}/${CONTRACT}`), /^##\s.*(?:절차|Procedure)/);
    expect(procedure, "an error answer must count as a check that did not run").toMatch(/`ok: false`[^\n]*(?:did not run|확인하지 못한 것이다)/);
    expect(procedure, "a dry run reports the first result without a fill").toMatch(/--dry-run[^\n]*(?:skip steps 3 and 4|3·4번을 하지 않고)/);
  });

  it.each(RENDERINGS)("%s: a caller that writes verified takes the tool's citation as the test identifier", (rendering) => {
    const promotion = section(read(`${rendering}/${CONTRACT}`), /^##\s.*verified/);
    expect(promotion, "the contract needs a section for callers that write verified").not.toBe("");
    for (const token of ["add_verification_evidence", "`reference`", "`covers`"]) expect(promotion).toContain(token);
    expect(promotion, "the agent does not name a test itself").toMatch(/does not name a test per AC itself|AC 마다 테스트를 지목하지 않는다/);
    expect(promotion, "an AC with no citation is not checked").toMatch(/An AC with no citation is not checked|인용이 없는 AC 는 체크하지 않는다/);
    expect(promotion, "a failing new test's citation is not evidence").toMatch(/failed in step 3 is not used|실패한 새 테스트의 인용은 쓰지 않는다/);
    expect(promotion, "the check runs before evidence is registered").toMatch(/\*\*before\*\* it registers evidence|증거 등록보다 \*\*먼저\*\*/);
  });

  it.each(RENDERINGS)("%s: the fill runs once, not in a loop", (rendering) => {
    const procedure = section(read(`${rendering}/${CONTRACT}`), /^##\s.*(?:절차|Procedure)/);
    expect(/한 번뿐|only once/i.test(procedure), "the procedure must say the fill runs once").toBe(true);
  });

  it.each(RENDERINGS)("%s: names the MCP tool and the CLI command with its scope options", (rendering) => {
    const text = read(`${rendering}/${CONTRACT}`);
    expect(text).toContain(MCP_TOOL);
    const fences = [...text.matchAll(/```[\s\S]*?```/g)].map((match) => match[0]);
    const cli = fences.filter((fence) => fence.includes(CLI_TOOL));
    expect(cli.length, "a fenced block must spell the CLI command").toBeGreaterThan(0);
    const joined = cli.join("\n");
    for (const option of ["--ids", "--target", "--sds"]) expect(joined, `the CLI spelling must carry ${option}`).toContain(option);
  });

  it.each(RENDERINGS)("%s: the call-site table names every caller and when it calls", (rendering) => {
    const rows = tableRows(read(`${rendering}/${CONTRACT}`));
    const rowOf = (skill: string): string => rows.find((row) => (row.cells[0] ?? "").includes(skill))?.cells.join(" | ") ?? "";
    const expected: Array<[string, RegExp]> = [
      ["kiwi-review-fix-loop", /--close-reqs[\s\S]*--req-filter[\s\S]*--sds/],
      ["kiwi-tdd", /promote_step_requirement/],
      ["kiwi-srs-sync", /verified/],
      ["kiwi-hot-fix", /kiwi-srs-sync/],
      ["kiwi-orchestrator", /승급|promot/i],
      ["kiwi-pipeline", /리뷰|review/i],
      ["kiwi-wave-master", /리뷰|review/i]
    ];
    for (const [skill, when] of expected) {
      const row = rowOf(skill);
      expect(row, `${rendering}: the call-site table has no row for ${skill}`).not.toBe("");
      expect(when.test(row), `${rendering}: the ${skill} row does not say when it calls: ${row}`).toBe(true);
    }
  });

  it.each(RENDERINGS)("%s: the verdict is a closed set and an empty scope is not a pass", (rendering) => {
    const text = read(`${rendering}/${CONTRACT}`);
    expect(text).toMatch(/"verdict":\s*"pass\|gap\|no-scope"/);
    expect(
      /no-scope[^\n]{0,80}(?:통과가 아니다|not a pass)|(?:통과가 아니다|not a pass)[^\n]{0,80}no-scope/.test(text),
      "an unrun check must never read as a pass"
    ).toBe(true);
  });

  it.each(RENDERINGS)("%s: the gate is declared by each calling skill, not by the contract", (rendering) => {
    const text = read(`${rendering}/${CONTRACT}`);
    expect(/critical_gates\[\]/.test(text) && text.includes(GATE), "the contract must tell each caller to declare the gate").toBe(true);
  });
});

/**
 * The governing sentences, held verbatim.
 *
 * Proximity patterns let a one-word inversion through: measured in verification round 2, 13 of 14
 * single-sentence inversions ("… 쓰지 않는다" → "… 쓴다", "do not promote" → "promote anyway",
 * "must not … weaken" → "may weaken") stayed green. A sentence that decides a gate is therefore held
 * as it ships, per rendering, so rewording it is a deliberate edit of this list. What this still does
 * not catch is a contradicting sentence added elsewhere in the same file.
 */
const GOVERNING: ReadonlyArray<{ id: string; file: (rendering: string) => string; ko: string; en: string }> = [
  {
    id: "contract: a gap-bearing requirement is never written verified",
    file: (rendering) => `${rendering}/${CONTRACT}`,
    ko: "gap 이 남은 요구는 `verified` 로 쓰지 않는다.",
    en: "A requirement whose gaps remain is not written as `verified`."
  },
  {
    id: "contract: the tool, not the agent, decides gaps",
    file: (rendering) => `${rendering}/${CONTRACT}`,
    ko: "에이전트가 테스트를 읽고 gap 을 판정하지 않는다.",
    en: "the agent does not read tests and decide gaps itself."
  },
  {
    id: "contract: the fill never weakens an existing test",
    file: (rendering) => `${rendering}/${CONTRACT}`,
    ko: "기존 테스트를 지우거나 약화하거나 고치지 않는다.",
    en: "It must not delete, weaken or edit an existing test"
  },
  {
    id: "contract: only a test that passed becomes evidence",
    file: (rendering) => `${rendering}/${CONTRACT}`,
    ko: "그 실행에서 통과한 테스트의 인용만 증거로 쓴다.",
    en: "uses only the citations of tests that passed in that run."
  },
  {
    id: "kiwi-tdd: a remaining gap stops the promotion",
    file: (rendering) => `${rendering}/kiwi-tdd/SKILL.md`,
    ko: "gap 이 남으면 `test-sufficiency-gap` 으로 멈추고 승격하지 않는다.",
    en: "When gaps remain, halt at `test-sufficiency-gap` and do not promote."
  },
  {
    id: "kiwi-srs-sync: a remaining gap stops the verified write",
    file: (rendering) =>
      rendering === "skills/claude" ? `${rendering}/kiwi-srs-sync/SKILL.md` : `${rendering}/kiwi-srs-sync/references/extended-workflow.md`,
    ko: "gap 이 남은 REQ 는 verified 로 쓰지 않는다 (`test-sufficiency-gap`)",
    en: "gap 이 남은 REQ 는 verified 로 쓰지 않는다 (`test-sufficiency-gap`)"
  },
  {
    id: "kiwi-review-fix-loop: the fill diff goes through the preservation scan",
    file: (rendering) => `${rendering}/kiwi-review-fix-loop/SKILL.md`,
    ko: "그 diff 에도 §6.2 의 보존 스캔을 적용한다.",
    en: "Run the preservation scan (보존 스캔 section) over its diff."
  },
  {
    id: "kiwi-hot-fix: the scope is the high-confidence candidates only",
    file: (rendering) =>
      rendering === "skills/claude" ? `${rendering}/kiwi-hot-fix/SKILL.md` : `${rendering}/kiwi-hot-fix/references/extended-workflow.md`,
    ko: "candidate_req_ids 중 match_confidence=high",
    en: "candidate_req_ids root-cause mapped with match_confidence=high"
  }
];

describe("FR-FLOW-186 AC-1 · AC-2 · AC-3 — the sentences that decide a gate are held verbatim", () => {
  for (const sentence of GOVERNING) {
    it.each(RENDERINGS)(`%s: ${sentence.id}`, (rendering) => {
      // Joined across the English renderings' hard wraps, so a faithful wrap is not a change.
      const text = read(sentence.file(rendering)).replace(/\s*\n\s*/g, " ");
      const expected = rendering === "skills/claude" ? sentence.ko : sentence.en;
      expect(text, `${sentence.file(rendering)} no longer carries: ${expected}`).toContain(expected);
    });
  }
});

describe("FR-FLOW-186 AC-2 — kiwi-review-fix-loop runs the check as its last phase when a scope is known", () => {
  const SKILL = "kiwi-review-fix-loop";

  it.each(RENDERINGS)("%s: accepts --req-filter and --sds as scope inputs", (rendering) => {
    // Read from the input table itself: the check's own section tabulates the same two flags as
    // scope sources, and a flag named only there is one no caller is told it may pass.
    const inputs = sectionAcross(rendering, SKILL, /^#{2,4}\s*(?:1\.2\b|Inputs\b)/);
    expect(inputs, `${rendering}: the input section must be locatable`).not.toBe("");
    const rows = tableRows(inputs).map((row) => row.cells.join(" | "));
    expect(rows.some((row) => row.includes("--req-filter")), `${rendering}: no input row for --req-filter`).toBe(true);
    expect(rows.some((row) => row.includes("--sds")), `${rendering}: no input row for --sds`).toBe(true);
  });

  it.each(RENDERINGS)("%s: the check is the last phase before the close and the report", (rendering) => {
    const body = read(`${rendering}/${SKILL}/SKILL.md`);
    const flow = phaseFlowLines(body);
    if (flow.length > 0) {
      const at = flow.findIndex((line) => NAMES_CHECK.test(line));
      const regression = flow.findIndex((line) => /^Phase 7 :/.test(line));
      const close = flow.findIndex((line) => /^Phase 7\.5/.test(line));
      expect(at, `${rendering}: the phase flow has no test-sufficiency phase`).toBeGreaterThan(regression);
      expect(regression, `${rendering}: the regression phase must be locatable`).toBeGreaterThanOrEqual(0);
      expect(at, `${rendering}: the check must precede the --close-reqs promotion`).toBeLessThan(close);
      for (const trigger of ["--close-reqs", "--req-filter", "--sds"]) expect(flow[at], `${rendering}: scope trigger ${trigger}`).toContain(trigger);
      for (const later of flow.slice(at + 1).filter((line) => /^Phase /.test(line))) {
        expect(/^Phase (?:7\.5|8)\b/.test(later), `${rendering}: a phase after the check is not the close or the report: ${later}`).toBe(true);
      }
      return;
    }
    const items = numberedItems(section(body, /^##\s*Workflow/));
    const at = items.findIndex((item) => NAMES_CHECK.test(item));
    const regression = items.findIndex((item) => /Run regression/.test(item));
    expect(regression, `${rendering}: the regression step must be locatable`).toBeGreaterThanOrEqual(0);
    expect(at, `${rendering}: the workflow has no test-sufficiency step after regression`).toBeGreaterThan(regression);
    for (const trigger of ["--close-reqs", "--req-filter", "--sds"]) expect(items[at], `${rendering}: scope trigger ${trigger}`).toContain(trigger);
    for (const later of items.slice(at + 1)) {
      expect(/--close-reqs|report/i.test(later), `${rendering}: a step after the check is not the close or the report: ${later}`).toBe(true);
    }
  });

  it.each(RENDERINGS)("%s: the check's own section cites the contract and scopes --close-reqs to eligible", (rendering) => {
    const found = sectionAcross(rendering, SKILL, /^#{2,6}\s.*(?:테스트 충분성|Test sufficiency)/i);
    expect(found, `${rendering}: no section of its own for the check`).not.toBe("");
    expect(found).toContain(CONTRACT);
    expect(found, "under --close-reqs the scope is the eligible set").toMatch(/--close-reqs[^\n]*`eligible`/);
    // The halt itself, not only a gate row elsewhere: a raised gate ends neither in TASK_DONE nor in
    // the promotion.
    expect(found, "a raised gate is named where the check runs").toContain(GATE);
    expect(found, "a raised gate forbids TASK_DONE").toMatch(/does not end `TASK_DONE`|`TASK_DONE` 으로 끝나지 않/);
    expect(found, "a raised gate keeps the run out of the promotion").toMatch(/does not enter the `--close-reqs` promotion|Phase 7\.5 승급에 들어가지 않는다/);
  });

  it.each(RENDERINGS)("%s: under --close-reqs the tool's citations replace the LLM naming each test", (rendering) => {
    const sections: string[] = [];
    for (const doc of skillDocs(rendering, SKILL)) {
      const lines = doc.text.split("\n");
      for (const list of numberedLists(lines)) {
        if (!list.text.includes("update_status") || !list.text.includes("verified")) continue;
        const heading = (() => {
          for (let index = list.start; index >= 0; index -= 1) if (/^#{1,6}\s/.test(lines[index] as string)) return index;
          return 0;
        })();
        sections.push(lines.slice(heading, list.end).join("\n"));
      }
    }
    expect(sections.length, `${rendering}: no promotion sequence found`).toBeGreaterThan(0);
    for (const promotion of sections) {
      expect(NAMES_CHECK.test(promotion), `${rendering}: the promotion does not take its per-criterion identifier from the check`).toBe(true);
      expect(LLM_NAMING.test(promotion), `${rendering}: the promotion still has the agent name a test per criterion`).toBe(false);
    }
  });

  it.each(RENDERINGS)("%s: declares the gate in critical_gates[]", (rendering) => {
    expect(declaresCriticalGate(rendering, SKILL, GATE)).toBe(true);
  });
});

describe("FR-FLOW-186 AC-3 — the check runs immediately before every other write of verified", () => {
  it.each(RENDERINGS)("%s: kiwi-tdd runs it before promote_step_requirement", (rendering) => {
    const body = read(`${rendering}/kiwi-tdd/SKILL.md`);
    const promotion = section(body, /^#{3,6}\s*2\.7\b/);
    const at = promotion.indexOf(CONTRACT);
    expect(at, `${rendering}: §2.7 does not cite the contract`).toBeGreaterThanOrEqual(0);
    expect(at, `${rendering}: the check must come before the promotion call`).toBeLessThan(promotion.indexOf("promote_step_requirement"));
    const scope = promotion.slice(Math.max(0, at - 400), at + 400);
    expect(scope, `${rendering}: the step's design.md is part of the scope`).toMatch(/--sds[^\n]*design\.md/);
    // Evidence is recorded from the tool's citations, so the check comes first; and the red-first
    // tests carry the requirement citation, so the fill is not left to write never-red duplicates.
    expect(at, `${rendering}: the check must come before the evidence rows it feeds`).toBeLessThan(promotion.indexOf("Verification Evidence"));
    const citeAt = promotion.indexOf("<REQ-ID> AC-<m>");
    expect(citeAt, `${rendering}: the Phase 3 tests gain the requirement citation`).toBeGreaterThanOrEqual(0);
    expect(citeAt, `${rendering}: the citation is added before the check reads it`).toBeLessThan(at);
    expect(promotion, `${rendering}: a remaining gap stops the promotion`).toMatch(/`test-sufficiency-gap`[^\n]*(?:do not promote|승격하지 않는다)/);

    const phase6 = phaseFlowLines(body).find((line) => /^Phase 6\b/.test(line)) ?? "";
    expect(phase6.search(/test-sufficiency|테스트 충분성/), `${rendering}: the flow line names the check`).toBeGreaterThanOrEqual(0);
    expect(phase6.search(/test-sufficiency|테스트 충분성/)).toBeLessThan(phase6.indexOf("promote_step_requirement"));

    expect(declaresCriticalGate(rendering, "kiwi-tdd", GATE)).toBe(true);
    const row = criticalGateRows(body).find((entry) => entry.gateId === GATE);
    expect(row?.location ?? "", "the gate is observed right before promotion").toContain("promote_step_requirement");
  });

  it.each(RENDERINGS)("%s: kiwi-srs-sync runs it before writing verified", (rendering) => {
    // The FR-FLOW-154 suite pins §10.1 to its seven numbered tool steps and its line shape
    // (`SECTION_10_1_SHAPE`, `mutationListSteps`) and records the update_status line's values with
    // their surrounding text, so the check cannot be a step of its own: it rides on the evidence
    // step, the first step that needs its citations, and that line carries the gate that stops the
    // verified write.
    const mutationOrder = sectionAcross(rendering, "kiwi-srs-sync", /^#{3,6}\s*10\.1\b/);
    const lines = mutationOrder.split("\n");
    const at = lines.findIndex((line) => line.includes(CONTRACT));
    const status = lines.findIndex((line) => /^\s*\d+\.\s*update_status\b/.test(line));
    const evidence = lines.findIndex((line) => /^\s*\d+\.\s*add_verification_evidence\b/.test(line));
    expect(at, `${rendering}: the mutation order does not cite the contract`).toBeGreaterThanOrEqual(0);
    expect(status, `${rendering}: the update_status step must be locatable`).toBeGreaterThan(0);
    expect(at, `${rendering}: the check must precede the verified write`).toBeLessThan(status);
    expect(at, `${rendering}: the check feeds the evidence, so it sits no later than it`).toBeLessThanOrEqual(evidence);
    const checkLine = lines[at] as string;
    expect(checkLine, `${rendering}: the check is scoped to what will be written verified`).toMatch(/verified/);
    expect(checkLine, `${rendering}: a remaining gap stops the verified write`).toContain(GATE);
    expect(checkLine.indexOf(CONTRACT), `${rendering}: the check comes before the evidence it feeds`).toBeLessThan(checkLine.indexOf("reference"));
    expect(declaresCriticalGate(rendering, "kiwi-srs-sync", GATE)).toBe(true);
  });

  it.each(RENDERINGS)("%s: kiwi-hot-fix runs it before it delegates to kiwi-srs-sync", (rendering) => {
    const delegation = sectionAcross(rendering, "kiwi-hot-fix", /^#{2,6}\s*(?:6\.2\.1\b|Sync Delegation)/);
    const at = delegation.indexOf(CONTRACT);
    expect(at, `${rendering}: the delegation section does not cite the contract`).toBeGreaterThanOrEqual(0);
    expect(at, `${rendering}: the check must precede the delegation`).toBeLessThan(delegation.search(SYNC_DELEGATION));
    expect(delegation, `${rendering}: the scope is the high-confidence candidate requirements`).toMatch(/candidate_req_ids|candidate REQ IDs/);
    expect(delegation, `${rendering}: a remaining gap stops the delegation`).toMatch(/`test-sufficiency-gap`[\s\S]{0,60}(?:do not\s+delegate|위임하지 않는다)/);

    const body = read(`${rendering}/kiwi-hot-fix/SKILL.md`);
    const flow = phaseFlowLines(body);
    if (flow.length > 0) {
      const phase6 = flow.find((line) => /^Phase 6\b/.test(line)) ?? "";
      expect(phase6.search(/test-sufficiency|테스트 충분성/), `${rendering}: the flow line names the check`).toBeGreaterThanOrEqual(0);
      expect(phase6.search(/test-sufficiency|테스트 충분성/)).toBeLessThan(phase6.indexOf("kiwi-srs-sync"));
    } else {
      const items = numberedItems(section(body, /^##\s*Workflow/));
      const check = items.findIndex((item) => NAMES_CHECK.test(item));
      const delegate = items.findIndex((item) => /^\d+\.\s*Delegate to/.test(item));
      expect(check, `${rendering}: the workflow has no test-sufficiency step`).toBeGreaterThanOrEqual(0);
      expect(check, `${rendering}: the check must precede the delegation step`).toBeLessThan(delegate);
    }
    expect(declaresCriticalGate(rendering, "kiwi-hot-fix", GATE)).toBe(true);
  });
});

describe("FR-FLOW-186 AC-4 · FR-FLOW-183 AC-3 — the run-end check passes no SDS the close-out has deleted", () => {
  /** The §2 table rows of one caller, as `{ when, scope }`. */
  function callerRows(rendering: string, caller: string): Array<{ when: string; scope: string }> {
    const table = section(read(`${rendering}/${CONTRACT}`), /^##\s+2\./);
    return tableRows(table)
      .filter((row) => row.cells[0] === `\`${caller}\``)
      .map((row) => ({ when: row.cells[1] ?? "", scope: row.cells[2] ?? "" }));
  }

  const CLOSING_HOP = /closing code-review hop|종료 코드 리뷰 홉/;
  const ADDS_SDS = /\+\s*(?:(?:its|the|each of its|그|wave)\s+)*(?:wave\s+)?SDS/;

  it.each(RENDERINGS)("%s: orchestrator and wave-master scope a wave's pre-promotion check by its SDS and the run-end check without one", (rendering) => {
    for (const caller of ["kiwi-orchestrator", "kiwi-wave-master"]) {
      const rows = callerRows(rendering, caller);
      const promotion = rows.filter((row) => /promotion|승급/.test(row.when) && !CLOSING_HOP.test(row.when));
      expect(promotion.length, `${rendering}: ${caller} has no pre-promotion row`).toBe(1);
      expect(promotion[0]?.scope, `${rendering}: ${caller}'s pre-promotion check reads the wave SDS`).toMatch(/SDS/);

      const runEnd = rows.filter((row) => CLOSING_HOP.test(row.when));
      expect(runEnd.length, `${rendering}: ${caller} has no run-end row`).toBe(1);
      expect(runEnd[0]?.scope, `${rendering}: ${caller}'s run-end check must not add a wave SDS`).not.toMatch(ADDS_SDS);
      expect(runEnd[0]?.scope, `${rendering}: ${caller}'s run-end row says why no wave SDS is passed`).toMatch(/deleted|삭제/);
    }
  });

  it.each(RENDERINGS)("%s: the pipeline's cycle-end check still reads its SDS, which is deleted only after it", (rendering) => {
    const rows = callerRows(rendering, "kiwi-pipeline").filter((row) => CLOSING_HOP.test(row.when));
    expect(rows.length).toBe(1);
    expect(rows[0]?.scope).toMatch(ADDS_SDS);
    expect(rows[0]?.when, `${rendering}: the cycle-end check comes before the SDS is deleted`).toMatch(/before[^|]*delet|삭제[^|]*전/);
  });

  it.each(RENDERINGS)("%s: a split SDS is checked once per file before the promoting hop", (rendering) => {
    // kiwi-pipeline §2.5.4 item 2: the promoting hop takes one --sds, so a split SDS is checked per file first.
    const split = callerRows(rendering, "kiwi-pipeline").filter((row) => /--close-reqs/.test(row.when) && !CLOSING_HOP.test(row.when));
    expect(split.length, `${rendering}: the table has no pre-promotion row for a split SDS`).toBe(1);
    expect(split[0]?.when, `${rendering}: the row is scoped to a split SDS`).toMatch(/split|나뉘/);
    expect(split[0]?.scope, `${rendering}: each file is passed on its own`).toMatch(/Requirements/);
    expect(split[0]?.scope, `${rendering}: each file is passed on its own`).toMatch(/--sds <[^>]+>/);
  });

  it.each(RENDERINGS)("%s: the cycle-end check of a split SDS passes each file, not the base file that does not exist", (rendering) => {
    // FR-FLOW-186 AC-4 — a split SDS has no `<sds-id>.sds.md`; naming it makes the tool error, which the
    // procedure records as a gap and halts the cycle on.
    const end = callerRows(rendering, "kiwi-pipeline").filter((row) => CLOSING_HOP.test(row.when));
    expect(end[0]?.scope, `${rendering}: the cycle-end row says what a split SDS passes`).toMatch(/(?:split|나뉘)[^|]*(?:each|마다)/);
    const item = numberedItems(sectionAcross(rendering, "kiwi-pipeline", /^#{2,6}\s*2\.5\.4\b/)).find((entry) => /^4\.\s/.test(entry)) ?? "";
    expect(item, `${rendering}: kiwi-pipeline §2.5.4 item 4 is missing`).not.toBe("");
    expect(item, `${rendering}: kiwi-pipeline §2.5.4 item 4 passes each file of a split SDS`).toMatch(/(?:split|나뉘)[^.]*(?:each|마다)/);
  });
});

describe("FR-MCP-064 AC-7 — a step design.md is checked through the CLI inside a worktree", () => {
  it.each(RENDERINGS)("%s: the procedure sends a per-call-root check of a step design.md to the CLI", (rendering) => {
    const procedure = section(read(`${rendering}/${CONTRACT}`), /^##\s.*(?:절차|Procedure)/);
    const line = procedure.split("\n").find((candidate) => candidate.includes("workspaceRoot") && candidate.includes("design.md"));
    expect(line, `${rendering}: no procedure line names the per-call root limit`).toBeDefined();
    expect(line, `${rendering}: the limit names the refused argument's location`).toContain("docs/spec");
    expect(line, `${rendering}: the limit names the CLI to use instead`).toContain(CLI_TOOL);
    expect(line, `${rendering}: the limit cites where it is recorded`).toContain("FR-MCP-064 AC-7");
  });
});

describe("FR-FLOW-186 AC-4 — the orchestrator's and wave-master's pre-promotion check passes --sds once per wave SDS file", () => {
  /** Once per SDS file, with that file as `--sds`, in either language. */
  const PER_FILE = /(?:SDS 파일마다 `--sds(?: <그 파일>)?`|`--sds` for each of its SDS files|once per SDS file of the wave with that file as `--sds`)/;

  it.each(RENDERINGS)("FR-FLOW-186 AC-4 %s: the contract's pre-promotion rows scope each caller's check per wave SDS file", (rendering) => {
    const table = section(read(`${rendering}/${CONTRACT}`), /^##\s+2\./);
    for (const caller of ["kiwi-orchestrator", "kiwi-wave-master"]) {
      const rows = tableRows(table).filter((row) => row.cells[0] === `\`${caller}\`` && /PW-14/.test(row.cells[1] ?? ""));
      expect(rows.length, `${rendering}: ${caller} has no PW-14 row in the contract`).toBe(1);
      expect(rows[0]?.cells[2] ?? "", `${rendering}: ${caller}'s pre-promotion check is not run once per wave SDS file`).toMatch(PER_FILE);
    }
  });

  it.each(RENDERINGS)("FR-FLOW-186 AC-4 %s: parallel-waves PW-14 runs the check once per wave SDS file", (rendering) => {
    const pw14 = read(`${rendering}/_shared/kiwi/parallel-waves.md`)
      .split("\n")
      .find((line) => /^\*\*PW-14 ·/.test(line)) ?? "";
    expect(pw14, `${rendering}: parallel-waves.md has no PW-14 step`).not.toBe("");
    expect(pw14, `${rendering}: PW-14 does not pass --sds per wave SDS file`).toMatch(PER_FILE);
  });

  it.each(RENDERINGS)("FR-FLOW-186 AC-4 %s: kiwi-orchestrator's promotion step checks each wave SDS file before it promotes", (rendering) => {
    const lines = skillDocs(rendering, "kiwi-orchestrator").flatMap((doc) => doc.text.split("\n"));
    const step = lines.find((line) => /^\*\*1\. 테스트 충분성 확인\*\*/.test(line)) ?? "";
    expect(step, `${rendering}: kiwi-orchestrator has no pre-promotion test-sufficiency step`).not.toBe("");
    expect(step, `${rendering}: the check is not placed right before promotion`).toMatch(/승급 \*\*바로 앞\*\*/);
    expect(step, `${rendering}: the check does not pass --sds per wave SDS file`).toMatch(PER_FILE);
    expect(step, `${rendering}: a re-entry SDS is not counted among the wave's SDS files`).toMatch(/재진입이 쓴 SDS\([^)]*\)도 그 wave 의 SDS 파일이다/);
  });

  /** The mirror leaves kiwi-wave-master out on purpose (its exclusion file), so it is not a rendering to read. */
  const WAVE_MASTER_RENDERINGS = RENDERINGS.filter((rendering) => !(rendering === ".agents/skills" && MIRROR_EXCLUDED.includes("kiwi-wave-master")));

  it.each(WAVE_MASTER_RENDERINGS)("FR-FLOW-186 AC-4 %s: kiwi-wave-master's wave promotion checks each wave SDS file first", (rendering) => {
    const lines = skillDocs(rendering, "kiwi-wave-master").flatMap((doc) => doc.text.split("\n"));
    const step = lines.find((line) => /PW-14 ~ PW-17 을 돈다/.test(line)) ?? "";
    expect(step, `${rendering}: kiwi-wave-master does not run PW-14..PW-17 per wave`).not.toBe("");
    expect(step, `${rendering}: the wave check does not pass --sds per wave SDS file`).toMatch(PER_FILE);
    expect(step.indexOf("테스트 충분성 확인"), `${rendering}: the check is not the first of the promotion steps`).toBeLessThan(step.indexOf("승급("));
    expect(step, `${rendering}: a re-entry SDS file is not checked on its own`).toMatch(/재진입 SDS 파일도[^.]*테스트 충분성 확인도 그 파일마다 돈다/);
  });
});
