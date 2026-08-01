import { readFileSync } from "node:fs";
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

  // `unowned` is a permitted value and a deliberate one: six of these rules are normative sentences
  // the shipped skill states with no requirement behind them. Spelling it out keeps that visible
  // instead of letting a typo in a requirement id read as an attribution.
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
      expect(uncovered, `${variant} carriers with no ledger anchor`).toEqual([]);
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
        expect(occurrences, `${row.rule_id}: find string occurs ${occurrences} times`).toBe(1);
        expect(row.mutation.replace, `${row.rule_id}: replace must differ from find`).not.toBe(row.mutation.find);
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
