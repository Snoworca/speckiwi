/**
 * Shared vocabulary for how many verification subagents a skill states, and the readers for the two
 * loop FR-FLOW-180 governs: the kiwi-srs §9.6 fan-out list.
 * One module so the FR-FLOW-023, FR-FLOW-142 and FR-FLOW-180 suites cannot drift into
 * two spellings of one count. @req FR-FLOW-180
 */

/** Exactly one verification subagent / evaluator. */
export const ONE_VERIFIER =
  /(?:서브\s*에이전트|평가자|evaluator|subagent)[^\n]{0,6}\*{0,2}\s*(?:1\s*개|하나|한\s*개)|(?:\*{0,2}1\s*개\*{0,2}|단일|하나의|한\s*개의)[^\n]{0,4}(?:검증\s*)?(?:서브\s*에이전트|평가자)|(?:exactly\s+one|a\s+single|single)\s+(?:verification\s+)?(?:subagent|evaluator)/i;

/**
 * More than one verification subagent / evaluator: digits, Korean numerals with or without 개
 * ("**둘**이", "두 개"), 복수/여러, a multiplier ("× 2"), or English ("2 verification subagents").
 */
export const MULTI_VERIFIER =
  /(?:서브\s*에이전트|평가자|evaluator|subagent)[^\n]{0,6}\*{0,2}\s*(?:(?:[2-9]|두|세|네|여러)\s*개|둘|셋|넷|복수|×\s*(?:[2-9]|\d{2,}))|\*{0,2}(?:[2-9]|두|세|네|여러)\s*개\*{0,2}[^\n]{0,4}(?:의\s*)?(?:검증\s*)?(?:서브\s*에이전트|평가자)|(?:복수|여러)\s*(?:개\s*)?(?:의\s*)?(?:검증\s*)?(?:서브\s*에이전트|평가자)|(?:\b[2-9]|two|three|multiple|several)\s+(?:verification\s+)?(?:subagents|evaluators)/i;

/**
 * A further verifier added without a count: "또 다른", "별도의", "추가 검증 서브에이전트",
 * "another subagent".
 */
export const ANOTHER_VERIFIER =
  /(?:(?:또\s*)?다른|별도(?:의)?|추가(?:의|로)?)\s*(?:독립\s*)?(?:(?:재)?검증\s*|재확인\s*)?(?:서브\s*에이전트|평가자)|another\s+(?:verification\s+)?(?:subagent|evaluator)/i;

/** A second pass by the same verifier: "한 번 더", "다시 한 번", "second pass". */
export const SECOND_PASS = /한\s*번\s*더|다시\s*한\s*번|second\s+pass|두\s*번째\s*패스/i;

/**
 * The counts a text states in bold right after the verifier noun ("검증 서브에이전트 **1개**가",
 * "검증 평가자(evaluator) **1개**가"). This is the clause that states the count, as opposed to any
 * other sentence that happens to say "하나" — a count check keyed on vocabulary anywhere in the
 * paragraph was satisfied by the exclusivity sentence after the count itself had been reversed.
 */
export function boldVerifierCounts(text: string): string[] {
  const re = /(?:서브\s*에이전트|평가자)(?:\s*\(evaluator\))?\s*\*\*([^*\n]+)\*\*/g;
  return [...text.matchAll(re)].map((m) => (m[1] ?? "").replace(/\s+/g, ""));
}

export const MAX_FLAG = /--max\b/;

/** The label a list bullet opens with: the text before its first colon ("- `--max`, 단일 문서 기준:"). */
export function bulletLabel(bullet: string): string {
  const body = bullet.replace(/^-\s*/, "");
  const colon = body.indexOf(":");
  return colon < 0 ? body : body.slice(0, colon);
}

/** A section from a heading matching `heading` to the next `---` rule or heading of level 2 or 3. */
export function sectionFrom(text: string, heading: RegExp): string {
  const start = text.search(heading);
  if (start < 0) return "";
  const rest = text.slice(start);
  const end = rest.search(/\r?\n---\r?\n|\r?\n#{2,3}\s/);
  return end < 0 ? rest : rest.slice(0, end);
}

/** kiwi-srs §9.6, the research-document A/B loop. */
export function researchLoopSection(text: string): string {
  return sectionFrom(text, /^###\s*9\.6\b/m);
}

/** The bullets of §9.6's verification fan-out list, one string per bullet. */
export function fanoutBullets(text: string): string[] {
  const lines = researchLoopSection(text).split(/\r?\n/);
  const head = lines.findIndex((l) => /^\*\*검증\s*(?:팬아웃|서브에이전트\s*실행)/.test(l));
  if (head < 0) return [];
  const out: string[] = [];
  for (const line of lines.slice(head + 1)) {
    if (!line.startsWith("- ")) break;
    out.push(line);
  }
  return out;
}

/** The fan-out bullets whose label names `--max`. */
export function maxFanoutBullets(text: string): string[] {
  return fanoutBullets(text).filter((b) => MAX_FLAG.test(bulletLabel(b)));
}

/** The fan-out bullets whose label does not name `--max`. */
export function defaultFanoutBullets(text: string): string[] {
  return fanoutBullets(text).filter((b) => !MAX_FLAG.test(bulletLabel(b)));
}
