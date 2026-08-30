import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { FREEZE_TARGETS, ORCHESTRATE_TOOL_BINDINGS, type OrchestrateToolBinding } from "../../src/cli/commands/orchestrate.js";
import { GATE_IDS } from "../../src/core/orchestrator/auto-gate.js";
import { freezeLock, type FreezeLockKind } from "../../src/core/orchestrator/freeze.js";
import { HANDOFF_VIOLATION_CODES } from "../../src/core/orchestrator/handoff.js";
import { ISSUE_CLASSES, openIssue, type IssueRow } from "../../src/core/orchestrator/issue-ledger.js";
import { ORCHESTRATOR_MIRROR, ORCHESTRATOR_VARIANTS, readVariant, section, stripFrontmatter } from "./kiwi-orchestrator-variants.js";
import { flat, readRepoFile, scanUnits, unitAt } from "./kiwi-renderings.js";

// @req FR-FLOW-168 AC-1 — the five wired tools come from FR-FLOW-167's destination note and from the
// binding array, never from a list written here.
// @req FR-FLOW-168 AC-2 — every rendering names the command at each of the six places, beside the
// gate that receives its verdict.
// @req FR-FLOW-168 AC-3 — a gate named is a gate that tool's own handler can raise, read from source.
// @req FR-FLOW-168 AC-4 — a citation carries every argument the binding declares mandatory, and two
// of the five judgements are driven to their refusal rather than described.
// @req FR-FLOW-168 AC-5 — the two prefix-less leaf spellings are normalised to one spelling.
// @req FR-FLOW-168 AC-8 — what this file does and does not guarantee, measured rather than inferred.
//
// ─── WHAT THIS FILE GUARANTEES ──────────────────────────────────────────────────────────────────
//
// (1) The denominator. The five tools this requirement wires are read out of `FR-FLOW-167`'s own
// destination note — the note that split its seven wiring follow-ups by the file they land in — and
// each of them is checked against `ORCHESTRATE_TOOL_BINDINGS`. The two that note sent to plan 20 are
// asserted absent here, so one edit cannot move a tool between the two follow-ups unnoticed. A list
// in this file would let the denominator shrink by the same edit that shrinks the assertions.
//
// (2) The wiring. For each of the six (tool, section) places the requirement's map declares, all
// four renderings of `kiwi-orchestrator/SKILL.md` name the MCP tool and the CLI fallback inside that
// section and name the gate that receives the verdict in the same section. Section and gate come
// from the map note, not from the section being read: a gate derived from the section it is asserted
// about is satisfied by deleting it from both sides at once.
//
// (3) That the gate the map names is one the tool can raise. The provenance reader is `FR-FLOW-167`'s,
// extended for the two bindings whose leaf is chosen by a selector rather than by the tool name:
// `orchestrate_freeze` is registered as `freeze.command(target)` inside a loop over `FREEZE_TARGETS`,
// so no literal leaf anchor exists and the reader falls back to the parent namespace variable.
//
// (4) That an agent following the citation reaches the gate rather than the tool's own argument
// error. The mandatory arguments come from the binding's `required` options and the selector values
// from its `selector`, so a citation that drops one is red. `FR-NODE-128` owns the other half —
// that the verb resolves against the command tree and the placeholders are among its thirteen forms.
//
// (5) That two of the five refusals exist rather than being described. `openIssue` is handed a
// ledger already carrying the id and refuses; `freezeLock` is handed a body without the fields its
// kind requires and refuses, and the fields it names are then supplied back to it for the other
// direction. Both are pure kernels, so this costs no filesystem and no git.
//
// The reach of all of it is bounded by FLOORS read out of the requirement — `tools`, `places`,
// `copies`, `checks`, `survives`, `overrides` — because a reach written as a literal here cannot be
// defended by the checks it bounds. `checks` is counted from the tasks the runner registered rather
// than from `it.each(PLACES)` counted in this source: the source count holds while a block reads one
// fixed rendering four times, which `FR-FLOW-167` measured green at all four of its call sites.
//
// ─── WHAT THIS FILE DOES NOT GUARANTEE ──────────────────────────────────────────────────────────
// That an agent calls any of these tools. Nothing here observes a run: a run whose agent read the
// instruction and skipped it completes normally and this file stays green.
//
// That a contradiction elsewhere in the skill is caught. Only the six sections the map names are
// read; a sentence in `§0.G` or `§16` retracting one of the six instructions is invisible here.
//
// That the MCP parameter names the wiring sentence cites exist on that tool. Only the CLI flags are
// held, and only against the binding's `required` set.
//
// That three of the five reach their gate when the instruction is followed. `orchestrate_run_lock`
// would need a git common directory to take a lease in, `orchestrate_run_abort` a journal to append
// to, and `orchestrate_handoff_validate` a ten-heading handoff fixture with a lane row, a task
// catalogue and a dispatch base to agree with. For those three the guarantee stops at the mandatory
// argument comparison.
//
// That a retraction placed in `§3` outside the two subsections this requirement opened is caught.
// The cancellation scan runs over the section the map names, and for the two phase-map tools that
// section is `§3.1` and `§3.2` rather than `§3` — `§3` itself carries `set_work_mode 를 스스로
// 호출하지 않는다` at P.3, a rule about a different tool that the override vocabulary reads as a
// cancellation. Measured: over the six sections the map names, in all four renderings, the ten
// override phrases occur zero times before this requirement's text is added.
//
// That a negation or a retraction worded outside the closed vocabularies is caught. Both readers are
// SCANS, and the floors are what keep the vocabularies from shrinking rather than what makes them
// complete.
//
// ─── BASELINE, MEASURED BEFORE THE SKILL TEXT WAS TOUCHED ───────────────────────────────────────
// Over `skills/` and `.agents/skills/` in the shipped tree, each of these was 0: the five tool names
// `orchestrate_run_lock` `orchestrate_run_abort` `orchestrate_freeze` `orchestrate_handoff_validate`
// `orchestrate_issue_open`; the five citations `speckiwi orchestrate run lock`, `… run abort`,
// `… freeze`, `… handoff validate`, `… issue open`; and `--owner` `--document` `--catalog`
// `--ledger` `--path` `a|b|c`. These were NOT zero: `handoff validate --lane epilogue` 4 and
// `freeze handoff` 4 — the two prefix-less spellings this requirement normalises, one per rendering
// — and the six gate ids `orchestrator-run-lock-held` 8, `run-invariant-drift` 36,
// `journal-artifact-lock-held` 4, `design-not-frozen` 16, `handoff-verify-failed` 16 and
// `wave-issues-open` 16, all already declared by `§0.G` and the phase map. Also not zero, and
// counted over the four renderings of this skill alone: `--payload` 4, `--run-id` 20, `--out` 20,
// `--lane` 32, `--head` 16, `<path>` 64, `<payload>` 4, `<id>` 16, `<t>` 12.

