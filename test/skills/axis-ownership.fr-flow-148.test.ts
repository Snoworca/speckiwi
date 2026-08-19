import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "./kiwi-orchestrator-variants.js";

// @req FR-FLOW-148 — one subject, one owner.
//
// Two overlaps, found from opposite directions. A committee member reviewing a different question
// noticed the mock prohibition sits in the intent axis's subject AND is the technical axis's
// blocking condition, so one defect raises two criticals a senior then has to reconcile. The second
// overlap was created by FR-FLOW-143: criterion-reference correctness moved to a script while the
// intent axis went on naming it, which invites a judge to re-decide exactly what stopped being judged.

const COPIES = [
  ["skills/claude", "skills/claude/kiwi-coder/SKILL.md"],
  ["skills/codex", "skills/codex/kiwi-coder/SKILL.md"],
  ["skills/etc", "skills/etc/kiwi-coder/SKILL.md"],
  [".agents mirror", ".agents/skills/kiwi-coder/SKILL.md"]
] as const;

function body(relPath: string): string {
  return readFileSync(path.join(REPO_ROOT, relPath), "utf8");
}

/** The intent axis row of the Phase 1 verification table. */
function intentRow(text: string): string {
  return text.split(/\r?\n/).find((line) => /^\|\s*\*\*S1\*\*/.test(line)) ?? "";
}

/**
 * The severity list of §4.2 — the one that routes S1/S2 findings, which is what this requirement
 * moves ownership within.
 *
 * Anchored on §4.2 deliberately. This first read §5.3, the severity list of the Phase 2 prickly
 * review, which is a different table for a different stage with its own independent mock rule. The
 * consequence was exact: deleting `Mock 사용 (S2)` from §4.2 left the case green, because §5.3 was
 * untouched. The assertion proved nothing about the line it named.
 */
function severityLine(text: string, severity: string): string {
  const start = text.indexOf("### 4.2 ");
  expect(start, "§4.2 was not found").toBeGreaterThan(-1);
  const end = text.indexOf("\n### ", start + 1);
  const section = end < 0 ? text.slice(start) : text.slice(start, end);
  return section.split(/\r?\n/).find((line) => line.includes(`**${severity}**`)) ?? "";
}

describe("FR-FLOW-148 AC-1 — the mock prohibition has one owner", () => {
  it.each(COPIES)("%s does not also name it in the intent axis", (_label, relPath) => {
    const row = intentRow(body(relPath));
    expect(row, "the intent axis row was not found").not.toBe("");
    expect(row, "the intent axis still claims the mock prohibition").not.toMatch(/mock/i);
  });

  it.each(COPIES)("%s keeps it blocking under its remaining owner", (_label, relPath) => {
    // Ownership moves; severity does not. A narrowing that quietly stopped a defect from blocking
    // would be a different change than the one this requirement asks for.
    const critical = severityLine(body(relPath), "CRITICAL");
    expect(critical, "§4.2 declares no CRITICAL line").not.toBe("");
    expect(critical, "the mock prohibition stopped blocking").toMatch(/Mock/i);
    // And it must be attributed to the axis that now owns it, not left unowned.
    expect(critical, "the mock prohibition no longer names its owner").toMatch(/Mock 사용 \(S2\)/);
  });
});

describe("FR-FLOW-148 AC-2 — the intent axis does not re-decide what a script decides", () => {
  it.each(COPIES)("%s drops criterion-reference correctness from the intent axis", (_label, relPath) => {
    expect(intentRow(body(relPath)), "the intent axis still names ac_refs, which a script now decides").not.toMatch(
      /ac_refs/
    );
  });
});

describe("FR-FLOW-148 AC-3 — narrowing does not empty the axis", () => {
  it.each(COPIES)("%s leaves the intent axis the thing no script can decide", (_label, relPath) => {
    const row = intentRow(body(relPath));
    // What remains has to be the semantic question: does this test actually verify that criterion.
    expect(row, "the intent axis lost its subject entirely").toMatch(/AC|의도/);
    expect(row, "the intent axis no longer asks whether the test verifies the criterion").toMatch(/검증하는가|일치/);
  });
});
