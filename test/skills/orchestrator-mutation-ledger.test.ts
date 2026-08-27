import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// 05 §10.3 — the Layer-3 mutation ledger for `kiwi-orchestrator/SKILL.md`.
//
// The design's own words for why this file exists: applying the design-document token set to a skill
// body yields an *empty denominator*, so a zero-row ledger would go green and be indistinguishable
// from full coverage. Everything below is therefore written so that an empty or shrinking ledger is
// RED rather than silent, and so that no count is hard-coded — the carrier set is enumerated from the
// shipped bodies at run time, per §10.4's discipline.

const VARIANTS = ["claude", "codex", "etc"] as const;
type Variant = (typeof VARIANTS)[number];

const REPO_ROOT = path.resolve(__dirname, "../..");
const LEDGER_PATH = path.resolve(__dirname, "orchestrator-mutation-ledger.json");

/** §10.3's bilingual modal set. `MUST NOT` leads so it is counted once and not twice. */
const MODAL_CARRIERS = ["MUST NOT", "MUST", "SHALL", "반드시", "절대", "금지"] as const;

interface CarrierAnchor {
  heading_path: string;
  carrier: string;
  snippet: string;
}

interface LedgerRow {
  variant: Variant;
  rule_id: string;
  owning_requirement: string;
  sentence: string;
  mutation_class: string;
  mutation: { find: string; replace: string };
  carriers: CarrierAnchor[];
}

/** §10.3's five classes. A row naming a class outside this set is not a named class. */
const MUTATION_CLASSES = [
  "inserted hedge",
  "swapped ordering pair",
  "weakened quantifier",
  "deleted negation",
  "sentence moved to an adjacent section"
] as const;

/**
 * Which rules each requirement owns here — the declared membership of the ledger, frozen.
 *
 * Everything else in this file checks rows that ARE present. Nothing checked what SHOULD be: parity
 * is over the rule_id sets the three variants happen to declare, so dropping a rule from all three
 * keeps them equal; coverage is over modal carriers, and a `carriers: []` row contributes none; the
 * emptiness check is `> 0`. A rule could therefore be released by deleting its three rows, which is
 * both easier and quieter than editing them, and for a clause whose only pin is a ledger row that is
 * the whole defence gone. Deleting rows now fails against this map, and so does moving a rule to a
 * different owner — the failure names the rule and the requirement that loses it.
 *
 * Adding a rule means adding it here too. That is the point: a rule this ledger does not declare is
 * a rule nobody has to keep.
 */