const SELF_PATH = fileURLToPath(import.meta.url);
const SRS_PATH = "docs/spec/60.workflow-release.srs.md";
const ORCHESTRATE_CLI = "src/cli/commands/orchestrate.ts";
const REQUIREMENT_ID = "FR-FLOW-168";
const TRIAGE_ID = "FR-FLOW-167";

/** The four renderings of the skill this requirement wires. */
const COPIES = [...ORCHESTRATOR_VARIANTS.map((variant) => variant.relPath), ORCHESTRATOR_MIRROR];

/** The `### <id> —` block of one requirement, up to the next requirement or section heading. */
function requirementBlock(id: string): string {
  const lines = readRepoFile(SRS_PATH).split(/\r?\n/);
  const start = lines.findIndex((line) => line.startsWith(`### ${id} `));
  if (start === -1) return "";
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index] as string;
    if (line.startsWith("### ") || line.startsWith("## ")) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

/** One `- [date] …` bullet of a requirement's Implementation Notes. */
function implementationNotes(block: string): string[] {
  const lines = block.split("\n");
  const start = lines.findIndex((line) => line.startsWith("#### Implementation Notes"));
  if (start === -1) return [];
  const out: string[] = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index] as string;
    if (line.startsWith("#### ")) break;
    if (line.startsWith("- ")) out.push(line);
  }
  return out;
}

const BLOCK = requirementBlock(REQUIREMENT_ID);
const NOTES = implementationNotes(BLOCK);
const TRIAGE_NOTES = implementationNotes(requirementBlock(TRIAGE_ID));

/**
 * The LAST note carrying `marker`. `append_section_note` appends and cannot edit in place, so a
 * value corrected after a verification round arrives as a second dated bullet beside the one it
 * retires, and a reader taking the first would go on reading the retired value.
 */
const lastNoteOf = (notes: readonly string[], marker: string): string => notes.filter((note) => note.includes(marker)).at(-1) ?? "";
const lastNote = (marker: string): string => lastNoteOf(NOTES, marker);

/** The text of one acceptance criterion of this requirement, read out of the block. */
function acText(id: string): string {
  const line = BLOCK.split("\n").find((entry) => entry.startsWith(`- [ ] ${id}:`) || entry.startsWith(`- [x] ${id}:`));
  return line === undefined ? "" : line.slice(line.indexOf(":") + 1).trim();
}

const AC_IDS = [...BLOCK.matchAll(/^- \[[ x]\] (AC-\d+):/gm)].map((match) => match[1] as string);

/**
 * The floors this suite runs under, read out of the requirement rather than typed here.
 *
 * How many tools are wired, how many places they land in, how many renderings are swept and how many
 * per-copy checks that multiplies out to are the values that decide this suite's REACH, and a literal
 * reach cannot be defended by the checks it bounds — lower it and the sweep shrinks while every
 * assertion stays green. `FR-FLOW-158`, `FR-FLOW-164` and `FR-FLOW-167` each moved their floors into
 * their requirement for that reason; this follows them. Narrowing the sweep is a requirement diff.
 */
const FLOORS: ReadonlyMap<string, number> = new Map(
  AC_IDS.flatMap((id) => [...acText(id).matchAll(/`([a-z]+) (\d+)`/g)].map((match) => [match[1] as string, Number(match[2])] as [string, number]))
);

/** One floor, by the key the requirement names it under. Absent means it stopped bounding it. */
function floor(name: string): number {
  const value = FLOORS.get(name);
  if (value === undefined) throw new Error(`${REQUIREMENT_ID} names no floor \`${name}\`, so this assertion has no bound to hold to`);
  return value;
}

// ── the denominator ─────────────────────────────────────────────────────────────────────────────

const BINDING_OF: ReadonlyMap<string, OrchestrateToolBinding> = new Map(ORCHESTRATE_TOOL_BINDINGS.map((binding) => [binding.tool, binding]));

/** The tools one clause of the triage requirement's destination note sends to one follow-up. */
function destinedFor(clause: string, plan: string): string[] {
  const note = lastNoteOf(TRIAGE_NOTES, "배선 후속 일곱의 행선지");
  const opened = note.indexOf(clause);
  if (opened === -1) return [];
  const closed = note.indexOf(`)은 계획 ${plan}번`, opened);
  if (closed === -1) return [];
  return [...note.slice(opened, closed).matchAll(/`(orchestrate_[a-z_]+)`/g)].map((match) => match[1] as string);
}

