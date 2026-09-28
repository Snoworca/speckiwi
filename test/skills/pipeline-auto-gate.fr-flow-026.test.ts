import { describe, expect, it } from "vitest";

import { tableRows } from "./kiwi-orchestrator-variants.js";
import { RENDERINGS, flat, skillSection } from "./kiwi-renderings.js";

// @req FR-FLOW-026 AC-3 — the inter-stage user gate of the kiwi-pipeline cycle is skipped only
// under `--auto` or when the user asks to run automatically, and even then a critical gate halts.
//
// `kiwi-pipeline-content.test.ts` holds the committee and the NEEDS_USER/FAILED halt. What it does
// not hold are the two clauses read here, each on the structure that states it: the natural-language
// row that turns a request to run automatically into `--auto`, and the §6.6 sentence that keeps the
// §0.AG critical gates halting under `--auto`.

function part(rendering: string, heading: RegExp): string {
  return skillSection(rendering, "kiwi-pipeline", heading);
}

describe("FR-FLOW-026 AC-3 — the inter-stage gate is skipped only under --auto or a request to run automatically", () => {
  it.each(RENDERINGS)("FR-FLOW-026 AC-3 %s: a user asking to run automatically maps onto --auto", (rendering) => {
    const rows = tableRows(part(rendering, /^###\s*1\.2\b/));
    const auto = rows.filter((row) => /^`--auto`/.test(row.cells[1] ?? ""));
    expect(auto.length, `${rendering}: §1.2 has no natural-language row for --auto`).toBe(1);
    const signals = auto[0]?.cells[0] ?? "";
    for (const signal of ['"자동"', '"묻지 말고"']) {
      expect(signals, `${rendering}: asking ${signal} does not turn the gates over to --auto`).toContain(signal);
    }
  });

  it.each(RENDERINGS)("FR-FLOW-026 AC-3 %s: without --auto the two-way gate runs between every pair of stages", (rendering) => {
    const lines = part(rendering, /^###\s*6\.1\b/).split("\n");
    const gate = lines.find((line) => /^- `--auto` 미지정 → `(?:AskUserQuestion|Codex clarification gate|User clarification gate)` 2지선다/.test(line)) ?? "";
    expect(gate, `${rendering}: §6.1 has no user gate for a run without --auto`).not.toBe("");
    const cycle = lines.find((line) => /^- 작업 입력을 실은 진입/.test(line)) ?? "";
    expect(cycle, `${rendering}: §6.1 does not say how the cycle entry treats the gate`).toMatch(
      /`--auto` 미지정이면 \*\*단계 사이마다 위 2지선다 게이트가 그대로 적용된다\*\*/
    );
    expect(cycle, `${rendering}: only --auto replaces the gate with the committee`).toMatch(/`--auto` 일 때만 그 게이트가 §6\.6 의 위원회로 대체된다/);
  });
});

describe("FR-FLOW-026 AC-3 — under --auto an existing critical gate still halts", () => {
  it.each(RENDERINGS)("FR-FLOW-026 AC-3 %s: §6.6 halts on a §0.AG critical gate even under --auto", (rendering) => {
    const text = flat(part(rendering, /^###\s*6\.6\b/));
    const halt = text.split(/(?<=다\.)\s+/).find((sentence) => /critical gate/.test(sentence)) ?? "";
    expect(halt, `${rendering}: §6.6 says nothing about the critical gates`).not.toBe("");
    expect(halt, `${rendering}: the halt is not keyed on the §0.AG critical gates`).toMatch(/§0\.AG 의 critical gate 에 도달하면/);
    expect(halt, `${rendering}: reaching a critical gate does not halt the cycle`).toMatch(/즉시 \*\*중단\*\*\(halt\)/);
    expect(halt, `${rendering}: the committee is allowed to decide a critical gate`).toMatch(/위원회 자동 결정을 우회하지 않고/);
    expect(halt, `${rendering}: --auto is allowed to override the halt`).toMatch(/`--auto` 라도 이 게이트는 항상 중단한다/);
  });

  it.each(RENDERINGS)("FR-FLOW-026 AC-3 %s: the §0.AG table the halt points at declares critical gates", (rendering) => {
    const rows = tableRows(part(rendering, /^###\s*§0\.AG\b/)).filter((row) => /^`[a-z-]+`$/.test(row.cells[0] ?? ""));
    expect(rows.length, `${rendering}: §0.AG declares no critical gate, so the halt has nothing to fire on`).toBeGreaterThan(0);
  });
});
