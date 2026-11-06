import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { requiredCleanStreak } from "../../src/core/orchestrator/journal-schema.js";

// verify-v534-r2 — FR-NODE-264 / FR-NODE-144 AC-4 prose. The etc rendering of waves-event.md states the
// Normal streak requirement used by the unreachable-PASS rule; the etc verify-loop.md and the engine
// (with the etc-local-llm profile every etc round carries) say otherwise.

const ROOT = path.resolve(__dirname, "..", "..");
const read = (relative: string) => readFileSync(path.join(ROOT, relative), "utf8");

function normalStreakIn(text: string, marker: RegExp): string | undefined {
  const line = text.split(/\r?\n/).find((entry) => marker.test(entry)) ?? "";
  return /Normal(?: 이)? \*\*(\d+)\*\*/.exec(line)?.[1];
}

describe("verify-v534-r2 FR-NODE-264 etc prose", () => {
  it("etc waves-event.md states the same Normal streak requirement as etc verify-loop.md and the engine", () => {
    const loop = normalStreakIn(read("skills/etc/_shared/kiwi/verify-loop.md"), /\*\*스트릭 요구치는\*\*/);
    const event = normalStreakIn(read("skills/etc/_shared/kiwi/waves-event.md"), /도달 불가한 PASS 탐지/);
    const engine = String(requiredCleanStreak("normal", "etc-local-llm"));

    expect(loop).toBe(engine);
    expect(event).toBe(engine);
  });
});
