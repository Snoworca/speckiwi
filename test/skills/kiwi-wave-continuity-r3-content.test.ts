import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { moduleRegion, readResolvedSkill } from "../support/resolved-skill.js";

// Round-3 evaluation findings — docs/analysis/wave-fit-eval/round3-findings.md.
// Each test carries the finding id (R3-H1 … R3-L2) instead of a requirement tag; the SRS ids are
// assigned after these contracts are agreed.
//
// A SKILL.md is natural-language agent instruction, not executable code, so the behaviour cannot be
// exercised in a unit test; these are raw-text contract assertions over every shipped variant — the
// same technique the FR-FLOW-029/042…055 and the round-2 suites use.
//
// kiwi-wave-master is deliberately excluded from the `.agents/skills` mirror
// (.agents/skills/.speckiwi-mirror-exclusions.json), so its SKILL.md lives in exactly three copies.
// The shared waves-event / pipeline-event contracts ARE mirrored (4 copies) and their halves of the
// round-3 repairs are asserted in kiwi-event-contract-content.test.ts.
//
// Assertion style, dictated by mutations that survived earlier rounds:
//   - scope to the governing section and cut it at the next same-or-higher heading;
//   - anchor a normative rule to its own line or its own table cell, never to a character window;
//   - assert hedge vocabulary is ABSENT from the sentence that carries a MUST;
//   - assert quantifiers and polarity literally;
//   - compare positions for ordering rules;
//   - for a producer/consumer defect, assert the PRODUCTION obligation — the consumption sentence is
//     already green and asserting it proves nothing.
//
// docs/plans/2026-07-29.speckiwi.v244-r3.implementation-contract.md is the authoring companion and
// pins every identifier below.

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const VARIANTS = ["claude", "codex", "etc"] as const;

/** @req FR-FLOW-110 — resolved through the shared reader: SKILL.md plus the bodies of the
 * `_shared/kiwi/` modules its §0 table references, appended in table order. */
function readSkill(variant: string, skill: string): string {
  return readResolvedSkill(variant, skill);
}

const readWave = (v: string) => readSkill(v, "kiwi-wave-master");
const readPipeline = (v: string) => readSkill(v, "kiwi-pipeline");
const readPlanner = (v: string) => readSkill(v, "kiwi-planner");
const readPm = (v: string) => readSkill(v, "kiwi-pm");
const readCoder = (v: string) => readSkill(v, "kiwi-coder");
const readReviewFix = (v: string) => readSkill(v, "kiwi-review-fix-loop");
const readSrs = (v: string) => readSkill(v, "kiwi-srs");
const readFeasibility = (v: string) => readSkill(v, "kiwi-srs-feasibility");

/** Body with the YAML frontmatter stripped, so the `description` field cannot false-green a check. */
function skillBody(text: string): string {
  return text.replace(/^---[\s\S]*?\n---\s*\n?/, "");
}

/**
 * The codex and etc variants of kiwi-coder / kiwi-planner / kiwi-pm move their long tail — including
 * the whole `Pipeline event emit` section — into `references/extended-workflow.md`, keeping the same
 * section numbers. Looking only at SKILL.md would make an assertion about §12/§17/§10 unsatisfiable
 * in two of the three variants, so the reference file is the documented fallback. It is a fallback,
 * not a concatenation: identical headings exist in both files for other sections, and searching a
 * joined document would let a rule pass from the wrong half.
 */
function readExtendedRef(variant: string, skill: string): string {
  try {
    return readFileSync(
      path.join(REPO_ROOT, "skills", variant, skill, "references", "extended-workflow.md"),
      "utf8"
    );
  } catch {
    return "";
  }
}

