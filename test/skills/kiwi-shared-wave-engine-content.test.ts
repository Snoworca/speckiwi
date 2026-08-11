import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { moduleRegion, prefixHeadings, readResolvedSkill, sharedModuleRefs } from "../support/resolved-skill.js";

// @req FR-FLOW-106  verify-loop.md carries the cross-verification engine, denominator-agnostically
// @req FR-FLOW-107  wave-decomposition.md carries wave splitting, the baseline and the coverage gate
// @req FR-FLOW-108  wave-srs-registration.md carries the per-wave /kiwi-srs registration contract
// @req FR-FLOW-109  run-ledger.md carries the resume ledger plus the three reassigned clauses
// @req FR-FLOW-110  the extraction preserves behaviour
//
// These are raw-text contract assertions over authored prose, the technique FR-FLOW-029/044/049 are
// verified by. The four modules were created by MOVING text out of kiwi-wave-master, so the two
// halves of each rule are asserted together: the sentence is present in the module, and the skill no
// longer restates it. A move that leaves a copy behind is a duplication defect, and a move that
// drops the sentence is a regression — one assertion pair catches both.

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const VARIANTS = ["claude", "codex", "etc"] as const;
/** The three shipped variants plus the `.agents` mirror — the four copies §14 requires. */
const COPIES = [
  ["claude", path.join(REPO_ROOT, "skills", "claude", "_shared", "kiwi")],
  ["codex", path.join(REPO_ROOT, "skills", "codex", "_shared", "kiwi")],
  ["etc", path.join(REPO_ROOT, "skills", "etc", "_shared", "kiwi")],
  ["mirror", path.join(REPO_ROOT, ".agents", "skills", "_shared", "kiwi")]
] as const;

/** "" for a missing file, so a net-new module fails as a clean AssertionError rather than ENOENT. */
function readModule(dir: string, name: string): string {
  try {
    return readFileSync(path.join(dir, `${name}.md`), "utf8");
  } catch {
    return "";
  }
}

/** The `_shared/kiwi/` module as shipped for one variant. */
function readVariantModule(variant: string, name: string): string {
  return readModule(path.join(REPO_ROOT, "skills", variant, "_shared", "kiwi"), name);
}

/** kiwi-wave-master's own SKILL.md — deliberately NOT resolved, so a moved sentence cannot hide. */
function readWaveMasterRaw(variant: string): string {
  try {
    return readFileSync(path.join(REPO_ROOT, "skills", variant, "kiwi-wave-master", "SKILL.md"), "utf8");
  } catch {
    return "";
  }
}

function skillBody(text: string): string {
  return text.replace(/^---[\s\S]*?\n---\s*\n?/, "");
}

/** A heading and everything under it, down to the next same-or-higher-level heading. */
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

