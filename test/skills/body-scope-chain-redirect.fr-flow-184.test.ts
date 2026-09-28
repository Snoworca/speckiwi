import { describe, expect, it } from "vitest";

import { tableRows } from "./kiwi-orchestrator-variants.js";
import { RENDERINGS, markdownFiles, readRepoFile } from "./kiwi-renderings.js";

// @req FR-FLOW-184 — kiwi-planner is retired, and the skills that send body-scope work elsewhere
// send it to the `kiwi-srs → kiwi-sds` chain.
//
// AC-4 names kiwi-tdd, kiwi-hot-fix and kiwi-srs-sync. AC-2's "no skill names kiwi-planner as a step
// to invoke" is asserted here only for the four skills this suite's owner edits (those three and
// kiwi-review-fix-loop); the other skills are held by the suite that retires kiwi-planner itself.
//
// The redirect is read from TABLE ROWS — the boundary tables and kiwi-tdd's §0.7 rule row — because
// that is where each skill states where work goes, and a chain written only in passing prose is not
// a redirect. The mirror rows go red until `.agents/skills` is regenerated.

const REDIRECTING = ["kiwi-tdd", "kiwi-hot-fix", "kiwi-srs-sync"] as const;
const OWNED = [...REDIRECTING, "kiwi-review-fix-loop"] as const;

/** `kiwi-srs → kiwi-sds` in any rendering's spelling: bare, `/`-prefixed, `$`-prefixed, backticked. */
const CHAIN = /kiwi-srs`?\s*(?:→|->)\s*`?[/$]?kiwi-sds\b/;

function docs(rendering: string, skill: string): Array<{ relPath: string; text: string }> {
  return markdownFiles(rendering, skill).map((relPath) => ({ relPath, text: readRepoFile(relPath).replace(/\r\n/g, "\n") }));
}

describe("FR-FLOW-184 AC-2 — the skills this suite owns do not name kiwi-planner", () => {
  it("reads every shipped rendering and the mirror", () => {
    expect(RENDERINGS.length).toBeGreaterThanOrEqual(4);
  });

  for (const skill of OWNED) {
    it.each(RENDERINGS)(`%s/${skill} names no kiwi-planner`, (rendering) => {
      const files = docs(rendering, skill);
      expect(files.length, `${rendering}/${skill} ships no document`).toBeGreaterThan(0);
      for (const { relPath, text } of files) {
        const lines = text.split("\n").filter((line) => line.includes("kiwi-planner"));
        expect(lines, `${relPath} still names kiwi-planner`).toEqual([]);
      }
    });
  }
});

describe("FR-FLOW-184 AC-4 — kiwi-tdd, kiwi-hot-fix and kiwi-srs-sync point body-scope work to kiwi-srs → kiwi-sds", () => {
  for (const skill of REDIRECTING) {
    it.each(RENDERINGS)(`%s/${skill}: a boundary row sends the work to the chain`, (rendering) => {
      const rows = docs(rendering, skill).flatMap((doc) => tableRows(doc.text).map((row) => row.cells.join(" | ")));
      expect(rows.some((row) => CHAIN.test(row)), `${rendering}/${skill}: no table row names kiwi-srs → kiwi-sds`).toBe(true);
    });
  }

  it.each(RENDERINGS)("%s/kiwi-tdd: the §0.7 sdd-redirect rule names the chain", (rendering) => {
    const body = readRepoFile(`${rendering}/kiwi-tdd/SKILL.md`).replace(/\r\n/g, "\n");
    const row = tableRows(body).find((entry) => /^§0\.7$/.test(entry.cells[0] ?? ""));
    expect(row, `${rendering}/kiwi-tdd has no §0.7 row`).toBeDefined();
    expect(CHAIN.test(row?.cells.join(" | ") ?? ""), `${rendering}/kiwi-tdd §0.7 does not redirect to kiwi-srs → kiwi-sds`).toBe(true);
  });
});
