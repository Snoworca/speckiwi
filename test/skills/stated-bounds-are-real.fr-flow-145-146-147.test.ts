import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "./kiwi-orchestrator-variants.js";

// @req FR-FLOW-145 — a declared round-cap option reaches the loop it claims to bound.
// @req FR-FLOW-146 — a skill does not state two different answers to the same question.
// @req FR-FLOW-147 — a verification pass leaves a record of what it found.
//
// All three are the same failure viewed from different sides: a document says one thing and the
// thing that actually runs says another, and nothing compares them. The commit skills declared they
// honour the round-cap options beside a hardcoded literal; a scope author was assigned two different
// models by two sections; a re-spawn was granted with no ceiling.

const VARIANTS = ["claude", "codex", "etc"] as const;

function skill(variant: string, name: string): string | null {
  try {
    return readFileSync(path.join(REPO_ROOT, `skills/${variant}/${name}/SKILL.md`), "utf8");
  } catch {
    return null;
  }
}

/**
 * Every shipped file carrying a construct, found by walking the skills tree rather than by assuming
 * each variant keeps it in the same place. They do not: the claude variant states these things in
 * SKILL.md while codex and etc move some into `references/extended-workflow.md`, and some variants
 * do not carry a given construct at all. A variant without the construct cannot have the defect, so
 * asserting over a fixed list would fail those variants for the wrong reason.
 *
 * Callers must assert the population is non-empty — otherwise a construct that vanished entirely
 * would leave every case passing over nothing.
 */
