import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "./kiwi-orchestrator-variants.js";
import { RENDERINGS } from "./kiwi-renderings.js";
import { COMPACTION_TOKEN_BUDGET, tokensThrough } from "./skill-token-estimate.js";
import { ORCHESTRATOR_PRD_RULE, WAVE_MASTER_PRD_RULE } from "./prd-rule-paragraphs.js";

// FR-FLOW-219 — a wave's PRD items are computed from its requirements' citations and PRD coverage is
// checked by `speckiwi prd coverage`, while kiwi-prd stays first and every kiwi-srs call carries the PRD.
// AC-3 carries over the rule FR-FLOW-204 AC-9 pinned (expired 2026-11-05 naming this requirement): the
// whole paragraph is pinned, as it was there, so nothing is weakened in the move.

const read = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8");
const DECOMPOSITION = RENDERINGS.map((root) => `${root}/_shared/kiwi/wave-decomposition.md`);
const ORCHESTRATOR = RENDERINGS.map((root) => `${root}/kiwi-orchestrator/SKILL.md`);
// kiwi-wave-master is on the mirror's exclusion list, so it ships in the three skills/ renderings only.
const WAVE_MASTER = RENDERINGS.filter((root) => root !== ".agents/skills").map((root) => `${root}/kiwi-wave-master/SKILL.md`);

function h2(text: string, heading: string): string {
  const start = text.indexOf(`\n## ${heading}`);
  if (start < 0) return "";
  const end = text.indexOf("\n## ", start + 1);
  return text.slice(start, end < 0 ? undefined : end);
}


