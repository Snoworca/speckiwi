import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "./kiwi-orchestrator-variants.js";
import { RENDERINGS } from "./kiwi-renderings.js";

// FR-FLOW-213 — feasibility runs once before the first dispatch, and a node's draft requirements are
// raised just before it is scheduled; one still draft stops at the tool's requirement-not-ready refusal.

const read = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8");
const WAVE_MASTER = ["skills/claude", "skills/codex", "skills/etc"].map((root) => `${root}/kiwi-wave-master/SKILL.md`);
const SHARED = (name: string): string[] => RENDERINGS.map((root) => `${root}/_shared/kiwi/${name}`);

describe("FR-FLOW-213 AC-1 — feasibility once, after the initial authoring and before the first dispatch", () => {
  // @req FR-FLOW-213 AC-1
  it.each(SHARED("wave-decomposition.md"))("%s: one feasibility call for the run, never one per wave", (rel) => {
    const text = read(rel);
    const once = text.split("\n").find((line) => line.includes("**feasibility 한 번**")) ?? "";
    expect(once).toContain('Skill({ skill: "kiwi-srs-feasibility", args: "TARGET=<제품 target>');
    expect(once).toContain("처음 저작 뒤, 첫 dispatch 앞에 한 번 부른다");
    expect(once).toContain("wave 마다 부르지 않는다");
    expect(text.indexOf("**처음 저작**")).toBeLessThan(text.indexOf("**feasibility 한 번**"));
  });

  // @req FR-FLOW-213 AC-1
  it.each(WAVE_MASTER)("%s: no per-wave feasibility call", (rel) => {
    const text = read(rel);
    expect(text).not.toMatch(/kiwi-srs-feasibility[^\n]*TARGET=wave-/);
    expect(text).not.toMatch(/`?[/$]kiwi-srs-feasibility` 을 이어서 부른다/);
  });
});

describe("FR-FLOW-213 AC-2 — a node's draft requirements are raised just before it is scheduled", () => {
  // @req FR-FLOW-213 AC-2 — language-neutral: the claude contract is Korean, codex and etc are English.
  it.each(SHARED("parallel-waves.md"))("%s: PW-4 raises the node's draft requirements, then schedule waves refuses any still draft", (rel) => {
    const text = read(rel);
    const start = text.indexOf("**PW-4 ·");
    const pw4 = text.slice(start, text.indexOf("**PW-5 ·", start));
    const raise = pw4.indexOf('Skill({ skill: "kiwi-srs-feasibility", args: "--req-filter');
    const schedule = pw4.indexOf("orchestrate schedule waves");
    expect(raise, `${rel}: PW-4 has no draft-raising feasibility call`).toBeGreaterThan(0);
    expect(schedule, `${rel}: PW-4 must schedule after raising`).toBeGreaterThan(raise);
    expect(pw4).toContain("`draft`");
    expect(pw4).toContain("`requirement-not-ready`");
  });
});
