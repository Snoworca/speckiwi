import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { REPO_ROOT, criticalGateRows, criticalGatesSection, isTableRowLine, stripFrontmatter } from "./kiwi-orchestrator-variants.js";
import { MIRROR_EXCLUDED, RENDERINGS, scanUnits, skillDirs } from "./kiwi-renderings.js";

/**
 * FR-FLOW-178 — a sentence counting a gate table is checked against that table.
 *
 * Counted before any edit of this item, over every shipped rendering: `kiwi-tdd`'s `critical_gates[]`
 * table holds four rows and the sentence one line under it says three, in all four renderings —
 * `skills/claude`, `skills/codex`, `skills/etc` and the `.agents/skills` mirror. It was the only
 * skill, of the sixty gate sections this sweep reads, whose prose counted its own table. No test
 * read that sentence, so `FR-FLOW-164` could add the `validate-spec-error` row without anything
 * reddening. Every AC-1 assertion below was red on four files at once, and AC-3 red on the same four.
 *
 * The denominator is READ rather than listed. A written list of renderings is an inclusion test one
 * level above the corpus boundary: whatever the list omits is never swept, and a sweep over the
 * survivors passes for the same reason a clean one does. `RENDERINGS` and `skillDirs` answer both
 * questions from disk, and `MIRROR_EXCLUDED` is read from the file the mirror itself is built
 * against, so a skill the mirror deliberately omits is not counted as a missing sweep.
 *
 * The comparison is against the table the sentence SITS BESIDE — `criticalGateRows` over the same
 * section — rather than against a figure written here. A figure written into this file is the same
 * defect one level up: it goes stale the next time a row is added, and nothing reddens.
 */

/** A cardinal the check can read, in the two languages the renderings are written in. */
const CARDINALS: ReadonlyMap<string, number> = new Map([
  ["one", 1],
  ["two", 2],
  ["three", 3],
  ["four", 4],
  ["five", 5],
  ["six", 6],
  ["seven", 7],
  ["eight", 8],
  ["nine", 9],
  ["ten", 10],
  ["eleven", 11],
  ["twelve", 12],
  ["thirteen", 13],
  ["한", 1],
  ["두", 2],
  ["세", 3],
  ["네", 4],
  ["다섯", 5],
  ["여섯", 6],
  ["일곱", 7],
  ["여덟", 8],
  ["아홉", 9],
  ["열", 10]
]);

/**
 * What a sentence POINTING AT the table looks like while carrying a cardinal.
 *
 * Each pattern requires the pointer (`위` / `above` / `in the table above`) as well as the number,
 * because a bare number beside the word "gate" is not a claim about this table — `--auto` prose
 * counts interaction points, checklist items and paragraphs in the same sections, and every one of
 * those would be a false alarm on a count the table has no opinion about. AC-4 records what this
 * costs: the pointer requirement is also what nine of sixteen measured paraphrases fall outside.
 */
const CLAIM_PATTERNS: readonly RegExp[] = [
  /위\s*(?:표(?:의)?\s*)?(\d+|한|두|세|네|다섯|여섯|일곱|여덟|아홉|열)\s*(?:개|가지)?\s*(?:의\s*)?게이트/g,
  /(?:the|these|those)\s+(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|\d+)\s+gates?\s+above/gi,
  /(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+gates?\s+(?:in|of)\s+the\s+table\s+above/gi
];

interface CountClaim {
  /** The number the sentence states. */
  said: number;
  /** The matched span, for a failure that quotes the sentence rather than only its location. */
  text: string;
  /** 1-based inside the section handed in, so a report names the block rather than a fold in it. */
  startLine: number;
}

/**
 * Every cardinal a section's PROSE writes about its own gate table.
 *
 * Read over `scanUnits` blocks rather than over raw lines: the codex, etc and mirror renderings wrap
 * this very paragraph mid-sentence, so a pattern run line-by-line reads a folded claim as absent —
 * a false clean on the exact files this item exists for. Table rows and headings are their own units
 * and are skipped, because a gate id in a cell is the table, not a sentence about it.
 */
function gateCountClaims(section: string): CountClaim[] {
  const claims: CountClaim[] = [];
  for (const unit of scanUnits(section)) {
    if (isTableRowLine(unit.text) || /^#{1,6}\s/.test(unit.text)) continue;
    for (const pattern of CLAIM_PATTERNS) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(unit.text)) !== null) {
        const token = (match[1] ?? "").toLowerCase();
        const said = /^\d+$/.test(token) ? Number(token) : CARDINALS.get(match[1] ?? "") ?? CARDINALS.get(token);
        if (said === undefined) continue;
        claims.push({ said, text: match[0], startLine: unit.startLine });
      }
    }
  }
  return claims;
}