describe("FR-FLOW-219 AC-1 — a wave's PRD items are the union of its requirements' citations", () => {
  // @req FR-FLOW-219 AC-1
  it.each(DECOMPOSITION)("%s: read through wave show, no excerpt naming items", (rel) => {
    const items = h2(read(rel), "4. 노드의 PRD 항목");
    expect(items).toContain("노드 요구들의 Rationale 이 인용한 PRD 항목의 합집합");
    expect(items).toContain("`orchestrate wave show` 의 `prd_items` 로 읽는다");
    expect(items).toContain("노드마다 PRD 항목을 적는 발췌는 쓰지 않는다");
  });

  // @req FR-FLOW-219 AC-1 — wave show resolves a node's PRD items only through the graph's top-level `prd`
  // (FR-NODE-244 AC-1, IR-CLI-114 AC-2); a decomposition that never sets it reads empty prd_items (verify r6).
  it.each(DECOMPOSITION)("%s: §2 step 7 writes the run's PRD path to the graph's top-level prd", (rel) => {
    const step7 = read(rel).split("\n").find((line) => line.startsWith("7. **메타데이터**")) ?? "";
    expect(step7).toBe(
      "7. **메타데이터** — 에이전트가 그래프 최상위 `prd` 에 run 의 PRD 경로(1단계의 PRD)를 적고, 노드마다 `title` · `purpose` · `description` · `cautions` · `done_when` · `on_complete` · `github_issues` 를 채운다. `wave show` 는 그 `prd` 로 노드의 PRD 항목(§4)을 푼다 — 없으면 `prd_items` 가 비어 검증자가 받을 PRD 항목도 빈다."
    );
  });

  // @req FR-FLOW-219 AC-1
  it.each([...WAVE_MASTER, ...ORCHESTRATOR, ...DECOMPOSITION])("%s: writes no wave excerpt that names PRD items", (rel) => {
    const text = read(rel);
    expect(text).not.toContain("PRD items:");
    expect(text).not.toMatch(/발췌에 그 wave 가 맡는 PRD 항목|excerpt\.md` 에 그 wave 가 맡는 PRD 항목/);
  });
});

describe("FR-FLOW-219 AC-1 — the node's PRD items are wave-master's design-layer denominator (moved from FR-FLOW-048)", () => {
  /** wave-master `### 5.5.n` subsection, up to the next `###` or `##` heading. */
  function h3(text: string, heading: string): string {
    const start = text.indexOf(`\n### ${heading}`);
    if (start < 0) return "";
    const rest = text.slice(start + 1);
    const end = rest.search(/\n#{2,3} /);
    return end < 0 ? rest : rest.slice(0, end);
  }
  const lineOf = (text: string, prefix: string): string => text.split("\n").find((line) => line.startsWith(prefix)) ?? "";

  // @req FR-FLOW-219 AC-1 — the node's computed PRD items reach the verifier through `orchestrate wave show`.
  // Rewritten for 5.3.0: FR-FLOW-220 AC-2 gives the verifier a closed list of facts, so the old evidence-bundle
  // rows (PRD items and user constraints as mandatory rows) and verifier 1's PRD layer (FR-FLOW-048) left
  // with the two-verifier model.
  it.each(WAVE_MASTER)("%s: the verifier receives the node's computed PRD items", (rel) => {
    const inputs = h3(read(rel), "5.5.1 ");
    expect(lineOf(inputs, "검증자에게 주는 것은")).toContain("그 노드의 `orchestrate wave show --wave wave-{n}` 이 주는 PRD 항목(`prd_items`)");
  });

  // @req FR-FLOW-219 AC-1 — the PRD items are fixed outside the verifier.
  it.each(WAVE_MASTER)("%s: the node's PRD items are part of the scope the verifier does not choose", (rel) => {
    const scope = h3(read(rel), "5.5.2 ");
    expect(scope).toContain("검증 범위는 그 노드의 `acs` 와 `prd_items`, 그리고 `verify-loop.md §3` 의 통합 항목이며 **검증자가 스스로 정하지 않는다**");
  });
});

describe("FR-FLOW-219 AC-2 — PRD coverage is the tool's, across every target", () => {
  // @req FR-FLOW-219 AC-2
  it.each(DECOMPOSITION)("%s: coverage after each authoring, missing only when no other target cites it", (rel) => {
    const coverage = h2(read(rel), "5. PRD 커버리지");
    for (const clause of [
      "처음 저작 뒤와 증분 저작(`wave-srs-registration.md §2`) 뒤마다 `speckiwi prd coverage <PRD> --target <제품 target> --json` 을 돌린다",
      "`speckiwi targets --json` 이 나열하는 다른 target `t` 마다 `speckiwi prd coverage <PRD> --target <t> --json` 의 `uncitedItems` 에도 있을 때만 이 run 에서 빠진 항목으로 센다",
      "빠진 항목이 하나라도 있으면 다음 dispatch 전에 `wave-decomposition-coverage-gap` 으로 멈춘다",
      "다른 target 의 요구가 인용한 항목(그 target 의 `uncitedItems` 에 없는 항목)은 멈추지 않고 그 target 에 배정되었다고 보고한다"
    ]) {
      expect(coverage, `${rel}: ${clause}`).toContain(clause);
    }
  });
});

describe("FR-FLOW-219 AC-3 — kiwi-prd first and PRD_PATH on every kiwi-srs call, within the first 5,000 tokens", () => {
  const CASES: Array<[string, string, string]> = [
    ...WAVE_MASTER.map((rel): [string, string, string] => [rel, WAVE_MASTER_PRD_RULE, "입력 문서에 PRD 경로가 없으면"]),
    ...ORCHESTRATOR.map((rel): [string, string, string] => [rel, ORCHESTRATOR_PRD_RULE, "intake 가 받은 요청에"])
  ];
  for (const [rel, paragraph, opening] of CASES) {
    // @req FR-FLOW-219 AC-3
    it(`${rel}: the PRD rule is exactly the pinned paragraph and ends within the first ${COMPACTION_TOKEN_BUDGET} estimated tokens`, () => {
      const text = read(rel);
      expect(text.split("\n").filter((line) => line.startsWith(opening))).toEqual([paragraph]);
      const at = tokensThrough(text, paragraph);
      expect(at).toBeGreaterThan(0);
      expect(at).toBeLessThanOrEqual(COMPACTION_TOKEN_BUDGET);
    });

    // @req FR-FLOW-219 AC-3 — every kiwi-srs call form of the skill and the contracts it cites carries the PRD path.
    it(`${rel}: every kiwi-srs call form passes PRD_PATH`, () => {
      const text = read(rel);
      const calls = [...text.matchAll(/Skill\(\{ skill: "kiwi-srs", args: "([^"]*)"/g)].map((match) => match[1] ?? "");
      for (const args of calls) expect(args, `${rel}: ${args}`).toContain("PRD_PATH=");
    });
  }
});