/** The five `FR-FLOW-167` assigned to this follow-up, and the two it assigned to the other one. */
const CARRIED_HERE = destinedFor("본문에 착지하는 다섯(", "19");
const CARRIED_ELSEWHERE = destinedFor("파일에 착지하는 둘(", "20");

// ── the wiring map ──────────────────────────────────────────────────────────────────────────────

interface Place {
  /** The MCP tool whose judgement this place carries. */
  readonly tool: string;
  /** The section token the map names, as the requirement spells it: `§3.1`, `§V.abort-run`. */
  readonly at: string;
  /** The gate that receives this tool's verdict at this place. */
  readonly gate: string;
  /** The CLI fallback the section must cite. */
  readonly cli: string;
}

/**
 * The map, read from the requirement rather than from the sections it governs.
 *
 * Deriving the gate from the section under test would make the gate mutation vacuous: removing the
 * gate name from the section would remove it from the expectation in the same edit. The citations
 * live in two further notes because one note is capped at 500 characters and six citations of a
 * six-way selector do not fit beside the six triples.
 */
function wiringMap(): Place[] {
  const places = [...lastNote("배선 지도 (AC-2) 자리").matchAll(/`(orchestrate_[a-z_]+)` → `(§[^`]+)` → 게이트 `([a-z-]+)`/g)];
  const citations = ["인용 1/2", "인용 2/2"].flatMap((part) =>
    [...lastNote(`배선 지도 (AC-2) ${part}`).matchAll(/`(speckiwi orchestrate [^`]+)`/g)].map((match) => match[1] as string)
  );
  return places.map((match, index) => ({
    tool: match[1] as string,
    at: match[2] as string,
    gate: match[3] as string,
    cli: citations[index] ?? ""
  }));
}

const PLACES = wiringMap();

// ── reading one section of one rendering ────────────────────────────────────────────────────────

/**
 * The section a map token names.
 *
 * `§V.<verb>` is the verb index's own heading form. Everything else is a numbered heading, whose
 * number may or may not carry a trailing period — the tree ships `## 15. 통합…` and `### 9.3 loop H`
 * — so the period is optional and a separator is required after it. That last part is what keeps
 * `§3` from matching `### 3.1`, which would silently widen a subsection to its parent.
 */
function sectionAt(body: string, token: string): string {
  const bare = token.replace(/^§/, "");
  const heading = bare.startsWith("V.")
    ? new RegExp(`^###\\s+§V\\.${bare.slice(2).replace(/-/g, "\\-")}(?:\\s|$)`)
    : new RegExp(`^#{2,4}\\s+${bare.replace(/\./g, "\\.")}\\.?\\s`);
  return section(body, heading);
}

// ── gate provenance ─────────────────────────────────────────────────────────────────────────────

const CLI_SOURCE = readRepoFile(ORCHESTRATE_CLI);

/** Identifier to the module it is imported from, for the modules a handler's kernel calls live in. */
const IMPORTED_FROM: ReadonlyMap<string, string> = new Map(
  [...CLI_SOURCE.matchAll(/import\s+(?:type\s+)?\{([\s\S]*?)\}\s*from\s*"(\.[^"]+)"/g)].flatMap((match) =>
    (match[1] as string)
      .split(",")
      .map((entry) => (entry.replace(/\btype\b/g, "").trim().split(/\s+as\s+/)[0] ?? "").trim())
      .filter((name) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(name))
      .map((name) => [name, match[2] as string] as [string, string])
  )
);

/**
 * The `.action` callback of one tool's CLI leaf, by bracket matching from its registration.
 *
 * Two of the five bindings here choose their leaf by a selector value rather than by the tool name,
 * and one of those two is registered inside a loop: `for (const target of FREEZE_TARGETS)` around
 * `freeze.command(target)`. There is no `freeze.command("design")` anywhere in the file, so the
 * literal anchor `FR-FLOW-167` used returns "" and every gate would be reported absent. The fallback
 * is the parent namespace variable, which is unique per family — `const freeze = orchestrate
 * .command("freeze")` does not itself contain `freeze.command(`.
 */
function handlerBody(tool: string): string {
  const binding = BINDING_OF.get(tool);
  if (binding === undefined) return "";
  const parent = binding.path.slice(0, -1).join("");
  const literal = `${parent}.command("${binding.path.at(-1) as string}")`;
  let at = CLI_SOURCE.indexOf(literal);
  if (at === -1 && binding.selector !== undefined) at = CLI_SOURCE.indexOf(`${parent}.command(`);
  if (at === -1) return "";
  const action = CLI_SOURCE.indexOf(".action(", at);
  if (action === -1) return "";
  let depth = 0;
  for (let index = action; index < CLI_SOURCE.length; index += 1) {
    const character = CLI_SOURCE[index];
    if (character === "(") depth += 1;
    if (character === ")") {
      depth -= 1;
      if (depth === 0) return CLI_SOURCE.slice(action, index + 1);
    }
  }
  return "";
}

/** The `src/core/**` modules one handler body reaches through the identifiers it names. */
function handlerModules(body: string): string[] {
  const modules = new Set<string>();
  for (const name of new Set([...body.matchAll(/\b[A-Za-z_][A-Za-z0-9_]*\b/g)].map((match) => match[0]))) {
    const module = IMPORTED_FROM.get(name);
    if (module !== undefined) modules.add(module);
  }
  return [...modules];
}