/** The `## 0.` SSOT table of a skill. */
function sectionZeroOf(variant: string, skill: string): string {
  const raw = (() => {
    try {
      return readFileSync(path.join(REPO_ROOT, "skills", variant, skill, "SKILL.md"), "utf8");
    } catch {
      return "";
    }
  })();
  return sectionUnder(skillBody(raw), /^##\s*0\.\s/);
}

const MODULES = ["verify-loop", "wave-decomposition", "wave-srs-registration", "run-ledger"] as const;

// ===============================================================================================
// Four copies. FR-FLOW-106/107/108/109 AC-1.
// ===============================================================================================
describe("FR-FLOW-106..109 AC-1 — each module ships at v1.0.0 in all four copies", () => {
  for (const name of MODULES) {
    for (const [label, dir] of COPIES) {
      it(`${name}.md exists at v1.0.0 in the ${label} copy`, () => {
        const text = readModule(dir, name);
        expect(text, `${label}: _shared/kiwi/${name}.md must exist`).not.toBe("");
        expect(
          new RegExp(`^#\\s+kiwi ${name.replace(/-/g, "[ -]")} v1\\.0\\.0`, "m").test(text),
          `${label}: ${name}.md must declare version v1.0.0 in its title`
        ).toBe(true);
      });
    }
  }

  it("the mirror copy is byte-identical to the codex source it is generated from", () => {
    for (const name of MODULES) {
      expect(
        readModule(COPIES[3][1], name),
        `${name}.md: the .agents mirror must equal skills/codex (design §9.5 regenerates it from codex)`
      ).toBe(readModule(COPIES[1][1], name));
    }
  });
});

// ===============================================================================================
// FR-FLOW-106 — verify-loop.md.
// ===============================================================================================
describe("FR-FLOW-106 — verify-loop.md carries the cross-verification engine", () => {
  for (const variant of VARIANTS) {
    describe(`${variant} variant`, () => {
      it("AC-2: carries the evidence-bundle rule, both stances and the closing paths", () => {
        const m = readVariantModule(variant, "verify-loop");
        expect(/동일한?\s*\*\*증거 번들\*\*|\*\*동일한 증거 번들\*\*/.test(m), `${variant}: identical bundle`).toBe(true);
        expect(/나눠\*\* 주는 것은 \*\*금지\*\*/.test(m), `${variant}: splitting the evidence is forbidden`).toBe(true);
        expect(/`ALL_MATCH` \/ `GAPS`/.test(m), `${variant}: verifier 1's roll-up`).toBe(true);
        expect(/`substantive_clean`/.test(m), `${variant}: verifier 2's roll-up`).toBe(true);
        expect(/`add-only`/.test(m), `${variant}: add-only cross-refutation`).toBe(true);
        expect(/기계적\s*합집합/.test(m), `${variant}: mechanical union`).toBe(true);
        expect(/두 번째 라운드부터는 검증자를 \*\*새로 spawn\*\*/.test(m), `${variant}: re-spawn from round 2`).toBe(true);
        expect(/finding 을 닫는 경로는 셋뿐이다/.test(m), `${variant}: the three closing paths`).toBe(true);
        expect(/연속 clean 스트릭에 \*\*산입하지 않는다\*\*/.test(m), `${variant}: the streak cost of reclassification`).toBe(true);
      });

      it("AC-2: a reclassified or fix-applied round cannot be the passing round", () => {
        // Mutation-driven (FR-FLOW-110 AC-4): both carriers below survived a hedge with every other
        // assertion green, so each gets its own. They are the two clauses that stop a PASS being
        // stamped on a state no verifier read.
        const m = readVariantModule(variant, "verify-loop");
        expect(
          /재분류가 일어난 라운드는 \*\*모드와 무관하게\*\* 반드시 검증 \*\*라운드를 더\*\* 돌고 나서야 PASS/.test(m),
          `${variant}: a reclassification must cost an extra round in EVERY mode, not only where a streak exists`
        ).toBe(true);
        expect(
          /수정이 있었다면 반드시 재검증 라운드가 돌게 한다/.test(m),
          `${variant}: a round in which a fix was applied must force a re-verification round`
        ).toBe(true);
      });

      it("AC-2: the fixer prohibitions are stated as prohibitions", () => {
        const routing = sectionUnder(readVariantModule(variant, "verify-loop"), /^##\s*7\./);
        expect(
          /\*\*금지\*\*: fixer 는 \*\*AC 본문\*\*을 수정하지 않는다/.test(routing),
          `${variant}: editing the AC text is the cheapest way past this loop and must be forbidden outright`
        ).toBe(true);
        expect(
          /기존 \*\*테스트를 약화하거나 삭제\*\*하지 않는다/.test(routing),
          `${variant}: weakening or deleting a test must be forbidden, not discouraged`
        ).toBe(true);
        expect(
          /`severity_class` 는 그 finding 을 제기한 검증자만 작성하며/.test(routing),
          `${variant}: severity_class must stay with the verifier that raised the finding`
        ).toBe(true);
      });

      it("AC-2: carries the termination table, the caps and the unreachable-PASS rule", () => {
        const m = readVariantModule(variant, "verify-loop");
        expect(/^\|\s*Normal\s*\|/m.test(m), `${variant}: the PASS table's Normal row`).toBe(true);
        expect(/^\|\s*`--max`\s*\|/m.test(m), `${variant}: the PASS table's --max row`).toBe(true);
        expect(/기본 \*\*5\*\*, `--max` \*\*8\*\*, `--mini` 3/.test(m), `${variant}: the three caps`).toBe(true);
        expect(
          /남은 라운드\*\*\(`cap - rounds`\)[^\n]*`fail-cap`/.test(m),
          `${variant}: the unreachable-PASS arithmetic must terminate as fail-cap`
        ).toBe(true);
        expect(/\*\*cap 소진은 PASS 가 아니다\.\*\*/.test(m), `${variant}: cap exhaustion is not a pass`).toBe(true);
      });

      it("AC-2: distinguishes pass+residual from fail-residual", () => {
        const m = readVariantModule(variant, "verify-loop");
        const line = m.split("\n").find((l) => /\*\*Normal 조기 종료\*\*/.test(l)) ?? "";
        expect(line, `${variant}: the early-exit sentence must exist`).not.toBe("");
        expect(/`pass` \+ `residual`/.test(line), `${variant}: the early exit is pass + residual`).toBe(true);
        expect(/`fail-residual`/.test(line), `${variant}: and is distinguished from fail-residual`).toBe(true);
        expect(
          /사용자 결정을 받지 않는다/.test(line),
          `${variant}: the early exit must NOT take a user decision, or unattended runs stop on every one`
        ).toBe(true);
      });

      it("AC-2: carries the delegation-only routing table with its explicit-scope requirement", () => {
        const m = readVariantModule(variant, "verify-loop");
        const routing = sectionUnder(m, /^##\s*7\./);
        expect(routing, `${variant}: the remediation section must exist`).not.toBe("");
        expect(
          /\*\*전용 fixer 를 신설하지\*\* 않는다/.test(routing),
          `${variant}: the engine must delegate rather than grow its own fixer`
        ).toBe(true);
        expect(/`--base`\/`--head` 또는 `--commits`/.test(routing), `${variant}: the explicit review scope`).toBe(true);
        expect(/`--req-filter`/.test(routing) && /`--plan-run-id`/.test(routing), `${variant}: the re-entry scope`).toBe(true);
        expect(
          /자신의 PASS 는 wave 게이트를 충족하지 않는다/.test(routing),
          `${variant}: a sub-loop's own PASS must not close a parent finding`
        ).toBe(true);
      });

      it("AC-2: carries cross-wave carry-forward decided by file-set intersection", () => {
        const carry = sectionUnder(readVariantModule(variant, "verify-loop"), /^##\s*8\./);
        expect(carry, `${variant}: the carry-forward section must exist`).not.toBe("");
        expect(/\*\*파일 집합\*\*/.test(carry) && /\*\*기계적\*\*/.test(carry), `${variant}: mechanical file-set rule`).toBe(true);
        expect(/교집합을 가지면/.test(carry), `${variant}: the intersection predicate`).toBe(true);
        expect(
          /HALT 는 교차 wave finding 에 대한 \*\*첫 대응이 아니다\*\*/.test(carry),
          `${variant}: carry-forward is tried before the halt`
        ).toBe(true);
      });

      it("AC-3: takes the frozen denominator as an input and names no denominator of its own", () => {
        const m = readVariantModule(variant, "verify-loop");
        expect(
          /본 엔진은 분모-불가지\(denominator-agnostic\)\*\* 하다/.test(m),
          `${variant}: the module must declare itself denominator-agnostic`
        ).toBe(true);
        expect(
          /고정 분모를 \*\*입력으로 받으며\*\*/.test(m),
          `${variant}: the frozen denominator must be stated as an input`
        ).toBe(true);
        expect(
          /wave 고유·lane 고유·handoff 고유의 분모를 스스로 하나도 두지 않는다/.test(m),
          `${variant}: the module must disclaim wave-, lane- and handoff-specific denominators`
        ).toBe(true);
        // The concrete four-layer denominator is the CALLER's; if the module named those layer keys
        // it would be one caller's denominator wearing a shared module's name.
        for (const layerKey of ["design_layer.expected", "constraint_layer.expected", "list_requirements"]) {
          expect(
            m.includes(layerKey),
            `${variant}: verify-loop.md must not name the wave denominator key ${layerKey}`
          ).toBe(false);
        }
      });

      it("AC-4: carries the oscillation detector as a distinct terminal outcome", () => {
        const osc = sectionUnder(readVariantModule(variant, "verify-loop"), /^##\s*6\..*oscillation/i);
        expect(osc, `${variant}: an oscillation section must exist`).not.toBe("");
        expect(/`reason_class` 를 `"oscillation"`/.test(osc), `${variant}: the reason_class value`).toBe(true);
        expect(/\*\*즉시 종료한다\*\*/.test(osc), `${variant}: it must stop immediately rather than consume the cap`).toBe(true);
        expect(/`verification-oscillation`/.test(osc), `${variant}: the raised gate id`).toBe(true);
        expect(
          /진동을 `fail-cap` 으로 기록하지 않는다/.test(osc),
          `${variant}: oscillation must be recorded distinctly from cap exhaustion`
        ).toBe(true);
      });

      it("AC-5: kiwi-wave-master references the module from its §0 table", () => {
        const zero = sectionZeroOf(variant, "kiwi-wave-master");
        expect(zero, `${variant}: kiwi-wave-master must have a §0 SSOT table`).not.toBe("");
        expect(
          /_shared\/kiwi\/verify-loop\.md` v1\.0\.0/.test(zero),
          `${variant}: §0 must name verify-loop.md at v1.0.0`
        ).toBe(true);
        expect(sharedModuleRefs(readWaveMasterRaw(variant)).includes("verify-loop"), `${variant}: resolvable ref`).toBe(true);
      });

      it("AC-5: the moved sentences no longer appear in kiwi-wave-master/SKILL.md", () => {
        const raw = readWaveMasterRaw(variant);
        // One representative sentence per moved sub-section, chosen so a partial revert is caught.
        const moved = [
          "기계적 합집합",
          "두 번째 라운드부터는 검증자를 **새로 spawn**",
          "cap 소진은 PASS 가 아니다",
          "전용 fixer 를 신설하지",
          "HALT 는 교차 wave finding 에 대한 **첫 대응이 아니다**"
        ];
        for (const sentence of moved) {
          expect(raw.includes(sentence), `${variant}: "${sentence}" must live only in verify-loop.md`).toBe(false);
        }
      });

      it("AC-5: §5.5 keeps its own denominator table rather than the engine", () => {
        const body = skillBody(readWaveMasterRaw(variant));
        const denominator = sectionUnder(body, /^###\s*5\.5\.2/);
        expect(denominator, `${variant}: §5.5.2 must remain as the caller's denominator section`).not.toBe("");
        expect(/`list_requirements`/.test(denominator), `${variant}: the REQ/AC layer's external source`).toBe(true);
        expect(/`design_layer\.expected`/.test(denominator), `${variant}: the design layer`).toBe(true);
        expect(/`constraint_layer\.expected`/.test(denominator), `${variant}: the constraint layer`).toBe(true);
        expect(
          /검증자 2 의 \*\*분모\*\*[^\n]*기계적으로 도출한다/.test(denominator) && /\*\*네 부류\*\*/.test(denominator),
          `${variant}: the preservation layer — four mechanically derived classes`
        ).toBe(true);
      });
    });
  }
});

// ===============================================================================================
// FR-FLOW-107 — wave-decomposition.md.
// ===============================================================================================
describe("FR-FLOW-107 — wave-decomposition.md carries splitting, the baseline and the gate", () => {
  for (const variant of VARIANTS) {
    describe(`${variant} variant`, () => {
      it("AC-2: carries the two-branch split heuristic with its 3-8 bound and both splitter inputs", () => {
        const m = readVariantModule(variant, "wave-decomposition");
        expect(/\*\*두 갈래 wave-split 휴리스틱\*\*/.test(m), `${variant}: the two-branch heuristic`).toBe(true);
        expect(/3~8 개의 하위 목표/.test(m), `${variant}: the 3-8 sub-goal bound`).toBe(true);
        expect(
          /\*\*기존 모듈\*\*과 그 \*\*의존\*\* 방향의 구조 요약을 함께 전달한다/.test(m),
          `${variant}: existing modules and dependency direction are splitter inputs`
        ).toBe(true);
        expect(/`existing_modules`/.test(m), `${variant}: each wave records existing_modules`).toBe(true);
      });

      it("AC-2: carries the one-normative-sentence granularity rule and integration_items", () => {
        const m = readVariantModule(variant, "wave-decomposition");
        expect(
          /최하위 헤딩 아래 규범 문장 1건 = 1 항목/.test(m),
          `${variant}: the design-item granularity rule`
        ).toBe(true);
        expect(
          /예시·근거 문장은 \*\*항목이 아니다\*\*/.test(m),
          `${variant}: coarsening the unit is what makes unmapped=0 free`
        ).toBe(true);
        expect(/`integration_items`/.test(m), `${variant}: integration items are fixed at baseline time`).toBe(true);
      });

      it("AC-2: carries the closed exclusion_class vocabulary with all five values", () => {
        const m = readVariantModule(variant, "wave-decomposition");
        for (const value of [
          "already-implemented",
          "superseded",
          "external-ownership",
          "user-excluded",
          "non-normative"
        ]) {
          expect(m.includes(value), `${variant}: exclusion_class must include ${value}`).toBe(true);
        }
        expect(/다섯 값의 \*\*closed\*\* 목록/.test(m), `${variant}: the vocabulary must be closed`).toBe(true);
      });

      it("AC-2: carries always-write-empty-constraints, append-new and carry-forward conversion", () => {
        const m = readVariantModule(variant, "wave-decomposition");
        expect(
          /\*\*제약이 없어도 빈 배열\*\* 아티팩트를 반드시 만들어/.test(m),
          `${variant}: the empty-array artifact is always written`
        ).toBe(true);
        expect(
          /앞선 아티팩트를 제자리에서 고치지 않고 새 아티팩트로 쓰고/.test(m),
          `${variant}: late constraints append a new artifact instead of editing in place`
        ).toBe(true);
        expect(
          /\*\*이월 finding 1건 = `design_items` 1 항목\*\*/.test(m),
          `${variant}: a carry-forward wave converts findings into design items`
        ).toBe(true);
        expect(
          /`waves\.jsonl` 만으로 해소한다/.test(m),
          `${variant}: the baseline artifact must be resolvable from the journal alone`
        ).toBe(true);
      });

      it("AC-3: takes the artifact root as a parameter and names both callers", () => {
        const m = readVariantModule(variant, "wave-decomposition");
        expect(
          /\*\*호출자가 인자로 전달하며 본 문서는 하드코딩하지 않는다\*\*/.test(m),
          `${variant}: the artifact root must be declared as an input parameter`
        ).toBe(true);
        const callers = sectionUnder(m, /^##\s*1\./);
        expect(/`kiwi-wave-master`/.test(callers), `${variant}: the wave-master caller must be named`).toBe(true);
        expect(/`kiwi-orchestrator`/.test(callers), `${variant}: the orchestrator caller must be named`).toBe(true);
        expect(/docs\/research\/\{work\}\//.test(callers), `${variant}: the orchestrator's root`).toBe(true);
        // Outside the caller table, no hard-coded root may remain: `{artifact_root}` is the only
        // form the rules may use, or one caller's directory is baked into the shared contract.
        const rules = m.replace(callers, "");
        expect(
          /docs\/analysis\/kiwi-wave-master-\{run_id\}\//.test(rules),
          `${variant}: no rule may hard-code the wave-master artifact root`
        ).toBe(false);
        expect(/\{artifact_root\}design-baseline\.json/.test(rules), `${variant}: the map path is parameterised`).toBe(true);
        expect(/\{artifact_root\}design-baseline\/wave-\{n\}\.md/.test(rules), `${variant}: the excerpt path is parameterised`).toBe(true);
      });

      it("AC-4: the coverage gate compares the full design_items set and requires consent", () => {
        const gate = sectionUnder(readVariantModule(variant, "wave-decomposition"), /^##\s*4\./);
        expect(gate, `${variant}: the coverage-gate section must exist`).not.toBe("");
        expect(
          /\*\*대조 단위\*\*는 최상위 섹션 \*\*한 겹이 아니라\*\*[^\n]*`design_items` \*\*전량\*\*/.test(gate),
          `${variant}: the comparison unit must be the full design_items set, not a top-level sample`
        ).toBe(true);
        expect(
          /`out_of_scope` 에 항목이 하나라도 있으면[^\n]*\*\*`--auto` 라도 중단\*\*/.test(gate),
          `${variant}: any non-empty out_of_scope set must take user consent even under --auto`
        ).toBe(true);
      });

      it("AC-5: kiwi-wave-master references the module and no longer inlines the splitter", () => {
        const zero = sectionZeroOf(variant, "kiwi-wave-master");
        expect(
          /_shared\/kiwi\/wave-decomposition\.md` v1\.0\.0/.test(zero),
          `${variant}: §0 must name wave-decomposition.md at v1.0.0`
        ).toBe(true);
        const raw = readWaveMasterRaw(variant);
        for (const sentence of [
          "두 갈래 wave-split 휴리스틱",
          "최하위 헤딩 아래 규범 문장 1건 = 1 항목",
          "다섯 값의 **closed** 목록",
          "미배정 섹션을 **전량** 보고한다"
        ]) {
          expect(raw.includes(sentence), `${variant}: "${sentence}" must live only in wave-decomposition.md`).toBe(false);
        }
        // The skill still supplies the argument the module refuses to hard-code.
        expect(
          /docs\/analysis\/kiwi-wave-master-\{run_id\}\//.test(raw),
          `${variant}: the skill must still pass its own artifact root`
        ).toBe(true);
      });
    });
  }
});

// ===============================================================================================
// FR-FLOW-108 — wave-srs-registration.md.
// ===============================================================================================
describe("FR-FLOW-108 — wave-srs-registration.md carries the registration contract", () => {
  for (const variant of VARIANTS) {
    describe(`${variant} variant`, () => {
      it("AC-2: carries the excerpt, the constraints path, existing_modules and full residual collection", () => {
        const m = readVariantModule(variant, "wave-srs-registration");
        expect(/`--research-doc`/.test(m) && /`excerpt_path`/.test(m), `${variant}: the excerpt is the research doc`).toBe(true);
        expect(/`--constraints-doc`/.test(m) && /`constraints_path`/.test(m), `${variant}: the constraints doc`).toBe(true);
        expect(
          /`existing_modules` 도 같은 호출의 \*\*저작 입력\*\*/.test(m),
          `${variant}: existing_modules must be an authoring input, not a verifier-only list`
        ).toBe(true);
        expect(
          /`carried_into` 가 이 wave 인 residual 을 \*\*전량\*\* 수집/.test(m),
          `${variant}: carried residuals must be collected in full`
        ).toBe(true);
      });

      it("AC-2: carries the srs_authored marker together with its unmarked-line clause", () => {
        const m = readVariantModule(variant, "wave-srs-registration");
        const rule = m.split("\n").find((l) => /`srs_authored` = `true`/.test(l)) ?? "";
        expect(rule, `${variant}: the idempotency rule must exist`).not.toBe("");
        expect(/\*\*하나라도\*\*/.test(rule), `${variant}: any marked event suppresses re-authoring`).toBe(true);
        expect(
          /\*\*표식 없는 줄\*\*은 `srs-authoring` 줄만 저작 진행 중으로 읽는다/.test(rule),
          `${variant}: only unmarked srs-authoring lines read as in-progress`
        ).toBe(true);
        expect(
          /최신 줄 하나로 판정하면/.test(rule),
          `${variant}: the companion clause must name the latest-line reading it rejects`
        ).toBe(true);
      });

      it("AC-3: kiwi-wave-master references the module from its §0 table", () => {
        const zero = sectionZeroOf(variant, "kiwi-wave-master");
        expect(
          /_shared\/kiwi\/wave-srs-registration\.md` v1\.0\.0/.test(zero),
          `${variant}: §0 must name wave-srs-registration.md at v1.0.0`
        ).toBe(true);
      });

      it("AC-3: kiwi-wave-master does not restate the registration contract in its body", () => {
        // Below §0: the SSOT table legitimately names what each module covers, and asserting over it
        // would forbid the reference row the same AC requires.
        const body = skillBody(readWaveMasterRaw(variant));
        const raw = body.slice(body.indexOf("\n## 1."));
        for (const sentence of [
          "`--research-doc`",
          "`--constraints-doc`",
          "`srs_authored` = `true`",
          "리서치 검증·개선 루프가 작동하지 않는다"
        ]) {
          expect(raw.includes(sentence), `${variant}: "${sentence}" must live only in the shared module`).toBe(false);
        }
      });

      it("AC-4: §4's own target registration stays in the skill", () => {
        const body = skillBody(readWaveMasterRaw(variant));
        const four = sectionUnder(body, /^##\s*4\./);
        expect(four, `${variant}: §4 must still exist`).not.toBe("");
        expect(/wave-\{n\}/.test(four), `${variant}: the per-wave target naming stays`).toBe(true);
        expect(
          /미등록 wave target 을 생성 옵션과 함께 등록하는 것은 이 단계의 \*\*정상 경로\*\*/.test(four),
          `${variant}: the create-on-registration rule stays in the skill`
        ).toBe(true);
        expect(/wave-srs-registration\.md/.test(four), `${variant}: §4 must point at the shared contract`).toBe(true);
      });
    });
  }
});

// ===============================================================================================
// FR-FLOW-109 — run-ledger.md.
// ===============================================================================================
const RECOVERY_CLASSES = ["pure-reauthor", "idempotent-by-key", "externally-visible"] as const;

/** Verb-enum rows of run-ledger.md §3: `| \`verb\` | class | rule |`. */
function verbRows(moduleText: string): { verb: string; cls: string; row: string }[] {
  const section = sectionUnder(moduleText, /^##\s*3\./);
  const out: { verb: string; cls: string; row: string }[] = [];
  for (const line of section.split("\n")) {
    const m = line.match(/^\|\s*`([a-z][a-z0-9-]*)`\s*\|\s*([^|]*)\|/);
    if (m) out.push({ verb: m[1], cls: m[2].trim(), row: line });
  }
  return out;
}

describe("FR-FLOW-109 — run-ledger.md carries the ledger and the three reassigned clauses", () => {
  for (const variant of VARIANTS) {
    describe(`${variant} variant`, () => {
      it("AC-2: carries the resume-card schema and its 8 KB cap", () => {
        const m = readVariantModule(variant, "run-ledger");
        expect(/resume-card\.json/.test(m), `${variant}: the card path`).toBe(true);
        expect(
          /\*\*하드 상한 8 KB 이고 이 상한은 기록자가 강제한다\*\*/.test(m),
          `${variant}: the cap must be stated as writer-enforced`
        ).toBe(true);
        expect(/rollup 규칙/.test(m), `${variant}: the rollup rule that makes the cap reachable`).toBe(true);
        for (const field of ["schema_version", "next_action", "frozen", "done", "open", "invariant_digest"]) {
          expect(m.includes(`"${field}"`), `${variant}: the card schema must carry ${field}`).toBe(true);
        }
        for (const pre of [
          "P-DESIGN-FROZEN",
          "P-LANE-PLAN-FROZEN",
          "P-HANDOFF-VERIFIED",
          "P-WAVE-ISSUES-CLOSED",
          "P-PRIOR-STAGES-INTEGRATED"
        ]) {
          expect(m.includes(pre), `${variant}: the precondition vocabulary must include ${pre}`).toBe(true);
        }
      });

      it("AC-2: carries the proof-kind table, the reconciliation predicate and the drift digests", () => {
        const m = readVariantModule(variant, "run-ledger");
        for (const kind of ["git-ancestor", "git-ref", "git-trailer", "digest", "mcp-state", "fs-exists", "journal"]) {
          expect(m.includes(`\`${kind}\``), `${variant}: proof kind ${kind}`).toBe(true);
        }
        expect(
          /`journal` 은 verdict 를 담은 줄의 \*유일한\* proof 가 될 수 없다/.test(m),
          `${variant}: a journal-only verdict has no witness and must be refused`
        ).toBe(true);
        expect(/`card-stale`/.test(m) && /`ledger-reconciliation-divergent`/.test(m), `${variant}: reconciliation outcomes`).toBe(true);
        const digests = sectionUnder(m, /^##\s*6\./);
        expect(digests, `${variant}: the drift-digest section must exist`).not.toBe("");
        expect(/^\d\./m.test(digests), `${variant}: the digests must be enumerated`).toBe(true);
        expect(digests.split("\n").filter((l) => /^\d\. /.test(l)).length, `${variant}: exactly four digests`).toBe(4);
        expect(/`run-invariant-drift`/.test(digests) && /`lane-plan-drift`/.test(digests), `${variant}: both drift classes`).toBe(true);
      });

      it("AC-2: carries the run-contract preamble convention as a closed list", () => {
        const preamble = sectionUnder(readVariantModule(variant, "run-ledger"), /^##\s*7\./);
        expect(preamble, `${variant}: the run-contract section must exist`).not.toBe("");
        expect(/00\.run-contract\.md/.test(preamble), `${variant}: the file it names`).toBe(true);
        expect(/\*\*닫힌 목록\*\*/.test(preamble), `${variant}: the contents are a closed list`).toBe(true);
        expect(/`intake_autonomy`/.test(preamble), `${variant}: the intake-autonomy block`).toBe(true);
        expect(/불변 wave 순서/.test(preamble), `${variant}: the immutable wave order`).toBe(true);
        expect(/재개 명령/.test(preamble), `${variant}: the exact resume command`).toBe(true);
      });

      it("AC-3: the verb enum is closed and every verb declares exactly one recovery class", () => {
        const m = readVariantModule(variant, "run-ledger");
        expect(/\*\*닫힌 enum\*\*/.test(m), `${variant}: the enum must be declared closed`).toBe(true);
        const rows = verbRows(m);
        expect(rows.length, `${variant}: the verb table must be populated`).toBeGreaterThan(20);
        for (const { verb, cls } of rows) {
          const hits = RECOVERY_CLASSES.filter((c) => cls.includes(c));
          expect(hits.length, `${variant}: verb ${verb} must declare exactly one recovery class, got "${cls}"`).toBe(1);
        }
        // The class vocabulary is itself closed and its members are stated where a schema author can
        // copy them, which is the gap the design records revision 1 leaving open.
        for (const c of RECOVERY_CLASSES) {
          expect(
            new RegExp(`\`recovery_class\`[^\\n]*${c}|${c}[^\\n]*\`recovery_class\``).test(m) || m.includes(`\`${c}\``),
            `${variant}: the recovery_class member ${c} must be declared`
          ).toBe(true);
        }
      });

      it("AC-3: an out-of-enum verb is a hard stop on resume", () => {
        const m = readVariantModule(variant, "run-ledger");
        const line = m.split("\n").find((l) => /enum 밖의 verb/.test(l)) ?? "";
        expect(line, `${variant}: the out-of-enum rule must exist`).not.toBe("");
        expect(/하드 스톱|hard stop/i.test(line), `${variant}: it must be a hard stop, not a warning`).toBe(true);
      });

      it("AC-3: the phase-1 enum uses execute-unit and excludes the phase-2 lane verbs", () => {
        const verbs = verbRows(readVariantModule(variant, "run-ledger")).map((r) => r.verb);
        expect(verbs.includes("execute-unit"), `${variant}: execute-unit is phase 1's execution verb`).toBe(true);
        for (const deferred of [
          "dispatch-lane",
          "collect-lane",
          "verify-lane",
          "remediate-lane",
          "release-lane",
          "integrate-lane",
          "probe-isolation",
          "run-serial-epilogue",
          "replay-deferred-mutations"
        ]) {
          expect(verbs.includes(deferred), `${variant}: ${deferred} is phase 2 and must not be in the phase-1 enum`).toBe(false);
        }
      });

      it("AC-3: commits are identified by trailer, because a phase marker in a title is banned", () => {
        // Mutation-driven (FR-FLOW-110 AC-4): this carrier survived a hedge. It is the sentence that
        // stops the recovery mechanism being bought by breaking a standing commit-message rule.
        const m = readVariantModule(variant, "run-ledger");
        expect(
          /커밋 식별은 제목 텍스트가 아니라 git trailer 로 한다/.test(m),
          `${variant}: commit identification must be by trailer, not by subject text`
        ).toBe(true);
        expect(
          /커밋 \*\*제목\*\*에 단계 표식을 넣는 것이 금지되어 있고/.test(m),
          `${variant}: the reason — a phase marker in a commit title is banned — must be stated`
        ).toBe(true);
        expect(/Orch-Verb/.test(m) && /Orch-Run/.test(m), `${variant}: the trailer tuple`).toBe(true);
      });

      it("AC-2: the run contract's forbidden-action list is closed and carries its two hardest rules", () => {
        // Mutation-driven (FR-FLOW-110 AC-4): two carriers here survived — the list's closedness and
        // the git-add-all ban, which is the one rule a resumed session is most likely to break.
        const preamble = sectionUnder(readVariantModule(variant, "run-ledger"), /^##\s*7\./);
        expect(
          /\*\*금지 동작의 닫힌 목록\*\*/.test(preamble),
          `${variant}: the forbidden-action list must be closed, or a resumed session negotiates it`
        ).toBe(true);
        expect(
          /`git add -A` 나 `git commit -a` 를 절대 실행하지 않는다/.test(preamble),
          `${variant}: staging everything is how an orchestrator-only path gets committed by accident`
        ).toBe(true);
        expect(
          /살아 있을 수 있는 lane 을 다시 dispatch 하지 않는다/.test(preamble),
          `${variant}: the never-re-dispatch rule must be in the contract a resumed session reads`
        ).toBe(true);
      });

      it("AC-4: the write discipline is one intent before and one result after, with its invariant", () => {
        const write = sectionUnder(readVariantModule(variant, "run-ledger"), /^##\s*2\./);
        expect(write, `${variant}: the write-discipline section must exist`).not.toBe("");
        expect(
          /\*\*동작 앞에 의도\(intent\) 1줄, 동작 뒤에 결과\(result\) 1줄\*\*/.test(write),
          `${variant}: the discipline must be stated as one line before and one line after`
        ).toBe(true);
        expect(
          /`\(verb, wave, lane\)` 키마다 마지막 줄은 `result` 여야 한다/.test(write),
          `${variant}: the last-line-per-key invariant`
        ).toBe(true);
        expect(
          /짝 없는 `intent` 는 그 verb 가 중단되었다는 뜻이다/.test(write),
          `${variant}: an unmatched intent means the verb was interrupted`
        ).toBe(true);
      });

      it("AC-5: carries the recipe.kind enum with its lane-eligibility rule", () => {
        const registry = sectionUnder(readVariantModule(variant, "run-ledger"), /^##\s*8\./);
        expect(registry, `${variant}: the convergence-registry section must exist`).not.toBe("");
        expect(/\*\*닫힌 네 값 recipe enum\*\*/.test(registry), `${variant}: the four-value enum`).toBe(true);
        expect(/\*\*lane 적격\*\*/.test(registry), `${variant}: exclusive-lane is lane-eligible`).toBe(true);
        for (const kind of ["orchestrator-only", "regenerate", "replay"]) {
          expect(
            new RegExp(`\`${kind}\`\\s*\\|\\s*\\*\\*lane 부적격\\*\\*`).test(registry),
            `${variant}: ${kind} must be lane-ineligible`
          ).toBe(true);
        }
        expect(
          /\*\*`orchestrator-only` > `replay` > `regenerate` > `exclusive-lane`\*\*/.test(registry),
          `${variant}: the most-restrictive-wins precedence order`
        ).toBe(true);
      });

      it("AC-5: carries the normative shipped default with CP-01, CP-02 and CP-07", () => {
        const shipped = sectionUnder(readVariantModule(variant, "run-ledger"), /^##\s*9\./);
        expect(shipped, `${variant}: the shipped-default section must exist`).not.toBe("");
        for (const cp of ["CP-01", "CP-02", "CP-07"]) {
          expect(shipped.includes(cp), `${variant}: the shipped default must carry ${cp}`).toBe(true);
        }
        expect(/"kind": "regenerate"/.test(shipped) && /"command": "mcp:sync_index"/.test(shipped), `${variant}: CP-01's recipe`).toBe(true);
        expect(
          /`kiwi\/waves\.jsonl` 은 `CP-07` 에서 \*\*제외한다\*\*/.test(shipped),
          `${variant}: waves.jsonl is untracked by policy and cannot match a tree`
        ).toBe(true);
        // Speckiwi-only points are examples, not shipped defaults; shipping them would give every
        // consumer this repository's paths.
        for (const cp of ["CP-03", "CP-04", "CP-05", "CP-06"]) {
          expect(shipped.includes(cp), `${variant}: ${cp} is repository-specific and must not ship`).toBe(false);
        }
      });

      it("AC-5: carries never-merge-to-base with the mandatory post-merge validate then sync-index", () => {
        const merge = sectionUnder(readVariantModule(variant, "run-ledger"), /^##\s*10\./);
        expect(merge, `${variant}: the never-merge section must exist`).not.toBe("");
        expect(
          /base 브랜치에 병합하지 않고 PR 도 열지 않는다/.test(merge),
          `${variant}: the orchestrator must never merge to base and never open a PR`
        ).toBe(true);
        expect(
          /`validate` 를 실행한 뒤 `sync-index` 를 실행해야 한다/.test(merge),
          `${variant}: the post-merge sequence`
        ).toBe(true);
        expect(
          /순서는 `validate` → `sync-index` 이며 바꾸지 않는다/.test(merge),
          `${variant}: the order is fixed`
        ).toBe(true);
        expect(/\*\*의무\*\*다/.test(merge), `${variant}: mandatory rather than advisory`).toBe(true);
      });

      it("AC-5: the merge-time recipe meaning table is NOT among the reassigned clauses", () => {
        const m = readVariantModule(variant, "run-ledger");
        // §5.2 already carries the phase-1 per-kind effect; importing merge semantics here would
        // create a second, divergent table for the same enum.
        expect(
          /병합 시점[^\n]*의미 표|merge-time[^\n]*meaning table/i.test(m),
          `${variant}: run-ledger.md must not restate the merge-time recipe meaning table`
        ).toBe(false);
        expect(
          /restore-and-CAS|복원[^\n]*CAS/i.test(m),
          `${variant}: integrate()'s restore-and-CAS mechanism is phase-2 content`
        ).toBe(false);
      });
    });
  }
});

// ===============================================================================================
// FR-FLOW-110 — the harness that makes the move safe.
// ===============================================================================================
describe("FR-FLOW-110 — the resolved-skill reader", () => {
  it("AC-1: resolves the modules a skill's §0 table names, in table order", () => {
    for (const variant of VARIANTS) {
      const refs = sharedModuleRefs(readWaveMasterRaw(variant));
      expect(refs, `${variant}: §0 must reference the three extracted modules plus the pre-existing ones`).toEqual([
        "waves-event",
        "loop-option",
        "auto-option",
        "wave-decomposition",
        "verify-loop",
        "wave-srs-registration",
        // @req FR-FLOW-122 — the worktree-lane contract is declared last, in §0.12.
        "worktree-lane"
      ]);
    }
  });

  it("AC-1: the resolved body is strictly longer than the SKILL.md alone", () => {
    for (const variant of VARIANTS) {
      const raw = readWaveMasterRaw(variant);
      const resolved = readResolvedSkill(variant, "kiwi-wave-master");
      expect(resolved.startsWith(raw), `${variant}: the skill body must come first`).toBe(true);
      expect(
        resolved.length - raw.length,
        `${variant}: the resolver must actually append module bodies`
      ).toBeGreaterThan(10_000);
    }
  });

  it("AC-2: concatenation appends rather than prepends", () => {
    for (const variant of VARIANTS) {
      const resolved = readResolvedSkill(variant, "kiwi-wave-master");
      const firstOwnHeading = resolved.split("\n").findIndex((l) => /^#\s+kiwi-wave-master/.test(l));
      const firstModuleHeading = resolved.split("\n").findIndex((l) => /^#{1,6}\s+\[[a-z-]+\.md\]\s/.test(l));
      expect(firstOwnHeading, `${variant}: the skill's own title must be present`).toBeGreaterThan(-1);
      expect(
        firstOwnHeading < firstModuleHeading,
        `${variant}: prepending would let auto-option.md's "## 5. critical_gates[]" win the gate lookup`
      ).toBe(true);
    }
  });

  it("AC-2: every appended module heading is prefixed with its module name", () => {
    for (const variant of VARIANTS) {
      const resolved = readResolvedSkill(variant, "kiwi-wave-master");
      const region = moduleRegion(resolved, "verify-loop");
      expect(region, `${variant}: the verify-loop region must be resolvable`).not.toBe("");
      const headings = region.split("\n").filter((l) => /^#{1,6}\s/.test(l));
      expect(headings.length, `${variant}: the module must contribute headings`).toBeGreaterThan(4);
      for (const h of headings) {
        expect(
          /^#{1,6}\s+\[verify-loop\.md\]\s/.test(h),
          `${variant}: appended heading "${h}" must carry its module-name prefix`
        ).toBe(true);
      }
    }
  });

  it("AC-2: a heading inside a fenced code block is not treated as a heading", () => {
    const input = ["## real", "", "```", "# not a heading", "```", "", "### also real"].join("\n");
    const out = prefixHeadings(input, "demo");
    expect(out).toContain("## [demo.md] real");
    expect(out).toContain("### [demo.md] also real");
    expect(out).toContain("# not a heading");
    expect(out).not.toContain("# [demo.md] not a heading");
  });

  it("AC-5: every §0 version pin names the version the shared contract actually declares", () => {
    // R3-M1 pins waves-event by literal, which is how the pin went stale when FR-FLOW-104 shipped
    // v1.4.0 — the skill kept citing v1.3.0 and no test saw it. This derives the expected version
    // from the contract file, so the next bump fails here rather than silently diverging.
    for (const variant of VARIANTS) {
      const zero = sectionZeroOf(variant, "kiwi-wave-master");
      for (const name of ["waves-event", "verify-loop", "wave-decomposition", "wave-srs-registration"]) {
        const contract = readVariantModule(variant, name);
        const declared = (contract.match(/^#\s+.*?\bv?(\d+\.\d+\.\d+)\s*$/m) ?? [])[1];
        expect(declared, `${variant}: ${name}.md must declare a version in its title`).toBeTruthy();
        const row = zero.split("\n").find((l) => l.includes(`_shared/kiwi/${name}.md`)) ?? "";
        expect(row, `${variant}: §0 must carry a row for ${name}.md`).not.toBe("");
        expect(
          row.includes(`v${declared}`),
          `${variant}: §0 pins ${name}.md at a version other than the v${declared} the contract declares`
        ).toBe(true);
      }
    }
  });

  it("AC-5: the §0 reference line exists in all three variants, at v1.0.0, for all three modules", () => {
    for (const variant of VARIANTS) {
      const zero = sectionZeroOf(variant, "kiwi-wave-master");
      for (const name of ["wave-decomposition", "verify-loop", "wave-srs-registration"]) {
        const row = zero.split("\n").find((l) => l.includes(`_shared/kiwi/${name}.md`)) ?? "";
        expect(row, `${variant}: §0 must carry a row for ${name}.md`).not.toBe("");
        expect(/v1\.0\.0/.test(row), `${variant}: the ${name}.md row must pin v1.0.0`).toBe(true);
        expect(/^\|\s*§0\.\d+\s*\|/.test(row), `${variant}: the ${name}.md reference must be a §0 table row`).toBe(true);
      }
    }
  });
});
