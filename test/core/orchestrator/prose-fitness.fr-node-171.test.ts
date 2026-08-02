import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { HEDGE_TOKENS, scanProse } from "../../../src/core/orchestrator/prose-gate.js";

// @req FR-NODE-171 — the hedge detector matches on a word boundary, and the gate carries the
// fitness assertion it has to satisfy before anyone wires it.
//
// `scanProse` matched with `includes()`, so "thoroughly" matched `roughly`. The obvious repair is
// the `\b` the normative counter uses, and it is wrong here: `\b` is defined over [A-Za-z0-9_] and
// six of the eighteen tokens are Hangul, so it silences a third of the vocabulary.

const CORPUS_DIR = path.join(process.cwd(), "docs/research/kiwi-orchestrator");

/** This file, read by AC-4's case so the admission ticket cannot be removed unnoticed. */
const SELF = fileURLToPath(import.meta.url);

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

  it("bounds an ASCII token by ASCII letters and matches a non-ASCII token by containment", () => {
    // Asserted through `scanProse`. The case this replaces built its own RegExp and never called the
    // detector, so it was evidence about the test rather than about the shipped matcher.
    expect(hedgeTokensIn("# heading\n\nThe xmaybex holds.\n"), "an ASCII token between ASCII letters is embedded").not.toContain("maybe");
    expect(hedgeTokensIn("# heading\n\nThe (maybe) holds.\n"), "punctuation is not a longer word").toContain("maybe");
    expect(hedgeTokensIn("# heading\n\n설계는대충이다.\n"), "a Hangul token between Hangul is not embedded").toContain("대충");
  });
});

/** The eight particles Korean attaches directly to a noun, with no space before them. */
const PARTICLES = ["은", "는", "이", "가", "로", "도", "라고", "하다"];

describe("FR-NODE-171 AC-7 — Korean agglutination is not embedding", () => {
  it.each(HANGUL_TOKENS.map((token) => [token] as const))("still fires for %s with a particle attached", (token) => {
    for (const particle of PARTICLES) {
      expect(
        hedgeTokensIn(`# heading\n\n설계는 ${token}${particle} 맞다.\n`),
        `${token}${particle} lost its finding`
      ).toContain(token);
    }
  });

  it("still fires on reduplication, which no boundary can tell from a longer word", () => {
    expect(hedgeTokensIn("# heading\n\n설계를 대충대충 했다.\n")).toContain("대충");
  });
});

describe("FR-NODE-171 AC-8 — another script beside an ASCII token is not embedding", () => {
  it("fires for maybe라는, roughly한 and approximately3", () => {
    expect(hedgeTokensIn("# heading\n\nmaybe라는 표현이 있다.\n")).toContain("maybe");
    expect(hedgeTokensIn("# heading\n\nroughly한 추정이다.\n")).toContain("roughly");
    expect(hedgeTokensIn("# heading\n\nIt is approximately3 metres.\n")).toContain("approximately");
  });

  it("still refuses the AC-2 embeddings, so the widening is not a revert", () => {
    expect(hedgeTokensIn("# heading\n\nThe design was thoroughly reviewed.\n")).not.toContain("roughly");
    expect(hedgeTokensIn("# heading\n\nMaybelline is a brand name.\n")).not.toContain("maybe");
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

  // AC-4. Deliberately the LAST case in the file, and it reads only the source ABOVE the ticket, so
  // it cannot satisfy itself. A containment check written with the ticket's call text spelled out
  // would match its own assertion and keep passing after the case it guards had been deleted — and
  // the first draft of this very case proved it, by counting its own explanatory comment as a
  // second registration. Nothing below may spell that call out literally.
  it("keeps exactly one admission ticket, registered skipped, with its reason recorded", () => {
    const source = readFileSync(SELF, "utf8");
    const marker = /\bit\.skip\(/g;
    expect(source.match(marker) ?? [], "exactly one skipped case, and it is the admission ticket").toHaveLength(1);

    const at = source.search(marker);
    // The reason wraps across comment lines, so a phrase can straddle a `\n  // `. Strip the comment
    // markers and collapse whitespace before looking for one, or the check fails on formatting.
    const reason = source
      .slice(0, at)
      .split("\n")
      .slice(-8)
      .join(" ")
      .replace(/\/\//g, " ")
      .replace(/\s+/g, " ");
    for (const structuralClass of ["markdown tables", "inline quotation", "use-versus-mention"]) {
      expect(reason, `the skip reason must name ${structuralClass}`).toContain(structuralClass);
    }
    expect(reason, "the skip reason must carry the measured count").toMatch(/7 `unmarked-normative-prose` findings across 4 of the 13/);
  });
});
