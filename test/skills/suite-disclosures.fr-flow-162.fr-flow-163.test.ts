import { describe, expect, it } from "vitest";

import { readRepoFile } from "./kiwi-renderings.js";

// @req FR-FLOW-162 AC-8 · FR-FLOW-163 AC-11 — each requirement states what its suite does not hold.
//
// Both criteria are records, not behaviours: the residuals are written where a reader of the suite
// meets them, in the "WHAT THIS FILE DOES NOT HOLD" comment at the top of each suite file. A record
// can drift like anything else — a residual quietly dropped from the comment leaves every behavioural
// assertion green — so this file holds the record itself: each residual the criterion names must
// still be a bullet of that comment. A bullet is matched by the facts it has to carry (its measured
// numbers and the names it points at), not by its wording, so the prose can be rewritten freely.

/** The bullets of the leading "WHAT THIS FILE DOES NOT HOLD" comment of a suite file, flattened. */
function disclosures(relPath: string): string[] {
  const lines = readRepoFile(relPath).replace(/\r\n/g, "\n").split("\n");
  const start = lines.findIndex((line) => /^\/\/ WHAT THIS FILE DOES NOT HOLD\b/.test(line));
  if (start < 0) return [];
  const block: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (!line.startsWith("//")) break;
    block.push(line.replace(/^\/\/\s?/, ""));
  }
  return block
    .join("\n")
    .split(/\n(?=\s*- )/)
    .map((bullet) => bullet.replace(/\s+/g, " ").trim())
    .filter((bullet) => bullet.startsWith("- "));
}

/** Whether some single bullet carries every one of `facts`. */
function recorded(bullets: readonly string[], facts: readonly RegExp[]): boolean {
  return bullets.some((bullet) => facts.every((fact) => fact.test(bullet)));
}

describe("FR-FLOW-162 AC-8 — the skill-code contract suite records what it does not hold", () => {
  const SUITE = "test/skills/skill-code-contract.fr-flow-162.test.ts";
  const bullets = disclosures(SUITE);

  const RESIDUALS: ReadonlyArray<readonly [residual: string, facts: readonly RegExp[]]> = [
    ["the absence half is a vocabulary list a paraphrase escapes", [/absence half/, /paraphrase/, /positive half/]],
    ["a line dropping two of the four verdicts leaves the corpus, reported only by the floor", [/drops two of them/, /floor/]],
    ["a site is a physical line, so a rewrap is a deliberate false red", [/PHYSICAL LINE/, /rewraps/, /false red/]],
    ["instruction text does not tell a corrected skill from an agent ignoring it", [/instruction text/, /agent that ignores it/]],
    ["each judge is pinned by one refused and one passed sample only", [/AC-9/, /one sample it must refuse and one it must pass/]],
    ["the byte golden covers the verdict lines only; a retracting sentence escapes trace_intent and replay", [/AC-10/, /VERDICT lines only/, /retracts/, /`trace_intent`/, /replay/]],
    ["the census floors, and the replay census exception 12 against 77 (124 after 4.0.0)", [/floors/, /\b12\b/, /\b77\b/, /\b124\b/, /per-bucket floors/]],
    ["the fourth drift shape is not in the table: item 02 took it", [/fourth drift shape/, /item 02/]],
    ["the FR-FLOW-121 AC-6 consequence was corrected on 2026-08-28", [/`FR-FLOW-121` AC-6/, /orchestrate replay\s+apply/, /2026-08-28/, /loss condition/]]
  ];

  it("FR-FLOW-162 AC-8: the suite file carries its disclosure comment", () => {
    expect(bullets.length, `${SUITE} has no WHAT THIS FILE DOES NOT HOLD comment`).toBeGreaterThanOrEqual(RESIDUALS.length);
  });

  it.each(RESIDUALS)("FR-FLOW-162 AC-8: the suite records that %s", (_residual, facts) => {
    expect(recorded(bullets, facts), `${SUITE}: no disclosure bullet carries ${facts.map(String).join(" + ")}`).toBe(true);
  });
});

describe("FR-FLOW-163 AC-11 — the trace-intent suite records the six residuals it does not guarantee", () => {
  const SUITE = "test/skills/trace-intent-carrier.fr-flow-163.test.ts";
  const bullets = disclosures(SUITE);

  const RESIDUALS: ReadonlyArray<readonly [residual: string, facts: readonly RegExp[]]> = [
    ["(a) the judge accepts an argument present for an unrelated reason — 8 of 28 sites, only the golden reports them", [/unrelated reason/, /§0\.14/, /before 4\.0\.0/, /eight of the twenty-eight sites were/, /golden/]],
    ["(b) the retraction vocabulary closes spellings, and a neighbouring section is not reached", [/closed vocabulary/, /NEIGHBOURING section/]],
    ["(c) the corpus equality is blind to a frozen file list on the day it is frozen", [/frozen file list/, /day it is frozen/, /added or\s+removed/]],
    ["(d) a coordinated edit of a site and the golden still lands", [/coordinated edit/, /golden together/]],
    ["(e) the block-set assertion cannot report its own deletion", [/block-set assertion/, /its own deletion/]],
    ["(f) instruction text only, and the addition_site status cap is not checked", [/instruction text/, /agent ignoring it/, /`addition_site` status cap/]]
  ];

  it("FR-FLOW-163 AC-11: the suite file carries its disclosure comment", () => {
    expect(bullets.length, `${SUITE} has no WHAT THIS FILE DOES NOT HOLD comment`).toBeGreaterThanOrEqual(RESIDUALS.length);
  });

  it.each(RESIDUALS)("FR-FLOW-163 AC-11: the suite records %s", (_residual, facts) => {
    expect(recorded(bullets, facts), `${SUITE}: no disclosure bullet carries ${facts.map(String).join(" + ")}`).toBe(true);
  });
});