/** One imported module's source, resolved against the command file that imports it. */
function moduleSource(specifier: string): string {
  try {
    return readRepoFile(path.posix.join(path.posix.dirname(ORCHESTRATE_CLI), specifier.replace(/\.js$/, ".ts")));
  } catch {
    return "";
  }
}

/** Whether `gate` is an identifier this tool's own path can raise. */
function raisesGate(tool: string, gate: string): boolean {
  const body = handlerBody(tool);
  if (body === "") return false;
  if (body.includes(`"${gate}"`)) return true;
  return handlerModules(body).some((module) => moduleSource(module).includes(`"${gate}"`));
}

// ── the arguments a citation has to carry ───────────────────────────────────────────────────────

/** The long flags the binding declares mandatory for this tool. */
function mandatoryFlags(tool: string): string[] {
  return (BINDING_OF.get(tool)?.options ?? []).filter((option) => option.required === true).map((option) => option.flag);
}

/** The leaf values this tool's selector chooses between, or [] when it has none. */
function selectorValues(tool: string): string[] {
  return [...(BINDING_OF.get(tool)?.selector?.values ?? [])];
}

/** The whitespace-separated tokens of a citation, so a flag is compared whole rather than as a substring. */
const tokensOf = (cli: string): string[] => cli.trim().split(/\s+/);

// ── the wording the instruction has to keep, and the wording the section may not carry ──────────

/** Hedges that would turn an instruction into a suggestion, read over the sentence naming the tool. */
const HEDGE =
  /수 있다|해도 된다|권장|바람직|원칙적으로|가능하면|되도록|경우에 따라|가급적|필요하면|필요 시|것이 좋다|선택적|해도 무방|권한다|생략해도/;

/**
 * The verbs in which the six shipped instruction lines say the call is MADE.
 *
 * READ OFF the shipped text rather than invented, and required of the INSTRUCTION LINE alone — the
 * line that names the MCP tool — because that is the sentence the map is about. Checking only for
 * the tool NAME on that line is what `FR-FLOW-167` measured green under `…를 부르지 않고 손으로
 * 쓴다`, which carries the name while saying the opposite.
 */
const POLARITY_SURVIVES: readonly string[] = ["받는다", "얻는다", "거절한다"];

/** A closed-vocabulary term with the sample only it catches, the shape `FR-FLOW-164` established. */
interface PolarityTerm {
  readonly phrase: string;
  readonly sample: string;
}

/**
 * The cancellations no BLOCK of a wired section may carry, one entry per phrase.
 *
 * SCANNED OVER THE WHOLE SECTION, block by block, unlike `POLARITY_SURVIVES`: what a retraction has
 * to be read over is the section and not the sentence, because a sentence carrying neither the tool
 * name nor the citation never joins the hedge reader's subject at all. Blocks rather than lines
 * because a phrase folded across a soft line break is carried by neither line while the rendered
 * paragraph reads as one.
 *
 * The two negations are spelled to the stem rather than to a sentence ending, because this
 * requirement's survival verbs are carried THROUGH a negation. `손으로 쓴다` keeps its ending on
 * purpose: `§V.freeze-route` ships `lock 을 손으로 쓰지 않는다`, which is the rule and not its
 * cancellation, and widening the phrase to `손으로 쓰` would refuse a shipped line.
 */
const POLARITY_OVERRIDES: readonly PolarityTerm[] = [
  { phrase: "부르지 않", sample: "이 절에서는 그 도구를 부르지 않고 넘어간다." },
  { phrase: "호출하지 않", sample: "MCP 도구를 호출하지 않은 채 진행한다." },
  { phrase: "손으로 쓴다", sample: "lock 은 손으로 쓴다." },
  { phrase: "생략해도", sample: "다만 이 호출은 필요하면 생략해도 된다." },
  { phrase: "건너뛴다", sample: "이 호출은 건너뛴다." },
  { phrase: "필수가 아니다", sample: "이 호출은 필수가 아니다." },
  { phrase: "선택이다", sample: "이 명령을 부를지는 선택이다." },
  { phrase: "폐기한다", sample: "위 지시는 이번 판에서 폐기한다." },
  { phrase: "강제하지 않는다", sample: "이 절은 그 호출을 강제하지 않는다." },
  { phrase: "무시하고 진행", sample: "게이트를 무시하고 진행한다." }
];

const OVERRIDE_PHRASES: readonly string[] = POLARITY_OVERRIDES.map((term) => term.phrase);

/** The blocks of a section that cancel the instruction beside them. */
function cancellations(text: string, where: string): string[] {
  const found: string[] = [];
  for (const unit of scanUnits(text)) {
    const hits = OVERRIDE_PHRASES.filter((phrase) => unit.text.includes(phrase));
    if (hits.length === 0) continue;
    found.push(`${where} (${unitAt(unit)}): cancels the instruction beside it — \`${hits.join("`, `")}\` in ${unit.text.slice(0, 110)}`);
  }
  return found;
}

/** The lines of a section that name the MCP tool. The instruction is one of them, and only one. */
function instructionLines(text: string, tool: string): string[] {
  return text.split("\n").filter((line) => line.includes(tool) && !line.trim().startsWith("|"));
}

/**
 * The block the instruction sits in — the unit the gate has to share with it.
 *
 * Not the section. Measured at §9.3: `handoff-verify-failed` was already in that section before this
 * requirement, in the loop-H cap sentence `FR-FLOW-077` owns, so a section-wide `includes` was
 * satisfied by a neighbour's paragraph. Removing the gate from THIS requirement's own sentence left
 * the per-copy check green — the assertion looked like it held the wiring and held the section
 * instead. The other five places carry the gate exactly once, and this change introduced it there,
 * so the narrowing costs them nothing.
 *
 * A BLOCK rather than a LINE, because `§V.abort-run` puts its gate on the `게이트:` line beneath the
 * instruction — the convention every `§V` section uses — and that line has no blank line between it
 * and the instruction, so the two are one block. A line-scoped rule would refuse the convention.
 */
