import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { PROCEDURE_NOUNS, REWRITE_PERMITTED } from "./kiwi-orchestrator-variants.js";
import { RENDERINGS, type ScanUnit, readRepoFile, scanUnits, sharedKiwiEntries, sharedKiwiFiles, unitAt } from "./kiwi-renderings.js";

// @req FR-FLOW-158 AC-1 — the corpus is every file under `_shared/kiwi/`, read from the directory.
// @req FR-FLOW-158 AC-2 — `run-ledger.md` is in it, and the sentence measured green there is red.
// @req FR-FLOW-158 AC-3 — a name that is not zero somewhere buys that FILE an exemption, not the set.
// @req FR-FLOW-158 AC-4 — each pattern's case sensitivity and separator set is decided here.
// @req FR-FLOW-158 AC-5 — the `검증` path is closed by a sentence-shape ban, not by a wider name list.
// @req FR-FLOW-158 AC-6 — where this stops, measured rather than described.
//
// ─── WHAT THIS FILE GUARANTEES ──────────────────────────────────────────────────────────────────
// That no file under `_shared/kiwi/`, in any rendering that ships the directory, rules on when the
// run's terminal line is put through the validator, by which caller, or what is done when it
// refuses. `§0` of `kiwi-orchestrator` defers to ten of these files by name, and the skill keeps
// that procedure for itself under a golden in `§V.final-verify`. A sentence stating the opposite in
// a file the skill defers to is read by an agent as authority, not as a conflict.
//
// FR-FLOW-155 AC-8 drew this boundary at ONE of the ten — the event SSOT `waves-event.md`, which
// `§0.1` names — and measured the other nine open. A sentence in `run-ledger.md` using every one of
// the five names, saying the terminal line is not put through the validator and that a repeated
// diagnostic is answered by overwriting the line, left the three suites at 102 passing and 0
// failing; `verify-loop.md` behaved identically. This file is that corpus widened to the directory.
//
// Every bound this file runs under — how many renderings, how many files, how many names, how many
// permission verbs, and the ban's radius — is read out of the requirement rather than typed here.
// A literal bound cannot be defended by the check it bounds: lower it and the sweep shrinks while
// every assertion stays green. Measured before that change: dropping the per-rendering floor to
// zero and narrowing the corpus to four files left all 18 assertions green, 45 of 49 files gone.
//
// ─── WHAT THIS FILE DOES NOT GUARANTEE ──────────────────────────────────────────────────────────
// That an agent reads a shared file, or obeys it. Nothing here observes a run.
// That a shipped file OUTSIDE `_shared/kiwi/` is silent: a skill body other than
// `kiwi-orchestrator`, a document under `docs/`, and every rendering of `kiwi-wave-master` are
// outside this corpus, and the last of those is FR-FLOW-156's. The corpus assertion below states
// that boundary as a predicate over the paths rather than leaving it to this comment.
// That a shared file's content is CORRECT. Only that it does not rule on this one procedure.
// That a contradiction carrying none of the five names and not shaped like the ban is caught. The
// residual is measured directly, below, with the sentence that survives it.
// That a name broken across a word rather than at a separator is read as the name: `--eng` folded
// above `ine` reassembles as `--eng ine`, which no pattern reaches. Folds AT a separator are
// closed, which is where a wrapper actually breaks a hyphenated token.
// That a sentence split across two LIST ITEMS, or across two lines of a CODE FENCE, is read as one.
// A renderer draws a boundary at both, and this reads them as separate blocks for that reason, so
// the half-sentences on either side of that boundary are each judged alone — the price of not
// refusing two unrelated bullets, or two unrelated fields of one JSON object, that happen to sit
// next to each other.
// That every way of saying the permitted thing is in the verb list. It is a closed list of
// SPELLINGS filling three slots per lemma, and FIVE classes outside it are decided rather than
// overlooked. Two of them are inside the census of 224 forms, 16 lemmas by 14 endings: another
// conjugation of a lemma it carries, in a slot outside those three, which is the largest and runs
// over ten endings; and the polite register, 11 — one per lemma whose entry is not a prefix of
// everything the rule spells, the other five being caught whatever ending they take — measured at
// 0 occurrences against 1,507 plain declaratives over the 49 files. The CAUGHT and OPEN totals are
// deliberately absent: they turn on which conjugation a table picks for `-어도`, where `선택이라도`
// is caught by the entry `선택이라` and `선택이어도` is not, and an independently written table of
// the same 16×14 shape differs by one there. Three sit outside that census because they are not
// conjugations of its lemmas at all: a different verb built on the same
// root, such as the passive `생략된다`; a synonym or the pronoun form; and a slot spelled with a
// space the list does not write, `생략 한다`, which is the direction AC-5's spacing fold does not
// take. Each is asserted green below, so widening the list is a change this file reports.

const SELF_PATH = fileURLToPath(import.meta.url);
const CORPUS = sharedKiwiFiles();

/** The declaration the corpus must be bound to, matched against this file's own source. */
const CORPUS_WIRING = /^const CORPUS = sharedKiwiFiles\(\);\s*$/m;

/**
 * What the corpus may contain: a rendering's `_shared/kiwi/`, at any depth beneath it.
 *
 * `.+` rather than `[^/]+` because the scan reaches a subdirectory and a predicate that did not
 * turned a CLEAN nested file red — measured — while telling its reader the file was not under
 * `_shared/kiwi/`, which it was. Held on constructed paths as well as on the shipped corpus, since
 * the tree carries no nested shared file today and a re-narrowing would pass over it in silence.
 */
const CORPUS_PATH = /^(?:skills\/[^/]+|\.agents\/skills)\/_shared\/kiwi\/.+\.md$/;

/** The requirement's own text, so the rule set below cannot be narrowed without leaving its source. */
const REQUIREMENT = ((): string => {
  const srs = readRepoFile("docs/spec/60.workflow-release.srs.md");
  const start = srs.indexOf("### FR-FLOW-158 ");
  if (start === -1) return "";
  const end = srs.indexOf("\n### ", start + 1);
  return end === -1 ? srs.slice(start) : srs.slice(start, end);
})();

/** The acceptance criteria alone, which is where the bounds below are written. */
const CRITERIA = ((): string => {
  const start = REQUIREMENT.indexOf("#### Acceptance Criteria");
  if (start === -1) return "";
  const end = REQUIREMENT.indexOf("\n#### ", start + 1);
  return end === -1 ? REQUIREMENT.slice(start) : REQUIREMENT.slice(start, end);
})();

/**
 * The bounds the criteria name, as `` `<name> <number>` `` pairs, under the keys this file reads.
 *
 * The same shape FR-FLOW-164 uses, and for the same reason: a floor written as a literal here is a
 * reach the check it bounds cannot defend. Moving it into the requirement makes narrowing the sweep
 * a requirement diff rather than a one-character edit nothing reports.
 */
const BOUNDS = new Map<string, number>([...CRITERIA.matchAll(/`([a-z]+) (\d+)`/g)].map((match) => [match[1] as string, Number(match[2])]));

/** One bound, by the key the requirement names it under. Absent means it stopped bounding anything. */
function floor(name: string): number {
  const value = BOUNDS.get(name);
  if (value === undefined) throw new Error(`FR-FLOW-158 names no bound \`${name}\`, so this assertion has nothing to hold to`);
  return value;
}

/**
 * The five names, and what each pattern's separator set and case sensitivity BUY.
 *
 * Decided here rather than inherited from the pattern each was copied from. The inherited one was
 * measurably porous: `/orchestrate[_ ]validate/` admitted `orchestrate-validate`, and a hyphen is
 * how a Korean sentence most naturally writes a two-word command name.
 *
 * - the MCP tool — case-insensitive, separators `-` `_` and space. Three spellings ship in this
 *   tree for one thing: the MCP tool is `orchestrate_validate`, the CLI is `orchestrate validate`,
 *   and prose hyphenates. A separator-less `orchestratevalidate` is NOT admitted: nothing writes it
 *   and admitting it would be a pattern nobody can predict from the tree.
 * - the validator function — case-insensitive, optional `-`/`_`/space between the three words, so
 *   `validate-waves-journal` and `validate waves journal` are the same claim as the camelCase one.
 * - the gate it raises — case-insensitive, separators `-` `_` and space. The gate id is lower-kebab
 *   and the journal field beside it is `terminal_review`, so the hybrid spelling is the likely one.
 *   All four words are required, which is why the legitimate bare `terminal_review` is not a hit.
 * - the engine flag — case-insensitive on a flag that is only ever lowercase, which costs nothing
 *   and closes `--ENGINE`. The `--` is required: the bare word `engine` is the journal's own field
 *   name and is written 44 times legitimately in this corpus — 11 per rendering, 8 in
 *   `waves-event.md` and 3 in `run-ledger.md`. A typographic dash (`–engine`) is NOT admitted;
 *   measured absent from the corpus, and recorded as a decided limit rather than an oversight.
 * - the validator by common noun — Hangul has no case and the noun is one word, so the pattern is
 *   the noun. Josa attaches without a boundary, so a substring match already reads `검증기가`.
 *
 * The set itself is held against the requirement below: shrinking it to pass would have to delete
 * the name from the requirement first.
 */
const NAMES = PROCEDURE_NOUNS;

/** The four labels plus one, frozen, so a name cannot leave the set by being renamed out of it. */
const NAME_LABELS = [
  "the MCP tool",
  "the validator function",
  "the gate it raises",
  "the engine flag",
  "the validator by common noun"
];

