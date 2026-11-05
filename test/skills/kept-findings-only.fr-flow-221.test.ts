import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "./kiwi-orchestrator-variants.js";
import { RENDERINGS } from "./kiwi-renderings.js";

// FR-FLOW-221 — the skill-side verification surfaces judge by kept findings proven by a run; no
// severity class gates a pass and no stop id names a severity.

const read = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8");
const shipped = (rels: string[]): string[] => rels.filter((rel) => existsSync(path.join(REPO_ROOT, rel)));
const LOOP = RENDERINGS.map((root) => `${root}/_shared/kiwi/verify-loop.md`);
const PARALLEL = RENDERINGS.map((root) => `${root}/_shared/kiwi/parallel-waves.md`);
const EVENT = RENDERINGS.map((root) => `${root}/_shared/kiwi/waves-event.md`);
const CODER = shipped(RENDERINGS.map((root) => `${root}/kiwi-coder/SKILL.md`));
const WAVE_MASTER = shipped(RENDERINGS.map((root) => `${root}/kiwi-wave-master/SKILL.md`));
const FIVE = [...LOOP, ...PARALLEL, ...EVENT, ...CODER, ...WAVE_MASTER];

const korean = (rel: string): boolean => rel.startsWith("skills/claude/");

function chapter(text: string, n: number): string {
  const start = text.search(new RegExp(`\\n## ${n}\\. `));
  if (start < 0) return "";
  const next = text.indexOf("\n## ", start + 4);
  return text.slice(start, next < 0 ? undefined : next);
}

