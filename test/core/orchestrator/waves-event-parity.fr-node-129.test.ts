import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { GATE_IDS } from "../../../src/core/orchestrator/auto-gate.js";
import {
  AUTO_GATE_ACTIONS,
  CONFLICT_REASONS,
  EVENT_STATUSES,
  EXCLUSION_CLASSES,
  ISSUE_CLASSES,
  JOURNAL_RULES,
  LANE_DISPOSITION_KINDS,
  MANIFEST_STATUSES,
  PROOF_KINDS,
  REASON_CLASSES,
  RECIPE_KINDS,
  RECOVERY_CLASSES,
  VERBS,
  VIOLATION_RULES,
  WAVES_EVENT_FIELDS,
  WAVES_EVENT_NON_VIOLATION_BULLETS,
  WAVE_PHASES
} from "../../../src/core/orchestrator/journal-schema.js";

// @req FR-NODE-129 — contract parity between `journal-schema.ts` and every shipped `waves-event.md`.
//
// Two halves, and the second is the one that matters most: the mechanical invariants
// `verification-gate.ts` implements are stated as **bullet list items**, not table rows, so a
// table-only parity check misses the exact drift class that produced `IR-CLI-080`. The bullet set is
// enumerated by measurement from the document at test time — no count literal appears below, because
// §10.4 records that the first revision's "the nine invariants at waves-event.md:89-99" was wrong on
// the count, the range AND the unit, and a test pinned to it would have asserted the wrong denominator.

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

/** The three skill variants plus the `.agents` mirror. §14 registration 5 edits all four in one change. */
const COPIES = [
  "skills/claude/_shared/kiwi/waves-event.md",
  "skills/codex/_shared/kiwi/waves-event.md",
  "skills/etc/_shared/kiwi/waves-event.md",
  ".agents/skills/_shared/kiwi/waves-event.md"
] as const;

