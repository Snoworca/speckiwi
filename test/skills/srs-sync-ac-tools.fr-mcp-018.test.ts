import { describe, expect, it } from "vitest";
import { RENDERINGS, skillFiles } from "./kiwi-renderings.js";

// @req FR-MCP-018 AC-3 — append_section_note refuses the Acceptance Criteria table whatever spelling
// names it, so a skill that tells its agent to strengthen an AC with append_section_note sends every
// call into that refusal. kiwi-srs-sync did: its update row, its mutation order and (codex, etc) its
// example call with `"section": "Acceptance Criteria"` and a `note` argument the tool does not take.
// These rows hold that each rendering names the AC tools for that work and lists them as allowed.

function skillText(rendering: string): string {
  return skillFiles(rendering, "kiwi-srs-sync")
    .map((doc) => doc.text)
    .join("\n\n")
    .replace(/\r\n/g, "\n");
}

describe("FR-MCP-018 AC-3 — kiwi-srs-sync routes an AC change to the AC tools", () => {
  it.each(RENDERINGS)("%s: no line sends an acceptance criterion through append_section_note", (rendering) => {
    const lines = skillText(rendering).split("\n");
    const wrong = lines.filter((line) => line.includes("append_section_note") && /AC 보강|Acceptance Criteria|acceptance criteri/i.test(line));
    expect(wrong).toEqual([]);
    // An example call spreads the tool and its arguments over several lines, so the line check above
    // misses `"section": "Acceptance Criteria"` one line below `"tool": ...`. No section argument may
    // name a table append_section_note refuses, whichever line carries the tool name.
    expect(lines.filter((line) => /"section"\s*:\s*"(Acceptance Criteria|Verification Evidence|Trace Links|Change Notes)"/i.test(line))).toEqual([]);
  });

  it.each(RENDERINGS)("%s: the update row and the mutation order name append_acceptance_criterion", (rendering) => {
    const lines = skillText(rendering).split("\n");
    expect(lines.some((line) => line.startsWith("| **update** |") && line.includes("append_acceptance_criterion"))).toBe(true);
    expect(lines.some((line) => /^\d+\. `?append_acceptance_criterion/.test(line.trim()))).toBe(true);
  });

  // append_acceptance_criterion takes append_section_note's step one for one. A first draft inserted a
  // second AC step instead, and every pointer into the list by number went stale in three spellings
  // (`§10.1 step N`, `§10.1 N번`, a gate table row). Each of them must name the evidence step.
  it.each(RENDERINGS)("%s: the test-sufficiency gate points at the add_verification_evidence step", (rendering) => {
    const lines = skillText(rendering).split("\n");
    const step = lines.map((line) => /^(\d+)\. add_verification_evidence\b/.exec(line.trim())?.[1]).find((found) => found !== undefined);
    expect(step).toBeDefined();
    // Two shapes point at it: the claude `--auto` row (`§10.1 step N, _shared/kiwi/test-sufficiency.md`)
    // and the codex/etc gate table row (`| \`test-sufficiency-gap\` | … | Phase 7 — §10.1 step N |`).
    // The same line can name other steps (`§10.1 step 0`, validate_spec), so only these two are read.
    const text = skillText(rendering);
    const pointers = [
      ...[...text.matchAll(/§10\.1 step (\d+), _shared\/kiwi\/test-sufficiency\.md/g)].map((match) => match[1]),
      ...lines.filter((line) => line.startsWith("| `test-sufficiency-gap` |")).map((line) => /§10\.1 step (\d+) \|\s*$/.exec(line)?.[1]),
      ...[...text.matchAll(/§10\.1 (\d+)번의 테스트/g)].map((match) => match[1])
    ];
    expect(pointers.length).toBeGreaterThan(0);
    for (const pointer of pointers) expect(pointer).toBe(step);
  });

  it.each(RENDERINGS)("%s: the mutation permission row allows the AC tools it names", (rendering) => {
    const row = skillText(rendering)
      .split("\n")
      .find((line) => line.startsWith("| §0.10 |"));
    expect(row).toBeDefined();
    expect(row).toContain("`append_acceptance_criterion`");
    expect(row).not.toContain("`append_section_note`");
  });
});
