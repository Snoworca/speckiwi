import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Round-4 verification: kiwi-prd gives every PRD item a `State` (confirmed | proposed | rejected),
// but the PRD verdicts that decide what the SRS may contain never read it. A requirement that cites a
// proposal the user REJECTED (e.g. "PostgreSQL·MySQL·Oracle 테이블 생성", State=rejected) still
// "cites a PRD item", so verdict (b) keeps it, and an in-scope item the user rejected still demands a
// citing requirement under verdict (a).

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const RENDERINGS = ["skills/claude", "skills/codex", "skills/etc", ".agents/skills"] as const;
const JUDGES = ["kiwi-srs", "kiwi-tdd", "kiwi-orchestrator"] as const;

function coreBlock(rel: string): string {
  const text = readFileSync(path.join(REPO_ROOT, rel), "utf8").replace(/\r\n/g, "\n");
  const start = text.search(/^## (핵심 규칙|Core rule)/m);
  expect(start, `precondition: core block in ${rel}`).toBeGreaterThanOrEqual(0);
  // The block ends at the next `---` rule or the next `## ` heading, whichever comes first.
  const ends = [text.indexOf("\n---\n", start), text.indexOf("\n## ", start + 1)].filter((at) => at >= 0);
  return text.slice(start, ends.length ? Math.min(...ends) : text.length);
}

describe("PRD verdicts honour the item State (verify-r4)", () => {
  it("precondition: kiwi-prd defines a rejected State", () => {
    const prd = readFileSync(path.join(REPO_ROOT, "skills/claude/kiwi-prd/SKILL.md"), "utf8");
    expect(prd).toMatch(/`State` 는 `confirmed` · `proposed` · `rejected`/);
  });

  for (const root of RENDERINGS) {
    for (const skill of JUDGES) {
      const rel = `${root}/${skill}/SKILL.md`;
      if (!existsSync(path.join(REPO_ROOT, rel))) continue;
      // @req FR-FLOW-205 AC-5 — a requirement grounded only on a rejected PRD item must not survive (b)
      it(`${rel}: the PRD verdict says what a rejected item grounds`, () => {
        expect(coreBlock(rel)).toMatch(/rejected/);
      });
    }
  }
});
