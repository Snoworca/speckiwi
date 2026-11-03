import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { COMPACTION_TOKEN_BUDGET, tokensThrough } from "./skill-token-estimate.js";

// @req FR-FLOW-206 AC-4 — every check that inspects a fixer diff and would halt the run also inspects a
// clean-code fix; when it trips on one, the fix is reverted and the finding marked `unresolved` with the
// check's reason, and no gate is raised. The gates that inspect a fixer diff are read from each
// rendering's own critical_gates table (by their location cell), so a new fix-diff gate added to the table
// without the clean-code exception turns this red. The safety boundary for functional fixes stays.

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const read = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8").replace(/\r\n/g, "\n");

const RENDERINGS = ["skills/claude", "skills/codex", "skills/etc", ".agents/skills"] as const;
const CLAUDE = "skills/claude";

/** Location cells of the critical_gates rows that inspect a fixer diff, per rendering family. */
const FIX_DIFF_LOCATION = { claude: /§6\.2|§0\.G4|§0\.G6/, other: /fix scan|fix gate|review loop/ } as const;

const BLOCK_REVERT =
  "보존 스캔(보존 스캔 절, §0.17)과 그 밖에 fixer diff 를 검사하는 게이트도 모든 클린 코드 수정을 검사한다 — 클린 코드 수정이 기존 public 심볼을 지우거나 시그니처를 바꾸거나, 기존 테스트 케이스를 지우거나 약화하거나, 비-테스트 기존 파일을 지우거나 옮기거나(`existing-public-contract-change` · `existing-test-weakened-or-deleted` · `existing-file-deleted-or-moved`), Mock 탐지(`mock-detection`)나 cwd 외부 path 검사(`external-module-impact`)에 걸리면 그 수정을 되돌리고, 그 지적을 걸린 게이트와 스캔 사유와 함께 `unresolved` 로 표시하며, 그 게이트를 올리지 않고 실행을 멈추지 않는다.";
const BLOCK_DIVERGENCE =
  "되돌린 클린 코드 수정은 kept finding 이 아니므로 개선 루프 발산 게이트(`improvement-loop-divergence-4opt`)의 횟수에 세지 않는다.";
const SCAN_POINTER =
  "클린 코드 수정에서 검출된 경우만 예외다 — 게이트로 중단하지 않고 클린 코드 라운드 블록의 **테스트.** 규칙대로 그 수정을 되돌리고 `unresolved` 로 표시한다. 기능 결함 수정과 채우기 서브에이전트의 diff 에는 위 중단이 그대로 적용된다.";
const GATE_POINTER =
  "**클린 코드 수정은 이 표의 게이트를 올리지 않는다**: 클린 코드 수정이 `existing-public-contract-change` · `existing-test-weakened-or-deleted` · `existing-file-deleted-or-moved` · `mock-detection` · `external-module-impact` · `improvement-loop-divergence-4opt` 에 걸리면 클린 코드 라운드 블록의 **테스트.** 규칙대로 되돌리고 `unresolved` 로 표시하며 실행을 멈추지 않는다. 기능 결함 수정과 채우기 서브에이전트의 diff 에는 이 표가 그대로 적용된다.";
const CLAUDE_FIX_POINTER =
  "클린 코드 수정이 위 두 검사에 걸리면 중단하지 않는다 — §0.G8 의 클린 코드 예외(클린 코드 라운드 블록의 **테스트.**)를 따른다.";
const REF_SCAN_POINTER =
  "  (a clean-code fix that trips it is reverted and marked `unresolved` instead, without halting; SKILL.md 클린 코드 라운드 block)";
const REF_DIVERGENCE_POINTER =
  "A reverted clean-code fix does not count toward these gates (SKILL.md 클린 코드 라운드 block).";

/** gate_id cells of the critical_gates rows whose location cell names a fixer-diff check. */
function fixDiffGates(text: string, root: string): string[] {
  const where = root === CLAUDE ? FIX_DIFF_LOCATION.claude : FIX_DIFF_LOCATION.other;
  return text
    .split("\n")
    .map((line) => /^\| `([a-z0-9-]+)` \|.*\| ([^|]+) \|$/.exec(line))
    .filter((m): m is RegExpExecArray => m !== null && where.test(m[2]))
    .map((m) => m[1]);
}

