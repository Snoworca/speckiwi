import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  BUNDLED_SKILL_VARIANTS,
  MARKER,
  PLACEHOLDER_FORMS,
  buildProgram,
  countOccurrences,
  extractInvocations,
  resolveCitation,
  type CitationFailure,
  type SkillInvocation
} from "../support/skill-citations.js";

// @req FR-NODE-128 — every `speckiwi` invocation cited in a bundled SKILL.md resolves against the
// real command tree.
//
// The tree is built with `buildCommand` and walked with `outputHelp()`. `program.parse()` is never
// called: commander has no parse-only mode, so parsing would execute action handlers, which in this
// repository would trip the hermeticity guards.
//
// The extractor and the resolver live in `test/support/skill-citations.ts` because FR-FLOW-179 AC-2
// measures the same citations over a reader that follows a progressive-disclosure pointer. Two
// copies of a resolver drift, and the one that drifts is the lenient one.

async function bundledSkillBodies(skill: string): Promise<Array<{ file: string; body: string }>> {
  const bodies: Array<{ file: string; body: string }> = [];
  for (const variant of BUNDLED_SKILL_VARIANTS) {
    const candidate = path.join(process.cwd(), variant, skill, "SKILL.md");
    try {
      bodies.push({ file: `${variant}/${skill}/SKILL.md`, body: await readFile(candidate, "utf8") });
    } catch {
      // A missing body is reported by the count assertion below rather than swallowed here.
    }
  }
  return bodies;
}

describe("FR-NODE-128 AC-1 / AC-2 — a measured invocation floor, per variant", () => {
  it("extracts, from each of the three variants, exactly its own count of `speckiwi ` occurrences", async () => {
    const bodies = await bundledSkillBodies("kiwi-orchestrator");
    expect(bodies.map((entry) => entry.file), "all three bundled variants must exist").toHaveLength(
      BUNDLED_SKILL_VARIANTS.length
    );

    for (const { file, body } of bodies) {
      expect(body.trim().length, `${file} must not be empty`).toBeGreaterThan(0);
      const extracted = extractInvocations(file, body);
      // Measured from the same body at test time; no numeric literal stands in for it.
      expect(extracted.length, `${file} extraction count`).toBe(countOccurrences(body, MARKER));
      expect(extracted.length, `${file} cites no speckiwi invocation`).toBeGreaterThan(0);
    }
  });

  it("fails a non-empty body from which zero invocations are extracted", () => {
    const body = "# kiwi-orchestrator\n\nThis body cites no command at all.\n";

    expect(body.trim().length).toBeGreaterThan(0);
    expect(extractInvocations("fixture", body)).toHaveLength(0);
    expect(countOccurrences(body, MARKER)).toBe(0);
  });
});

describe("FR-NODE-128 AC-3 — every cited verb and flag resolves against the walked tree", () => {
  it("rejects a fabricated verb and a fabricated flag, and accepts a real citation", () => {
    const program = buildProgram();

    // The negative fixture, observable before the real body is authored: a phase-2 verb.
    const fabricatedVerb = extractInvocations("fixture", "run `speckiwi orchestrate lane status --json`\n");
    expect(fabricatedVerb).toHaveLength(1);
    expect(resolveCitation(program, fabricatedVerb[0] as SkillInvocation)?.reason).toMatch(/does not resolve against the command tree/);

    const fabricatedFlag = extractInvocations("fixture", "run `speckiwi orchestrate validate --skip-validation`\n");
    expect(resolveCitation(program, fabricatedFlag[0] as SkillInvocation)?.reason).toMatch(/not declared on the cited command/);

    const real = extractInvocations("fixture", "run `speckiwi orchestrate validate --strict --json`\n");
    expect(resolveCitation(program, real[0] as SkillInvocation)).toBeNull();

    const alternation = extractInvocations("fixture", "run `speckiwi orchestrate run lock|unlock|status --json`\n");
    expect(resolveCitation(program, alternation[0] as SkillInvocation)).toBeNull();
  });

  it("resolves every citation of every bundled variant", async () => {
    const program = buildProgram();
    const failures: CitationFailure[] = [];
    for (const { file, body } of await bundledSkillBodies("kiwi-orchestrator")) {
      for (const invocation of extractInvocations(file, body)) {
        const failure = resolveCitation(program, invocation);
        if (failure) failures.push(failure);
      }
    }
    expect(failures).toEqual([]);
  });
});

describe("FR-NODE-128 AC-4 — the thirteen-form placeholder table", () => {
  it("declares thirteen forms and rejects a token outside the set rather than normalising it", () => {
    expect(PLACEHOLDER_FORMS).toHaveLength(13);

    const program = buildProgram();
    const outside = extractInvocations("fixture", "run `speckiwi orchestrate journal append <not-a-declared-form>`\n");
    expect(resolveCitation(program, outside[0] as SkillInvocation)?.reason).toMatch(/outside the declared table/);

    const declared = extractInvocations("fixture", "run `speckiwi orchestrate journal append <payload>`\n");
    expect(resolveCitation(program, declared[0] as SkillInvocation)).toBeNull();
  });
});

describe("FR-NODE-128 AC-5 — the harness builds and walks, it never parses", () => {
  it("resolves every citation with outputHelp() while parse and parseAsync are booby-trapped", () => {
    // Behavioural rather than textual: a source scan for `parse(` would match its own assertion, and
    // this repository has already shipped one guard that could never fire. Every command of the tree
    // gets a throwing parse; the resolution below then proves no action handler could have executed.
    const program = buildProgram();
    let helpCalls = 0;
    const trap = (): never => {
      throw new Error("the citation harness must never parse the command tree");
    };
    const arm = (command: typeof program): void => {
      Object.assign(command, { parse: trap, parseAsync: trap });
      const realOutputHelp = command.outputHelp.bind(command);
      Object.assign(command, {
        outputHelp: (...args: Parameters<typeof program.outputHelp>) => {
          helpCalls += 1;
          return realOutputHelp(...args);
        }
      });
      for (const sub of command.commands) arm(sub);
    };
    arm(program);

    const citation = extractInvocations("fixture", "run `speckiwi orchestrate validate --strict --json`");
    expect(resolveCitation(program, citation[0] as SkillInvocation)).toBeNull();
    expect(helpCalls, "the tree is walked with outputHelp()").toBeGreaterThan(0);

    // The trap itself is live, so the absence of a throw above is evidence rather than luck.
    expect(() => (program as unknown as { parse: () => void }).parse()).toThrow(/never parse/);
  });
});
