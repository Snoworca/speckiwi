import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readResolvedSkill, stripFrontmatter } from "../support/resolved-skill.js";

// @req FR-FLOW-119 — `--drive`: run every wave unattended, repair what is safely repairable, and
// refuse, by name, the gates whose automation would lower the goal rather than reach it.
//
// A SKILL.md is agent instruction rather than executable code, so this is a text harness, and three
// independent mutation passes shaped it. Round 1 asserted that the required vocabulary was PRESENT:
// 10 of 19 mutations survived, because every inversion keeps the tokens — the refusal list could be
// relabelled 허용 목록, the conjunction rewritten as a disjunction, `abort_gate` instructed to be left
// EMPTY. Round 2 pinned §7.5's sentences verbatim and closed all of those, but 5 survived at the
// perimeter, where the assertions were still token searches: kiwi-pipeline and kiwi-pm could each say
// they do NOT forward the flag, and kiwi-coder could say it opens no gates — the route broken at its
// endpoint with the suite green. Round 3 pinned the perimeter too and closed those, then broke the
// pins themselves in ways recorded below.
//
// What this harness does and does not buy, stated plainly because the next reader will otherwise
// assume more:
//   - Deletion, inversion, rewording and paragraph-collapse of every normative claim: CAUGHT.
//   - Text that exists but is not the live rule: caught inside kiwi-wave-master, where fences are
//     masked, and NOT caught in the other skills. Masking cannot be applied there: kiwi-pm,
//     kiwi-pipeline, kiwi-coder and kiwi-orchestrator all carry normative prose inside fenced
//     prompt-template blocks — kiwi-pm's own pass-through rule lives at line 486 inside the fence
//     that opens at 455 — so blanking fences would delete real rules rather than hiding places.
//     A pinned perimeter sentence relocated into a fence labelled `폐기된 초안` therefore still passes.
//   - A sentence kept verbatim and revoked by the NEXT sentence: caught only if the revocation uses
//     a phrase in `FORBIDDEN.revocation`, which samples the space rather than covering it.
//   - Whether a `--drive` run actually reaches the last wave: NOT carried here at all. That is
//     execution, and no text assertion can stand in for it.
//
// @req FR-FLOW-119 AC-10

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const VARIANTS = ["claude", "codex", "etc"] as const;

const REFUSED_GATES = [
  "external-module-impact",
  "existing-test-weakened-or-deleted",
  "existing-public-contract-change",
  "existing-file-deleted-or-moved",
  "mock-detection",
  "tdd-bypass-attempt",
  "out-of-scope-user-consent",
  "unsafe-option-refused",
  "wave-append-cap-exhausted"
] as const;

const RESIDUAL_GATES = [
  "wave-verify-residual-critical",
  "final-verify-residual-critical",
  "wave-verify-fail-residual"
] as const;

/** §7.5's normative sentences, verbatim. Each IS its criterion rather than a paraphrase of it. */
const PINS = {
  implication:
    "`--drive` 는 `--auto` · `--auto-integration` · `--auto-cost-warning` 셋을 함께 켠다 — 세 플래그를 따로 적을 필요가 없다.",
  conjunction:
    "자가 복구는 아래 네 조건을 **모두** 만족할 때만 승인된다. 하나라도 어긋나면 고치지 않고 **중단**한다 — 넷은 선언이 아니라 연언이다.",
  conditions: [
    "**되돌릴 수 있을 것 (reversible)** — git 이 추적하는 변경이고 되돌리기가 가능하다.",
    "**run root 안일 것** — §2.1 이 pin 한 실행 루트 바깥은 손대지 않는다.",
    "**기존 공개 계약과 기존 테스트를 바꾸지 않을 것** — 기존 시그니처·기존 테스트·기존 단언은 그대로 둔다.",
    "**진단이 독립적으로 재현됐을 것 (independent)** — 원인이 본 실행과 무관한 별도 검사로 재현되어야 한다. 추정으로 고치지 않는다."
  ],
  refusalPolarity: "아래 게이트는 `--drive` 로도 열리지 않는다. 위원회가 어떤 confidence 를 보고하든 마찬가지다.",
  residualPolarity: "은 `--drive` 에서도 중단이다.",
  abortGate: "그 게이트의 id 를 `waves.jsonl` 의 `abort_gate` 필드에 **지명**한다.",
  childBubble: "`child-pipeline-needs-user-or-failed` 로 버블업해 적는다.",
  decisionRow: "자동으로 해소한 게이트는 그 게이트를 지명하는 `decision` 객체를 1건 기록한다"
} as const;