describe("FR-FLOW-206 AC-4 — a clean-code fix that trips a fixer-diff check is reverted, never halts", () => {
  for (const root of RENDERINGS) {
    const skill = `${root}/kiwi-review-fix-loop/SKILL.md`;

    // @req FR-FLOW-206 AC-4
    it(`${root}: the clean-code block states the revert rule within ${COMPACTION_TOKEN_BUDGET} estimated tokens`, () => {
      const text = read(skill);
      const block = text.slice(text.indexOf("## 클린 코드 라운드"));
      const testPara = block.split("\n").find((l) => l.startsWith("**테스트.**")) ?? "";
      expect(testPara).toContain(BLOCK_REVERT);
      expect(testPara).toContain(BLOCK_DIVERGENCE);
      expect(tokensThrough(text, BLOCK_DIVERGENCE)).toBeGreaterThan(0);
      expect(tokensThrough(text, BLOCK_DIVERGENCE)).toBeLessThanOrEqual(COMPACTION_TOKEN_BUDGET);
    });

    // @req FR-FLOW-206 AC-4 — inventory: every fixer-diff gate of the table is covered by the block and the gate note.
    it(`${root}: every fixer-diff gate of the critical_gates table is named by the block and the gate note`, () => {
      const text = read(skill);
      const gates = fixDiffGates(text, root);
      expect(gates.sort()).toEqual(
        [
          "existing-file-deleted-or-moved",
          "existing-public-contract-change",
          "existing-test-weakened-or-deleted",
          "external-module-impact",
          "improvement-loop-divergence-4opt",
          "mock-detection",
        ].sort(),
      );
      for (const gate of gates) {
        expect(`${BLOCK_REVERT} ${BLOCK_DIVERGENCE}`, `block misses ${gate}`).toContain(`\`${gate}\``);
        expect(GATE_POINTER, `gate note misses ${gate}`).toContain(`\`${gate}\``);
      }
      expect(text.split("\n").filter((l) => l === GATE_POINTER)).toHaveLength(1);
    });

    // @req FR-FLOW-206 AC-4 — the preservation-scan section points at the block and keeps its halt for other fixes.
    it(`${root}: the preservation-scan section carries the clean-code exception and keeps its halt`, () => {
      const text = read(skill);
      const at = text.indexOf("### 보존 스캔 (fixer diff, §0.17)");
      expect(at).toBeGreaterThan(0);
      const section = text.slice(at, text.indexOf("\n#", at + 10));
      expect(section).toMatch(/기존 public 심볼의 삭제·시그니처 변경[^\n]*중단한다/);
      expect(section.split("\n")).toContain(SCAN_POINTER);
    });

    if (root === CLAUDE) {
      // @req FR-FLOW-206 AC-4 — the Phase 4 mock and cwd-external halts point at the same exception.
      it(`${root}: Phase 4 mock and cwd-external halts point at the clean-code exception`, () => {
        const lines = read(skill).split("\n");
        const ext = lines.indexOf("cwd 외부 path 편집 시도 (§0.5 / §0.G4) — 즉시 중단.");
        expect(ext).toBeGreaterThan(0);
        expect(lines[ext + 2]).toBe(CLAUDE_FIX_POINTER);
      });
    } else {
      const ref = `${root}/kiwi-review-fix-loop/references/extended-workflow.md`;
      // @req FR-FLOW-206 AC-4 — the reference exit criteria and repeated-failure gates point at the block.
      it(`${root}: the reference exit criteria and repeated-failure gates carry the clean-code exception`, () => {
        const lines = read(ref).split("\n");
        const halt = lines.indexOf("  보존 스캔 section); a detection is CRITICAL and halts through its gate");
        expect(halt).toBeGreaterThan(0);
        expect(lines[halt + 1]).toBe(REF_SCAN_POINTER);
        const table = lines.indexOf("| same regression file fails twice | user decision |");
        expect(table).toBeGreaterThan(0);
        expect(lines[table + 2]).toBe(REF_DIVERGENCE_POINTER);
      });
    }
  }
});
