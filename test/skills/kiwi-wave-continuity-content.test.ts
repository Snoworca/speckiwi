import { describe, expect, it } from "vitest";
import { moduleRegion, readResolvedSkill } from "../support/resolved-skill.js";

// @req FR-FLOW-047
// @req FR-FLOW-048
// @req FR-FLOW-049
// @req FR-FLOW-050
// @req FR-FLOW-051
// @req FR-FLOW-052
// @req FR-FLOW-053
// @req FR-FLOW-054
// @req FR-FLOW-055
//
// Wave-cycle continuity: design baseline, verification denominators, unattended continuity,
// per-requirement partial progress, existing-structure preservation, and cross-wave carry-forward.
//
// A SKILL.md is natural-language agent instruction, not executable code, so the behavior cannot be
// exercised in a unit test; these are raw-text contract assertions over every shipped variant — the
// same technique FR-FLOW-029/042/043/044/045/046 are verified by.
//
// kiwi-wave-master is deliberately excluded from the `.agents/skills` mirror
// (.agents/skills/.speckiwi-mirror-exclusions.json), so its SKILL.md lives in exactly three copies.
// kiwi-srs / kiwi-pipeline / kiwi-pm / kiwi-coder are asserted over the same three authoring copies;
// the shared waves-event contract IS mirrored and is asserted in kiwi-event-contract-content.test.ts.
//
// Assertion style, dictated by mutations that survived earlier rounds:
//   - scope to the governing section (a body-wide token check false-greens off a neighbouring
//     paragraph), and cut the section at the next same-or-higher heading so a trailing h3 does not
//     swallow the following h2;
//   - anchor normative rules to their own line or table cell, not to a character window;
//   - assert hedge vocabulary is ABSENT from the sentence that carries a MUST;
//   - assert quantifiers and polarity literally ("모든", "2기" vs "2기 이상", "금지" vs "지양");
//   - compare positions for ordering rules rather than trusting list markers.

const VARIANTS = ["claude", "codex", "etc"] as const;

/** @req FR-FLOW-110 — resolved through the shared reader: SKILL.md plus the bodies of the
 * `_shared/kiwi/` modules its §0 table references, appended in table order. */
function readSkill(variant: string, skill: string): string {
  return readResolvedSkill(variant, skill);
}

const readWave = (v: string) => readSkill(v, "kiwi-wave-master");
const readSrs = (v: string) => readSkill(v, "kiwi-srs");
const readPipeline = (v: string) => readSkill(v, "kiwi-pipeline");
const readPm = (v: string) => readSkill(v, "kiwi-pm");
const readCoder = (v: string) => readSkill(v, "kiwi-coder");