interface GateSection {
  /** Repo-relative POSIX path of the file the section was read from. */
  relPath: string;
  /** The section text, sliced by the heading that names `critical_gates`. */
  text: string;
  /** Rows of the `critical_gates[]` table inside it — the denominator a sentence must agree with. */
  rows: number;
  /** 1-based line the section starts on, so a claim reports a file line. */
  offset: number;
}

/** Every `critical_gates` section on disk, in every rendering that ships one. */
function gateSections(): GateSection[] {
  const sections: GateSection[] = [];
  for (const rendering of RENDERINGS) {
    for (const skill of skillDirs(rendering)) {
      const relPath = `${rendering}/${skill}/SKILL.md`;
      let raw: string;
      try {
        raw = readFileSync(path.join(REPO_ROOT, relPath), "utf8");
      } catch {
        continue;
      }
      const normalised = raw.replace(/\r\n/g, "\n");
      const body = stripFrontmatter(normalised);
      const text = criticalGatesSection(body);
      if (text === "") continue;
      sections.push({
        relPath,
        text,
        rows: criticalGateRows(body).length,
        // Located in the RAW file rather than in the stripped body, so a reported line is the line
        // an editor opens at. Frontmatter is five lines here, and a body-relative number sends the
        // reader that far above the sentence it names.
        offset: normalised.slice(0, normalised.indexOf(text)).split("\n").length
      });
    }
  }
  return sections;
}

describe("FR-FLOW-178 AC-1 — a cardinal about a gate table equals that table's row count", () => {
  it("holds in every shipped rendering, over a corpus read from disk", () => {
    const drift: string[] = [];
    for (const section of gateSections()) {
      for (const claim of gateCountClaims(section.text)) {
        if (claim.said === section.rows) continue;
        drift.push(`${section.relPath}:${section.offset + claim.startLine - 1} says ${claim.said}, table holds ${section.rows} «${claim.text}»`);
      }
    }
    expect(drift).toEqual([]);
  });

  it("sweeps a non-empty corpus, and every rendering contributes to it", () => {
    const sections = gateSections();
    expect(sections.length).toBeGreaterThan(0);
    for (const rendering of RENDERINGS) {
      expect(sections.some((section) => section.relPath.startsWith(`${rendering}/`)), `${rendering} contributes no critical_gates section`).toBe(true);
    }
  });

  it("does not count a mirror exclusion as a missing sweep", () => {
    // The mirror is produced from the codex rendering minus the exclusion file's entries, so the
    // difference between the two skill sets IS that file. Asserting the equality here is what lets
    // the sweep above treat `.agents/skills` as complete without a written excuse for each absence.
    const source = new Set(skillDirs("skills/codex"));
    const mirrored = new Set(skillDirs(".agents/skills"));
    const missing = [...source].filter((skill) => !mirrored.has(skill)).sort();
    expect(missing).toEqual([...MIRROR_EXCLUDED].sort());
  });
});

