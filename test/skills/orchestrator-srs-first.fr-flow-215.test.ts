import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "./kiwi-orchestrator-variants.js";
import { RENDERINGS } from "./kiwi-renderings.js";

// FR-FLOW-215 — R-ORCH follows the same SRS-first structure as kiwi-wave-master through shared contracts
// that define one decomposition and authoring mode only.

const read = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8");
const ORCHESTRATOR = RENDERINGS.map((root) => `${root}/kiwi-orchestrator/SKILL.md`);
const WAVE_MASTER = ["skills/claude", "skills/codex", "skills/etc"].map((root) => `${root}/kiwi-wave-master/SKILL.md`);
const SHARED_MODES = ["wave-decomposition.md", "parallel-waves.md", "wave-srs-registration.md"];

/** The fenced phase-flow block of `## 3. Phase 흐름`. */
function phaseFlow(text: string): string {
  const start = text.indexOf("\n## 3. Phase 흐름");
  const open = text.indexOf("```", start);
  return start < 0 || open < 0 ? "" : text.slice(open, text.indexOf("```", open + 3));
}

describe("FR-FLOW-215 AC-1 — design freeze, one SRS authoring, feasibility, propose, then the shared waves", () => {
  // @req FR-FLOW-215 AC-1
  it.each(ORCHESTRATOR)("%s: the phase flow runs that order", (rel) => {
    const flow = phaseFlow(read(rel));
    const steps = ["freeze-design", "wave-srs-registration.md §1", "kiwi-srs-feasibility", "orchestrate wave propose", "orchestrate wave check", "parallel-waves.md"];
    let from = 0;
    for (const step of steps) {
      const at = flow.indexOf(step, from);
      expect(at, `${rel}: ${step} after offset ${from}`).toBeGreaterThan(0);
      from = at + step.length;
    }
  });

  // @req FR-FLOW-215 AC-1 — the one authoring call carries the PRD and the product target.
  it.each(ORCHESTRATOR)("%s: the R-ORCH call block authors the product target once", (rel) => {
    expect(read(rel)).toContain('Skill({ skill: "kiwi-srs", args: "PRD_PATH=docs/prd/{prd}.prd.md TARGET=<제품 target>');
  });

  const GONE: Array<[string, RegExp]> = [
    ["the per-wave TARGET authoring", /TARGET=wave-|--target wave-/],
    // `loop **W · P · F**` slipped past a bare /loop W/ (verify r2): the bold marker sits between.
    ["the loop W design documents", /loop\s*\**\s*W\b|waves\/wave-\{n\}\/design\.md/],
    ["the wave excerpts", /excerpt\.md|`excerpt_path`/]
  ];
  for (const rel of ORCHESTRATOR) {
    for (const [what, re] of GONE) {
      // @req FR-FLOW-215 AC-1
      it(`${rel}: carries no ${what}`, () => {
        const hit = read(rel).split("\n").find((line) => re.test(line));
        expect(hit, `${rel}: ${hit}`).toBeUndefined();
      });
    }
  }
});

describe("FR-FLOW-215 AC-1 — §8 states that the run design is the only design document (moved from FR-FLOW-080)", () => {
  // @req FR-FLOW-215 AC-1
  it.each(ORCHESTRATOR)("%s: no per-wave design document, and the two verbs stay only to read old journals", (rel) => {
    const text = read(rel);
    const s8 = text.slice(text.indexOf("\n## 8. "), text.indexOf("\n## 9. "));
    expect(s8).toContain("wave 마다 설계 문서를 쓰지 않는다 — 설계는 1.d 의 run 설계 하나이고, wave 의 범위는 그래프 노드의 `acs` 다");
    expect(s8).toContain("`author-wave-design` · `verify-wave-design` 은 옛 run 의 저널 줄을 읽기 위해 enum 에만 남는다");
  });
});

describe("FR-FLOW-215 AC-2 — one decomposition and authoring mode that both skills cite", () => {
  // @req FR-FLOW-215 AC-2
  it.each([...ORCHESTRATOR, ...WAVE_MASTER])("%s: §0 cites the three shared contracts", (rel) => {
    const text = read(rel);
    const zero = text.slice(text.indexOf("\n## 0. "), text.indexOf("\n## 0.", text.indexOf("\n## 0. ") + 5));
    for (const name of SHARED_MODES) expect(zero, `${rel}: ${name}`).toContain(`_shared/kiwi/${name}`);
  });

  // @req FR-FLOW-215 AC-2
  it.each(RENDERINGS.map((root) => `${root}/_shared/kiwi/wave-decomposition.md`))("%s: states the single mode for both skills", (rel) => {
    const head = read(rel).split("\n---\n")[0] ?? "";
    expect(head).toContain("`kiwi-wave-master` 와 `kiwi-orchestrator`(`R-ORCH`)가 이 문서를 고치지 않고 그대로 인용한다");
    expect(head).toContain("분해 방식은 하나뿐이고 그 곁에 wave 마다 저작하는 두 번째 방식은 없다");
  });

  // @req FR-FLOW-215 AC-2 — language-neutral: parallel-waves is Korean in claude and English in codex and etc.
  for (const name of SHARED_MODES) {
    it.each(RENDERINGS.map((root) => `${root}/_shared/kiwi/${name}`))("%s: no per-wave authoring mode", (rel) => {
      const text = read(rel);
      expect(text).not.toMatch(/TARGET=wave-/);
      expect(text).not.toMatch(/준비 집합의 wave 에만 저작|authored only for waves in the ready set|SRS 저작을 아직 시작하지 않은 wave|whose SRS authoring has not started/);
    });
  }
});