const OWNED_RULES: Record<string, string[]> = {
  "FR-FLOW-075": ["R-RESUME-NEVER-RECONSTRUCTS-FROM-CONVERSATION"],
  "FR-FLOW-076": ["R-JOURNAL-INTENT-BEFORE-VERB-RESULT-AFTER", "R-RUN-CONTRACT-NO-HAND-APPEND-TO-JOURNAL"],
  "FR-FLOW-077": ["R-INTAKE-EVERY-UNCLOSED-GAP-GOES-TO-USER-QNA", "R-INTAKE-THREE-INVESTIGATORS-IN-PARALLEL"],
  "FR-FLOW-078": ["R-DESIGN-FREEZE-BEFORE-IMPLEMENT"],
  "FR-FLOW-079": [
    "R-LOOP-D-DENOMINATOR-NEVER-COMPUTED-BY-A-VERIFIER",
    "R-LOOP-D-NO-EDIT-APPLIED-IN-THE-PASSING-ROUND",
    "R-LOOP-D-PASS-REQUIRES-ALL-FIVE-CONJUNCTS"
  ],
  "FR-FLOW-080": ["R-WAVE-DESIGN-3A-BEFORE-SRS-REGISTRATION-3B"],
  "FR-FLOW-081": [
    "R-HANDOFF-EXECUTABILITY-PROBE-APPLIES-NO-EDITS",
    "R-HANDOFF-LOOP-H-VERIFIER-2-DENOMINATOR-INCLUDES-NULL-TEST-ID-ROWS",
    "R-HANDOFF-TEN-REQUIRED-BODY-HEADINGS"
  ],
  "FR-FLOW-084": ["R-UNLANDED-TASK-FORBIDS-ALL-MATCH"],
  "FR-FLOW-087": ["R-COMMIT-IDENTITY-BY-TRAILER-NOT-SUBJECT", "R-RUN-CONTRACT-NO-REQ-ID-ALLOCATION-OUTSIDE-3B"],
  "FR-FLOW-088": ["R-NO-WT-PROPAGATION-TO-DELEGATED-PIPELINE"],
  "FR-FLOW-093": [
    "R-ORCHESTRATOR-NEVER-MERGES-NEVER-OPENS-PR",
    "R-RUN-CONTRACT-NO-BULK-STAGING",
    "R-RUN-CONTRACT-NO-MERGE-INTO-BASE",
    "R-RUN-CONTRACT-NO-PULL-REQUEST",
    "R-RUN-CONTRACT-PROHIBITED-ACTIONS-CLOSED-LIST"
  ],
  "FR-FLOW-099": ["R-ALLOW-PLAN-RESIDUAL-IS-AN-ABSOLUTE-ROW-COUNT"],
  "FR-FLOW-102": ["R-RUN-CONTRACT-NO-REDECOMPOSITION"],
  "FR-FLOW-103": ["R-COMMITTEE-INPUT-CARRIES-FACTS-NEVER-THE-PROPOSAL"],
  "FR-FLOW-118": [
    "R-RUN-CONTRACT-NO-EDIT-COMPLETED-UNIT",
    "R-RUN-CONTRACT-NO-TEST-WEAKENING",
    "R-RUN-CONTRACT-NO-WRITE-OUTSIDE-LEASE"
  ],
  "FR-FLOW-132": ["R-STEP-REVIEW-HOP-DOES-NOT-TOUCH-RED-TESTS"],
  // The six normative clauses of §V.final-verify's validator paragraph. Six and not three: the first
  // round pinned only the clauses a probe had reached, and the main instruction — put the line through
  // the validator — was not one of them, so inverting it cost nothing anywhere. The sixth was added a
  // round later, when a probe inverted the fallback CONDITION (`MCP 가 없으면` → `MCP 가 있어도`) with
  // an edit to the body and the golden only: the neighbouring row pinned the MCP arguments and stopped
  // at the comma, so the clause that decides WHICH caller runs had no row of its own. Each row must
  // quote the whole rule it names, trigger included — two of them were widened in the same change for
  // the same reason.
  "FR-FLOW-155": [
    "R-FINAL-VERIFY-CLI-IS-THE-FALLBACK-WHEN-MCP-IS-ABSENT",
    "R-FINAL-VERIFY-ORCHESTRATOR-JOURNAL-IS-VALIDATED-WITH-RUN-ID-AND-STRICT",
    "R-FINAL-VERIFY-REFUSAL-HALTS-WITHOUT-REWRITING-THE-TERMINAL-LINE",
    "R-FINAL-VERIFY-TERMINAL-LINE-IS-PUT-THROUGH-THE-VALIDATOR-IMMEDIATELY",
    "R-FINAL-VERIFY-WAVE-MASTER-JOURNAL-CARRIES-THE-ENGINE-FLAG",
    "R-FINAL-VERIFY-WAVE-MASTER-JOURNAL-IS-NOT-VALIDATED-OVER-MCP"
  ],
  unowned: ["R-SECTION-ZERO-NO-CHANGELOG-IN-BODY", "R-SECTION-ZERO-NO-COMMIT-SIGNATURE", "R-SECTION-ZERO-NO-SNOWORCA-SKILL-CALL"]
};

function skillBody(variant: Variant): string {
  return readFileSync(path.resolve(REPO_ROOT, `skills/${variant}/kiwi-orchestrator/SKILL.md`), "utf8");
}