function instructionBlock(text: string, tool: string): string {
  const unit = scanUnits(text).find((entry) => entry.text.includes(tool));
  return unit === undefined ? "" : unit.text;
}

// ── which rendering each per-copy check actually opened ─────────────────────────────────────────

const OPENED: Array<{ readonly block: string; readonly relPath: string; readonly digest: string }> = [];

/** The bytes one rendering ships, hashed. Reads directly, so measuring does not enter the ledger. */
const digestOf = (relPath: string): string => createHash("md5").update(stripFrontmatter(readVariant(relPath))).digest("hex");

const bodyOf = (relPath: string): string => {
  const body = stripFrontmatter(readVariant(relPath));
  const running = String(expect.getState().currentTestName ?? "");
  const block = running.split(" > ").find((segment) => (COPIES as readonly string[]).includes(segment));
  OPENED.push({ block: block ?? "", relPath, digest: createHash("md5").update(body).digest("hex") });
  // Refused here, not reported below, because the ledger is a record and a record can be written
  // wrong: a recorder that logs the block title in place of the argument AND hashes the block's own
  // bytes in place of the ones that came back agrees with itself, and every ledger assertion then
  // holds while a per-copy check reads whichever rendering it likes. Neither side of this comparison
  // is something the recorder wrote — the left is the bytes going back to the caller, the right is
  // an independent read of the rendering the running block is named for.
  if (block !== undefined) {
    expect(
      createHash("md5").update(body).digest("hex"),
      `${block} was handed bytes that ${block} does not ship, so this check is answering for a rendering it never opened`
    ).toBe(digestOf(block));
  }
  return body;
};

interface RegisteredCheck {
  readonly block: string;
  readonly name: string;
  readonly ran: boolean;
}

/**
 * Every test Vitest REGISTERED for this file, from the task tree rather than from this file's source.
 *
 * `it.each(PLACES)` counted as a string in the source says how many blocks were written, not how many
 * checks exist: a block that reads one fixed rendering still contributes its share of that count.
 */
function registeredChecks(context: unknown): RegisteredCheck[] {
  const found: RegisteredCheck[] = [];
  const walk = (node: { tasks?: unknown[] } | undefined): void => {
    for (const child of node?.tasks ?? []) {
      const task = child as { type?: string; name?: string; mode?: string; suite?: { name?: string }; tasks?: unknown[] };
      if (task.type === "test") found.push({ block: task.suite?.name ?? "", name: task.name ?? "", ran: task.mode === "run" });
      walk(task);
    }
  };
  walk((context as { task?: { file?: { tasks?: unknown[] } } }).task?.file);
  return found;
}

/** The registered checks a `describe.each(COPIES)` block owns — one rendering per block title. */
function perCopyChecks(context: unknown): RegisteredCheck[] {
  return registeredChecks(context).filter((check) => (COPIES as readonly string[]).includes(check.block));
}

