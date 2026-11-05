import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "./kiwi-orchestrator-variants.js";
import { RENDERINGS } from "./kiwi-renderings.js";

// @req FR-FLOW-220 AC-7 — no design-item denominator for loops P and F.
// @req FR-FLOW-215 AC-1 — no loop W.
// @req FR-FLOW-222 AC-5 — progress and resume state come from `orchestrate wave status`, never from `waves.jsonl` by hand.
// @req FR-FLOW-212 AC-2 — no `wave-{n}` targets.
// @req FR-FLOW-221 AC-1 — no severity pass condition in the wave verification.
//
// A census, not a sample. Every line of the skills the 5.3.0 wave contract touches that carries one of
// the expressions below is collected, and each must be either a description of a pre-5.3.0 journal line
// (it says so on the line, or its section heading does) or a live rule named in ALLOWED with the reason
// it is still true. A line outside both turns this red — which is how the three stale sentences of the
// final verification round (a resume that read `waves.jsonl`, loop P · F design denominators, loop **W**)
// would have been caught by the denominator rather than by a reader.

const SKILLS = ["kiwi-wave-master", "kiwi-orchestrator", "kiwi-pm", "kiwi-coder"];

const PATTERNS: ReadonlyArray<[string, RegExp]> = [
  ["design-item denominator", /design_items|설계 항목 분모/],
  ["loop W", /loop\s*\**\s*W\b/],
  ["reading waves.jsonl by hand", /`(?:\.\/)?(?:kiwi\/)?waves\.jsonl` ?(?:을|를)? ?(?:직접 |손으로 )?읽|read(?:s|ing)? (?:the )?`(?:\.\/)?(?:kiwi\/)?waves\.jsonl`/i],
  // The quoted value form `"target":"wave-1"` of an example line slipped past the prose forms (verify r3).
  ["a wave-{n} target", /TARGET=wave-|`wave-\{n\}` ?(?:target|타깃)|target[^\n]{0,20}`wave-\{n\}`|전용 (?:SRS )?target|"target":\s*"wave-(?:\d+|\{n\})"/],
  ["a severity pass condition", /CRITICAL\s*=\s*0|HIGH\s*=\s*0|MEDIUM-zero|잔여 CRITICAL|CRITICAL ?· ?HIGH|CRITICAL\/HIGH/]
];

/** A line says it describes a pre-5.3.0 journal line. */
const PRE_530 = /5\.3\.0 이전|pre-5\.3\.0|before 5\.3\.0/;

/** Live rules that carry one of the expressions, each with the reason it still holds. Exact trimmed lines. */
const ALLOWED: ReadonlyArray<[string, string]> = [
  [
    "경고가 아니라 게이트인 이유: 누락은 조용하고 개수는 하중을 진다. **적게 센 `design_items[]`** 는 loop D 의 **동결 분모를 줄이는데** `invariant_digest` 는 드리프트를 보고하지 않으므로 설계 안의 다른 어떤 것도 이를 잡지 못한다.",
    "loop D 의 분모는 run 설계의 설계 항목이다(FR-FLOW-079)"
  ],
  [
    "loop D 가 동결한 run 설계 lock(`design/00.design.lock.json`)의 **`design_items` 개수는 게이트 증거에 실려 나가고 어떤 술어도 구동하지 않는다.** wave 마다 설계 항목을 두지 않으므로(FR-FLOW-215) 이 개수는 run 의 것이다. 설계 항목 규모에 대한 네 번째 조건은 없다.",
    "route-downgrade-available 게이트 증거의 개수(FR-FLOW-089 AC-1) — run 설계 lock 의 개수이고 분모가 아니다"
  ],
  [
    "recovery class **idempotent-by-key**. Phase 1.e. `design/00.design.lock.json` 을 쓰고 `design_items[]` 와 `integration_items[]` 와 `out_of_scope[]` 를 산출한다. 내용 주소화되어 digest 가 같으면 no-op 다.",
    "설계 동결 lock 의 내용 — loop D 가 읽는다"
  ],
  [
    "\"counts\": { \"design_items\": 41, \"integration_items\": 6, \"constraints\": 6, \"waves\": 4 },",
    "재개 카드에 실은 설계 lock 의 개수 예시"
  ],
  [
    "- 라운드 상한은 **상한(upper bound)** 이다. 그 스킬의 통과 조건이 상한 이전에 **조기 종료**할 수 있다 — kept finding 으로 판정하는 스킬은 kept finding 0 이고, 심각도 게이트를 쓰는 스킬은 Normal `CRITICAL=0 + HIGH=0` / Max `2연속 MEDIUM-zero` 다. 즉 `--mini` 는 \"정확히 3회\"가 아니라 **\"최대 3라운드\"** 다.",
    "공용 loop-option 계약 — 심각도 게이트를 남긴 스킬(`kiwi-srs-feasibility` 등)에도 적용된다"
  ],
  [
    "- The round cap is an **upper bound**. The skill's own pass condition MAY terminate the loop earlier — kept finding 0 for a skill that judges by kept findings, and Normal `CRITICAL=0 + HIGH=0` / Max",
    "the English loop-option contract, first line of the same bullet"
  ],
  [
    "`2-consecutive-MEDIUM-zero` for a skill that keeps a severity gate. So `--mini` means **\"at most 3 rounds\"**,",
    "the English loop-option contract, second line of the same bullet"
  ]
];

