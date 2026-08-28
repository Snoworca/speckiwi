import { readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { REPO_ROOT } from "./kiwi-orchestrator-variants.js";
import { MIRROR_EXCLUDED, RENDERINGS, flat, markdownFiles, readRepoFile, skillDirs } from "./kiwi-renderings.js";

// @req FR-FLOW-160 — every kiwi skill a shipped body names as an owner exists in the tree that
// ships it.
//
// BASELINE, measured before this file existed (AC-3). `kiwi-reviewer` appeared 15 times under
// `skills/` and 5 more in the mirror, across `kiwi-pm` and `kiwi-coder`; `kiwi-prd` and
// `kiwi-srs-reviewer` appeared once per rendering each. No directory of any of the three exists
// anywhere.
//
// WHAT THIS FILE DOES NOT HOLD (AC-5). It reads skill bodies only. A fictional skill name written
// into a plan document, a research note or a test fixture is outside it, and measured, such tokens
// do occur there. It keys on the hyphenated `kiwi-*` form, so a body that says `reviewer` as a bare
// English noun is invisible to it — one such sentence was found by hand in `kiwi-pm`'s frontmatter
// and fixed with this change, and nothing here would have caught it or would catch the next one.

/**
 * A `kiwi-*` token, with a left boundary.
 *
 * The boundary is not cosmetic. Without it `speckiwi-orchestrate` and `speckiwi-tool-absence` are
 * read as `kiwi-orchestrate` and `kiwi-tool-absence`, two skills that do not exist. Measured, an
 * unbounded scan reported `kiwi-orchestrate` in all four renderings and `kiwi-tool-absence` in the
 * two that carry `speckiwi-tool-absence` — codex and the mirror. A scanner that invents its own
 * findings is worse than none, because the real ones are then read as noise too.
 */
const TOKEN = /(?<![A-Za-z0-9-])kiwi-[a-z0-9]+(?:-[a-z0-9]+)*/g;

interface Occurrence {
  rendering: string;
  relPath: string;
  token: string;
}

function occurrences(): Occurrence[] {
  const out: Occurrence[] = [];
  for (const rendering of RENDERINGS) {
    for (const relPath of markdownFiles(rendering)) {
      for (const token of new Set(readRepoFile(relPath).match(TOKEN) ?? [])) out.push({ rendering, relPath, token });
    }
  }
  return out;
}

/**
 * The exemptions, as RULES rather than as a list of tokens.
 *
 * Each answers its own soundness question from the tree — is the prefix a real skill, is the token
 * standing in a path, is the name in the file the mirror is built against — so none of them can
 * excuse a name on the strength of having been written down once. A hand-written token list is the
 * shape FR-FLOW-155's judgement caught as unsound: it is checked for survival and never for being
 * right.
 */
const EXEMPTIONS: ReadonlyArray<{
  id: string;
  why: string;
  applies: (occurrence: Occurrence, existing: readonly string[]) => boolean;
}> = [
  {
    id: "versioned-skill-reference",
    why: "`<skill>-v1` names an existing skill at a version; the version suffix is not part of the directory name.",
    applies: (occurrence, existing) => {
      const stripped = occurrence.token.replace(/-v\d+$/, "");
      return stripped !== occurrence.token && existing.includes(stripped);
    }
  },
  {
    id: "analysis-run-directory",
    why: "`docs/analysis/<run-id>` carries a dated run identifier that begins with `kiwi-`; it is a path, not a skill.",
    applies: (occurrence) => {
      if (!/\d{4}-\d{2}-\d{2}/.test(occurrence.token)) return false;
      // Soundness in two steps, because the first alone is self-serving: a body can write
      // `docs/analysis/<its own invented name>` and mint its own exemption. The second asks the
      // filesystem, which the body cannot answer for itself.
      const cited = new RegExp(`docs/analysis/${occurrence.token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(readRepoFile(occurrence.relPath));
      if (!cited) return false;
      return readdirSync(path.join(REPO_ROOT, "docs/analysis")).some((entry) => entry.startsWith(occurrence.token));
    }
  },
  {
    id: "mirror-excluded-skill",
    why: "The mirror deliberately omits some skills; a body it copies may still name them.",
    applies: (occurrence) => occurrence.rendering === ".agents/skills" && MIRROR_EXCLUDED.includes(occurrence.token)
  }
];

const OCCURRENCES = occurrences();

function unresolved(): Array<Occurrence & { rule: string | null }> {
  const out: Array<Occurrence & { rule: string | null }> = [];
  for (const occurrence of OCCURRENCES) {
    const existing = skillDirs(occurrence.rendering);
    if (existing.includes(occurrence.token)) continue;
    const rule = EXEMPTIONS.find((exemption) => exemption.applies(occurrence, existing));
    out.push({ ...occurrence, rule: rule?.id ?? null });
  }
  return out;
}

describe("FR-FLOW-160 AC-1 — every named skill resolves in the tree that names it", () => {
  it("reads a non-empty corpus, so a clean sweep is not an empty one", () => {
    expect(OCCURRENCES.length, "no `kiwi-*` token was found in any rendering, which cannot be true").toBeGreaterThan(100);
    for (const rendering of RENDERINGS) {
      expect(skillDirs(rendering).length, `${rendering} lists no kiwi skills`).toBeGreaterThan(0);
    }
  });

  it("leaves no unexplained name in any rendering", () => {
    const orphans = unresolved().filter((entry) => entry.rule === null);
    expect(
      orphans.map((entry) => `${entry.relPath} names ${entry.token}`).sort(),
      `A shipped body names a skill that does not exist in its own rendering. An agent reading that sentence looks for a skill to invoke, finds nothing, and has no instruction for what to do instead — which is worse than a blank. Either the name is wrong (use the skill that does own the responsibility) or nothing owns it (say so, and name what discharges it).`
    ).toEqual([]);
  });
});

describe("FR-FLOW-160 AC-2 — the exemptions are checked, not merely consulted", () => {
  it("keeps every exemption in use, so the list cannot outlive what it excused", () => {
    const used = new Set(unresolved().map((entry) => entry.rule));
    for (const exemption of EXEMPTIONS) {
      expect(
        used.has(exemption.id),
        `the \`${exemption.id}\` exemption excuses nothing in the tree any more. ${exemption.why} If the shape it covered is gone, delete the exemption — an unused one is a hole waiting for a name that happens to fit it.`
      ).toBe(true);
    }
  });

  it("gives each exemption a soundness check the tree can answer", () => {
    // Survival is not enough: an exemption checked only for being used still excuses whatever
    // matches its shape. Each rule above resolves its own question against the tree — a prefix that
    // is a real skill, a token that really stands after `docs/analysis/`, a name really listed in
    // the mirror's exclusion file — so a token that merely LOOKS like one of those is not excused.
    const versioned = { rendering: "skills/claude", relPath: "skills/claude/kiwi-pm/SKILL.md", token: "kiwi-nonexistent-v1" };
    expect(
      EXEMPTIONS.some((exemption) => exemption.applies(versioned, skillDirs("skills/claude"))),
      "the version-suffix exemption excused a name whose prefix is not a skill, so it is a shape test rather than a soundness test"
    ).toBe(false);
    const dated = { rendering: "skills/claude", relPath: "skills/claude/kiwi-pm/SKILL.md", token: "kiwi-invented-2026-01-01" };
    expect(
      EXEMPTIONS.some((exemption) => exemption.applies(dated, skillDirs("skills/claude"))),
      "the run-directory exemption excused a dated token that stands after no `docs/analysis/` path in its own file"
    ).toBe(false);
  });
});

