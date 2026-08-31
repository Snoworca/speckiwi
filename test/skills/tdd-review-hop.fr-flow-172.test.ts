import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  criticalGateRows,
  criticalGatesSection,
  isTableRowLine,
  section,
  stripFrontmatter
} from "./kiwi-orchestrator-variants.js";

/**
 * FR-FLOW-172 — the standalone `kiwi-tdd` path runs the review hop once, and the review hop's own
 * start gate in `kiwi-pm` / `kiwi-coder` carries a decided registration status.
 *
 * A SKILL.md is agent instruction rather than executable code, so the contract is verified by
 * reading the four shipped renderings. Assertions key on language-neutral tokens — tool names, flag
 * spellings, gate ids — because `skills/claude` is Korean and `skills/codex` · `skills/etc` ·
 * `.agents/skills` are English for `kiwi-tdd`.
 *
 * Counted at 3273846, before any edit of this item, over all four `kiwi-tdd` renderings:
 * "리뷰" 0, "review" 0, "pipeline" 0, "emit" 0, `--no-pipeline-emit` 0. The suppression flag token
 * below was 0 occurrences across `skills/`, `.agents/`, `test/` and `docs/`. The `kiwi-tdd` call
 * block of `kiwi-orchestrator` §4.5.1 carried exactly four arguments in every rendering
 * (`<task>`, `--auto`, `--mini | --loops N`, `--model`), so every assertion below was red.
 *
 * The one place this file spells the suppression flag. AC-2 requires the sender and the receiver to
 * agree on the token, so the parent's argument list and the child's skip condition are both searched
 * for THIS constant — renaming either end alone reddens.
 */
const SUPPRESSION_FLAG = "--review-hop-owned-by-parent";

/** The residue marker the two start-gate skills carry beside their `critical_gates[]` table. */
const RESIDUE_MARKER = "review-hop-start-residual-branches";

/** The gate id already owned by `kiwi-coder` for the irreversible branch of that choice. */
const START_GATE_ID = "followup-review-fix-loop-close-unsafe";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** All four shipped trees. The mirror is included so an edit to one rendering cannot pass alone. */
const COPIES = ["skills/claude", "skills/codex", "skills/etc", ".agents/skills"] as const;

/**
 * The two skills whose `critical_gates[]` AC-4 rules on. Hoisted out of the loop header and pinned
 * below, because an inline list is a denominator nobody guards: dropping `kiwi-pm` — the one skill
 * this item actually edits — left the suite completely green at 49 of 49.
 */
const START_GATE_SKILLS = ["kiwi-pm", "kiwi-coder"] as const;

const PROHIBIT = String.raw`never|must not|does not|do not|is not|절대|금지|않는다|않으며|않고|말라|아니다`;

/**
 * A forbidding word, plus the contrastive shapes that forbid by opposing rather than by negating.
 *
 * "skips on the explicit argument rather than inferring a parent" forbids the inference as plainly
 * as "never infer" does, and when it is the clause's ONLY prohibition the bare list misses it. The
 * Korean equivalent was passing by accident — a neighbouring sentence's "아니다" happened to fall
 * inside the same window — so the two languages were being decided by different things.
 */
const CONTRASTIVE_PROHIBIT = String.raw`${PROHIBIT}|rather than|instead of|대신|없이|\bnothing\b|아무것도|무엇도`;

/**
 * What counts as standing AGAINST a phrase, for `contrastedAt`.
 *
 * Narrower than `CONTRASTIVE_PROHIBIT` on purpose: "nothing" reads as a prohibition beside "infer"
 * but says nothing about a ground several words away.
 *
 * The bare syllables `않` and `없` used to stand here and were the wrong unit: `없` matched the
 * CONCESSIVE "그 인자가 없어도", which does not forbid the ground beside it but grants it, and read
 * as opposition it passed "그 인자가 없어도 진입 경로로 건너뛴다" — the inversion AC-2 exists to
 * forbid. Both now carry an ending, so a concession no longer reads as a prohibition.
 */
const OPPOSES = String.raw`${PROHIBIT}|rather than|instead of|대신|없이|not\b|무시|아니다|아니라|아닌|아님|아니고|아니며|않는|않으|않고|않은|않을|없으면|없다|없는|없고|말고|제외`;

function read(copy: string, skill: string): string {
  return readFileSync(path.join(REPO_ROOT, copy, skill, "SKILL.md"), "utf8");
}

function body(copy: string, skill: string): string {
  return stripFrontmatter(read(copy, skill));
}

/** The first fenced block that lists the phases — `kiwi-tdd` §2's flow diagram. */
function phaseFlowBlock(text: string): string {
  for (const block of text.matchAll(/```[\s\S]*?```/g)) {
    if (block[0].includes("Phase 0")) return block[0];
  }
  return "";
}