/** The same discipline outside §7.5, where a criterion's claim lives in another skill's file. */
const PERIMETER = {
  /** The origin hop. Round 3 found this one still unpinned while all three downstream hops were. */
  waveRow: "| `--drive` | 무인 완주 모드 전체 — 자식 게이트 3종을 함께 연다 | kiwi-wave-master → kiwi-pipeline → kiwi-pm → kiwi-coder |",
  /** kiwi-coder is the route's endpoint; this sentence is the whole of AC-5's load-bearing half. */
  coder:
    "`--drive` 가 `--auto-integration` 과 `--auto-cost-warning` 을 함께 켠 것으로 본다 — `integration-test-user-consent` 와 `cost-warning-large-task` 두 게이트는 열린다.",
  pipelineRow: "| `--drive` | 부모 `kiwi-wave-master` 의 무인 완주 모드 (FR-FLOW-119) | kiwi-pipeline → `kiwi-pm` → `kiwi-coder` |",
  pmRow: '| "무인 완주" (부모 전달) | `--drive` | off — 명시 입력만 kiwi-coder 로 pass-through (§3.2, FR-FLOW-119) |',
  pmProse: "`--auto-cost-warning` / `--auto-integration` / `--drive` 는 자식 args 에 그대로 전달한다",
  /** Not inherited. The inversion is a skill claiming it opens gates its own table never declares. */
  orchestrator: "`--drive` (FR-FLOW-119) 는 **상속하지 않는다**",
  wavesEvent: "`--drive` 가 자동으로 해소한 게이트마다 1건 (FR-FLOW-119).",
  /** auto-option.md ships Korean in the claude tree and English in the others. */
  autoOptionKo: "사용자는 여전히 명시 입력을 준 것이므로 본 금지에 걸리지 않는다.",
  autoOptionEn: "is still explicit user input, so the rule below does not bar it."
} as const;

/**
 * Phrases that must NOT appear, because each re-opens by addition what a pinned sentence closes by
 * rule — the one attack pinning cannot see. These are a sample of the space, not a cover of it: a
 * revocation phrased outside this list passes, and that residual is recorded in the header.
 */
const FORBIDDEN = {
  refusal: /예외적으로|열 수 있다|허용 목록|자동으로 여는/,
  conditions: /가능하면|어려우면|해도 된다|권장한다/,
  /** Keeps the pinned sentence and cancels it: "위 문장은 이전 동작", "강제되지 않는다", "참고 사항". */
  revocation: /강제되지 않는다|참고 사항|이전 동작|적용하지 않는다|실제 규칙(이)? 아님|폐기/
} as const;

/**
 * Fenced-code content blanked, line count preserved.
 *
 * Round 3's most general bypass: a pinned sentence kept verbatim inside a fence labelled
 * `폐기된 초안 (참고용, 실제 규칙 아님)` satisfies every `toContain` while the document says it is not
 * the rule. Masking removes that hiding place — but only where fences hold no rules.
 *
 * Applied to kiwi-wave-master alone, and that scope is measured rather than assumed: it carries two
 * fence markers in the whole file and none inside §7.5, while kiwi-pm (24), kiwi-coder (28),
 * kiwi-pipeline (22) and kiwi-orchestrator (22) embed the prompt templates they send to children —
 * normative text — inside fences. Masking those would fail on correct documents.
 */
function maskFences(text: string): string {
  let inFence = false;
  return text
    .split("\n")
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) {
        inFence = !inFence;
        return "";
      }
      return inFence ? "" : line;
    })
    .join("\n");
}

/** kiwi-wave-master only, fences masked — see {@link maskFences} for why the scope stops there. */
function resolvedProse(variant: string, skill: string): string {
  return maskFences(stripFrontmatter(readResolvedSkill(variant, skill)));
}

function rawSkill(variant: string, skill: string): string {
  try {
    return readFileSync(path.join(REPO_ROOT, "skills", variant, skill, "SKILL.md"), "utf8");
  } catch {
    return "";
  }
}

/** Perimeter skills, fences intact: their prompt-template blocks carry rules, not decoration. */
function skillProse(variant: string, skill: string): string {
  return stripFrontmatter(rawSkill(variant, skill));
}

/** kiwi-wave-master's own body, masked on the same grounds as {@link resolvedProse}. */
function waveProse(variant: string): string {
  return maskFences(stripFrontmatter(rawSkill(variant, "kiwi-wave-master")));
}