describe("FR-FLOW-160 AC-3 — the three fictional owners are gone", () => {
  it.each(["kiwi-reviewer", "kiwi-prd", "kiwi-srs-reviewer"])("%s appears nowhere in any rendering", (name) => {
    const where = OCCURRENCES.filter((occurrence) => occurrence.token === name).map((occurrence) => occurrence.relPath);
    expect(where.sort(), `\`${name}\` is still named as an owner. It has never existed as a directory in any rendering.`).toEqual([]);
  });
});

describe("FR-FLOW-160 AC-4 — the replacement names an owner that declares the responsibility", () => {
  /**
   * A replaced pointer and the sentence in the named skill that makes it true.
   *
   * Both halves are asserted, so re-introducing a fictional owner fails even when the sentence is
   * rewritten around it: a pointer whose target does not declare the responsibility is as red as a
   * pointer to nothing. Three pairs, one per responsibility this requirement reassigns.
   */
  // The gap is bounded by LENGTH, not by `\n`. The bodies are flattened before matching — the
  // renderings wrap at different widths and a rule split across two lines is the same rule — so a
  // newline exclusion is a dead condition after `flat()`, and the only live boundary left is the
  // table pipe. Measured on the clean tree, that let `verified 승급[^\n|]*kiwi-review-fix-loop`
  // span 2,496 characters of `kiwi-pm`, crossing an unrelated section to reach a different mention:
  // replacing the pointer with a wrong owner passed, and DELETING both sentences passed too. The
  // longest legitimate match is 94 characters, so 120 admits every real pointer and refuses a
  // sentence that reaches across a section to borrow a mention it does not own.
  const POINTERS = [
    {
      responsibility: "verified promotion",
      namedBy: "kiwi-pm",
      anchor: /verified 승급/g,
      owner: "kiwi-review-fix-loop",
      declares: /REQ verified 일괄 승급|move eligible REQs from `implemented` to `verified`/
    },
    {
      responsibility: "implementation review",
      namedBy: "kiwi-pm",
      anchor: /구현 리뷰/g,
      owner: "kiwi-review-fix-loop",
      declares: /코드 리뷰|code review/i
    },
    {
      responsibility: "stability changes",
      namedBy: "kiwi-pm",
      anchor: /Stability 변경/g,
      owner: "kiwi-srs-feasibility",
      declares: /update_stability/
    }
  ] as const;

  /** How far after an anchor the owner may stand. */
  const REACH = 120;

  it.each(RENDERINGS)("%s: each pointer names an owner, and that owner declares the responsibility", (rendering) => {
    for (const entry of POINTERS) {
      if (MIRROR_EXCLUDED.includes(entry.namedBy) && rendering === ".agents/skills") continue;
      // Flattened, because the renderings wrap at different widths and a rule split across two
      // lines is the same rule. Measured: `move eligible REQs from ... to \`verified\`` is one
      // line in codex and two in etc, and a pattern written against the sentence reports the
      // second as missing a rule it states in full.
      const naming = flat(markdownFiles(rendering, entry.namedBy).map((relPath) => readRepoFile(relPath)).join("\n"));
      // EVERY place the responsibility is named must reach the owner, not merely one of them.
      // Measured: `verified 승급` stands in two places in this skill, and an assertion satisfied by
      // one of them passed while the other pointed at a skill that disowns the work — a false
      // pointer sitting in the shipped body with nothing to report it. The gap is bounded by
      // length rather than by a newline, because the body is flattened first and `\n` is therefore
      // a dead condition; before that bound one anchor reached 2,496 characters across an
      // unrelated section to borrow a mention it did not own, and deleting the real pointer passed.
      const anchors = [...naming.matchAll(entry.anchor)].map((match) => match.index as number);
      expect(
        anchors.length,
        `${rendering}/${entry.namedBy}: nothing names ${entry.responsibility} at all. This skill disclaims the responsibility, so a reader needs to be told where it went.`
      ).toBeGreaterThan(0);
      const unreached = anchors.filter((at) => !naming.slice(at, at + REACH).split("|")[0]?.includes(entry.owner));
      expect(
        unreached.map((at) => naming.slice(at, at + 90)),
        `${rendering}/${entry.namedBy}: ${entry.responsibility} is named here without \`${entry.owner}\` within ${REACH} characters. Either this mention points somewhere else — which leaves a false owner in the shipped body — or the sentence grew past the reach and should be tightened.`
      ).toEqual([]);
      const target = flat(markdownFiles(rendering, entry.owner).map((relPath) => readRepoFile(relPath)).join("\n"));
      expect(
        entry.declares.test(target),
        `${rendering}/${entry.owner}: the skill ${entry.namedBy} points ${entry.responsibility} at does not declare it. A pointer to a skill that exists but disowns the work resolves as a name and fails as an instruction.`
      ).toBe(true);
    }
  });
});