/** A `### ` section of kiwi-coder, up to the next `### ` or `## `. */
function coderSection(text: string, heading: string): string {
  const start = text.indexOf(`\n### ${heading}`);
  if (start < 0) return "";
  const rest = text.slice(start + 4);
  const next = rest.search(/\n#{2,3} /);
  return next < 0 ? rest : rest.slice(0, next);
}

describe("FR-FLOW-221 AC-1 — verify-loop.md passes on kept findings, fixes and regression only", () => {
  it.each(LOOP)("%s: the pass condition names no severity and no MEDIUM streak", (rel) => {
    // @req FR-FLOW-221 AC-1
    const text = read(rel);
    const exit = chapter(text, 5);
    expect(exit).toContain("통과 조건은 kept finding 0, 그 라운드에 적용한 수정 0, 회귀의 신규 실패 0 이다");
    expect(exit).toMatch(/`--max` 는 이 조건을 \*\*[23]라운드 연속\*\* 요구한다/);
    for (const term of ["CRITICAL", "HIGH", "MEDIUM", "severity"]) expect(text, `${rel}: ${term}`).not.toContain(term);
  });
});

describe("FR-FLOW-221 AC-2 — review_outcome is the review hop's return and its kept-finding count", () => {
  it.each(PARALLEL)("%s: PW-6 defines review_outcome and PW-8 names no residual severity", (rel) => {
    // @req FR-FLOW-221 AC-2
    const text = read(rel);
    expect(text).toContain(
      korean(rel)
        ? "`review_outcome` 은 5 단계 리뷰의 반환(`TASK_DONE` · `NEEDS_USER` · `FAILED`)과 그 리뷰가 남긴 kept finding 수다"
        : "`review_outcome` is the step-5 review's return (`TASK_DONE` · `NEEDS_USER` · `FAILED`) and the number of kept findings it left"
    );
    const start = text.indexOf("**PW-8 ·");
    const pw8 = text.slice(start, text.indexOf("**PW-9 ·", start));
    expect(pw8).toContain(korean(rel) ? "review_outcome 이 TASK_DONE 이고 kept finding 이 0 이다" : "review_outcome is TASK_DONE with 0 kept findings");
    for (const term of ["CRITICAL", "HIGH"]) expect(text, `${rel}: ${term}`).not.toContain(term);
  });
});

describe("FR-FLOW-221 AC-3 — kiwi-coder keeps a finding only with a run's proof and has no severity", () => {
  it.each(CODER)("%s: §4 keeps findings by proof and carries no severity definition", (rel) => {
    // @req FR-FLOW-221 AC-3
    const text = read(rel);
    const phase1 = `${coderSection(text, "4.2 ")}\n${coderSection(text, "4.3 ")}`;
    expect(phase1).toContain("finding 은 실패하는 테스트 · 재현 · 명령 출력이 입증할 때만 남는다(kept)");
    expect(phase1).toContain("4.3 개선 루프 (kept finding 0 까지)");
    for (const term of ["**CRITICAL**", "**HIGH**", "**MEDIUM**", "**LOW**", "CRITICAL=0", "HIGH=0", "severity"]) {
      expect(phase1, `${rel}: §4 carries ${term}`).not.toContain(term);
    }
  });

  it.each(CODER)("%s: §5.1 (g) has one round counter and Phase 2 passes on no kept finding plus green", (rel) => {
    // @req FR-FLOW-221 AC-3
    const text = read(rel);
    const flow = coderSection(text, "5.1 ");
    const g = flow.slice(flow.indexOf("├─ (g)"), flow.indexOf("├─ (h)"));
    expect(g, `${rel}: (g) not found`).toContain("(g) 개선 루프 (kept finding 0 까지)");
    expect(g, `${rel}: (g) still counts per severity`).not.toMatch(/(?:CRITICAL|HIGH|MEDIUM|LOW)\s*≤/);
    expect(flow, `${rel}: (h) still feeds a severity counter`).not.toMatch(/HIGH 카운터/);
    expect(text).toContain("Phase 2 통과 조건: **kept finding 0 + green 확정**.");
    expect(text, `${rel}: the old Phase 2 gate`).not.toContain("CRITICAL=0 + HIGH=0");
  });
});

describe("FR-FLOW-221 AC-4 — the stop ids name kept findings; waves-event documents findings and red_tests", () => {
  it.each(WAVE_MASTER)("%s: declares the renamed stop ids and keeps them closed under --auto and --drive", (rel) => {
    // @req FR-FLOW-221 AC-4
    const text = read(rel);
    for (const id of ["wave-verify-kept-finding", "final-verify-kept-finding"]) {
      expect(text.split("\n").some((line) => line.startsWith(`| \`${id}\` |`)), `${rel}: ${id} row`).toBe(true);
    }
    expect(text).toMatch(/`wave-verify-kept-finding` 은 `--auto` 라도 wave 오케스트레이션 \*\*전체를 중단\*\*시킨다/);
    expect(text).toContain("`wave-verify-kept-finding` · `final-verify-kept-finding` · `wave-verify-fail-residual` 은 `--drive` 에서도 중단이다");
  });

  it.each(EVENT)("%s: §2.3 documents findings and red_tests in place of axis_a and axis_b", (rel) => {
    // @req FR-FLOW-221 AC-4
    const verification = read(rel).slice(read(rel).indexOf("### 2.3"), read(rel).indexOf("### 2.4"));
    const row = (key: string): string => verification.split("\n").find((line) => line.startsWith(`| \`${key}\` |`)) ?? "";
    expect(row("findings")).toContain("`{ kept: n, dropped: n }`");
    expect(row("red_tests")).toContain("kept finding 마다 그것을 입증한 red 테스트");
    expect(row("axis_a"), `${rel}: axis_a row`).toBe("");
    expect(row("axis_b"), `${rel}: axis_b row`).toBe("");
    expect(row("residual")).not.toContain("severity");
    // The layer rows of the old verification record stay only to read lines written before 5.3.0.
    for (const key of ["design_layer", "constraint_layer", "preservation_layer"]) {
      expect(row(key), `${rel}: ${key} row`).toMatch(/\| 5\.3\.0 이전 줄만 싣는다\. /);
    }
  });
});

describe("FR-FLOW-221 AC-5 — no shipped copy of the five documents gates a pass by severity or names one in a stop id", () => {
  it.each(FIVE)("%s", (rel) => {
    // @req FR-FLOW-221 AC-5
    const text = read(rel);
    for (const term of ["CRITICAL=0", "HIGH=0", "MEDIUM=0"]) expect(text, `${rel}: ${term}`).not.toContain(term);
  });

  // codex and etc split kiwi-coder and kiwi-wave-master into SKILL.md and references/extended-workflow.md.
  const BODIES = [...FIVE, ...shipped([...CODER, ...WAVE_MASTER].map((rel) => rel.replace(/SKILL\.md$/, "references/extended-workflow.md")))];
  it.each(BODIES)("%s: no stop id names a severity", (rel) => {
    // @req FR-FLOW-221 AC-5 — every stop id, not one known name: a severity word as a segment of any kebab id.
    // `high-reasoning` is a reasoning-effort value, not a severity.
    const ids = [...read(rel).matchAll(/`([a-z0-9]+(?:-[a-z0-9]+)+)`/g)].map((match) => match[1] ?? "");
    const named = [...new Set(ids.filter((id) => id !== "high-reasoning" && /(?:^|-)(?:critical|high|medium|low)(?:-|$)/.test(id)))];
    expect(named, `${rel}: stop ids naming a severity`).toEqual([]);
  });
});