describe("FR-FLOW-178 AC-2 — the check reddens in both directions", () => {
  /** A section carrying `rows` gate rows and one sentence, so a case differs in one thing only. */
  function synthetic(rows: number, sentence: string): string {
    const table = [
      "| gate_id | reason | location |",
      "|---|---|---|",
      ...Array.from({ length: rows }, (_, index) => `| gate-${index + 1} | reason | Phase 1 |`)
    ];
    return ["### §0.AG — `--auto` critical_gates[] declaration", "", ...table, "", sentence, ""].join("\n");
  }

  it("stays green when the sentence carries no figure", () => {
    expect(gateCountClaims(synthetic(4, "**What `--auto` cannot resolve**: the gates above."))).toEqual([]);
    expect(gateCountClaims(synthetic(4, "**`--auto` 가 해결할 수 없는 것**: 위 게이트들."))).toEqual([]);
  });

  it("agrees when the figure matches the table", () => {
    const section = synthetic(4, "**What `--auto` cannot resolve**: the four gates above.");
    const claims = gateCountClaims(section);
    expect(claims).toHaveLength(1);
    expect(claims[0]?.said).toBe(4);
    expect(criticalGateRows(section)).toHaveLength(4);
  });

  it("disagrees when a row is added and the sentence is left behind", () => {
    // The direction the plan item was opened for: `FR-FLOW-164` added a row and nothing reddened.
    const section = synthetic(5, "**What `--auto` cannot resolve**: the four gates above.");
    const claims = gateCountClaims(section);
    expect(claims).toHaveLength(1);
    expect(claims[0]?.said).toBe(4);
    expect(criticalGateRows(section)).toHaveLength(5);
    expect(claims[0]?.said).not.toBe(criticalGateRows(section).length);
  });

  it("reads a folded sentence, which is how the codex and etc renderings wrap this paragraph", () => {
    const section = synthetic(4, "**What `--auto` cannot resolve**: the three\ngates above. They halt regardless.");
    expect(gateCountClaims(section).map((claim) => claim.said)).toEqual([3]);
  });
});

describe("FR-FLOW-178 AC-3 — the four sentences are corrected, and the correction drops the figure", () => {
  /** The `critical_gates` section of one skill in one rendering. */
  function sectionOf(rendering: string, skill: string): GateSection {
    const found = gateSections().find((section) => section.relPath === `${rendering}/${skill}/SKILL.md`);
    expect(found, `${rendering}/${skill} must declare a critical_gates section`).toBeDefined();
    return found as GateSection;
  }

  it("leaves no cardinal in any kiwi-tdd rendering's gate section", () => {
    const renderings = RENDERINGS.filter((rendering) => skillDirs(rendering).includes("kiwi-tdd"));
    expect(renderings.length).toBeGreaterThan(0);
    for (const rendering of renderings) {
      const section = sectionOf(rendering, "kiwi-tdd");
      expect(gateCountClaims(section.text).map((claim) => claim.text), `${section.relPath} still counts its own table`).toEqual([]);
    }
  });

  it("still points at the table, so dropping the figure did not drop the sentence", () => {
    for (const rendering of RENDERINGS.filter((entry) => skillDirs(entry).includes("kiwi-tdd"))) {
      const section = sectionOf(rendering, "kiwi-tdd");
      expect(section.text, `${section.relPath} no longer points at its gate table`).toMatch(/위 게이트들|the gates above/);
    }
  });

  it("uses the phrasing the tree already writes rather than a new one", () => {
    // Derived from `kiwi-orchestrator`, which states the same idea without a number today. Reading
    // it from that skill rather than spelling it here is what keeps the two phrasings one phrasing.
    const donor = criticalGatesSection(stripFrontmatter(readFileSync(path.join(REPO_ROOT, "skills/claude/kiwi-orchestrator/SKILL.md"), "utf8")));
    const phrase = /위 게이트들/.exec(donor)?.[0];
    expect(phrase, "kiwi-orchestrator no longer carries the count-free phrasing this correction copies").toBe("위 게이트들");
    expect(sectionOf("skills/claude", "kiwi-tdd").text).toContain(phrase as string);
  });
});

