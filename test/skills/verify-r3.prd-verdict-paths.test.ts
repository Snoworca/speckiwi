import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Round-3 verification: entry paths where the PRD verdict either blocks the contradiction
// resolution FR-FLOW-205 AC-6 requires, or is missing on an SRS-writing path (user request A-2).
// Each check reads the shipped renderings and the .agents mirror where one exists.

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const ROOTS = ["skills/claude", "skills/codex", "skills/etc", ".agents/skills"] as const;
const read = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8").replace(/\r\n/g, "\n");

/** The `## 핵심 규칙 …` block up to the next `---` rule. */
function coreBlock(rel: string): string {
  const text = read(rel);
  const start = text.indexOf("\n## 핵심 규칙");
  expect(start, `${rel}: no core block`).toBeGreaterThanOrEqual(0);
  const end = text.indexOf("\n---", start + 1);
  return text.slice(start, end < 0 ? undefined : end);
}
/** Sentences, split after a Korean declarative ending. */
const sentences = (block: string): string[] => block.split(/(?<=다\.)\s+/);

// @req FR-FLOW-205 AC-6 — "a contradiction between items SHALL be resolved by the loop itself …
// even WHEN that removes an in-scope item". kiwi-tdd's core block (FR-FLOW-204 AC-10) makes the
// same resolution, but its (a) still fails on any in-scope item no line cites and forbids Phase 3
// until it passes. kiwi-srs exempts the removed item ("(a) 의 fail 로 세지 않는다"); kiwi-tdd does
// not, so a resolution that removes an in-scope item can never reach Phase 3.
describe("verify-r3 — kiwi-tdd: a contradiction resolved by removing an in-scope item deadlocks (a)", () => {
  for (const root of ROOTS) {
    it(`${root}/kiwi-tdd: the removed in-scope item is exempt from the (a) fail`, () => {
      const block = coreBlock(`${root}/kiwi-tdd/SKILL.md`);
      expect(block).toContain("contradiction resolved:");
      expect(block).toMatch(/fail\s*로\s*세지\s*않/);
    });
  }
});

// @req FR-FLOW-205 AC-6 — the resolution stands "even WHEN that … narrows an exclusion". Yet each
// block's drop rule removes anything that falls under an exclusion item with no exception for a
// `contradiction resolved:` narrowing, and the PRD's exclusion item itself is unchanged (kiwi-prd
// only appends a proposal). The improvement step then removes the very requirement the
// resolution allowed (FR-FLOW-205 AC-8), so narrowing an exclusion cannot take effect.
describe("verify-r3 — the exclusion drop rule overrides a contradiction resolution that narrows the exclusion", () => {
  const targets = ["kiwi-srs", "kiwi-tdd", "kiwi-orchestrator"] as const;
  for (const root of ROOTS) {
    for (const skill of targets) {
      it(`${root}/${skill}: the exclusion drop rule exempts what a resolution narrowed`, () => {
        const block = coreBlock(`${root}/${skill}/SKILL.md`);
        expect(block, "precondition: the block has an exclusion drop/delete rule").toContain("exclusion 항목에 걸리는");
        const exempting = sentences(block).filter((s) => /좁/.test(s) && /\(b\)|걸리지 않|지우지 않|drop 하지 않|exclusion 항목을/.test(s));
        expect(exempting, `${root}/${skill}: no sentence exempts a narrowed exclusion from the drop rule`).not.toHaveLength(0);
      });
    }
  }
});

// @req FR-FLOW-204 AC-10 — under R-STEP the orchestrator's core block says the work overview
// "무엇을 만들지 정하지 않는다", while kiwi-tdd's own input table still says the work overview is
// "무엇을 만들지(연구/의도)" (codex/etc: "What to build (research/intent)"). kiwi-tdd's core block
// does not state that it precedes its body.
describe("verify-r3 — kiwi-tdd's input table contradicts the orchestrator's R-STEP rule", () => {
  for (const root of ROOTS) {
    it(`${root}/kiwi-tdd: the work-overview row does not say it decides what to build without the PRD`, () => {
      const orchestrator = coreBlock(`${root}/kiwi-orchestrator/SKILL.md`);
      expect(orchestrator).toContain("작업 개요(`01.intake.md`)는 무엇을 만들지 정하지 않는다");
      // claude writes the row in Korean, codex/etc (and the mirror) in English.
      const row = read(`${root}/kiwi-tdd/SKILL.md`).split("\n").find((line) => line.startsWith("| 작업 개요 |") || line.startsWith("| work outline |")) ?? "";
      expect(row, "precondition: the row exists").not.toBe("");
      expect(/무엇을 만들지|What to build/.test(row) && !/PRD/.test(row), `contradicting row: ${row}`).toBe(false);
    });
  }
});

// @req FR-FLOW-204 AC-10 (scope gap against user request A-2: "SRS 를 작성할때도 1번에서 작성한
// 요구사항 문서가 없으면 일단 요구사항을 수집하여 문서로 작성하도록 하시오") — standalone
// /kiwi-tdd synthesizes and promotes a step SRS, and /kiwi-step authors step SRS drafts. Neither
// collects a PRD first: kiwi-tdd says "받지 않은 단독 실행은 PRD 판정 없이 진행한다" and kiwi-step
// never names kiwi-prd. The RBAC request entered through either skill has no exclusion to stop the
// DB tables. AC-10 only covers the orchestrator route, so the requirement itself is narrower than
// the request.
describe("verify-r3 — SRS-writing step skills run without a PRD", () => {
  for (const root of ROOTS) {
    it(`${root}/kiwi-tdd: a standalone run without PRD_PATH collects a PRD first`, () => {
      const block = coreBlock(`${root}/kiwi-tdd/SKILL.md`);
      expect(block).not.toContain("받지 않은 단독 실행은 PRD 판정 없이 진행한다");
      expect(block).toMatch(/kiwi-prd[^.]*먼저|먼저[^.]*kiwi-prd/);
    });
  }
  for (const root of ["skills/claude", "skills/codex", "skills/etc"] as const) {
    it(`${root}/kiwi-step: step SRS authoring names kiwi-prd when no PRD exists`, () => {
      expect(read(`${root}/kiwi-step/SKILL.md`)).toContain("kiwi-prd");
    });
  }
});
