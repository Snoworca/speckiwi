import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { ORCHESTRATE_TOOL_BINDINGS, autoGateInputFromPayload, type OrchestrateToolBinding } from "../../src/cli/commands/orchestrate.js";
import { AUTO_GATE_ACTIONS, GATE_IDS, decideAutoGate, type AutoGateInput } from "../../src/core/orchestrator/auto-gate.js";
import { EXTERNAL_PROOF_KINDS, PROOF_KINDS } from "../../src/core/orchestrator/journal-schema.js";
import { evaluateRound, projectRound, type Round } from "../../src/core/orchestrator/verification-gate.js";
import { RENDERINGS, flat, readRepoFile, scanUnits, sharedKiwiFiles, unitAt } from "./kiwi-renderings.js";

// @req FR-FLOW-169 AC-1 — the two tools come from FR-FLOW-167's destination note and the copy
// denominator from the `_shared/kiwi/` directory, never from a list written here.
// @req FR-FLOW-169 AC-2 — every rendering names the command at each of the three places, beside the
// token that carries its verdict, inside the block the instruction sits in.
// @req FR-FLOW-169 AC-3 — a token named is one that tool's own path produces, read from source and
// confirmed by running the kernel.
// @req FR-FLOW-169 AC-4 — a citation carries every argument the binding AND the handler demand.
// @req FR-FLOW-169 AC-8 — what this file does and does not guarantee, measured rather than inferred.
//
// ─── WHAT THIS FILE GUARANTEES ──────────────────────────────────────────────────────────────────
//
// (1) The denominator, from two directions. The two tools are read out of `FR-FLOW-167`'s
// destination note — the note that split its seven wiring follow-ups by the file they land in — and
// each is checked against `ORCHESTRATE_TOOL_BINDINGS`; the five that note sent to plan 19 are held
// disjoint from them, so one edit cannot move a tool between the follow-ups while the count stays
// at two. The copies are `sharedKiwiFiles()` — the same corpus derivation `FR-FLOW-158` sweeps —
// narrowed to the file names the map declares, so a rendering that stops shipping the directory
// shrinks a measured number rather than passing silently.
//
// (2) The wiring. For each of the three (tool, file, section) places the map declares, all four
// renderings name the MCP tool and the CLI fallback inside that section and carry the verdict token
// in the BLOCK the instruction sits in. Section and token come from the map, not from the section
// being read: a token derived from the section it is asserted about is satisfied by deleting it
// from both sides at once.
//
// (3) That the section is found at all, in a corpus whose renderings are not one language.
// `auto-option.md` is Korean in `skills/claude` and English in the other three, so the map carries
// both headings and the reader requires EXACTLY ONE of them to match. Which alternative matched is
// what selects the polarity vocabulary below; there is no language flag anywhere else.
//
// (4) That each token is one the tool's own path produces, in the one of two shapes that applies.
// `orchestrate_round_record` refuses at a gate, read by `FR-FLOW-167`'s provenance reader from the
// `refuse` names in the `.action` body its binding path cuts out. `orchestrate_auto_gate` raises no
// gate at all — asserted, not assumed — and its verdict is an action from the closed vocabulary its
// kernel returns, reached from the handler body through the module that exports it. Both are then
// RUN: `projectRound` returns null for a scope outside the vocabulary, which is what makes the
// handler refuse; `decideAutoGate` returns the escalation for a critical ballot even when an option
// carries a recommendation, and returns something else when it is not critical; and
// `autoGateInputFromPayload` refuses a gate id outside `GATE_IDS`.
//
// (5) That an agent following the citation reaches the judgement rather than the tool's own
// argument error. Mandatory arguments come from the binding's `required` options AND from the
// handler body's own `requireOption` / `parseInlineJson` calls — `orchestrate_round_record` demands
// `--run-id` and `--payload` there while its binding marks neither, so the binding alone admits a
// citation that ends at an argument error.
//
// The reach of all of it is bounded by FLOORS read out of the requirement — `tools`, `places`,
// `copies`, `files`, `corpus`, `checks`, `survives`, `sustains`, `overrides`, `retracts` — because a
// reach written as a literal here cannot be defended by the checks it bounds. `checks` is counted
// from the tasks the runner registered rather than from `it.each(PLACES)` counted in this source.
//
// ─── WHAT THIS FILE DOES NOT GUARANTEE ──────────────────────────────────────────────────────────
// That an agent calls either tool. Nothing here observes a run: a run whose agent read the
// instruction and skipped it completes normally and this file stays green.
//
// That a contradiction outside the three sections the map names is caught. A sentence elsewhere in
// `verify-loop.md` or `auto-option.md` retracting one of the three instructions is invisible here.
//
// That the MCP parameter names the wiring sentence cites exist on that tool. Only the CLI flags are
// held, and only against the binding's `required` set plus the handler's own demands.
//
// That the action derivation says more than membership. `escalate-critical` is checked to be a
// member of `AUTO_GATE_ACTIONS` and that vocabulary is checked to be reachable from the handler;
// rewriting the token to a DIFFERENT member of the same vocabulary passes.
//
// That the ledger below separates `skills/codex` from `.agents/skills`. The mirror is a byte copy of
// codex for both files in this corpus — measured, the md5 pairs are equal — so a per-copy check
// answering for one under the other's name is caught by the ledger's PATH axis alone, and the digest
// comparison cannot tell them apart. `FR-FLOW-167` recorded the same residue.
//
// That a negation or a retraction worded outside the closed vocabularies is caught. Both readers are
// SCANS, and the floors keep the vocabularies from shrinking rather than making them complete.
//
// ─── BASELINE, MEASURED BEFORE THE SHARED FILES WERE TOUCHED ────────────────────────────────────
// Over `skills/` and `.agents/skills/` (153 markdown files) each of these was 0: the two tool names
// `orchestrate_round_record` and `orchestrate_auto_gate`; the two citations `speckiwi orchestrate
// round record` and `speckiwi orchestrate auto-gate decide`; `escalate-critical`; `--proof`;
// `gateId`. These were 0 over the eight TARGET copies but NOT over the whole tree, and the two
// ranges are kept apart because merging them reads as a cleanup or a clash that never happened:
// `invalid-run-scope-option` 8, `--payload` 8 and `<payload>` 8, all three confined to
// `kiwi-orchestrator`; `proof_kind` 8, two in each copy of `waves-event.md`; `run-invariant-drift`
// 44, eight per rendering in `kiwi-orchestrator` and three in each copy of `run-ledger.md`;
// `waves-event.md` 23; and `--run-id` 42, which is NOT confined to `kiwi-orchestrator` — 32 sit
// there, 6 in `kiwi-wave-master` and 4 in `_shared/kiwi/waves-event.md`, one per rendering of a
// shared contract file. Already present in the target copies, and not introduced here: `<id>` 4,
// `<path>` 8, `unapproved-damage` 16, `wave-verify-fail-residual` 4, `verification-oscillation` 4,
// `recommended-fastpath` 12, `default-if-auto` 12, `external-module-impact` 8,
// `self-recursive-spawn` 4, `mcp-cli-both-unavailable` 1.