describe("FR-FLOW-168 the denominator and the map", () => {
  it("the requirement block, its notes and the triage note it reads exist", () => {
    expect(BLOCK, `${REQUIREMENT_ID} is not in ${SRS_PATH}`).not.toBe("");
    expect(NOTES.length, "the requirement carries no Implementation Notes to read the map out of").toBeGreaterThan(3);
    expect(TRIAGE_NOTES.length, `${TRIAGE_ID} carries no Implementation Notes, so the denominator would be empty`).toBeGreaterThan(18);
    expect(CLI_SOURCE.length, `${ORCHESTRATE_CLI} is empty, so the gate provenance reader would report every gate absent`).toBeGreaterThan(10000);
  });

  it("the five wired tools come from the triage requirement's destination note, and are registered tools", () => {
    expect(CARRIED_HERE, "the destination note must name the tools this follow-up carries").toHaveLength(floor("tools"));
    for (const tool of CARRIED_HERE) {
      expect(BINDING_OF.has(tool), `${tool} is wired here but is not in ORCHESTRATE_TOOL_BINDINGS`).toBe(true);
    }
    // The other follow-up's two are held here too, so one edit cannot move a tool between them: the
    // count above would stay at five while a tool the shared-contract item owns quietly joined.
    expect(CARRIED_ELSEWHERE, "the destination note must name the two tools plan 20 carries").toHaveLength(2);
    expect(
      CARRIED_ELSEWHERE.filter((tool) => CARRIED_HERE.includes(tool)),
      "a tool is claimed by both follow-ups, so one of the two landings has no owner"
    ).toEqual([]);
  });

  it("runs under floors the requirement names, so the wiring half cannot be emptied quietly", (context) => {
    expect(PLACES.length, "places the map declares").toBe(floor("places"));
    expect(new Set(PLACES.map((place) => place.tool)).size, "distinct tools across the places").toBe(floor("tools"));
    expect(COPIES, "kiwi-orchestrator ships three variants and is mirrored").toHaveLength(floor("copies"));
    expect(POLARITY_SURVIVES.length, "phrases the requirement holds the survival vocabulary to").toBe(floor("survives"));
    expect(POLARITY_OVERRIDES.length, "phrases the requirement holds the override vocabulary to").toBe(floor("overrides"));

    const registered = perCopyChecks(context);
    expect(registered.length, "the per-copy wiring checks this suite registers; an emptied map or a deleted block lowers the count").toBe(floor("checks"));
    for (const relPath of COPIES) {
      expect(
        registered.filter((check) => check.block === relPath).length,
        `${relPath}: the renderings do not carry the same per-copy checks, so the floor is met by one of them covering another`
      ).toBe(floor("checks") / floor("copies"));
    }
  });

  it("reads every floor the requirement names, so an unread bound cannot outlive its assertion", () => {
    const consumed = new Set([...readFileSync(SELF_PATH, "utf8").matchAll(/\bfloor\("([a-z]+)"\)/g)].map((match) => match[1] as string));
    expect(
      [...FLOORS.keys()].filter((name) => !consumed.has(name)),
      "a floor the requirement names is asserted nowhere in this file, so deleting the assertion that held it leaves the bound standing with nothing reading it"
    ).toEqual([]);
    expect(FLOORS.size, "the requirement names no floors, and a sweep with no bound is one nothing can shrink visibly").toBeGreaterThan(0);
  });

  it("the map names the same tools as the destination note, and every place is complete", () => {
    expect([...new Set(PLACES.map((place) => place.tool))].sort(), "the map and the destination note name different tools").toEqual([...CARRIED_HERE].sort());
    for (const place of PLACES) {
      expect(place.at, `${place.tool}: the map names no section`).not.toBe("");
      expect(place.gate, `${place.tool} at ${place.at}: the map names no gate, so the gate mutation would be vacuous`).not.toBe("");
      expect(place.cli, `${place.tool} at ${place.at}: the map names no CLI fallback`).not.toBe("");
      expect(place.cli.startsWith(`speckiwi orchestrate ${(BINDING_OF.get(place.tool) as OrchestrateToolBinding).path[0] as string} `), `${place.tool}: the citation is not this tool's own command family`).toBe(true);
    }
  });

  it("every gate the map names is one that tool's own handler can raise", () => {
    const unreachable = PLACES.filter((place) => !raisesGate(place.tool, place.gate)).map((place) => `${place.tool} cannot raise ${place.gate}`);
    expect(unreachable, "the map names a gate the tool's handler and its kernel modules never produce").toEqual([]);

    // Bracket matching breaks on an unbalanced parenthesis inside a comment or a string. Cutting
    // short fails closed — a shorter body reaches fewer modules and reports a gate absent — but
    // over-extending widens the module set and would let a gate the tool cannot raise pass. A body
    // that has run past its own handler carries the next leaf's registration.
    for (const tool of new Set(PLACES.map((place) => place.tool))) {
      const body = handlerBody(tool);
      expect(body, `${tool}: the handler body is empty, so every gate above would be reported absent`).not.toBe("");
      expect(body.includes('.command("'), `${tool}: the cut body runs past its own handler into another leaf's registration`).toBe(false);
    }

    // Both directions, so a reader that has stopped matching cannot report a clean tree. The second
    // is the selector case: `orchestrate_freeze` has no literal leaf anchor at all.
    expect(raisesGate("orchestrate_issue_open", "wave-issues-open"), "the reader no longer finds a gate this handler does raise").toBe(true);
    expect(raisesGate("orchestrate_freeze", "design-not-frozen"), "the selector fallback no longer reaches the freeze handler").toBe(true);
    expect(raisesGate("orchestrate_issue_open", "orchestrator-run-lock-held"), "the reader accepts a gate from another tool's path").toBe(false);
  });
});

