import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// verify-v534-r3 — FR-NODE-264, the etc rendering of `_shared/kiwi/waves-event.md`. Its unreachable-PASS
// rule sends the reader to a table for the `--max` streak. It used to name `kiwi-wave-master §5.5.4`,
// which has no such heading; the reference was corrected to `verify-loop.md` §5, where the table is.

describe("verify-v534-r3 FR-NODE-264", () => {
  it("the section etc waves-event.md names for the streak table is verify-loop.md §5, which exists and holds the streak numbers", () => {
    const wavesEvent = readFileSync("skills/etc/_shared/kiwi/waves-event.md", "utf8");
    const rule = wavesEvent.split("\n").find((line) => line.startsWith("**도달 불가한 PASS 탐지"));
    expect(rule).toBeDefined();
    expect(rule).toContain("`verify-loop.md` §5(종료 조건)의 표");
    expect(rule).not.toContain("kiwi-wave-master §5.5.4");

    const verifyLoop = readFileSync("skills/etc/_shared/kiwi/verify-loop.md", "utf8");
    const exit = verifyLoop.slice(verifyLoop.search(/^## 5\. 종료 조건/m));
    expect(verifyLoop).toMatch(/^## 5\. 종료 조건/m);
    expect(exit.slice(0, exit.indexOf("\n## ", 1) < 0 ? undefined : exit.indexOf("\n## ", 1))).toContain("스트릭 요구치는");
  });
});
