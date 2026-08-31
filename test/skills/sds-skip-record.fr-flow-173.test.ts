import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { REPO_ROOT, isTableRowLine, section, stripFrontmatter, tableRows } from "./kiwi-orchestrator-variants.js";

/**
 * FR-FLOW-173 — `kiwi-tdd` states the SDS skip as a recorded decision the machine checks.
 *
 * Counted before any edit of this item, over all four `kiwi-tdd` renderings: "SDS Skip" 0,
 * "SDS-E054" 0, "recorded" 0, "unrecorded" 0, `exit 0` 0, `exit 1` 0. §2.3 item 1 read "skip the
 * SDS and record only an EARS stub in intent.md, then go to Phase 3" with no table anywhere in the
 * section and no mention of `step validate` before Phase 3, and the §0.4 row named no exception at
 * all. Every assertion below was therefore red.
 *
 * The judgement is asserted as a TABLE rather than as prose. A regex over a sentence is decided by
 * whichever wording it happened to be written against — reorder the clause, swap the verb, negate
 * one word and the same regex reads the opposite instruction as compliant. Two rows keyed on the
 * `recorded` / `unrecorded` tokens cannot be reordered into compliance, and inverting the decision
 * moves four cells at once.
 */

/** All four shipped trees. The mirror is read separately so an edit to one rendering cannot pass alone. */
const COPIES = ["skills/claude", "skills/codex", "skills/etc", ".agents/skills"] as const;

const SKILL = "kiwi-tdd";

/** The literal the record's own section heading carries, and the one place this file spells it. */
const RECORD_HEADING = "SDS Skip";

/** The three cells a record must fill. A part dropped here is a part nothing below checks. */
const RECORD_FIELDS = ["Decision", "Reason", "SDS-AC"] as const;

/**
 * Every read the per-copy checks made: the rendering they asked for, the file that was opened for
 * them, and a digest of the bytes that came back. The ledger at the end of this file compares all
 * three against a reader that does not go through `body`, so a `body` that answers every request
 * with one rendering's bytes is caught rather than counted as four passing checks.
 */
const READS: { requested: string; opened: string; digest: string }[] = [];

function digest(text: string): string {
  return createHash("md5").update(text).digest("hex");
}

function body(copy: string): string {
  const file = path.join(REPO_ROOT, copy, SKILL, "SKILL.md");
  const text = stripFrontmatter(readFileSync(file, "utf8")).replace(/\r\n/g, "\n");
  READS.push({ requested: copy, opened: path.relative(REPO_ROOT, file).replace(/\\/g, "/"), digest: digest(text) });
  return text;
}

/** §2.3 — the Phase 2 checklist, sliced by its numbered heading rather than by its wording. */
function phase2(copy: string): string {
  const slice = section(body(copy), /^###\s+2\.3\s/);
  expect(slice, `${copy}: §2.3 must exist`).not.toBe("");
  return slice;
}

/**
 * Checklist item 1 — from the `1.` marker to the `2.` marker, tables included.
 *
 * Scoped rather than read over the whole section: §2.3 item 7 also names `speckiwi step validate`,
 * so a section-wide reader would report the skip path as validated on the strength of a line the
 * skip path never reaches. That unreachability is the defect this item exists to fix, so the
 * assertion has to look inside item 1 itself.
 */
function skipItem(copy: string): string {
  const lines = phase2(copy).split("\n");
  const start = lines.findIndex((line) => /^1\.\s/.test(line));
  expect(start, `${copy}: §2.3 must carry a numbered item 1`).toBeGreaterThanOrEqual(0);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^2\.\s/.test(line));
  return [lines[start], ...(end < 0 ? rest : rest.slice(0, end))].join("\n");
}

/** The §0.4 row of the §0 rule table, keyed on its identifier rather than on its text. */
function ruleRow(copy: string, id: string): string {
  const row = body(copy)
    .split("\n")
    .map((line) => line.trim())
    .find((line) => isTableRowLine(line) && line.startsWith(`| ${id} |`));
  expect(row, `${copy}: the §0 table must carry a ${id} row`).toBeDefined();
  return row as string;
}

/** The two decision rows of item 1's table, headers and delimiters dropped. */
function decisionRows(copy: string): string[][] {
  return tableRows(skipItem(copy))
    .map((row) => row.cells)
    // `unrecorded` is not a `\brecorded\b` match — the boundary fails after `un` — so both tokens
    // are named here. Reading only the narrow one silently dropped the failing row and left the
    // "exactly two rows" assertion counting one.
    .filter((cells) => cells.some((cell) => /\b(?:un)?recorded\b/i.test(cell)));
}

function rowFor(copy: string, kind: "recorded" | "unrecorded"): string {
  const rows = decisionRows(copy).filter((cells) => {
    const joined = cells.join(" ");
    return kind === "unrecorded" ? /\bunrecorded\b/i.test(joined) : !/\bunrecorded\b/i.test(joined);
  });
  expect(rows, `${copy}: exactly one ${kind} row`).toHaveLength(1);
  return (rows[0] as string[]).join(" | ");
}

describe("FR-FLOW-173 AC-1 — the skip record's location and its three fields are named", () => {
  for (const copy of COPIES) {
    it(`${copy} names intent.md and every field the record must carry`, () => {
      const item = skipItem(copy);
      expect(item, `${copy}: item 1 must name the record file`).toContain("intent.md");
      expect(item, `${copy}: item 1 must name the record section`).toContain(RECORD_HEADING);
      for (const field of RECORD_FIELDS) {
        expect(item, `${copy}: item 1 must name the ${field} field`).toContain(field);
      }
      // The EARS shape is what makes the SDS-AC cell more than a word: without WHEN/SHALL the
      // "record" degrades back into the free sentence this item removed.
      expect(item, `${copy}: item 1 must give the EARS shape`).toMatch(/WHEN/);
      expect(item, `${copy}: item 1 must give the EARS shape`).toMatch(/SHALL/);
    });
  }
});

