import { describe, expect, it } from "vitest";
import { parseStatusPaths } from "../../src/cli/commands/orchestrate-facts.js";

// FR-NODE-217 AC-2 — the host status paths `resume` collects from `git status --porcelain=v1 -z`.

describe("FR-NODE-217 AC-2 host status paths", () => {
  it("FR-NODE-217 AC-2 reads one path per entry and the source of a rename or copy whole", () => {
    const output = " M src/a.ts\0R  new.ts\0old.ts\0?? notes.md\0C  copy.ts\0orig.ts\0";
    expect(parseStatusPaths(output)).toEqual(["src/a.ts", "new.ts", "old.ts", "notes.md", "copy.ts", "orig.ts"]);
  });

  it("FR-NODE-217 AC-2 reads an empty status as no paths", () => {
    expect(parseStatusPaths("")).toEqual([]);
  });
});