/** True when `tokens` all occur, in the given order, inside a `span`-character window. */
function orderedWithin(text: string, tokens: string[], span: number): boolean {
  const escaped = tokens.map((token) => token.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&"));
  return new RegExp(escaped.join(`[\\s\\S]{0,${span}}`)).test(text);
}

/** A prohibition word within `window` characters of `token`, on either side of it. */
function prohibitionNear(text: string, token: string, window: number, markers: string = PROHIBIT): boolean {
  const escaped = token.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&");
  return (
    new RegExp(`${escaped}[\\s\\S]{0,${window}}(${markers})`, "i").test(text) ||
    new RegExp(`(${markers})[\\s\\S]{0,${window}}${escaped}`, "i").test(text)
  );
}

/** The `kiwi-tdd` invocation block of `kiwi-orchestrator` §4.5.1 — the sender side of AC-2/AC-3. */
function tddCallLine(orchestrator: string): string {
  const line = orchestrator.split("\n").find((candidate) => /Skill\(\{\s*skill:\s*"kiwi-tdd"/.test(candidate));
  return line ?? "";
}

/**
 * §2.6.1 — the clause that decides suppression, sliced out of the body.
 *
 * Every suppression assertion below reads THIS rather than the whole file. Word proximity measured
 * over a whole SKILL.md passes on a coincidence elsewhere in the document: the Phase 5.5 flow line
 * alone carries both the flag and `kiwi-review-fix-loop`, so a document-wide reader stayed green
 * with this entire clause deleted.
 */
function hopGuardSection(text: string): string {
  return section(text, /^#{3,6}\s*2\.6\.1\b/);
}

/** §2.7 — the promotion phase the hop must precede. */
function promotionSection(text: string): string {
  return section(text, /^#{3,6}\s*2\.7\b/);
}

/**
 * The guard's decision, and why it is read from a table rather than from the prose around it.
 *
 * Three shapes of this check tried to measure the prose, and each was evaded while also reddening
 * faithful rewordings. Co-occurrence let an inverted clause carry every listed word ("with no
 * explicit argument, infer the entry path and skip whenever a parent is plausible") and reddened a
 * faithful rewrite of the same rule. Measuring direction — from each "the argument is absent", the
 * first outcome reached must be the hop running — let a clause state the run first and put an
 * inference exception behind it, keeping the words "건너뛴다" and "skips" and staying 66/66 green.
 * And the negation list, being an enumeration, reddened "rather than inferring" and "추론 대신".
 * Every widening of the vocabulary closed one evasion at the price of blocking more faithful
 * wordings, because a regex cannot decide what a paragraph means.
 *
 * So §2.6.1 now states the decision as a two-row table, and the table is what is measured. A table
 * cannot be evaded by ordering, its cells are too short to hide an exception in, and inverting the
 * rule swaps two cells — which is the mutation this check exists to catch. Rewording is free: the
 * prose around the table may state the rule any way it likes.
 *
 * The prose is then held to one rule: a sentence may say the hop is suppressed only if it also
 * names the argument that arrived, and only if it rests on nothing else. That is not a paraphrase
 * test. The ground for skipping is the only thing AC-2 fixes, so a faithful sentence about skipping
 * names it and stops there, while an exception grounded in the entry path either has no argument to
 * name or has to name a second ground beside it — "그 인자를 받았거나 진입 경로가 …이면 건너뛴다"
 * satisfied "names the argument" and decided on something else, as did a mention put there only to
 * be waved away ("그 인자 이야기는 접어 두고, …"). A ground that appears under a prohibition or a
 * contrast is the faithful wording and stays green.
 *
 * The denominator of both readers is the clause itself. Each used to DISCARD what it did not
 * recognise, and the two discards overlapped: a three-column table stating the opposite rule, a
 * line inside the fence, an exception parenthesised into the header cell, a comment trailing the
 * call — every one of them was read by neither and the suite stayed green. So every line is now
 * classified, `unclassified` must be empty, and the exemptions are listed with their reasons and
 * must each catch something. The one thing a clause-scoped reader cannot see is a second decision
 * table in another section, so `bareDecisionRows` counts those over the whole file.
 */

/** Stating that the argument did not arrive. Such a sentence may not carry a suppression. */
const ABSENCE_OF_ARGUMENT = new RegExp(
  [
    String.raw`인자[가를은는이]?\s*[*_]{0,2}\s*(?:없|주어지지\s*않|전달되지\s*않|넘어오지\s*않|넘기지\s*않|받지\s*않|받지\s*못)`,
    String.raw`(?:without|absent|missing)[^\n]{0,20}?\b(?:it|that argument|the argument|that flag|the flag)\b`,
    String.raw`\b(?:no|without|absent|missing|lacking)\b[^\n]{0,24}?\b(?:argument|flag)\b`,
    String.raw`\b(?:argument|flag)\b[^\n]{0,24}?(?:is absent|is missing|was not passed|is not passed|was not given|is not given)`,
    // Naming the flag by its token rather than by the word "인자" evaded the Korean branches above
    // while still satisfying ARGUMENT_MENTION, so the token spells its own absence too.
    String.raw`--review-hop-owned-by-parent[^\n]{0,8}?(?:없|주어지지\s*않|전달되지\s*않|넘어오지\s*않|넘기지\s*않|받지\s*않|받지\s*못)`,
  ].join("|"),
  "gi"
);

/**
 * Naming the argument itself — the one ground AC-2 lets a skip stand on. Deliberately broad, since
 * widening it only widens what passes. An occurrence overlapping an ABSENCE_OF_ARGUMENT match is
 * dropped, so "그 인자가 없으면" and "without that argument" never count as the argument arriving.
 */
const ARGUMENT_MENTION = new RegExp(
  [
    String.raw`그?\s*[*_]{0,2}\s*(?:명시적?\s*)?[*_]{0,2}\s*인자`,
    String.raw`\b(?:that|the|this|an|its|explicit)\s+(?:explicit\s+)?(?:argument|flag)\b`,
    String.raw`\b(?:with|given|upon|on)\s+(?:it|that|this)\b`,
    String.raw`--review-hop-owned-by-parent`,
  ].join("|"),
  "gi"
);

/** The hop suppressed — the outcome AC-2 lets nothing but the explicit argument reach. */
const HOP_SUPPRESSED = new RegExp(
  // The particle is part of the vocabulary: `홉을` alone missed "Phase 5.5 의 홉은 돌리지 않는다",
  // an inversion written in another section, and it stayed green in all four renderings.
  String.raw`홉[은는이가을를]?[*_\s]*(?:돌리지|돌지|실행하지|수행하지)[*_\s]*(?:않|말)|건너뛰|건너뛴|건너뛸|건너뜀|억제|생략하|생략한|\bskip(?:s|ped|ping)?\b|\bsuppress(?:es|ing|ed)?\b|\b(?:does not|do not|never|will not|cannot) runs?\b`,
  "gi"
);

/**
 * The two outcome cells of the decision table, each the negation of the other.
 *
 * A negated run — "돌리지 않는다", "does not run" — is the skip cell, and the clause's own prose
 * already says it that way, so a writer copying the prose into the cell must not redden. The two
 * are therefore decided in ORDER by `hopOutcome` rather than by two independent patterns: were
 * "실행" simply added to the run list, "실행하지 않는다" would match both and the exclusivity the
 * inversion mutation is caught by would collapse.
 */
const SKIP_CELL =
  /건너뛴|건너뛰|생략|억제|(?:돌리|실행하|수행하)지\s*(?:않|말)|\bskip|\bsuppress|\b(?:does not|do not|never|will not|cannot)\s+runs?\b|\bno hop\b/i;
const RUN_CELL = /돌린다|돌립니다|돈다|실행|수행|\brun|\bexecut/i;
const YES_CELL = /^[*_]*\s*(?:예|yes)\s*[*_]*$/i;
const NO_CELL = /^[*_]*\s*(?:아니오|아니요|no)\s*[*_]*$/i;

/** Which way an outcome cell decides, or null when the cell decides nothing. */
function hopOutcome(cell: string): "skip" | "run" | null {
  if (SKIP_CELL.test(cell)) return "skip";
  if (RUN_CELL.test(cell)) return "run";
  return null;
}

/**
 * Grounds this clause names as NOT inputs to the decision.
 *
 * AC-2 lets the skip stand on the explicit argument alone, so a sentence that names the argument
 * and then adds a second ground with "or" satisfies "names the argument" while deciding on
 * something else — as does one that mentions the argument only to wave it away. Both were green.
 * A ground that appears under a prohibition or a contrast ("never infer it from the entry path")
 * is the faithful wording and is allowed by `contrastedAt`.
 */
const NON_ARGUMENT_GROUND = new RegExp(
  [
    String.raw`진입\s*경로`,
    String.raw`부모[의가]?\s*흔적`,
    String.raw`이전\s*(?:실행|수행)\s*기록`,
    String.raw`오케스트레이터(?:를|로|에서)\s*(?:거쳐|거친|거쳤|보이|온|왔)`,
    String.raw`\bentry\s*path\b`,
    String.raw`\btrace of a parent\b`,
    String.raw`\b(?:earlier|previous|prior)\s+run\b`,
    String.raw`\bcame through the orchestrator\b`
  ].join("|"),
  "gi"
);

/**
 * Whether a negation attaches to the phrase at `at` — the negation of THAT phrase, not a negation
 * loose in the neighbourhood. English puts it immediately ahead ("does not run"), Korean
 * immediately behind ("돌리지 않는다"), so both are anchored to the phrase rather than windowed.
 * A window catches the wrong verb: "추론하지 않고 언제나 홉을 돌린다" negates the inferring, and a
 * loose reading of it deleted the affirmative hop-running it exists to protect.
 */
function negatedAt(text: string, at: number, length: number): boolean {
  const head = text.slice(Math.max(0, at - 12), at);
  const tail = text.slice(at + length, at + length + 8);
  return /(?:never|must not|does not|do not|is not|will not|cannot|절대|금지)\s*$/i.test(head) ||
    /^[*_\s]{0,3}[가-힣]{0,3}[*_\s]{0,3}(?:않|말|없|금지|불가|안\s*된)/.test(tail);
}

/** Every `pattern` occurrence in `text`, as offset and length. */
function spans(text: string, pattern: RegExp): Array<{ at: number; length: number }> {
  const found: Array<{ at: number; length: number }> = [];
  for (const match of text.matchAll(new RegExp(pattern.source, pattern.flags))) {
    found.push({ at: match.index ?? 0, length: match[0].length });
  }
  return found;
}

/** Distance from `at` to the nearest of `found`, or null when there is none. */
function nearest(found: Array<{ at: number; length: number }>, at: number): number | null {
  let best: number | null = null;
  for (const span of found) {
    const distance = Math.max(0, at < span.at ? span.at - at : at - (span.at + span.length));
    if (best === null || distance < best) best = distance;
  }
  return best;
}

/** A table row whose every cell is a `---` delimiter. */
function isDelimiterRow(cells: string[]): boolean {
  return cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

/** The cells of a table-row line, trimmed. */
function rowCells(trimmed: string): string[] {
  return trimmed.slice(1, -1).split("|").map((cell) => cell.trim());
}

/**
 * Lines of §2.6.1 that neither reader judges, each with the reason it is exempt.
 *
 * Every entry must match at least one line of every rendering. An exemption nothing hits is a hole
 * held open by a reason that no longer applies, which is how the two readers came to share a blind
 * spot in the first place.
 *
 * Three exemptions were removed rather than narrowed, because each one's reason turned out to be
 * narrower than the licence it granted. `call` said "the AC-2 call assertion reads it by name" and
 * exempted the whole `Skill({…})` line, so an exception appended to the `args:` string — the very
 * list the agent executes — was read by nobody. `fence-edge` said "a delimiter carries no text" and,
 * together with the fenced-line discard below it, exempted everything between the fences. `heading`
 * said "the heading decides nothing" and exempted the whole title, so an exception in parentheses
 * after the section number was read by nobody. All three are now prose: the heading loses only its
 * `2.6.1` marker, and fenced lines are judged by the same prose rule as everything else. Nothing
 * inside a fence says the hop is suppressed, so the call block, a reformatted call and an example
 * block are all green — while an exception written into any of them reddens.
 *
 * Each exemption also carries the lines it must take and the lines it must refuse, because pinning
 * the id list alone pinned only the name: adding `|| /^\s*Skill\(\{/` to `blank`'s predicate
 * restored the removed `call` exemption under a kept id, and the totals, the id list and the
 * "each exemption catches something" rule all stayed green. The per-copy counts are cross-checked
 * against the real line shapes too, so a predicate cannot widen past the reason written beside it.
 */
const GUARD_LINE_EXEMPTIONS: Array<{
  id: string;
  why: string;
  test: (line: string) => boolean;
  /** Lines this exemption must take. */
  takes: string[];
  /** Lines it must refuse — the shapes a widened predicate would swallow along with them. */
  refuses: string[];
}> = [
  {
    id: "blank",
    why: "a blank line separates blocks",
    test: (line) => line.trim() === "",
    takes: ["", "   ", "\t"],
    refuses: ["| --- | --- |", `Skill({ skill: "kiwi-review-fix-loop", args: "--base x" })`, "```", "진입 경로로 건너뛴다"]
  },
  {
    id: "table-delimiter",
    why: "a `---` row separates a header from its rows and states nothing",
    test: (line) => isTableRowLine(line.trim()) && isDelimiterRow(rowCells(line.trim())),
    takes: ["| --- | --- |", "| :--- | ---: |"],
    refuses: ["", "| 예 | 건너뛴다 |", "| --- | 건너뛴다 |", `Skill({ skill: "kiwi-review-fix-loop" })`, "```"]
  }
];

/** The clause's own section number, which numbers the clause rather than deciding anything in it. */
const CLAUSE_MARKER = /^#{3,6}\s*2\.6\.1\b/;

interface GuardLines {
  /** Two-cell table rows — what the decision-table assertions read. */
  rows: string[][];
  /** Everything else with text in it — what the prose rule reads. */
  prose: string[];
  /** The same prose, grouped the way statements outside the clause are grouped. */
  proseStatements: string[];
  /** How many lines each exemption took, by id. */
  exempt: Map<string, number>;
  /** Lines no reader takes. Any entry here is a line of the clause that nothing measures. */
  unclassified: string[];
  total: number;
}

/**
 * Every line of the clause, assigned to exactly one reader.
 *
 * The denominator is the clause, not the shapes the two readers happened to recognise. Both readers
 * used to DISCARD what they did not understand — `decisionRows` dropped every row that was not two
 * cells, the prose reader deleted every line starting with `|` and every fenced line — so a three-column
 * table stating the opposite rule, or a line inside the fence, was read by neither and the suite
 * stayed at 67 of 67. Discarding is now a classification: whatever no reader takes lands in
 * `unclassified`, and that list must be empty.
 *
 * Exempting is a discard too, so only two exemptions remain and each names a line that carries no
 * statement at all. Everything else — the heading's title, both fence delimiters, the call, and any
 * line between the fences — is prose, judged by the prose rule like the rest.
 */
function classifyGuardLines(guard: string): GuardLines {
  const rows: string[][] = [];
  const prose: string[] = [];
  const proseStatements: string[] = [];
  const exempt = new Map<string, number>();
  const unclassified: string[] = [];
  const lines = guard.split("\n");
  let paragraph: string[] = [];
  let inFence = false;
  const flush = (): void => {
    if (paragraph.length > 0) proseStatements.push(paragraph.join("\n"));
    paragraph = [];
  };
  for (const line of lines) {
    const exemption = GUARD_LINE_EXEMPTIONS.find((candidate) => candidate.test(line));
    if (exemption !== undefined) {
      exempt.set(exemption.id, (exempt.get(exemption.id) ?? 0) + 1);
      flush();
      continue;
    }
    const trimmed = line.trim();
    if (isTableRowLine(trimmed)) {
      const cells = rowCells(trimmed);
      if (cells.length === 2) rows.push(cells);
      else unclassified.push(line);
      flush();
      continue;
    }
    // The heading keeps its title and loses only its number: the number is not a statement, the
    // title is one.
    const kept = CLAUSE_MARKER.test(trimmed) ? trimmed.replace(CLAUSE_MARKER, "").trim() : line;
    prose.push(kept);
    // Grouped exactly as outside the clause: a fence delimiter and every line between the fences
    // stand alone, a heading stands alone, and running prose is joined until a blank line — the
    // English renderings hard-wrap, and a line-scoped reader reddened a faithful sentence the
    // moment it was folded.
    if (/^\s*```/.test(trimmed)) {
      flush();
      inFence = !inFence;
      proseStatements.push(kept);
      continue;
    }
    if (inFence || /^#{1,6}\s/.test(trimmed)) {
      flush();
      proseStatements.push(kept);
      continue;
    }
    paragraph.push(kept);
  }
  flush();
  return { rows, prose, proseStatements, exempt, unclassified, total: lines.length };
}

/**
 * What the prose rule reads: the clause's prose statements, plus the table's header row.
 *
 * The header is prose that happens to sit in a cell. The table assertions read it only for the
 * argument it names, so an exception parenthesised into it — "자체 홉 (단, 진입 경로가 …건너뛴다)" —
 * was measured by nothing. The two outcome cells below it are left out: they say which way the hop
 * goes and are judged as cells.
 */
function guardStatements(guard: string): string[] {
  const lines = classifyGuardLines(guard);
  return [...lines.proseStatements, (lines.rows[0] ?? []).join(" ")];
}

/**
 * A bare decision row: two cells whose outcome cell says only which way the hop goes.
 *
 * Read over the whole body rather than the clause, because a second decision table one section
 * further down is outside every clause-scoped reader and stated the opposite rule at 67 of 67.
 */
function bareDecisionRows(text: string): string[][] {
  const found: string[][] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!isTableRowLine(trimmed)) continue;
    const cells = rowCells(trimmed);
    if (cells.length !== 2 || isDelimiterRow(cells)) continue;
    const outcome = cells[1] as string;
    if (outcome.length <= 30 && hopOutcome(outcome) !== null) found.push(cells);
  }
  return found;
}

/**
 * Sentences, split on line breaks and on terminal punctuation followed by whitespace.
 *
 * A sentence ending in a colon is kept with the one after it. "Exactly one thing suppresses this
 * hop:" names the ground in the list below it rather than in itself, and splitting the two left
 * that faithful wording reddened.
 */
interface Bounds {
  from: number;
  to: number;
}

/**
 * That split, kept as offsets into `text`.
 *
 * Offsets rather than substrings because the readers weigh distances: a suppression is anchored to
 * the nearest argument mention ANYWHERE in the statement, while the ground it rests on and the
 * contrast that excuses that ground are read inside the suppression's own sentence. Sentence-local
 * offsets cannot be compared with statement-wide ones, so every span below indexes the statement.
 */
function sentenceBounds(text: string): Bounds[] {
  const raw: Bounds[] = [];
  let lineFrom = 0;
  for (const line of text.split("\n")) {
    let cursor = 0;
    for (const part of line.split(/(?<=[.!?。])(?=\s)/)) {
      const leading = part.length - part.trimStart().length;
      const trimmed = part.trim();
      if (trimmed.length > 0) {
        raw.push({ from: lineFrom + cursor + leading, to: lineFrom + cursor + leading + trimmed.length });
      }
      cursor += part.length;
    }
    lineFrom += line.length + 1;
  }
  const joined: Bounds[] = [];
  for (const bounds of raw) {
    const previous = joined[joined.length - 1];
    if (previous !== undefined && /:[*_`\s]*$/.test(text.slice(previous.from, previous.to))) previous.to = bounds.to;
    else joined.push({ ...bounds });
  }
  return joined;
}

/**
 * Rejoin the line breaks that are wraps rather than breaks.
 *
 * The English renderings hard-wrap, and a wrap falls anywhere — "when it came through the /
 * orchestrator" put a ground across two lines, where no pattern matched it and the inversion built
 * on it passed. A break that follows terminal punctuation ends a sentence and is kept; every other
 * break is a wrap and becomes a space, so a statement reads the same however it is folded.
 *
 * The carriage returns go first. All four renderings ship CRLF, and a `\r` left at a wrap sat in
 * the middle of the rejoined phrase — "came through the\r orchestrator" matched no ground, and the
 * inversion built on that ground passed inside the clause while the same sentence unwrapped
 * reddened outside it.
 */
function unwrap(statement: string): string {
  return statement.replace(/\r\n?/g, "\n").split("\n").reduce((joined, line, index) => {
    if (index === 0) return line;
    const ends = /[.!?。][*_`)\]"']*\s*$/.test(joined) || joined.trim() === "" || line.trim() === "";
    return ends ? `${joined}\n${line}` : `${joined} ${line}`;
  }, "");
}

/**
 * The clause of `bounds` that holds `at` — the sentence cut at `;` and at a dash.
 *
 * A contrast excuses the ground standing beside it, not every ground in the sentence. "그 인자를
 * 받으면 건너뛴다 — 진입 경로는 보지 않는다" forbids its ground in the clause the ground sits in,
 * while "The entry path is not the input the table names; when it came through the orchestrator …
 * this hop is skipped" puts its `not` in a clause the ground never enters, and reading that `not`
 * as a contrast passed the inversion in all four renderings.
 */
function clauseAround(text: string, bounds: Bounds, at: number): Bounds {
  let from = bounds.from;
  let to = bounds.to;
  for (const cut of text.slice(bounds.from, bounds.to).matchAll(/[;—–]/g)) {
    const offset = bounds.from + (cut.index ?? 0);
    if (offset <= at) from = Math.max(from, offset + cut[0].length);
    else to = Math.min(to, offset);
  }
  return { from, to };
}

/**
 * The prose rule: a sentence saying the hop is suppressed must also say the argument arrived.
 *
 * This is what the three earlier shapes were reaching for. An exception grounded in the entry path
 * — "진입 경로가 오케스트레이터를 거친 것으로 보이는 경우에는 … 홉을 건너뛴다" — has no argument to
 * name, and naming one would make it the faithful rule. Ordering does not help it, because every
 * sentence is judged rather than only the first outcome after each absence.
 */
/**
 * Whether a prohibition or a contrast stands against the phrase at `at`.
 *
 * "Never mind that argument" is dropped first: it dismisses what follows rather than forbidding it,
 * and read as a prohibition it let an entry-path ground through on the strength of its "never".
 */
function contrastedAt(text: string, at: number, length: number, scope: Bounds): boolean {
  const dismissal = /never mind|접어\s*두|제쳐\s*두/gi;
  const head = text.slice(Math.max(scope.from, at - 48), at).replace(dismissal, " ");
  const tail = text.slice(at + length, Math.min(scope.to, at + length + 28)).replace(dismissal, " ");
  const marker = new RegExp(`(?:${OPPOSES})`, "i");
  return marker.test(head) || marker.test(tail);
}

/**
 * Judge one statement: the argument may be named anywhere in it, but a suppression is weighed
 * inside its own sentence and excused only by a contrast in its own clause.
 *
 * The two scopes are separate because widening or narrowing both together broke one side or the
 * other. Held to the sentence, the two faithful statements the body makes about this hop outside
 * the clause reddened, because each puts the argument and the outcome in different sentences of one
 * line, and folding an English paragraph reddened it too. Held to the paragraph, a single faithful
 * sentence copied in beside an exception laundered it: "Phase 5.5 의 홉은 … 넘겼을 때만 건너뛴다.
 * 진입 경로는 입력이 아니다." carried "진입 경로가 오케스트레이터를 거친 것으로 보이면 이 홉을
 * 건너뛴다." through green in all four renderings.
 */
function judgeStatement(raw: string): string {
  const statement = unwrap(raw);
  const absences = spans(statement, ABSENCE_OF_ARGUMENT);
  const mentions = spans(statement, ARGUMENT_MENTION).filter(
    (mention) =>
      !absences.some(
        (absence) => mention.at < absence.at + absence.length && absence.at < mention.at + mention.length
      )
  );
  for (const bounds of sentenceBounds(statement)) {
    const sentence = statement.slice(bounds.from, bounds.to);
    for (const local of spans(sentence, HOP_SUPPRESSED)) {
      const at = bounds.from + local.at;
      if (negatedAt(statement, at, local.length)) continue;
      const quoted = sentence.slice(local.at, local.at + local.length);
      const toMention = nearest(mentions, at);
      const toAbsence = nearest(absences, at);
      if (toMention === null) {
        return `"${quoted}" is decided by a statement that names no argument: "${sentence.slice(0, 70)}"`;
      }
      if (toAbsence !== null && toAbsence < toMention) {
        return `"${quoted}" hangs on the argument being absent: "${sentence.slice(0, 70)}"`;
      }
      for (const ground of spans(sentence, NON_ARGUMENT_GROUND)) {
        const groundAt = bounds.from + ground.at;
        if (contrastedAt(statement, groundAt, ground.length, clauseAround(statement, bounds, groundAt))) continue;
        const named = sentence.slice(ground.at, ground.at + ground.length);
        return `"${quoted}" rests on "${named}" as well as on the argument: "${sentence.slice(0, 70)}"`;
      }
    }
  }
  return "";
}

function suppressionUnanchored(guard: string): string {
  for (const statement of guardStatements(guard)) {
    const verdict = judgeStatement(statement);
    if (verdict !== "") return verdict;
  }
  return "";
}

/**
 * What makes a statement one about THIS hop.
 *
 * The body says "skip" about several other things — the SDS skip-gate, the scaffold that never
 * overwrites, the pipeline event `--no-pipeline-emit` suppresses, and a "Never run the following"
 * halt list. Judging every one of them by the argument rule would redden four faithful lines per
 * rendering, so the rule outside the clause is scoped to the subject the requirement is about.
 *
 * A bare "리뷰" / "review" was tried as a marker and taken back out. It read every sentence that
 * merely contains the word as one about this hop, so "설계 리뷰는 생략한다" and "the code review is
 * skipped" — correct sentences about a DIFFERENT review — reddened, and the failure message told
 * their author to name an argument that has nothing to do with them. Blocking a correct sentence is
 * worse than missing an evasive one, and narrowing it back to a standard name buys nothing: "리뷰
 * 홉" and "review hop" are already matched by 홉 / hop. So a statement that calls this hop "the
 * review" and nothing else is NOT judged, and that is recorded as unguaranteed in AC-2.
 */
const HOP_SUBJECT = /홉|\bhop\b|kiwi-review-fix-loop|Phase\s*5\.5/i;

/** The body with §2.6.1 cut out — the clause has its own, sentence-scoped reader. */
function bodyOutsideGuard(text: string): string[] {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => CLAUSE_MARKER.test(line));
  if (start < 0) return lines;
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^#{1,6}\s/.test(lines[index] as string)) {
      end = index;
      break;
    }
  }
  return lines.filter((_, index) => index < start || index >= end);
}

/**
 * Statements made outside §2.6.1, each carrying the table header that fixes its subject.
 *
 * The unit out here is the paragraph rather than the sentence, because the two faithful statements
 * the body makes about this hop outside the clause — the §1.1 argument row and the §2 flow line —
 * put the argument and the outcome in one line but in different sentences, and a sentence-scoped
 * reader reddens both. The paragraph rather than the line, because the English renderings hard-wrap
 * their prose: four paragraphs per rendering run to more than one line, so a line-scoped reader
 * reddens a faithful sentence the moment it is wrapped.
 *
 * A row's subject is set by its header, so a header is carried down: a three-column table whose
 * header says `자체 홉` and whose row says only `건너뛴다` is one statement, not two. Fenced lines
 * are taken one at a time — they are not wrapped prose, and joining them would let an exception ride
 * along on a mention several lines away.
 */
function outsideStatements(text: string): string[] {
  const statements: string[] = [];
  let paragraph: string[] = [];
  let header = "";
  let inFence = false;
  const flush = (): void => {
    if (paragraph.length > 0) statements.push(paragraph.join("\n"));
    paragraph = [];
  };
  for (const line of bodyOutsideGuard(text)) {
    const trimmed = line.trim();
    if (!inFence && isTableRowLine(trimmed)) {
      flush();
      if (isDelimiterRow(rowCells(trimmed))) continue;
      if (header === "") header = line;
      else {
        statements.push(`${header}\n${line}`);
        continue;
      }
      statements.push(line);
      continue;
    }
    header = "";
    if (/^\s*```/.test(trimmed)) {
      flush();
      inFence = !inFence;
      statements.push(line);
      continue;
    }
    if (inFence || /^#{1,6}\s/.test(trimmed)) {
      flush();
      statements.push(line);
      continue;
    }
    if (trimmed === "") {
      flush();
      continue;
    }
    paragraph.push(line);
  }
  flush();
  return statements;
}

/**
 * AC-2's "the only place in the `kiwi-tdd` body that decides this hop", measured as sentences.
 *
 * `bareDecisionRows` below measures the same claim as a table, and a table is one shape out of many:
 * a paragraph in a new §2.6.2, a single sentence added to the existing §2.8, a two-column row whose
 * outcome cell runs past thirty characters, and a three-column table all said the hop is skipped on
 * the entry path and all stayed green. So every statement outside the clause is now held to the same
 * rule the clause's prose is held to — it may say the hop is suppressed only where it names the
 * argument that arrived and rests on nothing else.
 */
function suppressionOffClause(text: string): string {
  for (const statement of outsideStatements(text)) {
    if (!HOP_SUBJECT.test(statement)) continue;
    const verdict = judgeStatement(statement);
    if (verdict !== "") return verdict;
  }
  return "";
}

describe("FR-FLOW-172 — kiwi-tdd review hop and its start gate", () => {
  it("reads every shipped rendering", () => {
    // A list-shaped denominator passes vacuously when emptied, so the count is pinned here.
    expect(COPIES.length, "all four trees must be read").toBe(4);
  });

  it("the vocabularies the suppression assertions turn on are not empty", () => {
    // A regex denominator empties as silently as a list one: replacing HOP_SUPPRESSED with a
    // pattern matching nothing left all 66 assertions green, exactly as emptying PINNED did
    // elsewhere. Each pattern is pinned against literal probes and against the real clauses.
    expect(spans("건너뛴다 · 홉을 돌리지 않는다 · 홉은 돌리지 않는다 · skips it · does not run", HOP_SUPPRESSED).length).toBe(5);
    expect(spans("그 인자를 받으면 · 명시적 인자 · with that argument · --review-hop-owned-by-parent", ARGUMENT_MENTION).length).toBe(4);
    expect(spans("그 인자가 없으면 · without that argument · with no explicit flag", ABSENCE_OF_ARGUMENT).length).toBe(3);
    expect(
      spans("`--review-hop-owned-by-parent` 가 없으면 · `--review-hop-owned-by-parent` 가 없는 실행", ABSENCE_OF_ARGUMENT).length,
      "the flag named by its token and said to be absent is an absence, or the token evades the word"
    ).toBe(2);
    // A concession grants the ground beside it; it does not forbid it. The bare syllables `없` and
    // `않` read "없어도" as a prohibition, and on that reading the inversion passed everywhere.
    const opposes = new RegExp(`(?:${OPPOSES})`, "i");
    expect(
      ["없어도", "없더라도", "않아도", "아니어도"].filter((concession) => opposes.test(concession)),
      "a concession must not count as standing against the ground beside it"
    ).toEqual([]);
    expect(
      ["보지 않는다", "입력이 아니다", "무시한다", "제외한다", "rather than", "is not"].filter(
        (prohibition) => !opposes.test(prohibition)
      ),
      "a prohibition must still count"
    ).toEqual([]);
    expect(["건너뛴다", "skip it", "돌리지 않는다", "does not run"].map(hopOutcome)).toEqual([
      "skip",
      "skip",
      "skip",
      "skip"
    ]);
    expect(["돌린다", "run it", "실행한다", "executes its own hop"].map(hopOutcome)).toEqual([
      "run",
      "run",
      "run",
      "run"
    ]);
    expect(hopOutcome("자체 홉"), "a cell that decides nothing must decide nothing").toBe(null);
    expect(spans("진입 경로 · entry path · 부모의 흔적", NON_ARGUMENT_GROUND).length).toBe(3);
    // The classifier is the denominator both readers now share, so it is pinned like the rest: a
    // three-column row and a fenced line that is not the call must reach `unclassified`, and the
    // clause's own shapes must reach their readers.
    expect(classifyGuardLines("| a | b | c |").unclassified.length).toBe(1);
    expect(classifyGuardLines("| a | b |").rows).toEqual([["a", "b"]]);
    expect(classifyGuardLines("plain").prose).toEqual(["plain"]);
    // Inside the clause the unit is the paragraph too. It was the line, and folding the clause's
    // English prose — which every English rendering hard-wraps — reddened it.
    expect(
      classifyGuardLines("첫 줄\n접힌 줄\n\n다음 문단").proseStatements,
      "wrapped lines are one statement; a blank line ends it"
    ).toEqual(["첫 줄\n접힌 줄", "다음 문단"]);
    expect(
      classifyGuardLines("```\n그 인자를 받으면\n이 홉을 건너뛴다\n```").proseStatements,
      "fenced lines stand alone, so an exception may not ride on a mention a line away"
    ).toEqual(["```", "그 인자를 받으면", "이 홉을 건너뛴다", "```"]);
    // A fenced line and a heading title are prose now, not exemptions: an exception written into
    // the call's `args:` string, into a comment beside it, or into the heading after the section
    // number was exempt as "a call" / "a delimiter" / "a heading" and measured by nothing.
    expect(classifyGuardLines("```\n건너뛴다\n```").prose).toEqual(["```", "건너뛴다", "```"]);
    expect(classifyGuardLines("### 2.6.1 리뷰 홉 (진입 경로로 건너뛴다)").prose).toEqual([
      "리뷰 홉 (진입 경로로 건너뛴다)"
    ]);
    expect(
      GUARD_LINE_EXEMPTIONS.map((exemption) => exemption.id),
      "an exemption is a discard, so only lines carrying no statement at all may be exempt"
    ).toEqual(["blank", "table-delimiter"]);
    // The id list pins only the name. Restoring the removed `call` exemption as an extra predicate
    // under the kept id `blank` left every exemption assertion green, so what each one takes and
    // what it must refuse is pinned beside its reason.
    for (const exemption of GUARD_LINE_EXEMPTIONS) {
      expect(exemption.takes.length, `${exemption.id}: an exemption with no probe is unpinned`).toBeGreaterThan(0);
      expect(
        exemption.refuses.length,
        `${exemption.id}: an exemption that refuses nothing may widen to anything`
      ).toBeGreaterThan(0);
      expect(
        exemption.takes.filter((line) => !exemption.test(line)),
        `${exemption.id}: must take the lines its reason describes`
      ).toEqual([]);
      expect(
        exemption.refuses.filter((line) => exemption.test(line)),
        `${exemption.id}: a predicate wider than "${exemption.why}" carries a statement out of both readers`
      ).toEqual([]);
    }
    // The off-clause reader: subject-scoped, header-carrying, and judged by the same rule.
    expect(HOP_SUBJECT.test("자체 홉을 건너뛴다")).toBe(true);
    expect(HOP_SUBJECT.test("skipped when the parent owns the hop")).toBe(true);
    expect(
      HOP_SUBJECT.test("설계 리뷰는 생략한다") || HOP_SUBJECT.test("the code review is skipped"),
      "a sentence about a DIFFERENT review must not be dragged under this hop's argument rule"
    ).toBe(false);
    expect(
      HOP_SUBJECT.test("Then skip the SDS and record only an EARS stub"),
      "a skip about something else must not be judged by this hop's rule"
    ).toBe(false);
    expect(
      suppressionOffClause("| 진입 경로 | 자체 홉 |\n| --- | --- |\n| 오케스트레이터 | 건너뛴다 |"),
      "a row's subject is its header, so a three-column decision outside the clause must be rejected"
    ).not.toBe("");
    expect(
      suppressionOffClause("진입 경로가 오케스트레이터를 거친 것으로 보이면 Phase 5.5 의 리뷰 홉은 건너뛴다."),
      "one sentence in another section decides this hop just as a table does"
    ).not.toBe("");
    expect(
      suppressionOffClause("Phase 5.5 : 리뷰 홉 — `--review-hop-owned-by-parent` 를 받았으면 건너뛴다"),
      "the flow line and the argument row state the rule faithfully and must stay green"
    ).toBe("");
    expect(
      suppressionOffClause("1. Skip-gate first: skip the SDS and record only an EARS stub."),
      "the body's other skips are about other subjects"
    ).toBe("");
    expect(
      suppressionOffClause("부모가 `--review-hop-owned-by-parent` 를 명시적 인자로 넘겼다면\n이 홉을 건너뛴다."),
      "the English renderings hard-wrap their prose, so a wrapped faithful sentence must stay green"
    ).toBe("");
    expect(
      suppressionOffClause("```\n그 인자를 받으면\n이 홉을 건너뛴다\n```"),
      "fenced lines are not wrapped prose, so an exception may not ride on a mention a line away"
    ).not.toBe("");
    expect(
      prohibitionNear("skips on that argument rather than inferring a parent", "infer", 120, CONTRASTIVE_PROHIBIT),
      "a contrastive prohibition must forbid as plainly as a negating one"
    ).toBe(true);
    // The rule itself is pinned too: gutting its body would otherwise pass like any other helper.
    expect(
      suppressionUnanchored("진입 경로가 오케스트레이터로 보이면 홉을 건너뛴다."),
      "a skip that names no argument must still be rejected"
    ).not.toBe("");
    expect(
      suppressionUnanchored("그 인자를 받으면 홉을 건너뛴다."),
      "a skip that names the arriving argument must still be accepted"
    ).toBe("");
    expect(
      suppressionUnanchored("그 인자를 받았거나 진입 경로가 오케스트레이터로 보이면 홉을 건너뛴다."),
      "a skip that names the argument and then adds a second ground must be rejected"
    ).not.toBe("");
    expect(
      suppressionUnanchored("그 인자를 받으면 홉을 건너뛴다 — 진입 경로는 보지 않는다."),
      "naming the entry path only to forbid it must still be accepted"
    ).toBe("");
    // The inversion AC-2 forbids, written as a concession rather than as a second ground. The bare
    // `없` in OPPOSES read "없어도" as a prohibition and passed all four renderings on it.
    expect(
      suppressionUnanchored("`--review-hop-owned-by-parent` 가 없어도 진입 경로가 오케스트레이터를 거친 것으로 보이면 이 홉을 건너뛴다."),
      "conceding the argument may be absent and skipping anyway is the inversion itself"
    ).not.toBe("");
    expect(
      suppressionUnanchored("Even without that argument, this hop is skipped when it came through the orchestrator."),
      "the English concession states the same inversion"
    ).not.toBe("");
    // A contrast excuses the ground in its own clause, not one in a clause it never enters.
    expect(
      suppressionUnanchored(
        "The entry path is not the input the table names; when it came through the orchestrator, this hop is skipped."
      ),
      "a `not` in another clause must not launder the ground that decides the hop"
    ).not.toBe("");
    expect(
      judgeStatement(
        "The entry path is not the input the table names; when it came through the\norchestrator, `--review-hop-owned-by-parent` is treated as given and this hop is skipped."
      ),
      "a wrap inside the ground must not hide it, and naming the argument must not excuse the ground"
    ).not.toBe("");
    expect(
      judgeStatement(
        "The entry path is not the input the table names; when it came through the\r\norchestrator, `--review-hop-owned-by-parent` is treated as given and this hop is skipped."
      ),
      "every rendering ships CRLF, so a `\\r` left at a wrap must not hide the ground the wrap crosses"
    ).not.toBe("");
    // The argument may be named anywhere in the statement, but a suppression is weighed in its own
    // sentence: a faithful sentence copied in beside an exception used to carry it through.
    expect(
      judgeStatement(
        "Phase 5.5 의 홉은 부모가 `--review-hop-owned-by-parent` 를 넘겼을 때만 건너뛴다. 진입 경로는 입력이 아니다.\n진입 경로가 오케스트레이터를 거친 것으로 보이면 이 홉을 건너뛴다."
      ),
      "one sentence's contrast may not launder another sentence's ground"
    ).not.toBe("");
    expect(
      judgeStatement("부모가 `--review-hop-owned-by-parent` 를 넘겼다.\n그러면 이 홉을 건너뛴다."),
      "the argument may be named in an earlier sentence of the same paragraph"
    ).toBe("");
    const clauses = COPIES.map((copy) => hopGuardSection(body(copy, "kiwi-tdd")));
    expect(
      clauses.reduce((total, clause) => total + spans(clause, HOP_SUPPRESSED).length, 0),
      "the four clauses must each state the suppression the assertions read"
    ).toBeGreaterThanOrEqual(8);
    expect(
      clauses.reduce((total, clause) => total + spans(clause, ARGUMENT_MENTION).length, 0),
      "the four clauses must each name the argument the suppression hangs on"
    ).toBeGreaterThanOrEqual(8);
  });

  it("rules on both start-gate skills", () => {
    expect(START_GATE_SKILLS.length, "both start-gate skills must be ruled on").toBe(2);
    expect(START_GATE_SKILLS, "the skill this item edits must stay in the denominator").toContain("kiwi-pm");
  });

  describe("AC-1 — the hop exists and precedes promotion", () => {
    for (const copy of COPIES) {
      it(`${copy}: the phase flow names kiwi-review-fix-loop before promote_step_requirement`, () => {
        const flow = phaseFlowBlock(body(copy, "kiwi-tdd"));
        expect(flow, `${copy}: the phase-flow block must be locatable`).not.toBe("");
        const hop = flow.indexOf("kiwi-review-fix-loop");
        const promote = flow.indexOf("promote_step_requirement");
        expect(hop, `${copy}: the phase flow must name the review hop`).toBeGreaterThanOrEqual(0);
        expect(promote, `${copy}: the phase flow must still name the promotion`).toBeGreaterThanOrEqual(0);
        expect(hop, `${copy}: the review hop must run before promotion, not after it`).toBeLessThan(promote);
      });

      it(`${copy}: the hop's own section stands ahead of the promotion section`, () => {
        // AC-1 says "in document order", and the flow line is not the document. Moving §2.6.1 whole
        // to sit after §2.7 left the flow line untouched and the suite green, while the section a
        // reader follows now put the review after the requirement was already closed.
        const text = body(copy, "kiwi-tdd");
        const guardAt = text.search(/^#{3,6}\s*2\.6\.1\b/m);
        const promoteAt = text.search(/^#{3,6}\s*2\.7\b/m);
        expect(guardAt, `${copy}: the review-hop section must be locatable`).toBeGreaterThanOrEqual(0);
        expect(promoteAt, `${copy}: the promotion section must be locatable`).toBeGreaterThanOrEqual(0);
        expect(
          promotionSection(text).includes("promote_step_requirement"),
          `${copy}: §2.7 must be the promotion itself, not merely the next number`
        ).toBe(true);
        expect(
          guardAt,
          `${copy}: a hop placed after promotion judges a requirement already closed`
        ).toBeLessThan(promoteAt);
      });

      it(`${copy}: a phase section invokes kiwi-review-fix-loop`, () => {
        const text = body(copy, "kiwi-tdd");
        const invocations = [...text.matchAll(/kiwi-review-fix-loop/g)].length;
        expect(invocations, `${copy}: the hop needs a section of its own, not only a flow line`).toBeGreaterThanOrEqual(2);
        expect(
          /Skill\(\{\s*skill:\s*"kiwi-review-fix-loop"/.test(text),
          `${copy}: the hop must name the call it makes`
        ).toBe(true);
      });

      it(`${copy}: a residual CRITICAL or HIGH forbids TASK_DONE`, () => {
        const text = body(copy, "kiwi-tdd");
        expect(
          orderedWithin(text, ["CRITICAL", "HIGH"], 40),
          `${copy}: the terminal condition must name both severities`
        ).toBe(true);
        expect(
          new RegExp(`CRITICAL[\\s\\S]{0,240}TASK_DONE`).test(text),
          `${copy}: the terminal condition must tie the severities to TASK_DONE`
        ).toBe(true);
        expect(
          prohibitionNear(text, "TASK_DONE", 80),
          `${copy}: TASK_DONE must be forbidden, not merely mentioned`
        ).toBe(true);
      });
    }
  });

  describe("AC-2 — one suppression token, fixed at both ends", () => {
    for (const copy of COPIES) {
      it(`${copy}: kiwi-orchestrator passes the flag in the kiwi-tdd call`, () => {
        const line = tddCallLine(body(copy, "kiwi-orchestrator"));
        expect(line, `${copy}: the §4.5.1 kiwi-tdd invocation must be locatable`).not.toBe("");
        expect(
          line.includes(SUPPRESSION_FLAG),
          `${copy}: the parent must send ${SUPPRESSION_FLAG}; a flag only the child knows suppresses nothing`
        ).toBe(true);
      });

      it(`${copy}: kiwi-tdd skips its own hop only on that same flag`, () => {
        const text = body(copy, "kiwi-tdd");
        const guard = hopGuardSection(text);
        expect(
          text.includes(SUPPRESSION_FLAG),
          `${copy}: the child must check the same token the parent sends`
        ).toBe(true);
        expect(guard, `${copy}: §2.6.1, the clause that decides suppression, must be locatable`).not.toBe("");
        expect(
          guard.includes(SUPPRESSION_FLAG) && /Skill\(\{\s*skill:\s*"kiwi-review-fix-loop"/.test(guard),
          `${copy}: the flag must sit in the very clause that makes the hop's call, not elsewhere in the file`
        ).toBe(true);
      });

      it(`${copy}: kiwi-tdd suppresses on the explicit argument and otherwise runs the hop`, () => {
        const guard = hopGuardSection(body(copy, "kiwi-tdd"));
        expect(guard, `${copy}: §2.6.1 must be locatable`).not.toBe("");
        expect(
          orderedWithin(guard, [SUPPRESSION_FLAG, "명시"], 80) ||
            orderedWithin(guard, ["명시", SUPPRESSION_FLAG], 80) ||
            orderedWithin(guard, [SUPPRESSION_FLAG, "explicit"], 80) ||
            orderedWithin(guard, ["explicit", SUPPRESSION_FLAG], 80),
          `${copy}: the skip must hang on the argument being explicit, not on the entry looking parented`
        ).toBe(true);
        const lines = classifyGuardLines(guard);
        expect(
          lines.unclassified,
          `${copy}: a line neither reader takes is a line of the clause nothing measures — a table that is not two cells and a fenced line both used to be discarded in silence`
        ).toEqual([]);
        expect(
          lines.rows.length + lines.prose.length + [...lines.exempt.values()].reduce((sum, count) => sum + count, 0),
          `${copy}: every line of §2.6.1 must land in exactly one of the two readers or in a named exemption`
        ).toBe(lines.total);
        expect(
          [...lines.exempt.keys()].sort(),
          `${copy}: an exemption that catches nothing is a hole standing open under a stale reason`
        ).toEqual(GUARD_LINE_EXEMPTIONS.map((exemption) => exemption.id).sort());
        // What each exemption took, counted again from the line shapes its reason names. A widened
        // predicate keeps the id, the totals and the "catches something" rule, and shows up only
        // here: `blank` may take blank lines and nothing else.
        const guardLines = guard.split("\n");
        expect(
          lines.exempt.get("blank"),
          `${copy}: "blank" must take the blank lines and no line that carries a statement`
        ).toBe(guardLines.filter((line) => line.trim() === "").length);
        expect(
          lines.exempt.get("table-delimiter"),
          `${copy}: "table-delimiter" must take the \`---\` rows and no row that decides anything`
        ).toBe(
          guardLines.filter((line) => {
            const trimmed = line.trim();
            return isTableRowLine(trimmed) && isDelimiterRow(rowCells(trimmed));
          }).length
        );
        const rows = lines.rows;
        expect(rows.length, `${copy}: §2.6.1 must decide in a table of exactly two cases`).toBe(3);
        expect(
          (rows[0] ?? []).join(" ").includes(SUPPRESSION_FLAG),
          `${copy}: the table must be headed by the argument it turns on`
        ).toBe(true);
        const [givenCase, givenOutcome] = rows[1] as [string, string];
        const [absentCase, absentOutcome] = rows[2] as [string, string];
        expect(YES_CELL.test(givenCase), `${copy}: the first case must be the argument given`).toBe(true);
        expect(
          hopOutcome(givenOutcome),
          `${copy}: with the argument the hop is skipped, and inverting the rule swaps this cell`
        ).toBe("skip");
        expect(NO_CELL.test(absentCase), `${copy}: the second case must be the argument absent`).toBe(true);
        expect(
          hopOutcome(absentOutcome),
          `${copy}: without the argument the hop runs, and the reverse never runs and is silent`
        ).toBe("run");
        for (const outcome of [givenOutcome, absentOutcome]) {
          expect(
            spans(outcome, NON_ARGUMENT_GROUND).length + spans(outcome, ABSENCE_OF_ARGUMENT).length,
            `${copy}: an outcome cell says which way the hop goes and nothing else — "${outcome}" carries a ground of its own, and a ground inside a cell is read by neither reader`
          ).toBe(0);
        }
      });

      it(`${copy}: the file's only bare decision rows are that table's two`, () => {
        // A clause-scoped reader cannot see a second decision table one section further down, and
        // a contradicting `| 예 | 돌린다 |` pair placed in §2.6.2 left the suite at 67 of 67.
        const text = body(copy, "kiwi-tdd");
        const guard = hopGuardSection(text);
        const everywhere = bareDecisionRows(text).map((cells) => cells.join(" | "));
        expect(
          everywhere,
          `${copy}: a second table that decides this hop makes the document say two things`
        ).toEqual(bareDecisionRows(guard).map((cells) => cells.join(" | ")));
        expect(everywhere.length, `${copy}: the decision is exactly two cases and lives in one place`).toBe(2);
      });

      it(`${copy}: nothing outside §2.6.1 decides this hop either`, () => {
        // The row above measures "the only place" as a TABLE, and a table is one shape out of many.
        // A paragraph in a new §2.6.2, a single sentence added to the existing §2.8, a two-column
        // row whose outcome cell ran past thirty characters, and a three-column table each said the
        // hop is skipped on the entry path, and each left the suite at 71 of 71.
        const text = body(copy, "kiwi-tdd");
        // The denominator out here is stated rather than assumed: every line outside §2.6.1 becomes
        // a statement, save the `---` rows that separate a header from its body.
        const outside = bodyOutsideGuard(text).filter((line) => {
          const trimmed = line.trim();
          return trimmed !== "" && !(isTableRowLine(trimmed) && isDelimiterRow(rowCells(trimmed)));
        });
        const covered = new Set(outsideStatements(text).flatMap((statement) => statement.split("\n")));
        expect(
          outside.filter((line) => !covered.has(line)),
          `${copy}: every line outside the clause must reach the reader, or the rule below is measuring a subset`
        ).toEqual([]);
        expect(
          suppressionOffClause(text),
          `${copy}: a statement outside the clause may say this hop is suppressed only where it names the argument that arrived`
        ).toBe("");
      });

      it(`${copy}: kiwi-tdd decides suppression from the argument and never by inference`, () => {
        const guard = hopGuardSection(body(copy, "kiwi-tdd"));
        expect(guard, `${copy}: §2.6.1 must be locatable`).not.toBe("");
        expect(
          (guard.includes("추론") || /\binfer/i.test(guard)) &&
            (prohibitionNear(guard, "추론", 120, CONTRASTIVE_PROHIBIT) ||
              prohibitionNear(guard, "infer", 120, CONTRASTIVE_PROHIBIT)),
          `${copy}: over-suppression is silent, so the guard clause must forbid inferring a parent`
        ).toBe(true);
        expect(
          suppressionUnanchored(guard),
          `${copy}: the clause may say the hop is skipped only where it says the argument arrived`
        ).toBe("");
      });
    }
  });

  describe("AC-3 — the pipeline event, and the parent that suppresses it", () => {
    for (const copy of COPIES) {
      it(`${copy}: kiwi-tdd's last phase cites the shared contract`, () => {
        const text = body(copy, "kiwi-tdd");
        expect(text.includes("pipeline-event.md"), `${copy}: the emit obligation must cite its SSOT`).toBe(true);
        expect(
          text.includes("--no-pipeline-emit"),
          `${copy}: the child must honour the parent's emit suppression`
        ).toBe(true);
        expect(
          text.includes("schema_version"),
          `${copy}: the contract is cited, not restated — a third copy of the schema is what item 16 collects`
        ).toBe(false);
      });

      it(`${copy}: kiwi-orchestrator passes --no-pipeline-emit to kiwi-tdd`, () => {
        const line = tddCallLine(body(copy, "kiwi-orchestrator"));
        expect(
          line.includes("--no-pipeline-emit"),
          `${copy}: without it the delegated unit writes its own line into the run's journal`
        ).toBe(true);
      });
    }
  });

  describe("AC-4 — the start gate's registration is decided", () => {
    for (const skill of START_GATE_SKILLS) {
      for (const copy of COPIES) {
        it(`${copy}/${skill}: declares ${START_GATE_ID}`, () => {
          const rows = criticalGateRows(body(copy, skill));
          expect(rows.length, `${copy}/${skill}: an empty table would satisfy any absence claim`).toBeGreaterThan(5);
          expect(
            rows.map((row) => row.gateId),
            `${copy}/${skill}: the irreversible branch of the review-hop start choice must be a declared halt`
          ).toContain(START_GATE_ID);
        });

        it(`${copy}/${skill}: records why the remaining branches stay outside the table`, () => {
          const gates = criticalGatesSection(body(copy, skill));
          expect(gates, `${copy}/${skill}: the gate section must be locatable`).not.toBe("");
          expect(
            gates.includes(RESIDUE_MARKER),
            `${copy}/${skill}: leaving the judgment blank sends the next reader through the same investigation`
          ).toBe(true);
          expect(
            orderedWithin(gates, [RESIDUE_MARKER, "implemented"], 700),
            `${copy}/${skill}: the reason must say what the reversible branches leave behind`
          ).toBe(true);
          expect(
            orderedWithin(gates, [RESIDUE_MARKER, "verified"], 700),
            `${copy}/${skill}: the reason must name the state that cannot be rewound`
          ).toBe(true);
        });
      }
    }
  });

  describe("AC-5 — the orchestrator's existing hop obligations survive", () => {
    for (const copy of COPIES) {
      it(`${copy}: the exactly-once terminal-hop sentence is still there`, () => {
        const text = body(copy, "kiwi-orchestrator");
        expect(
          orderedWithin(text, ["종료 hop 의무", "kiwi-review-fix-loop", "정확히 한 번"], 120),
          `${copy}: this item must not be satisfied by deleting the rule it builds on`
        ).toBe(true);
      });

      it(`${copy}: the step-window review hop block is still there`, () => {
        const text = body(copy, "kiwi-orchestrator");
        expect(
          /Skill\(\{\s*skill:\s*"kiwi-review-fix-loop",\s*args:\s*"--base \{step_window_base\}/.test(text),
          `${copy}: §4.5.1's own review hop must survive`
        ).toBe(true);
      });
    }
  });
});
