import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

// @req FR-NODE-312 AC-5 — the id a caller chose appears between the check and the write: the call is
// refused and never moved to another number. The window is made deterministic by wrapping the parser:
// with skipLock, add_requirement parses three times — the pre-lock check, the check at the start of the
// unlocked body, and the re-read just before the write. A competing block lands right after the second
// parse returns, so only the re-read can see it.

const SPEC_FILE = path.join("docs", "spec", "10.product-architecture.srs.md");
const race = vi.hoisted(() => ({ calls: 0, inject: undefined as undefined | (() => Promise<void>) }));

vi.mock("../../../src/core/parser/workspace-parser.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../src/core/parser/workspace-parser.js")>();
  return {
    ...original,
    parseWorkspace: async (...args: Parameters<typeof original.parseWorkspace>) => {
      const parsed = await original.parseWorkspace(...args);
      race.calls += 1;
      if (race.calls === 2 && race.inject) await race.inject();
      return parsed;
    }
  };
});

const { addRequirement } = await import("../../../src/core/mutation/add-requirement.js");
const { resolveProjectRoot } = await import("../../../src/core/project-root.js");

describe("FR-NODE-312 AC-5 — an id taken between the check and the write", () => {
  // @req FR-NODE-312 AC-5
  it("is refused with in-use, and no block under another number is written", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const specPath = path.join(rootPath, SPEC_FILE);
    const competing = ["", "### FR-ARCH-076 — Landed meanwhile", "", "| Field | Value |", "| --- | --- |", "| Type | functional |", "| Target | v1.0.0 |", "| Status | planned |", "| Stability | evolving |", "", "#### Requirement", "", "Another writer SHALL hold this id.", "", "#### Acceptance Criteria", "", "- [ ] AC-1: It exists.", ""].join("\n");
    race.calls = 0;
    race.inject = async () => {
      race.inject = undefined;
      await writeFile(specPath, `${(await readFile(specPath, "utf8")).trimEnd()}\n${competing}`, "utf8");
    };
    const result = await addRequirement(await resolveProjectRoot(rootPath), {
      type: "functional",
      scope: "ARCH",
      target: "v1.0.0",
      title: "Chosen id",
      statement: "SpecKiwi SHALL keep the requirement the lane reserved.",
      acceptanceCriteria: ["The requirement can be listed."],
      stability: "evolving",
      requirementId: "FR-ARCH-076",
      skipLock: true
    });
    expect(race.calls, "the re-read before the write ran").toBeGreaterThanOrEqual(3);
    expect(result.ok).toBe(false);
    expect(result.error?.message).toContain("check: in-use");
    const headings = (await readFile(specPath, "utf8")).split(/\r?\n/).filter((line) => line.startsWith("### FR-ARCH-"));
    expect(headings).toEqual(["### FR-ARCH-001 — Mutable requirement", "### FR-ARCH-076 — Landed meanwhile"]);
  });
});
