import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { mirrorSkills } from "../../src/core/skills/mirror-skills.js";
import { RENDERINGS, readRepoFile } from "./kiwi-renderings.js";

// @req FR-FLOW-192 AC-7 @req FR-FLOW-196 AC-7 — after the 4.1.0 skill changes the `.agents/skills`
// mirror matches `skills/codex`, checked with the same code `speckiwi skills mirror --check` runs, and
// the kiwi-tdd suites read each of the four renderings on its own bytes.

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("FR-FLOW-192 AC-7 · FR-FLOW-196 AC-7 — the mirror shows zero divergence", () => {
  it("FR-FLOW-192 AC-7 / FR-FLOW-196 AC-7: speckiwi skills mirror --check reports zero divergence against skills/codex", async () => {
    const result = await mirrorSkills({ projectRoot: REPO_ROOT, mode: "check" });
    expect(result.divergences, "the .agents/skills mirror diverges from skills/codex").toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.written, "a --check run must write nothing").toEqual([]);
  });

  it("FR-FLOW-196 AC-7: the four kiwi-tdd renderings are each read on their own bytes", () => {
    expect([...RENDERINGS].sort()).toEqual([".agents/skills", "skills/claude", "skills/codex", "skills/etc"]);
    for (const rendering of RENDERINGS) {
      expect(readRepoFile(`${rendering}/kiwi-tdd/SKILL.md`), `${rendering}/kiwi-tdd/SKILL.md is missing`).not.toBe("");
    }
  });
});
