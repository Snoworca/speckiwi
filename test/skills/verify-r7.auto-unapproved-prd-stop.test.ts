import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Round-7 verification: kiwi-srs and kiwi-tdd stop `NEEDS_USER` when handed a PRD whose `Status`
// row is not the approved value (the only exception is a PRD kiwi-prd itself made under `--auto`).
// Under `--auto`, `_shared/kiwi/auto-option.md` §0 hands every NEEDS_USER that is not declared in
// the skill's `critical_gates[]` to the decision committee. Neither skill declares this stop, and the
// sentence carries no "also under --auto" clause (unlike `prd-record-tampered` and the residual stop),
// so `/kiwi-srs --auto PRD_PATH=<a PRD the user never approved>` lets the committee author from it.

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const RENDERINGS = ["skills/claude", "skills/codex", "skills/etc", ".agents/skills"] as const;
const read = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8").replace(/\r\n/g, "\n");

function criticalGateRows(text: string): string[] {
  const lines = text.split("\n");
  const at = lines.findIndex((l) => /^#{3,4} .*critical_gates\[\]/.test(l));
  expect(at, "precondition: critical_gates[] heading").toBeGreaterThanOrEqual(0);
  const rows: string[] = [];
  for (let i = at + 1; i < lines.length; i += 1) {
    if (lines[i].startsWith("|")) rows.push(lines[i]);
    else if (rows.length > 0) break;
  }
  return rows.filter((r) => r.startsWith("| `"));
}

/** The sentence that stops on a non-approved PRD, from its start to the end of that sentence. */
function unapprovedStopSentence(text: string): string {
  const at = text.search(/`Status` 행이 승인 값(\([^)]*\))?이 아닌 PRD 로는/);
  expect(at, "precondition: the non-approved-PRD stop sentence").toBeGreaterThanOrEqual(0);
  const stop = text.indexOf("`NEEDS_USER`", at);
  expect(stop, "precondition: the stop is NEEDS_USER").toBeGreaterThan(at);
  const end = text.indexOf("다.", stop);
  return text.slice(at, end < 0 ? text.length : end + 2);
}

describe("a non-approved PRD stays with the user under --auto (verify-r7)", () => {
  for (const root of RENDERINGS) {
    for (const skill of ["kiwi-srs", "kiwi-tdd"] as const) {
      const text = read(`${root}/${skill}/SKILL.md`);
      // @req FR-FLOW-205 AC-1 — SHALL NOT author from a PRD that is neither approved nor an --auto PRD, and SHALL end NEEDS_USER instead
      it(`${root}/${skill}: the non-approved-PRD stop survives --auto`, () => {
        const sentence = unapprovedStopSentence(text);
        const saysAlsoUnderAuto = /`--auto` 에서도|--auto 에서도/.test(sentence);
        const declared = criticalGateRows(text).some((r) => /PRD/.test(r) && /승인|unapproved|approv/i.test(r));
        expect(saysAlsoUnderAuto || declared).toBe(true);
      });
    }
  }
});