describe("FR-FLOW-173 AC-2 — the skip path runs step validate before Phase 3", () => {
  for (const copy of COPIES) {
    it(`${copy} routes the skip through step validate ahead of Phase 3`, () => {
      const item = skipItem(copy);
      const validateAt = item.indexOf("step validate");
      const phase3At = item.indexOf("Phase 3");
      expect(validateAt, `${copy}: item 1 must name speckiwi step validate`).toBeGreaterThanOrEqual(0);
      expect(phase3At, `${copy}: item 1 must still say where the skip path goes`).toBeGreaterThanOrEqual(0);
      // Ordering IS the contract here: the defect this item fixes is an exemption placed AHEAD of
      // the check that would have caught it, so a text naming both in the wrong order still ships
      // the defect.
      expect(validateAt, `${copy}: the check must precede the jump to Phase 3`).toBeLessThan(phase3At);
    });
  }
});

describe("FR-FLOW-173 AC-3 — the decision is a two-row table, not a sentence", () => {
  for (const copy of COPIES) {
    it(`${copy} gives exactly two decision rows`, () => {
      expect(decisionRows(copy)).toHaveLength(2);
    });

    it(`${copy} sends the recorded skip to SDS-W050 and a passing exit`, () => {
      const row = rowFor(copy, "recorded");
      expect(row).toContain("SDS-W050");
      expect(row).toContain("exit 0");
      expect(row, "the recorded row must not also carry the failing code").not.toContain("SDS-E054");
      expect(row, "the recorded row must not also carry the failing exit").not.toContain("exit 1");
    });

    it(`${copy} sends the unrecorded skip to SDS-E054 and a failing exit`, () => {
      const row = rowFor(copy, "unrecorded");
      expect(row).toContain("SDS-E054");
      expect(row).toContain("exit 1");
      expect(row, "the unrecorded row must not also carry the passing code").not.toContain("SDS-W050");
      expect(row, "the unrecorded row must not also carry the passing exit").not.toContain("exit 0");
    });
  }
});

describe("FR-FLOW-173 AC-4 — §0.4 and the checklist state one judgement", () => {
  for (const copy of COPIES) {
    it(`${copy} names the recorded skip as §0.4's exception and cites the failing code`, () => {
      const row = ruleRow(copy, "§0.4");
      expect(row, `${copy}: §0.4 must point at the skip record`).toContain(RECORD_HEADING);
      expect(row, `${copy}: §0.4 must cite what fails without the record`).toContain("SDS-E054");
      // Without the pointer back to §2.3 the row states a second, free-standing exception, which is
      // the contradiction this AC removes rather than a restatement of it.
      expect(row, `${copy}: §0.4 must point at the checklist that owns the skip`).toMatch(/2\.3/);
    });
  }
});

describe("FR-FLOW-173 AC-5 — the mirror carries the same body", () => {
  it("the mirrored rendering is byte-identical to its source below the frontmatter", () => {
    expect(body(".agents/skills")).toBe(body("skills/codex"));
  });

});

// Declared last on purpose: Vitest runs a file's tests in declaration order, so by the time this
// block runs every check above has recorded what it opened and what came back.
describe("FR-FLOW-173 what the per-copy checks read", () => {
  /**
   * Reads a rendering without going through `body`, so the two disagree when `body` stops
   * honouring its argument. The duplication is the point: a single reader compared against itself
   * reports agreement no matter which file it opened.
   */
  function independently(copy: string): string {
    const raw = readFileSync(path.join(REPO_ROOT, copy, SKILL, "SKILL.md"), "utf8");
    return digest(stripFrontmatter(raw).replace(/\r\n/g, "\n"));
  }

  it("every check was answered with the bytes of the rendering it asked for", () => {
    expect(READS.length, "no rendering was read, so this ledger has nothing to answer for").toBeGreaterThan(0);
    expect(
      COPIES.filter((copy) => !READS.some((read) => read.requested === copy)),
      "a rendering is listed in COPIES and asserted nowhere above, so the denominator is smaller than it looks"
    ).toEqual([]);

    // The path first: `skills/codex` and its mirror are byte-identical, so a swap between those two
    // is visible only here.
    expect(
      READS.filter((read) => read.opened !== `${read.requested}/${SKILL}/SKILL.md`).map(
        (read) => `${read.requested} was answered from ${read.opened}`
      ),
      "a check asked for one rendering and a different file was opened for it"
    ).toEqual([]);

    // Then the bytes, against a reader that does not share `body`'s path computation.
    expect(
      READS.filter((read) => read.digest !== independently(read.requested)).map(
        (read) => `${read.requested} was answered with bytes that are not its own`
      ),
      "a check was handed one rendering's bytes under another rendering's name"
    ).toEqual([]);
  });

  it("the four renderings are four separate files, measured by content and not by path arithmetic", () => {
    // The Korean rendering can never equal the English ones, so this pair separates the two source
    // trees; the mirror is separated from its source by path alone, which the ledger above covers.
    expect(independently("skills/claude"), "the Korean rendering reads identical to the English source").not.toBe(
      independently("skills/codex")
    );
    expect(new Set(COPIES.map((copy) => path.join(REPO_ROOT, copy, SKILL, "SKILL.md"))).size).toBe(4);
    for (const copy of COPIES) expect(body(copy).length).toBeGreaterThan(0);
  });
});
