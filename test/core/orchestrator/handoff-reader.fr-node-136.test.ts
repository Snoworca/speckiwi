// `readHandoff` — the one front-matter reader, and the producer of `ParsedHandoff`.
//
// `ParsedHandoff` was declared on `substrate.ts` because no producer existed when
// `planStageCoupling` was written (05 §10.1). `handoff.ts` is that producer: it already parses the
// §6.1 front matter for `validateHandoff`'s five layers, and a second reader in the CLI would be two
// spellings of one concept. The type therefore lives with the parser and `substrate.ts` imports it.
//
// The coupling behaviour itself is FR-NODE-136's own suite; what is asserted here is only that the
// reader emits the seven declared fields and that `planStageCoupling` consumes them unmodified.

import { describe, expect, it } from "vitest";
import { readHandoff, type ParsedHandoff } from "../../../src/core/orchestrator/handoff.js";
import { planStageCoupling } from "../../../src/core/orchestrator/substrate.js";
import { defaultHandoff, handoffWith, renderBody, defaultSections, MODULE_PATH, TEST_PATH, READ_A, READ_B } from "./handoff-fixtures.js";

describe("readHandoff — the seven declared ParsedHandoff fields", () => {
  it("produces every field of the declared shape from a worked-example handoff", () => {
    const parsed = readHandoff(defaultHandoff());
    expect(parsed).not.toBeNull();

    const fields: Record<keyof ParsedHandoff, true> = { kind: true, lane: true, wave: true, stage: true, frontMatter: true, headings: true, body: true };
    expect(Object.keys(parsed as ParsedHandoff).sort()).toEqual(Object.keys(fields).sort());
  });

  it("reads the coordinates as their declared types", () => {
    const parsed = readHandoff(defaultHandoff()) as ParsedHandoff;

    expect(parsed.kind).toBe("lane");
    expect(parsed.lane).toBe("lane-3");
    expect(parsed.wave).toBe(2);
    expect(parsed.stage).toBe(2);
    expect(parsed.frontMatter.write_set).toEqual([MODULE_PATH, TEST_PATH]);
    expect(parsed.frontMatter.read_set).toEqual([READ_A, READ_B]);
    expect(parsed.body).toContain("## Objective");
  });

  it("carries the ten body headings in source order", () => {
    const parsed = readHandoff(defaultHandoff()) as ParsedHandoff;
    expect(parsed.headings).toEqual(["Setup", "Objective", "Context", "Interfaces", "Tasks", "Acceptance", "Constraints", "Out of scope", "Manifest", "Escalation"]);
  });

  it("reads an epilogue handoff's null stage as null rather than as a string", () => {
    const text = handoffWith({ handoff_kind: 'handoff_kind: "epilogue"', stage: "stage: null", lane: 'lane: "epilogue"' });
    const parsed = readHandoff(text) as ParsedHandoff;

    expect(parsed.kind).toBe("epilogue");
    expect(parsed.stage).toBeNull();
  });

  it("returns null for a document carrying no closed front-matter block", () => {
    expect(readHandoff("## Setup\n\nNo front matter here.\n")).toBeNull();
  });
});

describe("readHandoff — planStageCoupling consumes its output with no second parser", () => {
  it("finds the coupling between a lane that writes a path and a lane that reads it", () => {
    const writer = readHandoff(defaultHandoff()) as ParsedHandoff;

    const readerText = handoffWith(
      {
        lane: 'lane: "lane-4"',
        write_set: ["write_set:", '  - "src/core/orchestrator/consumer.ts"'].join("\n"),
        read_set: ["read_set:", `  - "${MODULE_PATH}"`].join("\n")
      },
      renderBody(defaultSections())
    );
    const reader = readHandoff(readerText) as ParsedHandoff;

    const { couplings } = planStageCoupling([writer, reader]);
    expect(couplings).toEqual([{ path: MODULE_PATH, fromLane: "lane-3", toLane: "lane-4" }]);
  });
});
