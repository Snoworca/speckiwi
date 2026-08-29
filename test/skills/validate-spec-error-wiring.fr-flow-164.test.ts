import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import { GATE_IDS } from "../../src/core/orchestrator/auto-gate.js";
import { parseWorkspace } from "../../src/core/parser/workspace-parser.js";
import { REPO_ROOT, criticalGateRows, criticalGatesSection, isTableRowLine, stripFrontmatter } from "./kiwi-orchestrator-variants.js";
import { MIRROR_EXCLUDED, RENDERINGS, readRepoFile, skillDirs } from "./kiwi-renderings.js";

// @req FR-FLOW-164 — the gate that stops on a validation error, declared by the chain that promotes.
//
// The audit measured one skill stopping on an SRS validation error, `kiwi-srs-sync`, and it sits
// outside the chain that implements, reviews and promotes. This file holds the other side of that:
// the seven chain skills declare the gate, and each declaring section says where the gate is
// OBSERVED — which call is run, before which hop, and that an error-severity diagnostic halts
// regardless of `--auto`. A row without that sentence is an identifier with nothing behind it, and
// `kiwi-orchestrator` §0.G already states that such a row is worse than an omission.
//
// WHAT THIS FILE DOES NOT HOLD, stated so it is not read into the green:
//  - It reads instruction text. A skill that carries the row and the sentence and an agent that
//    ignores both are not distinguished here; no assertion observes a run.
//  - The retraction reader is a SCAN over a closed vocabulary, not a verdict on wording. A
//    paraphrase that avoids every listed phrase passes it, and a cancellation placed one section
//    away from the declaring section is not reached at all.
//  - The polarity reader (AC-9) is a scan of the same kind, and it is what keeps the four tokens of
//    AC-3 from being satisfied by the sentence's own negation. It holds two phrases the observation
//    sentence itself must carry and ten inversions no BLOCK of the declaring section may carry, so
//    an inversion is caught by dropping the survival phrase or by spelling one of the ten inside a
//    block. Two KINDS pass. An inversion worded outside both lists that leaves the survival phrase
//    standing — negating it (덮지 못한다고 볼 수는 없다) or written beside it — and where it lands
//    decides what else reports it: on the sentence's own line the byte golden does, and a person
//    can refresh the golden; on a neighbouring line of the section nothing reports it at all. And a
//    listed phrase FOLDED ACROSS A BLOCK BOUNDARY: the blocks are markdown's own, so a fold over a
//    blank line, over a table row or a heading, or over one of a blockquote's own breaks — a
//    `>`-only line, a nesting change, a quote opening under prose — is carried by no block and is
//    reported by nothing, measured 20 passed at each. A renderer splits at each of those but one:
//    a nesting change that DEDENTS to a shallower `>` is a lazy continuation it JOINS, so that
//    fold alone is a MISS rather than a boundary the reader is shown — measured, unreachable in
//    these 27 sections, and recorded in AC-8, VE-6 Q8 and VE-7. A fold inside one paragraph or
//    inside one quote is caught, which is the case the tree can reach.
//  - The location-anchor check proves the cell names a token the body uses somewhere else. It does
//    NOT prove that the hop it names is the hop where the validation would actually be observed;
//    no artifact in the tree decides that.
//  - `GATE_IDS` membership is asserted, but nothing in the phase-1 kernel emits this identifier at
//    exit 2. It sits beside the three taken from `auto-option.md` on the same FOOTING — declared by
//    skills rather than raised by the kernel — but not on the same provenance: §5.1's catalogue
//    does not list it, and `kiwi-srs-sync`'s own table is where it comes from.

const SELF_PATH = fileURLToPath(import.meta.url);
const REQUIREMENT_ID = "FR-FLOW-164";
const SRS_PATH = path.join("docs", "spec", "60.workflow-release.srs.md");
const GOLDEN_PATH = "test/skills/validate-spec-error-wiring.fr-flow-164.golden.md";
const SEPARATOR = "\n\n=== declaration site ===\n\n";

/**
 * The clause of AC-3 that names the four tokens the observation sentence must carry.
 *
 * Anchored on the labels rather than on backticks alone, because AC-3 backticks eleven other things
 * — the seven location anchors among them — and a rule that swept them all would hand this file a
 * vocabulary it never asked for. Measured before the tokens were derived: they were literals here,
 * and loosening `speckiwi validate` to `speckiwi` and `--auto` to `-` left the suite at 14 passed
 * with nothing in the requirement recording that the check had been widened. @req FR-FLOW-164 AC-3
 */