const SELF_PATH = fileURLToPath(import.meta.url);
const SRS_PATH = "docs/spec/60.workflow-release.srs.md";
const ORCHESTRATE_CLI = "src/cli/commands/orchestrate.ts";
const REQUIREMENT_ID = "FR-FLOW-169";
const TRIAGE_ID = "FR-FLOW-167";

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
 * The same shape `FR-FLOW-158`, `FR-FLOW-164`, `FR-FLOW-167` and `FR-FLOW-168` use, and for the same
 * reason: a literal reach cannot be defended by the checks it bounds — lower it and the sweep
 * shrinks while every assertion stays green. Narrowing this sweep is a requirement diff.
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

/** The two `FR-FLOW-167` assigned to this follow-up, and the five it assigned to the other one. */
const CARRIED_HERE = destinedFor("파일에 착지하는 둘(", "20");
const CARRIED_ELSEWHERE = destinedFor("본문에 착지하는 다섯(", "19");

/** Every markdown file under `_shared/kiwi/`, in every rendering that ships the directory. */
const CORPUS = sharedKiwiFiles();

// ── the wiring map ──────────────────────────────────────────────────────────────────────────────

interface Place {
  /** The MCP tool whose judgement this place carries. */
  readonly tool: string;
  /** The shared contract file it lands in, by basename. */
  readonly file: string;
  /** The section, as one or more heading substrings the map separates with `|`. */
  readonly at: string;
  /** The token that carries this tool's verdict at this place. */
  readonly token: string;
  /** How that token is derived: a refusal gate, or a member of a returned action vocabulary. */
  readonly kind: "gate" | "action";
  /** The CLI fallback the section must cite. */
  readonly cli: string;
}

/**
 * The map, read from the requirement rather than from the sections it governs.
 *
 * Deriving the token from the section under test would make the token mutation vacuous: removing it
 * from the section would remove it from the expectation in the same edit. The citations live in a
 * second note because one note is capped at 500 characters.
 */
function wiringMap(): Place[] {
  const rows = [...lastNote("배선 지도 (AC-2) 자리").matchAll(/`(orchestrate_[a-z_]+)` → `([a-z-]+\.md)` \/ `([^`]+)` → 토큰 `([a-z-]+)` \((gate|action)\)/g)];
  const citations = [...lastNote("배선 지도 (AC-2) 인용").matchAll(/`(speckiwi orchestrate [^`]+)`/g)].map((match) => match[1] as string);
  return rows.map((match, index) => ({
    tool: match[1] as string,
    file: match[2] as string,
    at: match[3] as string,
    token: match[4] as string,
    kind: match[5] as Place["kind"],
    cli: citations[index] ?? ""
  }));
}

const PLACES = wiringMap();

/** The copies the map's files have, taken from the corpus rather than composed from the renderings. */
const TARGET_COPIES = CORPUS.filter((relPath) => PLACES.some((place) => relPath.endsWith(`/_shared/kiwi/${place.file}`)));

// ── reading one section of one rendering ────────────────────────────────────────────────────────

const HEADING = /^#{1,6}\s/;

/**
 * The section a map token names, and WHICH of the map's heading spellings found it.
 *
 * `null` unless exactly one heading matches exactly one alternative. Two matches would let a check
 * silently read whichever came first; zero is a section that has been renamed out from under the
 * map. The index of the matched alternative is the language: alternative 0 is the Korean heading
 * `skills/claude` ships and everything after it is the English one the other three ship, which is
 * how the polarity vocabularies below are selected without a flag written anywhere.
 */