function sharedProse(variant: string, name: string): string {
  try {
    return readFileSync(path.join(REPO_ROOT, "skills", variant, "_shared", "kiwi", name), "utf8");
  } catch {
    return "";
  }
}

/**
 * A numbered section, located by its number rather than by any word in its title — renaming the
 * `### 7.5` heading used to re-anchor every section-bound assertion onto `#### 7.5.1`.
 */
function section(body: string, number: string): string {
  const level = number.split(".").length + 1;
  const open = new RegExp(`^#{${level}}\\s+${number.replace(/\./g, "\\.")}\\s`);
  const lines = body.split("\n");
  const start = lines.findIndex((line) => open.test(line));
  if (start === -1) return "";
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    const heading = /^(#{1,6})\s/.exec(lines[i] ?? "");
    if (heading && heading[1].length <= level) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

/** The self-repair conditions block: §7.5 with its subsections removed. */
function conditionsBlock(body: string): string {
  const whole = section(body, "7.5");
  const firstSub = whole.indexOf("\n#### ");
  return firstSub === -1 ? whole : whole.slice(0, firstSub);
}

describe("FR-FLOW-119 — --drive autonomous wave mode", () => {
  describe.each(VARIANTS)("%s variant", (variant) => {
    it("AC-1: pins the sentence that turns the three child flags on", () => {
      const drive = section(resolvedProse(variant, "kiwi-wave-master"), "7.5");
      expect(drive, "no §7.5 section").not.toBe("");
      expect(drive).toContain("--drive");
      expect(drive, "§7.5's implication sentence does not match the pinned text byte for byte").toContain(PINS.implication);
    });

    it("AC-2: pins the conjunction and four conditions as four distinct numbered items", () => {
      const block = conditionsBlock(resolvedProse(variant, "kiwi-wave-master"));
      expect(block, "no §7.5 conditions block").not.toBe("");
      expect(block, "the conjunction sentence does not match the pinned text").toContain(PINS.conjunction);

      const lines = block.split("\n");
      const carriers = PINS.conditions.map((condition) => ({
        condition,
        index: lines.findIndex((line) => line.includes(condition))
      }));
      for (const { condition, index } of carriers) {
        expect(index, `missing or reworded condition: ${condition.slice(0, 24)}`).toBeGreaterThanOrEqual(0);
        expect(lines[index], `condition is not a numbered item: ${condition.slice(0, 24)}`).toMatch(/^\d+\.\s/);
      }
      // Four carrier lines, not one line carrying four: `1. ` in front of a single run-on item
      // satisfies the per-line check while destroying the enumeration it is there to assert.
      expect(new Set(carriers.map((c) => c.index)).size, "the four conditions share a line").toBe(4);

      expect(block, "a hedge downgrades a self-repair condition").not.toMatch(FORBIDDEN.conditions);
      expect(block, "a following clause revokes the conditions").not.toMatch(FORBIDDEN.revocation);
    });

    it("AC-3: pins the refusal polarity, names every refused gate, and admits no exception", () => {
      const refusal = section(resolvedProse(variant, "kiwi-wave-master"), "7.5.1");
      expect(refusal, "no §7.5.1 section").not.toBe("");
      expect(refusal, "the refusal polarity sentence does not match the pinned text").toContain(PINS.refusalPolarity);
      for (const gate of REFUSED_GATES) {
        expect(refusal, `refusal list omits ${gate}`).toContain(gate);
      }
      expect(refusal, "an exception clause re-opens the closed list").not.toMatch(FORBIDDEN.refusal);
      expect(refusal, "a following clause revokes the closed list").not.toMatch(FORBIDDEN.revocation);
    });

    it("AC-4: pins the residual gates as closed", () => {
      const residual = section(resolvedProse(variant, "kiwi-wave-master"), "7.5.2");
      expect(residual, "no §7.5.2 section").not.toBe("");
      expect(residual, "the residual-gate sentence does not match the pinned text").toContain(PINS.residualPolarity);
      for (const gate of RESIDUAL_GATES) {
        expect(residual, `residual gate not declared closed: ${gate}`).toContain(gate);
      }
      expect(residual, "residual gates declared open").not.toMatch(FORBIDDEN.refusal);
      expect(residual, "a following clause revokes the residual rule").not.toMatch(FORBIDDEN.revocation);
    });

    it("AC-5: routes --drive from its origin row to a destination that recognises it", () => {
      // Every hop pinned, origin included. Round 3 flipped the origin row to "전파하지 않는다" while
      // the three downstream pins held, and the route was dead with the suite green.
      expect(waveProse(variant), "the origin pass-through row does not match the pinned text").toContain(
        PERIMETER.waveRow
      );
      expect(skillProse(variant, "kiwi-pipeline"), "kiwi-pipeline's row does not match the pinned text").toContain(
        PERIMETER.pipelineRow
      );
      expect(skillProse(variant, "kiwi-pm"), "kiwi-pm's option row does not match the pinned text").toContain(PERIMETER.pmRow);

      const coder = skillProse(variant, "kiwi-coder");
      expect(coder, "kiwi-coder's --drive sentence does not match the pinned text").toContain(PERIMETER.coder);
      expect(coder, "a following clause revokes kiwi-coder's --drive rule").not.toMatch(FORBIDDEN.revocation);
    });

    it("AC-6: pins the journal-naming rule, including the child-gate vocabulary carve-out", () => {
      const record = section(resolvedProse(variant, "kiwi-wave-master"), "7.5.3");
      expect(record, "no §7.5.3 section").not.toBe("");
      expect(record, "the abort_gate rule does not match the pinned text").toContain(PINS.abortGate);
      expect(record, "the child-gate bubble-up rule does not match the pinned text").toContain(PINS.childBubble);
      expect(record, "the decision-row rule does not match the pinned text").toContain(PINS.decisionRow);
      expect(record, "a following clause revokes the journal rule").not.toMatch(FORBIDDEN.revocation);
    });

    it("AC-8: the machine-read gate rows name --drive as an opener", () => {
      const body = waveProse(variant);
      for (const gate of ["integration-test-user-consent", "cost-warning-large-task"]) {
        const row = body.split("\n").find((line) => line.startsWith("|") && line.includes(`\`${gate}\``));
        expect(row, `no gate row for ${gate}`).toBeDefined();
        expect(row, `${gate} row does not name --drive as an opener`).toContain("--drive");
      }
    });

    it("AC-9: every enumeration touching the forwarded set names --drive", () => {
      const frontmatter = rawSkill(variant, "kiwi-wave-master").split("\n---")[0] ?? "";
      expect(frontmatter, "wave-master frontmatter omits --drive").toContain("--drive");

      // Read from the raw body: this one legitimately lives inside a fenced CLI usage block.
      expect(stripFrontmatter(rawSkill(variant, "kiwi-pm")), "kiwi-pm CLI argument summary omits --drive").toMatch(/\[--drive\]/);
      expect(skillProse(variant, "kiwi-pm"), "kiwi-pm's pass-through paragraph does not match the pinned text").toContain(
        PERIMETER.pmProse
      );
      expect(skillProse(variant, "kiwi-orchestrator"), "kiwi-orchestrator's non-inheritance does not match the pinned text").toContain(
        PERIMETER.orchestrator
      );

      // Scoped to the `decision` row: the sentence reappearing in a neighbouring row satisfies a
      // whole-file search while the field it documents no longer declares the occasion.
      const decisionRow = sharedProse(variant, "waves-event.md")
        .split("\n")
        .find((line) => line.startsWith("| `decision`"));
      expect(decisionRow, "waves-event.md has no decision field row").toBeDefined();
      expect(decisionRow, "the decision row does not declare the --drive occasion").toContain(PERIMETER.wavesEvent);
    });
  });

  it("AC-7: the shared --auto SSOT carves out a single named flag, in every shipped copy", () => {
    // The carve-out sentence is pinned, not the flag name: rewriting it to "예외는 없다 … 본 금지에
    // 그대로 걸린다" keeps `--drive` in the file while restoring the contradiction the criterion
    // exists to remove. The claude tree ships Korean here and the others ship English.
    const copies: ReadonlyArray<{ file: string; pin: string }> = [
      { file: path.join(REPO_ROOT, "skills", "claude", "_shared", "kiwi", "auto-option.md"), pin: PERIMETER.autoOptionKo },
      { file: path.join(REPO_ROOT, "skills", "codex", "_shared", "kiwi", "auto-option.md"), pin: PERIMETER.autoOptionEn },
      { file: path.join(REPO_ROOT, "skills", "etc", "_shared", "kiwi", "auto-option.md"), pin: PERIMETER.autoOptionEn },
      { file: path.join(REPO_ROOT, ".agents", "skills", "_shared", "kiwi", "auto-option.md"), pin: PERIMETER.autoOptionEn }
    ];
    for (const { file, pin } of copies) {
      const text = readFileSync(file, "utf8");
      expect(text, `${file} does not name --drive`).toContain("--drive");
      expect(text, `${file}: the carve-out sentence does not match the pinned text`).toContain(pin);
    }
  });
});
