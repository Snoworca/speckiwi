import { describe, expect, it } from "vitest";

import { tableRows } from "./kiwi-orchestrator-variants.js";
import { RENDERINGS, markdownFiles, readRepoFile } from "./kiwi-renderings.js";

// @req FR-FLOW-193 AC-4 — the skills that send body-scope work elsewhere send it to `kiwi-srs →
// kiwi-pm`, and none to `kiwi-srs → kiwi-sds`. AC-5's "no skill names kiwi-planner as a step to
// invoke" is kept here for the five skills this suite reads. (Was body-scope-chain-redirect.fr-flow-184.)
//
// The redirect is read from TABLE ROWS — the boundary tables, kiwi-tdd's §0.7 rule row and the
// kiwi-srs recommendation row — because that is where each skill states where work goes. kiwi-hot-fix
// also states it in its description and in its large-fix recommendation.

const REDIRECTING = ["kiwi-tdd", "kiwi-hot-fix", "kiwi-srs-sync", "kiwi-review-fix-loop", "kiwi-srs"] as const;

/** `kiwi-srs → kiwi-pm` in any rendering's spelling: bare, `/`-prefixed, `$`-prefixed, backticked. */
const CHAIN = /kiwi-srs`?\s*(?:→|->)\s*`?[/$]?kiwi-pm\b/;
const OLD_CHAIN = /kiwi-srs`?\s*(?:→|->)\s*`?[/$]?kiwi-sds\b/;

function docs(rendering: string, skill: string): Array<{ relPath: string; text: string }> {
  return markdownFiles(rendering, skill).map((relPath) => ({ relPath, text: readRepoFile(relPath).replace(/\r\n/g, "\n") }));
}

describe("FR-FLOW-193 AC-5 — the skills this suite reads do not name kiwi-planner", () => {
  it("reads every shipped rendering and the mirror", () => {
    expect(RENDERINGS.length).toBeGreaterThanOrEqual(4);
  });

  for (const skill of REDIRECTING) {
    it.each(RENDERINGS)(`%s/${skill} names no kiwi-planner`, (rendering) => {
      const files = docs(rendering, skill);
      expect(files.length, `${rendering}/${skill} ships no document`).toBeGreaterThan(0);
      for (const { relPath, text } of files) {
        expect(text.split("\n").filter((line) => line.includes("kiwi-planner")), `${relPath} still names kiwi-planner`).toEqual([]);
      }
    });
  }
});

describe("FR-FLOW-193 AC-4 — body-scope work goes to kiwi-srs → kiwi-pm, never to kiwi-srs → kiwi-sds", () => {
  for (const skill of REDIRECTING) {
    it.each(RENDERINGS)(`%s/${skill}: a table row sends the work to the chain`, (rendering) => {
      const rows = docs(rendering, skill).flatMap((doc) => tableRows(doc.text).map((row) => row.cells.join(" | ")));
      // kiwi-review-fix-loop's routing table ("Out of Scope") ships in the claude rendering only; where a
      // rendering carries no routing table at all, there is no redirect row to hold.
      if (skill === "kiwi-review-fix-loop" && !rows.some((row) => /kiwi-srs`?\s*(?:→|->)/.test(row))) return;
      expect(rows.some((row) => CHAIN.test(row)), `${rendering}/${skill}: no table row names kiwi-srs → kiwi-pm`).toBe(true);
    });

    it.each(RENDERINGS)(`%s/${skill}: nothing points to kiwi-srs → kiwi-sds`, (rendering) => {
      for (const { relPath, text } of docs(rendering, skill)) {
        expect(text.split("\n").filter((line) => OLD_CHAIN.test(line)), `${relPath} still points to kiwi-srs → kiwi-sds`).toEqual([]);
      }
    });
  }

  it.each(RENDERINGS)("%s/kiwi-tdd: the §0.7 sdd-redirect rule names the chain", (rendering) => {
    const body = readRepoFile(`${rendering}/kiwi-tdd/SKILL.md`).replace(/\r\n/g, "\n");
    const row = tableRows(body).find((entry) => /^§0\.7$/.test(entry.cells[0] ?? ""));
    expect(row, `${rendering}/kiwi-tdd has no §0.7 row`).toBeDefined();
    expect(CHAIN.test(row?.cells.join(" | ") ?? ""), `${rendering}/kiwi-tdd §0.7 does not redirect to kiwi-srs → kiwi-pm`).toBe(true);
  });

  it.each(RENDERINGS)("%s/kiwi-hot-fix: the description and the large-fix recommendation name SRS → pm, not SRS → SDS", (rendering) => {
    const text = docs(rendering, "kiwi-hot-fix")
      .map((doc) => doc.text)
      .join("\n");
    const description = /description:\s*"([^\n]*)"/.exec(text)?.[1] ?? "";
    expect(description, `${rendering}: kiwi-hot-fix description still names the SDS stage`).not.toMatch(/SRS\s*(?:→|->|to)\s*SDS/);
    expect(description).toMatch(/SRS\s*(?:→|->|to)\s*(?:pm|kiwi-pm)/);
    const flatText = text.replace(/\s+/g, " ");
    const at = flatText.search(/fix_complexity_estimate = large|complexity is large/);
    expect(at, `${rendering}: the large-fix recommendation is gone`).toBeGreaterThan(-1);
    expect(CHAIN.test(flatText.slice(at, at + 300)), `${rendering}: the large-fix recommendation does not name kiwi-srs → kiwi-pm`).toBe(true);
  });
});