function filesContaining(marker: RegExp): Array<[string, string]> {
  const found: Array<[string, string]> = [];
  const walk = (relDir: string): void => {
    // Narrow on purpose: a broad catch here once swallowed a ReferenceError from a missing import
    // and the walk returned nothing, which made every case pass over an empty population. Only a
    // missing directory is tolerated; anything else is a defect in this file and must surface.
    let entries: ReturnType<typeof readdirSync>;
    try {
      entries = readdirSync(path.join(REPO_ROOT, relDir), { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      const rel = `${relDir}/${entry.name}`;
      if (entry.isDirectory()) walk(rel);
      else if (entry.name.endsWith(".md")) {
        const text = readFileSync(path.join(REPO_ROOT, rel), "utf8");
        if (marker.test(text)) found.push([rel, text]);
      }
    }
  };
  for (const variant of VARIANTS) walk(`skills/${variant}`);
  return found;
}

describe("FR-FLOW-145 — a declared option reaches the bound it names", () => {
  it("no shipped loop bound is a literal the declared options cannot reach", () => {
    const carriers = filesContaining(/MAX_EVAL_ITERATIONS\s*=/);
    expect(carriers.length, "no shipped file declares this loop bound at all").toBeGreaterThan(0);
    const offenders: string[] = [];
    for (const [rel, text] of carriers) {
      for (const line of text.split(/\r?\n/)) {
        if (!/MAX_EVAL_ITERATIONS\s*=/.test(line)) continue;
        // The declaration is present, so the bound must be reachable from it. A bare literal is
        // the defect: the flag reads as supported and changes nothing.
        //
        // The bound must state the mapping, not delegate it to a name. An earlier attempt wrote
        // `resolveRoundCap()` here — a helper nothing in the shipped tree defines, which reads as a
        // binding while being exactly the thing this requirement forbids, one level further out.
        if (!/--loops/.test(line) || !/--mini/.test(line)) offenders.push(`${rel}: ${line.trim()}`);
        if (/\b\w+\(\)/.test(line)) offenders.push(`${rel}: delegates its bound to an undefined helper`);
      }
    }
    expect(offenders, "a loop bound is pinned to a literal no option can reach").toEqual([]);
  });

  it("the stated default and the fallback the expression actually uses are the same number", () => {
    // Checking that the file says "default 10" somewhere proves nothing about the expression: the
    // fallback literal could be changed to 3 with the comment left reading 10, and both this case
    // and the one above would stay green while AC-5 — no unrequested lowering — was violated.
    // Compare the two numbers instead of confirming one of them exists.
    const carriers = filesContaining(/MAX_EVAL_ITERATIONS\s*=/);
    expect(carriers.length, "no shipped file declares this loop bound at all").toBeGreaterThan(0);
    for (const [rel, text] of carriers) {
      for (const line of text.split(/\r?\n/)) {
        if (!/MAX_EVAL_ITERATIONS\s*=/.test(line)) continue;
        const fallback = line.match(/:\s*(\d+)\s*\)/)?.[1];
        const stated = line.match(/기본값\s*(\d+)/)?.[1];
        expect(fallback, `${rel} states no fallback literal: ${line.trim()}`).toBeDefined();
        expect(stated, `${rel} does not say what the bound defaults to: ${line.trim()}`).toBeDefined();
        expect(fallback, `${rel} claims a default of ${stated} while falling back to ${fallback}`).toBe(stated);
      }
    }
  });
});

describe("FR-FLOW-146 — one question, one answer", () => {
  it("the scope author is assigned exactly one model", () => {
    const carriers = filesContaining(/scope\s*1개|scope agent/);
    expect(carriers.length, "no shipped file describes the scope author").toBeGreaterThan(0);
    for (const [rel, text] of carriers) {
      const assignments = text
        .split(/\r?\n/)
        .filter((line) => /scope\s*1개|scope agent|scope 작성/.test(line))
        .filter((line) => /Opus|세션 모델/.test(line));
      const namesOpus = assignments.some((line) => /Opus/.test(line));
      const namesSession = assignments.some((line) => /세션 모델/.test(line));
      expect(namesOpus && namesSession, `${rel} assigns the scope author two different models`).toBe(false);
    }
  });

  it("the re-spawn that had no ceiling is given one", () => {
    const carriers = filesContaining(/Synthesizer 재spawn/);
    expect(carriers.length, "no shipped file grants the Synthesizer re-spawn any more").toBeGreaterThan(0);
    const offenders: string[] = [];
    for (const [rel, text] of carriers) {
      for (const line of text.split(/\r?\n/)) {
        if (!/Synthesizer 재spawn/.test(line)) continue;
        if (!/\d+\s*회|상한/.test(line)) offenders.push(`${rel}: ${line.trim().slice(0, 90)}`);
      }
    }
    expect(offenders, "a re-spawn is granted with no stated ceiling").toEqual([]);
  });

  it("the mode multiplier says which of the two things it means", () => {
    // "×2" alone leaves a reader to choose between two concurrent instances and a strengthened
    // exit condition. The cheaper reading wins by default, which is not a decision anyone made.
    const carriers = filesContaining(/^\|\s*`--max`\s*\|\s*×\s*2\s*/m);
    expect(carriers.length, "no shipped file carries the review-fix-loop --max row").toBeGreaterThan(0);
    const offenders: string[] = [];
    for (const [rel, text] of carriers) {
      for (const line of text.split(/\r?\n/)) {
        if (!/^\|\s*`--max`\s*\|\s*×\s*2/.test(line)) continue;
        if (!/동시|병렬|순차/.test(line)) offenders.push(`${rel}: ${line.trim().slice(0, 90)}`);
      }
    }
    expect(offenders, "a --max multiplier is left undefined between its two readings").toEqual([]);
  });

  it("the round-cap options name the counters they replace", () => {
    const carriers = filesContaining(/`--mini` \/ `--loops N` 옵션 SSOT/).filter(([rel]) => rel.includes("kiwi-coder"));
    expect(carriers.length, "kiwi-coder no longer declares the options anywhere").toBeGreaterThan(0);
    for (const [rel, text] of carriers) {
      const declaration = text.split(/\r?\n/).find((line) => /`--mini` \/ `--loops N` 옵션 SSOT/.test(line)) ?? "";
      expect(
        /시니어|까칠|검증자|카운터/.test(declaration),
        `${rel} declares the options without naming which counter they bound`
      ).toBe(true);
    }
  });
});

describe("FR-FLOW-147 — a pass that found nothing still leaves a record", () => {
  it.each(VARIANTS)("%s/kiwi-coder persists each verification pass, including the empty ones", (variant) => {
    const text = skill(variant, "kiwi-coder") ?? "";
    expect(text, "kiwi-coder is missing").not.toBe("");
    // Silence has to be distinguishable from absence. A record written only when there are findings
    // reproduces exactly the ambiguity that made the catch census unable to conclude anything.
    expect(text, "nothing requires the pass output to be persisted").toMatch(/docs\/analysis/);
    expect(text, "an empty result is not required to be recorded").toMatch(
      /finding 0\s*건.*기록|0\s*건이어도|findings\s*가?\s*없어도/
    );
  });
});