/** A heading and everything under it, down to the next same-or-higher-level heading. "" when absent. */
function sectionUnder(body: string, headingRe: RegExp): string {
  const lines = body.split("\n");
  const start = lines.findIndex((line) => /^#{1,6}\s/.test(line) && headingRe.test(line));
  if (start === -1) return "";
  const level = (lines[start].match(/^#+/) as RegExpMatchArray)[0].length;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const m = lines[i].match(/^#+/);
    if (m && m[0].length <= level) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}


/**
 * @req FR-FLOW-110 — a section whose rules moved into a `_shared/kiwi/` module is scoped to the
 * skill's own section PLUS that module's appended region. Two bounded regions, never the whole body.
 */
function withModule(body: string, headingRe: RegExp, moduleName: string): string {
  return `${sectionUnder(body, headingRe)}\n${moduleRegion(body, moduleName)}`;
}

const BASELINE_SECTION = /^#{2,4}\s.*설계 기준선/;
const COVERAGE_SECTION = /^#{2,4}\s.*분해 커버리지 게이트/;

/** The single line containing the first match of `re`. "" when absent. */
function lineWith(text: string, re: RegExp): string {
  return text.split("\n").find((l) => re.test(l)) ?? "";
}

/** Every markdown table row (a line starting with `|`) in `text` that matches `re`. */
function tableRows(text: string, re: RegExp): string[] {
  return text.split("\n").filter((l) => /^\s*\|/.test(l) && re.test(l));
}

/** Trimmed cells of the first table row matching `re`; [] when absent. */
function rowCells(text: string, re: RegExp): string[] {
  const row = tableRows(text, re)[0];
  return row ? row.split("|").map((c) => c.trim()) : [];
}

/**
 * Hedges that turn a MUST into a SHOULD. Every co-occurrence regex in this file is satisfiable by a
 * hedged sentence — "…하지 않는 것을 원칙으로 하되, 필요하면 할 수 있다" keeps every anchor token —
 * so each prohibition additionally asserts that its own sentence carries none of these.
 */
const HEDGE = /수 있다|해도 된다|권장|바람직|원칙적으로|원칙으로 하되|가능하면|되도록|경우에 따라|가급적|지양/;

/** The `critical_gates[]` declaration section of whichever skill is under test. */
function gateSection(body: string): string {
  return sectionUnder(body, /^#{2,4}\s.*critical_gates/i);
}

/** The declared gate ids of a skill, read from the FIRST cell of each gate-table row. */
function gateIds(body: string): string[] {
  return gateSection(body)
    .split("\n")
    .filter((l) => /^\s*\|/.test(l) && l.split("|").length >= 5)
    .map((l) => (l.split("|")[1] ?? "").trim())
    .map((cell) => (cell.match(/^`([a-z][a-z0-9-]*)`$/) ?? [])[1])
    .filter((id): id is string => Boolean(id));
}

/** The optional-input table of a skill. codex/etc kiwi-review-fix-loop uses an English heading. */
function optionSection(body: string): string {
  return sectionUnder(body, /^#{2,3}\s.*(?:1\.2\s*선택 입력|Inputs\s*$)/);
}

/** A section that lives in SKILL.md in one variant and in references/extended-workflow.md in another. */
function skillOrRefSection(variant: string, skill: string, headingRe: RegExp): string {
  const inSkill = sectionUnder(skillBody(readSkill(variant, skill)), headingRe);
  return inSkill !== "" ? inSkill : sectionUnder(readExtendedRef(variant, skill), headingRe);
}

// ---------------------------------------------------------------------------------------------
// Contract identifiers the implementation must use verbatim. Pinning them here is the point: a
// prose-only instruction lets each of the three copies invent its own spelling, and a shared
// consumer — auto-option (keyed on gate_id) or the waves-event schema (keyed on field name) — then
// cannot match any of them.
// ---------------------------------------------------------------------------------------------

/** R3-H6/H10/M10/L2: the four gate ids round 3 adds to kiwi-wave-master. */
const R3_WAVE_GATE_IDS = [
  "wave-verify-fail-residual",
  "out-of-scope-user-consent",
  "wave-append-cap-exhausted",
  "invalid-loop-option"
] as const;

/** R3-H6: the closed vocabulary an out-of-scope exclusion must be classified with. */
const EXCLUSION_CLASSES = [
  "already-implemented",
  "superseded",
  "external-ownership",
  "user-excluded",
  "non-normative"
] as const;

/** R3-L1: the streak requirement, which is an intentional per-variant difference (etc = 3). */
const MAX_STREAK: Record<string, string> = { claude: "2", codex: "2", etc: "3" };

/** R3-M19: `_shared/kiwi/auto-option.md` is mirrored, so it ships in four copies like the event contracts. */
const AUTO_OPTION_COPIES = [
  "skills/claude/_shared/kiwi/auto-option.md",
  "skills/codex/_shared/kiwi/auto-option.md",
  "skills/etc/_shared/kiwi/auto-option.md",
  ".agents/skills/_shared/kiwi/auto-option.md"
] as const;

function readShared(relPath: string): string {
  try {
    return readFileSync(path.join(REPO_ROOT, relPath), "utf8");
  } catch {
    return "";
  }
}

// =============================================================================================
// R3-H1 — the execution layer needs the same evidence-based resolution the verification layer has.
// Branch chosen: resolution is granted for file moves/deletions and public-symbol changes only.
// Test weakening/deletion stays unconditionally critical (R3-M12) — a plan Task that asks for a
// weakened assertion is exactly the "lower the bar instead of fixing the defect" path the gate exists
// to block, so extending the escape hatch to it would close the gate the finding wants opened.
// =============================================================================================
describe("R3-H1 — kiwi-coder resolves a preservation gate on recorded evidence", () => {
  for (const variant of VARIANTS) {
    describe(`${variant} variant`, () => {
      it("declares §0.20.4 with the same two-value verdict the wave layer uses", () => {
        const common = sectionUnder(skillBody(readCoder(variant)), /^##\s*0\.\s/);
        expect(common, `${variant}: kiwi-coder must have a common-convention section`).not.toBe("");
        const row = tableRows(common, /§0\.20\.4/)[0] ?? "";
        expect(row, `${variant}: the evidence-based resolution rule must be its own §0.20.4 row`).not.toBe("");
        expect(
          /`intended-improvement`/.test(row) && /`unapproved-damage`/.test(row),
          `${variant}: §0.20.4 must judge with the same two-value enum kiwi-wave-master §5.5.2 uses; a third spelling makes the two layers unmergeable`
        ).toBe(true);
        expect(HEDGE.test(row), `${variant}: the resolution rule must be absolute, not hedged`).toBe(false);
      });

      it("requires the citation to be a sidecar REQ-ID or Task-ID whose action names the change", () => {
        const common = sectionUnder(skillBody(readCoder(variant)), /^##\s*0\.\s/);
        const row = tableRows(common, /§0\.20\.4/)[0] ?? "";
        expect(
          /REQ-ID/.test(row) && /Task-ID/.test(row),
          `${variant}: the citation must be a REQ-ID or a Task-ID, not free text`
        ).toBe(true);
        expect(
          /`sidecar`|sidecar\./.test(row),
          `${variant}: the citation must be resolvable in the sidecar, otherwise the coder judges its own authority`
        ).toBe(true);
        // The whole point of the finding: mere presence in files[] never resolved the gate, so the
        // resolution must turn on the action naming the destructive verb.
        expect(
          /`action`[^|]*명시/.test(row),
          `${variant}: the Task action must explicitly name the move/deletion/signature change; presence in files[] alone is not authority`
        ).toBe(true);
        expect(
          /근거[^|]*(?:없|대지 못)[^|]*`unapproved-damage`|`unapproved-damage`[^|]*근거/.test(row),
          `${variant}: an uncited change must default to unapproved-damage`
        ).toBe(true);
      });

      // R3-M12 half: the resolution must not reach test weakening.
      it("refuses to resolve a weakened or deleted test on the same evidence", () => {
        const common = sectionUnder(skillBody(readCoder(variant)), /^##\s*0\.\s/);
        const row = tableRows(common, /§0\.20\.4/)[0] ?? "";
        expect(
          /(?:약화|§0\.20\.3)[^|]*(?:해소되지 않는다|해소하지 못한다|예외가 아니다)/.test(row),
          `${variant}: a weakened or deleted existing test must stay critical even with a REQ/Task citation`
        ).toBe(true);
      });

      it("points the two resolvable gate rows at §0.20.4", () => {
        const gates = gateSection(skillBody(readCoder(variant)));
        expect(gates, `${variant}: kiwi-coder must have a critical_gates table`).not.toBe("");
        for (const id of ["existing-public-contract-change", "existing-file-deleted-or-moved"]) {
          const cells = rowCells(gates, new RegExp("`" + id + "`"));
          expect(cells.length > 3, `${variant}: kiwi-coder must declare ${id}`).toBe(true);
          expect(
            /§0\.20\.4/.test(cells[2]),
            `${variant}: ${id} must name §0.20.4 as its resolution path, otherwise the halt is still unconditional`
          ).toBe(true);
        }
      });

      it("makes the wave layer cite the same rule so the two verdicts cannot diverge", () => {
        const stance = withModule(skillBody(readWave(variant)), /^###\s*5\.5\.2/, "verify-loop");
        expect(stance, `${variant}: the verifier-stance section must exist`).not.toBe("");
        const rule = lineWith(stance, /kiwi-coder\s*§0\.20\.4/);
        expect(
          rule,
          `${variant}: kiwi-wave-master §5.5.2 must cite kiwi-coder §0.20.4 as the shared judgement rule`
        ).not.toBe("");
        expect(
          /같은 (?:규칙|문장)|동일한 (?:규칙|문장)/.test(rule),
          `${variant}: the sentence must state that both layers share one rule, not merely mention the other section`
        ).toBe(true);
      });
    });
  }
});

// =============================================================================================
// R3-H2 — one event, two mutually exclusive treatments; and the bubble-up kiwi-pm presumes is undefined.
// =============================================================================================
describe("R3-H2 — self-healing is bounded and then bubbles up with its gate id", () => {
  for (const variant of VARIANTS) {
    describe(`${variant} variant`, () => {
      it("stops healing on the second detection of the same item and bubbles up", () => {
        const impl = sectionUnder(skillBody(readCoder(variant)), /^##\s*5\.\s/);
        expect(impl, `${variant}: the implementation-loop section must exist`).not.toBe("");
        const rule = lineWith(impl, /2회째/);
        expect(rule, `${variant}: §5.1 must bound the self-healing re-invocation`).not.toBe("");
        expect(
          /동일 항목/.test(rule),
          `${variant}: the bound must be per item; a global counter lets a second distinct breakage heal forever`
        ).toBe(true);
        expect(
          /버블업/.test(rule),
          `${variant}: the second detection must bubble up to the parent — the word kiwi-pm §3.4 presumes and kiwi-coder never used`
        ).toBe(true);
        expect(
          /§0\.G6/.test(rule),
          `${variant}: the halt must be raised through the declared §0.G6 gate, not as a free-form stop`
        ).toBe(true);
        expect(HEDGE.test(rule), `${variant}: the escalation must be absolute, not hedged`).toBe(false);
      });

      it("carries the gate id in the NEEDS_USER payload", () => {
        const emit = skillOrRefSection(variant, "kiwi-coder", /^##\s*12\./);
        expect(emit, `${variant}: kiwi-coder must have a pipeline-emit section`).not.toBe("");
        const rule = lineWith(emit, /`gate_id`/);
        expect(rule, `${variant}: the status mapping must carry a gate_id channel`).not.toBe("");
        expect(
          /NEEDS_USER/.test(rule),
          `${variant}: gate_id must ride on the NEEDS_USER payload; without it the parent cannot tell which gate halted`
        ).toBe(true);
      });

      it("makes kiwi-pm read that gate id instead of re-classifying by severity", () => {
        const bubble = sectionUnder(skillBody(readPm(variant)), /^###\s*3\.4/);
        expect(bubble, `${variant}: kiwi-pm must have a bubble-up section`).not.toBe("");
        const rule = lineWith(bubble, /`gate_id`/);
        expect(rule, `${variant}: kiwi-pm must state where the child's gate id is read from`).not.toBe("");
        expect(
          /동명|같은 이름|same name/i.test(rule),
          `${variant}: the child's gate id must map to the same-named kiwi-pm gate, or the mapping is left to judgement`
        ).toBe(true);
        expect(HEDGE.test(rule), `${variant}: the mapping must be absolute, not hedged`).toBe(false);
      });
    });
  }
});

// =============================================================================================
// R3-H3 — diff_window and pipeline_run_ids have consumers but no producer. Asserting a consumption
// sentence would be green today; the production obligation is what is missing.
// =============================================================================================
describe("R3-H3 — the diff window and the pipeline run list are produced, not only read", () => {
  for (const variant of VARIANTS) {
    describe(`${variant} variant`, () => {
      it("captures base_sha when the wave is entered", () => {
        const record = sectionUnder(skillBody(readWave(variant)), /^###\s*5\.5\.6/);
        expect(record, `${variant}: the recording section must exist`).not.toBe("");
        const rule = lineWith(record, /`base_sha`/);
        expect(rule, `${variant}: nothing writes base_sha today; the capture must be an obligation`).not.toBe("");
        expect(
          /wave 진입/.test(rule),
          `${variant}: the capture point must be wave entry, not left to the verifier's conversation state`
        ).toBe(true);
        expect(
          /캡처|기록한다/.test(rule),
          `${variant}: the sentence must be a production obligation, not another description of the consumer`
        ).toBe(true);
        expect(HEDGE.test(rule), `${variant}: the capture obligation must be absolute, not hedged`).toBe(false);
      });

      it("captures head_sha at wave-verify round entry and lands both in diff_window", () => {
        const record = sectionUnder(skillBody(readWave(variant)), /^###\s*5\.5\.6/);
        const rule = lineWith(record, /`head_sha`/);
        expect(rule, `${variant}: head_sha must have a capture point`).not.toBe("");
        expect(
          /wave-verify/.test(rule),
          `${variant}: the head must be pinned when the verification round starts, not when the report is written`
        ).toBe(true);
        expect(
          /`diff_window`/.test(rule),
          `${variant}: the captured pair must be carried on the event's diff_window field`
        ).toBe(true);
        expect(HEDGE.test(rule), `${variant}: the capture obligation must be absolute, not hedged`).toBe(false);
      });

      it("appends every spawned pipeline run id to pipeline_run_ids", () => {
        const record = sectionUnder(skillBody(readWave(variant)), /^###\s*5\.5\.6/);
        const rule = lineWith(record, /`pipeline_run_ids`/);
        expect(rule, `${variant}: the run list must have a producer`).not.toBe("");
        expect(
          /spawn|호출할 때마다|실행할 때마다/.test(rule),
          `${variant}: the append must be tied to each pipeline spawn, or a re-entry run is silently missing`
        ).toBe(true);
        expect(
          /append/i.test(rule),
          `${variant}: the list must be appended to, not rewritten — the earlier runs are what widen the window`
        ).toBe(true);
        expect(HEDGE.test(rule), `${variant}: the append obligation must be absolute, not hedged`).toBe(false);
      });
    });
  }
});

// =============================================================================================
// R3-H4 — the re-entry emit key lives in one skill while the children keep "same run_id -> skip".
// Branch chosen: lift the suffix convention to the shared SSOT and separate the emit key from the
// sidecar run_id regex. The alternative — respelling the key as `.r1` so it satisfies the id regex —
// would retire `{run_id}#r{n}`, which an existing round-2 assertion pins, and would silently make the
// emit key look like a legal sidecar id, which is the confusion the separation is meant to end.
// =============================================================================================
describe("R3-H4 — the re-entry emit key is a shared rule with a declared id space", () => {
  for (const variant of VARIANTS) {
    describe(`${variant} variant`, () => {
      it("makes kiwi-pipeline defer to the shared contract rather than own the rule", () => {
        const reentry = sectionUnder(skillBody(readPipeline(variant)), /^###\s*7\.5/);
        expect(reentry, `${variant}: kiwi-pipeline must have a re-entry emit-key section`).not.toBe("");
        const rule = lineWith(reentry, /pipeline-event\.md/);
        expect(rule, `${variant}: the section must name the shared contract as the SSOT`).not.toBe("");
        expect(
          /SSOT|§5\.4/.test(rule),
          `${variant}: the suffix convention must be owned by pipeline-event.md §5.4, so all three consumers read one sentence`
        ).toBe(true);
      });

      it("makes kiwi-planner state the exception to its own same-run_id skip", () => {
        const emit = skillOrRefSection(variant, "kiwi-planner", /^##\s*17\./);
        expect(emit, `${variant}: kiwi-planner must have a pipeline-emit section`).not.toBe("");
        const rule = lineWith(emit, /\{run_id\}#r\{n\}/);
        expect(rule, `${variant}: kiwi-planner must know the re-entry key; otherwise it skips the emit`).not.toBe("");
        expect(
          /재진입/.test(rule),
          `${variant}: the exception must be attached to the re-entry case, not stated as a general rename`
        ).toBe(true);
        expect(
          /skip 하지 않는다|skip 되지 않는다/.test(rule),
          `${variant}: the sentence must say the re-entry emit is NOT skipped — that is the defect being closed`
        ).toBe(true);
        expect(HEDGE.test(rule), `${variant}: the exception must be absolute, not hedged`).toBe(false);
      });

      it("makes kiwi-pm state the same exception", () => {
        const emit = skillOrRefSection(variant, "kiwi-pm", /^##\s*10\./);
        expect(emit, `${variant}: kiwi-pm must have a pipeline-emit section`).not.toBe("");
        const rule = lineWith(emit, /\{run_id\}#r\{n\}/);
        expect(rule, `${variant}: kiwi-pm must know the re-entry key`).not.toBe("");
        expect(
          /재진입/.test(rule),
          `${variant}: the exception must be attached to the re-entry case`
        ).toBe(true);
        expect(
          /skip 하지 않는다|skip 되지 않는다/.test(rule),
          `${variant}: the sentence must say the re-entry emit is NOT skipped`
        ).toBe(true);
        expect(HEDGE.test(rule), `${variant}: the exception must be absolute, not hedged`).toBe(false);
      });

      it("keeps the emit key out of the sidecar id regex", () => {
        const common = sectionUnder(skillBody(readPm(variant)), /^##\s*0\.\s/);
        expect(common, `${variant}: kiwi-pm must have a common-convention section`).not.toBe("");
        const idRule = lineWith(common, /`run_id`\s*=\s*`\[a-z0-9\.-\]\{4,40\}`/);
        expect(idRule, `${variant}: kiwi-pm must keep its id-regex SSOT row`).not.toBe("");
        expect(
          /emit 키|이벤트 emit 키/.test(idRule),
          `${variant}: the id-regex row must say the emit key is a different id space, or "#" trips this gate`
        ).toBe(true);
        expect(
          /적용하지 않는다|대상이 아니다/.test(idRule),
          `${variant}: the regex must be stated as NOT applying to the emit key`
        ).toBe(true);
      });
    });
  }
});

// =============================================================================================
// R3-H5 — resume has no granularity inside the pipeline stage, so it re-runs feasibility.
// =============================================================================================
describe("R3-H5 — resuming the pipeline stage carries its scope", () => {
  for (const variant of VARIANTS) {
    describe(`${variant} variant`, () => {
      it("requires both scope arguments and a kiwi-pm resume on a pipeline-stage resume", () => {
        const progress = sectionUnder(skillBody(readWave(variant)), /^##\s*6\./);
        expect(progress, `${variant}: the progress-tracking section must exist`).not.toBe("");
        const rule = lineWith(progress, /pipeline 단계 재개/);
        expect(rule, `${variant}: §6 must define how the pipeline stage itself resumes`).not.toBe("");
        expect(
          /`--plan-run-id`/.test(rule) && /`--req-filter`/.test(rule),
          `${variant}: both scope arguments must be carried; dropping either re-runs the whole plan`
        ).toBe(true);
        expect(
          /kiwi-pm[^\n]*`--resume`/.test(rule),
          `${variant}: kiwi-pm must be entered with --resume, or completed Tasks run twice`
        ).toBe(true);
        expect(HEDGE.test(rule), `${variant}: the resume contract must be absolute, not hedged`).toBe(false);
      });

      it("journals the plan run id so a resumed session can supply it", () => {
        const progress = sectionUnder(skillBody(readWave(variant)), /^##\s*6\./);
        const rule = lineWith(progress, /`plan_run_id`/);
        expect(rule, `${variant}: the plan run id must be recorded on the event`).not.toBe("");
        expect(
          /`waves\.jsonl`|기록한다/.test(rule),
          `${variant}: a resumed session has no conversation, so the value must be resolvable from the journal`
        ).toBe(true);
      });
    });
  }
});

// =============================================================================================
// R3-H6 — out_of_scope removes a design item from every denominator with no re-check.
// Branch chosen: all three remedies. (i) is the strongest of the three the finding lists and the
// other two are independent of it — a closed vocabulary and a final-pass layer still matter once a
// user has consented, because consent is per exclusion while the final pass is per run.
// =============================================================================================
describe("R3-H6 — an out-of-scope exclusion is consented, classified and re-checked", () => {
  for (const variant of VARIANTS) {
    describe(`${variant} variant`, () => {
      it("classifies each exclusion with a closed vocabulary", () => {
        const baseline = sectionUnder(skillBody(readWave(variant)), BASELINE_SECTION);
        expect(baseline, `${variant}: the design-baseline section must exist`).not.toBe("");
        const rule = lineWith(baseline, /`exclusion_class`/);
        expect(rule, `${variant}: an exclusion must carry a classification, not only free-text reason`).not.toBe("");
        for (const member of EXCLUSION_CLASSES) {
          expect(
            rule.includes(member),
            `${variant}: the exclusion_class enum must define ${member}; a partial list re-opens free text`
          ).toBe(true);
        }
        expect(
          /closed|닫힌 목록|목록 밖/.test(rule),
          `${variant}: the vocabulary must be stated as closed, otherwise a sixth value is invented on the spot`
        ).toBe(true);
      });

      it("halts for user consent even under --auto", () => {
        const gates = gateSection(skillBody(readWave(variant)));
        const cells = rowCells(gates, /`out-of-scope-user-consent`/);
        expect(
          cells.length > 3,
          `${variant}: with no gate row the exclusion falls to the auto committee, which is the cheapest way to shrink every denominator`
        ).toBe(true);
        expect(
          /§3\.2/.test(cells[3]),
          `${variant}: the gate's origin cell must point at §3.2, where the coverage gate reads the exclusions`
        ).toBe(true);
        const gate = sectionUnder(skillBody(readWave(variant)), COVERAGE_SECTION);
        const rule = lineWith(gate, /`out-of-scope-user-consent`/);
        expect(rule, `${variant}: §3.2 must name the gate so the halt has an origin`).not.toBe("");
        expect(
          /`--auto`[^\n]*(?:중단|멈춘다)|중단[^\n]*`--auto`/.test(rule),
          `${variant}: the consent must be stated as surviving --auto`
        ).toBe(true);
        expect(HEDGE.test(rule), `${variant}: the consent gate must be absolute, not hedged`).toBe(false);
      });

      it("puts every excluded item back into the final-pass denominator as its own layer", () => {
        const final = sectionUnder(skillBody(readWave(variant)), /^##\s*5\.6/);
        expect(final, `${variant}: the final-verification section must exist`).not.toBe("");
        const rule = lineWith(final, /`out_of_scope`/);
        expect(rule, `${variant}: the final pass must re-read the exclusions once`).not.toBe("");
        expect(
          /\*\*전량\*\*/.test(rule),
          `${variant}: every exclusion must be re-checked, not a sample`
        ).toBe(true);
        expect(
          /검증자/.test(rule),
          `${variant}: a verifier must confirm the exclusion was intended; a self-recorded reason is not a check`
        ).toBe(true);
        expect(HEDGE.test(rule), `${variant}: the re-check must be absolute, not hedged`).toBe(false);
      });
    });
  }
});

// =============================================================================================
// R3-H7 — the constraint layer has a judge but no intake, so it is always empty and always harmless.
// =============================================================================================
describe("R3-H7 — declared user constraints are collected into the artifact", () => {
  for (const variant of VARIANTS) {
    describe(`${variant} variant`, () => {
      it("names the sources a constraint is extracted from", () => {
        const baseline = sectionUnder(skillBody(readWave(variant)), BASELINE_SECTION);
        const rule = lineWith(baseline, /제약을 (?:추출|수집)/);
        expect(rule, `${variant}: the collection step must exist; the judging side is already complete`).not.toBe("");
        for (const source of ["사용자 프롬프트", "대화 로그", "`--constraint`"]) {
          expect(
            rule.includes(source),
            `${variant}: the intake must name ${source} as a source, otherwise the array is always empty`
          ).toBe(true);
        }
        expect(HEDGE.test(rule), `${variant}: the collection step must be an obligation, not advice`).toBe(false);
      });

      it("fixes the extraction unit the way design_items are fixed", () => {
        const baseline = sectionUnder(skillBody(readWave(variant)), BASELINE_SECTION);
        const rule = lineWith(baseline, /제약 문장 1건/);
        expect(rule, `${variant}: the constraint counting unit must be defined`).not.toBe("");
        expect(
          /제약 문장 1건\s*=\s*1\s*항목/.test(rule),
          `${variant}: one declared constraint sentence must equal exactly one item, like 규범 문장 1건 = 1 항목`
        ).toBe(true);
        for (const key of ["id", "statement", "source"]) {
          expect(
            new RegExp("`" + key + "`").test(rule),
            `${variant}: each constraint item must record ${key}`
          ).toBe(true);
        }
      });

      it("declares --constraint so a user has a channel that survives --auto", () => {
        const options = sectionUnder(skillBody(readWave(variant)), /^###\s*1\.2/);
        expect(options, `${variant}: the optional-input section must exist`).not.toBe("");
        const cells = rowCells(options, /`--constraint(?:`|\s)/);
        expect(
          cells.length > 3,
          `${variant}: --constraint must be its own row; under --auto the kiwi-srs QnA loop is skipped and no other channel is open`
        ).toBe(true);
      });
    });
  }
});

// =============================================================================================
// R3-H8 — constraint_layer is the only layer whose denominator is not externally fixed or frozen.
// =============================================================================================
describe("R3-H8 — the constraint denominator is externally fixed and frozen", () => {
  for (const variant of VARIANTS) {
    describe(`${variant} variant`, () => {
      it("pins constraint_layer.expected to the recorded artifact", () => {
        const stance = withModule(skillBody(readWave(variant)), /^###\s*5\.5\.2/, "verify-loop");
        const rule = lineWith(stance, /`constraint_layer\.expected`/);
        expect(rule, `${variant}: the constraint denominator must be pinned like the other three`).not.toBe("");
        expect(
          /`constraints_path`/.test(rule),
          `${variant}: expected must equal the item count of the latest constraints_path artifact`
        ).toBe(true);
        expect(
          /검증자가 (?:스스로 )?(?:정하지|산정하지) 않는다/.test(rule),
          `${variant}: the constraint denominator must be externally fixed, exactly like the REQ/AC and design ones`
        ).toBe(true);
        expect(HEDGE.test(rule), `${variant}: the external-denominator rule must be absolute, not hedged`).toBe(false);
      });

      it("adds constraints to the frozen denominator so the row-count rule reaches it", () => {
        const stance = withModule(skillBody(readWave(variant)), /^###\s*5\.5\.2/, "verify-loop");
        const rule = lineWith(stance, /`frozen_denominator`/);
        expect(rule, `${variant}: the frozen denominator must be recorded`).not.toBe("");
        // The four existing keys must survive the addition.
        for (const key of ["round", "req_ac", "design_items", "preservation", "constraints"]) {
          expect(
            new RegExp("`" + key + "`").test(rule),
            `${variant}: frozen_denominator must record ${key}`
          ).toBe(true);
        }
      });
    });
  }
});

// =============================================================================================
// R3-H9 — the final pass requires a preservation verdict whose denominator has no input at run scope.
// =============================================================================================
describe("R3-H9 — the final pass reads the preservation denominator over the run window", () => {
  for (const variant of VARIANTS) {
    describe(`${variant} variant`, () => {
      it("substitutes the run window for the wave diff window", () => {
        const final = sectionUnder(skillBody(readWave(variant)), /^##\s*5\.6/);
        const rule = lineWith(final, /`run_diff_window`/);
        expect(rule, `${variant}: the final pass must state which window its preservation denominator uses`).not.toBe(
          ""
        );
        expect(
          /§5\.5\.2/.test(rule),
          `${variant}: the substitution must name §5.5.2, the rule it is re-reading`
        ).toBe(true);
        expect(
          /보존/.test(rule),
          `${variant}: the substitution must be about the preservation denominator, not only about regression`
        ).toBe(true);
        expect(HEDGE.test(rule), `${variant}: the substitution must be absolute, not hedged`).toBe(false);
      });

      it("states the run window is not the last wave's window", () => {
        const final = sectionUnder(skillBody(readWave(variant)), /^##\s*5\.6/);
        const rule = lineWith(final, /마지막 wave/);
        expect(rule, `${variant}: the wrong reading must be closed explicitly`).not.toBe("");
        expect(
          /(?:재검|다시 검사|아니다)/.test(rule),
          `${variant}: picking the last wave's window turns a run-wide damage check into a re-check of one wave`
        ).toBe(true);
      });

      it("orders the run-window capture before the final pass runs", () => {
        const final = sectionUnder(skillBody(readWave(variant)), /^##\s*5\.6/);
        const captureAt = final.indexOf("run_diff_window");
        const verdictAt = final.indexOf("unapproved-damage");
        expect(captureAt, `${variant}: the run window must be named in the final pass`).toBeGreaterThan(-1);
        expect(verdictAt, `${variant}: the final pass must keep its preservation condition`).toBeGreaterThan(-1);
        expect(
          captureAt < verdictAt,
          `${variant}: the window must be established before the verdict that depends on it`
        ).toBe(true);
      });
    });
  }
});

// =============================================================================================
// R3-H10 / R3-M17 — fail-residual has no declared gate, so it falls to the committee, and the
// committee has no journal-legal option.
// =============================================================================================
describe("R3-H10 — a fail-residual wave halts through a declared gate", () => {
  for (const variant of VARIANTS) {
    describe(`${variant} variant`, () => {
      it("declares wave-verify-fail-residual as its own row", () => {
        const gates = gateSection(skillBody(readWave(variant)));
        const cells = rowCells(gates, /`wave-verify-fail-residual`/);
        expect(
          cells.length > 3,
          `${variant}: an undeclared fail-residual halt drops to business-decision, and no committee choice satisfies the journal rules`
        ).toBe(true);
        expect(
          /§5\.5/.test(cells[3]),
          `${variant}: the gate's origin cell must point at §5.5`
        ).toBe(true);
      });

      it("stops folding fail-residual into the cap-exhaustion row", () => {
        const gates = gateSection(skillBody(readWave(variant)));
        const cells = rowCells(gates, /`wave-verify-residual-critical`/);
        expect(cells.length > 3, `${variant}: the existing residual gate row must survive`).toBe(true);
        expect(
          /`fail-residual`[^|]*별도 행|별도 행[^|]*`fail-residual`/.test(cells[2]),
          `${variant}: the reason cell must say fail-residual is a separate row, or the three-trigger list reads as exhaustive`
        ).toBe(true);
      });

      it("covers fail-residual in the final pass too", () => {
        const gates = gateSection(skillBody(readWave(variant)));
        const cells = rowCells(gates, /`final-verify-residual-critical`/);
        expect(cells.length > 3, `${variant}: the final-pass gate row must exist`).toBe(true);
        expect(
          /`fail-residual`/.test(cells[2]),
          `${variant}: the final pass has the same terminal-state hole and must name fail-residual`
        ).toBe(true);
      });

      // R3-M17: the two readings of a MEDIUM residual must be split into an explicit branch.
      it("branches the Normal early exit away from the user-decision path", () => {
        const exit = sectionUnder(skillBody(readWave(variant)), /^#{2,4}\s.*5\.5\.4/);
        expect(exit, `${variant}: the termination-condition section must exist`).not.toBe("");
        const rule = lineWith(exit, /Normal 조기 종료/);
        expect(rule, `${variant}: the two readings of a MEDIUM residual must be separated`).not.toBe("");
        expect(
          /`pass`[^\n]*`residual`/.test(rule),
          `${variant}: the early exit must be stated as pass + residual`
        ).toBe(true);
        expect(
          /사용자 결정을 받지 않는다/.test(rule),
          `${variant}: the early exit must NOT also be a user decision — that is the contradiction being closed`
        ).toBe(true);
        expect(
          /`wave-verify-fail-residual`/.test(exit),
          `${variant}: the other branch must name the gate it halts through`
        ).toBe(true);
        expect(HEDGE.test(rule), `${variant}: the branch must be absolute, not hedged`).toBe(false);
      });
    });
  }
});

// =============================================================================================
// R3-M1 — the SSOT version pin is stale, so the skill cites a contract without the fields it uses.
// Bumped to v1.4.0 with FR-FLOW-104 (S1), which added `oscillation` and `budget-exhausted` to the
// closed `reason_class` vocabulary — values kiwi-wave-master's verify loop now writes.
// =============================================================================================
describe("R3-M1 — kiwi-wave-master pins waves-event v1.4.0", () => {
  for (const variant of VARIANTS) {
    describe(`${variant} variant`, () => {
      it("cites the version that actually defines the fields it writes", () => {
        const common = sectionUnder(skillBody(readWave(variant)), /^##\s*0\.\s/);
        expect(common, `${variant}: the common-convention table must exist`).not.toBe("");
        const row = tableRows(common, /waves-event\.md/)[0] ?? "";
        expect(row, `${variant}: the event-SSOT row must exist`).not.toBe("");
        expect(
          /v1\.4\.0/.test(row),
          `${variant}: the pin must name v1.4.0 — the reason_class values this skill writes are v1.4.0-new`
        ).toBe(true);
        expect(
          /v1\.3\.0|v1\.2\.0|v1\.1\.0|v1\.0\.0/.test(row),
          `${variant}: a stale version must not remain beside the new one`
        ).toBe(false);
      });

      it("updates the recording-section heading to the same version", () => {
        const body = skillBody(readWave(variant));
        const heading = lineWith(body, /^###\s*5\.5\.6/);
        expect(heading, `${variant}: the recording section must exist`).not.toBe("");
        expect(
          /1\.4\.0/.test(heading),
          `${variant}: the heading names the contract version the recorded object conforms to`
        ).toBe(true);
        expect(
          /1\.3\.0|1\.2\.0|1\.1\.0/.test(heading),
          `${variant}: the stale version must not survive in the heading`
        ).toBe(false);
      });
    });
  }
});

// =============================================================================================
// R3-M2 — the constraint artifact is ordered to be passed to a skill that cannot receive it.
// =============================================================================================
describe("R3-M2 — kiwi-srs can receive the constraint artifact", () => {
  for (const variant of VARIANTS) {
    describe(`${variant} variant`, () => {
      it("declares --constraints-doc as a kiwi-srs option", () => {
        const options = sectionUnder(skillBody(readSrs(variant)), /^###\s*1\.2/);
        expect(options, `${variant}: kiwi-srs must have an optional-input section`).not.toBe("");
        const cells = rowCells(options, /`--constraints-doc/);
        expect(
          cells.length > 3,
          `${variant}: without a declared argument the hand-off can only be inline, which §4 itself says does not work`
        ).toBe(true);
      });

      it("makes kiwi-wave-master hand it over by that argument", () => {
        const target = withModule(skillBody(readWave(variant)), /^##\s*4\./, "wave-srs-registration");
        expect(target, `${variant}: the target-registration section must exist`).not.toBe("");
        const rule = lineWith(target, /`--constraints-doc`/);
        expect(rule, `${variant}: §4 must name the argument it passes the artifact by`).not.toBe("");
        expect(
          /`constraints_path`/.test(rule),
          `${variant}: the argument must carry the same artifact the journal records`
        ).toBe(true);
      });
    });
  }
});

// =============================================================================================
// R3-M3 — the final pass has no route for a wave-attributable finding.
// =============================================================================================
describe("R3-M3 — the final pass reuses the delegation and carry-forward machinery", () => {
  for (const variant of VARIANTS) {
    describe(`${variant} variant`, () => {
      it("names §5.5.5 and §5.5.7 in the reuse list", () => {
        const final = sectionUnder(skillBody(readWave(variant)), /^##\s*5\.6/);
        const rule = lineWith(final, /§5\.5 를 그대로 재사용/);
        expect(rule, `${variant}: the reuse sentence must exist`).not.toBe("");
        expect(
          /§5\.5\.5/.test(rule),
          `${variant}: without §5.5.5 a fixable finding in the final pass has no fixer`
        ).toBe(true);
        expect(
          /§5\.5\.7/.test(rule),
          `${variant}: without §5.5.7 a wave-attributable finding cannot be carried forward and halts instead`
        ).toBe(true);
      });
    });
  }
});

// =============================================================================================
// R3-M4 — the final denominator's integration items have no fixing subject or unit.
// =============================================================================================
describe("R3-M4 — integration items are materialised like design items", () => {
  for (const variant of VARIANTS) {
    describe(`${variant} variant`, () => {
      it("fixes integration_items at baseline time with the same coordinates", () => {
        const baseline = sectionUnder(skillBody(readWave(variant)), BASELINE_SECTION);
        const rule = lineWith(baseline, /`integration_items`/);
        expect(rule, `${variant}: the cross-wave integration items must be materialised, not improvised`).not.toBe("");
        for (const key of ["id", "heading_path", "line_start", "line_end", "statement"]) {
          expect(
            new RegExp("`" + key + "`").test(rule),
            `${variant}: each integration item must record ${key}, like a design item`
          ).toBe(true);
        }
      });

      it("makes the final denominator the union plus those items", () => {
        const final = sectionUnder(skillBody(readWave(variant)), /^##\s*5\.6/);
        const rule = lineWith(final, /`integration_items`/);
        expect(rule, `${variant}: the final pass must read the recorded integration items`).not.toBe("");
        expect(
          /`design_items`/.test(rule),
          `${variant}: the denominator must be the recorded design items plus the recorded integration items`
        ).toBe(true);
        expect(
          /검증자가 (?:스스로 )?(?:정하지|산정하지) 않는다/.test(rule),
          `${variant}: the final denominator must be externally fixed too, or the verifier sizes its own workload`
        ).toBe(true);
        expect(HEDGE.test(rule), `${variant}: the final denominator rule must be absolute, not hedged`).toBe(false);
      });
    });
  }
});

// =============================================================================================
// R3-M5 — a carry-forward wave's design baseline interface contradicts itself across three docs.
// =============================================================================================
describe("R3-M5 — a carry-forward wave gets a real design baseline", () => {
  for (const variant of VARIANTS) {
    describe(`${variant} variant`, () => {
      it("converts each carried finding into exactly one design item", () => {
        const baseline = sectionUnder(skillBody(readWave(variant)), BASELINE_SECTION);
        const rule = lineWith(baseline, /이월 finding 목록/);
        expect(rule, `${variant}: the carry-forward substitute denominator must exist`).not.toBe("");
        expect(
          /이월 finding 1건\s*=\s*`design_items` 1 ?항목/.test(rule),
          `${variant}: the substitute must be expressed in the same unit the denominator rule reads, or the two contradict`
        ).toBe(true);
        expect(HEDGE.test(rule), `${variant}: the conversion rule must be absolute, not hedged`).toBe(false);
      });

      it("materialises the excerpt for that wave too", () => {
        const baseline = sectionUnder(skillBody(readWave(variant)), BASELINE_SECTION);
        const rule = lineWith(baseline, /이월 finding 목록/);
        expect(
          /`excerpt_path`/.test(rule),
          `${variant}: §4 requires an excerpt for every wave, so a carry-forward wave must produce one from its finding list`
        ).toBe(true);
      });
    });
  }
});

// =============================================================================================
// R3-M6 — the wave-to-pipeline target wiring rides on a side effect the resume path skips.
// =============================================================================================
describe("R3-M6 — the pipeline target is passed explicitly", () => {
  for (const variant of VARIANTS) {
    describe(`${variant} variant`, () => {
      it("declares --target as a kiwi-pipeline option", () => {
        const options = sectionUnder(skillBody(readPipeline(variant)), /^###\s*1\.2/);
        expect(options, `${variant}: kiwi-pipeline must have an optional-input section`).not.toBe("");
        const cells = rowCells(options, /`--target/);
        expect(
          cells.length > 3,
          `${variant}: with no target argument the wiring is only kiwi-srs's set_active_target side effect`
        ).toBe(true);
      });

      it("makes kiwi-wave-master pass it on every wave", () => {
        const run = sectionUnder(skillBody(readWave(variant)), /^##\s*5\.\s/);
        expect(run, `${variant}: the per-wave pipeline section must exist`).not.toBe("");
        const rule = lineWith(run, /`--target`/);
        expect(rule, `${variant}: §5 must state how the target reaches the pipeline`).not.toBe("");
        expect(
          /부수효과|side effect|set_active_target/.test(rule),
          `${variant}: the sentence must say the explicit argument replaces the side effect, not merely add one`
        ).toBe(true);
        expect(HEDGE.test(rule), `${variant}: the explicit hand-off must be absolute, not hedged`).toBe(false);
      });

      it("re-establishes the active target on a resume that skips §4", () => {
        const progress = sectionUnder(skillBody(readWave(variant)), /^##\s*6\./);
        const rule = lineWith(progress, /set_active_target/);
        expect(
          rule,
          `${variant}: a resume that skips §4 never calls kiwi-srs, so the active target must be set explicitly`
        ).not.toBe("");
        expect(
          /재개/.test(rule),
          `${variant}: the rule must be attached to the resume path, which is where the side effect disappears`
        ).toBe(true);
      });
    });
  }
});

// =============================================================================================
// R3-M7 — the --force propagation chain is declared at both ends but not in the middle hop.
// =============================================================================================
describe("R3-M7 — kiwi-pipeline forwards --force", () => {
  for (const variant of VARIANTS) {
    describe(`${variant} variant`, () => {
      it("lists --force in the pass-through table", () => {
        const passthrough = sectionUnder(skillBody(readPipeline(variant)), /^###\s*7\.4/);
        expect(passthrough, `${variant}: kiwi-pipeline must have a pass-through section`).not.toBe("");
        const cells = rowCells(passthrough, /`--force`/);
        expect(
          cells.length > 3,
          `${variant}: kiwi-wave-master declares the chain through kiwi-pipeline, so a missing middle hop breaks it`
        ).toBe(true);
        expect(
          /kiwi-pm/.test(cells[3]),
          `${variant}: the forwarding path must name kiwi-pm as the consumer`
        ).toBe(true);
        expect(
          /명시/.test(cells.join(" ")),
          `${variant}: --force must be forwarded only when the user typed it, matching the parent's rule`
        ).toBe(true);
      });
    });
  }
});

// =============================================================================================
// R3-M8 — "re-run feasibility for that REQ only" is not mechanically executable.
// =============================================================================================
describe("R3-M8 — feasibility accepts a requirement filter", () => {
  for (const variant of VARIANTS) {
    describe(`${variant} variant`, () => {
      it("declares --req-filter as a kiwi-srs-feasibility option", () => {
        const options = sectionUnder(skillBody(readFeasibility(variant)), /^###\s*1\.2/);
        expect(options, `${variant}: kiwi-srs-feasibility must have an optional-input section`).not.toBe("");
        const cells = rowCells(options, /`--req-filter/);
        expect(
          cells.length > 3,
          `${variant}: without a REQ-level filter a targeted re-run re-evaluates the whole target and re-applies stability mutations`
        ).toBe(true);
      });

      it("makes the delegation row name that argument", () => {
        const routing = sectionUnder(skillBody(readWave(variant)), /^#{2,4}\s.*5\.5\.5/);
        expect(routing, `${variant}: the delegation section must exist`).not.toBe("");
        const row = tableRows(routing, /kiwi-srs-feasibility/)[0] ?? "";
        expect(row, `${variant}: the draft-REQ routing row must exist`).not.toBe("");
        expect(
          /`--req-filter`/.test(row),
          `${variant}: "that REQ only" must be expressed as the argument that makes it so`
        ).toBe(true);
      });
    });
  }
});

// =============================================================================================
// R3-M9 — the Phase flow reads as a batch registration while §4/§6 interleave per wave.
// =============================================================================================
describe("R3-M9 — the phase flow states that phases 2 to 3.5 repeat per wave", () => {
  for (const variant of VARIANTS) {
    describe(`${variant} variant`, () => {
      it("says the per-wave phases repeat and are not registered in one batch", () => {
        const phases = sectionUnder(skillBody(readWave(variant)), /^##\s*2\.\s/);
        expect(phases, `${variant}: the phase-flow section must exist`).not.toBe("");
        const rule = lineWith(phases, /wave 마다 반복/);
        expect(rule, `${variant}: the interleaving must be stated where the flow is drawn`).not.toBe("");
        expect(
          /일괄 등록하지 않는다/.test(rule),
          `${variant}: the batch reading must be refused explicitly — §4 collects carried_into at wave entry, which a batch cannot do`
        ).toBe(true);
        expect(HEDGE.test(rule), `${variant}: the interleaving rule must be absolute, not hedged`).toBe(false);
      });
    });
  }
});

// =============================================================================================
// R3-M10 — the wave-append loop has no bound, so unattended termination is not guaranteed.
// =============================================================================================
describe("R3-M10 — appending waves is bounded and the counter survives a re-run", () => {
  for (const variant of VARIANTS) {
    describe(`${variant} variant`, () => {
      it("caps the number of appended waves per run", () => {
        const final = sectionUnder(skillBody(readWave(variant)), /^##\s*5\.6/);
        const rule = lineWith(final, /wave 추가/);
        expect(rule, `${variant}: the append loop must have a stated bound`).not.toBe("");
        expect(
          /run 당[^\n]*\*\*3\*\*|\*\*3\*\*[^\n]*run 당/.test(rule),
          `${variant}: the cap must be a number, not "적절히"; 3 per run is the pinned value`
        ).toBe(true);
        expect(
          /`wave-append-cap-exhausted`/.test(rule),
          `${variant}: reaching the cap must halt through a declared gate, not fall to the committee`
        ).toBe(true);
        expect(HEDGE.test(rule), `${variant}: the cap must be absolute, not hedged`).toBe(false);
      });

      it("declares the cap gate", () => {
        const ids = gateIds(skillBody(readWave(variant)));
        expect(ids, `${variant}: §0.G must declare wave-append-cap-exhausted`).toContain(
          "wave-append-cap-exhausted"
        );
      });

      it("accumulates the final-pass round counter across re-runs", () => {
        const final = sectionUnder(skillBody(readWave(variant)), /^##\s*5\.6/);
        const rule = lineWith(final, /라운드 카운터/);
        expect(rule, `${variant}: a re-run's round accounting must be defined`).not.toBe("");
        expect(
          /\*\*누적\*\*|누적된다/.test(rule),
          `${variant}: resetting the counter on each re-run makes the cap unreachable and the loop unbounded`
        ).toBe(true);
        expect(
          /초기화|리셋/.test(rule),
          `${variant}: the counter must not be described as reset`
        ).toBe(false);
      });
    });
  }
});

// =============================================================================================
// R3-M11 — a resumed wave-master can never record its own TASK_DONE.
// =============================================================================================
describe("R3-M11 — a resumed run emits under a distinguishable key", () => {
  for (const variant of VARIANTS) {
    describe(`${variant} variant`, () => {
      it("uses the shared re-entry suffix for its own resumed emit", () => {
        const emit = sectionUnder(skillBody(readWave(variant)), /^##\s*9\./);
        expect(emit, `${variant}: the pipeline-emit section must exist`).not.toBe("");
        const rule = lineWith(emit, /\{run_id\}#r\{n\}/);
        expect(rule, `${variant}: a resumed run must emit under its own key`).not.toBe("");
        expect(
          /재개/.test(rule),
          `${variant}: the rule must be attached to the resume case — a FAILED first attempt otherwise absorbs the final TASK_DONE`
        ).toBe(true);
        expect(
          /멱등[^\n]*같은 키|같은 키[^\n]*멱등/.test(rule),
          `${variant}: idempotency must be scoped to the same key, or the suffix changes nothing`
        ).toBe(true);
        expect(HEDGE.test(rule), `${variant}: the resumed-emit rule must be absolute, not hedged`).toBe(false);
      });
    });
  }
});

// =============================================================================================
// R3-M12 — assertion weakening is absent from the wave-level preservation denominator.
// =============================================================================================
describe("R3-M12 — weakening is a denominator class and is never an intended improvement", () => {
  for (const variant of VARIANTS) {
    describe(`${variant} variant`, () => {
      it("adds weakening as its own class of verifier 2's denominator", () => {
        const stance = withModule(skillBody(readWave(variant)), /^###\s*5\.5\.2/, "verify-loop");
        const rule = lineWith(stance, /단언 약화/);
        expect(rule, `${variant}: weakening must appear in the mechanically derived denominator`).not.toBe("");
        expect(
          /§0\.20\.3/.test(rule),
          `${variant}: the criterion must be kiwi-coder's closed list, not the verifier's reading of "weaker"`
        ).toBe(true);
        expect(
          /(?:네 부류|넷|4 ?부류)/.test(rule),
          `${variant}: the denominator must be stated as four classes now, or the fourth reads as an aside`
        ).toBe(true);
      });

      it("forbids resolving a weakening as intended-improvement", () => {
        const stance = withModule(skillBody(readWave(variant)), /^###\s*5\.5\.2/, "verify-loop");
        const rule = lineWith(stance, /약화는[^\n]*`unapproved-damage`|`unapproved-damage`[^\n]*약화는/);
        expect(rule, `${variant}: the weakening verdict must be fixed`).not.toBe("");
        expect(
          /REQ|Task/.test(rule),
          `${variant}: the sentence must say a REQ or Task citation does NOT resolve it — that is the loophole`
        ).toBe(true);
        expect(
          /`intended-improvement`[^\n]*(?:쓰지 않는다|기록하지 않는다|될 수 없다)/.test(rule),
          `${variant}: the sentence must forbid the improvement verdict outright`
        ).toBe(true);
        expect(HEDGE.test(rule), `${variant}: the prohibition must be absolute, not hedged`).toBe(false);
      });
    });
  }
});

// =============================================================================================
// R3-M13 — "one baseline SSOT" is claimed but there is no delivery channel to the children.
// =============================================================================================
describe("R3-M13 — the regression baseline is delivered, not re-captured", () => {
  for (const variant of VARIANTS) {
    describe(`${variant} variant`, () => {
      it("declares --regression-baseline on kiwi-coder and gives the parent value precedence", () => {
        const options = sectionUnder(skillBody(readCoder(variant)), /^###\s*1\.2/);
        expect(options, `${variant}: kiwi-coder must have an optional-input section`).not.toBe("");
        expect(
          rowCells(options, /`--regression-baseline/).length > 3,
          `${variant}: without an argument the child can only capture its own baseline, which is the divergence`
        ).toBe(true);
        const capture = sectionUnder(skillBody(readCoder(variant)), /^###\s*3\.5/);
        expect(capture, `${variant}: the baseline-capture section must exist`).not.toBe("");
        const rule = lineWith(capture, /`--regression-baseline`/);
        expect(rule, `${variant}: the capture section must state what happens when a baseline was supplied`).not.toBe(
          ""
        );
        expect(
          /우선한다/.test(rule),
          `${variant}: a supplied baseline must take precedence over the child's own capture`
        ).toBe(true);
        expect(HEDGE.test(rule), `${variant}: the precedence rule must be absolute, not hedged`).toBe(false);
      });

      it("declares the same option on kiwi-review-fix-loop with the same precedence", () => {
        const options = optionSection(skillBody(readReviewFix(variant)));
        expect(options, `${variant}: kiwi-review-fix-loop must have an input table`).not.toBe("");
        expect(
          rowCells(options, /`--regression-baseline/).length > 3,
          `${variant}: the delegated fixer judges its own regression, so it must be able to receive the run baseline`
        ).toBe(true);
        const capture = sectionUnder(skillBody(readReviewFix(variant)), /^#{2,3}\s.*회귀 테스트 기준선 캡처/);
        expect(capture, `${variant}: the baseline-capture section must exist`).not.toBe("");
        const rule = lineWith(capture, /`--regression-baseline`/);
        expect(rule, `${variant}: the capture section must state the precedence`).not.toBe("");
        expect(
          /우선한다/.test(rule),
          `${variant}: a wave-3 failure must not be classified as pre-existing because the fixer re-captured`
        ).toBe(true);
        expect(HEDGE.test(rule), `${variant}: the precedence rule must be absolute, not hedged`).toBe(false);
      });

      it("routes the option through every hop of the chain", () => {
        const wavePass = sectionUnder(skillBody(readWave(variant)), /^###\s*7\.4/);
        expect(
          rowCells(wavePass, /`--regression-baseline`/).length > 3,
          `${variant}: kiwi-wave-master must forward the baseline it pinned in §2.1`
        ).toBe(true);
        const pipePass = sectionUnder(skillBody(readPipeline(variant)), /^###\s*7\.4/);
        expect(
          rowCells(pipePass, /`--regression-baseline`/).length > 3,
          `${variant}: kiwi-pipeline is the middle hop; dropping it here strands the value`
        ).toBe(true);
        const pmArgs = sectionUnder(skillBody(readPm(variant)), /^###\s*1\.3/);
        expect(pmArgs, `${variant}: kiwi-pm must have a CLI argument summary`).not.toBe("");
        expect(
          /--regression-baseline/.test(pmArgs),
          `${variant}: kiwi-pm must accept and forward the baseline to kiwi-coder`
        ).toBe(true);
      });
    });
  }
});

// =============================================================================================
// R3-M14 — existing_modules reaches the verifiers but never the authors or the planners.
// =============================================================================================
describe("R3-M14 — the recorded existing modules reach authoring and planning", () => {
  for (const variant of VARIANTS) {
    describe(`${variant} variant`, () => {
      it("hands existing_modules to the authoring call", () => {
        const target = withModule(skillBody(readWave(variant)), /^##\s*4\./, "wave-srs-registration");
        const rule = lineWith(target, /`existing_modules`/);
        expect(rule, `${variant}: §4 must pass the module list, not only record it in §3.1`).not.toBe("");
        expect(
          /저작 입력|전달한다/.test(rule),
          `${variant}: a list that only verifiers read cannot change what gets authored`
        ).toBe(true);
      });

      it("makes kiwi-planner require the destructive verb in the Task action", () => {
        const common = sectionUnder(skillBody(readPlanner(variant)), /^##\s*0\.\s/);
        expect(common, `${variant}: kiwi-planner must have a common-convention section`).not.toBe("");
        const row = tableRows(common, /§0\.22/)[0] ?? "";
        expect(row, `${variant}: kiwi-planner has no notion of preserving existing structure today`).not.toBe("");
        expect(
          /`existing_modules`/.test(row),
          `${variant}: the rule must key on the recorded module list, not on the planner's own reading of the code`
        ).toBe(true);
        expect(
          /`action`/.test(row),
          `${variant}: the requirement must land on the Task action, which is what kiwi-coder §0.20.4 reads`
        ).toBe(true);
        expect(
          /이동[^|]*삭제[^|]*시그니처|시그니처[^|]*이동[^|]*삭제/.test(row),
          `${variant}: the three destructive changes must be named, matching the resolution rule downstream`
        ).toBe(true);
        expect(HEDGE.test(row), `${variant}: the authoring requirement must be absolute, not hedged`).toBe(false);
      });
    });
  }
});

// =============================================================================================
// R3-M15 — codex/etc kiwi-review-fix-loop declares the preservation rule but never runs the scan.
// A shared section heading is pinned so all three variants can be asserted the same way; today only
// the claude copy has the step, buried in its Phase 4 prose.
// =============================================================================================
describe("R3-M15 — every variant runs the preservation scan at a stated point", () => {
  for (const variant of VARIANTS) {
    describe(`${variant} variant`, () => {
      it("has a preservation-scan section of its own", () => {
        const scan = sectionUnder(skillBody(readReviewFix(variant)), /^#{2,4}\s.*보존 스캔/);
        expect(
          scan,
          `${variant}: a rule declared in §0 with no execution point never runs; the scan needs its own section`
        ).not.toBe("");
      });

      it("runs the scan on the fixer diff before the re-review", () => {
        const scan = sectionUnder(skillBody(readReviewFix(variant)), /^#{2,4}\s.*보존 스캔/);
        const rule = lineWith(scan, /fixer/i);
        expect(rule, `${variant}: the scan must name what it scans`).not.toBe("");
        expect(
          /diff/i.test(rule),
          `${variant}: the scan input must be the fixer's diff`
        ).toBe(true);
        const scanAt = scan.indexOf("fixer");
        const reviewAt = scan.search(/재검증|re-review/i);
        expect(reviewAt, `${variant}: the scan must state its position relative to the re-review`).toBeGreaterThan(-1);
        expect(
          scanAt < reviewAt,
          `${variant}: scanning after the re-review lets a weakened test reach a clean verdict first`
        ).toBe(true);
      });

      it("escalates a detection to CRITICAL through the three declared gates", () => {
        const scan = sectionUnder(skillBody(readReviewFix(variant)), /^#{2,4}\s.*보존 스캔/);
        const rule = lineWith(scan, /CRITICAL/);
        expect(rule, `${variant}: a detection must be escalated, not reported`).not.toBe("");
        expect(HEDGE.test(rule), `${variant}: the escalation must be absolute, not hedged`).toBe(false);
        for (const id of [
          "existing-test-weakened-or-deleted",
          "existing-public-contract-change",
          "existing-file-deleted-or-moved"
        ]) {
          expect(
            new RegExp("`" + id + "`").test(scan),
            `${variant}: the scan must route through ${id}, the gate already declared in §0`
          ).toBe(true);
        }
      });
    });
  }
});

// =============================================================================================
// R3-M16 — --force has a declared propagation path but no way for a user to supply it.
// The finding says two options are missing from §1.2; --auto-integration and --auto-cost-warning are
// already rows there (round 2 added them), so only --force is.
// =============================================================================================
describe("R3-M16 — --force is reachable from the natural-language map", () => {
  for (const variant of VARIANTS) {
    describe(`${variant} variant`, () => {
      it("maps --force in §1.2 as well as in the pass-through table", () => {
        const options = sectionUnder(skillBody(readWave(variant)), /^###\s*1\.2/);
        const cells = rowCells(options, /`--force`/);
        expect(
          cells.length > 3,
          `${variant}: an option that only appears in the propagation table has a path but no source`
        ).toBe(true);
        expect(
          /명시/.test(cells.join(" ")),
          `${variant}: the row must repeat that the option is only honoured when explicitly given`
        ).toBe(true);
      });
    });
  }
});

// =============================================================================================
// R3-L1 — the streak requirement is referenced by a predicate but never given a number.
// The number itself is an intentional per-variant difference (etc = 3, local-llm-profile).
// =============================================================================================
describe("R3-L1 — the streak requirement is a number", () => {
  for (const variant of VARIANTS) {
    describe(`${variant} variant`, () => {
      it("pins Normal and --max streak counts in the termination section", () => {
        const exit = sectionUnder(skillBody(readWave(variant)), /^#{2,4}\s.*5\.5\.4/);
        const rule = lineWith(exit, /스트릭 요구치는/);
        expect(rule, `${variant}: the unreachable-pass predicate cannot be evaluated without a number`).not.toBe("");
        expect(
          /Normal[^\n]*\*\*1\*\*/.test(rule),
          `${variant}: Normal must be 1 — the mode has no streak, but it still needs one clean round`
        ).toBe(true);
        expect(
          new RegExp("`--max`[^\\n]*\\*\\*" + MAX_STREAK[variant] + "\\*\\*").test(rule),
          `${variant}: --max must be ${MAX_STREAK[variant]}, matching this variant's existing streak rule`
        ).toBe(true);
        expect(HEDGE.test(rule), `${variant}: the streak numbers must be absolute, not hedged`).toBe(false);
      });
    });
  }
});

// =============================================================================================
// R3-L2 — an invalid --loops value halts, but that halt is not a declared gate.
// =============================================================================================
describe("R3-L2 — an invalid loop option is a declared halt", () => {
  for (const variant of VARIANTS) {
    describe(`${variant} variant`, () => {
      it("declares invalid-loop-option", () => {
        const gates = gateSection(skillBody(readWave(variant)));
        const cells = rowCells(gates, /`invalid-loop-option`/);
        expect(
          cells.length > 3,
          `${variant}: loop-option.md orders a HALT that the gate table does not declare, so it drops to the committee`
        ).toBe(true);
        expect(
          /loop-option|§0\.7/.test(cells[3]),
          `${variant}: the origin cell must point at the shared loop-option contract that orders the halt`
        ).toBe(true);
      });
    });
  }
});

// =============================================================================================
// The five findings added while registering the round-2 evidence (H11 · H12 · M18 · M19 · M20).
// SRS locus: FR-FLOW-066 — they are deliberately NOT folded into FR-FLOW-062/063/065.
// =============================================================================================

// =============================================================================================
// R3-H11 — nine gates kiwi-coder declares critical have no counterpart in kiwi-pm, so under --auto
// they fall to the committee. A general rule is asserted rather than nine transcribed rows: an
// enumeration is exactly what leaked `existing-file-deleted-or-moved` when round 2 added it.
// @req FR-FLOW-066
// =============================================================================================
describe("R3-H11 — a child's critical gate halts the parent by rule, not by transcription", () => {
  for (const variant of VARIANTS) {
    describe(`${variant} variant`, () => {
      it("declares the catch-all rule in the kiwi-pm gate section", () => {
        const gates = gateSection(skillBody(readPm(variant)));
        expect(gates, `${variant}: kiwi-pm must have a critical_gates section`).not.toBe("");
        // Backticked token only — the section heading and the existing prose both write
        // critical_gates unquoted, so this anchors on the new sentence rather than on either of them.
        const rule = lineWith(gates, /`critical_gates(?:\[\])?`/);
        expect(rule, `${variant}: kiwi-pm must state what happens to a gate the child declared critical`).not.toBe(
          ""
        );
        expect(
          /자식/.test(rule),
          `${variant}: the rule must be about the child's declaration, not about kiwi-pm's own table`
        ).toBe(true);
        // The load-bearing half: it must hold even when kiwi-pm has no row of that name, which is the
        // state nine of the fifteen coder gates are in.
        expect(
          /없(?:더라도|어도)|미등재|등재되지 않/.test(rule),
          `${variant}: the rule must apply even when kiwi-pm has no same-named row — otherwise it is the transcription it replaces`
        ).toBe(true);
        expect(
          /(?:무조건|항상)\s*HALT/.test(rule),
          `${variant}: the outcome must be an unconditional halt, not a severity re-classification`
        ).toBe(true);
        expect(HEDGE.test(rule), `${variant}: the catch-all rule must be absolute, not hedged`).toBe(false);
      });

      it("adds critical to the severity enum the child returns", () => {
        const contract = sectionUnder(skillBody(readPm(variant)), /^##\s*반환 형식/);
        expect(contract, `${variant}: kiwi-pm must document the child's return contract`).not.toBe("");
        const rule = lineWith(contract, /"severity"/);
        expect(rule, `${variant}: the return contract must declare a severity enum`).not.toBe("");
        expect(
          /critical/.test(rule),
          `${variant}: without a critical member the child cannot express a halt, and auto-option defaults it to business-decision`
        ).toBe(true);
        // The three existing members must survive the addition.
        for (const member of ["clarification", "business-decision", "rollback-confirmation"]) {
          expect(rule.includes(member), `${variant}: the severity enum must keep ${member}`).toBe(true);
        }
      });

      it("gives critical its own row in the severity table", () => {
        const table = sectionUnder(skillBody(readPm(variant)), /^###\s*3\.5/);
        expect(table, `${variant}: kiwi-pm must have a severity enum section`).not.toBe("");
        const cells = rowCells(table, /^\s*\|\s*`critical`/);
        expect(
          cells.length > 2,
          `${variant}: a member with no row is undefined for the reader deciding which value to send`
        ).toBe(true);
        expect(
          /HALT/.test(cells.join(" ")),
          `${variant}: the row must say the value always halts, matching auto-option §4`
        ).toBe(true);
      });
    });
  }
});

// =============================================================================================
// R3-H12 — a re-entry that runs nothing reports TASK_DONE, so the improvement loop burns rounds on
// a child that looks successful and changed nothing.
// @req FR-FLOW-066
// =============================================================================================
describe("R3-H12 — a no-op run is not a completion", () => {
  for (const variant of VARIANTS) {
    describe(`${variant} variant`, () => {
      it("refuses TASK_DONE when no task changed state in this run", () => {
        const emit = skillOrRefSection(variant, "kiwi-pm", /^##\s*10\./);
        expect(emit, `${variant}: kiwi-pm must have a pipeline-emit section`).not.toBe("");
        const rule = lineWith(emit, /상태가 바뀐 Task/);
        expect(rule, `${variant}: the no-op case must be distinguished from a completion`).not.toBe("");
        expect(
          /0\s*건/.test(rule),
          `${variant}: the condition must be zero state-changing tasks, stated as a count`
        ).toBe(true);
        expect(
          /`TASK_DONE`[^\n]*(?:아니라|아니다|반환하지 않는다)/.test(rule),
          `${variant}: the sentence must deny TASK_DONE, not merely annotate it`
        ).toBe(true);
        expect(
          /`NEEDS_USER`/.test(rule),
          `${variant}: the run must surface as NEEDS_USER so the parent stops instead of re-verifying an unchanged tree`
        ).toBe(true);
        expect(HEDGE.test(rule), `${variant}: the no-op rule must be absolute, not hedged`).toBe(false);
      });

      it("marks the no-op explicitly rather than leaving the caller to infer it", () => {
        const emit = skillOrRefSection(variant, "kiwi-pm", /^##\s*10\./);
        const rule = lineWith(emit, /상태가 바뀐 Task/);
        expect(
          /no-op/i.test(rule),
          `${variant}: the return must carry the no-op fact; an unexplained NEEDS_USER is indistinguishable from a question`
        ).toBe(true);
      });
    });
  }
});

// =============================================================================================
// R3-M18 — FR-FLOW-059 AC-1 asked for branch (a) (the two child consent gates cleared by
// wave-master's own unattended option). The decision is to KEEP branch (b) and revise the AC, so the
// contract asserted here is REACHABILITY, never auto-grant: an assertion that --auto clears them
// would contradict kiwi-wave-continuity-r2-content.test.ts's "no auto-grant wording" check.
//
// The chain hops below are already satisfied at authoring time; they are pinned as a regression guard
// for the decided branch. The one new obligation is that §7.1 names the route that makes the two
// options reachable — today it states the limit without pointing at the pass-through table.
// @req FR-FLOW-066
// =============================================================================================
describe("R3-M18 — the two child consent gates are reachable through every hop", () => {
  const CONSENT_OPTIONS = ["--auto-integration", "--auto-cost-warning"] as const;
  for (const variant of VARIANTS) {
    describe(`${variant} variant`, () => {
      it("names the pass-through route in the unattended-completion paragraph", () => {
        const auto = sectionUnder(skillBody(readWave(variant)), /^###\s*7\.1/);
        expect(auto, `${variant}: the --auto propagation section must exist`).not.toBe("");
        const rule = lineWith(auto, /`--auto` 단독/);
        expect(rule, `${variant}: the limit of a bare --auto must be stated`).not.toBe("");
        expect(
          /§7\.4/.test(rule),
          `${variant}: stating the limit without naming the route leaves a user told what does not work and not what does`
        ).toBe(true);
      });

      it("keeps both options declared at every hop of the chain", () => {
        for (const option of CONSENT_OPTIONS) {
          const re = new RegExp("`\\" + option);
          expect(
            rowCells(sectionUnder(skillBody(readWave(variant)), /^###\s*1\.2/), re).length > 3,
            `${variant}: kiwi-wave-master §1.2 must map ${option}`
          ).toBe(true);
          expect(
            rowCells(sectionUnder(skillBody(readWave(variant)), /^###\s*7\.4/), re).length > 3,
            `${variant}: kiwi-wave-master §7.4 must forward ${option}`
          ).toBe(true);
          expect(
            rowCells(sectionUnder(skillBody(readPipeline(variant)), /^###\s*7\.4/), re).length > 3,
            `${variant}: kiwi-pipeline §7.4 must forward ${option}`
          ).toBe(true);
          expect(
            sectionUnder(skillBody(readPm(variant)), /^###\s*1\.3/).includes(option),
            `${variant}: kiwi-pm must accept ${option}`
          ).toBe(true);
          expect(
            rowCells(sectionUnder(skillBody(readCoder(variant)), /^###\s*1\.2/), re).length > 3,
            `${variant}: kiwi-coder must consume ${option}`
          ).toBe(true);
        }
      });

      it("still refuses to grant the consent on the user's behalf", () => {
        const passthrough = sectionUnder(skillBody(readWave(variant)), /^###\s*7\.4/);
        expect(passthrough, `${variant}: the pass-through section must exist`).not.toBe("");
        // Polarity guard for the decided branch, scoped to the table that carries the two options —
        // the §7.1 half of this is pinned by the round-2 suite and is not duplicated here.
        expect(
          /(?:자동으로 부여|자동 부여|자동 활성)(?!하지 않는다)/.test(passthrough),
          `${variant}: the pass-through table must not describe wave-master as supplying the consent itself`
        ).toBe(false);
      });
    });
  }
});

// =============================================================================================
// R3-M19 — a retired gate id survives in the shared interface catalogue, where a new skill will
// adopt it. The catalogue is the SSOT for gate ids, so a dead entry there outlives every skill fix.
// @req FR-FLOW-066
// =============================================================================================
describe("R3-M19 — the retired lifecycle-gate-draft is out of the shared catalogue", () => {
  for (const copy of AUTO_OPTION_COPIES) {
    describe(copy, () => {
      it("drops it from the standard catalogue list", () => {
        const text = readShared(copy);
        expect(text, `${copy} must exist`).not.toBe("");
        // The claude copy numbers the catalogue §5.1 under `## 5. critical_gates[] 인터페이스`; the
        // codex/etc/.agents copies are condensed and carry the same bullets under a bare
        // `## critical_gates[]` with no section number. Anchoring on the interface heading covers
        // all four. The wider scope is safe here because the assertion is a prohibition — widening
        // it can only make the check stricter.
        const catalogue = sectionUnder(text, /^#{2,3}\s.*critical_gates/);
        expect(catalogue, `${copy} must have a critical_gates interface section`).not.toBe("");
        expect(
          /^-\s*`lifecycle-gate-draft`/m.test(catalogue),
          `${copy} the catalogue must not offer a gate id every canonical set deliberately excludes`
        ).toBe(false);
      });

      it("drops it from the declaration example too", () => {
        const text = readShared(copy);
        expect(
          /gate_id:\s*"lifecycle-gate-draft"/.test(text),
          `${copy} the example is the fastest thing a new skill copies, so the retired id must not appear there`
        ).toBe(false);
      });

      it("records why it was retired instead of deleting it silently", () => {
        const text = readShared(copy);
        const note = lineWith(text, /lifecycle-gate-draft/);
        expect(
          note,
          `${copy} a reader who saw the old catalogue needs to find out what replaced it`
        ).not.toBe("");
        expect(
          /철회|retired|withdrawn/i.test(note),
          `${copy} the surviving mention must mark the id as retired`
        ).toBe(true);
        expect(
          /FR-FLOW-053|per-REQ skip/.test(note),
          `${copy} the note must name what replaced it, or the next skill re-invents the gate`
        ).toBe(true);
      });
    });
  }
});

// =============================================================================================
// R3 gate-set closure — the four new ids must exist in all three variants as one set.
// The round-2 CANONICAL_GATE_IDS constant must grow by exactly these four; see the round-3 contract
// §0. This test states the addition independently so the two files cannot drift apart silently.
// =============================================================================================
describe("R3 — the new kiwi-wave-master gates are declared identically in every variant", () => {
  it("adds exactly the four round-3 gate ids", () => {
    for (const variant of VARIANTS) {
      const ids = gateIds(skillBody(readWave(variant)));
      for (const id of R3_WAVE_GATE_IDS) {
        expect(ids, `${variant}: §0.G must declare ${id}`).toContain(id);
      }
      expect(
        ids.length,
        `${variant}: a duplicated gate row makes the interface ambiguous`
      ).toBe(new Set(ids).size);
    }
    const sets = VARIANTS.map((v) => [...new Set(gateIds(skillBody(readWave(v))))].sort());
    expect(sets[1], `codex: the gate-id set must equal the claude set`).toEqual(sets[0]);
    expect(sets[2], `etc: the gate-id set must equal the claude set`).toEqual(sets[0]);
  });
});