function files(root: string): string[] {
  const out: string[] = [];
  for (const skill of SKILLS) {
    const dir = path.join(REPO_ROOT, root, skill);
    if (!existsSync(dir)) continue;
    out.push(path.join(root, skill, "SKILL.md"));
    const refs = path.join(dir, "references");
    if (existsSync(refs)) for (const name of readdirSync(refs)) if (name.endsWith(".md")) out.push(path.join(root, skill, "references", name));
  }
  for (const name of readdirSync(path.join(REPO_ROOT, root, "_shared", "kiwi"))) if (name.endsWith(".md")) out.push(path.join(root, "_shared", "kiwi", name));
  return out.map((rel) => rel.replace(/\\/g, "/")).filter((rel) => existsSync(path.join(REPO_ROOT, rel)));
}

interface Hit {
  readonly at: string;
  readonly what: string;
  readonly line: string;
  readonly heading: string;
}

function census(): Hit[] {
  const hits: Hit[] = [];
  for (const root of RENDERINGS) {
    for (const rel of files(root)) {
      let heading = "";
      readFileSync(path.join(REPO_ROOT, rel), "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (/^#{1,6}\s/.test(line)) heading = line;
          for (const [what, re] of PATTERNS) if (re.test(line)) hits.push({ at: `${rel}:${i + 1}`, what, line: line.trim(), heading });
        });
    }
  }
  return hits;
}

describe("the 5.3.0 wave contract carries no line from before it unless the line says so or is a live rule", () => {
  const hits = census();

  it("the denominator is real: every rendering is scanned and the expressions occur", () => {
    expect(new Set(hits.map((hit) => hit.at.split("/")[0] === "." ? ".agents" : hit.at.split("/")[1])).size).toBeGreaterThanOrEqual(3);
    expect(hits.length).toBeGreaterThan(20);
  });

  it("every hit is a marked pre-5.3.0 line or an allowed live rule", () => {
    const allowed = new Set(ALLOWED.map(([line]) => line));
    const stray = hits.filter((hit) => !PRE_530.test(hit.line) && !PRE_530.test(hit.heading) && !allowed.has(hit.line));
    expect(stray.map((hit) => `${hit.at} [${hit.what}] ${hit.line.slice(0, 160)}`)).toEqual([]);
  });

  it("every allowed line still occurs, so the list cannot outlive the text it excuses", () => {
    const seen = new Set(hits.map((hit) => hit.line));
    expect(ALLOWED.filter(([line]) => !seen.has(line)).map(([line]) => line.slice(0, 120))).toEqual([]);
  });
});
