import { describe, expect, it } from "vitest";

import { section, tableRows } from "./kiwi-orchestrator-variants.js";
import { RENDERINGS, readRepoFile, skillFiles } from "./kiwi-renderings.js";

// @req FR-FLOW-035 — each orchestrator forwards `--mini` / `--loops N` to the kiwi children it spawns,
// and the shared loop-option contract carries the propagation table. Each check reads the sentence or
// table row that states one hop, in every rendering and the `.agents` mirror.

/** Every line of every document the skill ships in this rendering. */
function lines(rendering: string, skill: string): string[] {
  return skillFiles(rendering, skill).flatMap((doc) => doc.text.replace(/\r\n/g, "\n").split("\n"));
}

function hasLine(rendering: string, skill: string, re: RegExp): boolean {
  return lines(rendering, skill).some((line) => re.test(line));
}

describe("FR-FLOW-035 — each orchestrator states the hop it forwards the loop flags on", () => {
  it.each(RENDERINGS)("FR-FLOW-035 AC-1: %s/kiwi-pm forwards --mini / --loops N into the kiwi-coder spawn prompt", (rendering) => {
    expect(hasLine(rendering, "kiwi-pm", /LOOP_FLAGS=\{forward --mini \/ --loops N round-cap to the kiwi-coder child\}/)).toBe(true);
  });

  it.each(RENDERINGS)("FR-FLOW-035 AC-2: %s/kiwi-pipeline forwards them to every kiwi sub-skill it spawns", (rendering) => {
    expect(hasLine(rendering, "kiwi-pipeline", /`--mini`\/`--loops N` 를 spawn 하는 모든 kiwi 하위 스킬에 전파/)).toBe(true);
  });

  it.each(RENDERINGS)("FR-FLOW-035 AC-4: %s/kiwi-hot-fix forwards them to its kiwi-srs-sync delegation", (rendering) => {
    expect(hasLine(rendering, "kiwi-hot-fix", /`--mini`\/`--loops N` (?:는 kiwi-srs-sync 위임에 전파|propagate to the `\$?kiwi-srs-sync` delegation)/)).toBe(true);
  });

  it.each(RENDERINGS)("FR-FLOW-035 AC-5: %s/kiwi-coder forwards them to its kiwi-review-fix-loop follow-up", (rendering) => {
    expect(hasLine(rendering, "kiwi-coder", /`--mini`\/`--loops N` 는 kiwi-review-fix-loop follow-up 에 전파/)).toBe(true);
  });
});

describe("FR-FLOW-035 AC-7 — loop-option.md §6 carries the child-propagation table in every copy", () => {
  // [orchestrator, the child cell must name, the propagation cell must name]
  const HOPS: ReadonlyArray<readonly [string, RegExp]> = [
    ["kiwi-pm", /kiwi-coder/],
    ["kiwi-pipeline", /모든 spawn 하위 스킬|every spawned sub-skill/],
    ["kiwi-hot-fix", /kiwi-srs-sync/],
    ["kiwi-coder", /kiwi-review-fix-loop/]
  ];

  it.each(RENDERINGS)("FR-FLOW-035 AC-7: %s/_shared/kiwi/loop-option.md §6 names each hop and both flags", (rendering) => {
    const six = section(readRepoFile(`${rendering}/_shared/kiwi/loop-option.md`).replace(/\r\n/g, "\n"), /^##\s*6\./);
    expect(six, `${rendering}: loop-option.md has no §6`).not.toBe("");
    for (const [orchestrator, child] of HOPS) {
      const row = tableRows(six).find((entry) => entry.cells[0] === orchestrator);
      expect(row, `${rendering}: §6 has no ${orchestrator} row`).toBeDefined();
      expect(row?.cells[1] ?? "", `${rendering}: the ${orchestrator} row names the wrong child`).toMatch(child);
      expect(row?.cells[2] ?? "", `${rendering}: the ${orchestrator} row does not propagate both flags`).toContain("`--mini`/`--loops N`");
    }
  });
});