/**
 * §3.3 rule 6's exclusion set: fenced code, blockquote content and inline code spans. Masked lines
 * keep their index so a carrier's line number still refers to the real body.
 */
function maskExcluded(text: string): string[] {
  let fenced = false;
  return text.split(/\r?\n/).map((line) => {
    if (/^\s*```/.test(line)) {
      fenced = !fenced;
      return "";
    }
    if (fenced) return "";
    if (/^\s*>/.test(line)) return "";
    return line.replace(/`[^`]*`/g, (span) => " ".repeat(span.length));
  });
}

/** Every carrier occurrence in a variant's body, as `{line, carrier}`, `MUST NOT` counted once. */
function carrierOccurrences(text: string): Array<{ line: number; carrier: string }> {
  const found: Array<{ line: number; carrier: string }> = [];
  maskExcluded(text).forEach((line, index) => {
    let cursor = 0;
    while (cursor < line.length) {
      const next = MODAL_CARRIERS.map((carrier) => ({ carrier, at: line.indexOf(carrier, cursor) }))
        .filter((entry) => entry.at >= 0)
        .sort((a, b) => a.at - b.at || b.carrier.length - a.carrier.length)[0];
      if (next === undefined) break;
      found.push({ line: index + 1, carrier: next.carrier });
      cursor = next.at + next.carrier.length;
    }
  });
  return found;
}

/**
 * The lowest-level heading a line sits under, as the `#`-chain joined by " > " — §3.3 rule 1's
 * definition, which is what a `heading_path` anchor resolves against.
 */
function headingPathAt(text: string, lineNumber: number): string {
  const raw = text.split(/\r?\n/);
  const masked = maskExcluded(text);
  const chain: string[] = [];
  for (let index = 0; index < lineNumber && index < raw.length; index++) {
    if (masked[index] === "") continue;
    const heading = /^(#{1,6})\s+(.*)$/.exec(raw[index] ?? "");
    if (heading === null) continue;
    const level = heading[1]!.length;
    chain.length = Math.max(0, level - 1);
    chain[level - 1] = heading[2]!.trim();
  }
  return chain.filter(Boolean).join(" > ");
}

/** Every requirement id that has a block in the SRS, read from the documents rather than restated. */
function shippedRequirementIds(): Set<string> {
  const specDir = path.resolve(REPO_ROOT, "docs/spec");
  const ids = new Set<string>();
  for (const file of readdirSync(specDir).filter((name) => name.endsWith(".srs.md"))) {
    for (const line of readFileSync(path.join(specDir, file), "utf8").split(/\r?\n/)) {
      const heading = /^###\s+([A-Z]+-[A-Z]+-\d+)\b/.exec(line);
      if (heading !== null) ids.add(heading[1]!);
    }
  }
  return ids;
}

/** Whitespace-insensitive, so `find + " "` does not read as a different string. */
const squash = (text: string): string => text.replace(/\s+/g, " ").trim();

/** The markers a Korean or English prohibition is carried by; counted, because a sentence can hold several. */
const NEGATIONS = /않|없|아니|말라|금지|MUST NOT/g;
const HEDGES = /수 있다|해도 된다|권장|바람직|가능하면|되도록|가급적|것이 좋다|선택적|해도 무방|권한다/;

const LEDGER: LedgerRow[] = JSON.parse(readFileSync(LEDGER_PATH, "utf8")) as LedgerRow[];
const BODIES = new Map<Variant, string>(VARIANTS.map((variant) => [variant, skillBody(variant)]));

describe("05 §10.3 — the ledger is not vacuous", () => {
  it("carries rows against a non-empty body, because a zero-row ledger is RED and not green", () => {
    for (const variant of VARIANTS) expect(BODIES.get(variant)!.length, variant).toBeGreaterThan(0);
    expect(LEDGER.length, "a zero-row ledger against a non-empty skill body is RED").toBeGreaterThan(0);
  });

  it("names only classes from §10.3's closed five", () => {
    for (const row of LEDGER) {
      expect(MUTATION_CLASSES as readonly string[], `${row.variant}/${row.rule_id}`).toContain(row.mutation_class);
    }
  });

  it("names only the three shipped variants", () => {
    for (const row of LEDGER) expect(VARIANTS as readonly string[]).toContain(row.variant);
  });

  // `unowned` is a permitted value and a deliberate one. It now covers exactly three rules — the
  // `/snoworca-*` call ban, the commit-signature ban and the changelog-in-body ban — and those are
  // not a governance gap: their source is the project's `CLAUDE.md`, and
  // `FR-FLOW-034` states outright that *"snoworca-* is a separate
  // forbidden suite (project CLAUDE.md), out of scope"*. A rule with a stated non-SRS source is
  // owned, just not here. Spelling the value out keeps that visible instead of letting a typo in a
  // requirement id read as an attribution.
  it("attributes every row either to a requirement id or to the literal `unowned`", () => {
    for (const row of LEDGER) {
      expect(row.owning_requirement, `${row.variant}/${row.rule_id}`).toMatch(/^((FR|IR|NFR|DR|SEC|PERF|REL|OBS|OPS|MIG|CON)-[A-Z]+-\d+|unowned)$/);
    }
  });

  it("keeps the unowned set identical across the three variants, so a rule cannot lose its owner in one rendering", () => {
    const [first, ...rest] = VARIANTS.map((variant) =>
      LEDGER.filter((row) => row.variant === variant && row.owning_requirement === "unowned")
        .map((row) => row.rule_id)
        .sort()
    );
    for (const other of rest) expect(other).toEqual(first);
  });
});

describe("05 §10.3 — the ledger's membership is declared, so a rule cannot be released by deleting it", () => {
  it.each(VARIANTS)("%s: owns exactly the rules OWNED_RULES declares, per requirement", (variant) => {
    const declared = new Map<string, string[]>();
    for (const row of LEDGER.filter((entry) => entry.variant === variant)) {
      declared.set(row.owning_requirement, [...(declared.get(row.owning_requirement) ?? []), row.rule_id].sort());
    }
    const expected = Object.fromEntries(Object.entries(OWNED_RULES).map(([id, rules]) => [id, [...rules].sort()]));
    expect(Object.fromEntries([...declared.entries()].sort()), `${variant}: the ledger's rule membership moved`).toEqual(
      Object.fromEntries(Object.entries(expected).sort())
    );
  });

  it("attributes every owned rule to a requirement that exists in the SRS, not merely to a well-formed id", () => {
    // The shape check above accepts `FR-FLOW-001` whether or not anything by that name was ever
    // written. An attribution that resolves to nothing is not an attribution; it reads like one in a
    // review and carries no obligation, which is the worse of the two failures.
    const shipped = shippedRequirementIds();
    expect(shipped.size, "no requirement headings were read, so this check would accept anything").toBeGreaterThan(0);
    for (const id of Object.keys(OWNED_RULES)) {
      if (id === "unowned") continue;
      expect(shipped.has(id), `${id} owns ledger rows but has no requirement block under docs/spec/`).toBe(true);
    }
  });
});

describe("05 §10.3 — every modal carrier is covered by a row's carrier anchor", () => {
  for (const variant of VARIANTS) {
    it(`${variant}: the enumerated carrier count is non-zero, so the coverage check is not vacuous`, () => {
      expect(carrierOccurrences(BODIES.get(variant)!).length).toBeGreaterThan(0);
    });

    it(`${variant}: covers every carrier occurrence, counted from the body rather than a literal`, () => {
      const body = BODIES.get(variant)!;
      const occurrences = carrierOccurrences(body);
      const anchors = LEDGER.filter((row) => row.variant === variant).flatMap((row) => row.carriers);

      // Coverage, not a count comparison: §10.3 rejects comparing against a per-variant sentence
      // count because one sentence carrying two carriers would make the comparison over-demand.
      const uncovered = occurrences.filter(({ line, carrier }) => {
        const lineText = body.split(/\r?\n/)[line - 1] ?? "";
        return !anchors.some(
          (anchor) => anchor.carrier === carrier && lineText.includes(anchor.snippet) && anchor.snippet.includes(carrier)
        );
      });
      // The bare list of `{line, carrier}` was the least actionable red in this suite, and it fires
      // most often on the edit that DESERVES it least: adding `반드시` to a sentence strengthens the
      // rule and the reader is told only that an array did not equal an empty one. Say what the
      // invariant is and what closes it, because the alternative is that the cheapest way out of
      // this red is to drop the word again.
      expect(
        uncovered,
        `skills/${variant}/kiwi-orchestrator/SKILL.md carries modal wording that no ledger row anchors: ${JSON.stringify(
          uncovered
        )}. §10.3's coverage denominator is enumerated from the body, so an unanchored carrier is a normative sentence this ledger does not pin — it shrinks the denominator silently rather than failing. Close it by adding a \`carriers\` entry (\`heading_path\` + \`carrier\` + a \`snippet\` from that line) to the row whose rule that sentence states, in all three variants; if no row states it, the sentence is a rule with no probe and needs a row of its own with its owning requirement. Deleting the modal word to get green is the one repair that loses something.`
      ).toEqual([]);
    });

    it(`${variant}: every anchor's snippet resolves under its own heading_path`, () => {
      const body = BODIES.get(variant)!;
      const lines = body.split(/\r?\n/);
      for (const row of LEDGER.filter((entry) => entry.variant === variant)) {
        for (const anchor of row.carriers) {
          const hit = lines.findIndex((line) => line.includes(anchor.snippet));
          expect(hit, `${row.rule_id}: snippet ${JSON.stringify(anchor.snippet)} no longer resolves`).toBeGreaterThanOrEqual(0);
          expect(headingPathAt(body, hit + 1), `${row.rule_id}: snippet moved out from under its heading`).toBe(anchor.heading_path);
        }
      }
    });
  }
});

describe("05 §10.3 — parity is over rule_id, never over token counts", () => {
  it("declares the same rule_id set in all three variants", () => {
    const [first, ...rest] = VARIANTS.map((variant) => [...new Set(LEDGER.filter((row) => row.variant === variant).map((row) => row.rule_id))].sort());
    for (const other of rest) expect(other).toEqual(first);
    expect(first!.length, "an empty rule set would make the parity check vacuous").toBeGreaterThan(0);
  });

  it("keeps one row per rule_id per variant, so a duplicate cannot inflate coverage", () => {
    for (const variant of VARIANTS) {
      const ids = LEDGER.filter((row) => row.variant === variant).map((row) => row.rule_id);
      expect(new Set(ids).size, variant).toBe(ids.length);
    }
  });
});

describe("05 §10.3 — the mutation is real: its find string exists exactly once and its replace differs", () => {
  for (const variant of VARIANTS) {
    it(`${variant}: every mutation.find matches exactly once, so a probe cannot silently remove nothing`, () => {
      const body = BODIES.get(variant)!;
      for (const row of LEDGER.filter((entry) => entry.variant === variant)) {
        const occurrences = body.split(row.mutation.find).length - 1;
        // Zero is by far the common reading of this red, and it does not mean the rule was broken —
        // it usually means the sentence was legitimately reworded, split or reordered, and this row
        // still quotes the old bytes. Say so, because the alternative is that someone reads a count
        // and guesses.
        expect(
          occurrences,
          `${row.rule_id}: this row quotes ${JSON.stringify(row.mutation.find.slice(0, 60))}, which now occurs ${occurrences} times in skills/${variant}/kiwi-orchestrator/SKILL.md. If the rule still holds and only its wording moved, re-copy the sentence into this row; if the rule is gone, remove it from OWNED_RULES in the same change.`
        ).toBe(1);
        // Squashed, because `find + " "` is a different string and the same sentence: a row whose
        // replace differs only in whitespace declares a probe that changes the rule into itself and
        // reports the row exercised.
        expect(squash(row.mutation.replace), `${row.rule_id}: replace must differ from find in more than whitespace`).not.toBe(
          squash(row.mutation.find)
        );
      }
    });

    // `mutation_class` was checked for enum membership only, so a row could name any of the five and
    // carry a probe from none of them — and the two classes checked here are the ones the ledger
    // actually leans on, 78 rows of 111. The other three are not mechanised: an ordering swap and a
    // weakened quantifier are recognised by reading the pair, and a sentence moved to an adjacent
    // section is not expressible as find/replace at all. Those stay reviewed rather than asserted,
    // and this comment is the record of which half is which.
    it(`${variant}: a row whose declared class is mechanically checkable carries a probe of that class`, () => {
      for (const row of LEDGER.filter((entry) => entry.variant === variant)) {
        const { find, replace } = row.mutation;
        if (row.mutation_class === "deleted negation") {
          const before = find.match(NEGATIONS)?.length ?? 0;
          const after = replace.match(NEGATIONS)?.length ?? 0;
          expect(before, `${row.rule_id}: declares a deleted negation but its find carries none`).toBeGreaterThan(0);
          expect(after, `${row.rule_id}: declares a deleted negation but its replace deletes none`).toBeLessThan(before);
        }
        if (row.mutation_class === "inserted hedge") {
          expect(HEDGES.test(find), `${row.rule_id}: declares an inserted hedge but its find is already hedged`).toBe(false);
          expect(HEDGES.test(replace), `${row.rule_id}: declares an inserted hedge but its replace inserts none`).toBe(true);
        }
      }
    });

    // Applying a mutation replaces `find`, so the uniqueness case above drops from 1 to 0 and this
    // file goes red — every row is probe-reachable by construction. What that alone does NOT show is
    // that the mutation lands on the sentence the row anchored: a `find` elsewhere in the body would
    // still turn the count red while leaving the anchored rule untouched. Byte overlap with a carrier
    // snippet is the wrong test for that — the normative force of a Korean sentence is often carried
    // by the `-지 않는다` negation while the `금지` token sits in a neighbouring clause of the same
    // sentence, and §10.3's carrier set does not include the suffix. Same-line is the honest tie.
    it(`${variant}: every carrier-anchored mutation lands on a line the row itself anchored`, () => {
      const lines = BODIES.get(variant)!.split(/\r?\n/);
      for (const row of LEDGER.filter((entry) => entry.variant === variant)) {
        const head = row.mutation.find.split(/\r?\n/)[0]!;
        const mutatedLine = lines.findIndex((line) => line.includes(head));
        expect(mutatedLine, `${row.rule_id}: mutation.find does not resolve to a line`).toBeGreaterThanOrEqual(0);
        // A row with no carriers is a *named-sentence* row: §10.3's modal set is `MUST`/`SHALL`/
        // `반드시`/`절대`/`금지`, and an ordering rule ("intent before the verb, result after it") or a
        // quantifier rule ("three investigators in parallel") carries none of them while still being
        // normative and named by an acceptance criterion. Those rows contribute nothing to carrier
        // coverage — they are held by the uniqueness case above, which their mutation turns red.
        if (row.carriers.length === 0) continue;
        const anchored = row.carriers.some((anchor) => (lines[mutatedLine] ?? "").includes(anchor.snippet));
        expect(anchored, `${row.rule_id}: mutation lands on a line carrying none of this row's anchors`).toBe(true);
      }
    });

    it(`${variant}: a named-sentence row states which requirement named it, so it cannot be a free-floating claim`, () => {
      for (const row of LEDGER.filter((entry) => entry.variant === variant && entry.carriers.length === 0)) {
        expect(row.owning_requirement, `${row.rule_id}: a row with no carrier must name its owning requirement`).toMatch(/^(FR|IR|NFR)-[A-Z]+-\d+$/);
      }
    });
  }
});
