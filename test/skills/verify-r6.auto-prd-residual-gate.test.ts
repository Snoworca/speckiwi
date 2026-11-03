import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Round-6 verification: under `--auto`, `_shared/kiwi/auto-option.md` §0 hands every NEEDS_USER gate
// that is not declared in the skill's `critical_gates[]` to the decision committee (§2.4.1 item 2).
// kiwi-srs ends NEEDS_USER on a PRD-verdict residual (a requirement the verifier calls necessary
// without naming the hole it fills), and kiwi-tdd stops NEEDS_USER on the same case in (b). Neither
// declares that stop as a critical gate, so under `--auto` the committee may keep the ungrounded
// requirement — the RBAC expansion path. kiwi-review-fix-loop, whose keep/drop/residual shape
// FR-FLOW-205 reuses, does declare its residual as `residual-finding-user-decision`.

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const RENDERINGS = ["skills/claude", "skills/codex", "skills/etc", ".agents/skills"] as const;
const read = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8").replace(/\r\n/g, "\n");

/** The table rows that follow the `critical_gates[]` heading. */
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

const coreBlock = (text: string): string => {
  const start = text.search(/^## 핵심 규칙/m);
  expect(start, "precondition: core block").toBeGreaterThanOrEqual(0);
  return text.slice(start, text.indexOf("\n---\n", start));
};

describe("a PRD-verdict residual stays with the user under --auto (verify-r6)", () => {
  for (const root of RENDERINGS) {
    const srs = read(`${root}/kiwi-srs/SKILL.md`);
    it(`${root}/kiwi-srs: precondition — a residual ends NEEDS_USER`, () => {
      expect(coreBlock(srs)).toMatch(/residual 이 하나라도 남으면 kiwi-srs 는 `NEEDS_USER`/);
    });
    // @req FR-FLOW-205 AC-7 — a residual ends NEEDS_USER; under --auto an undeclared NEEDS_USER goes to the committee
    it(`${root}/kiwi-srs: the PRD residual stop is a declared critical gate`, () => {
      expect(criticalGateRows(srs).some((r) => /residual/.test(r))).toBe(true);
    });

    const tdd = read(`${root}/kiwi-tdd/SKILL.md`);
    it(`${root}/kiwi-tdd: precondition — (b) stops NEEDS_USER on an unnamed hole`, () => {
      expect(coreBlock(tdd)).toMatch(/메우는 구멍을 대지 못하면 지우지 않고 `NEEDS_USER` 로 멈춘다/);
    });
    // @req FR-FLOW-204 AC-10 — kiwi-tdd judges with the verdicts of FR-FLOW-205 AC-4 to AC-6, whose residual is the user's
    it(`${root}/kiwi-tdd: the PRD residual stop is a declared critical gate`, () => {
      expect(criticalGateRows(tdd).some((r) => /PRD|residual/.test(r))).toBe(true);
    });
  }
});