const OBSERVATION_CLAUSE =
  /naming the MCP tool `([^`]+)`, the CLI fallback `([^`]+)`, the identifier `([^`]+)` and `([^`]+)`/;

/** The declaration AC-7 requires to stay nullary, matched against this file's own source. */
const NULLARY_WIRING = /function goldenDrift\(\): string\[\] \{/;

/** The four tokens AC-3 requires of the observation sentence, in the order AC-3 names them. */
interface ObservationTokens {
  readonly mcpCall: string;
  readonly cliCall: string;
  readonly gateId: string;
  readonly autoFlag: string;
}

/**
 * The bounds this suite runs under, read out of the requirement rather than typed here.
 *
 * Which skills are swept, how many sites are expected, which tokens the observation sentence must
 * carry and how many phrases the retraction vocabulary holds are the values that decide this
 * suite's REACH, and a literal reach cannot be defended by the check it bounds — lower it and the
 * sweep shrinks while every assertion stays green. FR-MCP-060 moved its floors into its requirement
 * for that reason and this follows it: narrowing the sweep is now a requirement diff.
 */
interface RequirementFacts {
  /** The seven chain skills, in the order the Requirement names them. */
  readonly skills: string[];
  /** The gate identifier under test, derived rather than restated. */
  readonly gateId: string;
  /** The floors AC-2, AC-6, AC-7 and AC-9 name, under the keys this file consumes them by. */
  readonly floors: Map<string, number>;
  /** Every criterion the requirement declares, in declaration order. */
  readonly criteria: string[];
  /** The tokens AC-3 requires, read out of AC-3's own sentence. */
  readonly observation: ObservationTokens;
  /** The criteria AC-7 names as owing no `it` block. */
  readonly blockExempt: string[];
  /** The declaration sites AC-1 names as outside the heading rule's reach. */
  readonly unreachable: string[];
}

/**
 * Reads the bounds out of `FR-FLOW-164` with the parser the tool itself reads requirements with, so
 * a requirement this suite could not parse is a failure here rather than a silently empty roster.
 *
 * The skills are the backticked `kiwi-*` tokens of the Requirement statement. The gate identifier is
 * the single backticked lower-kebab token that is NOT one of them — derived this way rather than
 * from `GATE_IDS`, because the union is what AC-4 asserts and a derivation that read it would make
 * that assertion answer itself.
 */
async function loadRequirementFacts(): Promise<RequirementFacts> {
  const workspace = await parseWorkspace({ root: REPO_ROOT });
  const record = workspace.records.find((item) => item.id === REQUIREMENT_ID);
  if (!record) throw new Error(`${SRS_PATH}: ${REQUIREMENT_ID} is not there, so this suite has no bounds to run under`);
  const statement = record.requirement ?? "";
  if (statement.length === 0) throw new Error(`${REQUIREMENT_ID} carries no Requirement statement, and this suite reads its subjects out of it`);

  const backticked = [...statement.matchAll(/`([a-z][a-z0-9-]*)`/g)].map((match) => match[1] as string).filter((token) => token.includes("-"));
  const skills = [...new Set(backticked.filter((token) => token.startsWith("kiwi-")))];
  const others = [...new Set(backticked.filter((token) => !token.startsWith("kiwi-")))];
  if (others.length !== 1) {
    throw new Error(`${REQUIREMENT_ID}: the statement must name exactly one gate identifier, found ${others.length} — ${others.join(", ")}`);
  }

  const acText = (id: string): string => {
    const criterion = record.acceptanceCriteria.find((item) => item.id === id);
    if (!criterion) throw new Error(`${REQUIREMENT_ID} declares no ${id}, and this suite reads bounds out of it`);
    return criterion.text;
  };
  const floors = new Map<string, number>(
    ["AC-2", "AC-6", "AC-7", "AC-9"].flatMap((id) =>
      [...acText(id).matchAll(/`([a-z]+) (\d+)`/g)].map((match) => [match[1] as string, Number(match[2])] as [string, number])
    )
  );

  const clause = OBSERVATION_CLAUSE.exec(acText("AC-3"));
  if (!clause) {
    throw new Error(`${REQUIREMENT_ID} AC-3 no longer names the MCP call, the CLI fallback, the identifier and the flag in one clause, so this suite has nothing to hold the observation sentence to`);
  }
  const observation: ObservationTokens = {
    mcpCall: clause[1] as string,
    cliCall: clause[2] as string,
    gateId: clause[3] as string,
    autoFlag: clause[4] as string
  };
  const blockExempt = [...new Set([...acText("AC-7").matchAll(/`(AC-\d+)`/g)].map((match) => match[1] as string))];
  // The sites AC-1 exempts, as backticked paths. Anchored on the path shape rather than on every
  // backtick, because AC-1 also backticks the helper names, the old rule and five skill names.
  const unreachable = [...new Set([...acText("AC-1").matchAll(/`((?:skills|\.agents)\/[^`]*SKILL\.md)`/g)].map((match) => match[1] as string))];

  return { skills, gateId: others[0] as string, floors, criteria: record.acceptanceCriteria.map((item) => item.id), observation, blockExempt, unreachable };
}

let requirementFacts: RequirementFacts | undefined;

/**
 * Whatever the setup could not finish, held here and re-thrown from its first reader inside a test.
 *
 * A hook that throws leaves vitest reporting every test in the file as skipped rather than failed,
 * and a reader scanning counts sees no red in that. Carrying the failure to the test that needed it
 * turns it back into a failing assertion naming what was missing.
 */
let factsFailure: unknown;

beforeAll(async () => {
  try {
    requirementFacts = await loadRequirementFacts();
  } catch (error) {
    factsFailure = error;
  }
});

function facts(): RequirementFacts {
  if (factsFailure !== undefined) throw factsFailure;
  if (!requirementFacts) throw new Error(`${REQUIREMENT_ID} was never read, so nothing bounds this assertion`);
  return requirementFacts;
}

/** One floor, by the key the requirement names it under. Absent means it stopped bounding it. */
function floor(name: string): number {
  const value = facts().floors.get(name);
  if (value === undefined) throw new Error(`${REQUIREMENT_ID} names no floor \`${name}\`, so this assertion has no bound to hold to`);
  return value;
}

interface Site {
  readonly skill: string;
  readonly rendering: string;
  readonly relPath: string;
  /** Frontmatter stripped, so line offsets are the body's own. */
  readonly body: string;
  /** The declaring section: the heading that names `critical_gates`, up to the next heading. */
  readonly section: string;
}

/** Every (skill, rendering) pair that ships, read from disk rather than listed. */
function sites(): Site[] {
  const out: Site[] = [];
  for (const skill of facts().skills) {
    for (const rendering of RENDERINGS) {
      if (!skillDirs(rendering).includes(skill)) continue;
      const relPath = `${rendering}/${skill}/SKILL.md`;
      const body = stripFrontmatter(readRepoFile(relPath));
      out.push({ skill, rendering, relPath, body, section: criticalGatesSection(body) });
    }
  }
  return out;
}

/**
 * Every shipped kiwi `SKILL.md`, not just the chain's — the corpus AC-1's exemption is measured over.
 *
 * `sites()` sweeps the seven the Requirement names, so nothing there can see a declaration the
 * heading rule fails to reach in an eighth skill. This one is wider on purpose: it is what makes the
 * exemption a set equality rather than a list of three names nothing checks.
 */
function allSkillPaths(): string[] {
  return RENDERINGS.flatMap((rendering) => skillDirs(rendering).map((skill) => `${rendering}/${skill}/SKILL.md`));
}

/** The `validate-spec-error` row of one site's table, or null when the site does not declare it. */
function declaredRow(site: Site): { gateId: string; reason: string; location: string; width: number } | null {
  return criticalGateRows(site.body).find((row) => row.gateId === facts().gateId) ?? null;
}

/**
 * The PROSE lines of a site's declaring section that name the MCP validation call.
 *
 * Table rows are excluded on purpose. The row's own reason cell names the call — that is what makes
 * the row readable — and counting it here would let the sentence be deleted while the count stayed
 * at one. What AC-3 asks for is a statement outside the table saying when to run it.
 */
function observationLines(site: Site): string[] {
  const mcpCall = facts().observation.mcpCall;
  return site.section.split("\n").filter((line) => line.includes(mcpCall) && !line.trim().startsWith("|"));
}

/** Backticked tokens of a cell, which is how a `location` names a place rather than describing one. */
function backtickedTokens(cell: string): string[] {
  return [...cell.matchAll(/`([^`]+)`/g)].map((match) => match[1] as string);
}

/** The body outside the declaring section, where a location anchor has to resolve. */
function outsideSection(site: Site): string {
  const index = site.body.indexOf(site.section);
  if (index === -1 || site.section.length === 0) return site.body;
  return site.body.slice(0, index) + site.body.slice(index + site.section.length);
}

/** One phrase of the retraction vocabulary, carrying the sample that only it catches. */
interface RetractionTerm {
  /** Matched as a literal substring of one line, which is what makes the sample attributable. */
  readonly phrase: string;
  /** A cancellation this phrase catches and no other does, so removing the phrase is red. */
  readonly sample: string;
}

/**
 * Phrases that cancel a rule while leaving every word of it standing (AC-6).
 *
 * Assembled from the retractions this repository has actually measured rather than invented:
 * FR-FLOW-161 recorded `참고 지표일 뿐이며 강제하지 않는다` and `낡은 규칙은 폐기한다`, FR-FLOW-162
 * recorded `위 규칙은 이번 판에서 폐기한다`, and FR-FLOW-163 carries a list of the same shape for a
 * different subject. That list is not imported: it guards one encoding rule over a site's section,
 * this one guards a gate declaration, and a shared list would have to be widened for either subject
 * at the other's cost. The English half is here because two of the seven skills declare this gate in
 * English renderings — `kiwi-review-fix-loop` and `kiwi-tdd`, each in codex, etc and the mirror — and
 * a vocabulary that reads only Korean would leave those six sites uncovered. Counted over the
 * entries of THIS array, which is the number AC-6 holds as `retractions 19`: 11 Korean phrases and
 * 8 English ones, 19 in all. The corpus it is scanned over is a different number — 21 Korean sites
 * and 6 English ones, 27 in all — and the two are not to be read for each other.
 *
 * Each phrase carries its own sample because the vocabulary used to be one regex probed only as a
 * whole, and that probe fails only when the vocabulary dies entirely. Measured: deleting the
 * alternative `참고 사항` left the suite at 14 passed while the cancellation form it caught stood
 * open. The two `더 이상 …` phrases are written out separately for the same reason — as one
 * alternation they shared a single sample, and either half could be dropped behind it.
 *
 * A closed vocabulary closes spellings, not the subject. What bounds this one is that it is a SCAN
 * and not a verdict on wording: a paraphrase evades it, and AC-8 states that residual.
 */
const RETRACTION_TERMS: readonly RetractionTerm[] = [
  { phrase: "폐기", sample: "위 게이트 선언은 이번 판에서 폐기한다." },
  { phrase: "강제되지 않는다", sample: "이 표의 행은 강제되지 않는다." },
  { phrase: "강제하지 않는다", sample: "이 문단은 어떤 홉도 강제하지 않는다." },
  { phrase: "참고 사항", sample: "위 선언은 참고 사항으로 남긴다." },
  { phrase: "참고 지표", sample: "이 수치는 참고 지표로만 읽는다." },
  { phrase: "적용하지 않는다", sample: "이 절은 이번 판에 적용하지 않는다." },
  { phrase: "구속력", sample: "이 표에는 구속력이 없다." },
  { phrase: "권고일 뿐", sample: "이 규칙은 권고일 뿐이다." },
  { phrase: "더 이상 유효하지 않", sample: "위 규칙은 더 이상 유효하지 않다." },
  { phrase: "더 이상 적용하지 않", sample: "위 규칙은 더 이상 적용하지 않으므로 넘어간다." },
  { phrase: "건너뛴다", sample: "이 게이트는 건너뛴다." },
  { phrase: "is advisory", sample: "The row above is advisory." },
  { phrase: "non-binding", sample: "This declaration is non-binding." },
  { phrase: "not enforced", sample: "The halt is not enforced here." },
  { phrase: "may be skipped", sample: "This gate may be skipped." },
  { phrase: "does not apply", sample: "The clause above does not apply to the mirror." },
  { phrase: "no longer applies", sample: "The paragraph above no longer applies." },
  { phrase: "for reference only", sample: "The table is for reference only." },
  { phrase: "is superseded", sample: "The rule above is superseded." }
];

const RETRACTION_PHRASES: readonly string[] = RETRACTION_TERMS.map((term) => term.phrase);

/**
 * The phrases in which the 27 shipped sentences say the halt survives `--auto` (AC-9).
 *
 * READ OFF the shipped text rather than invented: `덮지 못한다` is what the 21 Korean sites say and
 * `does not lift` is what the 6 English ones say. Nothing else is admitted, because a vocabulary
 * wider than the corpus admits wordings nobody has written and stops bounding the ones that exist.
 *
 * REQUIRED OF THE OBSERVATION SENTENCE ALONE, unlike `POLARITY_OVERRIDES`. The block that reads the
 * two carries why their spans differ; changing either span without that reason is a hole.
 */
const POLARITY_SURVIVES: readonly string[] = ["덮지 못한다", "does not lift"];

/**
 * The inversions no BLOCK of the declaring section may carry (AC-9), one entry per phrase with a sample.
 *
 * AC-3 reads four tokens for PRESENCE, and `--auto` 도 이 중단을 덮지 못한다 turned into 덮는다 leaves
 * every one of them standing. The golden would report it, but the golden is a file a person can
 * refresh from `.actual`. These phrases say the opposite thing, so the check fails from both sides:
 * the survival phrase goes missing AND an override phrase appears.
 *
 * Carried one entry per phrase in the shape `RETRACTION_TERMS` established, so deleting an entry is
 * red at the sample only that entry catches rather than a silent narrowing. A closed vocabulary
 * closes spellings, not the subject: an inversion worded outside both lists passes wherever it
 * leaves the survival phrase standing. AC-8 records the two WORDINGS that takes — the fold below is
 * its third residual and a different kind — and AC-9 what is left reporting each, attributed apart
 * because they are not the same sentence in the requirement.
 *
 * SCANNED OVER THE WHOLE DECLARING SECTION, BLOCK BY BLOCK, unlike `POLARITY_SURVIVES`. A spelling
 * is closed only within one block: the same phrase folded across a blank line, a table row, a
 * heading or one of a quote's own breaks is carried by neither side of the fold and passes, which
 * AC-8 records as a residual. A fold inside one paragraph or one quote is caught. The block that
 * reads the two carries why their spans differ; changing either span without that reason is a hole.
 */
const POLARITY_OVERRIDES: readonly RetractionTerm[] = [
  { phrase: "덮는다", sample: "`--auto` 가 이 중단을 덮는다." },
  { phrase: "덮을 수 있다", sample: "`--auto` 로 이 중단을 덮을 수 있다." },
  { phrase: "무시하고 진행", sample: "error 급 진단을 무시하고 진행한다." },
  { phrase: "생략할 수 있다", sample: "`--auto` 에서는 이 홉을 생략할 수 있다." },
  { phrase: "자동으로 통과", sample: "`--auto` 이면 자동으로 통과시킨다." },
  { phrase: "does lift", sample: "the halt, which `--auto` does lift." },
  { phrase: "lifts", sample: "`--auto` lifts the halt at this hop." },
  { phrase: "may be overridden", sample: "This halt may be overridden under `--auto`." },
  { phrase: "can proceed", sample: "Under `--auto` the run can proceed past it." },
  { phrase: "is waived", sample: "The halt is waived when `--auto` is set." }
];

const POLARITY_OVERRIDE_PHRASES: readonly string[] = POLARITY_OVERRIDES.map((term) => term.phrase);

/**
 * Every phrase of `phrases` this text carries.
 *
 * Both arguments are required. A defaulted vocabulary would be an injection point of exactly the
 * shape this file removed from its golden comparison, and the per-phrase probe below needs to pass
 * a subset explicitly anyway.
 */
function retractionHits(text: string, phrases: readonly string[]): string[] {
  return phrases.filter((phrase) => text.includes(phrase));
}

/** One markdown block of a declaring section, which is the unit both section scans read. */
interface ScanUnit {
  /** The block's lines joined by single spaces, which is the sentence a reader is handed. */
  readonly text: string;
  /** 1-based within the section, so a report names the block rather than a fold inside it. */
  readonly startLine: number;
  readonly endLine: number;
}

/**
 * A section's blocks, with the soft line breaks inside each paragraph joined the way a renderer
 * joins them.
 *
 * Scanning raw lines let a forbidden phrase pass by being FOLDED across a line break: no line
 * carried it, while the rendered paragraph read as one sentence. That was reachable in the tree as
 * it ships rather than only in principle — three sections already wrap prose mid-sentence
 * (`skills/codex/kiwi-tdd`, `skills/etc/kiwi-tdd` and its `.agents` mirror) — and `may be
 * overridden` folded across two lines of that paragraph was measured at 20 passed.
 *
 * Flattening the WHOLE SECTION instead is the accident FR-FLOW-160 recorded: with the newline
 * boundaries gone the only boundary left was a table delimiter, and a pattern then reached across
 * 2,496 characters into an unrelated clause. A blank line is the boundary markdown itself uses, so
 * joining only within one block closes the fold and keeps every boundary a reader can see.
 *
 * A TABLE ROW is its own unit, and so is a heading — inside a quote as much as outside one, which
 * is why both are read after the quote marker is stripped rather than off the raw line. Joining
 * consecutive rows would put the 571 table lines these 27 sections carry into one blob per section,
 * which is FR-FLOW-160's shape again with cell walls for the boundaries it erased. A row is
 * `isTableRowLine`, the predicate `tableRows` reads by, and the two share it rather than each
 * holding a copy: they had diverged, and reading the leading `|` alone made a boundary out of a
 * line a renderer wraps into the prose below it — `| a | may be` continued by `overridden here`
 * rendered as one paragraph and was missed, and is caught now.
 *
 * A BLOCKQUOTE repeats its `>` on every line it wraps onto, so joining those lines raw left the
 * marker standing mid-string and the phrase still did not reassemble — the fold passed while the
 * renderer showed one paragraph. The marker is therefore stripped from each quoted line before the
 * join, and the quote is made a boundary where a quote STARTS after unquoted text, where a `>`-only
 * line blanks it, and where the NESTING DEPTH changes. These were rendered and counted rather than
 * reasoned about, and counting is what found the one place the boundary is NOT the renderer's: a
 * line DEDENTING to a shallower `>` is markdown's lazy continuation, so `>> one may be` above
 * `> overridden here` renders as a single paragraph while this closes between them and MISSES the
 * fold. Deepening is the opposite — a renderer opens a nested quote there — so no single rule
 * over `!==` serves both, and the miss was kept over the false alarm the other choice makes. It is
 * unreachable in a tree whose seven quote lines are all single-line and unnested, and AC-8, VE-6 Q8
 * and VE-7 record it. A LIST marker needs none of this and gets none: it is not repeated on a
 * wrapped line, so a wrapped item already joins while two items keep the `-` between them, which is
 * the split the renderer draws there.
 */
function scanUnits(section: string): ScanUnit[] {
  const units: ScanUnit[] = [];
  const lines = section.split("\n");
  let parts: string[] = [];
  let startLine = 0;
  // 0 outside a quote, otherwise how many `>` the open block's lines carry. A different depth is a
  // different blockquote, which is why a change in it closes the block rather than joining to it.
  let quoteDepth = 0;
  const close = (endLine: number): void => {
    if (parts.length > 0) units.push({ text: parts.join(" "), startLine, endLine });
    parts = [];
    quoteDepth = 0;
  };
  const open = (index: number, text: string): void => {
    if (parts.length === 0) startLine = index + 1;
    parts.push(text);
  };
  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = (lines[index] as string).trim();
    if (trimmed === "") {
      close(index);
      continue;
    }
    let content = trimmed;
    const quoted = /^(>+)\s?(.*)$/.exec(trimmed);
    if (quoted !== null) {
      const depth = (quoted[1] as string).length;
      content = (quoted[2] as string).trim();
      // A quote opening, a nesting change and a marker-only line each start a new paragraph in the
      // rendered output; only a line continuing the same depth is a soft wrap inside one.
      if (content === "" || depth !== quoteDepth) close(index);
      if (content === "") continue;
      quoteDepth = depth;
    }
    // Read AFTER the marker is off, because `> ## x` is a heading in the rendered output and this
    // check run over the raw line could not see it: the heading fell through to the quote branch,
    // lost its marker and joined the quoted line beneath it, which is a block a renderer never
    // draws. An unquoted line here is either prose or markdown's lazy continuation of an open
    // quote, which renders inside that same paragraph and so joins on the footing every soft wrap
    // has.
    if (isTableRowLine(content) || /^#{1,6}\s/.test(content)) {
      close(index);
      units.push({ text: content, startLine: index + 1, endLine: index + 1 });
      continue;
    }
    open(index, content);
  }
  close(lines.length);
  return units;
}

/** Where a block sits, so a failure names a place in the file rather than a joined string. */
function unitAt(unit: ScanUnit): string {
  return unit.startLine === unit.endLine ? `section line ${unit.startLine}` : `section lines ${unit.startLine}-${unit.endLine}`;
}

/** The sites whose declaring section also carries a sentence cancelling the rule (AC-6). */
function retractions(candidates: readonly Site[]): string[] {
  const found: string[] = [];
  for (const site of candidates) {
    for (const unit of scanUnits(site.section)) {
      // The phrases are named, not just the block: a joined paragraph can be long, and a report
      // that only quoted its first 110 characters would often not contain what it matched on.
      const hits = retractionHits(unit.text, RETRACTION_PHRASES);
      if (hits.length === 0) continue;
      found.push(`${site.relPath} (${unitAt(unit)}): cancels the declaration beside it — \`${hits.join("`, `")}\` in ${unit.text.slice(0, 110)}`);
    }
  }
  return found;
}

/** What the golden must hold: the row line and the observation line of every site. */
function renderSites(): string {
  return sites()
    .map((site) => {
      const row = site.section
        .split("\n")
        .map((line) => line.trim())
        .find((line) => line.startsWith("|") && line.includes(facts().gateId));
      return `${site.relPath}\n---\n${row ?? "(no row)"}\n${observationLines(site)[0]?.trim() ?? "(no observation sentence)"}`;
    })
    .join(SEPARATOR);
}

/**
 * Why the shipped lines and the golden disagree, empty when they are byte-identical (AC-6).
 *
 * Pure: both sides arrive as values, so this decides nothing about where either came from and the
 * probes below can hand it samples whose verdict is already known. Which values the shipped run
 * compares is `goldenDrift`'s to settle, and it takes no argument.
 */
function goldenViolations(actual: string, golden: string): string[] {
  if (golden.length === 0) {
    return [`${GOLDEN_PATH} is missing or empty, so this comparison would be vacuous. The observed lines are in ${GOLDEN_PATH}.actual — read them, then copy the file into place.`];
  }
  if (actual === golden) return [];
  return [`${GOLDEN_PATH} no longer matches the tree. Read the diff: a changed hop, a dropped clause or a sentence retracting the rule is a finding, not a golden to refresh.`];
}

/**
 * The shipped lines against the checked-in golden. Nullary, and AC-7 holds it that way by source.
 *
 * Measured with the golden's reader as a defaulted parameter: `goldenDrift(() => renderSites())` at
 * the call site made both sides the same value, and the suite stayed at 14 passed while the golden
 * on disk carried an extra byte. AC-7 had claimed that could not be done, and its probe beside it
 * asserted that the self-comparison reported nothing — recording the hole rather than closing it.
 * With no parameter there is nothing to hand it: both sides are settled here.
 */
function goldenDrift(): string[] {
  return goldenViolations(renderSites(), readRepoFile(GOLDEN_PATH));
}

describe("FR-FLOW-164 AC-1 — the helper finds every chain skill's declaration", () => {
  it("returns a non-empty gate table for every rendering of every chain skill", () => {
    const empty = sites()
      .filter((site) => criticalGateRows(site.body).length === 0)
      .map((site) => site.relPath);
    expect(
      empty,
      "the declaration helper returned nothing for a skill that declares a `critical_gates[]` table. A test written over an empty roster reports what a clean tree reports."
    ).toEqual([]);
  });

  it("reads a corpus the requirement bounds, so a shrunken sweep is not a clean one", () => {
    const found = sites();
    expect(facts().skills.length, "chain skills named by the Requirement statement").toBe(floor("chain"));
    expect(found.length, "declaration sites swept").toBe(floor("sites"));
    const expected = facts().skills.flatMap((skill) => RENDERINGS.filter((rendering) => skillDirs(rendering).includes(skill)).map((rendering) => `${rendering}/${skill}/SKILL.md`));
    expect(found.map((site) => site.relPath).sort(), "the swept paths are the ones the tree carries").toEqual(expected.sort());
  });

  it("keeps each skill's declared gate set identical across the renderings that ship it", () => {
    const divergent: string[] = [];
    for (const skill of facts().skills) {
      const perRendering = sites()
        .filter((site) => site.skill === skill)
        .map((site) => ({ relPath: site.relPath, ids: [...criticalGateRows(site.body).map((row) => row.gateId)].sort().join(",") }));
      const first = perRendering[0];
      if (!first) continue;
      for (const entry of perRendering.slice(1)) {
        if (entry.ids !== first.ids) divergent.push(`${entry.relPath} declares a different gate set from ${first.relPath}`);
      }
    }
    expect(divergent, "a row added to one rendering and not the others is a divergence, and a count would not report it").toEqual([]);
  });

  it("reaches every declaration in the tree except the three AC-1 names", () => {
    // A SET EQUALITY, not a subset. AC-1 states a limit — three sites whose declaring heading omits
    // the token, a shape `auto-option.md` §5.0.1 allows — and a sentence stating a limit is worth
    // what checks it. Equality answers both directions: a fourth unreachable site fails, and one of
    // the three becoming reachable fails too, so the sentence cannot outlive the tree it describes.
    const named = [...facts().unreachable].sort();
    const swept = allSkillPaths();
    expect(
      swept.length,
      "the exemption is measured over every shipped kiwi skill, not the seven; a sweep no wider than the chain could never see the sites AC-1 names"
    ).toBeGreaterThan(sites().length);
    const unreached = swept
      .map((relPath) => ({ relPath, body: stripFrontmatter(readRepoFile(relPath)) }))
      .filter((file) => file.body.includes("critical_gates") && criticalGateRows(file.body).length === 0)
      .map((file) => file.relPath)
      .sort();
    expect(
      unreached,
      "the declarations the heading rule cannot see are no longer the ones AC-1 names. Either a fourth site slipped out of the helper's reach, or one of the three moved into it and the requirement still claims otherwise."
    ).toEqual(named);
  });
});

describe("FR-FLOW-164 AC-2 — the seven declare the gate", () => {
  it("declares the gate in every rendering it ships, with a reason and a location", () => {
    const offenders: string[] = [];
    for (const site of sites()) {
      const row = declaredRow(site);
      if (!row) {
        offenders.push(`${site.relPath} does not declare \`${facts().gateId}\``);
        continue;
      }
      if (row.width !== 3) offenders.push(`${site.relPath}: the row is ${row.width} columns wide, not three`);
      if (row.reason.trim().length === 0) offenders.push(`${site.relPath}: the row carries no reason`);
      if (row.location.trim().length === 0) offenders.push(`${site.relPath}: the row carries no location`);
    }
    expect(
      offenders.sort(),
      "an SRS carrying error-severity diagnostics does not stop a skill that has not declared the gate: under `--auto` the undeclared stop falls to `business-decision` and a committee approves it."
    ).toEqual([]);
  });
});

describe("FR-FLOW-164 AC-3 — the declaring section says where the gate is observed", () => {
  it("takes the four tokens from the requirement rather than from a literal this file could loosen", () => {
    const { mcpCall, cliCall, gateId, autoFlag } = facts().observation;
    const tokens = [mcpCall, cliCall, gateId, autoFlag];
    expect(
      tokens.filter((token) => token.trim().length > 0),
      "AC-3 must name four non-empty tokens; an empty one is a presence check every sentence satisfies"
    ).toHaveLength(4);
    expect(new Set(tokens).size, "four distinct tokens, or one of the checks below repeats another and one token goes unread").toBe(4);
    expect(
      gateId,
      "AC-3's identifier and the one AC-2 derives from the Requirement statement must be the same gate, or the two derivations are describing different things"
    ).toBe(facts().gateId);
  });

  it("names the call, the fallback, the identifier and the flag the halt survives", () => {
    const { mcpCall, cliCall, gateId, autoFlag } = facts().observation;
    const offenders: string[] = [];
    for (const site of sites()) {
      const lines = observationLines(site);
      if (lines.length !== 1) {
        offenders.push(`${site.relPath}: ${lines.length} lines name \`${mcpCall}\`, and this suite reads exactly one`);
        continue;
      }
      const sentence = lines[0] as string;
      for (const token of [cliCall, gateId, autoFlag]) {
        if (!sentence.includes(token)) offenders.push(`${site.relPath}: the observation sentence does not name \`${token}\``);
      }
    }
    expect(offenders.sort(), "a declared row whose section never says what to run and when is an identifier with nothing behind it").toEqual([]);
  });

  it("gives the location cell an anchor the body resolves outside the declaration", () => {
    const offenders: string[] = [];
    for (const site of sites()) {
      const row = declaredRow(site);
      if (!row) continue; // AC-2 reports the missing row; this block would only repeat it.
      const tokens = backtickedTokens(row.location);
      if (tokens.length === 0) {
        offenders.push(`${site.relPath}: the location cell names no backticked place`);
        continue;
      }
      const rest = outsideSection(site);
      for (const token of tokens) {
        if (!rest.includes(token)) offenders.push(`${site.relPath}: the location names \`${token}\`, which the body has nowhere else`);
      }
    }
    expect(offenders.sort(), "a location invented for the table points at nothing, and a reader following it finds no hop").toEqual([]);
  });
});

describe("FR-FLOW-164 AC-4 — the identifier is in the exported union", () => {
  it("carries the gate id, so the parity assertion does not fail on correct skill text", () => {
    expect(
      GATE_IDS as readonly string[],
      "`kiwi-orchestrator-body.fr-flow-074` and `tool-signature-parity` both run `declared ⊆ GATE_IDS` over the orchestrator variants, so an id the skill must declare and the union omits is reported as the skill's fault"
    ).toContain(facts().gateId);
  });

  it("does not let membership stand in for declaration", () => {
    const declaring = sites().filter((site) => declaredRow(site) !== null).length;
    expect(declaring, "a subset relation only tightens when a skill drops its row, and the union count does not move").toBe(sites().length);
  });
});

describe("FR-FLOW-164 AC-6 — the rule cannot be cancelled from beside itself", () => {
  it("holds the row and the observation sentence byte-exact against the golden", () => {
    const drift = goldenDrift();
    if (drift.length > 0) writeFileSync(path.join(REPO_ROOT, `${GOLDEN_PATH}.actual`), renderSites(), "utf8");
    expect(drift).toEqual([]);
  });

  it("finds no sentence in a declaring section that cancels the declaration", () => {
    expect(retractions(sites()), "the golden freezes two lines, and this is the edit that goes around it: the rule left intact and cancelled from a line beside it").toEqual([]);
  });
});

describe("FR-FLOW-164 AC-7 — the suite refuses its own quiet disablement", () => {
  it("re-derives the corpus boundary from disk rather than trusting a frozen list", () => {
    expect(RENDERINGS.length, "a rendering tree that vanished would shrink every sweep in silence").toBeGreaterThan(1);
    expect([...RENDERINGS], "the mirror is swept alongside the shipped renderings").toContain(".agents/skills");
    const mirrored = facts().skills.filter((skill) => skillDirs(".agents/skills").includes(skill));
    const excluded = facts().skills.filter((skill) => MIRROR_EXCLUDED.includes(skill));
    expect(
      [...mirrored, ...excluded].sort(),
      "every chain skill is either mirrored or named in the mirror's own exclusion file; a third case means the corpus lost a file without saying so"
    ).toEqual([...facts().skills].sort());
  });

  it("owes an it block to every criterion the requirement declares, and answers no other", () => {
    // The direction runs requirement to suite. Measured with a roster this file owned: deleting the
    // whole AC-4 block and emptying that roster beside it left 12 passed and nothing failed, because
    // `[].every(...)` is true and the only surviving trace was a lower count nothing reads.
    const declared = facts().criteria;
    expect(declared.length, "criteria read out of the requirement, which is the denominator every check below divides").toBe(floor("criteria"));
    const exempt = facts().blockExempt;
    expect(exempt.length, "criteria AC-7 names as owing no block; an exemption set that can grow absorbs every deleted block").toBe(floor("exempt"));

    const source = readFileSync(SELF_PATH, "utf8");
    const titles = [...source.matchAll(/describe\(\s*"([^"]+)"/g)].map((match) => match[1] as string);
    expect(titles.length, `${SELF_PATH}: no block titles were read, so the extraction has stopped matching`).toBeGreaterThan(0);
    // The whole id, so `AC-1` is not answered by a title reading `AC-10`.
    const answered = titles
      .map((title) => /\b(AC-\d+)\b/.exec(title)?.[1])
      .filter((id): id is string => typeof id === "string");

    const missing = declared.filter((id) => !answered.includes(id) && !exempt.includes(id));
    expect(
      missing,
      "a criterion no longer has a block in this file. Whatever it checked is no longer checked, and the only other trace is a lower test count."
    ).toEqual([]);
    const unclaimed = answered.filter((id) => !declared.includes(id));
    expect(
      unclaimed,
      `a block answers a criterion ${REQUIREMENT_ID} does not declare, so either the requirement lost it or this roster was read out of the wrong document.`
    ).toEqual([]);
    const overreach = exempt.filter((id) => answered.includes(id));
    expect(
      overreach,
      "a criterion AC-7 exempts from owing a block has one, so the exemption no longer describes this file and could be widened to cover a deletion."
    ).toEqual([]);
  });

  it("reads every floor the requirement names, so an unread bound cannot outlive its assertion", () => {
    const source = readFileSync(SELF_PATH, "utf8");
    const consumed = new Set([...source.matchAll(/\bfloor\("([a-z]+)"\)/g)].map((match) => match[1] as string));
    const unread = [...facts().floors.keys()].filter((name) => !consumed.has(name));
    expect(
      unread,
      "a floor the requirement names is asserted nowhere in this file, so deleting the assertion that held it leaves the bound standing in the requirement with nothing reading it."
    ).toEqual([]);
    // Every floor above is read as an equality, so one lowered to zero fails at the comparison
    // rather than admitting the empty set; that is why there is no separate zero-floor check here.
    expect(facts().floors.size, "the requirement names no floors, and a sweep with no bound is one nothing can shrink visibly").toBeGreaterThan(0);
  });

  it("keeps the golden comparison unable to be handed the value it compares against", () => {
    const source = readFileSync(SELF_PATH, "utf8");
    expect(
      NULLARY_WIRING.test(source),
      "`goldenDrift` takes an argument again. Measured with a defaulted reader: `goldenDrift(() => renderSites())` at the call site left this suite at 14 passed while the golden on disk carried an extra byte."
    ).toBe(true);
    const sample = renderSites();
    expect(sample.length, "the derived side is empty, so the three probes below would agree over nothing").toBeGreaterThan(0);
    expect(goldenViolations(sample, ""), "an empty golden must be reported rather than treated as agreement").not.toEqual([]);
    expect(goldenViolations(sample, `${sample}\n`), "a golden that differs by one byte must be reported").not.toEqual([]);
    expect(
      goldenViolations(sample, sample),
      "identical bytes are agreement; a judge that reports drift over them reports it over every tree and says nothing about this one"
    ).toEqual([]);
    expect(
      readRepoFile(GOLDEN_PATH).length,
      "the wiring reads this file, and a golden that is not on disk makes the shipped comparison vacuous rather than red"
    ).toBeGreaterThan(0);
  });

  it("keeps every alternative of the retraction vocabulary answering for itself", () => {
    expect(RETRACTION_TERMS.length, "phrases the requirement holds this vocabulary to").toBe(floor("retractions"));
    expect(new Set(RETRACTION_PHRASES).size, "two entries carrying one phrase would let either be deleted with the other covering for it").toBe(RETRACTION_TERMS.length);
    const failures: string[] = [];
    for (const term of RETRACTION_TERMS) {
      if (retractionHits(term.sample, RETRACTION_PHRASES).length === 0) {
        failures.push(`\`${term.phrase}\` no longer catches its own sample: ${term.sample}`);
        continue;
      }
      const others = RETRACTION_PHRASES.filter((phrase) => phrase !== term.phrase);
      const covered = retractionHits(term.sample, others);
      if (covered.length > 0) {
        failures.push(`\`${term.phrase}\` is not what catches its sample — ${covered.join(", ")} does, so deleting the phrase would leave this probe green`);
      }
    }
    expect(
      failures,
      "a vocabulary probed only as a whole survives losing one alternative, and the cancellation form that alternative caught then opens with nothing reporting it."
    ).toEqual([]);
  });

  it("keeps the retraction reader answering in both directions", () => {
    const real = sites()[0];
    expect(real, "the corpus is empty, so the probe below would prove nothing").toBeDefined();
    const cancelled: Site = { ...(real as Site), section: `${(real as Site).section}\n\n다만 위 게이트 선언은 이번 판에서 폐기하며, 참고 사항일 뿐이다.` };
    expect(retractions([cancelled]).length, "a reader that has stopped matching reports nothing, which is what a clean tree reports").toBeGreaterThan(0);
    expect(retractions([real as Site]), "the unmodified site must pass, or the reader is matching its own subject").toEqual([]);
  });
});

describe("FR-FLOW-164 AC-9 — the sentence is held to its polarity and its section to no inversion", () => {
  it("says the halt survives `--auto`, and says nowhere in the declaring section that `--auto` lifts it", () => {
    const offenders: string[] = [];
    for (const site of sites()) {
      // The two sides read DIFFERENT SPANS, and the difference is the rule each one holds.
      //
      // OVERRIDES is a claim about the whole declaring SECTION, on AC-6's span rather than AC-3's,
      // because what it forbids is not confined to one line. Read against the sentence alone, the
      // inversion only had to move one line down to pass: measured, inserting
      // `--auto` 로 이 중단을 덮을 수 있다 directly beneath the observation sentence of
      // skills/claude/kiwi-planner/SKILL.md left the suite at 20 passed. It reads that section a
      // BLOCK at a time rather than a line at a time, because a phrase folded across a soft line
      // break is carried by no line while the rendered paragraph reads as one sentence: `may be
      // overridden` folded into the wrapped paragraph of skills/codex/kiwi-tdd/SKILL.md was 20
      // passed and is 1 failed / 19 here. Widening costs nothing — the ten phrases match zero of
      // the 703 blocks the 27 shipped sites carry.
      for (const unit of scanUnits(site.section)) {
        for (const phrase of retractionHits(unit.text, POLARITY_OVERRIDE_PHRASES)) {
          offenders.push(`${site.relPath} (${unitAt(unit)}): says \`${phrase}\` beside the declaration, which is the halt being lifted rather than surviving`);
        }
      }
      const lines = observationLines(site);
      // AC-3's block reports a section with no sentence, or with more than one; this one would
      // only repeat it, and a silent `continue` here is what AC-2 and AC-3 are already covering.
      // The override scan above sits outside this guard on purpose: it does not need the sentence.
      if (lines.length !== 1) continue;
      const sentence = lines[0] as string;
      // SURVIVES stays on the sentence's OWN LINE and must not be widened to match the scan above.
      // AC-3 requires THAT SENTENCE to say the halt outlives `--auto`; a search over the section,
      // or over the sentence's own block now that the scan above reads blocks, would let the
      // sentence fall silent while a neighbouring line answered for it — presence satisfied by the
      // wrong text rather than the claim the requirement makes. Measured: the phrase moved onto the
      // next line of the SAME paragraph, which a block-wide search would accept, is 2 failed / 18.
      if (!POLARITY_SURVIVES.some((phrase) => sentence.includes(phrase))) {
        offenders.push(`${site.relPath}: the observation sentence never says the halt survives \`${facts().observation.autoFlag}\``);
      }
    }
    expect(
      offenders.sort(),
      "a sentence carrying all four AC-3 tokens can still say the opposite thing; the tokens are read for presence and presence does not separate a claim from its negation"
    ).toEqual([]);
  });

  it("keeps both polarity vocabularies answering for themselves", () => {
    expect(POLARITY_SURVIVES.length, "phrases the requirement holds the survival vocabulary to").toBe(floor("survives"));
    expect(POLARITY_OVERRIDES.length, "phrases the requirement holds the override vocabulary to").toBe(floor("overrides"));
    expect(new Set(POLARITY_SURVIVES).size, "two entries carrying one phrase would let either be deleted with the other covering for it").toBe(POLARITY_SURVIVES.length);
    expect(new Set(POLARITY_OVERRIDE_PHRASES).size, "two entries carrying one phrase would let either be deleted with the other covering for it").toBe(POLARITY_OVERRIDES.length);

    const observed = sites().map((site) => observationLines(site)[0] ?? "");
    const dead = POLARITY_SURVIVES.filter((phrase) => !observed.some((sentence) => sentence.includes(phrase)));
    expect(
      dead,
      "a survival phrase no shipped sentence carries is padding: the disjunction stays satisfiable through the others, so the phrase bounds nothing"
    ).toEqual([]);

    const failures: string[] = [];
    for (const term of POLARITY_OVERRIDES) {
      if (!term.sample.includes(term.phrase)) {
        failures.push(`\`${term.phrase}\` no longer catches its own sample: ${term.sample}`);
        continue;
      }
      const covered = POLARITY_OVERRIDE_PHRASES.filter((phrase) => phrase !== term.phrase && term.sample.includes(phrase));
      if (covered.length > 0) {
        failures.push(`\`${term.phrase}\` is not what catches its sample — ${covered.join(", ")} does, so deleting the phrase would leave this probe green`);
      }
      const survives = POLARITY_SURVIVES.filter((phrase) => term.sample.includes(phrase));
      if (survives.length > 0) {
        failures.push(`the sample for \`${term.phrase}\` also reads as survival through ${survives.join(", ")}, so it does not isolate an inversion`);
      }
    }
    expect(
      failures,
      "a vocabulary probed only as a whole survives losing one alternative, and the inversion that alternative caught then passes with nothing reporting it"
    ).toEqual([]);
  });
});