function sectionAt(body: string, at: string): { text: string; alternative: number } | null {
  const alternatives = at.split("|");
  const lines = body.split("\n");
  const hits: Array<{ line: number; alternative: number }> = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] as string;
    if (!HEADING.test(line)) continue;
    const alternative = alternatives.findIndex((candidate) => line.includes(candidate));
    if (alternative !== -1) hits.push({ line: index, alternative });
  }
  if (hits.length !== 1) return null;
  const hit = hits[0] as { line: number; alternative: number };
  let end = lines.length;
  for (let index = hit.line + 1; index < lines.length; index += 1) {
    if (HEADING.test(lines[index] as string)) {
      end = index;
      break;
    }
  }
  return { text: lines.slice(hit.line, end).join("\n").replace(/\s+$/, ""), alternative: hit.alternative };
}

// ── token provenance ────────────────────────────────────────────────────────────────────────────

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
 * The registration anchors one binding's leaf can be written under.
 *
 * `FR-FLOW-167`'s reader builds the anchor from the binding path alone, which assumes the namespace
 * variable is spelled the way the CLI names it. `orchestrate auto-gate` is held in `autoGate`, so
 * `auto-gate.command("decide")` matches nothing and the body comes back EMPTY — and an empty body
 * reports every token absent AND reports "this handler refuses at no gate" as though it had been
 * read. Measured: without the camelCase anchor the action assertion below failed and the
 * no-refusal assertion beside it passed for that reason rather than from the source.
 */
function handlerAnchors(binding: OrchestrateToolBinding): string[] {
  const leaf = binding.path.at(-1) as string;
  const joined = binding.path.slice(0, -1).join("");
  const camel = joined.replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase());
  return [...new Set([joined, camel])].map((parent) => `${parent}.command("${leaf}")`);
}

/**
 * The `.action` callback of one tool's CLI leaf, by bracket matching from its registration.
 *
 * `FR-FLOW-167`'s reader, with `FR-FLOW-168`'s selector fallback kept: neither binding here needs it
 * — both leaves are registered under a literal name — but removing it would make the two suites
 * disagree about what a handler body is.
 */
function handlerBody(tool: string): string {
  const binding = BINDING_OF.get(tool);
  if (binding === undefined) return "";
  let at = -1;
  for (const anchor of handlerAnchors(binding)) {
    at = CLI_SOURCE.indexOf(anchor);
    if (at !== -1) break;
  }
  if (at === -1 && binding.selector !== undefined) at = CLI_SOURCE.indexOf(`${binding.path.slice(0, -1).join("")}.command(`);
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
  return readRepoFile(path.posix.join(path.posix.dirname(ORCHESTRATE_CLI), specifier.replace(/\.js$/, ".ts")));
}

/** Whether `gate` is a name this tool's own handler refuses at. */
function refusesAt(tool: string, gate: string): boolean {
  const body = handlerBody(tool);
  if (body === "") return false;
  return body.includes(`refuse("${gate}"`);
}