describe("FR-FLOW-168 the citation an agent would follow", () => {
  it("carries every argument the binding declares mandatory", () => {
    const missing: string[] = [];
    for (const place of PLACES) {
      const tokens = tokensOf(place.cli);
      for (const flag of mandatoryFlags(place.tool)) {
        if (!tokens.includes(flag)) missing.push(`${place.tool} at ${place.at}: the citation omits the mandatory ${flag}`);
      }
    }
    expect(missing, "a citation followed as written would end at the tool's own argument error rather than at the gate").toEqual([]);
    // The comparison is only worth something if some tool actually declares one.
    expect(PLACES.flatMap((place) => mandatoryFlags(place.tool)).length, "no place cites a tool with a mandatory argument, so the check above bounds nothing").toBeGreaterThan(0);
  });

  it("names every leaf a selector chooses between, so one tool is cited under one spelling", () => {
    const missing: string[] = [];
    for (const place of PLACES) {
      for (const value of selectorValues(place.tool)) {
        if (!place.cli.includes(value)) missing.push(`${place.tool} at ${place.at}: the citation omits the selector value ${value}`);
      }
    }
    expect(missing, "a selector value left out of the citation is a leaf the skill never spells").toEqual([]);
    // Derived rather than restated: the freeze citation has to carry the six the code declares.
    const freeze = PLACES.find((place) => place.tool === "orchestrate_freeze");
    expect(freeze, "the map holds no freeze place, so the six targets are bounded by nothing").toBeDefined();
    for (const target of FREEZE_TARGETS) {
      expect((freeze as Place).cli.includes(target), `the freeze citation does not name the target ${target}`).toBe(true);
    }
    expect(FREEZE_TARGETS.length, "the freeze targets came from the code and there are six of them").toBeGreaterThan(1);
  });

  it("drives the two refusals the sections describe, rather than describing them", () => {
    // `orchestrate_issue_open` — the judgement the triage table judged as this tool's alone: the
    // ledger already carries the id. `closeWave` never looks at it.
    const row: IssueRow = {
      issueId: "ISS-1",
      wave: 1,
      class: ISSUE_CLASSES[0] as string,
      source: "loop-P",
      resolutionKind: null,
      resolutionRef: null,
      userDecisionRef: null,
      designLockDigest: null,
      deferralReason: null
    };
    expect(openIssue([], row).ok, "a first open of a well-formed row must be accepted, or the refusal below proves nothing").toBe(true);
    const duplicate = openIssue([row], { ...row });
    expect(duplicate.ok, "a second open of the same issue id was accepted, so the duplicate axis does not exist").toBe(false);
    expect(duplicate.violations.map((violation) => violation.code), "the refusal is not the duplicate-id one").toContain("issue-id-duplicate");

    // `orchestrate_freeze` — a body omitting a field its kind requires is refused. The fields come
    // out of the refusal itself and go back in, so the other direction is derived too.
    const kind = FREEZE_TARGETS[0] as FreezeLockKind;
    const inputs = { runId: "r1", gitBlobOid: "0".repeat(40), writtenAt: "2026-08-30T00:00:00.000Z", declaredInputs: {} };
    const refused = freezeLock(kind, {}, inputs);
    expect(refused.ok, `an empty ${kind} body was frozen, so the design-not-frozen axis does not exist`).toBe(false);
    const named = (refused as { detail: string }).detail.split("required field(s): ")[1] ?? "";
    const fields = named.split(", ").filter((field) => field.length > 0);
    expect(fields.length, "the refusal names no missing field, so the body below would be built from nothing").toBeGreaterThan(0);
    expect(freezeLock(kind, Object.fromEntries(fields.map((field) => [field, null])), inputs).ok, "a body carrying every field the refusal named was still refused").toBe(true);
  });

  it("the split §9.3 states between the six violation codes and the umbrella gate is the code's own", () => {
    // `§9.3` says three of the six violation codes are gate names in their own right and the other
    // three arrive under `handoff-verify-failed`. The handler collapses exactly that way, so the
    // sentence is a claim about two exported constants — and the numerals are read out of the shipped
    // sentence rather than typed here, because a claim compared only against itself is not compared.
    const named = HANDOFF_VIOLATION_CODES.filter((code) => (GATE_IDS as readonly string[]).includes(code));
    expect((GATE_IDS as readonly string[]).includes("handoff-verify-failed"), "the umbrella gate §9.3 names is not a declared gate").toBe(true);

    const numerals: Record<string, number> = { 둘: 2, 셋: 3, 넷: 4, 다섯: 5, 여섯: 6, 일곱: 7 };
    for (const relPath of COPIES) {
      const text = flat(sectionAt(stripFrontmatter(readVariant(relPath)), "§9.3"));
      const stated = /(\S+) 위반 코드 가운데 (\S+)은 그 자체로 [^,]*게이트 이름이고, 나머지 (\S+)은 우산 게이트 `([a-z-]+)` 로 온다/.exec(text);
      expect(stated, `${relPath}: §9.3 no longer states how the six violation codes split, so the constants below answer to nothing`).not.toBeNull();
      const [, total, asGates, underUmbrella, umbrella] = stated as RegExpExecArray;
      expect(numerals[total as string], `${relPath}: §9.3 states the wrong number of violation codes`).toBe(HANDOFF_VIOLATION_CODES.length);
      expect(numerals[asGates as string], `${relPath}: §9.3 states the wrong number of codes that are gate names themselves`).toBe(named.length);
      expect(numerals[underUmbrella as string], `${relPath}: §9.3 states the wrong number of codes reaching the umbrella`).toBe(HANDOFF_VIOLATION_CODES.length - named.length);
      expect(umbrella, `${relPath}: §9.3 names the wrong umbrella gate`).toBe("handoff-verify-failed");
    }
  });
});

describe("FR-FLOW-168 one tool, one spelling", () => {
  /** Occurrences of `tail` in `text`, split by whether `orchestrate ` immediately precedes them. */
  function spellings(text: string, tail: string): { bare: number; prefixed: number } {
    let bare = 0;
    let prefixed = 0;
    for (let at = text.indexOf(tail); at >= 0; at = text.indexOf(tail, at + tail.length)) {
      if (text.slice(Math.max(0, at - "orchestrate ".length), at) === "orchestrate ") prefixed += 1;
      else bare += 1;
    }
    return { bare, prefixed };
  }

  it.each([
    ["orchestrate_handoff_validate", "handoff validate"],
    ["orchestrate_freeze", "freeze handoff"]
  ])("%s is spelled with its command family everywhere the skill calls it", (_tool, tail) => {
    for (const relPath of COPIES) {
      const counted = spellings(stripFrontmatter(readVariant(relPath)), tail);
      expect(counted.prefixed, `${relPath}: no prefixed \`${tail}\` at all, so the count below is not a normalisation`).toBeGreaterThan(0);
      expect(counted.bare, `${relPath}: \`${tail}\` still appears without its command family, so two spellings of one tool coexist`).toBe(0);
    }
  });

  it("keeps both polarity vocabularies answering for themselves", () => {
    expect(new Set(POLARITY_SURVIVES).size, "two entries carrying one phrase would let either be deleted with the other covering for it").toBe(POLARITY_SURVIVES.length);
    expect(new Set(OVERRIDE_PHRASES).size, "two entries carrying one phrase would let either be deleted with the other covering for it").toBe(POLARITY_OVERRIDES.length);

    const shipped = COPIES.flatMap((relPath) => {
      const body = stripFrontmatter(readVariant(relPath));
      return PLACES.flatMap((place) => instructionLines(sectionAt(body, place.at), place.tool));
    });
    expect(shipped.length, "no instruction line was read, so the probe below would prove nothing").toBeGreaterThan(0);
    expect(
      POLARITY_SURVIVES.filter((phrase) => !shipped.some((line) => line.includes(phrase))),
      "a survival phrase no shipped instruction line carries bounds nothing"
    ).toEqual([]);

    const failures: string[] = [];
    for (const term of POLARITY_OVERRIDES) {
      if (!term.sample.includes(term.phrase)) {
        failures.push(`\`${term.phrase}\` no longer catches its own sample: ${term.sample}`);
        continue;
      }
      const covered = OVERRIDE_PHRASES.filter((phrase) => phrase !== term.phrase && term.sample.includes(phrase));
      if (covered.length > 0) failures.push(`\`${term.phrase}\` is not what catches its sample — ${covered.join(", ")} does`);
      if (POLARITY_SURVIVES.some((phrase) => term.sample.includes(phrase))) failures.push(`the sample for \`${term.phrase}\` also reads as survival`);
    }
    expect(failures, "a vocabulary probed only as a whole survives losing one alternative, and the cancellation it caught then passes").toEqual([]);
  });

  it("keeps the cancellation reader answering in both directions", () => {
    const real = sectionAt(stripFrontmatter(readVariant(COPIES[0] as string)), (PLACES[0] as Place).at);
    expect(real, "the first wired section is empty, so the probe below would prove nothing").not.toBe("");
    expect(cancellations(real, "shipped"), "the unmodified section must pass, or the reader is matching its own subject").toEqual([]);
    expect(
      cancellations(`${real}\n\n다만 이 호출은 필요하면 생략해도 된다.`, "probe").length,
      "a reader that has stopped matching reports nothing, which is what a clean tree reports"
    ).toBeGreaterThan(0);
  });
});

