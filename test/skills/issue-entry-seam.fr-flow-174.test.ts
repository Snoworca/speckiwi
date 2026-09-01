import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { REPO_ROOT, section } from "./kiwi-orchestrator-variants.js";
import { MIRROR_EXCLUDED, RENDERINGS, flat, markdownFiles, readRepoFile, scanUnits, skillDirs, unitAt } from "./kiwi-renderings.js";

// @req FR-FLOW-174 AC-1 — the acquisition command, and the one `--json` field list the whole tree uses.
// @req FR-FLOW-174 AC-3 · AC-4 · AC-5 · AC-6 · AC-7 — the five seam sites, each read where it lives.
// @req FR-FLOW-174 AC-8 — the denominator is the requirement's own seam table, with floors under it.
// @req FR-FLOW-174 AC-9 — a retraction added to a seam section reddens the same check the deletion does.
//
// ─── BASELINE, MEASURED BEFORE ANY SKILL TEXT WAS TOUCHED ───────────────────────────────────────
// At 0bad28a, over the shipped trees, counted with Node rather than with `grep` (Git Bash `grep -i`
// returns a silent 0 on these files):
//
//   kiwi-srs/SKILL.md            "이슈|issue"          0 in all four copies
//   kiwi-srs-research/SKILL.md   "gh issue"            0 in all four copies
//   kiwi-wave-master/SKILL.md    "gh issue|gh api"     0 in all three copies (the mirror excludes it)
//   kiwi-pipeline/SKILL.md       "gh issue view"       0 in all four copies
//   skills/** + .agents/skills/**  "githubIssue"       0
//
// The only `gh issue view` spellings in the tree were `kiwi-hot-fix` (one with `--json
// title,body,comments`, one prose row) and two prose mentions in `kiwi-orchestrator`. So every
// literal this file requires below was at 0 when it was written, and `intake-issue` was the one
// token already present — twice per orchestrator copy, in the verb index and in the source
// classification, neither of which named an artifact.
//
// ─── WHAT THIS FILE GUARANTEES ──────────────────────────────────────────────────────────────────
// (1) A DENOMINATOR THAT CANNOT QUIETLY EMPTY. The seam table is read out of FR-FLOW-174's own
// Implementation Notes, one bullet per seam, and the row count, the site set, the literal total and
// the registered check count each carry a floor read out of a second note. A row deleted from the
// table takes the floor with it only if both notes are edited, and the site set is held equal to
// the five sites the requirement names — so a seam dropped from the table is an unclassified site
// rather than a smaller sweep that passes for the same reason a clean one does.
//
// (2) A FILE RESOLVED BY READING, NOT BY LISTING. A seam names a skill and a heading; the reader
// takes every markdown file that skill ships in that rendering and requires EXACTLY ONE to carry
// the heading. That is what lets one row cover `kiwi-srs`, whose §9.2 lives in `SKILL.md` under
// `skills/claude` and in `references/extended-workflow.md` under the other three — a listed path
// would have been wrong for three of the four copies, and a path list would go stale the next time
// the codex renderings re-split.
//
// (3) EACH COPY READ SEPARATELY. Every per-copy check is paired with a read ledger: the block title
// says which rendering it is for, `bodyOf` records the path it was actually handed, and the digest
// of the bytes returned is compared against an independent read of the rendering the block is named
// for. Replacing the argument with a fixed one — `bodyOf(RENDERINGS[0], seam)` at every call site —
// is what that ledger exists to redden, because `skills/claude` satisfies every assertion the
// blocks make.
//
// (4) POLARITY, NOT ONLY PRESENCE. Each seam section is scanned block-wise for a closed retraction
// vocabulary, so a sentence added BESIDE the seam saying the command may be skipped reddens the
// same check the deletion does.
//
// ─── WHAT THIS FILE DOES NOT GUARANTEE ──────────────────────────────────────────────────────────
// That an agent follows any of this. Nothing here observes a run. A run whose agent read the
// instruction and put the issue body into `REQ_TEXT` anyway completes normally and this file stays
// green.
//
// That a retraction is caught. The polarity scan is AUXILIARY and reads a closed nine-phrase
// vocabulary as bare substrings, so a paraphrase avoiding all nine passes — measured, three of
// them: `이 명령은 필수가 아니라 권장 사항이다.` · `이슈 본문을 이미 확보했다면 위 명령을 실행할
// 필요가 없다.` · `위 인자 형식은 참고용이며 각 실행이 알아서 정한다.` The floor on the
// vocabulary's length keeps it from shrinking; nothing keeps it from being complete, and AC-9 says
// so rather than claiming the general case.
//
// That a sentence NAMING one of the nine in order to forbid it is allowed. It is not: three of four
// such sentences were measured red — a `잘못된 예 —` label, a `적으면 안 된다:` lead-in, and a
// `어디에도 적혀 있지 않은 문장은` frame. A substring scan cannot tell a claim from a mention, and
// AC-9 records those three rather than the suite pretending they pass.
//
// That the mutation evidence behind AC-9 is a sample of retractions in general. It is not — the
// reddening half was chosen from what this vocabulary catches, which is the denominator being
// filtered by the predicate it is meant to test. The requirement records that.
//
// That a required literal left in place guarantees the section still SAYS it. A sentence keeping
// the literal and appending the opposite conclusion beside it passes — measured, twice. Presence is
// what this file reads; assertion is not.
//
// That `kiwi-wave-master` cannot restate the counting rule at all. The ban is two SPELLINGS read
// out of the owner's own S8 row — `- [ ] #` and `linked_sub_issues`. A restatement avoiding both
// (`본문의 이슈 참조를 센다`) passes.
//
// That the excerpt a run writes actually holds requirement statements. AC-4 pins the SENTENCE that
// says so; whether a research run obeys it is not observable here.
//
// That every seam sentence in a skill is read. Only the section a seam row names is opened. A
// sentence in another section of the same file retracting one of these instructions is invisible
// here, the same way `§V.emit-and-finish` is invisible to FR-FLOW-155.
//
// That `githubIssue` reaches the requirement block. `renderRequirementBlock` in
// `src/core/mutation/render-requirement.ts` and the metadata assembly in
// `src/core/mutation/add-requirement.ts` already render it, and FR-FLOW-174 §5 declines to
// re-observe that; this file reads the skill instruction only.
//
// That the four copies of a seam say the same thing. Each is held to the same literals, and a
// rendering may carry any amount of additional text around them.