function read(relativePath: string): string {
  return readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

// ---------------------------------------------------------------------------------------------
// The parsers. Pure over text, so the negative fixtures below run in memory and write nothing.
// ---------------------------------------------------------------------------------------------

/** A heading and everything under it, down to the next heading of the same or shallower level. */
function section(text: string, headingPrefix: string): string[] {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => line.startsWith(headingPrefix));
  if (start === -1) return [];
  const level = (lines[start] as string).match(/^#+/)?.[0].length ?? 0;
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    const marker = (lines[index] as string).match(/^#+/);
    if (marker && marker[0].length <= level) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end);
}

/** The first-cell field name of every data row of the section's table. */
function parseFieldTable(text: string, headingPrefix: string): string[] {
  return section(text, headingPrefix)
    .filter((line) => line.trimStart().startsWith("|"))
    .map((line) => /^\s*\|\s*`([^`]+)`\s*\|/.exec(line)?.[1])
    .filter((name): name is string => name !== undefined);
}

/** Every bullet list item of the section, measured — never counted against a literal. */
function parseBullets(text: string, headingPrefix: string): string[] {
  return section(text, headingPrefix).filter((line) => line.startsWith("- "));
}

/**
 * A maximal run of backticked tokens joined by ` / ` or ` | `. An enum declaration in this document
 * is always written that way, whether it sits in a table cell, after an `∈`, or inside a prose
 * sentence naming a nested key — so one rule reads all three forms rather than three bespoke ones.
 */
function longestValueRun(line: string): string[] {
  const runs: string[][] = [];
  let current: string[] = [];
  let cursor = 0;
  const pattern = /`([^`]+)`/g;
  let match = pattern.exec(line);
  while (match !== null) {
    const separator = line.slice(cursor, match.index);
    if (current.length > 0 && !/^\s*[/|]\s*$/.test(separator)) {
      runs.push(current);
      current = [];
    }
    current.push(match[1] as string);
    cursor = match.index + match[0].length;
    match = pattern.exec(line);
  }
  if (current.length > 0) runs.push(current);
  return runs.reduce<string[]>((longest, run) => (run.length > longest.length ? run : longest), []);
}

/** Reads one enum's declared values out of the line the locator names. `[]` when undeclared. */
function parseEnumValues(text: string, locator: RegExp): string[] {
  const line = text.split(/\r?\n/).find((candidate) => locator.test(candidate));
  if (line === undefined) return [];
  const run = longestValueRun(line);
  return run.length >= 2 ? run : [];
}

// ---------------------------------------------------------------------------------------------
// AC-4's census: the twelve closed enums, each bound to the live `journal-schema.ts` constant.
// ---------------------------------------------------------------------------------------------

interface EnumParity {
  readonly name: string;
  readonly values: readonly string[];
  /** Finds the declaring line in `waves-event.md`. */
  readonly locator: RegExp;
}

const TWELVE_ENUMS: readonly EnumParity[] = [
  { name: "status", values: EVENT_STATUSES, locator: /^\s*\|\s*`status`\s*\|/ },
  { name: "phase", values: WAVE_PHASES, locator: /^\s*\|\s*`phase`\s*\|/ },
  { name: "verb", values: VERBS, locator: /^\s*\|\s*`verb`\s*\|/ },
  { name: "recovery_class", values: RECOVERY_CLASSES, locator: /`recovery_class`\s*(?:∈|는)/ },
  { name: "proof_kind", values: PROOF_KINDS, locator: /`proof_kind`\s*(?:∈|는)/ },
  { name: "conflict_reason", values: CONFLICT_REASONS, locator: /`conflict_reason`\s*(?:∈|는)/ },
  { name: "recipe_kind", values: RECIPE_KINDS, locator: /`recipe_kind`\s*(?:∈|는)/ },
  { name: "exclusion_class", values: EXCLUSION_CLASSES, locator: /`exclusion_class`\s*∈/ },
  { name: "reason_class", values: REASON_CLASSES, locator: /`reason_class`\s*∈/ },
  { name: "issue_class", values: ISSUE_CLASSES, locator: /`issue_class`\s*(?:∈|는)/ },
  { name: "manifest_status", values: MANIFEST_STATUSES, locator: /`manifest_status`\s*(?:∈|는)/ },
  { name: "AutoGateAction", values: AUTO_GATE_ACTIONS, locator: /`AutoGateAction`\s*(?:∈|는)/ }
];

/** Declared beside the twelve because §4.2's `lane_disposition` row states it inline. */
const LANE_DISPOSITION_PARITY: EnumParity = {
  name: "lane_disposition.kind",
  values: LANE_DISPOSITION_KINDS,
  locator: /`lane_disposition`\s*\|/
};

/** Which of the census a copy actually declares, measured rather than assumed. */
function declaredEnums(text: string, census: readonly EnumParity[]): string[] {
  return census.filter((entry) => parseEnumValues(text, entry.locator).length > 0).map((entry) => entry.name);
}

// ---------------------------------------------------------------------------------------------

const SOURCES = COPIES.map((relativePath) => ({ relativePath, text: read(relativePath) }));

describe("FR-NODE-129 AC-3 — all four shipped copies", () => {
  it("reads exactly four copies, and every one of them is non-empty", () => {
    expect(COPIES).toHaveLength(4);
    for (const source of SOURCES) expect(source.text.length, source.relativePath).toBeGreaterThan(0);
  });
});

describe("FR-NODE-129 AC-1 — field-table parity, as set-equality in both directions", () => {
  for (const source of SOURCES) {
    it(`agrees with WAVES_EVENT_FIELDS.required in ${source.relativePath}`, () => {
      const parsed = parseFieldTable(source.text, "### 2.1");
      expect(parsed.length, "a zero-row table would make this vacuous").toBeGreaterThan(0);
      // Sorted arrays, so a field present in one side and absent from the other fails whichever side
      // it sits on: the assertion is set-equality, not inclusion.
      expect([...parsed].sort()).toEqual([...WAVES_EVENT_FIELDS.required].sort());
    });

    it(`agrees with WAVES_EVENT_FIELDS.optional in ${source.relativePath}`, () => {
      const parsed = parseFieldTable(source.text, "### 2.2");
      expect(parsed.length).toBeGreaterThan(0);
      expect([...parsed].sort()).toEqual([...WAVES_EVENT_FIELDS.optional].sort());
    });
  }

  it("fails on a field present in the document and absent from the schema", () => {
    const mutated = SOURCES[0]!.text.replace("| `card_digest` |", "| `card_digest_v2` |\n| `card_digest` |");
    expect(mutated).not.toBe(SOURCES[0]!.text);
    expect([...parseFieldTable(mutated, "### 2.2")].sort()).not.toEqual([...WAVES_EVENT_FIELDS.optional].sort());
  });

  it("fails on a schema field absent from the document", () => {
    const mutated = SOURCES[0]!.text.split(/\r?\n/).filter((line) => !/^\|\s*`card_digest`\s*\|/.test(line)).join("\n");
    expect(mutated).not.toBe(SOURCES[0]!.text);
    const parsed = parseFieldTable(mutated, "### 2.2");
    expect(parsed).not.toContain("card_digest");
    expect([...parsed].sort()).not.toEqual([...WAVES_EVENT_FIELDS.optional].sort());
  });
});

describe("FR-NODE-129 AC-2 — the bullet-form invariants, enumerated by measurement", () => {
  const anchors = [
    ...[...VIOLATION_RULES, ...JOURNAL_RULES].flatMap((rule) => [...(rule.sourceBullets ?? [])]),
    ...WAVES_EVENT_NON_VIOLATION_BULLETS
  ];

  it("cites at least one bullet from the rule tables, so the anchor set is not empty", () => {
    expect(anchors.length).toBeGreaterThan(0);
  });

  for (const source of SOURCES) {
    it(`measures the bullet set from ${source.relativePath} at run time and finds it non-empty`, () => {
      const bullets = parseBullets(source.text, "### 2.3");
      // The COUNT is derived from the document. No literal appears here, in either direction.
      expect(bullets.length).toBeGreaterThan(0);
      expect(new Set(bullets).size, "a duplicated bullet would double-count the denominator").toBe(bullets.length);
    });

    it(`resolves every rule anchor to exactly one bullet of ${source.relativePath}`, () => {
      const bullets = parseBullets(source.text, "### 2.3");
      for (const anchor of anchors) {
        expect(bullets.filter((bullet) => bullet.includes(anchor)), `anchor ${anchor}`).toHaveLength(1);
      }
    });

    it(`leaves no bullet of ${source.relativePath} unclaimed by a rule or the declared non-sources`, () => {
      const bullets = parseBullets(source.text, "### 2.3");
      expect(bullets.filter((bullet) => !anchors.some((anchor) => bullet.includes(anchor)))).toEqual([]);
    });
  }

  it("AC-6: a negative fixture adding one bullet to a single copy fails", () => {
    const original = SOURCES[0]!.text;
    const bulletsBefore = parseBullets(original, "### 2.3");
    const mutated = original.replace(
      "- `reason_class` ∈",
      "- `invented_layer.expected` 는 새로 추가한 불릿이며 어떤 규칙도 인용하지 않는다.\n- `reason_class` ∈"
    );
    expect(mutated, "the probe must actually change the text").not.toBe(original);

    const bulletsAfter = parseBullets(mutated, "### 2.3");
    expect(bulletsAfter.length).toBe(bulletsBefore.length + 1);
    // The added bullet is claimed by no rule and is in no declared non-source list, so the
    // unclaimed-bullet assertion above goes red. This is the mechanism that puts the suite red when a
    // contract row lands in the document with no code behind it.
    const uncovered = bulletsAfter.filter((bullet) => !anchors.some((anchor) => bullet.includes(anchor)));
    expect(uncovered).toHaveLength(1);
  });

  it("AC-3: a bullet landing in three copies but not the fourth fails", () => {
    const perCopy = SOURCES.map((source) => parseBullets(source.text, "### 2.3"));
    for (const bullets of perCopy) expect(bullets).toEqual(perCopy[0]);

    const three = [perCopy[0]!, perCopy[1]!, perCopy[2]!].map((bullets) => [...bullets, "- a bullet three copies gained"]);
    const fourth = perCopy[3]!;
    expect(three.every((bullets) => bullets.length === fourth.length)).toBe(false);
  });
});

describe("FR-NODE-129 AC-4 — enum parity over the twelve closed enums", () => {
  it("censuses exactly twelve, each bound to a live journal-schema.ts constant", () => {
    expect(TWELVE_ENUMS).toHaveLength(12);
    expect(TWELVE_ENUMS.map((entry) => entry.name)).toEqual([
      "status",
      "phase",
      "verb",
      "recovery_class",
      "proof_kind",
      "conflict_reason",
      "recipe_kind",
      "exclusion_class",
      "reason_class",
      "issue_class",
      "manifest_status",
      "AutoGateAction"
    ]);
    expect(new Set(TWELVE_ENUMS.map((entry) => entry.name)).size).toBe(12);
    for (const entry of TWELVE_ENUMS) {
      expect(entry.values.length, `${entry.name} is bound to a non-empty exported constant`).toBeGreaterThan(0);
    }
  });

  for (const source of SOURCES) {
    it(`agrees with every enum ${source.relativePath} declares`, () => {
      const declared = TWELVE_ENUMS.filter((entry) => parseEnumValues(source.text, entry.locator).length > 0);
      // Anti-vacuity: a document that declares nothing must not pass this test silently.
      expect(declared.length).toBeGreaterThan(0);
      for (const entry of declared) {
        expect([...parseEnumValues(source.text, entry.locator)].sort(), `${entry.name} in ${source.relativePath}`).toEqual(
          [...entry.values].sort()
        );
      }
    });

    it(`agrees on lane_disposition.kind in ${source.relativePath}`, () => {
      expect([...parseEnumValues(source.text, LANE_DISPOSITION_PARITY.locator)].sort()).toEqual([...LANE_DISPOSITION_PARITY.values].sort());
    });
  }

  it("AC-3: declares the same enums in all four copies, so a value landing in three fails", () => {
    const perCopy = SOURCES.map((source) => declaredEnums(source.text, TWELVE_ENUMS));
    for (const declared of perCopy) expect(declared).toEqual(perCopy[0]);
  });

  it("goes red when one copy's enum drifts from the schema", () => {
    const mutated = SOURCES[0]!.text.replace("`already-implemented`", "`already-shipped`");
    expect(mutated).not.toBe(SOURCES[0]!.text);
    const parsed = parseEnumValues(mutated, /`exclusion_class`\s*∈/);
    expect(parsed.length).toBeGreaterThan(0);
    expect([...parsed].sort()).not.toEqual([...EXCLUSION_CLASSES].sort());
  });

  it("goes red when a copy drops a value the schema still carries", () => {
    const mutated = SOURCES[0]!.text.replace(" / `non-normative`", "");
    expect(mutated).not.toBe(SOURCES[0]!.text);
    const parsed = parseEnumValues(mutated, /`exclusion_class`\s*∈/);
    expect(parsed).not.toContain("non-normative");
    expect([...parsed].sort()).not.toEqual([...EXCLUSION_CLASSES].sort());
  });
});

describe("FR-NODE-129 AC-5 — GateId is not part of this set-equality check", () => {
  it("is absent from the twelve-enum census", () => {
    expect(TWELVE_ENUMS.map((entry) => entry.name)).not.toContain("GateId");
    expect(TWELVE_ENUMS.map((entry) => entry.values)).not.toContain(GATE_IDS);
  });

  it("has no `gate` field in the v1.4.0 field table, which is why", () => {
    expect([...WAVES_EVENT_FIELDS.required]).not.toContain("gate");
    expect([...WAVES_EVENT_FIELDS.optional]).not.toContain("gate");
    for (const source of SOURCES) {
      expect(parseFieldTable(source.text, "### 2.2"), source.relativePath).not.toContain("gate");
    }
  });

  it("asserts gate ids by set INCLUSION, not equality — critical_gates[] is a halt list, not a census", () => {
    const included = (ids: readonly string[]): boolean => ids.every((id) => (GATE_IDS as readonly string[]).includes(id));
    // Inclusion holds for a strict subset, which is what a halt list is; equality would not.
    expect(included(["serial-unit-failed", "partition-review-unrecorded"])).toBe(true);
    expect(GATE_IDS.length).toBeGreaterThan(2);
    // And the assertion is not vacuous: an id outside the union is red.
    expect(included(["a-gate-nobody-declared"])).toBe(false);
  });
});
