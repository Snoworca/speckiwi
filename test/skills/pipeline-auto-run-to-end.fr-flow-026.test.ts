import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { REPO_ROOT } from "./kiwi-orchestrator-variants.js";
import { RENDERINGS, flat, skillSection } from "./kiwi-renderings.js";

// @req FR-FLOW-026 AC-3 — under `--auto` every inter-stage gate is decided by the FR-FLOW-025
// committee (`_shared/kiwi/auto-option.md`) and the cycle runs to the end. Both clauses are held on
// the one §6.6 sentence that states the `--auto` behaviour, so moving either out of that sentence or
// reversing it turns this red.

function sentences(rendering: string): string[] {
  const body = skillSection(rendering, "kiwi-pipeline", /^###\s*6\.6\b/).split("\n").slice(1).join("\n");
  return flat(body).trim().split(/(?<=다\.)\s+/);
}

function autoSentence(rendering: string): string {
  return sentences(rendering).find((sentence) => /^작업 입력이 실린 호출에 `--auto` 가 붙으면/.test(sentence)) ?? "";
}

describe("FR-FLOW-026 AC-3 — under --auto the committee decides every gate and the cycle runs to the end", () => {
  it.each(RENDERINGS)("FR-FLOW-026 AC-3 %s: §6.6 hands every inter-stage gate to the auto-option.md decision committee", (rendering) => {
    const sentence = autoSentence(rendering);
    expect(sentence, `${rendering}: §6.6 has no sentence for a call carrying --auto`).not.toBe("");
    const committee = /단계 사이의 모든 게이트\(inter-stage gate\)는 `((?:\.\.\/)?_shared\/kiwi\/auto-option\.md)` 의 결정 위원회\(decision committee\)가 자동 결정하며/.exec(sentence);
    expect(committee, `${rendering}: under --auto the gates are not decided by the auto-option.md committee`).not.toBeNull();

    // The file the sentence names is the FR-FLOW-025 committee contract of this rendering.
    const contract = path.join(REPO_ROOT, rendering, "_shared", "kiwi", "auto-option.md");
    expect(existsSync(contract), `${rendering}: the committee contract the sentence names is missing`).toBe(true);
    expect(readFileSync(contract, "utf8")).toMatch(/^## (?:2\. 결정 위원회 토폴로지|Decision Committee)$/m);
  });

  it.each(RENDERINGS)("FR-FLOW-026 AC-3 %s: §6.6 runs the cycle to the end under --auto", (rendering) => {
    const sentence = autoSentence(rendering);
    expect(sentence, `${rendering}: under --auto the cycle does not run to the end`).toMatch(/, 사이클은 사용자 개입 없이 \*\*끝까지\*\*\(to the end\) 완주한다\.$/);
  });

  it.each(RENDERINGS)("FR-FLOW-026 AC-3 %s: §6.6 still halts under --auto when a sub-skill returns NEEDS_USER or FAILED", (rendering) => {
    const all = sentences(rendering);
    const halt = all[all.indexOf(autoSentence(rendering)) + 1] ?? "";
    expect(halt, `${rendering}: the sentence after the --auto rule does not halt on NEEDS_USER or FAILED`).toMatch(
      /^단, 어떤 하위 스킬이 `NEEDS_USER` 또는 `FAILED` 를 반환하거나 .*?위원회 자동 결정을 우회하지 않고 즉시 \*\*중단\*\*\(halt\)하여 사용자 결정을 받는다/
    );
  });
});