const SRS_PATH = "docs/spec/60.workflow-release.srs.md";
const REQUIREMENT_ID = "FR-FLOW-174";

/** One requirement block: its heading up to the next `### ` heading. */
function requirementBlock(id: string): string {
  const lines = readFileSync(path.join(REPO_ROOT, SRS_PATH), "utf8").split("\n");
  const start = lines.findIndex((line) => line.startsWith(`### ${id} `));
  if (start === -1) return "";
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^#{1,3}\s/.test(lines[index] as string)) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

const BLOCK = requirementBlock(REQUIREMENT_ID);

/** The Implementation Notes bullets, one string each, soft wraps joined. */
const NOTES: string[] = section(BLOCK, /^#### Implementation Notes/)
  .split("\n")
  .filter((line) => line.trim().startsWith("- ") && line.trim() !== "- -")
  .map((line) => line.trim().replace(/^- /, ""));

/** Every backtick-quoted token of one note, in the order the note writes them. */
function quoted(note: string): string[] {
  return [...note.matchAll(/`([^`]+)`/g)].map((match) => match[1] as string);
}

interface Seam {
  readonly index: number;
  readonly total: number;
  readonly id: string;
  /** Whatever the row wrote between its id and the closing `.` — empty, or a correction marker. */
  readonly marker: string;
  /** Whether this row announces itself as replacing an earlier row for the same seam. */
  readonly corrected: boolean;
  /** Whether the row closed its declarative part, which is what separates it from its own prose. */
  readonly terminated: boolean;
  /** The `kiwi-*` directory the seam lives in, resolved per rendering. */
  readonly skill: string;
  /** The heading line, matched by exact trimmed equality so a renamed section is a failure. */
  readonly heading: string;
  /** Substrings the section MUST carry. A whole sentence is one of these, not a different kind. */
  readonly required: readonly string[];
  /** Substrings the section must NOT carry. Anchored to `owner` below rather than invented here. */
  readonly forbidden: readonly string[];
  /** `[skill, anchor]` — where the forbidden spellings are owned, so they are read, not listed. */
  readonly owner: readonly string[];
}

/**
 * The backtick-quoted tokens of one ` · `-delimited segment of a row's declarative part.
 *
 * A segment is located by `<label> \``, not by `startsWith`: the FIRST segment of a row also
 * carries the note's date stamp and the `이음매 i/n <id>.` header, so anchoring on the start of the
 * part finds nothing there and the row parses as empty. Requiring the backtick immediately after
 * the label is what keeps `절 \`### 1.1 필수 입력 (택1)\`` from being read as a `필수` segment.
 */
function segmentTokens(declaration: string, label: string): string[] {
  const anchor = `${label} \``;
  const part = declaration.split(" · ").find((candidate) => candidate.includes(anchor));
  return part === undefined ? [] : quoted(part.slice(part.indexOf(anchor)));
}

/**
 * The seam table, read out of the requirement rather than listed here.
 *
 * A row is `이음매 i/n <id>[ 정정].` followed by ` · `-delimited labelled segments and closed by
 * ` · 끝.`. What keeps the row's REASON half out of the parse is the LABELLED SEGMENTATION, not the
 * terminator: a segment is located by `<label> \``, a segment without that anchor yields no tokens,
 * and `find` takes the first match, so prose that repeats a label is never reached either. Measured
 * both ways — changing this reader to ignore the terminator leaves all seven rows' required sets
 * identical, and a row whose reason half writes ` · 필수 \`x\`` is green with the terminator in
 * place. The terminator is therefore a NOTATION CONVENTION for the human reader, which the suite
 * enforces on effective rows so the two halves stay visibly separated; AC-8 records that it changes
 * no verdict rather than letting it read as a parse boundary it is not.
 *
 * The first grammar had no such separation at all: it was positional over every backtick in the
 * bullet, so a backtick in the reason half silently became a literal the section had to carry. The
 * author tripped that once, and the next person to reword a note would have tripped it again.
 *
 * `필수` and `금지` are the two directions of the same question — what the section must and must not
 * carry — and a whole sentence is just a longer substring, which is what lets AC-7's obligation
 * clause be pinned without a second mechanism for "sentences".
 */
/**
 * What a seam row LOOKS like before it is parsed, used as the denominator the parse must exhaust.
 *
 * Deliberately looser than `ROW_HEADER`: the numbering is the part a row cannot fake, so anything
 * carrying it is claiming to be a row and has to parse as one. The first grammar's header required
 * `.` immediately after an optional bare `정정`, so `정정 2` and `정정 3` — the natural way to write
 * a second correction — matched nothing and were dropped without a word. That is the shape this
 * plan keeps finding: a denominator that quietly shrinks to what the reader happens to accept. The
 * identity below closes it, and the marker check keeps a row from parsing under a word nobody
 * declared.
 */
const SEGMENT_LABEL = /(?:스킬|절|필수|금지|소유자) `/;

/**
 * Whether a note is CLAIMING to be a row: it carries the numbering AND writes the row's own
 * apparatus — a labelled segment, or the terminator.
 *
 * The numbering alone was too wide. Implementation Notes are append-only, so the natural way to
 * explain a change is to point at the row it changes, and eight such sentences — `이음매 5/7 은
 * 오케스트레이터가 소유한 자리다`, `표는 이음매 1/7 부터 이음매 7/7 까지 이어진다` — were all
 * refused as malformed rows. Requiring the apparatus keeps prose that MENTIONS a row apart from a
 * note that IS one, because a mention never writes `스킬 \`` or ` · 끝.`.
 *
 * The apparatus of BOTH declared grammars counts, not only the live one. The notes are append-only
 * and the eight rows written before the grammar revision carry `스킬과 절과 리터럴 순` instead of
 * labelled segments; reading only the live apparatus left that shape as one a correction could be
 * written in and fail to parse in, with nothing to say so. Measured on the shipped tree: 17
 * numbered notes, 17 parsed, 9 claiming under the live apparatus alone and 17 under both — which is
 * what lets the identity below hold in both directions instead of one.
 */
const RETIRED_APPARATUS = "스킬과 절과 리터럴 순";

const isRowShaped = (note: string): boolean =>
  /이음매 \d+\/\d+/.test(note) &&
  (SEGMENT_LABEL.test(note) || note.includes(" · 끝.") || note.includes(RETIRED_APPARATUS));

/** `이음매 i/n <id>[ <marker>].` — the marker is captured rather than enumerated. */
const ROW_HEADER = /이음매 (\d+)\/(\d+) ([A-Za-z0-9-]+)([^.]*)\./;

/**
 * The marker forms this file agrees to, matched WHOLE.
 *
 * `startsWith("정정")` was the first shape and it accepted the opposite of what it meant: `정정
 * 취소` and `정정이 아니다` — notes written to WITHDRAW a correction — parsed as ordinary rows and
 * won their seam as the last one, so a note retracting a contract became the contract. A whole
 * match admits the numbered corrections the tree actually uses and nothing that merely opens with
 * the word.
 */
const MARKER_FORM = /^정정(?: \d+)?$/;

const SEAM_ROWS: Seam[] = NOTES.flatMap((note) => {
  const header = ROW_HEADER.exec(note);
  if (header === null) return [];
  const end = note.indexOf(" · 끝.");
  const declaration = end === -1 ? "" : note.slice(0, end);
  return [
    {
      index: Number(header[1]),
      total: Number(header[2]),
      id: header[3] as string,
      marker: (header[4] as string).trim(),
      corrected: (header[4] as string).includes("정정"),
      terminated: end !== -1,
      skill: segmentTokens(declaration, "스킬")[0] ?? "",
      heading: segmentTokens(declaration, "절")[0] ?? "",
      required: segmentTokens(declaration, "필수"),
      forbidden: segmentTokens(declaration, "금지"),
      owner: segmentTokens(declaration, "소유자")
    }
  ];
});

/**
 * The seam table with a corrected row replacing the one it retires, last row per id winning.
 *
 * The notes are append-only, so a correction arrives BESIDE the row it retires rather than in place
 * of it. Taking the last is what makes the correction effective; requiring the later row to say
 * `정정` is what keeps two rows that merely disagree from passing as a correction, with nothing
 * saying which one the tree is being held to.
 */
const SEAMS: Seam[] = [...new Map(SEAM_ROWS.map((seam) => [seam.id, seam])).values()];

/**
 * `하한 rows=7 …` — the floors, read out of the requirement so this file cannot lower them.
 *
 * The LAST floors note wins ENTIRELY, rather than the notes being flattened together. Flattening
 * let a floor survive its own retirement: `literals` was replaced by `required` + `forbidden` when
 * the grammar split, and it went on being readable from an older note with nothing reading it — a
 * dead number that the next person cannot tell from a live one. Taking one note whole means a name
 * the current note omits is simply gone, and `floor()` fails loudly if a check still wants it.
 */
const FLOORS: Record<string, number> = Object.fromEntries(
  // A note DECLARING floors, not merely mentioning the word: a later note correcting the REASON a
  // floor moved says `하한` too, and taking that one whole would empty the table.
  [...(NOTES.filter((note) => /하한 [a-z]+=\d/.test(note)).at(-1) ?? "").matchAll(/([a-z]+)=(\d+)/g)].map((match) => [
    match[1] as string,
    Number(match[2])
  ])
);

function floor(name: string): number {
  const value = FLOORS[name];
  expect(value, `the requirement declares no floor named ${name}, so the check it bounds is unbounded`).toBeGreaterThan(0);
  return value as number;
}

/** `분모 M1 M2 …` — the five sites the requirement says this table has to cover. */
const SITES: string[] = (NOTES.find((note) => note.includes("분모")) ?? "").match(/\bM\d\b/g) ?? [];

/** The renderings that actually ship a skill directory, read from disk. */
function copiesOf(skill: string): string[] {
  return RENDERINGS.filter((rendering) => skillDirs(rendering).includes(skill));
}

/**
 * The one file of `<rendering>/<skill>` whose body carries `heading`.
 *
 * Returns `""` when none does and throws nothing when several do — the caller asserts on the count,
 * so both are reported as an assertion naming the seam rather than as a harness fault.
 */
function filesCarrying(rendering: string, seam: Seam): string[] {
  return markdownFiles(rendering, seam.skill).filter((relPath) =>
    readRepoFile(relPath)
      .split("\n")
      .some((line) => line.trim() === seam.heading)
  );
}

/**
 * The nine phrases that retract an instruction, matched as BARE SUBSTRINGS.
 *
 * This is an auxiliary check, not the requirement's guarantee. What this file actually defends is
 * the presence of the seam table's required literals and the absence of its forbidden spellings;
 * this scan sits on top of that and catches only the spellings it lists.
 *
 * A round of this suite tried to make it sharper by requiring the phrase to CLOSE a sentence, so
 * that `생략해도 된다고 판단하지 말고 반드시 실행한다` — a sentence that strengthens the rule while
 * naming the phrase — would stop being refused. Measured over nine retractions and four
 * strengthening sentences, that constraint took the scan from catching 6 of 9 to catching 1 of 9,
 * because a parenthesis, a bold marker, a closing quote, a semicolon or a fullwidth stop all move
 * the phrase off the sentence end while leaving it a plain retraction; and it rescued only one of
 * the four strengthening sentences, leaving three still refused. It was reverted: five caught for
 * one rescued is a losing trade, and both halves of it are recorded in AC-9 rather than fixed,
 * because the distinction the constraint was reaching for is the meaning of the sentence, which no
 * spelling rule reads.
 */
const RETRACTIONS = [
  "생략해도 된다",
  "생략할 수 있다",
  "생략해도 무방",
  "넘기지 않아도 된다",
  "적지 않아도 된다",
  "건너뛰어도 된다",
  "무시해도 된다",
  "지키지 않아도 된다",
  "따르지 않아도 된다"
] as const;

const PAIRS: Array<{ title: string; seam: Seam; rendering: string }> = SEAMS.flatMap((seam) =>
  copiesOf(seam.skill).map((rendering) => ({ title: `${seam.id} · ${rendering}`, seam, rendering }))
);

/** Every rendering this suite opened, beside the block Vitest was running when it opened it. */
const OPENED: Array<{ readonly block: string; readonly relPath: string; readonly digest: string }> = [];

const digestOf = (relPath: string): string => createHash("md5").update(readRepoFile(relPath)).digest("hex");

/**
 * The seam section of one rendering, recorded in the ledger under the block that asked for it.
 *
 * The two sides of the ledger come from different places: the block title is what the runner
 * supplies, and the path is the argument this function was handed. Recording the block's own name
 * in place of the argument would make the comparison vacuous, which is the substitution the ledger
 * check at the bottom of this file measures.
 */
function bodyOf(rendering: string, seam: Seam): { relPath: string; body: string } {
  const carriers = filesCarrying(rendering, seam);
  const relPath = carriers.length === 1 ? (carriers[0] as string) : "";
  const running = String(expect.getState().currentTestName ?? "");
  const block = running.split(" > ").find((segment) => PAIRS.some((pair) => pair.title === segment));
  OPENED.push({ block: block ?? "", relPath, digest: relPath === "" ? "" : digestOf(relPath) });
  expect(carriers, `${seam.id}: ${rendering}/${seam.skill} must carry the heading ${seam.heading} in exactly one file`).toHaveLength(1);
  return { relPath, body: section(readRepoFile(relPath), new RegExp(`^${seam.heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`)) };
}

interface RegisteredCheck {
  readonly block: string;
  readonly ran: boolean;
}

/** Every test Vitest registered for this file, read from the task tree rather than from the source. */
function registeredChecks(context: unknown): RegisteredCheck[] {
  const found: RegisteredCheck[] = [];
  const walk = (node: { tasks?: unknown[] } | undefined): void => {
    for (const child of node?.tasks ?? []) {
      const task = child as { type?: string; mode?: string; suite?: { name?: string }; tasks?: unknown[] };
      if (task.type === "test") found.push({ block: task.suite?.name ?? "", ran: task.mode === "run" });
      walk(task);
    }
  };
  walk((context as { task?: { file?: { tasks?: unknown[] } } }).task?.file);
  return found;
}

describe("FR-FLOW-174 the seam table", () => {
  it("the requirement block and its seam notes exist, or every check below is vacuous", () => {
    expect(BLOCK, `${REQUIREMENT_ID} is not in ${SRS_PATH}`).not.toBe("");
    expect(NOTES.length, "the requirement carries no Implementation Notes to read the seam table out of").toBeGreaterThan(0);
    expect(SEAMS.length, "the seam table is empty, so every per-copy check below would sweep nothing").toBe(floor("rows"));
  });

  it("every row-shaped note parses as a row, so none is dropped without a word", () => {
    // The identity. A note claiming to be a row must parse as one; if the header reader cannot read
    // it, that note is silently outside every denominator below — the table shrinks, the floors
    // still pass because they were written against the shrunken table, and the seam it declared
    // goes unenforced. Measured before this check existed: 17 notes claiming to be rows, 15 parsed,
    // and the two that vanished were the `정정 2` and `정정 3` corrections of one seam.
    //
    // An EQUALITY, in both directions. It was a subset for one round, because the predicate read
    // only the live grammar's apparatus and the eight rows written under the first grammar parse
    // without it; the half that went missing was the half that matters — a note written in the
    // retired shape could fail to parse and no check would fire, and eight of the seventeen rows
    // are in that shape. Reading both grammars' apparatus closes it, and the reverse direction
    // keeps a row from parsing out of a note that claims nothing at all.
    expect(
      NOTES.filter(isRowShaped).filter((note) => ROW_HEADER.exec(note) === null).map((note) => note.slice(0, 60)),
      "a note writes a seam row's apparatus but the header reader does not parse it as a row"
    ).toEqual([]);
    expect(
      NOTES.filter((note) => ROW_HEADER.exec(note) !== null && !isRowShaped(note)).map((note) => note.slice(0, 60)),
      "the header reader parses a note as a seam row that never claimed to be one"
    ).toEqual([]);
    expect(SEAM_ROWS.length, "the parsed rows are the denominator every check below divides by").toBeGreaterThanOrEqual(floor("rawrows"));
  });

  it("a row's marker is empty or announces a correction, never an undeclared word", () => {
    // The header captures whatever stands between the id and the `.` rather than enumerating the
    // markers it accepts, so a row cannot parse under a word this file never agreed to. Without
    // this, the capture that fixed the identity above would happily read `이음매 5/7 M2-orch 폐기.`
    // as an ordinary row — and a PREFIX test would have gone on admitting `정정 취소`, which says
    // the opposite of what it would then be taken to mean.
    expect(
      SEAM_ROWS.filter((seam) => seam.marker !== "" && !MARKER_FORM.test(seam.marker)).map((seam) => `${seam.id}: ${seam.marker}`),
      "a seam row carries a marker that is neither empty nor one of the declared 정정 forms"
    ).toEqual([]);
  });

  it("a second row for one seam is a correction, and says so", () => {
    const seen = new Map<string, number>();
    const unmarked = SEAM_ROWS.filter((seam) => {
      const count = (seen.get(seam.id) ?? 0) + 1;
      seen.set(seam.id, count);
      return count > 1 && !seam.corrected;
    }).map((seam) => seam.id);
    expect(unmarked, "a seam carries more than one row and the later one is not marked 정정").toEqual([]);
  });

  it("the table numbers itself, so a deleted row is a gap rather than a shorter list", () => {
    expect(
      SEAMS.map((seam) => `${seam.index}/${seam.total}`),
      "the seam rows must be numbered 1..n against one total"
    ).toEqual(SEAMS.map((_, position) => `${position + 1}/${SEAMS.length}`));
  });

  it("the five sites the requirement names are each carried by at least one row, and no row is off-list", () => {
    expect(SITES.length, "the requirement declares no site denominator, so an unclassified seam cannot be reported").toBe(floor("sites"));
    const covered = [...new Set(SEAMS.map((seam) => seam.id.split("-")[0] as string))].sort();
    expect(covered, "a site the requirement names carries no seam row, or a row names a site the requirement does not").toEqual([...SITES].sort());
  });

  it("every effective row closes its declarative part, so its own prose is not read as a literal", () => {
    // The EFFECTIVE rows, not every row the append-only notes ever carried. Eight rows written under
    // the positional grammar are still in the file and cannot be deleted from it; each is superseded
    // by a terminated correction, so none of them is what any check reads. Holding history to a
    // grammar introduced after it would be a permanent red with nothing behind it — while an
    // unterminated row appended LATER wins its id and is caught here, which is the case that matters.
    expect(
      SEAMS.filter((seam) => !seam.terminated).map((seam) => `${seam.index}/${seam.total} ${seam.id}`),
      "the effective seam row does not close with ` · 끝.`, so where its declaration ends and its reason begins is undefined"
    ).toEqual([]);
  });

  it("every row names a skill, a heading and at least one required literal, and the totals hold", () => {
    for (const seam of SEAMS) {
      expect(seam.skill.startsWith("kiwi-"), `${seam.id}: the 스킬 segment must name a kiwi skill directory`).toBe(true);
      expect(/^#{2,4} /.test(seam.heading), `${seam.id}: the 절 segment must name a markdown heading line`).toBe(true);
      expect(seam.required.length, `${seam.id}: the row requires nothing, so its per-copy check asserts nothing`).toBeGreaterThan(0);
      // A forbidden spelling with nowhere to be read FROM would be a list this file invented.
      if (seam.forbidden.length > 0) {
        expect(seam.owner, `${seam.id}: a 금지 list needs a 소유자 segment naming the skill and the anchor it is read from`).toHaveLength(2);
      }
    }
    expect(SEAMS.reduce((sum, seam) => sum + seam.required.length, 0), "the required-literal total moved").toBe(floor("required"));
    expect(SEAMS.reduce((sum, seam) => sum + seam.forbidden.length, 0), "the forbidden-spelling total moved").toBe(floor("forbidden"));
  });

  it("every forbidden spelling is one the owner really writes, so the ban is derived rather than invented", () => {
    // FR-FLOW-167's shape: a name asserted about a section must come from somewhere other than that
    // section, or deleting it from both sides at once satisfies the check. Here the ban on
    // `kiwi-wave-master` restating the counting rule is anchored to the row `kiwi-orchestrator`
    // states it in — so an owner that stops writing a spelling fails HERE, rather than leaving the
    // ban quietly guarding a rule nobody states any more.
    const banned = SEAMS.filter((seam) => seam.forbidden.length > 0);
    expect(banned.length, "no seam row bans anything, so this check has an empty denominator").toBeGreaterThanOrEqual(floor("bans"));
    const missing: string[] = [];
    for (const seam of banned) {
      const [ownerSkill, anchor] = seam.owner as [string, string];
      for (const rendering of copiesOf(ownerSkill)) {
        const carriers = markdownFiles(rendering, ownerSkill).flatMap((relPath) =>
          readRepoFile(relPath)
            .split("\n")
            .filter((line) => line.includes(anchor))
        );
        if (carriers.length === 0) missing.push(`${seam.id}: ${rendering}/${ownerSkill} carries no line with ${anchor}`);
        for (const spelling of seam.forbidden) {
          if (!carriers.some((line) => line.includes(spelling))) missing.push(`${seam.id}: ${rendering} owner line does not write ${spelling}`);
        }
      }
    }
    expect(missing, "a forbidden spelling is not one the owner writes, so the ban guards a rule that has moved").toEqual([]);
  });

  it("the copies of each seam are read from disk, and the one skill with three copies is the excluded one", () => {
    for (const seam of SEAMS) {
      const copies = copiesOf(seam.skill);
      expect(copies.length, `${seam.id}: ${seam.skill} ships in no rendering`).toBeGreaterThan(0);
      if (copies.length !== RENDERINGS.length) {
        expect(MIRROR_EXCLUDED, `${seam.skill} is missing from a rendering and the mirror does not exclude it`).toContain(seam.skill);
        expect(RENDERINGS.filter((rendering) => !copies.includes(rendering)), `${seam.skill} is missing from a rendering other than the mirror`).toEqual([
          ".agents/skills"
        ]);
      }
    }
    expect(PAIRS.length, "the seam-by-copy product moved").toBe(floor("pairs"));
  });

  it("the retraction vocabulary is not allowed to shrink to nothing", () => {
    expect(RETRACTIONS.length, "the polarity scan reads a closed vocabulary; an empty one forbids nothing").toBe(floor("retractions"));
  });
});

describe.each(PAIRS.map((pair) => [pair.title, pair] as const))("%s", (_title, { seam, rendering }) => {
  it("carries every literal the seam row requires, and none it forbids", () => {
    const { relPath, body } = bodyOf(rendering, seam);
    expect(body, `${seam.id}: ${relPath} carries the heading ${seam.heading} but the section under it is empty`).not.toBe("");
    const flattened = flat(body);
    for (const literal of seam.required) {
      expect(flattened.includes(flat(literal)), `${seam.id}: ${relPath} § ${seam.heading} does not carry ${literal}`).toBe(true);
    }
    expect(
      seam.forbidden.filter((spelling) => flattened.includes(flat(spelling))),
      `${seam.id}: ${relPath} § ${seam.heading} restates what another section owns`
    ).toEqual([]);
  });

  it("carries no sentence retracting what the seam states", () => {
    const { relPath, body } = bodyOf(rendering, seam);
    const offenders = scanUnits(body, { splitListItems: true, splitFencedLines: true }).flatMap((unit) =>
      RETRACTIONS.filter((phrase) => unit.text.includes(phrase)).map((phrase) => `${relPath} ${unitAt(unit, seam.heading)}: ${phrase}`)
    );
    expect(offenders, `${seam.id}: a sentence beside the seam retracts it`).toEqual([]);
  });
});

describe("FR-FLOW-174 one acquisition command for the whole tree", () => {
  /** Every markdown file of every shipped rendering. */
  const CORPUS = RENDERINGS.flatMap((rendering) => markdownFiles(rendering));

  it("every `gh issue view --json` in the shipped trees asks for the same fields", () => {
    const mentions = CORPUS.flatMap((relPath) =>
      [...readRepoFile(relPath).matchAll(/gh issue view[^\n`]*?--json\s+([A-Za-z,]+)/g)].map((match) => ({ relPath, fields: match[1] as string }))
    );
    expect(mentions.length, "no `gh issue view --json` is spelled anywhere, so this check has an empty denominator").toBeGreaterThanOrEqual(
      floor("acquisitions")
    );
    expect(
      [...new Set(mentions.map((mention) => mention.fields))],
      "two different `--json` field lists ship, so the same issue reads differently depending on which skill opened it"
    ).toEqual(["title,body,comments"]);
  });
});

describe("FR-FLOW-174 the epic entry points at the counting rule instead of restating it", () => {
  // The restatement ban itself is a `금지` list on the wave-master seam row, enforced per copy above
  // and anchored to `kiwi-orchestrator`'s own S8 row by the derivation check. This block asserts
  // only that the row still CARRIES that ban — a row whose `금지` list emptied would leave the
  // per-copy check comparing `[] to equal []` for the same reason a clean tree does.
  it("the wave-master row bans the spellings the counting rule is written in", () => {
    const seam = SEAMS.find((candidate) => candidate.skill === "kiwi-wave-master");
    expect(seam, "no seam row names kiwi-wave-master, so nothing bans the restatement").toBeDefined();
    expect((seam as Seam).forbidden.length, "the wave-master row bans nothing, so §8 may restate the rule freely").toBeGreaterThanOrEqual(
      floor("bans")
    );
    expect((seam as Seam).owner[0], "the ban must be anchored to the skill that owns the rule").toBe("kiwi-orchestrator");
  });
});

// Declared last: Vitest runs a file's tests in declaration order, so every per-copy check above has
// recorded what it opened by the time this runs.
describe("FR-FLOW-174 what the per-copy checks read", () => {
  it("every per-copy check opened the rendering its own block is named for", (context) => {
    const registered = registeredChecks(context).filter((check) => PAIRS.some((pair) => pair.title === check.block));
    expect(registered.length, "no per-copy check is registered, so this ledger has nothing to answer for").toBe(floor("checks"));

    const reads = OPENED.filter((opened) => opened.block !== "");
    expect(reads.length, "a per-copy check opened no section, or opened more than one").toBe(registered.filter((check) => check.ran).length);

    // The block title carries the rendering, so the file each block SHOULD have opened is resolved
    // here independently of what the block passed in.
    const expected = (block: string): string => {
      const pair = PAIRS.find((candidate) => candidate.title === block);
      if (pair === undefined) return "";
      const carriers = filesCarrying(pair.rendering, pair.seam);
      return carriers.length === 1 ? (carriers[0] as string) : "";
    };
    expect(
      reads.filter((opened) => opened.relPath !== expected(opened.block)).map((opened) => `${opened.block} opened ${opened.relPath}`),
      "a per-copy check read a rendering other than the one its block is named for"
    ).toEqual([]);

    // The digest is of the bytes that came back rather than of either label, so a recorder that
    // logged the block's own name in place of the argument still reports the wrong file here.
    expect(
      reads.filter((opened) => opened.digest !== digestOf(expected(opened.block))).map((opened) => `${opened.block} was answered with foreign bytes`),
      "a per-copy check was handed one rendering's bytes under another rendering's name"
    ).toEqual([]);
  });
});