describe.each(COPIES)("%s", (relPath) => {
  it.each(PLACES)("names $tool inside $at, with its CLI fallback and its gate", (place) => {
    const text = sectionAt(bodyOf(relPath), place.at);
    expect(text, `${relPath}: ${place.at} does not exist`).not.toBe("");
    expect(text.includes(place.tool), `${relPath}: ${place.at} does not name ${place.tool}`).toBe(true);
    // Flattened, because the renderings wrap at different widths and a citation folded onto a second
    // line is the same instruction; reading the raw bytes would report a false red.
    expect(flat(text).includes(flat(place.cli)), `${relPath}: ${place.at} does not name the CLI fallback ${place.cli}`).toBe(true);
    // The BLOCK the instruction sits in, not the section: at §9.3 the section already carried this
    // gate in a neighbouring paragraph before this requirement, and a section-wide check was
    // satisfied by that paragraph with this requirement's own gate name deleted.
    const block = instructionBlock(text, place.tool);
    expect(block, `${relPath}: ${place.at} has no block naming ${place.tool}`).not.toBe("");
    expect(
      block.includes(place.gate),
      `${relPath}: ${place.at} names ${place.tool} but not the gate ${place.gate} beside it — a gate elsewhere in the section is a neighbour's sentence, not this instruction's verdict`
    ).toBe(true);
  });

  it.each(PLACES)("states the call for $tool at $at as an instruction rather than as an option", (place) => {
    const text = sectionAt(bodyOf(relPath), place.at);
    const sentence = text
      .split(/(?<=[.。]|다\.)\s/)
      .filter((part) => part.includes(place.tool) || part.includes(flat(place.cli)))
      .join(" ");
    expect(sentence, `${relPath}: ${place.at} carries no sentence naming ${place.tool}`).not.toBe("");
    expect(HEDGE.test(sentence), `${relPath}: ${place.at} hedges the call to ${place.tool}`).toBe(false);
  });

  it.each(PLACES)("says the call for $tool is made, and nowhere in $at takes it back", (place) => {
    const text = sectionAt(bodyOf(relPath), place.at);
    const lines = instructionLines(text, place.tool);
    expect(lines, `${relPath}: ${place.at} must name ${place.tool} on exactly one line`).toHaveLength(1);
    expect(
      POLARITY_SURVIVES.some((phrase) => (lines[0] as string).includes(phrase)),
      `${relPath}: ${place.at} names ${place.tool} without saying the call is made — presence does not separate an instruction from its negation`
    ).toBe(true);
    expect(cancellations(text, `${relPath}: ${place.at}`), "a block of the section takes the instruction back").toEqual([]);
  });
});

// Declared last on purpose: Vitest runs a file's tests in declaration order, so by the time this
// block runs every per-copy check above has recorded what it opened.
describe("FR-FLOW-168 what the per-copy checks read", () => {
  it("every per-copy check opened the rendering its own block is named for", (context) => {
    const registered = perCopyChecks(context);
    expect(registered.length, "no per-copy check is registered, so the ledger below has nothing to answer for").toBe(floor("checks"));

    // Against the checks that RAN rather than the checks that exist, so a `-t` filter narrows the
    // comparison instead of failing it. Each per-copy check opens exactly one rendering, and it
    // opens it before its first assertion, so a failing check is still counted here.
    const reads = OPENED.filter((opened) => opened.block !== "");
    expect(reads.length, "a per-copy check opened no rendering, or opened more than one").toBe(registered.filter((check) => check.ran).length);
    expect(
      reads.filter((opened) => opened.block !== opened.relPath).map((opened) => `${opened.block} opened ${opened.relPath}`),
      "a per-copy check read a rendering other than the one its block is named for"
    ).toEqual([]);
    expect(
      reads.filter((opened) => opened.digest !== digestOf(opened.block)).map((opened) => `${opened.block} was answered with bytes that are not its own`),
      "a per-copy check was handed a rendering's bytes under another rendering's name"
    ).toEqual([]);
  });
});