/** Body with the YAML frontmatter stripped, so the `description` field cannot false-green a check. */
function skillBody(text: string): string {
  return text.replace(/^---[\s\S]*?\n---\s*\n?/, "");
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

/** The `verify-loop.md` stance section (moved from kiwi-wave-master §5.5.2). */
/** The `wave-decomposition.md` sections (moved from kiwi-wave-master §3, §3.1, §3.2). */
const SPLIT_SECTION = /^#{2,4}\s.*\[wave-decomposition\.md\].*Wave 분해/;
const BASELINE_SECTION = /^#{2,4}\s.*설계 기준선/;
const COVERAGE_SECTION = /^#{2,4}\s.*분해 커버리지 게이트/;

/** Line index of the first heading matching `re`, or -1. */
function headingLine(body: string, re: RegExp): number {
  return body.split("\n").findIndex((line) => /^#{1,6}\s/.test(line) && re.test(line));
}

/** The `## 2` phase-flow fenced block (the one listing the wave-decomposition phase). */
function phaseFlowBlock(body: string): string {
  const fences = body.split("```");
  for (let i = 1; i < fences.length; i += 2) {
    if (/Wave 분해|wave decompos/i.test(fences[i])) return fences[i];
  }
  return "";
}

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
const HEDGE = /수 있다|해도 된다|권장|바람직|원칙적으로|원칙으로 하되|가능하면|되도록|경우에 따라|가급적/;

/** Skill invocation prefix: claude ships `/kiwi-x`, codex and etc ship `$kiwi-x`. */
const KIWI_SRS_CALL = /[/$]kiwi-srs\b/;

/** The `critical_gates[]` declaration section of whichever skill is under test. */
function gateSection(body: string): string {
  return sectionUnder(body, /^#{2,4}\s.*critical_gates/i);
}

/** The end-of-wave cross-verification section (§5.5). */
function verifySection(body: string): string {
  // @req FR-FLOW-110 — the skill's own §5.5 plus the verify-loop.md engine region its §0 table
  // references. Two bounded regions, not the whole body: §2.1 and §7 stay out of scope.
  return `${sectionUnder(body, /^#{2,3}\s.*(?:상호검증|cross-verif)/i)}\n${moduleRegion(body, "verify-loop")}`;
}


/**
 * @req FR-FLOW-110 — the two-verifier rules are split by the extraction: kiwi-wave-master keeps its
 * four denominator layers under §5.5.2 and verify-loop.md carries the layer-independent discipline
 * (the verdict enum, the row-count invalidation, the freeze rules). Both regions, nothing else.
 */
function stanceScope(body: string): string {
  const s = verifySection(body);
  return `${sectionUnder(s, /^#{3,4}\s.*두 검증자/)}\n${sectionUnder(s, /^#{2,4}\s.*\[verify-loop\.md\].*두 검증자/)}`;
}

// ---------------------------------------------------------------------------------------------
// Contract identifiers the implementation must use verbatim. Pinning them here is the point: a
// prose-only instruction lets each of the three copies invent its own field name, and the
// waves-event consumer then cannot read any of them.
// ---------------------------------------------------------------------------------------------
const NEW_WAVE_GATE_IDS = [
  "wave-decomposition-coverage-gap",
  "final-verify-residual-critical",
  "unsafe-option-refused",
] as const;

const EXISTING_WAVE_GATE_IDS = [
  "run-root-preflight-mismatch",
  "wt-delegation-refused",
  "child-pipeline-needs-user-or-failed",
  "wave-verify-residual-critical",
  "wave-verify-cross-wave-fix-required",
] as const;

describe("FR-FLOW-047 — design baseline and decomposition coverage gate", () => {
  for (const variant of VARIANTS) {
    describe(`${variant} variant`, () => {
      it("AC-1: lists an architecture design document or SDS as a first-class entry input", () => {
        const body = skillBody(readWave(variant));
        const inputs = sectionUnder(body, /^#{3}\s.*필수 입력/);
        expect(inputs, `${variant}: the required-input section must exist`).not.toBe("");
        // It must be a bullet of the same list as research/plan/roadmap, not an aside: anchor to a
        // list item so a passing mention inside the rationale prose cannot satisfy this.
        const bullet = lineWith(inputs, /^-\s.*(?:설계 문서|SDS)/m);
        expect(bullet, `${variant}: 설계 문서 / SDS must be a first-class required-input bullet`).not.toBe("");
        expect(/SDS/.test(bullet), `${variant}: the entry-input bullet must name SDS explicitly`).toBe(true);
        // "선택적으로 함께 줄 수 있다" would demote it back to an optional extra, which is the
        // status quo AC-1 exists to change.
        expect(HEDGE.test(bullet), `${variant}: the design-document entry input must not be hedged as optional`).toBe(
          false,
        );
      });

      it("AC-2: materialises a per-wave design baseline pinned to a source range", () => {
        const body = skillBody(readWave(variant));
        const baseline = sectionUnder(body, BASELINE_SECTION);
        expect(baseline, `${variant}: a design-baseline sub-section must exist under §3`).not.toBe("");
        for (const field of ["source_file", "heading_path", "line_start", "line_end"]) {
          expect(baseline.includes(field), `${variant}: the baseline mapping must record ${field}`).toBe(true);
        }
        expect(
          /design-baseline\.json/.test(baseline),
          `${variant}: the baseline must be persisted as a named artifact, not held in conversation`,
        ).toBe(true);
        // The artifact path has to reach the journal, or AC-6's "resolvable from waves.jsonl alone"
        // has no carrier.
        expect(
          /`design_baseline`/.test(baseline) && /waves\.jsonl/.test(baseline),
          `${variant}: the artifact path must be recorded on the wave's waves.jsonl event as design_baseline`,
        ).toBe(true);
        expect(
          /첫\s*`?in_progress`?/.test(baseline),
          `${variant}: the baseline must be recorded on the wave's FIRST event, not on an arbitrary later one`,
        ).toBe(true);
      });

      it("AC-3: blocks target registration while a top-level section is unassigned", () => {
        const body = skillBody(readWave(variant));
        const coverage = sectionUnder(body, COVERAGE_SECTION);
        expect(coverage, `${variant}: a decomposition-coverage sub-section must exist`).not.toBe("");
        // Quantifier: "주요 최상위 섹션" turns a coverage proof into a sample.
        expect(
          /\*\*모든\*\* 최상위 섹션/.test(coverage),
          `${variant}: coverage must be checked against EVERY top-level section, not a selection`,
        ).toBe(true);
        // Reporting must be exhaustive, for the same reason residual reporting is.
        expect(
          /미배정 섹션을 \*\*전량\*\* 보고한다/.test(coverage),
          `${variant}: every unassigned section must be reported, not a top-N sample`,
        ).toBe(true);
        // The blocking rule itself, anchored to its own line and required to be unhedged. Weakening
        // it to "진입하기 전에 사용자에게 알린다" keeps every token while removing the gate.
        const block = lineWith(coverage, /target 등록/);
        expect(block, `${variant}: the coverage gate must state what it blocks`).not.toBe("");
        expect(
          /진입하지 않는다/.test(block),
          `${variant}: an unassigned section with no out-of-scope reason must block target registration`,
        ).toBe(true);
        expect(HEDGE.test(block), `${variant}: the coverage gate must be absolute, not hedged`).toBe(false);
        // The escape hatch is a RECORDED reason, not a judgement call.
        expect(
          /`out_of_scope`/.test(coverage),
          `${variant}: the out-of-scope escape hatch must be a recorded field, not narrative`,
        ).toBe(true);
        // Position: the gate is worthless if it is authored after the registration phase.
        // The gate lives in wave-decomposition.md (FR-FLOW-107); the skill's own decomposition section
        // is what must precede the registration phase.
        const coverageAt = headingLine(body, /Wave 분해/);
        const registerAt = headingLine(body, /Wave 별 target 등록/);
        expect(coverageAt, `${variant}: the coverage section must exist`).toBeGreaterThan(-1);
        expect(registerAt, `${variant}: the target-registration section must exist`).toBeGreaterThan(-1);
        expect(
          coverageAt < registerAt,
          `${variant}: the coverage gate must be authored before the target-registration phase`,
        ).toBe(true);
      });

      it("AC-3: declares the coverage gap as a critical gate row", () => {
        const gates = gateSection(skillBody(readWave(variant)));
        expect(gates, `${variant}: a critical_gates declaration section must exist`).not.toBe("");
        expect(
          tableRows(gates, /wave-decomposition-coverage-gap/).length,
          `${variant}: critical_gates must declare wave-decomposition-coverage-gap as a table row`,
        ).toBeGreaterThan(0);
      });

      it("AC-4: hands the wave-split subagent the existing module and dependency structure", () => {
        const decompose = sectionUnder(skillBody(readWave(variant)), SPLIT_SECTION);
        expect(decompose, `${variant}: the wave-decomposition section must exist`).not.toBe("");
        expect(
          /기존 모듈/.test(decompose) && /의존/.test(decompose) && /서브에이전트/.test(decompose),
          `${variant}: the wave-split subagent must receive a summary of the existing module and dependency structure`,
        ).toBe(true);
        // And the result must be persisted per wave, not merely consumed during the split.
        expect(
          /`existing_modules`/.test(decompose),
          `${variant}: each wave must record the existing modules it is expected to touch as existing_modules`,
        ).toBe(true);
      });

      it("AC-5: exempts a coverage-gap wave append from the boundary-immutability rule", () => {
        const body = skillBody(readWave(variant));
        // Anchored to the §0.5 row itself. Stated anywhere else, §0.5 still reads as an absolute
        // ban and an agent following the SSOT table never reaches the exception.
        const row = lineWith(body, /wave 경계 불변/);
        expect(row, `${variant}: the §0.5 boundary-immutability rule must exist`).not.toBe("");
        expect(
          /커버리지 갭/.test(row) && /추가/.test(row),
          `${variant}: the §0.5 row itself must carry the coverage-gap wave-append exception`,
        ).toBe(true);
        expect(
          /재분해가 아니다/.test(row),
          `${variant}: appending a gap-closing wave must be declared NOT a re-decomposition`,
        ).toBe(true);
        // Without this, "append a wave" could be read as licence to reorder the queue, which
        // reverses already-registered waves.
        expect(
          /이미 등록된 wave 의 순서는 (?:바뀌지 않는다|변경하지 않는다)/.test(row),
          `${variant}: the order of already registered waves must stay unchanged`,
        ).toBe(true);
      });

      it("AC-6: resolves the baseline artifact from waves.jsonl alone", () => {
        const baseline = sectionUnder(skillBody(readWave(variant)), BASELINE_SECTION);
        expect(
          /`waves\.jsonl` 만으로 해소한다/.test(baseline),
          `${variant}: the baseline artifact must be resolvable from waves.jsonl alone`,
        ).toBe(true);
        // The negation matters: the whole point is that a resumed session has no conversation state.
        expect(
          /대화 상태에 의존하지 않는다/.test(baseline),
          `${variant}: resolution must be stated as independent of conversation state`,
        ).toBe(true);
      });
    });
  }
});

describe("FR-FLOW-048 — verification denominator covers design baseline and constraints", () => {
  for (const variant of VARIANTS) {
    describe(`${variant} variant`, () => {
      it("AC-1: adds required bundle rows for the design baseline and the declared constraints", () => {
        const bundle = sectionUnder(verifySection(skillBody(readWave(variant))), /^#{3,4}\s.*증거 번들/);
        expect(bundle, `${variant}: an evidence-bundle sub-section must exist`).not.toBe("");
        const designRow = rowCells(bundle, /설계 기준선/);
        const constraintRow = rowCells(bundle, /사용자 제약/);
        expect(designRow.length, `${variant}: the bundle table must have a design-baseline row`).toBeGreaterThan(2);
        expect(constraintRow.length, `${variant}: the bundle table must have a declared-constraints row`).toBeGreaterThan(
          2,
        );
        // Resolved from the journal, not from what the orchestrator happens to remember.
        expect(
          designRow.join(" ").includes("design_baseline"),
          `${variant}: the design-baseline row must resolve from the waves.jsonl design_baseline field`,
        ).toBe(true);
        expect(
          constraintRow.join(" ").includes("constraints_path"),
          `${variant}: the constraints row must resolve from the waves.jsonl constraints_path field`,
        ).toBe(true);
        // Optional rows reintroduce the very hole AC-1 closes, so the rows must be marked required.
        expect(
          /두 행은 \*\*필수\*\*이며 생략할 수 없다/.test(bundle),
          `${variant}: the two new bundle rows must be declared mandatory`,
        ).toBe(true);
      });

      it("AC-2: enumerates every design item as a verifier-1 row with a mapped requirement id", () => {
        const stance = stanceScope(skillBody(readWave(variant)));
        expect(stance, `${variant}: the two-verifier sub-section must exist`).not.toBe("");
        expect(
          /\*\*모든\*\* 설계 항목을 행으로 열거/.test(stance),
          `${variant}: verifier 1 must enumerate EVERY design item in the baseline range as a row`,
        ).toBe(true);
        expect(
          /`unmapped`/.test(stance),
          `${variant}: each design row must carry the mapped requirement id or be marked unmapped`,
        ).toBe(true);
        // Sampling construction, rejected the same way the REQ/AC denominator rejects it.
        expect(
          /(?:표본|샘플|발췌)(?:으?로|을)\s*(?:행에\s*)?열거/.test(stance),
          `${variant}: no sampling qualifier may weaken the design-item enumeration`,
        ).toBe(false);
      });

      it("AC-3: forbids ALL_MATCH while any design item is unmapped", () => {
        const stance = stanceScope(skillBody(readWave(variant)));
        const rule = lineWith(stance, /미매핑 설계 항목/);
        expect(rule, `${variant}: an unmapped-design-item rule must exist`).not.toBe("");
        // Quantifier: "미매핑 항목이 다수 있으면" would let a single unmapped item roll up clean.
        expect(
          /\*\*1건이라도\*\*/.test(rule),
          `${variant}: a single unmapped design item must be enough to forbid ALL_MATCH`,
        ).toBe(true);
        expect(
          /`ALL_MATCH`[^\n]*(?:불가|할 수 없다|기록하지 않는다)/.test(rule),
          `${variant}: the rule must forbid the ALL_MATCH roll-up, not merely warn about it`,
        ).toBe(true);
        expect(HEDGE.test(rule), `${variant}: the ALL_MATCH prohibition must be absolute, not hedged`).toBe(false);
        // Independence is the whole point: without it, a complete REQ/AC layer is read as covering
        // the design layer too, which is exactly the pass-by-definition this AC removes.
        expect(
          /REQ[·/]AC 계층이 (?:완전|완결)하더라도/.test(stance),
          `${variant}: the prohibition must hold independently of the requirement and AC layer being complete`,
        ).toBe(true);
      });

      it("AC-4: carries the design layer counts and unmapped items on the verification object", () => {
        const section = verifySection(skillBody(readWave(variant)));
        const record = sectionUnder(section, /^#{3,4}\s.*기록/);
        expect(record, `${variant}: the verification-record sub-section must exist`).not.toBe("");
        expect(
          /`design_layer`/.test(record),
          `${variant}: the verification object must carry design_layer`,
        ).toBe(true);
        for (const key of ["expected", "mapped", "unmapped"]) {
          expect(
            new RegExp(`design_layer[\\s\\S]{0,400}\`${key}\``).test(record),
            `${variant}: design_layer must record ${key}`,
          ).toBe(true);
        }
      });

      it("AC-5: gives verifier 2 a mechanically derived preservation denominator", () => {
        const stance = stanceScope(skillBody(readWave(variant)));
        const rule = lineWith(stance, /검증자 2 의 \*\*분모\*\*/);
        expect(rule, `${variant}: verifier 2 must have its own stated denominator`).not.toBe("");
        expect(
          /기계적으로 도출한다/.test(rule),
          `${variant}: verifier 2's denominator must be mechanically derived from the wave diff, not chosen`,
        ).toBe(true);
        // The three classes are the denominator; dropping one silently shrinks it.
        expect(
          /삭제·이동된 기존 파일/.test(stance),
          `${variant}: the denominator must include removed or moved existing files`,
        ).toBe(true);
        expect(
          /삭제·변경된 기존 public 심볼/.test(stance),
          `${variant}: the denominator must include removed or changed existing public symbols`,
        ).toBe(true);
        expect(
          /삭제·수정된 기존 테스트 파일/.test(stance),
          `${variant}: the denominator must include removed or modified existing test files`,
        ).toBe(true);
        // Each row gets a verdict from a two-value enum. A free-text judgement re-opens the
        // narrative escape this AC closes.
        expect(
          /`intended-improvement`\s*\/\s*`unapproved-damage`/.test(stance),
          `${variant}: each preservation row must be judged by the intended-improvement / unapproved-damage enum`,
        ).toBe(true);
        expect(
          /`preservation_layer`/.test(stance),
          `${variant}: the preservation denominator must be recorded as preservation_layer`,
        ).toBe(true);
      });

      it("AC-6: invalidates a round whose row count misses the fixed denominator, for both verifiers", () => {
        const stance = stanceScope(skillBody(readWave(variant)));
        const rule = lineWith(stance, /행 수가/);
        expect(rule, `${variant}: a row-count reconciliation rule must exist`).not.toBe("");
        expect(
          /\*\*무효\*\*/.test(rule),
          `${variant}: a row-count mismatch must invalidate the round`,
        ).toBe(true);
        // Scoping it to verifier 1 leaves verifier 2 — the only stance that looks at damage to
        // existing structure — with no enforced denominator at all.
        expect(
          /두 검증자 \*\*모두\*\*/.test(rule),
          `${variant}: the row-count rule must bind BOTH verifiers, not only the intent axis`,
        ).toBe(true);
        expect(
          /연속 clean 스트릭[^\n]*0/.test(rule),
          `${variant}: an invalid round must not count toward a consecutive clean streak`,
        ).toBe(true);
        expect(HEDGE.test(rule), `${variant}: the invalidation rule must be absolute, not hedged`).toBe(false);
      });
    });
  }
});

describe("FR-FLOW-049 — all-wave final verification against the whole design baseline", () => {
  for (const variant of VARIANTS) {
    describe(`${variant} variant`, () => {
      it("AC-1: runs a final pass after the last wave and before reporting completion", () => {
        const body = skillBody(readWave(variant));
        const finalSection = sectionUnder(body, /^##\s.*최종 검증/);
        expect(finalSection, `${variant}: a final-verification section must exist`).not.toBe("");
        const flow = phaseFlowBlock(body);
        expect(flow, `${variant}: the phase-flow block must exist`).not.toBe("");
        expect(
          flow.indexOf("Phase 4.5") > flow.indexOf("Phase 4 ") && flow.indexOf("Phase 4.5") < flow.indexOf("Phase 5"),
          `${variant}: the phase-flow block must list Phase 4.5 between Phase 4 and Phase 5`,
        ).toBe(true);
        const rule = lineWith(finalSection, /마지막 wave/);
        expect(rule, `${variant}: the final pass must state its trigger`).not.toBe("");
        expect(
          /`complete`/.test(rule) && /(?:뒤|후)/.test(rule),
          `${variant}: the final pass must run after the last wave's complete event`,
        ).toBe(true);
      });

      it("AC-2: sets the denominator to the whole baseline plus cross-wave integration items", () => {
        const finalSection = sectionUnder(skillBody(readWave(variant)), /^##\s.*최종 검증/);
        const rule = lineWith(finalSection, /분모/);
        expect(rule, `${variant}: the final pass must state its denominator`).not.toBe("");
        expect(
          /설계 기준선 \*\*전체\*\*/.test(rule),
          `${variant}: the final denominator must be the WHOLE design baseline, not the last wave's slice`,
        ).toBe(true);
        expect(
          /모든 wave 요구사항의 합집합/.test(rule),
          `${variant}: the final denominator must map the baseline against the union of all wave requirements`,
        ).toBe(true);
        expect(
          /wave 경계를 가로지르는 통합 항목/.test(finalSection),
          `${variant}: integration items belonging to no single wave scope must be in the denominator`,
        ).toBe(true);
      });

      it("AC-3: reuses the per-wave loop's stance separation, add-only step and fix-free round", () => {
        const finalSection = sectionUnder(skillBody(readWave(variant)), /^##\s.*최종 검증/);
        expect(
          /정확히\s*2\s*(?:기|개)(?!\s*이상)/.test(finalSection),
          `${variant}: the final pass must reuse the exactly-two-verifier stance separation`,
        ).toBe(true);
        expect(/add-only/.test(finalSection), `${variant}: the final pass must reuse the add-only cross-refutation`).toBe(
          true,
        );
        expect(
          /수정이 적용되지 않았을 것/.test(finalSection),
          `${variant}: the final pass must reuse the fix-free clean round condition`,
        ).toBe(true);
      });

      it("AC-4: appends a run-scoped event carrying its own verification object", () => {
        const finalSection = sectionUnder(skillBody(readWave(variant)), /^##\s.*최종 검증/);
        expect(
          /`phase="final-verify"`|`phase`\s*=\s*`?"?final-verify/.test(finalSection),
          `${variant}: the final pass must append an event carrying phase=final-verify`,
        ).toBe(true);
        // Run-scoped, not wave-scoped: without the sentinel the per-wave latest-status computation
        // reads the final pass as a wave and the resume predicate breaks.
        expect(
          /`wave="all"`/.test(finalSection) && /`order=0`/.test(finalSection),
          `${variant}: the run-scoped final event must carry wave="all" and order=0`,
        ).toBe(true);
        expect(
          /`verification`/.test(finalSection),
          `${variant}: the final event must carry its own verification object`,
        ).toBe(true);
      });

      it("AC-5: refuses to report completion until the final verdict passes", () => {
        const finalSection = sectionUnder(skillBody(readWave(variant)), /^##\s.*최종 검증/);
        const rule = lineWith(finalSection, /완료로 보고하지 않는다/);
        expect(
          rule,
          `${variant}: the orchestration must not be reported complete before the final verdict passes`,
        ).not.toBe("");
        expect(HEDGE.test(rule), `${variant}: the completion gate must be absolute, not hedged`).toBe(false);
        expect(
          /재개[^\n]*최종 검증(?:으로|부터)/.test(finalSection),
          `${variant}: a run whose final pass has not passed must resume INTO the final pass`,
        ).toBe(true);
      });

      it("AC-6: reports final residual findings in full", () => {
        const finalSection = sectionUnder(skillBody(readWave(variant)), /^##\s.*최종 검증/);
        expect(
          /잔여 finding 을 \*\*전량\*\* 보고한다/.test(finalSection),
          `${variant}: final residual findings must be reported in full`,
        ).toBe(true);
        expect(
          /(?:표본|상위 N)(?:으?로|만)\s*(?:보고|축약|자른다)/.test(finalSection),
          `${variant}: no clause may reduce the final residual report to a sample or a top-N list`,
        ).toBe(false);
      });

      it("AC-1/AC-5: declares the final-pass halt as a critical gate row", () => {
        const gates = gateSection(skillBody(readWave(variant)));
        const row = rowCells(gates, /final-verify-residual-critical/);
        expect(row.length, `${variant}: critical_gates must declare final-verify-residual-critical`).toBeGreaterThan(2);
        expect(
          /--auto/.test(row.join(" ")) || /--auto/.test(gates),
          `${variant}: the final-pass gate must halt even under --auto`,
        ).toBe(true);
      });
    });
  }
});

describe("FR-FLOW-050 — design-to-SRS fidelity wiring and SRS-layer gap remediation", () => {
  for (const variant of VARIANTS) {
    describe(`${variant} variant`, () => {
      it("AC-1: passes the design baseline to kiwi-srs as a research document path", () => {
        const register = withModule(skillBody(readWave(variant)), /^##\s.*Wave 별 target 등록/, "wave-srs-registration");
        expect(register, `${variant}: the target-registration section must exist`).not.toBe("");
        const rule = lineWith(register, /리서치 문서/);
        expect(rule, `${variant}: the kiwi-srs invocation must state the research-document argument`).not.toBe("");
        expect(
          KIWI_SRS_CALL.test(rule) && /`design_baseline\.path`/.test(rule),
          `${variant}: the kiwi-srs call must pass design_baseline.path as the research document argument`,
        ).toBe(true);
        // The reason the path is required rather than inlined content: only a path activates the
        // research verify-and-improve loop.
        expect(
          /인라인[^\n]*리서치 검증·개선 루프가 (?:작동|활성화)하지 않는다/.test(register),
          `${variant}: the text must say that inlining the wave content alone does not activate the research loop`,
        ).toBe(true);
      });

      it("AC-2: uses the same artifact path recorded on waves.jsonl", () => {
        const register = withModule(skillBody(readWave(variant)), /^##\s.*Wave 별 target 등록/, "wave-srs-registration");
        expect(
          /`waves\.jsonl` 에 기록한 것과 \*\*같은\*\* 경로/.test(register),
          `${variant}: the authoring input and the evidence bundle must not diverge on the baseline path`,
        ).toBe(true);
      });

      it("AC-3: routes a design-present / SRS-absent finding to incremental authoring re-entry", () => {
        const section = verifySection(skillBody(readWave(variant)));
        const routing = sectionUnder(section, /^#{2,4}\s.*개선 위임/);
        expect(routing, `${variant}: the remediation routing sub-section must exist`).not.toBe("");
        const row = rowCells(routing, /설계 기준선에는 있으나/);
        expect(row.length, `${variant}: the routing table must have a design-present / SRS-absent row`).toBeGreaterThan(2);
        const handling = row.join(" ");
        expect(
          KIWI_SRS_CALL.test(handling) && /증분/.test(handling),
          `${variant}: the row's handling must be incremental SRS authoring re-entry for that wave target`,
        ).toBe(true);
        expect(
          /planning|계획/.test(handling) && /재진입/.test(handling),
          `${variant}: the row must also route pipeline re-entry from the planning stage`,
        ).toBe(true);
      });

      it("AC-4: keeps the design-gap row distinct from the unclosable-in-code row", () => {
        const routing = sectionUnder(verifySection(skillBody(readWave(variant))), /^#{2,4}\s.*개선 위임/);
        const designRow = tableRows(routing, /설계 기준선에는 있으나/);
        const residualRow = tableRows(routing, /코드로 닫을 수 없는/);
        expect(designRow.length, `${variant}: the design-gap row must exist`).toBe(1);
        expect(residualRow.length, `${variant}: the unclosable-in-code row must still exist`).toBe(1);
        expect(
          designRow[0] !== residualRow[0],
          `${variant}: a design-layer gap must be remediated, not merged into the report-only residual row`,
        ).toBe(true);
        // Merging them the other way — routing the unclosable row into authoring re-entry — would
        // also collapse the distinction, so pin the residual row's own handling.
        expect(
          /residual/.test(residualRow[0]),
          `${variant}: the unclosable-in-code row must remain a residual plus user decision`,
        ).toBe(true);
      });

      it("AC-5: keeps the cross-wave halt in force for the remediation path", () => {
        const routing = sectionUnder(verifySection(skillBody(readWave(variant))), /^#{2,4}\s.*개선 위임/);
        expect(
          /증분 저작이[^\n]*(?:이전|완료된) wave[^\n]*`wave-verify-cross-wave-fix-required`/.test(routing),
          `${variant}: incremental authoring touching a completed wave target must still hit the cross-wave halt`,
        ).toBe(true);
      });

      it("AC-6: permits automatic remediation of a design-layer gap under --auto", () => {
        const routing = sectionUnder(verifySection(skillBody(readWave(variant))), /^#{2,4}\s.*개선 위임/);
        const rule = lineWith(routing, /설계 계층 갭의 자동 처리/);
        expect(rule, `${variant}: the auto-remediation permission must be stated`).not.toBe("");
        expect(
          /`--auto`[^\n]*허용한다/.test(rule),
          `${variant}: automatic remediation of a design-layer gap must be permitted under unattended operation`,
        ).toBe(true);
        expect(
          /추론이 아니라 기록된 설계 기준선/.test(routing),
          `${variant}: the permission must be justified by the recorded baseline rather than an inference`,
        ).toBe(true);
      });
    });
  }
});

describe("FR-FLOW-051 — wave target registration and wave-internal resume granularity", () => {
  for (const variant of VARIANTS) {
    describe(`${variant} variant`, () => {
      it("AC-1: kiwi-srs registers an unregistered target instead of failing", () => {
        const target = sectionUnder(skillBody(readSrs(variant)), /^#{3}\s.*TARGET 확인/);
        expect(target, `${variant}: kiwi-srs must have a target-resolution section`).not.toBe("");
        const rule = lineWith(target, /미등록/);
        expect(rule, `${variant}: kiwi-srs must define what happens for an unregistered target`).not.toBe("");
        expect(
          /`set_active_target`/.test(rule) && /(?:생성|create)/.test(rule),
          `${variant}: an unregistered target must be registered through a creation-enabled activation call`,
        ).toBe(true);
        // The halt must be scoped to a failed REGISTRATION, not to the target being absent — the
        // latter is the status quo this AC removes.
        expect(
          /등록 자체가 실패한 경우에만/.test(target),
          `${variant}: kiwi-srs must halt only when the registration call itself fails`,
        ).toBe(true);
      });

      it("AC-2: the CLI fallback row shows the creation option", () => {
        const fallback = sectionUnder(skillBody(readSrs(variant)), /^##\s.*(?:MCP \/ CLI fallback|CLI fallback)/i);
        expect(fallback, `${variant}: kiwi-srs must have a CLI fallback table`).not.toBe("");
        // Column-bound: `--create` mentioned in the prose below the table does not make the
        // fallback path able to register anything.
        const cells = rowCells(fallback, /Target 활성화/);
        expect(cells.length, `${variant}: the fallback table must have a target-activation row`).toBeGreaterThan(3);
        expect(
          /--create/.test(cells[3]),
          `${variant}: the CLI-fallback CELL for target activation must show the creation option`,
        ).toBe(true);
      });

      it("AC-3: kiwi-wave-master calls creation-enabled registration the normal path", () => {
        const register = withModule(skillBody(readWave(variant)), /^##\s.*Wave 별 target 등록/, "wave-srs-registration");
        const rule = lineWith(register, /\*\*정상 경로\*\*/);
        expect(rule, `${variant}: registration of an unregistered wave target must be called the normal path`).not.toBe(
          "",
        );
        expect(
          /예외(?:적인 경로)?가 아니다/.test(rule),
          `${variant}: the text must say explicitly that this is not an exceptional path`,
        ).toBe(true);
      });

      it("AC-5: skips registration and authoring for a wave marked srs_authored on ANY event", () => {
        const body = skillBody(readWave(variant));
        const register = withModule(body, /^##\s.*Wave 별 target 등록/, "wave-srs-registration");
        const rule = lineWith(register, /`srs_authored`/);
        expect(rule, `${variant}: the authoring-finished mark must drive a skip`).not.toBe("");
        // The normative skip sentence is isolated from the rest of the line. The line also carries a
        // cautionary clause that NAMES latest-event keying in order to reject it; letting that clause
        // answer for the trigger would make both the positive and the polarity check meaningless.
        const skipSentence = rule.split(/(?<=다\.)\s*/).find((s) => /건너뛰고|skip/.test(s)) ?? "";
        expect(skipSentence, `${variant}: the skip rule must state its trigger in its own sentence`).not.toBe("");
        expect(
          /`srs_authored`/.test(skipSentence) && /하나라도/.test(skipSentence),
          `${variant}: the skip must key on ANY event carrying the mark, not merely the latest one — a wave-verify event landing on top must not re-arm authoring`,
        ).toBe(true);
        // Polarity: keying the decision to the wave's latest event is the exact defect this AC
        // removes (a crash mid-verification leaves a mark-less event on top and the SRS is authored
        // twice), so a regression to that wording must go red.
        expect(
          /최신/.test(skipSentence),
          `${variant}: the skip trigger must not be keyed to the wave's latest event`,
        ).toBe(false);
        expect(
          /(?:건너뛰고|skip하고|skip 하고)[^\n]*(?:곧바로|직접)[^\n]*pipeline/.test(rule),
          `${variant}: such a wave must enter the pipeline phase directly`,
        ).toBe(true);
        expect(HEDGE.test(skipSentence), `${variant}: the skip rule must be absolute, not hedged`).toBe(false);
      });

      it("AC-6: defines wave-internal resume at three stages", () => {
        const progress = sectionUnder(skillBody(readWave(variant)), /^##\s.*진행 추적/);
        expect(progress, `${variant}: the waves.jsonl progress section must exist`).not.toBe("");
        const rule = lineWith(progress, /재개 단위/);
        expect(rule, `${variant}: wave-internal resume granularity must be stated`).not.toBe("");
        expect(
          /\*\*3단계\*\*/.test(rule),
          `${variant}: resume granularity must be the three wave-internal stages`,
        ).toBe(true);
        for (const stage of ["target 등록", "pipeline", "wave 검증"]) {
          expect(rule.includes(stage), `${variant}: the resume granularity must name the ${stage} stage`).toBe(true);
        }
        // Polarity: leaving whole-wave granularity as an accepted alternative reinstates the very
        // re-authoring this requirement removes.
        expect(
          /wave 통째로만/.test(progress) === false || /wave 통째로만[^\n]*(?:아니다|않는다)/.test(progress),
          `${variant}: resume must not be defined only at whole-wave granularity`,
        ).toBe(true);
      });
    });
  }
});

describe("FR-FLOW-052 — unattended continuity across cycle entry and cost gates", () => {
  for (const variant of VARIANTS) {
    describe(`${variant} variant`, () => {
      it("AC-1: makes cycle-entry spawning unambiguous on one of the two contract ends", () => {
        const waveBody = skillBody(readWave(variant));
        const pipelineBody = skillBody(readPipeline(variant));
        const waveRun = sectionUnder(waveBody, /^##\s.*kiwi-pipeline 실행/);
        const cycle = sectionUnder(pipelineBody, /^##\s.*사이클 오케스트레이션/);
        expect(waveRun, `${variant}: the per-wave pipeline section must exist`).not.toBe("");
        expect(cycle, `${variant}: the pipeline cycle section must exist`).not.toBe("");
        // Either the orchestrator passes --run explicitly on the cycle invocation …
        const orchestratorPasses = /--cycle[^\n]*--run|--run[^\n]*--cycle/.test(waveRun);
        // … or the pipeline contract states that cycle mode implies spawning.
        const contractImplies = /`--cycle`[^\n]*(?:는|은)[^\n]*`--run`[^\n]*(?:함의|포함|의미)한다/.test(cycle);
        expect(
          orchestratorPasses || contractImplies,
          `${variant}: cycle entry must be unambiguous — either wave-master passes --run explicitly or the pipeline contract states that --cycle implies it`,
        ).toBe(true);
      });

      it("AC-2: exempts cycle-mode entry from the multi-candidate ambiguity gate", () => {
        const gates = gateSection(skillBody(readPipeline(variant)));
        expect(gates, `${variant}: kiwi-pipeline must declare critical_gates`).not.toBe("");
        // Anchored to the gate ROW: stated in the prose below, an agent reading the SSOT table
        // still halts on every cycle hand-off.
        const cells = rowCells(gates, /multi-candidate-ambiguous/);
        expect(cells.length, `${variant}: the multi-candidate gate row must exist`).toBeGreaterThan(2);
        expect(
          /§2\.5|체인 핸드오프/.test(cells.join(" ")) && /(?:비적용|적용되지 않는다|적용하지 않는다)/.test(cells.join(" ")),
          `${variant}: the gate ROW itself must declare that it does not apply to a fixed chain hand-off`,
        ).toBe(true);
        // @req FR-FLOW-127 — this assertion used to require the exemption to name `--cycle`. Once
        // FR-FLOW-124 made the cycle the default, that spelling exempted every advancement and
        // retired a user-confirmation gate repo-wide. The exemption's own premise is that the chain
        // fixes the next step; Table T1 advancement does not fix it — the feasibility row forks to
        // kiwi-planner or kiwi-srs-research — so the row must name T1 as where the gate still
        // fires. Asserted positively: a universal exemption re-spelled in new wording evades a
        // negative check but cannot satisfy this one.
        expect(
          /(?:T1|§5\.1)/.test(cells.join(" ")) && /발동|적용된다|유지/.test(cells.join(" ")),
          `${variant}: the row must name Table T1 advancement as the case the gate still fires on`,
        ).toBe(true);
      });

      it("AC-3: reads the work mode in preflight and declares wave cycles body-scope", () => {
        const preflight = sectionUnder(skillBody(readWave(variant)), /^##\s.*Preflight/);
        expect(preflight, `${variant}: the preflight section must exist`).not.toBe("");
        expect(
          /get_work_mode/.test(preflight),
          `${variant}: preflight must read the persisted work mode`,
        ).toBe(true);
        const rule = lineWith(preflight, /body-scope|본문 스코프/);
        expect(rule, `${variant}: wave cycles must be declared body-scope work`).not.toBe("");
        expect(
          /kiwi-tdd/.test(preflight),
          `${variant}: the routing exclusion must name the test-first skill it excludes`,
        ).toBe(true);
        expect(
          /step-scoped[^\n]*적용되지 않는다|step 스코프[^\n]*적용되지 않는다/.test(preflight),
          `${variant}: step-scoped routing must be declared inapplicable to a wave cycle`,
        ).toBe(true);
      });

      it("AC-4: lists the cost and integration pass-through options with their propagation path", () => {
        const propagation = sectionUnder(skillBody(readWave(variant)), /^#{3}\s.*(?:pass-through|전달 옵션)/i);
        expect(propagation, `${variant}: a pass-through option sub-section must exist under §7`).not.toBe("");
        for (const opt of ["--auto-cost-warning", "--auto-integration"]) {
          expect(
            tableRows(propagation, new RegExp(opt.replace(/-/g, "\\-"))).length > 0 || propagation.includes(opt),
            `${variant}: ${opt} must be reachable as an explicitly listed pass-through option`,
          ).toBe(true);
        }
        // The chain is what makes the option actually arrive; naming only the endpoints leaves the
        // intermediate skills free to drop it.
        for (const hop of ["kiwi-pipeline", "kiwi-pm", "kiwi-coder"]) {
          expect(
            propagation.includes(hop),
            `${variant}: the propagation path must name the intermediate skill ${hop}`,
          ).toBe(true);
        }
      });

      it("AC-5: guards the integration-test consent gate with the child-context check", () => {
        const integration = sectionUnder(skillBody(readCoder(variant)), /^#{3}\s.*조건/);
        expect(integration, `${variant}: kiwi-coder must have an integration-test condition section`).not.toBe("");
        expect(
          /spawn_context/.test(integration) && /pm-child/.test(integration),
          `${variant}: the integration-test consent gate must carry the same pm-child guard as the follow-on review gate`,
        ).toBe(true);
      });

      it("AC-6: refuses the regression-skip and reviewer-off options like worktree delegation", () => {
        const body = skillBody(readWave(variant));
        const preflight = sectionUnder(body, /^##\s.*Preflight/);
        const rule = lineWith(preflight, /--skip-regression/);
        expect(rule, `${variant}: the regression-skip refusal must be stated`).not.toBe("");
        expect(
          /--reviewer-off/.test(rule),
          `${variant}: the reviewer-off option must be refused on the same line`,
        ).toBe(true);
        expect(
          /거부한다/.test(rule),
          `${variant}: these options must be REFUSED, not merely discouraged`,
        ).toBe(true);
        expect(HEDGE.test(rule), `${variant}: the refusal must be absolute, not hedged`).toBe(false);
        const gates = gateSection(body);
        expect(
          tableRows(gates, /unsafe-option-refused/).length,
          `${variant}: critical_gates must declare unsafe-option-refused as a table row`,
        ).toBeGreaterThan(0);
        // The unattended flag's propagation must be sourced from the shared contract, not restated.
        const autoProp = sectionUnder(body, /^#{3}\s.*--auto/);
        expect(
          /auto-option\.md/.test(autoProp),
          `${variant}: automatic propagation of --auto to per-wave children must follow the shared option contract`,
        ).toBe(true);
      });
    });
  }
});

describe("FR-FLOW-053 — per-requirement partial progress instead of whole-run blocking", () => {
  for (const variant of VARIANTS) {
    describe(`${variant} variant`, () => {
      it("AC-1: skips only the tasks tracing to a draft requirement under --auto", () => {
        const body = skillBody(readPm(variant));
        const auto = sectionUnder(body, /^#{3}\s.*`--auto` 동작/);
        expect(auto, `${variant}: kiwi-pm must have an --auto lifecycle-gate section`).not.toBe("");
        const draft = lineWith(auto, /`draft`/);
        expect(draft, `${variant}: the draft branch must exist`).not.toBe("");
        expect(
          /해당 REQ 를 trace 하는 Task 만 skip/.test(draft),
          `${variant}: a draft requirement must skip only the tasks tracing to it`,
        ).toBe(true);
        // Polarity: leaving HALT on that line reinstates whole-run blocking.
        expect(
          /HALT/.test(draft),
          `${variant}: the draft branch must no longer halt the whole run`,
        ).toBe(false);
        expect(
          /skip[^\n]*목록[^\n]*보고|skip 목록을 보고/.test(auto),
          `${variant}: the skipped list must be reported`,
        ).toBe(true);
        // deprecated / frozen are policy stops and must NOT be relaxed along with draft.
        const policy = lineWith(auto, /`deprecated`/);
        expect(
          /HALT/.test(policy),
          `${variant}: deprecated and frozen must still halt immediately`,
        ).toBe(true);
      });

      it("AC-1: drops lifecycle-gate-draft from the unconditional critical gate table", () => {
        const gates = gateSection(skillBody(readPm(variant)));
        expect(gates, `${variant}: kiwi-pm must declare critical_gates`).not.toBe("");
        expect(
          tableRows(gates, /`?lifecycle-gate-draft`?/).length,
          `${variant}: lifecycle-gate-draft must no longer be declared an unconditional HALT gate — it contradicts the per-requirement skip`,
        ).toBe(0);
      });

      it("AC-2: routes requirements left at draft through the remediation table", () => {
        const routing = sectionUnder(verifySection(skillBody(readWave(variant))), /^#{2,4}\s.*개선 위임/);
        const row = rowCells(routing, /draft 로 남은/);
        expect(row.length, `${variant}: the routing table must have a left-at-draft row`).toBeGreaterThan(2);
        expect(
          /feasibility/.test(row.join(" ")),
          `${variant}: the row must name the stage that left the requirement at draft`,
        ).toBe(true);
      });

      it("AC-3: declares the task-failure escalation halt as a critical gate", () => {
        const gates = gateSection(skillBody(readPm(variant)));
        const cells = rowCells(gates, /task-failure-escalation/);
        expect(cells.length, `${variant}: kiwi-pm critical_gates must declare task-failure-escalation`).toBeGreaterThan(2);
      });

      it("AC-4: resolves a skipped predecessor by an automated decision, not a halt", () => {
        const body = skillBody(readPm(variant));
        const rule = lineWith(body, /선행 Task 가 \*\*실패가 아니라 skip\*\*/);
        expect(rule, `${variant}: the dependency check must distinguish a skipped predecessor from a failed one`).not.toBe(
          "",
        );
        expect(
          /자동 결정/.test(rule),
          `${variant}: a skipped predecessor must be resolvable by an automated continue-or-skip decision`,
        ).toBe(true);
        expect(
          /무조건 HALT|일률적으로 HALT/.test(rule),
          `${variant}: a skipped predecessor must not fall through to an unconditional halt`,
        ).toBe(false);
      });

      it("AC-5: defers a scope-boundary conflict under --auto instead of blocking authoring", () => {
        const gate = sectionUnder(skillBody(readSrs(variant)), /^#{3}\s.*Scope-boundary impact gate/i);
        expect(gate, `${variant}: kiwi-srs must have a scope-boundary gate section`).not.toBe("");
        const rule = lineWith(gate, /`--auto`/);
        expect(rule, `${variant}: the gate must state its unattended behaviour`).not.toBe("");
        expect(
          /(?:보류|연기)하고 기록한다/.test(rule),
          `${variant}: under --auto a boundary-conflicting requirement must be deferred and recorded`,
        ).toBe(true);
        expect(
          /나머지 요구사항[^\n]*(?:계속|이어서)/.test(rule),
          `${variant}: the remaining requirements must keep being authored`,
        ).toBe(true);
        expect(
          /전체 중단은[^\n]*사용자[^\n]*거부/.test(gate),
          `${variant}: the whole-run block must be reserved for an explicit user refusal`,
        ).toBe(true);
      });

      it("AC-6: surfaces every skipped or deferred requirement as wave residual", () => {
        const section = verifySection(skillBody(readWave(variant)));
        const rule = lineWith(section, /skip(?:되거나|·)|보류된 REQ/);
        expect(
          /`reason_class`/.test(section),
          `${variant}: skipped and deferred requirements must be recorded with a reason_class`,
        ).toBe(true);
        expect(
          /`verification\.residual`/.test(section),
          `${variant}: they must surface in verification.residual rather than being silently omitted`,
        ).toBe(true);
        expect(
          /조용히 누락|silently omit/i.test(rule) === false,
          `${variant}: the rule line must not read as licence to omit`,
        ).toBe(true);
      });
    });
  }
});

describe("FR-FLOW-054 — existing-structure preservation guards across the implementation chain", () => {
  for (const variant of VARIANTS) {
    describe(`${variant} variant`, () => {
      it("AC-1: declares existing tests inviolable with all three prohibitions", () => {
        const body = skillBody(readCoder(variant));
        const rule = lineWith(body, /기존 테스트 불가침/);
        expect(rule, `${variant}: kiwi-coder must declare an existing-tests-inviolable rule`).not.toBe("");
        for (const [token, what] of [
          ["기존 테스트 파일 삭제", "deletion of existing test files"],
          ["기존 테스트 케이스 제거", "removal of existing test cases"],
          ["기존 단언 약화", "weakening of existing assertions"],
        ] as const) {
          expect(rule.includes(token), `${variant}: the rule must forbid ${what}`).toBe(true);
        }
        expect(
          /금지/.test(rule),
          `${variant}: the three must be prohibited, not discouraged`,
        ).toBe(true);
        expect(HEDGE.test(rule), `${variant}: the inviolability rule must be absolute, not hedged`).toBe(false);
      });

      it("AC-2: detects the three in the diff at the plan-versus-code gate as CRITICAL", () => {
        const impl = sectionUnder(skillBody(readCoder(variant)), /^#{3}\s.*단계 흐름/);
        expect(impl, `${variant}: the implementation-loop flow must exist`).not.toBe("");
        // Scoped to the plan-vs-code gate branch of the flow block, so a mention in the review-axis
        // table below cannot satisfy it.
        const gate = impl.split(/\(d\) 계획-코드 일치 게이트/)[1]?.split(/\(e\)/)[0] ?? "";
        expect(gate, `${variant}: the plan-versus-code gate branch must exist`).not.toBe("");
        expect(
          /기존 테스트/.test(gate) && /(?:삭제|제거)/.test(gate) && /약화/.test(gate),
          `${variant}: the gate must detect test-file deletion, test-case removal and assertion weakening in the diff`,
        ).toBe(true);
        expect(
          /CRITICAL/.test(gate) && /재구현|재호출/.test(gate),
          `${variant}: a detection must be a critical finding that forces re-implementation`,
        ).toBe(true);
      });

      it("AC-3: declares that detection as a critical gate that --auto cannot resolve", () => {
        const gates = gateSection(skillBody(readCoder(variant)));
        const cells = rowCells(gates, /existing-test-weakened-or-deleted/);
        expect(
          cells.length,
          `${variant}: kiwi-coder critical_gates must declare existing-test-weakened-or-deleted`,
        ).toBeGreaterThan(2);
        expect(
          /결정 서브에이전트로 우회 금지|우회 금지/.test(gates),
          `${variant}: the gate must not be resolvable by an automated decision`,
        ).toBe(true);
      });

      it("AC-4: captures a baseline suite result and judges regression by the delta", () => {
        const body = skillBody(readCoder(variant));
        const regression = sectionUnder(body, /^#{3}\s.*회귀 테스트/);
        expect(regression, `${variant}: the regression section must exist`).not.toBe("");
        const rule = lineWith(regression, /기준선|baseline/i);
        expect(rule, `${variant}: a baseline capture rule must exist`).not.toBe("");
        expect(
          /코드를 바꾸기 전에/.test(rule),
          `${variant}: the baseline must be captured BEFORE the task starts changing code`,
        ).toBe(true);
        expect(
          /(?:델타|delta|증분)로 판정/.test(regression),
          `${variant}: regression must be judged by the delta against the captured baseline`,
        ).toBe(true);
        expect(
          /기존 실패[^\n]*(?:보고|분리)하고[^\n]*(?:현재 Task 의 것으로 )?귀속하지 않는다/.test(regression),
          `${variant}: pre-existing failures must be reported rather than attributed to the current task`,
        ).toBe(true);
      });

      it("AC-5: raises a distinct path-independent gate for existing public contract changes", () => {
        const gates = gateSection(skillBody(readCoder(variant)));
        const cells = rowCells(gates, /existing-public-contract-change/);
        expect(
          cells.length,
          `${variant}: kiwi-coder critical_gates must declare existing-public-contract-change`,
        ).toBeGreaterThan(2);
        const reason = cells.join(" ");
        expect(
          /(?:삭제|시그니처 변경)/.test(reason) && /public/.test(reason),
          `${variant}: the gate must trigger on deletion of, or signature change to, an existing public symbol`,
        ).toBe(true);
        expect(
          /diff/.test(reason),
          `${variant}: the detection must come from the diff`,
        ).toBe(true);
        // The point of the AC: not the migration/schema/auth path-token heuristic.
        expect(
          /경로와 무관|path 와 무관/.test(reason),
          `${variant}: the gate must be critical regardless of the file path, not a path-token heuristic`,
        ).toBe(true);
      });

      it("AC-6: requires a green full regression run at the wave head for a passing verdict", () => {
        const section = verifySection(skillBody(readWave(variant)));
        const bundle = sectionUnder(section, /^#{3,4}\s.*증거 번들/);
        const row = rowCells(bundle, /회귀 스위트/);
        expect(row.length, `${variant}: the evidence bundle must include a full regression suite run`).toBeGreaterThan(2);
        const cell = row.join(" ");
        for (const field of ["command", "exit_code", "failing_tests"]) {
          expect(cell.includes(field), `${variant}: the regression row must record ${field}`).toBe(true);
        }
        expect(
          /wave (?:head|헤드|tip)/i.test(cell),
          `${variant}: the regression run must be executed at that wave's head`,
        ).toBe(true);
        // The pass condition, anchored to the PASS table's Normal row so a mention in the prose
        // cannot stand in for the gate.
        const normalRow = lineWith(section, /^\|\s*Normal\s*\|/m);
        expect(normalRow, `${variant}: the PASS table must have a Normal row`).not.toBe("");
        // R3-M20 — strengthened, not weakened. The row gained a fallback clause ("기준선 부재 시
        // `exit_code`=0"), and the old alternation `/`exit_code`\s*=?\s*0|회귀 스위트 통과/` began
        // matching THAT clause, so the assertion passed while the primary condition it is named for
        // went unpinned. Both roles are now fixed separately: the delta is the pass condition, and
        // exit_code=0 exists only as the degraded form used when the baseline capture failed.
        expect(
          /failing_tests\s*⊆\s*baseline_failing_tests/.test(normalRow),
          `${variant}: the Normal PASS row's primary condition must be the baseline delta, not a bare green suite`,
        ).toBe(true);
        expect(
          (normalRow.match(/exit_code/g) ?? []).length,
          `${variant}: exit_code must appear once in the Normal row — a second occurrence is an unconditional green-suite requirement smuggled back in`,
        ).toBe(1);
        expect(
          /기준선 부재 시[^|]*`exit_code`\s*=?\s*0/.test(normalRow),
          `${variant}: the single exit_code=0 occurrence must be the capture-failure fallback, not the primary condition`,
        ).toBe(true);
      });
    });
  }
});

describe("FR-FLOW-055 — cross-wave carry-forward, decision rule and re-entry scope", () => {
  for (const variant of VARIANTS) {
    describe(`${variant} variant`, () => {
      it("AC-1: decides cross-wave status by a mechanical rule over the file set", () => {
        const cross = sectionUnder(verifySection(skillBody(readWave(variant))), /^#{2,4}\s.*교차 wave/);
        expect(cross, `${variant}: a cross-wave sub-section must exist`).not.toBe("");
        const rule = lineWith(cross, /파일 집합/);
        expect(rule, `${variant}: the cross-wave decision rule must key on the file set`).not.toBe("");
        expect(
          /기계적/.test(rule),
          `${variant}: cross-wave status must be decided mechanically, not by narrative judgement`,
        ).toBe(true);
        expect(
          /서술적 판단|narrative/i.test(cross) === false || /서술적 판단[^\n]*아니다/.test(cross),
          `${variant}: narrative judgement must be excluded, not offered as an alternative`,
        ).toBe(true);
        // Both anchors of the intersection; dropping either silently narrows the rule.
        expect(
          /코드 trace 앵커/.test(cross),
          `${variant}: the rule must intersect with the earlier wave's recorded requirement code trace anchors`,
        ).toBe(true);
        expect(
          /(?:이전|앞선) wave 의 diff 파일 집합/.test(cross),
          `${variant}: the rule must also intersect with the earlier wave's diff file set`,
        ).toBe(true);
      });

      it("AC-2: keeps a requirement-level change a halt", () => {
        const cross = sectionUnder(verifySection(skillBody(readWave(variant))), /^#{2,4}\s.*교차 wave/);
        const rule = lineWith(cross, /요구사항을 바꿔야/);
        expect(rule, `${variant}: a requirement-level cross-wave change must have its own rule`).not.toBe("");
        expect(
          /HALT|중단/.test(rule),
          `${variant}: changing an earlier wave's requirements must remain a halt`,
        ).toBe(true);
        expect(HEDGE.test(rule), `${variant}: the requirement-level halt must be absolute, not hedged`).toBe(false);
      });

      it("AC-3: carries a code-level finding forward and records it with a cross-wave marker", () => {
        const cross = sectionUnder(verifySection(skillBody(readWave(variant))), /^#{2,4}\s.*교차 wave/);
        const rule = lineWith(cross, /코드를 바꿔야/);
        expect(rule, `${variant}: a code-level cross-wave finding must have its own rule`).not.toBe("");
        expect(
          /남은 wave/.test(rule),
          `${variant}: the finding must be carried into the scope of a remaining wave`,
        ).toBe(true);
        expect(
          /남은 wave 가 없으면[^\n]*새 wave 를 추가/.test(cross),
          `${variant}: a newly appended wave must be the fallback when no wave remains`,
        ).toBe(true);
        expect(
          /`cross_wave`/.test(cross) && /`carried_into`/.test(cross),
          `${variant}: the carried finding must be recorded as residual with the cross_wave and carried_into markers`,
        ).toBe(true);
      });

      it("AC-4: never modifies or reverses the earlier wave's complete event", () => {
        const cross = sectionUnder(verifySection(skillBody(readWave(variant))), /^#{2,4}\s.*교차 wave/);
        const rule = lineWith(cross, /`complete` 이벤트를/);
        expect(rule, `${variant}: the append-only guarantee must be restated for carry-forward`).not.toBe("");
        expect(
          /수정하거나 되돌리지 않는다/.test(rule),
          `${variant}: carrying a finding forward must not modify or reverse the earlier complete event`,
        ).toBe(true);
        expect(HEDGE.test(rule), `${variant}: the append-only guarantee must be absolute, not hedged`).toBe(false);
      });

      it("AC-5: reserves the halt for the case where no carry-forward path exists", () => {
        const cross = sectionUnder(verifySection(skillBody(readWave(variant))), /^#{2,4}\s.*교차 wave/);
        const rule = lineWith(cross, /양쪽 carry-forward 경로/);
        expect(rule, `${variant}: the halt must be scoped against the carry-forward paths`).not.toBe("");
        expect(
          /모두 불가능할 때(?:에만|만)/.test(rule),
          `${variant}: the halt must be reserved for the case where NEITHER carry-forward path is available`,
        ).toBe(true);
        expect(
          /첫 대응이 아니다/.test(cross),
          `${variant}: the halt must be declared as not the first response to any cross-wave finding`,
        ).toBe(true);
      });

      it("AC-6: gives a verification-driven pipeline re-entry an explicit scope", () => {
        const routing = sectionUnder(verifySection(skillBody(readWave(variant))), /^#{2,4}\s.*개선 위임/);
        // The review delegation row already carries --base/--commits; the re-entry row must reach
        // the same specificity or a re-entry silently re-runs the whole plan.
        const row = rowCells(routing, /재진입/);
        expect(row.length, `${variant}: a pipeline re-entry row must exist`).toBeGreaterThan(2);
        const scope = routing;
        expect(
          /미해소 요구사항 필터|미대응 REQ 필터/.test(scope),
          `${variant}: a re-entry must carry the unaddressed requirement filter`,
        ).toBe(true);
        expect(
          /`plan_run_id`[^\n]*재사용/.test(scope),
          `${variant}: a re-entry must state whether the existing plan run identifier is reused`,
        ).toBe(true);
      });
    });
  }
});

describe("FR-FLOW-047..055 — the wave critical_gates table keeps every declared halt", () => {
  for (const variant of VARIANTS) {
    it(`${variant}: declares the pre-existing and the new gates as rows`, () => {
      const gates = gateSection(skillBody(readWave(variant)));
      expect(gates, `${variant}: a critical_gates declaration section must exist`).not.toBe("");
      const rows = gates.split("\n").filter((line) => /^\s*\|/.test(line) && line.split("|").length >= 5);
      for (const id of [...EXISTING_WAVE_GATE_IDS, ...NEW_WAVE_GATE_IDS]) {
        expect(
          rows.some((row) => row.includes(id)),
          `${variant}: critical_gates must declare ${id} as a table row`,
        ).toBe(true);
      }
      expect(
        rows.length >= EXISTING_WAVE_GATE_IDS.length + NEW_WAVE_GATE_IDS.length,
        `${variant}: critical_gates must carry one row per declared gate`,
      ).toBe(true);
    });
  }
});