/** The gate names one handler refuses at, whatever they are. */
function refusalGates(tool: string): string[] {
  return [...handlerBody(tool).matchAll(/refuse\("([a-z-]+)"/g)].map((match) => match[1] as string);
}

/** Whether `action` is a member of a closed vocabulary a module this handler reaches exports. */
function returnsAction(tool: string, action: string): boolean {
  if (!(AUTO_GATE_ACTIONS as readonly string[]).includes(action)) return false;
  const modules = handlerModules(handlerBody(tool));
  return modules.some((module) => moduleSource(module).includes(`"${action}"`) && moduleSource(module).includes("AUTO_GATE_ACTIONS"));
}

// ── the arguments a citation has to carry ───────────────────────────────────────────────────────

/** The long flags the binding declares mandatory for this tool. */
function bindingFlags(tool: string): string[] {
  return (BINDING_OF.get(tool)?.options ?? []).filter((option) => option.required === true).map((option) => option.flag);
}

/**
 * The long flags the HANDLER BODY itself demands, which is a different set from the binding's.
 *
 * `orchestrate_round_record` marks only `--proof` required on its binding while its body calls
 * `requireOption(options.runId, "--run-id")` and `parseInlineJson(options.payload, "--payload")`.
 * A citation checked against the binding alone therefore passes while an agent following it ends at
 * an argument error rather than at the judgement.
 */
function handlerFlags(tool: string): string[] {
  const body = handlerBody(tool);
  return [...body.matchAll(/(?:requireOption|parseInlineJson)\([^)]*?"(--[a-z-]+)"/g)].map((match) => match[1] as string);
}

/** Every flag a citation of this tool has to carry, from both sources. */
const mandatoryFlags = (tool: string): string[] => [...new Set([...bindingFlags(tool), ...handlerFlags(tool)])];

/** The whitespace-separated tokens of a citation, so a flag is compared whole rather than as a substring. */
const tokensOf = (cli: string): string[] => cli.trim().split(/\s+/);

// ── the wording the instruction has to keep, and the wording the section may not carry ──────────

/** Hedges that would turn an instruction into a suggestion, read over the sentence naming the tool. */
const HEDGE: readonly RegExp[] = [
  /수 있다|해도 된다|권장|바람직|가능하면|되도록|가급적|필요하면|것이 좋다|선택적|생략해도/,
  /\bmay\b|\bmight\b|optional|if desired|where convenient|can be skipped|at your discretion/i
];

/**
 * The verbs in which the shipped instruction lines say the call is MADE, one list per language.
 *
 * READ OFF the shipped text rather than invented, and required of the INSTRUCTION LINE alone — the
 * line that names the MCP tool — because that is the sentence the map is about. Checking only for
 * the tool NAME on that line is what `FR-FLOW-167` measured green under a sentence carrying the name
 * while saying the opposite.
 */
const SURVIVES: readonly (readonly string[])[] = [
  ["받는다", "넘긴다"],
  ["hand it", "take the verdict"]
];

/** A closed-vocabulary term with the sample only it catches, the shape `FR-FLOW-164` established. */
interface PolarityTerm {
  readonly phrase: string;
  readonly sample: string;
}

/**
 * The cancellations no BLOCK of a wired section may carry, one entry per phrase, one list per
 * language.
 *
 * SCANNED OVER THE WHOLE SECTION, block by block, unlike `SURVIVES`: what a retraction has to be
 * read over is the section and not the sentence, because a sentence carrying neither the tool name
 * nor the citation never joins the hedge reader's subject at all. Blocks rather than lines because a
 * phrase folded across a soft line break is carried by neither line while the rendered paragraph
 * reads as one — and the English renderings of `auto-option.md` DO wrap mid-sentence.
 *
 * Two phrases `FR-FLOW-168` carries are deliberately absent, each measured present in a shipped
 * target section: `쓰지 않는다`, which `## 3. 결정 규칙` writes as `덮어쓰지 않는다` about the critical
 * halt, and `is not required`, which `## Decision Rule` writes about unanimity. Both are the rule
 * rather than its cancellation, and a list carrying them would refuse shipped text.
 */
const OVERRIDES: readonly (readonly PolarityTerm[])[] = [
  [
    { phrase: "부르지 않", sample: "이 절에서는 그 도구를 부르지 않고 넘어간다." },
    { phrase: "호출하지 않", sample: "그 명령을 호출하지 않은 채 진행한다." },
    { phrase: "생략해도", sample: "이 판정은 필요하면 생략해도 된다." },
    { phrase: "건너뛴다", sample: "이 판정은 건너뛴다." },
    { phrase: "필수가 아니다", sample: "이 판정은 필수가 아니다." },
    { phrase: "선택이다", sample: "이 명령을 부를지는 선택이다." },
    { phrase: "폐기한다", sample: "위 지시는 이번 판에서 폐기한다." },
    { phrase: "강제하지 않는다", sample: "이 절은 그 판정을 강제하지 않는다." },
    { phrase: "무시하고 진행", sample: "돌아온 값을 무시하고 진행한다." },
    { phrase: "손으로 대조한다", sample: "이 표의 PASS 조건은 손으로 대조한다." }
  ],
  [
    { phrase: "do not call", sample: "In this section do not call that tool at all." },
    { phrase: "without calling", sample: "Resolve the gate without calling anything." },
    { phrase: "skip this call", sample: "Under time pressure, skip this call." },
    { phrase: "is optional", sample: "Taking the verdict is optional." },
    { phrase: "by hand instead", sample: "Walk the four steps by hand instead." },
    { phrase: "need not", sample: "The caller need not reach for the tool." },
    { phrase: "is withdrawn", sample: "The instruction above is withdrawn." },
    { phrase: "ignore the verdict", sample: "A lane in a hurry will ignore the verdict and carry on." },
    { phrase: "no call is made", sample: "Here no call is made." },
    { phrase: "not mandatory", sample: "Taking that verdict is not mandatory." }
  ]
];

/** The blocks of a section that cancel the instruction beside them, in the section's own language. */
function cancellations(text: string, alternative: number, where: string): string[] {
  const phrases = (OVERRIDES[alternative] ?? []).map((term) => term.phrase);
  const found: string[] = [];
  for (const unit of scanUnits(text)) {
    const hits = phrases.filter((phrase) => unit.text.includes(phrase));
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
 * The block the instruction sits in — the unit the verdict token has to share with it.
 *
 * Not the section. `FR-FLOW-168` measured a section-wide `includes` satisfied by a NEIGHBOUR's
 * paragraph that carried the same gate name, which left the per-copy check green with this
 * requirement's own token deleted. A block is the unit a renderer draws, and it is what a reader
 * takes as one sentence.
 */
function instructionBlock(text: string, tool: string): string {
  const unit = scanUnits(text).find((entry) => entry.text.includes(tool));
  return unit === undefined ? "" : unit.text;
}

// ── which rendering each per-copy check actually opened ─────────────────────────────────────────

const OPENED: Array<{ readonly block: string; readonly relPath: string; readonly digest: string }> = [];

const md5 = (text: string): string => createHash("md5").update(text).digest("hex");

/** The bytes one copy ships, hashed. Reads directly, so measuring does not enter the ledger. */
const digestOf = (relPath: string): string => md5(readRepoFile(relPath));

/**
 * One copy's text, with the ledger entry and the refusal that keeps the ledger honest.
 *
 * The refusal is here, not reported below, because the ledger is a record and a record can be
 * written wrong: a recorder that logs the block title in place of the argument AND hashes the
 * block's own bytes in place of the ones that came back agrees with itself. Neither side of this
 * comparison is something the recorder wrote — the left is the bytes going back to the caller, the
 * right is an independent read of the path the running block is named for.
 */
function bodyOf(rendering: string, file: string): string {
  const relPath = `${rendering}/_shared/kiwi/${file}`;
  const raw = readRepoFile(relPath);
  const running = String(expect.getState().currentTestName ?? "");
  const block = running.split(" > ").find((segment) => (RENDERINGS as readonly string[]).includes(segment));
  OPENED.push({ block: block ?? "", relPath, digest: md5(raw) });
  if (block !== undefined) {
    expect(
      md5(raw),
      `${block} was handed bytes that ${block} does not ship, so this check is answering for a rendering it never opened`
    ).toBe(digestOf(`${block}/_shared/kiwi/${file}`));
  }
  // Line endings differ per FILE in this corpus — `verify-loop.md` ships LF and `auto-option.md`
  // CRLF — so every pattern check below reads one normalisation while the digest above reads bytes.
  return raw.replace(/\r\n/g, "\n");
}

interface RegisteredCheck {
  readonly block: string;
  readonly name: string;
  readonly ran: boolean;
}

/** Every test Vitest REGISTERED for this file, from the task tree rather than from this source. */
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

/** The registered checks a `describe.each(RENDERINGS)` block owns — one rendering per block title. */
function perCopyChecks(context: unknown): RegisteredCheck[] {
  return registeredChecks(context).filter((check) => (RENDERINGS as readonly string[]).includes(check.block));
}

describe("FR-FLOW-169 the denominator and the map", () => {
  it("the requirement block, its notes and the triage note it reads exist", () => {
    expect(BLOCK, `${REQUIREMENT_ID} is not in ${SRS_PATH}`).not.toBe("");
    expect(NOTES.length, "the requirement carries no Implementation Notes to read the map out of").toBeGreaterThan(1);
    expect(TRIAGE_NOTES.length, `${TRIAGE_ID} carries no Implementation Notes, so the denominator would be empty`).toBeGreaterThan(18);
    expect(CLI_SOURCE.length, `${ORCHESTRATE_CLI} is empty, so the provenance reader would report every token absent`).toBeGreaterThan(10000);
  });

  it("the two wired tools come from the triage requirement's destination note, and are registered tools", () => {
    expect(CARRIED_HERE, "the destination note must name the tools this follow-up carries").toHaveLength(floor("tools"));
    for (const tool of CARRIED_HERE) {
      expect(BINDING_OF.has(tool), `${tool} is wired here but is not in ORCHESTRATE_TOOL_BINDINGS`).toBe(true);
    }
    // The other follow-up's five are held here too, so one edit cannot move a tool between them: the
    // count above would stay at two while a tool the body item owns quietly joined.
    expect(CARRIED_ELSEWHERE, "the destination note must name the five tools plan 19 carries").toHaveLength(5);
    expect(
      CARRIED_ELSEWHERE.filter((tool) => CARRIED_HERE.includes(tool)),
      "a tool is claimed by both follow-ups, so one of the two landings has no owner"
    ).toEqual([]);
  });

  it("runs under floors the requirement names, so the wiring half cannot be emptied quietly", (context) => {
    expect(PLACES.length, "places the map declares").toBe(floor("places"));
    expect(new Set(PLACES.map((place) => place.tool)).size, "distinct tools across the places").toBe(floor("tools"));
    expect(new Set(PLACES.map((place) => place.file)).size, "distinct shared contract files across the places").toBe(floor("files"));
    expect(RENDERINGS, "three variants ship and one mirror is generated").toHaveLength(floor("copies"));
    expect(CORPUS.length, "the `_shared/kiwi/` corpus FR-FLOW-158 owns; a rendering that stops shipping it lowers this").toBe(floor("corpus"));
    expect(TARGET_COPIES, "the map's two files, once per rendering, taken from the corpus rather than composed").toHaveLength(floor("files") * floor("copies"));
    expect(SURVIVES.flat().length, "phrases the requirement holds the survival vocabularies to").toBe(floor("survives") + floor("sustains"));
    expect(OVERRIDES[0], "phrases the requirement holds the Korean override vocabulary to").toHaveLength(floor("overrides"));
    expect(OVERRIDES[1], "phrases the requirement holds the English override vocabulary to").toHaveLength(floor("retracts"));

    const registered = perCopyChecks(context);
    expect(registered.length, "the per-copy wiring checks this suite registers; an emptied map or a deleted block lowers the count").toBe(floor("checks"));
    for (const rendering of RENDERINGS) {
      expect(
        registered.filter((check) => check.block === rendering).length,
        `${rendering}: the renderings do not carry the same per-copy checks, so the floor is met by one of them covering another`
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
      expect(place.token, `${place.tool} at ${place.at}: the map names no verdict token, so the token mutation would be vacuous`).not.toBe("");
      expect(place.cli, `${place.tool} at ${place.at}: the map names no CLI fallback`).not.toBe("");
      expect(
        place.cli.startsWith(`speckiwi orchestrate ${(BINDING_OF.get(place.tool) as OrchestrateToolBinding).path[0] as string} `),
        `${place.tool}: the citation is not this tool's own command family`
      ).toBe(true);
      expect(
        CORPUS.some((relPath) => relPath.endsWith(`/_shared/kiwi/${place.file}`)),
        `${place.tool}: the map names ${place.file}, which is not in the shared corpus`
      ).toBe(true);
    }
  });

  it("every token the map names is one that tool's own path produces, in the shape the map declares", () => {
    // FIRST, because an empty body answers "produces no token" and "refuses at no gate" alike, and
    // the second of those is an assertion this requirement rests on. Bracket matching also breaks on
    // an unbalanced parenthesis inside a comment or a string: cutting short fails closed, while
    // over-extending would swallow the next leaf's registration and widen the module set.
    for (const tool of new Set(PLACES.map((place) => place.tool))) {
      const body = handlerBody(tool);
      expect(body, `${tool}: the handler body is empty, so every token below would be reported absent`).not.toBe("");
      expect(body.includes('.command("'), `${tool}: the cut body runs past its own handler into another leaf's registration`).toBe(false);
    }

    const wrong: string[] = [];
    for (const place of PLACES) {
      const produced = place.kind === "gate" ? refusesAt(place.tool, place.token) : returnsAction(place.tool, place.token);
      if (!produced) wrong.push(`${place.tool} does not produce ${place.token} as a ${place.kind}`);
    }
    expect(wrong, "the map names a token the tool's own handler and its kernel never produce").toEqual([]);

    // The asymmetry, asserted rather than assumed: one handler refuses at gates and the other
    // refuses at none, which is why the map carries a `kind` column at all.
    //
    // The round handler refuses at TWO, and the exact set is asserted rather than membership alone.
    // The second is the append path's — a landed line that breaks the journal contract — and the map
    // names the first because that is the judgement this section is about. Written as a negative
    // ("the reader accepts a gate from another tool") this was FALSE: `run-invariant-drift` is in
    // this very body, and the assertion failed on correct source until it was measured.
    expect(refusalGates("orchestrate_round_record").sort(), "the gates the round handler refuses at are not the two measured here").toEqual([
      "invalid-run-scope-option",
      "run-invariant-drift"
    ]);
    expect(refusalGates("orchestrate_auto_gate"), "the auto-gate handler now raises a gate, so the action shape is no longer the only one available to it").toEqual([]);

    // Both directions, so a reader that has stopped matching cannot report a clean tree.
    expect(refusesAt("orchestrate_round_record", "wave-issues-open"), "the gate reader accepts a gate from another tool's path").toBe(false);
    expect(returnsAction("orchestrate_auto_gate", "invalid-run-scope-option"), "the action reader accepts a name outside the returned vocabulary").toBe(false);
    expect((GATE_IDS as readonly string[]).includes("invalid-run-scope-option"), "the gate the round record refuses at is not a declared gate id").toBe(true);
  });

  it("drives both kernels to the verdicts the sections name, rather than describing them", () => {
    // `orchestrate_round_record` — the refusal is reached through `projectRound` returning null,
    // which is the only thing between the handler and its `refuse` call.
    const round: Round = {
      loop: "P",
      scope: "wave-1-post",
      roundIndex: 1,
      mode: "normal",
      cap: 5,
      streakBefore: 0,
      frozenDenominator: 1,
      rows: [{ id: "R-1", verdict: "pass", severity: "LOW" }],
      fixAppliedThisRound: false,
      regression: { failingTests: [], baselineFailingTests: [], exitCode: 0 },
      residual: []
    };
    const outcome = evaluateRound(round);
    expect(projectRound(round, outcome), "a well-formed round no longer projects, so the refusal below proves nothing").not.toBeNull();
    expect(projectRound({ ...round, scope: "not-a-scope" }, outcome), "a scope outside the closed vocabulary was projected, so the refusal has no trigger").toBeNull();
    expect(projectRound({ ...round, scope: "wave-1" }, outcome), "a scope belonging to another loop was projected, so half the refusal has no trigger").toBeNull();

    // `orchestrate_auto_gate` — critical is read before both bypasses, so a recommendation cannot
    // buy past it. Asserted in both directions, or the escalation would look unconditional.
    const ballot: AutoGateInput = {
      gateId: "external-module-impact",
      critical: true,
      options: [{ id: "proceed", recommended: true, defaultIfAuto: false }],
      mode: "auto",
      votes: null,
      quorum: { expected: 3, present: 3 },
      tieRung: false
    };
    expect(decideAutoGate(ballot).action, "a critical ballot no longer escalates, so the severity row names a verdict the tool does not give").toBe("escalate-critical");
    expect(decideAutoGate({ ...ballot, critical: false }).action, "the escalation is unconditional, so `critical` decides nothing").toBe("adopt-recommended");
    expect(
      decideAutoGate({ ...ballot, critical: false, options: [{ id: "proceed", recommended: false, defaultIfAuto: false }], quorum: { expected: 3, present: 2 } }).action,
      "a degraded quorum no longer escalates"
    ).toBe("escalate-critical");

    // And the closed gate vocabulary the decision-rule section states the tool refuses outside of.
    expect(() => autoGateInputFromPayload({ ...ballot, gateId: "not-a-declared-gate" } as unknown as Record<string, unknown>)).toThrow(/closed GateId vocabulary/);
    expect(autoGateInputFromPayload(ballot as unknown as Record<string, unknown>).gateId, "a declared gate id was refused, so the refusal above is not about the vocabulary").toBe("external-module-impact");
  });
});

describe("FR-FLOW-169 the citation an agent would follow", () => {
  it("carries every argument the binding and the handler each demand", () => {
    const missing: string[] = [];
    for (const place of PLACES) {
      const tokens = tokensOf(place.cli);
      for (const flag of mandatoryFlags(place.tool)) {
        if (!tokens.includes(flag)) missing.push(`${place.tool} at ${place.at}: the citation omits the mandatory ${flag}`);
      }
    }
    expect(missing, "a citation followed as written would end at the tool's own argument error rather than at the judgement").toEqual([]);

    // The two sources are held apart, because the whole point is that they differ: reading only the
    // binding admits a `round record` citation with neither `--run-id` nor `--payload`.
    expect(bindingFlags("orchestrate_round_record"), "the binding's required set is not what it was measured to be").toEqual(["--proof"]);
    expect(handlerFlags("orchestrate_round_record").sort(), "the handler no longer demands the two flags its binding leaves optional").toEqual(["--payload", "--proof", "--run-id"]);
    expect(mandatoryFlags("orchestrate_auto_gate"), "the auto-gate citation is bounded by nothing").toContain("--payload");
  });

  it("tells the round-record caller what a proof has to be, because the citation alone does not reach the verdict", () => {
    // Measured by running the citation: a `--proof` whose kinds are all recomputable only from the
    // journal is refused at `run-invariant-drift` — the SECOND gate that handler raises — so an
    // agent following `--proof <payload>` with a plausible shape never sees a verdict at all. The
    // vocabulary is not restated here: this sentence points at the file that owns it and names the
    // refusal, which is the tool's behaviour rather than the journal contract's.
    const place = PLACES.find((entry) => entry.tool === "orchestrate_round_record") as Place;
    for (const rendering of RENDERINGS) {
      const found = sectionAt(readRepoFile(`${rendering}/_shared/kiwi/${place.file}`).replace(/\r\n/g, "\n"), place.at);
      const block = instructionBlock((found as { text: string }).text, place.tool);
      expect(block, `${rendering}: the round-record instruction block does not name proof_kind's owner`).toContain("`waves-event.md` 의 `proof_kind`");
      expect(block, `${rendering}: the round-record instruction block does not name the refusal a bad proof reaches`).toContain("run-invariant-drift");
    }
    // Both halves of that sentence derived: the vocabulary it points at exists and is a proper
    // subset of the kinds, and the refusal it names is one this handler raises.
    expect(EXTERNAL_PROOF_KINDS.length, "no proof kind is recomputable outside the journal, so the sentence describes nothing").toBeGreaterThan(0);
    expect(PROOF_KINDS.filter((kind) => !(EXTERNAL_PROOF_KINDS as readonly string[]).includes(kind)), "every kind is external, so the sentence's distinction is empty").not.toEqual([]);
    expect(refusalGates("orchestrate_round_record"), "the refusal the sentence names is not one this handler raises").toContain("run-invariant-drift");
  });

  it("uses only placeholder forms FR-NODE-128 declares", () => {
    const declared = new Set(["<path>", "<path to routing/route-gate.json>", "<sha>", "<id>", "<payload>", "<manifest…>", "<v>", "<t>", "N", "S", "L", "{run_id}", "a|b|c"]);
    const outside = PLACES.flatMap((place) => tokensOf(place.cli).filter((token) => token.startsWith("<") && !declared.has(token)));
    expect(outside, "a citation carries a placeholder outside the thirteen declared forms").toEqual([]);
    expect(PLACES.flatMap((place) => tokensOf(place.cli).filter((token) => token.startsWith("<"))).length, "no citation carries a placeholder at all, so the check above bounds nothing").toBeGreaterThan(0);
  });
});

describe("FR-FLOW-169 one instruction, not its negation", () => {
  it("keeps both polarity vocabularies answering for themselves, in both languages", () => {
    for (const list of SURVIVES) expect(new Set(list).size, "two entries carrying one phrase would let either be deleted with the other covering for it").toBe(list.length);
    for (const list of OVERRIDES) expect(new Set(list.map((term) => term.phrase)).size, "two entries carrying one phrase would let either be deleted with the other covering for it").toBe(list.length);

    const shipped: string[][] = [[], []];
    for (const rendering of RENDERINGS) {
      for (const place of PLACES) {
        const found = sectionAt(readRepoFile(`${rendering}/_shared/kiwi/${place.file}`).replace(/\r\n/g, "\n"), place.at);
        if (found === null) continue;
        (shipped[found.alternative] as string[]).push(...instructionLines(found.text, place.tool));
      }
    }
    expect(shipped.flat().length, "no instruction line was read, so the probe below would prove nothing").toBeGreaterThan(0);
    for (const [index, list] of SURVIVES.entries()) {
      expect(
        list.filter((phrase) => !(shipped[index] as string[]).some((line) => line.includes(phrase))),
        `vocabulary ${index}: a survival phrase no shipped instruction line carries bounds nothing`
      ).toEqual([]);
    }

    const failures: string[] = [];
    for (const [index, list] of OVERRIDES.entries()) {
      for (const term of list) {
        if (!term.sample.includes(term.phrase)) {
          failures.push(`\`${term.phrase}\` no longer catches its own sample: ${term.sample}`);
          continue;
        }
        const covered = list.filter((other) => other.phrase !== term.phrase && term.sample.includes(other.phrase));
        if (covered.length > 0) failures.push(`\`${term.phrase}\` is not what catches its sample — ${covered.map((other) => other.phrase).join(", ")} does`);
        if ((SURVIVES[index] as readonly string[]).some((phrase) => term.sample.includes(phrase))) failures.push(`the sample for \`${term.phrase}\` also reads as survival`);
      }
    }
    expect(failures, "a vocabulary probed only as a whole survives losing one alternative, and the cancellation it caught then passes").toEqual([]);
  });

  it("keeps the cancellation reader answering in both directions and in both languages", () => {
    for (const [index, list] of OVERRIDES.entries()) {
      const rendering = index === 0 ? "skills/claude" : "skills/codex";
      const place = PLACES.find((entry) => entry.at.includes("|")) as Place;
      const found = sectionAt(readRepoFile(`${rendering}/_shared/kiwi/${place.file}`).replace(/\r\n/g, "\n"), place.at);
      expect(found?.alternative, `${rendering}: the probe section did not resolve to vocabulary ${index}`).toBe(index);
      const text = (found as { text: string }).text;
      expect(cancellations(text, index, "shipped"), "the unmodified section must pass, or the reader is matching its own subject").toEqual([]);
      expect(
        cancellations(`${text}\n\n${(list[0] as PolarityTerm).sample}`, index, "probe").length,
        "a reader that has stopped matching reports nothing, which is what a clean tree reports"
      ).toBeGreaterThan(0);
    }
  });
});

describe.each(RENDERINGS)("%s", (rendering) => {
  it.each(PLACES)("names $tool inside $at of $file, with its CLI fallback and its token", (place) => {
    const found = sectionAt(bodyOf(rendering, place.file), place.at);
    expect(found, `${rendering}: ${place.file} has no single heading matching ${place.at}`).not.toBeNull();
    const text = (found as { text: string }).text;
    expect(text.includes(place.tool), `${rendering}: ${place.at} does not name ${place.tool}`).toBe(true);
    // Flattened, because the English renderings wrap mid-sentence and a citation folded onto a
    // second line is the same instruction; reading the raw bytes would report a false red.
    expect(flat(text).includes(flat(place.cli)), `${rendering}: ${place.at} does not name the CLI fallback ${place.cli}`).toBe(true);
    const block = instructionBlock(text, place.tool);
    expect(block, `${rendering}: ${place.at} has no block naming ${place.tool}`).not.toBe("");
    expect(
      block.includes(place.token),
      `${rendering}: ${place.at} names ${place.tool} but not the verdict token ${place.token} beside it — a token elsewhere in the section is a neighbour's sentence, not this instruction's verdict`
    ).toBe(true);
  });

  it.each(PLACES)("states the call for $tool at $at as an instruction rather than as an option", (place) => {
    const found = sectionAt(bodyOf(rendering, place.file), place.at);
    expect(found, `${rendering}: ${place.file} has no single heading matching ${place.at}`).not.toBeNull();
    const { text, alternative } = found as { text: string; alternative: number };
    const sentence = text
      .split(/(?<=[.。]|다\.)\s/)
      .filter((part) => part.includes(place.tool) || part.includes(flat(place.cli)))
      .join(" ");
    expect(sentence, `${rendering}: ${place.at} carries no sentence naming ${place.tool}`).not.toBe("");
    expect((HEDGE[alternative] as RegExp).test(sentence), `${rendering}: ${place.at} hedges the call to ${place.tool}`).toBe(false);
  });

  it.each(PLACES)("says the call for $tool is made, and nowhere in $at takes it back", (place) => {
    const found = sectionAt(bodyOf(rendering, place.file), place.at);
    expect(found, `${rendering}: ${place.file} has no single heading matching ${place.at}`).not.toBeNull();
    const { text, alternative } = found as { text: string; alternative: number };
    const lines = instructionLines(text, place.tool);
    expect(lines, `${rendering}: ${place.at} must name ${place.tool} on exactly one line`).toHaveLength(1);
    expect(
      (SURVIVES[alternative] as readonly string[]).some((phrase) => (lines[0] as string).includes(phrase)),
      `${rendering}: ${place.at} names ${place.tool} without saying the call is made — presence does not separate an instruction from its negation`
    ).toBe(true);
    expect(cancellations(text, alternative, `${rendering}: ${place.at}`), "a block of the section takes the instruction back").toEqual([]);
  });
});

// Declared last on purpose: Vitest runs a file's tests in declaration order, so by the time this
// block runs every per-copy check above has recorded what it opened.
describe("FR-FLOW-169 what the per-copy checks read", () => {
  it("every per-copy check opened a copy the rendering its own block is named for ships", (context) => {
    const registered = perCopyChecks(context);
    expect(registered.length, "no per-copy check is registered, so the ledger below has nothing to answer for").toBe(floor("checks"));

    // Against the checks that RAN rather than the checks that exist, so a `-t` filter narrows the
    // comparison instead of failing it.
    const reads = OPENED.filter((opened) => opened.block !== "");
    expect(reads.length, "a per-copy check opened no copy, or opened more than one").toBe(registered.filter((check) => check.ran).length);
    expect(
      reads.filter((opened) => !opened.relPath.startsWith(`${opened.block}/_shared/kiwi/`)).map((opened) => `${opened.block} opened ${opened.relPath}`),
      "a per-copy check read a rendering other than the one its block is named for"
    ).toEqual([]);
    expect(
      reads.filter((opened) => opened.digest !== digestOf(opened.relPath)).map((opened) => `${opened.block} was answered with bytes that are not ${opened.relPath}'s`),
      "a per-copy check was handed one copy's bytes under another copy's name"
    ).toEqual([]);
    expect(new Set(reads.map((opened) => opened.relPath)).size, "the per-copy checks between them did not open every target copy").toBe(floor("files") * floor("copies"));
  });
});