/** Markdown's escapable ASCII punctuation, undone so `orchestrate\_validate` reads as the name. */
const MARKDOWN_ESCAPE = /\\([\\`*_{}[\]()#+\-.!|>~"'])/g;

/**
 * Whitespace beside an ASCII separator, removed so a name folded at its hyphen still reads as one.
 *
 * A renderer joins a soft wrap with a space, so `terminal-review-` above `loop-missing` is shown as
 * `terminal-review- loop-missing` — which a reader reads as the gate and every separator class
 * reads as two tokens. ASCII on BOTH sides on purpose: a list whose items are Korean sentences
 * keeps the `- ` between them, which is the split the renderer draws there and the boundary
 * FR-FLOW-164 measured must survive.
 */
const SEPARATOR_FOLD = /(?<=[A-Za-z0-9])\s*([-_])\s*(?=[A-Za-z0-9])/g;

/**
 * One block's text as a reader is handed it, not as the file stores it.
 *
 * Four spellings of one sentence were measured to walk past the raw-text scan, all four planted in
 * a shipped file and green: the full-width `ｏｒｃｈｅｓｔｒａｔｅ＿ｖａｌｉｄａｔｅ`, the
 * markdown-escaped `orchestrate\_validate`, the gate folded across a line break, and the anchor
 * written `종료줄` without its space. The first is the class FR-FLOW-155 AC-3 already recorded
 * being bypassed by (`ＭＣＰ`) and the third is the class FR-FLOW-164 spent three rounds closing.
 * NFKC folds the first, the escape rule the second, block joining plus `SEPARATOR_FOLD` the third,
 * and the anchor absorbs the space itself. Measured over the corpus: NFKC rewrites one character,
 * `…` into `...`, 125 times; the escape rule rewrites `\|` and `\"` only; and the five names stay
 * at zero afterwards, so none of the three costs a false positive here.
 */
function normalise(text: string): string {
  return text.normalize("NFKC").replace(MARKDOWN_ESCAPE, "$1").replace(/\s+/g, " ").replace(SEPARATOR_FOLD, "$1");
}

/**
 * One file's blocks, joined the way a renderer joins them and normalised the way a reader reads them.
 *
 * Both splits are here because the checks are PROXIMITY and not substring, and a boundary a renderer
 * draws is a distance a proximity check may not cross. Two bullets joined into one block put a
 * permission verb 15 characters from a terminal line named in the bullet ABOVE it. A code fence is
 * the same class and the larger one: a renderer draws EVERY line of a fence apart, and this corpus
 * ships 74 fenced blocks over 847 lines in 24 of its 49 files, where FR-FLOW-164's 27 sections carry
 * none — its own notes say fences would be the other gap and that those sections have none. Measured
 * before the split: two unrelated JSON fields of one fence, and two unrelated shell lines, each read
 * as one block and each red. The corpus stays at zero hits either way, so closing it costs nothing;
 * what it buys is the 2,451-character block, an `auto-option.md` JSON fence read as one sentence,
 * falling to 1,137. FR-FLOW-164 passes neither option, so its blocks and its counts are unchanged.
 */
function blocks(text: string): ScanUnit[] {
  return scanUnits(text, { splitListItems: true, splitFencedLines: true }).map((unit) => ({ ...unit, text: normalise(unit.text) }));
}

/** The same derivation over one corpus file. Every probe below goes through it rather than beside it. */
function blocksOf(relPath: string): ScanUnit[] {
  return blocks(readRepoFile(relPath));
}

interface Finding {
  file: string;
  name: string;
  count: number;
}

/**
 * A file that legitimately uses one of the five names, with the count that justifies it.
 *
 * EMPTY today: all five names are zero in all 49 files. The table exists anyway because AC-3 fixes
 * the SHAPE of the answer to a legitimate use — the name stays in the set and the file gets an
 * exemption — and the alternative shape is the one FR-FLOW-155 took: `검증기` was narrowed from
 * `검증` for every file because ONE file needed it. A later reader cannot tell that kind of
 * narrowing from an omission; a row here carries its own count and reason and cannot be mistaken.
 *
 * `judge` refuses a row that is no longer needed as loudly as it refuses an unexcused count, so the
 * table cannot rot into a list of excuses for uses that went away.
 */
const EXEMPTIONS: readonly Finding[] = [];

/** Reason text per exemption, keyed the same way, so a row cannot be added without saying why. */
const EXEMPTION_REASONS: Readonly<Record<string, string>> = {};

const keyOf = (finding: { file: string; name: string }): string => `${finding.file} :: ${finding.name}`;

/**
 * Split the scan against the exemption table, in BOTH directions.
 *
 * `unexcused` is the failure everyone expects: a name in a file nothing excuses. `stale` is the one
 * that rots quietly — a row excusing a use that has since been deleted keeps excusing the next one
 * that lands in the same file under the same name. A count that no longer matches is unexcused
 * rather than silently re-baselined, so growing a second use of an excused name is also loud.
 */
function judge(findings: readonly Finding[], exemptions: readonly Finding[]): { unexcused: Finding[]; stale: Finding[] } {
  const actual = new Map(findings.map((finding) => [keyOf(finding), finding.count]));
  const unexcused = findings.filter((finding) => {
    const excuse = exemptions.find((entry) => keyOf(entry) === keyOf(finding));
    return excuse === undefined || excuse.count !== finding.count;
  });
  const stale = exemptions.filter((entry) => (actual.get(keyOf(entry)) ?? 0) === 0);
  return { unexcused, stale };
}

/**
 * The reason table split against the exemption table, in the same two directions `judge` runs in.
 *
 * A pure resolver for the same reason `judge` is one: the table is empty, so a check written only
 * over the shipped rows iterates zero times and compares `[]` to `[]`. That is a mechanism nobody
 * can tell from a missing one, and the first row added to the table will be added by someone who
 * never saw it work.
 */
function reasonGaps(
  exemptions: readonly Finding[],
  reasons: Readonly<Record<string, string>>
): { unexplained: string[]; orphaned: string[] } {
  const unexplained = exemptions.filter((entry) => (reasons[keyOf(entry)] ?? "") === "").map(keyOf);
  const orphaned = Object.keys(reasons).filter((key) => !exemptions.some((entry) => keyOf(entry) === key));
  return { unexplained: unexplained.sort(), orphaned: orphaned.sort() };
}

/** Every hit of every name in one file, counted over the blocks rather than merely detected. */
function scan(relPath: string): Finding[] {
  const blocks = blocksOf(relPath);
  const found: Finding[] = [];
  for (const [name, re] of NAMES) {
    const all = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
    let count = 0;
    for (const block of blocks) count += (block.text.match(all) ?? []).length;
    if (count > 0) found.push({ file: relPath, name, count });
  }
  return found;
}

/** One way to say the terminal line is let off, with the sentence only that spelling catches. */
interface LetOffTerm {
  /** The verb this is a form of, written as the stem AC-5's three slots are built from. */
  readonly lemma: string;
  readonly phrase: string;
  readonly sample: string;
}

/**
 * The terminal line let off: named, and joined to a verb that permits skipping it or rewriting it.
 *
 * AC-5's open path. The covered file writes the bare noun `검증` 27 times legitimately, so no list
 * of NAMES can reach a sentence built from that noun alone — measured green:
 * `종료 줄의 검증은 선택이다 …`. What that sentence cannot avoid is its own shape: it must name the
 * line and it must say the permitted thing. So the ban is keyed on the shape, and `검증` is not in
 * it at all.
 *
 * ONE ENTRY PER SPELLING, each carrying the sentence only that spelling catches. The vocabulary was
 * a single alternation probed only as a whole, and such a probe fails only when the vocabulary dies
 * entirely: measured, 13 of its 25 alternatives could be deleted individually and 12 of them all at
 * once with the suite at 18 passed, because one probe sentence carried four of them and any one
 * surviving satisfied it. Nested groups are refused for the same reason — `선택이(다|며|고|라)` is
 * four spellings behind one entry — which is why the assertion below rejects a phrase carrying a
 * regex metacharacter and holds the entry count against the requirement's own `verbs` bound.
 *
 * Positive conjugations only, the same discipline `REWRITE_PERMITTED` keeps: the prohibition is
 * `…다시 쓰지 않는다` and the write instruction is `종료 줄을 쓴다`, and neither is a member.
 * `통과시킨다` is in and `통과한다` is out — the causative is the permission, the intransitive is
 * what `waves-event.md` says about a window comparison that was never made, and both halves of that
 * boundary are asserted rather than left to this comment.
 *
 * SPELLINGS, NOT STEMS, and every entry names the LEMMA it is a form of, because the three slots
 * AC-5 requires of each lemma — the plain declarative `-ㄴ다`, the connective `-고`, the prospective
 * `-ㄹ` — are derived from that lemma below and asserted, not stated here. Round 1 added `건너뛴다`
 * beside the stem `건너뛰` on finding the stem does not reach it; round 2 censused 80 forms of these
 * ten lemmas and measured the 32-entry list reaching 41, with the 39 it missed sitting in slots
 * some lemmas had and others did not, and filled slots by hand; round 3 measured 6 of the 36 still
 * open with the rule written down as though it held, ALL SIX in the two slots that sentence named
 * and four of them planted green in a shipped file; round 4 measured the same slots open again
 * under a second spelling, written without the space the list writes, 18 of the 21 cells over the
 * multi-word lemmas. A rule nothing derives is prose, so `slotsOf` builds the product and the case
 * below fails on the empty cells by name, and the spacing is folded rather than enumerated.
 * Absorbing them with a stem was measured and refused twice over. `건너뛰[가-힣]{0,3}` does not reach
 * `건너뛴다`, `건너뛸` or `건너뜁니다` at all, because the endings fuse INTO the stem's last syllable;
 * a jamo-prefix stem does reach them, and then reads nine prohibitions as the permissions they
 * negate — Korean writes negation as a suffix, so `다시 쓰지 않는다`, the very sentence
 * `§V.final-verify` states, matches a `다시 쓰` stem. It also costs the margin AC-5 records: the
 * literal list is zero at every radius out to 1000 over the corpus, the jamo stem hits
 * `방면하지 않는` at 120. The one stem that WAS here, `건너뛰`, turned `건너뛰지 않는다` red; it is
 * now its two spellings. What no spelling reaches is left to AC-5 and asserted below by class, in
 * FIVE classes rather than the three this comment used to name: another conjugation of a lemma
 * held here in a slot outside those three, the largest of the five and spread over ten endings of
 * the 224 censused; the polite register, 11, measured absent from all 49 files (0 against 1,507
 * plain endings) — one per lemma whose entry is not a prefix of every form; a different
 * verb built on the same root (`생략된다`); a synonym or the pronoun form; and a slot spelled with
 * a space the list does not write.
 *
 * `(?<![가-힣])` before the alternation is the word start Korean does not write: a phrase matched
 * mid-morpheme is a suffix of another verb, and `생략하지 않는다` carrying `하지 않는다` is a
 * prohibition read as its own permission. Every entry here is word-initial in the sample it catches.
 *
 * The radius is `radius` characters within one block. Measured over the whole corpus at 24, 40, 60,
 * 80, 120, 200, 400 and 1000, in all four block modes: zero hits at every radius under this list,
 * with the spacing fold on and with it off, so 60 is not sitting on the edge of a false positive.
 * Round 2 measured the same zero under the 46-spelling list this one descends from. `종료 줄`
 * appears three times per rendering, all inside `waves-event.md`'s schema table and on two rows.
 */
const LET_OFF_TERMS: readonly LetOffTerm[] = [
  { lemma: "선택이", phrase: "선택이다", sample: "종료 줄의 검증은 선택이다." },
  { lemma: "선택이", phrase: "선택이며", sample: "종료 줄의 검증은 선택이며 강제가 아니다." },
  { lemma: "선택이", phrase: "선택이고", sample: "종료 줄의 검증은 선택이고 강제가 아니다." },
  { lemma: "선택이", phrase: "선택이라", sample: "종료 줄의 검증은 선택이라 넘어간다." },
  { lemma: "선택이", phrase: "선택일", sample: "종료 줄의 검증은 선택일 수 있다." },
  { lemma: "선택적", phrase: "선택적", sample: "종료 줄의 검증은 선택적이다." },
  { lemma: "생략하", phrase: "생략한다", sample: "종료 줄의 검증은 생략한다." },
  { lemma: "생략하", phrase: "생략해도", sample: "종료 줄의 검증은 생략해도 좋다." },
  { lemma: "생략하", phrase: "생략하고", sample: "종료 줄의 검증은 생략하고 넘어간다." },
  { lemma: "생략하", phrase: "생략할", sample: "종료 줄의 검증은 생략할 수 있다." },
  { lemma: "건너뛰", phrase: "건너뛰어도", sample: "종료 줄의 검증은 건너뛰어도 된다." },
  { lemma: "건너뛰", phrase: "건너뛰고", sample: "종료 줄의 검증은 건너뛰고 진행한다." },
  { lemma: "건너뛰", phrase: "건너뛴다", sample: "종료 줄의 검증은 건너뛴다." },
  { lemma: "건너뛰", phrase: "건너뛸", sample: "종료 줄의 검증은 건너뛸 수 있다." },
  { lemma: "하지 않", phrase: "하지 않아도", sample: "종료 줄의 검증은 하지 않아도 된다." },
  { lemma: "하지 않", phrase: "하지 않는다", sample: "종료 줄의 검증은 하지 않는다." },
  { lemma: "하지 않", phrase: "하지 않고", sample: "종료 줄의 검증은 하지 않고 넘어간다." },
  { lemma: "하지 않", phrase: "하지 않을", sample: "종료 줄의 검증은 하지 않을 수 있다." },
  { lemma: "안 하", phrase: "안 해도", sample: "종료 줄의 검증은 안 해도 좋다." },
  { lemma: "안 하", phrase: "안 한다", sample: "종료 줄의 검증은 안 한다." },
  { lemma: "안 하", phrase: "안 하고", sample: "종료 줄의 검증은 안 하고 넘어간다." },
  { lemma: "안 하", phrase: "안 할", sample: "종료 줄의 검증은 안 할 수 있다." },
  { lemma: "해도 되", phrase: "해도 되고", sample: "종료 줄의 검증은 해도 되고 넘어가도 된다." },
  { lemma: "해도 되", phrase: "해도 된다", sample: "종료 줄의 검증은 해도 된다." },
  { lemma: "해도 되", phrase: "해도 될", sample: "종료 줄의 검증은 해도 될 일이다." },
  { lemma: "손보", phrase: "손봐서", sample: "종료 줄을 손봐서 낸다." },
  { lemma: "손보", phrase: "손본다", sample: "종료 줄을 손본다." },
  { lemma: "손보", phrase: "손봐도", sample: "종료 줄을 손봐도 된다." },
  { lemma: "손보", phrase: "손보고", sample: "종료 줄을 손보고 넘어간다." },
  { lemma: "손보", phrase: "손볼", sample: "종료 줄을 손볼 수 있다." },
  { lemma: "통과시키", phrase: "통과시킨다", sample: "종료 줄을 통과시킨다." },
  { lemma: "통과시키", phrase: "통과시켜", sample: "종료 줄을 통과시켜 둔다." },
  { lemma: "통과시키", phrase: "통과시킬", sample: "종료 줄을 통과시킬 수 있다." },
  { lemma: "통과시키", phrase: "통과시키고", sample: "종료 줄을 통과시키고 넘어간다." },
  { lemma: "덮어 쓰", phrase: "덮어 쓴다", sample: "종료 줄을 덮어 쓴다." },
  { lemma: "덮어 쓰", phrase: "덮어 써", sample: "종료 줄을 덮어 써도 된다." },
  { lemma: "덮어 쓰", phrase: "덮어 쓸", sample: "종료 줄을 덮어 쓸 수 있다." },
  { lemma: "덮어 쓰", phrase: "덮어 쓰고", sample: "종료 줄을 덮어 쓰고 넘어간다." },
  { lemma: "다시 쓰", phrase: "다시 쓴다", sample: "종료 줄을 다시 쓴다." },
  { lemma: "다시 쓰", phrase: "다시 써", sample: "종료 줄을 다시 써도 된다." },
  { lemma: "다시 쓰", phrase: "다시 쓸", sample: "종료 줄을 다시 쓸 수 있다." },
  { lemma: "다시 쓰", phrase: "다시 쓰고", sample: "종료 줄을 다시 쓰고 진행한다." },
  { lemma: "고쳐 쓰", phrase: "고쳐 쓴다", sample: "종료 줄을 고쳐 쓴다." },
  { lemma: "고쳐 쓰", phrase: "고쳐 쓸", sample: "종료 줄을 고쳐 쓸 수 있다." },
  { lemma: "고쳐 쓰", phrase: "고쳐 쓰고", sample: "종료 줄을 고쳐 쓰고 낸다." },
  { lemma: "고쳐 다시", phrase: "고쳐 다시", sample: "종료 줄을 고쳐 다시 낸다." },
  { lemma: "재작성", phrase: "재작성", sample: "종료 줄을 재작성한다." },
  { lemma: "재발행", phrase: "재발행", sample: "종료 줄을 재발행한다." },
  { lemma: "재기록", phrase: "재기록", sample: "종료 줄을 재기록한다." }
];

const LET_OFF_PHRASES: readonly string[] = LET_OFF_TERMS.map((term) => term.phrase);

/** The three slots AC-5 requires of every lemma, in the order the requirement names them. */
const SLOTS: readonly string[] = ["plain declarative", "`-고` connective", "`-ㄹ` prospective"];

/** A sentence tail per slot, so a prefix lemma's slot is probed on a sentence and not a fragment. */
const SLOT_TAIL: readonly string[] = [".", " 넘어간다.", " 수 있다."];

const HANGUL_FIRST = 0xac00;
const HANGUL_LAST = 0xd7a3;
const HANGUL_FINALS = 28;
const FINAL_NIEUN = 4;
const FINAL_RIEUL = 8;

/**
 * Slots the arithmetic below builds wrong, each with the reason and the spelling Korean writes.
 *
 * The shape AC-3's name exemptions take, and for the same reason: a slot is never dropped, it is
 * answered with the real form and the reason the rule misses it, so a reader can tell an exemption
 * from an omission. Held in both directions below — an exception for a stem no lemma uses is stale.
 */
interface SlotException {
  readonly stem: string;
  readonly slot: number;
  readonly instead: string;
  readonly why: string;
}

const SLOT_EXCEPTIONS: readonly SlotException[] = [
  { stem: "선택이", slot: 0, instead: "선택이다", why: "the copula joins `-다` directly; the rule's `선택인다` is not written" },
  { stem: "선택적이", slot: 0, instead: "선택적이다", why: "the same copula, reached through the prefix entry `선택적`" }
];

/**
 * The three slots of one stem, built the way Korean writes them.
 *
 * `-ㄴ다` and `-ㄹ` are not appended: they are written INTO the stem's last syllable when that
 * syllable is open (뛰 → 뛴다 / 뛸), which is the fusion that makes a syllable-class stem unable to
 * absorb a conjugation and the reason this composes a syllable rather than concatenating a string.
 * A stem whose last syllable is already closed takes the endings whole (않 → 않는다 / 않을).
 */
function slotsOf(stem: string, exceptions: readonly SlotException[]): readonly string[] {
  const code = stem.charCodeAt(stem.length - 1);
  if (!(code >= HANGUL_FIRST && code <= HANGUL_LAST)) {
    throw new Error(`\`${stem}\` does not end in a Hangul syllable, so its three slots cannot be built`);
  }
  const open = (code - HANGUL_FIRST) % HANGUL_FINALS === 0;
  const fused = (final: number): string => stem.slice(0, -1) + String.fromCharCode(code + final);
  const built = open ? [`${fused(FINAL_NIEUN)}다`, `${stem}고`, fused(FINAL_RIEUL)] : [`${stem}는다`, `${stem}고`, `${stem}을`];
  return built.map((spelling, slot) => exceptions.find((row) => row.stem === stem && row.slot === slot)?.instead ?? spelling);
}

/**
 * Lemmas whose entry stops BEFORE the inflection point, so one spelling is already all three slots.
 *
 * `재작성` is a noun the verb is built on, so the single entry catches `재작성한다`, `재작성하고`
 * and `재작성할` alike; `고쳐 다시` stops before the verb it qualifies.
 *
 * Each row carries the three SENTENCES its slots are held against, written by hand rather than
 * built, because everything a prefix entry can be asked mechanically it answers yes to: the entry is
 * a prefix of every suffix, so `startsWith` is true whatever the rule spells, and the entry catches
 * every sentence containing it, so the ban fires whatever the rule spells. Measured: the copula row
 * of `SLOT_EXCEPTIONS` could be deleted and the suite stayed green, and three of the five stems
 * below could be replaced with a wrong one - `재작성하` by `재작성되` - and it stayed green too. The
 * witness is the one thing here that knows what Korean writes, so the rule's spelling is held
 * against it and the sentence is held against the ban. What it cannot hold is a witness edited to
 * match a wrong rule, which is the residual every golden carries.
 */
const PREFIX_LEMMAS: readonly { readonly lemma: string; readonly continues: string; readonly witnesses: readonly string[] }[] = [
  { lemma: "선택적", continues: "선택적이", witnesses: ["종료 줄의 검증은 선택적이다.", "종료 줄의 검증은 선택적이고 강제가 아니다.", "종료 줄의 검증은 선택적일 수 있다."] },
  { lemma: "고쳐 다시", continues: "고쳐 다시 쓰", witnesses: ["종료 줄을 고쳐 다시 쓴다.", "종료 줄을 고쳐 다시 쓰고 낸다.", "종료 줄을 고쳐 다시 쓸 수 있다."] },
  { lemma: "재작성", continues: "재작성하", witnesses: ["종료 줄을 재작성한다.", "종료 줄을 재작성하고 넘어간다.", "종료 줄을 재작성할 수 있다."] },
  { lemma: "재발행", continues: "재발행하", witnesses: ["종료 줄을 재발행한다.", "종료 줄을 재발행하고 넘어간다.", "종료 줄을 재발행할 수 있다."] },
  { lemma: "재기록", continues: "재기록하", witnesses: ["종료 줄을 재기록한다.", "종료 줄을 재기록하고 넘어간다.", "종료 줄을 재기록할 수 있다."] }
];

/** Every lemma the entries name, deduplicated in the order they are written. */
const LEMMAS: readonly string[] = [...new Set(LET_OFF_TERMS.map((term) => term.lemma))];

/** The sentence frame a lemma's own samples are written on, so a probe is not a second copy of one. */
function anchorOf(lemma: string): string {
  const term = LET_OFF_TERMS.find((entry) => entry.lemma === lemma) as LetOffTerm;
  return term.sample.slice(0, term.sample.indexOf(term.phrase));
}

/**
 * The product of lemmas by slots, with the cells this vocabulary leaves open named one by one.
 *
 * A function of the exception table rather than a closure over it, so a row can be taken out and the
 * product re-run: a row whose removal opens no cell is a decision only in appearance, which is the
 * failure mode both tables here exist to make loud.
 *
 * Each cell is asked twice. Whether the spelling the rule builds is REAL - answered by the
 * vocabulary carrying it, or, where one entry covers all three slots, by the hand-written sentence
 * that slot is held against. And whether that spelling is reached when it is written without the
 * space the list writes, which is the question AC-5 had already answered for the anchor alone.
 */
function product(exceptions: readonly SlotException[]): { open: string[]; cells: number } {
  const open: string[] = [];
  let cells = 0;
  for (const lemma of LEMMAS) {
    const prefix = PREFIX_LEMMAS.find((row) => row.lemma === lemma);
    slotsOf(prefix?.continues ?? lemma, exceptions).forEach((spelling, slot) => {
      cells += 1;
      if (prefix === undefined) {
        if (!LET_OFF_PHRASES.includes(spelling)) open.push(`\`${lemma}\` has no ${SLOTS[slot]}: no entry spells \`${spelling}\``);
      } else {
        const witness = prefix.witnesses[slot] as string;
        if (!spelling.startsWith(prefix.lemma)) open.push(`\`${lemma}\` does not open ${SLOTS[slot]} \`${spelling}\`, so one entry is not already all three`);
        if (!witness.includes(spelling)) open.push(`\`${lemma}\`'s ${SLOTS[slot]} is \`${spelling}\` by the rule and \`${witness}\` by the sentence it is held against`);
        if (!letOff().test(witness)) open.push(`\`${lemma}\` does not reach its own ${SLOTS[slot]}: ${witness}`);
      }
      const solid = spelling.replace(/ /g, "");
      if (solid !== spelling && !letOff().test(`${anchorOf(lemma)}${solid}${SLOT_TAIL[slot]}`)) {
        open.push(`\`${lemma}\` does not reach its ${SLOTS[slot]} written without its space: \`${solid}\``);
      }
    });
  }
  return { open, cells };
}

/** A phrase carrying one of these is not the literal it reads as, and hides spellings behind itself. */
const REGEX_METACHARACTER = /[\\^$.*+?()[\]{}|]/;

/**
 * What a spelling of a Korean verb is made of, so a placeholder cannot sit in the list wearing one.
 *
 * The narrow half of a residual this file cannot close: replacing an entry AND its sample together
 * keeps the count and keeps every probe green, because nothing outside this file knows which
 * spellings belong. `ZZQQXX` is refused here; a fabricated but plausible Korean spelling is not,
 * and AC-5 records that. FR-FLOW-164's `RETRACTION_TERMS` carries the same residual.
 */
const HANGUL_SPELLING = /^[가-힣]+(?: [가-힣]+)*$/;

/**
 * One spelling as a pattern: a space the list WRITES is optional, the way the anchor's own space is.
 *
 * AC-5 decided that axis for the anchor - `종료줄` is the same anchor as the spaced one - and left
 * the verbs on it undecided, while the list itself already knew about it: it carried the solid and the
 * spaced spelling of one verb as two lemmas, the only one of the multi-word verbs written both ways.
 * Measured with the space required: 18 of the 21 slot cells over the seven multi-word lemmas passed
 * written solid, and no class AC-6 enumerates covers them, because they are IN the three slots rather
 * than outside them. Measured with it optional: those 18 red, the 49 files still zero at every radius
 * out to 1000, and not one sentence this file holds green refused. It is also what makes those two
 * spellings one lemma rather than two, which is why the list carries that verb once, with its space.
 *
 * "Nothing held green refused" is not the same as costing nothing, and this comment used to stop
 * there. It WIDENED the ban's false-refusal direction to the solid spellings: `종료 줄을 다시쓸 수
 * 없다.` was green before the fold and is refused after it, through the spaced entry `다시 쓸`. That
 * direction is a class rather than a sentence, it is what AC-6 records, and the case below measures
 * it so a later widening of it is reported here rather than discovered in a shared file.
 *
 * The other direction - a space INSERTED where the list writes none - is NOT taken: it needs a break
 * inside a word rather than at one the list wrote, which is a different rule from the anchor's. AC-6
 * carries it as a residual class, with an example rather than a count.
 */
function spaced(phrase: string): string {
  return phrase.split(" ").join("\\s*");
}

let letOffPattern: RegExp | undefined;

/**
 * The ban, built from the requirement's radius so the proximity cannot be widened here alone.
 *
 * Built lazily rather than at import: a requirement this suite cannot read must fail as an
 * assertion naming what is missing, not as a module that never loads and reports no tests at all.
 */
function letOff(): RegExp {
  letOffPattern ??= new RegExp(`종료\\s*줄[^\\n]{0,${floor("radius")}}?(?<![가-힣])(${LET_OFF_PHRASES.map(spaced).join("|")})`);
  return letOffPattern;
}

/**
 * Which of the vocabulary's spellings a text carries, read the same way the ban reads them.
 *
 * Under the spacing fold rather than as literals, or the discriminator below stops discriminating:
 * the spaced spelling reaches the solid one now, so an entry for the solid one would be dead weight
 * that a literal `includes` reports as load-bearing.
 */
function letOffHits(text: string, phrases: readonly string[]): string[] {
  return phrases.filter((phrase) => new RegExp(spaced(phrase)).test(text));
}

/** The sentence AC-5 measured green inside the covered file, with only the five names removed from it. */
const LET_OFF_PROBE = "종료 줄의 검증은 선택이다 - 하지 않아도 run 은 완료되며, 거부가 반복되면 그 줄을 손봐서 통과시킨다.";

describe("FR-FLOW-158 AC-1 — the corpus is read from the directory, not written down", () => {
  it("covers every rendering that ships `_shared/kiwi/`, and nothing outside it", () => {
    // A hand-written list answers "which files" with its own content: whatever it omits is never
    // swept, and the sweep over the survivors is green for the same reason a clean one is. Reading
    // the directory is what makes a shared file added later covered without an edit here.
    expect(CORPUS.length, "the corpus is empty, so every assertion below reports clean over no text").toBeGreaterThan(0);
    for (const relPath of CORPUS) {
      expect(relPath, `${relPath}: the corpus must contain only files under a rendering's _shared/kiwi/`).toMatch(CORPUS_PATH);
    }
    expect(CORPUS_PATH.test("skills/claude/_shared/kiwi/nested/one.md"), "a file in a subdirectory IS under the directory this sweeps").toBe(true);
    expect(CORPUS_PATH.test(".agents/skills/_shared/kiwi/nested/one.md"), "and so is one in the mirror's").toBe(true);
    expect(CORPUS_PATH.test("skills/claude/kiwi-orchestrator/SKILL.md"), "a skill body is outside this corpus").toBe(false);
    expect(CORPUS_PATH.test("docs/spec/60.workflow-release.srs.md"), "a document under docs/ is outside this corpus").toBe(false);
    // The narrowing to markdown, held rather than trusted: a `.json` or `.yaml` shared contract
    // landing in that directory would otherwise sit outside the sweep with nothing to show for it.
    expect(sharedKiwiEntries().length, "an entry under _shared/kiwi/ is not markdown, so the sweep no longer covers the directory").toBe(CORPUS.length);
    expect(RENDERINGS.length, "a rendering stopped shipping, and a corpus read from disk shrinks silently with it").toBe(floor("renderings"));
    const byRendering = RENDERINGS.map((rendering) => [rendering, CORPUS.filter((relPath) => relPath.startsWith(`${rendering}/`)).length] as const);
    expect(
      byRendering.filter(([, count]) => count > 0).length,
      `every rendering ships this directory today; contributions are ${JSON.stringify(byRendering)}`
    ).toBe(RENDERINGS.length);
    // A floor rather than an exact count: an exact one would turn red for a file ADDED, which is the
    // property AC-1 is buying. `skills/etc` ships one more than the others (`local-llm-profile.md`),
    // and reading each rendering's own directory is what absorbs that difference. The floors come
    // from the requirement, so lowering one is an SRS diff rather than a character here.
    for (const [rendering, count] of byRendering) {
      expect(count, `${rendering}: the shared corpus collapsed to ${count} files`).toBeGreaterThanOrEqual(floor("shared"));
    }
    // The per-rendering floor alone lets `skills/etc` fall from 13 to 12 unnoticed; the total is
    // what reports that one file leaving one rendering.
    expect(CORPUS.length, `the shared corpus collapsed to ${CORPUS.length} files`).toBeGreaterThanOrEqual(floor("corpus"));
  });

  it("reads a real file for every entry, so an emptied one cannot pass by carrying nothing", () => {
    for (const relPath of CORPUS) {
      expect(readRepoFile(relPath).length, `${relPath}: missing or emptied, so the scan below would report clean over no text`).toBeGreaterThan(1000);
    }
  });
});

describe("FR-FLOW-158 AC-3/AC-4 — the rule set, and where each pattern's edges were put", () => {
  it("is the five names the requirement names, so narrowing the set means editing the requirement", () => {
    expect(NAMES.map(([label]) => label), "PROCEDURE_NOUNS no longer carries the five names FR-FLOW-158 is about").toEqual(NAME_LABELS);
    expect(NAMES.length, "the requirement holds this set to a size, and a set that may shrink is a sweep that may be narrowed").toBe(floor("names"));
    expect(REQUIREMENT, "FR-FLOW-158 is not in docs/spec/60.workflow-release.srs.md, so the set below is held against nothing").not.toBe("");
    for (const [label, re] of NAMES) {
      expect(re.test(REQUIREMENT), `${label}: its pattern no longer matches the name as the requirement writes it`).toBe(true);
    }
  });

  it("admits the separator variant that was measured to bypass the pattern it replaces", () => {
    const [, mcpTool] = NAMES.find(([label]) => label === "the MCP tool") as [string, RegExp];
    expect(/orchestrate[_ ]validate/.test("orchestrate-validate"), "the inherited pattern; if this is true the bypass was never real").toBe(false);
    for (const spelling of ["orchestrate_validate", "orchestrate validate", "orchestrate-validate", "Orchestrate_Validate", "ORCHESTRATE VALIDATE"]) {
      expect(mcpTool.test(spelling), `the MCP tool spelled \`${spelling}\` must be a hit`).toBe(true);
    }
    expect(mcpTool.test("orchestratevalidate"), "a separator-less spelling is deliberately NOT admitted").toBe(false);
  });

  it("puts the other four patterns' edges where this file says it does", () => {
    const re = (label: string): RegExp => (NAMES.find(([name]) => name === label) as [string, RegExp])[1];
    for (const spelling of ["validateWavesJournal", "validatewavesjournal", "validate-waves-journal", "validate waves journal"]) {
      expect(re("the validator function").test(spelling), `the validator function spelled \`${spelling}\` must be a hit`).toBe(true);
    }
    for (const spelling of ["terminal-review-loop-missing", "terminal_review-loop-missing", "TERMINAL-REVIEW-LOOP-MISSING"]) {
      expect(re("the gate it raises").test(spelling), `the gate spelled \`${spelling}\` must be a hit`).toBe(true);
    }
    expect(re("the gate it raises").test("terminal_review"), "the journal's own field is legitimate everywhere here and must NOT be a hit").toBe(false);
    for (const spelling of ["--engine", "--engine kiwi-wave-master", "--ENGINE"]) {
      expect(re("the engine flag").test(spelling), `the engine flag spelled \`${spelling}\` must be a hit`).toBe(true);
    }
    expect(re("the engine flag").test('"engine": "kiwi-orchestrator"'), "the journal's `engine` FIELD is legitimate here and must NOT be a hit").toBe(false);
    expect(re("the validator by common noun").test("검증기가 거부하면"), "josa attaches without a boundary").toBe(true);
    expect(re("the validator by common noun").test("검증은 두 축으로 돈다"), "the bare noun is written 27 times legitimately and must NOT be a hit").toBe(false);
  });

  it("reads a name written full-width, escaped or folded at its separator as the name it is", () => {
    // All four were planted in a shipped file and measured green before this normalisation: the
    // full-width form is the class FR-FLOW-155 AC-3 records being bypassed by (`ＭＣＰ`), and the
    // fold is the class FR-FLOW-164 spent three rounds closing. Each is asserted through the same
    // path the corpus sweep runs — blocks joined, then normalised — so a normalisation dropped from
    // that path is red here rather than a spelling that quietly walks past again.
    const spelled = (text: string): string[] => {
      const units = blocks(text);
      return NAMES.filter(([, re]) => units.some((unit) => re.test(unit.text))).map(([label]) => label);
    };
    expect(spelled("종료 줄은 ｏｒｃｈｅｓｔｒａｔｅ＿ｖａｌｉｄａｔｅ 를 거치지 않는다."), "a full-width spelling of the MCP tool").toEqual(["the MCP tool"]);
    expect(spelled("종료 줄은 orchestrate＿validate 를 거치지 않는다."), "a full-width separator alone").toEqual(["the MCP tool"]);
    expect(spelled("종료 줄은 orchestrate\\_validate 를 거치지 않는다."), "a markdown-escaped underscore").toEqual(["the MCP tool"]);
    expect(spelled("게이트 terminal-review-\nloop-missing 은 무시한다."), "the gate folded across a soft line break").toEqual(["the gate it raises"]);
    // The run-collapse is the one step of `normalise` that nothing else here reaches: the block join
    // already puts ONE space between lines, so what this buys is a name written with two spaces or a
    // tab INSIDE one line. Measured with the step removed, both of those go green while every other
    // probe in this file stays red, which is a step doing work under no assertion at all.
    expect(spelled("종료 줄은 orchestrate  validate 를 거치지 않는다."), "a name written with two spaces").toEqual(["the MCP tool"]);
    expect(spelled("종료 줄은 orchestrate\tvalidate 를 거치지 않는다."), "a name written with a tab").toEqual(["the MCP tool"]);
    // And the two boundaries joining must not erase. A hyphen between Korean words is not a folded
    // separator, so `SEPARATOR_FOLD` requires ASCII on both sides; and two list items are two
    // blocks a renderer draws apart, so joining them would put a permission verb 15 characters from
    // a line named in the bullet above it. Measured before the split: that pair, planted in
    // `run-ledger.md`, was 1 failed / 21.
    expect(normalise("종료 줄을 쓴다 - 생략한다"), "a hyphen between Korean words is not a separator a name was folded at").toContain(" - ");
    expect(
      blocks("- 종료 줄을 쓴다\n- 생략한다").map((unit) => unit.text),
      "two list items are two blocks, and a proximity ban read over one block joining them refuses a pair the renderer draws apart"
    ).toEqual(["- 종료 줄을 쓴다", "- 생략한다"]);
    // And the fold this joining exists for: one paragraph's two lines are ONE block.
    expect(blocks("종료 줄의 검증은\n선택이다.").map((unit) => unit.text), "a soft wrap inside one paragraph is one block, or the fold is not closed").toEqual([
      "종료 줄의 검증은 선택이다."
    ]);
  });

  it("reads each line of a code fence apart, the way a renderer draws them", () => {
    // The same class as the list items above, and the one FR-FLOW-164's notes name as the other gap
    // while recording that its own 27 sections carry none. This corpus is not those sections: 74
    // fenced blocks over 847 lines in 24 of the 49 files, and the longest joined block in it was a
    // JSON fence read as one 2,451-character sentence. A fence preserves every line break, so two
    // unrelated fields of one object are two things a reader is never shown as one — measured before
    // this, the JSON pair below was 1 failed / 21 and so was a two-line shell fence.
    const fence = ["```json", "{", '  "note": "종료 줄",', '  "policy": "선택이다"', "}", "```"].join("\n");
    expect(blocks(fence).map((unit) => unit.text), "a fenced line is its own block").toEqual([
      "```json",
      "{",
      '"note": "종료 줄",',
      '"policy": "선택이다"',
      "}",
      "```"
    ]);
    expect(blocks(fence).filter((unit) => letOff().test(unit.text)), "two fields of one JSON fence are not one sentence").toEqual([]);
    // The boundary is the fence, not the language tag or the indent: a shell fence splits the same
    // way, and prose AFTER the fence closes joins normally rather than staying split.
    const shell = ["```sh", "speckiwi orchestrate validate --run 종료 줄", "echo 선택이다", "```", "", "종료 줄의 검증은", "선택이다."].join("\n");
    expect(blocks(shell).filter((unit) => unit.endLine <= 4 && letOff().test(unit.text)), "two lines inside one shell fence are not one sentence").toEqual([]);
    expect(blocks(shell).map((unit) => unit.text).slice(-1), "the paragraph after a closed fence joins as a paragraph").toEqual(["종료 줄의 검증은 선택이다."]);
    expect(letOff().test(blocks(shell)[blocks(shell).length - 1]?.text ?? ""), "and that paragraph is still judged as one sentence").toBe(true);
  });

  it("refuses an exemption that is no longer needed as loudly as an unexcused count", () => {
    // The table is empty today, so the corpus scan below exercises neither direction of `judge`.
    // Asserted on the resolver directly instead: a mechanism nothing runs is a mechanism nobody can
    // tell from a missing one, and the first row added to that table will be added by someone who
    // never saw it work.
    const found: Finding[] = [{ file: "skills/claude/_shared/kiwi/run-ledger.md", name: "the engine flag", count: 2 }];
    expect(judge(found, []).unexcused, "an unexcused count must be reported").toEqual(found);
    expect(judge(found, found).unexcused, "an exemption matching the count exactly must excuse it").toEqual([]);
    expect(judge(found, [{ ...found[0] as Finding, count: 1 }]).unexcused, "an exemption whose count no longer matches must not excuse it").toEqual(found);
    expect(judge([], found).stale, "an exemption for a use that went away must be reported").toEqual(found);
    expect(judge(found, found).stale, "an exemption still carrying its use must not be reported").toEqual([]);
  });

  it("carries a reason for every exemption it grants", () => {
    // Asserted on constructed rows for the same reason `judge` is: over the empty table the check
    // iterates zero times and compares `[]` to `[]`, which is a rule nobody can tell from its
    // absence. The shipped table is then held to both directions of the same resolver.
    const row: Finding = { file: "skills/claude/_shared/kiwi/run-ledger.md", name: "the engine flag", count: 2 };
    expect(reasonGaps([row], {}).unexplained, "an exemption without a reason is an omission wearing a name").toEqual([keyOf(row)]);
    expect(reasonGaps([row], { [keyOf(row)]: "" }).unexplained, "an empty reason must not count as one").toEqual([keyOf(row)]);
    expect(reasonGaps([row], { [keyOf(row)]: "the journal's own field name, in the schema row" }).unexplained, "a reason must excuse its own row").toEqual([]);
    expect(reasonGaps([], { [keyOf(row)]: "left behind" }).orphaned, "a reason with no exemption beside it must be reported").toEqual([keyOf(row)]);
    const gaps = reasonGaps(EXEMPTIONS, EXEMPTION_REASONS);
    expect(gaps.unexplained, "an exemption this file grants without saying why").toEqual([]);
    expect(gaps.orphaned, "a reason with no exemption beside it").toEqual([]);
  });
});

describe("FR-FLOW-158 AC-2/AC-3 — no shared file rules on the terminal line's validation", () => {
  it("holds the five names at zero across the whole corpus", () => {
    const findings = CORPUS.flatMap(scan);
    const { unexcused, stale } = judge(findings, EXEMPTIONS);
    expect(
      unexcused,
      `A file under _shared/kiwi/ names the validator: ${JSON.stringify(unexcused)}. §0 of kiwi-orchestrator defers to these files for the journal's schema, its write discipline, the verify loop and the rest; WHEN the terminal line is put through the validator, WHICH caller may judge which engine, and WHAT is done on refusal belong to the terminal-line section of §V.final-verify, where a golden holds them byte-exact. A rule stated here is a rule stated where nothing compares it, in a file an agent reads as authority. Move the sentence into that section and re-copy the golden — or, if the use is legitimate, add a row to EXEMPTIONS with its count and its reason.`
    ).toEqual([]);
    expect(stale, `an EXEMPTIONS row excuses a use that is no longer in the file: ${JSON.stringify(stale)}`).toEqual([]);
  });

  it("has `run-ledger.md` in the corpus in every rendering that ships it", () => {
    // Named rather than left to the sweep. `§0.10` names this file as the SSOT for how a journal line
    // is written, which is not a lesser claim on this procedure than owning the line's schema, and it
    // is the file where the measured contradiction was invisible.
    const ledgers = CORPUS.filter((relPath) => relPath.endsWith("/_shared/kiwi/run-ledger.md"));
    expect(ledgers.length, `run-ledger.md is in ${ledgers.length} renderings of the corpus`).toBe(RENDERINGS.length);
  });

  it("would turn red on the sentence measured green in `run-ledger.md`, and stay green on the control", () => {
    // The plant itself is measured against the shipped files and reverted; what stands here is the
    // discriminator, so a later reader can see WHY the red was red. The sentence carries all five
    // names; the control says something in the same file about the same subject with none of them,
    // and must not turn red merely because a file was touched.
    const planted =
      "종료 줄은 `orchestrate_validate` 를 통과시키지 않는다 — `validateWavesJournal` 은 선택이고, `--engine` 없이 부른 검증기가 `terminal-review-loop-missing` 을 반복해 내면 그 줄을 덮어쓴다.";
    const control = "종료 줄을 쓴 뒤에는 rung 을 lock 에서 읽고 재계산하지 않는다.";
    expect(NAMES.filter(([, re]) => re.test(planted)).map(([label]) => label), "the plant must carry all five names").toEqual(NAME_LABELS);
    expect(NAMES.filter(([, re]) => re.test(control)).map(([label]) => label), "the control must carry none of them").toEqual([]);
    expect(letOff().test(control), "the control must not trip the shape ban either, or the red would not be pinned on the names").toBe(false);
    // AC-2 attributes the red to the names, and that attribution holds by 4 characters: the plant's
    // anchor sits 64 characters from `선택이고` and the radius is 60. Asserted rather than left in
    // prose, so widening the radius reports that AC-2's claim needs re-measuring instead of turning
    // it silently false — measured, the same plant at radius 80 fires the shape ban as well.
    expect(letOff().test(planted), "the plant must fire the names and NOT the shape ban, or AC-2's attribution is not pinned").toBe(false);
  });
});

describe("FR-FLOW-158 AC-5 — the `검증` path is closed on the sentence's shape", () => {
  it("holds the shape at zero across the whole corpus", () => {
    for (const relPath of CORPUS) {
      for (const unit of blocksOf(relPath)) {
        const hit = letOff().exec(unit.text);
        expect(
          hit?.[0] ?? null,
          `${relPath} (${unitAt(unit, "file")}): a shared file lets the terminal line off — skipping its validation, or rewriting it until it is accepted. That judgement belongs to §V.final-verify, which forbids the rewrite outright.`
        ).toBe(null);
      }
    }
  });

  it("catches the sentence a name-based ban cannot reach", () => {
    // Five names could not have caught this one: it names the validator by the bare noun `검증`,
    // which the covered file writes 27 times legitimately. Its shape is what it cannot hide.
    expect(NAMES.filter(([, re]) => re.test(LET_OFF_PROBE)).map(([label]) => label), "if a name caught it, this probe measures the wrong mechanism").toEqual([]);
    expect(letOff().test(LET_OFF_PROBE), "the shape ban must catch the sentence AC-5 measured green").toBe(true);
    // And the anchor absorbs the space it is written with: `종료줄` was planted in a shipped file
    // and measured green before this.
    expect(letOff().test("종료줄의 검증은 선택이다 - 하지 않아도 run 은 완료된다."), "the anchor written without its space is the same anchor").toBe(true);
    // And the vocabulary absorbs its own spacing the same way, which is the half of that decision
    // round 4 found missing: 18 of the 21 slot cells over the multi-word lemmas passed written
    // solid, in none of the classes AC-6 enumerates. The product above holds all 21; this is the
    // one a reader can see without running it. The opposite direction stays open and AC-6 has it.
    expect(letOff().test("종료 줄의 검증은 하지않는다."), "a slot written without the space the list writes is the same slot").toBe(true);
  });

  it("keeps every alternative of the permission vocabulary answering for itself", () => {
    expect(LET_OFF_TERMS.length, "spellings the requirement holds this vocabulary to").toBe(floor("verbs"));
    expect(new Set(LET_OFF_PHRASES).size, "two entries carrying one phrase would let either be deleted with the other covering for it").toBe(LET_OFF_TERMS.length);
    expect(
      LET_OFF_PHRASES.filter((phrase) => REGEX_METACHARACTER.test(phrase)),
      "a phrase carrying a regex metacharacter hides spellings behind one entry, which is what a per-entry sample cannot then hold"
    ).toEqual([]);
    expect(
      LET_OFF_PHRASES.filter((phrase) => !HANGUL_SPELLING.test(phrase)),
      "a spelling of a Korean verb is Hangul and spaces; anything else is a placeholder sitting in the list with a sample written to match it"
    ).toEqual([]);
    const failures: string[] = [];
    for (const term of LET_OFF_TERMS) {
      if (!letOff().test(term.sample)) {
        failures.push(`\`${term.phrase}\` no longer catches its own sample: ${term.sample}`);
        continue;
      }
      const covered = letOffHits(term.sample, LET_OFF_PHRASES).filter((phrase) => phrase !== term.phrase);
      if (covered.length > 0) {
        failures.push(`\`${term.phrase}\` is not what catches its sample — ${covered.join(", ")} does, so deleting the phrase would leave this probe green`);
      }
    }
    expect(
      failures,
      "a vocabulary probed only as a whole survives losing one alternative, and the sentence that alternative caught then walks past with nothing reporting it"
    ).toEqual([]);
  });

  it("fills all three slots of every lemma it carries, derived from the stem rather than described", () => {
    // AC-5's slot rule is a property of the output, not a sentence about it, so it is DERIVED here
    // and asserted. The lemmas come from the entries, the three spellings come from each lemma's
    // stem by the arithmetic Korean inflects with, and the product must be filled. Written down as
    // prose it was false where it was written: round 3 measured 6 of 36 slots open, all six in the
    // two slots the sentence itself named, four of them planted green in a shipped file. Round 4
    // measured the same slots open again under a second spelling - written without the space the
    // list writes, 18 of the 21 cells over the multi-word lemmas - and closed it with the fold the
    // anchor already had. Deleting an entry now names its empty slot here, and a verb added under a
    // new lemma demands the other two.
    const { open, cells } = product(SLOT_EXCEPTIONS);
    expect(
      open,
      "a lemma this list carries can be said in a slot this list does not, which is the gap round 1 closed one form of, round 2 twenty-one more, round 3 six of under a criterion that said they were filled, and round 4 eighteen of on the spacing the anchor had already decided"
    ).toEqual([]);
    expect(cells, "the product ranged over nothing, so the emptiness above is the assertion's and not the list's").toBe(LEMMAS.length * SLOTS.length);
    expect(LEMMAS.length, "lemmas the requirement holds this vocabulary to, so dropping every form of one verb is a requirement diff and not a quiet deletion").toBe(floor("lemmas"));
  });

  it("keeps both exemption tables of the slot rule answerable in both directions", () => {
    // An exemption nothing checks is an omission wearing an exemption's name — the shape AC-3 holds
    // the name exemptions to. So a stem no lemma uses is reported as stale, a prefix row no entry
    // carries exempts nothing, and a reason or a replacement spelling left blank fails here.
    const lemmas = new Set(LET_OFF_TERMS.map((term) => term.lemma));
    const stems = new Set([...lemmas].map((lemma) => PREFIX_LEMMAS.find((row) => row.lemma === lemma)?.continues ?? lemma));
    expect(SLOT_EXCEPTIONS.filter((row) => !stems.has(row.stem)).map((row) => row.stem), "an exception for a stem no lemma uses is stale, and a stale exemption reads as a decision").toEqual([]);
    expect(PREFIX_LEMMAS.filter((row) => !lemmas.has(row.lemma)).map((row) => row.lemma), "a prefix row no entry carries exempts nothing and hides the lemma it names from the product above").toEqual([]);
    expect(SLOT_EXCEPTIONS.filter((row) => row.why.length === 0 || row.instead.length === 0).map((row) => row.stem), "an exception with no reason or no replacement spelling is a slot dropped rather than answered").toEqual([]);
    expect(SLOT_EXCEPTIONS.filter((row) => !LET_OFF_PHRASES.includes(row.instead) && !PREFIX_LEMMAS.some((prefix) => row.instead.startsWith(prefix.lemma))).map((row) => row.instead), "the spelling an exception puts in the slot must itself be reachable, or the slot is still empty").toEqual([]);
    // And the way a table of exemptions rots that neither of those catches: a row on a stem that IS
    // in use, replacing a spelling nothing ever asked about. Measured before the product held a
    // prefix lemma to a witness: the copula row for `선택적이` could be deleted with all 28
    // assertions green, because the entry `선택적` catches `선택적인다` as readily as `선택적이다`.
    // A row is a decision only if removing it opens a cell.
    const standing = JSON.stringify(product(SLOT_EXCEPTIONS).open);
    expect(
      SLOT_EXCEPTIONS.filter((row) => JSON.stringify(product(SLOT_EXCEPTIONS.filter((other) => other !== row)).open) === standing).map((row) => row.stem),
      "an exception whose removal opens no cell corrects nothing: it reads as a decision while the spelling it replaces is never asked whether Korean writes it"
    ).toEqual([]);
  });

  it("reaches the other conjugations of the verbs it already carries", () => {
    // Round 1 added `건너뛴다` on finding the stem `건너뛰` does not reach it and stopped there.
    // Censused after: of 80 forms of these ten lemmas the list reached 41, and the 39 it missed sat
    // in the same three slots — the plain declarative, the `-고` connective and the `-ㄹ`
    // prospective — filled for some lemmas and not others. Each sentence here was measured green
    // against the 32-entry list, so this case is the census and not a restatement of the list. It
    // is kept beside the derived product above, which is what now holds the rule: filling slots by
    // hand left six of them open, and eleven sentences cannot report the seventh.
    for (const sentence of [
      "종료 줄의 검증은 건너뛸 수 있다.",
      "종료 줄의 검증은 해도 된다.",
      "종료 줄의 검증은 하지 않는다.",
      "종료 줄의 검증은 안 한다.",
      "종료 줄을 손보고 넘어간다.",
      "종료 줄을 손볼 수 있다.",
      "종료 줄을 손봐 통과시키고 넘어간다.",
      "종료 줄을 다시 쓰고 진행한다.",
      "종료 줄을 덮어쓰고 진행한다.",
      "종료 줄을 고쳐 쓰고 낸다.",
      "종료 줄을 고쳐 쓸 수 있다."
    ]) {
      expect(letOff().test(sentence), `a conjugation of a verb already in the list walks past: ${sentence}`).toBe(true);
    }
  });

  it("does not read a prohibition as the permission it negates", () => {
    // Korean writes negation as a SUFFIX, so a spelling matched mid-morpheme inverts polarity:
    // `생략하지 않는다` carries `하지 않는다`, and `다시 쓰지 않는다` — the sentence §V.final-verify
    // actually states — carries a `다시 쓰` stem. That is why the vocabulary is spellings rather than
    // stems and why the pattern refuses a match that starts inside a Hangul word. Measured: a
    // jamo-prefix stem list turned all seven of these red, and the one stem this list did carry,
    // `건너뛰`, turned the second one red until it became its two spellings.
    for (const sentence of [
      "종료 줄을 다시 쓰지 않는다.",
      "종료 줄의 검증은 건너뛰지 않는다.",
      "종료 줄의 검증은 생략하지 않는다.",
      "종료 줄을 덮어쓰지 않는다.",
      "종료 줄을 손보지 않는다.",
      "종료 줄을 통과시키지 않는다.",
      "종료 줄의 검증은 선택이 아니다."
    ]) {
      expect(letOff().test(sentence), `a prohibition is read as the permission it forbids: ${sentence}`).toBe(false);
    }
    // The word start this rests on, asserted on the mechanism rather than only on the sentences: the
    // same spelling is a hit when a word opens with it and not when a verb ends with it.
    expect(letOff().test("종료 줄의 검증은 하지 않는다."), "the auxiliary standing on its own is the permission").toBe(true);
    expect(letOff().test("종료 줄의 검증을 갱신하지 않는다."), "the same letters ending another verb are that verb's negation").toBe(false);
  });

  it("keeps the causative inside the list and the intransitive outside it", () => {
    // AC-5 records this split as a DECISION, and a decision nothing asserts is a comment. The
    // intransitive is what `waves-event.md` legitimately says about a window comparison that was
    // never made — `임의의 창을 적어도 통과한다` — and admitting it would refuse that sentence.
    expect(letOff().test("종료 줄을 손봐서 통과시킨다."), "the causative is the permission and must be caught").toBe(true);
    expect(LET_OFF_PHRASES, "the causative must be in the list by name, not only by a sentence that happens to match").toContain("통과시킨다");
    const intransitive = "종료 줄에 `run_diff_window` 가 없으면 임의의 창을 적어도 통과한다.";
    expect(letOffHits(intransitive, LET_OFF_PHRASES), "no spelling may reach the intransitive").toEqual([]);
    expect(letOff().test(intransitive), "the intransitive is the covered file's own description and must stay green").toBe(false);
  });

  it("subsumes the rewrite ban FR-FLOW-155 keeps over one file of this corpus", () => {
    // FR-FLOW-155 AC-8 bans the rewrite in `waves-event.md`; this file bans a superset of it in all
    // 49. A ban that stopped subsuming it would leave the other 48 files weaker than the one, which
    // is the shape of every axis that was closed and then revived just outside the new check.
    // Derived from the shared regex's own source, so strengthening FR-FLOW-155's list is caught here
    // rather than silently leaving this one behind. AC-5 records this subsumption, so the assertion
    // is one the requirement asks for rather than one only this file knows about.
    const verbs = /\(([^)]*)\)/.exec(REWRITE_PERMITTED.source)?.[1]?.split("|") ?? [];
    expect(verbs.length, "the rewrite verb list could not be read, so the subsumption below is vacuous").toBeGreaterThan(5);
    for (const verb of verbs) {
      const sentence = `종료 줄을 ${verb}`;
      expect(REWRITE_PERMITTED.test(sentence), `the extracted verb \`${verb}\` does not reconstruct its own ban`).toBe(true);
      expect(letOff().test(sentence), `\`${verb}\` is banned in waves-event.md and free in the other 48 files`).toBe(true);
    }
  });

  it("does not fire on the three legitimate mentions the corpus already ships", () => {
    // All three are inside `waves-event.md`'s schema table, on two of its rows, and all three say
    // WHEN the line is written or WHAT the line is, which is schema and not procedure. A ban that
    // refused them would be the eleven-noun vocabulary FR-FLOW-155 removed, at a smaller scale.
    // Counted rather than eyeballed: the row carrying two of them is why a line count reads 2.
    for (const sentence of [
      "리뷰가 고친 것을 커밋한 뒤 종료 줄을 쓰므로 run head 는 그보다 앞서 있는 것이 정상이며, head 까지 일치를 요구하면 올바른 run 이 거부된다.",
      "`phase=\"final-verify\"` 종료 줄에 이 필드를 실을 때는 같은 줄에 `run_diff_window` 를 반드시 함께 싣는다.",
      "`delegated-complete` 는 그 줄이 run 종료 줄임을 뜻한다. 그 줄이 `status` 를 싣지 않을 때 완료 보고 여부를 결정하는 값이 이것이며, `status` 가 있으면 `status` 가 우선한다."
    ]) {
      expect(letOff().test(sentence), `a legitimate sentence must stay green: ${sentence.slice(0, 40)}`).toBe(false);
    }
    // The skill's own prohibition, which is not a corpus sentence: kept as a control because a ban
    // that caught the rule forbidding the rewrite would be reading polarity backwards.
    expect(letOff().test("종료 줄을 다시 쓰지 않는다."), "the prohibition in §V.final-verify is not a permission").toBe(false);
  });
});

describe("FR-FLOW-158 AC-6 — where this stops, measured rather than described", () => {
  it("does not reach a shipped file outside `_shared/kiwi/`", () => {
    // The paths are already constrained above; this states the consequence. `kiwi-wave-master`'s own
    // renderings are FR-FLOW-156's, and no skill body other than `kiwi-orchestrator` is read by
    // anything for this rule.
    expect(CORPUS.some((relPath) => relPath.includes("kiwi-wave-master")), "a wave-master rendering is FR-FLOW-156's, not this corpus'").toBe(false);
    expect(CORPUS.some((relPath) => relPath.startsWith("docs/")), "a document under docs/ is outside this corpus").toBe(false);
  });

  it("does not catch a contradiction that carries no name and does not take the shape", () => {
    // Red here means someone widened the cover, which is a good change and this assertion is the last
    // thing to update. What it must never do is stay green while the requirement claims the gap was
    // closed. The sentence names the line by pronoun and the act by a verb the ban's anchor never
    // reaches — the same class FR-FLOW-155 AC-4 records for the compared section.
    const evasive = "다만 거부가 반복되면 그 줄을 손본다.";
    expect(NAMES.filter(([, re]) => re.test(evasive)).map(([label]) => label), "no name reaches it").toEqual([]);
    expect(letOff().test(evasive), "and neither does the shape, because the line is never named").toBe(false);
  });

  it("stops where the vocabulary stops, in five decided classes, and errs the other way in one", () => {
    // Each of these NAMES the line and permits, so only the closed verb list holds them out. They are
    // green on purpose and the purpose is measured, not asserted from taste. Red here means someone
    // widened the list, which is a good change and this case is the last thing to update; what it
    // must never do is stay green while AC-5 claims the class was closed.
    const RESIDUAL: readonly (readonly [string, string])[] = [
      // The largest class, and the one this case used to leave out while AC-6 enumerated three with
      // a definite article: the three slots are filled for every lemma and NOTHING else is, so the
      // censused forms passing on an ending outside them run over ten endings — `-며`, `-지만`,
      // `-어서`, `-면`, `-어도`, the adnominal `-ㄴ`, the nominal `-ㅁ`/`-기`, the past, and the
      // informal. No total is written for them: see the `-어도` column in the header comment.
      ["another conjugation of a lemma it carries, on the `-며` connective", "종료 줄의 검증은 생략하며 넘어간다."],
      ["the same, as a past adnominal", "종료 줄을 손본 뒤 낸다."],
      // The polite register, 11 of the census forms that pass — one per lemma whose entry is not a
      // prefix of every form, the other five being caught whatever ending they take: 0 occurrences
      // of `습니다`/`입니다` over the 49 files, against 1,507 plain declaratives — `다.` counted on
      // the lines outside a block quote, the rule that number was first taken under. The same kind
      // of decided absence AC-4 records for `–engine`.
      ["the polite register, measured absent from the corpus", "종료 줄의 검증은 선택입니다."],
      // A different verb built on the same root — the passive of a lemma the list carries actively.
      ["a derivation of a lemma rather than a conjugation of it", "종료 줄의 검증은 생략된다."],
      ["the same, as a noun plus 가능", "종료 줄의 검증은 생략 가능하다."],
      // A synonym, which is the class FR-FLOW-155 AC-4 records and no list of verbs closes.
      ["a synonym outside the vocabulary", "종료 줄의 검증은 필수가 아니다."],
      // The direction the spacing fold does NOT take: a space inserted inside a word the list
      // writes solid. The fold makes a space the list WROTE optional, which is the anchor's own
      // rule; reaching this one needs a break between syllables instead, and that is a different
      // rule the anchor never took either.
      ["a slot spelled with a space inserted where the list writes none", "종료 줄의 검증은 생략 한다."]
    ];
    for (const [why, sentence] of RESIDUAL) {
      expect(NAMES.filter(([, re]) => re.test(sentence)).map(([label]) => label), `no name reaches it either: ${sentence}`).toEqual([]);
      expect(letOff().test(sentence), `${why}: ${sentence}`).toBe(false);
    }
    // The polite register's 11 is DERIVED rather than counted off a table nobody shipped, which is
    // why AC-6 carries that number and not the census totals beside it: a lemma whose entry stops
    // before the inflection point catches whatever ending follows, the polite one included, and a
    // lemma entered as whole spellings does not. So the class is 16 lemmas less those five, and it
    // is held here on an ending no rule spells rather than on a hand-written polite form.
    const arbitrary = LEMMAS.map((lemma) => [lemma, `${anchorOf(lemma)}${lemma}아무렇게나.`] as const);
    expect(
      arbitrary.filter(([, probe]) => letOff().test(probe)).map(([lemma]) => lemma),
      "the lemmas that catch an ending no rule spells must be exactly the prefix rows, or the polite register's 11 is a coincidence rather than a consequence"
    ).toEqual(PREFIX_LEMMAS.map((row) => row.lemma));
    expect(arbitrary.filter(([, probe]) => !letOff().test(probe)).length, "the polite register's open count is this one, and AC-6 reads it as 11").toBe(11);
    // And the direction the same closed list errs in, which is a CLASS and not the one sentence this
    // case used to carry. `(?<![가-힣])` guards the ban's LEFT edge and nothing guards its right, so
    // a permission spelling that is complete before the negation arrives is matched and the sentence
    // refused however firmly it forbids the thing. Held on the mechanism first, over every entry, so
    // the size of the class is the list's own and not a taste in probes: a Hangul syllable put
    // directly AFTER an entry inside its own sample leaves all 49 refused, and the same syllable put
    // directly BEFORE it leaves all 49 green. This is the cost of the word start Korean does not
    // write, taken knowingly; closing it needs a right-hand boundary, which reads the sentence's
    // meaning rather than its shape.
    const FILLER = "가";
    const rightOpen: string[] = [];
    const leftClosed: string[] = [];
    for (const term of LET_OFF_TERMS) {
      const at = term.sample.indexOf(term.phrase);
      const ends = at + term.phrase.length;
      if (letOff().test(`${term.sample.slice(0, ends)}${FILLER}${term.sample.slice(ends)}`)) rightOpen.push(term.phrase);
      if (!letOff().test(`${term.sample.slice(0, at)}${FILLER}${term.sample.slice(at)}`)) leftClosed.push(term.phrase);
    }
    expect(rightOpen.length, "an entry the ban stops matching when a syllable follows it would narrow this class, and this number is what AC-6 records").toBe(LET_OFF_TERMS.length);
    expect(leftClosed.length, "the left edge is the guarded one; an entry still matching with a syllable BEFORE it is the polarity inversion the case above holds out").toBe(LET_OFF_TERMS.length);
    // What that costs in sentences a shared file would legitimately write to ENFORCE this procedure.
    // Each is refused today, and pinning that here is what makes a later narrowing of the class a
    // reported change rather than a silent one.
    for (const prohibition of [
      "종료 줄의 검증은 생략할 수 없다.",
      "종료 줄의 검증은 건너뛸 수 없다.",
      "종료 줄을 다시 쓸 수 없다.",
      "종료 줄을 덮어 쓸 권한은 없다.",
      "종료 줄의 재작성은 허용하지 않는다.",
      "종료 줄의 검증을 건너뛰고 넘어가면 안 된다.",
      "종료 줄의 재작성은 금지한다."
    ]) {
      expect(letOff().test(prohibition), `this ban's false-refusal class, measured rather than described: ${prohibition}`).toBe(true);
    }
    // And what the spacing fold ADDED to the class: each of these was green before it, because the
    // list writes the space and the sentence does not. The refusal arrives through the spaced entry,
    // named here, so "nothing held green refused" is not read as "the fold cost nothing".
    for (const [solid, entry] of [
      ["종료 줄을 다시쓸 수 없다.", "다시 쓸"],
      ["종료 줄의 검증은 안할 수 없다.", "안 할"],
      ["종료 줄의 검증은 하지않을 수 없다.", "하지 않을"],
      ["종료 줄을 덮어쓸 권한은 없다.", "덮어 쓸"]
    ] as const) {
      expect(LET_OFF_PHRASES.includes(entry), `the spaced entry this is refused through left the list: ${entry}`).toBe(true);
      expect(LET_OFF_PHRASES.includes(entry.replace(/ /g, "")), `the solid spelling is an entry after all, so the fold is not what refuses this: ${solid}`).toBe(false);
      expect(letOffHits(solid, LET_OFF_PHRASES), `the fold is what refuses it, through the spaced entry alone: ${solid}`).toEqual([entry]);
      expect(letOff().test(solid), `a solid-spelled prohibition the fold added to the false-refusal class: ${solid}`).toBe(true);
    }
    // The boundary of the class, so it is not read as "every prohibition": a negation written INSIDE
    // the verb never completes a permission spelling, and those stay green — the case above holds
    // seven of them, and this is an eighth shape, `-면` on a stem no entry spells.
    expect(letOff().test("종료 줄의 검증은 생략하면 안 된다."), "a negation landing before the spelling completes is outside this class, not inside it").toBe(false);
  });

  it("does not judge whether a shared file's content is correct", () => {
    // Stated as a predicate so it cannot decay into a sentence nobody runs: the scan reads five
    // patterns and one shape, and a file saying something false about anything else is green here.
    const wrong = "waves.jsonl 은 JSON 배열이며 재개는 파일 전체를 파싱해 마지막 원소를 읽는다.";
    expect(NAMES.filter(([, re]) => re.test(wrong)).map(([label]) => label)).toEqual([]);
    expect(letOff().test(wrong)).toBe(false);
  });
});

it("reads the shared corpus derivation rather than a second copy of it", () => {
  // `sharedKiwiFiles` lives in `kiwi-renderings.ts` beside the other corpus questions, so the suites
  // that ask "which files ship" cannot drift into two answers. Held on THIS file's own source, not
  // only on the other file's: an assertion that only checks the export exists is satisfied by its
  // own inversion — measured, replacing the corpus here with a local directory walk while leaving
  // the export in place kept all 18 assertions green.
  const source = readFileSync(SELF_PATH, "utf8");
  expect(CORPUS_WIRING.test(source), "the corpus is no longer bound to the shared derivation, so this suite answers `which files` for itself").toBe(true);
  expect(
    [...source.matchAll(/^import[^\n]*from "node:fs";/gm)].map((match) => match[0]),
    "this suite reads one file by absolute path and nothing else; a wider `node:fs` import is a local corpus walk arriving"
  ).toEqual(['import { readFileSync } from "node:fs";']);
  expect(readRepoFile("test/skills/kiwi-renderings.ts").includes("export function sharedKiwiFiles"), "the corpus derivation left the shared module").toBe(true);
});

it("reads every bound the requirement names, so an unread one cannot outlive its assertion", () => {
  const source = readFileSync(SELF_PATH, "utf8");
  const consumed = new Set([...source.matchAll(/\bfloor\("([a-z]+)"\)/g)].map((match) => match[1] as string));
  expect(
    [...BOUNDS.keys()].filter((name) => !consumed.has(name)),
    "a bound the requirement names is asserted nowhere in this file, so deleting the assertion that held it leaves the number standing in the requirement with nothing reading it"
  ).toEqual([]);
  expect(BOUNDS.size, "the requirement names no bounds, and a sweep with no bound is one nothing can shrink visibly").toBeGreaterThan(0);
});
