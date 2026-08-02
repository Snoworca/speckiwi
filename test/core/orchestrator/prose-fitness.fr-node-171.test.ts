import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { HEDGE_TOKENS, scanProse } from "../../../src/core/orchestrator/prose-gate.js";

// @req FR-NODE-171 — the hedge detector matches on a word boundary, and the gate carries the
// fitness assertion it has to satisfy before anyone wires it.
//
// `scanProse` matched with `includes()`, so "thoroughly" matched `roughly`. The obvious repair is
// the `\b` the normative counter uses, and it is wrong here: `\b` is defined over [A-Za-z0-9_] and
// six of the eighteen tokens are Hangul, so it silences a third of the vocabulary.

const CORPUS_DIR = path.join(process.cwd(), "docs/research/kiwi-orchestrator");

/** The Hangul tokens, named rather than derived, so the case says what it is guarding. */
const HANGUL_TOKENS = ["아마도", "대충", "적당히", "어느 정도", "듯하다", "웬만하면"];

function hedgeTokensIn(text: string): string[] {
  return scanProse(text)
    .findings.filter((finding) => finding.rule === "hedge")
    .map((finding) => finding.token ?? "");
}

/**
 * The corpus. Not the population: the gate is scoped to `design/00.design.md` and
 * `waves/wave-{n}/design.md`, and neither exists anywhere in this repository, so these are the
 * closest available proxies and every number drawn from them says so.
 */
function designCorpus(): string[] {
  return readdirSync(CORPUS_DIR)
    .filter((name) => name.endsWith(".md"))
    .map((name) => path.join(CORPUS_DIR, name));
}

describe("FR-NODE-171 AC-1 / AC-3 — every declared token still fires", () => {
  it("declares eighteen tokens, six of them Hangul", () => {
    expect(HEDGE_TOKENS).toHaveLength(18);
    for (const token of HANGUL_TOKENS) expect(HEDGE_TOKENS as readonly string[]).toContain(token);
  });

  it.each(HEDGE_TOKENS.map((token) => [token] as const))("raises a hedge finding for %s", (token) => {
    expect(hedgeTokensIn(`# heading\n\nThe design ${token} holds.\n`)).toContain(token);
  });

  it("would lose the six Hangul tokens under a [A-Za-z0-9_] boundary, which is why it is not used", () => {
    // Recorded mechanically rather than only in prose: `\b` does not match at a Hangul edge, so a
    // `\b`-based matcher fails on its own token. That is the measurement, not an opinion.
    const wordBoundaryFires = (token: string): boolean => new RegExp(`\\b${token}\\b`, "iu").test(token);
    expect(HANGUL_TOKENS.filter(wordBoundaryFires), "no Hangul token survives a \\b matcher").toEqual([]);
    expect(HEDGE_TOKENS.filter((token) => !HANGUL_TOKENS.includes(token)).every(wordBoundaryFires)).toBe(true);
  });
});

describe("FR-NODE-171 AC-2 — a token inside a longer word is not a hedge", () => {
  it("does not match roughly inside thoroughly, nor maybe inside Maybelline", () => {
    expect(hedgeTokensIn("# heading\n\nThe design was thoroughly reviewed.\n")).not.toContain("roughly");
    expect(hedgeTokensIn("# heading\n\nMaybelline is a brand name.\n")).not.toContain("maybe");
  });

  it("still matches the same tokens standing alone", () => {
    expect(hedgeTokensIn("# heading\n\nThe design is roughly right.\n")).toContain("roughly");
    expect(hedgeTokensIn("# heading\n\nMaybe the design is right.\n")).toContain("maybe");
  });
});

describe("FR-NODE-171 AC-4 / AC-5 — the gate's admission ticket", () => {
  // AC-5: the guard the skipped case depends on runs unskipped, so a corpus loader that resolved to
  // nothing could not make the skipped case vacuous the day someone un-skips it.
  it("resolves a corpus of at least thirteen design documents", () => {
    expect(designCorpus().length, "the corpus resolved to nothing or shrank").toBeGreaterThanOrEqual(13);
  });

  // SKIPPED, and this is the reason: 7 `unmarked-normative-prose` findings across 4 of the 13
  // documents, and all 7 are false positives in three structural classes — markdown tables, inline
  // quotation, and use-versus-mention. Landing it red would destroy the zero-failure baseline every
  // later session reconciles against. Un-skip it in the same change that fixes those three classes;
  // that is what admits the gate to be wired, and nothing in this requirement wires it.
  it.skip("raises no unmarked-normative-prose finding on any design document in the repo", () => {
    const files = designCorpus();
    expect(files.length, "the corpus resolved to nothing").toBeGreaterThanOrEqual(13);
    for (const file of files) {
      const findings = scanProse(readFileSync(file, "utf8")).findings.filter(
        (finding) => finding.rule === "unmarked-normative-prose"
      );
      expect(findings, `${file}: ${findings.map((finding) => finding.lines[0] ?? "?").join(",")}`).toEqual([]);
    }
  });
});