describe("FR-FLOW-178 AC-4 — what the check cannot see, enumerated from measurement", () => {
  /**
   * Sixteen paraphrases of the same claim, each run through the same `gateCountClaims` the tree is
   * swept with. The verdicts are frozen so the residue stays MEASURED: widening a pattern without
   * re-measuring turns this red, and so does narrowing one.
   *
   * `caught: false` is the residue this check ships with. `falsePositive` marks the one direction
   * that fails the other way — a sentence QUOTING the rule about counting tables reads as a
   * violation of it, because a regex cannot tell use from mention.
   */
  const PARAPHRASES: ReadonlyArray<{ text: string; caught: boolean; falsePositive?: true }> = [
    { text: "**`--auto` 가 해결할 수 없는 것**: 위 3개 게이트.", caught: true },
    { text: "**`--auto` 가 해결할 수 없는 것**: 위 표의 세 게이트.", caught: true },
    { text: "위 세 가지 게이트는 항상 HALT 한다.", caught: true },
    { text: "**What `--auto` cannot resolve**: the three gates above.", caught: true },
    { text: "Three gates in the table above halt regardless of `--auto`.", caught: true },
    { text: "**What `--auto` cannot resolve**: the three\ngates above.", caught: true },
    { text: "**`--auto` 가 해결할 수 없는 것**: 위 게이트 3종.", caught: false },
    { text: "세 개의 게이트가 위 표에 있으며 모두 HALT 한다.", caught: false },
    { text: "이 세 게이트는 `--auto` 와 무관하게 HALT 한다.", caught: false },
    { text: "위 표의 행 셋은 결정 위원회로 넘기지 않는다.", caught: false },
    { text: "표에 오른 셋은 우회할 수 없다.", caught: false },
    { text: "**What `--auto` cannot resolve**: these 3 gates.", caught: false },
    { text: "**What `--auto` cannot resolve**: all three of the gates listed above.", caught: false },
    { text: "The three halt points above cannot be routed to the committee.", caught: false },
    { text: "The gates above — three of them — halt regardless of `--auto`.", caught: false },
    { text: "위 3개 게이트가 아니라 위 게이트들이라고 쓴다.", caught: true, falsePositive: true }
  ];

  it("catches and misses exactly what was measured", () => {
    const verdicts = PARAPHRASES.map((sample) => ({
      text: sample.text,
      caught: gateCountClaims(["| gate_id | reason | location |", "|---|---|---|", "| gate-a | r | l |", "", sample.text].join("\n")).length > 0
    }));
    expect(verdicts).toEqual(PARAPHRASES.map((sample) => ({ text: sample.text, caught: sample.caught })));
  });

  it("records the split: six true catches, nine misses, one false positive", () => {
    const truthful = PARAPHRASES.filter((sample) => sample.caught && sample.falsePositive === undefined);
    const missed = PARAPHRASES.filter((sample) => !sample.caught);
    const falsePositives = PARAPHRASES.filter((sample) => sample.falsePositive === true);
    expect([truthful.length, missed.length, falsePositives.length]).toEqual([6, 9, 1]);
    expect(truthful.length + missed.length + falsePositives.length).toBe(PARAPHRASES.length);
  });
});

describe("FR-FLOW-178 AC-5 — two sentences counting something else stay outside the denominator", () => {
  it("the sweep reads skill bodies only, so `_shared/kiwi/auto-option.md` is never in it", () => {
    // The opening line of `auto-option.md` names a number of kiwi-* skills that no longer matches
    // the tree, and its §11 migration table counts entries of a DIFFERENT table. Neither is a
    // sentence counting the gate table it sits beside, and the second reads as a record of what was
    // true at a migration. Excluding them is a corpus fact rather than a written excuse: the sweep
    // opens `SKILL.md` and nothing else.
    for (const section of gateSections()) {
      expect(section.relPath.endsWith("/SKILL.md")).toBe(true);
      expect(section.relPath).not.toContain("_shared/");
    }
  });

  it("both are still present, so the disposition is a recorded choice rather than a silent loss", () => {
    const shared = readFileSync(path.join(REPO_ROOT, "skills/claude/_shared/kiwi/auto-option.md"), "utf8");
    expect(shared).toMatch(/kiwi-\*? ?스킬이 공유/);
    expect(shared).toContain("kiwi-pipeline");
  });
});
