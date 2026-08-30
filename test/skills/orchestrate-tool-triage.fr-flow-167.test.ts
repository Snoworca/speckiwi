import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { ORCHESTRATE_TOOL_BINDINGS } from "../../src/cli/commands/orchestrate.js";
import {
  REQUIREMENT_NOT_READY_GATE,
  RequirementNotReadyError,
  assertRequirementsReady,
  parseRequirementSnapshot,
  type SnapshotPayload,
  type SpecTargetSummary
} from "../../src/core/orchestrator/readiness.js";
import { projectRequirementRecords } from "../../src/core/query/discovery.js";
import type { RequirementRecord } from "../../src/core/types.js";
import { ORCHESTRATOR_MIRROR, ORCHESTRATOR_VARIANTS, readVariant, stripFrontmatter, verbSection } from "./kiwi-orchestrator-variants.js";
import { RENDERINGS, flat, markdownFiles, readRepoFile, scanUnits, sharedKiwiFiles, skillDirs, unitAt } from "./kiwi-renderings.js";

// @req FR-FLOW-167 AC-1 — a row per triaged tool, over a denominator taken from the bindings and the
// requirement's own text rather than from a list written here.
// @req FR-FLOW-167 AC-3 — every rendering names the command for each tool this requirement wires,
// inside the verb section that owns the judgement and beside a gate that tool's own handler raises.
// @req FR-FLOW-167 AC-5 — the wording introduced here, counted in the shipped tree first.
// @req FR-FLOW-167 AC-7 — what this file does and does not guarantee, measured rather than inferred.
//
// ─── WHAT THIS FILE GUARANTEES ──────────────────────────────────────────────────────────────────
// Three things, and they lock each other because they live in different files.
//
// (1) The triage table. Every `orchestrate_*` tool the bindings register either sits in this
// requirement's exclusion sentence — the eight the skills already call by their CLI leaf, plus
// `orchestrate_validate`, which `FR-FLOW-155` owns — or carries a row in the requirement's
// Implementation Notes with `(a0)`, `(a)`, `(b)` and `(c)` filled in. The denominator is the
// binding array, so a tool added to the surface has to be triaged or excluded, and the exclusion
// set is read out of the requirement's own note rather than restated here: a list in this file
// would let the table shrink by the same edit that shrinks the list.
//
// (2) The wiring. For each tool the table judges as `배선 — 이 요구가 수행한다`, all four renderings
// of `kiwi-orchestrator/SKILL.md` name the MCP tool and the CLI fallback inside the `§V` verb
// section that owns the judgement, and name the gate that receives the verdict in that same
// section. Which section and which gate come from the requirement's wiring-map note, not from the
// section being read — a gate name derived from the section it is asserted about is satisfied by
// deleting it from both sides at once. AC-3's own enumeration is held against that map, so the two
// copies of the map cannot drift the way they did in round 1.
//
// (3) That a gate the map names is one the tool can actually raise. Round 1 shipped
// `unallocated-req-id` as the gate receiving `orchestrate_readiness_check`'s verdict; that
// identifier is produced only by `checkWaveAllocation`, which no caller in `src/` reaches and no
// binding exposes. The provenance reader below takes the tool's own CLI handler body and the
// modules its kernel calls are imported from, and asks whether the identifier is defined there.
//
// (4) That the input the wired section tells the agent to assemble reaches the gate. `§V.derive-
// readiness` says how to build the readiness snapshot; round 2 built one exactly that way and got
// `Malformed requirement snapshot: acceptanceCriteria`, because both transports answer in the
// compact projection by default and `parseRecord` needs fields it omits. The block below builds the
// document under the projection the section names, parses it, and takes it to the gate — and
// measures that the default projection does not get there.
//
// The reach of all four is bounded by FLOORS read out of the requirement — `wiring`, `copies`,
// `gates`, `checks`, `survives`, `overrides` — because a reach written as a literal here cannot be
// defended by the checks it bounds. Round 1 had no floor on the wiring half at all: demoting the
// three rows to `배선 — 후속` and deleting the map note took `WIRING` and `CARRIED_HERE` to zero
// together, the count equality passed as `0 === 0`, `it.each([])` registered nothing, and 24 wiring
// checks left with the suite green and the tally `10·1·4·3` unchanged. `checks` is counted from the
// tasks the runner registered rather than from `it.each(WIRING)` counted in this source: the source
// count holds at 36 while a block reads one fixed rendering four times, which round 2 measured
// green at all four call sites.
//
// ─── WHAT THIS FILE DOES NOT GUARANTEE ──────────────────────────────────────────────────────────
// That an agent calls any of these tools. Nothing here observes a run: a run whose agent read the
// instruction and skipped it completes normally and this file stays green. The machine judgement
// each tool performs lives in its own CLI suite; a green here is not evidence for it.
//
// That the fifteen tools this requirement does not wire have any skill text at all. They are read
// only for the presence of a row, never for what a skill says about them.
//
// That the reasons behind the eight rows judged `이연`, `다른 도구가 소유` or `코드가 이미 수행` are
// true. Those rest on source readings recorded in the notes — `closeWave` calling `resolveIssue`,
// `readHandoff` having no CLI leaf — and a later change that falsifies one leaves this file green.
// The table is a record of a reading, and only the wiring half is defended mechanically.
//
// That a contradiction elsewhere in the skill is caught. Only the three verb sections named by the
// wiring map are read; a sentence in `§3` or `§0.G` retracting one of the three instructions is
// invisible here, the same way `§V.emit-and-finish` is invisible to `FR-FLOW-155`.
//
// That the MCP parameter names and CLI flags the wiring sentence cites exist on that tool. Round 1
// shipped `card` as an input of `orchestrate_route_freeze`; the binding declares five options and
// none of them is `card`, `orchestrateArgv` drops an undeclared key without an error, and
// `IR-MCP-004`'s parity test compares required flags only. `FR-NODE-128` does not close it either —
// it resolves the command tree and the placeholder forms, not the option list.
//
// That a gate the section names is raised by that tool. Only the gates the WIRING MAP names are put
// through the provenance reader; `§V.derive-readiness` still names `unallocated-req-id` on its gate
// line, correctly, because that section performs the allocation check beside the derivation.
//
// That the provenance reader sees the whole path. It reads the handler body and the modules the
// handler's own identifiers are imported from — one hop. An identifier a module carries for an
// unrelated reason passes, and a gate raised two modules deeper than the handler's imports would be
// reported as absent.
//
// That a per-copy check read its own rendering when the run did not reach it. The read ledger is
// compared against the checks the task tree says RAN, so a `-t` filter narrows the comparison
// instead of failing it; the registration count comes from the collected tree and is unaffected.
//
// That a per-copy check CONSUMED what it was handed. The reader refuses to answer a block with
// bytes that block does not ship, and the ledger holds what it was handed against the block title;
// both watch the reader, and neither watches the assertions. A check that calls the reader for its
// own rendering and then reads a different one for the value it actually uses satisfies both:
// measured green at 69 on one site, on all three, and on all three under both recorder weakenings.
// Between `skills/codex` and its mirror not even the refusal separates them — the two ship
// identical bytes, so only the recorded path tells them apart, and a substitution of one for the
// other under a recorder that logs the block title is green at 69 as well (red at 1 failed / 68
// with that recorder intact, which is what the path axis is for).
//
// That the handler body is cut correctly when the source is not bracket-balanced. Bracket matching
// breaks on an odd parenthesis inside a comment or a string. Cutting short is fail-closed, and
// over-extension — which is not — is refused separately by asking whether the cut body carries the
// next leaf's own registration. Measured over `src/cli/commands/orchestrate.ts`: no comment on any
// line carries an odd parenthesis, and none of the three cut bodies contains a `.command("`.
//
// That a negation or a retraction worded outside the closed vocabularies is caught. Both readers
// are SCANS: `POLARITY_SURVIVES` is required of the instruction line and `POLARITY_OVERRIDES` is
// forbidden in every block of the section, which is the span the retraction has to be read over —
// round 1 read hedges on the tool sentence alone, and `다만 이 호출은 필요하면 생략해도 된다.`
// added as a neighbouring sentence was green over 69 files and 3517 tests. A paraphrase avoiding
// every listed phrase still passes, and the floors are what keep the vocabularies from shrinking.
//
// ─── BASELINE, MEASURED BEFORE THE SKILL TEXT WAS TOUCHED ───────────────────────────────────────
// Over `skills/` and `.agents/skills/` in the shipped tree, each of these was 0:
//   `orchestrate_route_probe`  `orchestrate_route_freeze`  `orchestrate_readiness_check`
//   `speckiwi orchestrate route probe`  `speckiwi orchestrate route freeze`
//   `speckiwi orchestrate readiness check`  `--payload`  `--probe`  `--gate`  `--snapshot`
//   `<payload>`  `<t>`  `violations[].field`  `transport`  `mcp-list-requirements`
//   `speckiwi-list-json`
// These were NOT zero and are recorded with what they were: `unreadable` 40, `route-probe-unreadable`
// 16 (four per rendering), `requirement-not-ready` 16, `unallocated-req-id` 16, `route.lock.json` 48,
// `probe.json` 36, `--out` 20, `route-gate.json` 8, `noop` 4 — all four of those last being
// `logged_noop` in `kiwi-srs-feasibility`, so the bare backticked spelling was 0 — `probe.unreadable`
// 4 (one per rendering, in the D8 checklist of `§6`), `records` 8, `diagnostics` 67 and `summary`
// 516. Counted over the four renderings of this skill alone: `--target` 8, `<id>` 12, `<path>` 44,
// `summary` 8, `list` 32, and `--req` 4 — all four of those last being `--req-filter`, so the bare
// flag was 0, the same suffix trap `FR-FLOW-155` recorded for `--strict` against `--strict-grounding`;
// `records`, `diagnostics`, `transport` and `violations` were 0 there. The three gate ids were
// already present because `§0.G` and the phase map declare them; what this requirement adds is their
// appearance inside the `§V` section that raises them.
//
// One token was measured at 0, drafted, and then NOT introduced in prose: `mcp-list-requirements`,
// the transport tag of the readiness snapshot. Written as a backticked word in a Korean sentence it
// is read by `FR-FLOW-154` AC-1 as a value named beside a lifecycle call — the tag SPELLS one, and
// so does `speckiwi-list-json` — and it turned that suite red in all four renderings, as did the
// bare word `transport` beside it. The shipped snapshot shape is a fenced block of bare tokens
// instead, which that axis does not read as values, and its allow list was left alone.

const SELF_PATH = fileURLToPath(import.meta.url);
const SRS_PATH = "docs/spec/60.workflow-release.srs.md";
const ORCHESTRATE_CLI = "src/cli/commands/orchestrate.ts";
const REQUIREMENT_ID = "FR-FLOW-167";

/** The four renderings of the skill this requirement wires. */
const COPIES = [...ORCHESTRATOR_VARIANTS.map((variant) => variant.relPath), ORCHESTRATOR_MIRROR];

/** Every markdown file every rendering ships for a kiwi skill, plus the shared contracts. */
const SKILL_CORPUS: string = [
  ...RENDERINGS.flatMap((rendering) => skillDirs(rendering).flatMap((skill) => markdownFiles(rendering, skill))),
  ...sharedKiwiFiles()
]
  .map(readRepoFile)
  .join("\n");

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

const BLOCK = requirementBlock(REQUIREMENT_ID);

/** One `- [date] …` bullet of the requirement's Implementation Notes. */
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

const NOTES = implementationNotes(BLOCK);

/**
 * Every note carrying `marker`, in the order they were appended.
 *
 * The LAST one is the one that counts. `append_section_note` is the only writer these notes have and
 * it appends; it cannot edit a bullet in place. So a row corrected after a verification round
 * arrives as a second dated bullet, and a reader taking the first would go on reading the value the
 * correction was written to retire — which is what round 1's four wrong `(a0)` cells would have
 * done. That a second row announces itself as a correction is asserted below rather than assumed.
 */
const notesMatching = (marker: string): string[] => NOTES.filter((note) => note.includes(marker));
const lastNote = (marker: string): string => notesMatching(marker).at(-1) ?? "";

/** One triage row: the notes whose subject is this tool, corrections included. */
const rowsFor = (tool: string): string[] => notesMatching(`\`${tool}\`.`);
const rowOf = (tool: string): string => rowsFor(tool).at(-1) ?? "";

/** The text of one acceptance criterion, read out of the block. */
function acText(id: string): string {
  const line = BLOCK.split("\n").find((entry) => entry.startsWith(`- [ ] ${id}:`) || entry.startsWith(`- [x] ${id}:`));
  return line === undefined ? "" : line.slice(line.indexOf(":") + 1).trim();
}

/**
 * The floors this suite runs under, read out of the requirement rather than typed here.
 *
 * How many tools are wired, how many renderings are swept, how many gates are held and how many
 * per-copy checks that multiplies out to are the values that decide this suite's REACH, and a
 * literal reach cannot be defended by the checks it bounds — lower it and the sweep shrinks while
 * every assertion stays green. `FR-FLOW-158` moved its seven floors into its requirement for that
 * reason and `FR-FLOW-164` follows it; this follows both. Narrowing the sweep is a requirement diff.
 */
const FLOORS: ReadonlyMap<string, number> = new Map(
  ["AC-3", "AC-7"].flatMap((id) =>
    [...acText(id).matchAll(/`([a-z]+) (\d+)`/g)].map((match) => [match[1] as string, Number(match[2])] as [string, number])
  )
);

/** One floor, by the key the requirement names it under. Absent means it stopped bounding it. */
function floor(name: string): number {
  const value = FLOORS.get(name);
  if (value === undefined) throw new Error(`${REQUIREMENT_ID} names no floor \`${name}\`, so this assertion has no bound to hold to`);
  return value;
}

/** Every registered tool name, from the binding array — this is the denominator. */
const REGISTERED: string[] = ORCHESTRATE_TOOL_BINDINGS.map((binding) => binding.tool);

/** The CLI leaf a tool mirrors, as the skills would spell it: `orchestrate route probe`. */
const LEAF_OF = new Map(ORCHESTRATE_TOOL_BINDINGS.map((binding) => [binding.tool, `orchestrate ${binding.path.join(" ")}`]));

/** The CLI path segments a tool mirrors, for finding its handler in the command file. */
const PATH_OF = new Map(ORCHESTRATE_TOOL_BINDINGS.map((binding) => [binding.tool, binding.path]));

/**
 * The tools this requirement excludes, read out of its own denominator note rather than listed here.
 *
 * The note names the eight by their CLI leaf spelling and names `orchestrate_validate` by its tool
 * name. Reading them back means the exclusion set and the row set cannot be shrunk by one edit: the
 * count assertions below pin both ends, and each excluded leaf is checked against the shipped tree.
 */
function declaredExclusions(): { tools: string[]; leaves: string[] } {
  const note = lastNote("판정표 0/18 ");
  const leaves = [...note.matchAll(/`(orchestrate (?:[a-z-]+ )*[a-z-]+)`/g)].map((match) => match[1] as string);
  const tools = REGISTERED.filter((tool) => leaves.includes(LEAF_OF.get(tool) as string));
  if (note.includes("`orchestrate_validate`")) tools.push("orchestrate_validate");
  return { tools, leaves };
}

const EXCLUSIONS = declaredExclusions();
const TRIAGED: string[] = REGISTERED.filter((tool) => !EXCLUSIONS.tools.includes(tool));

/** The four dispositions the requirement admits, in the order AC-1 tallies them. */
const DISPOSITIONS = ["배선", "코드가 이미 수행", "다른 도구가 소유", "이연"] as const;

/** The disposition a row records, read from its `(c)` clause. */
function dispositionOf(note: string): string | null {
  const clause = /\(c\) ([^.]+)/.exec(note);
  if (clause === null) return null;
  const text = clause[1] as string;
  // Longest first: `배선` is a prefix of nothing here, but `코드가 이미 수행` must not be read as `이연`.
  for (const disposition of [...DISPOSITIONS].sort((a, b) => b.length - a.length)) {
    if (text.startsWith(disposition)) return disposition;
  }
  return null;
}

/** The tools whose row says this requirement carries the wiring itself. */
const CARRIED_HERE: string[] = TRIAGED.filter((tool) => rowOf(tool).includes("(c) 배선 — 이 요구가 수행한다"));

interface WiringEntry {
  tool: string;
  verb: string;
  gates: string[];
  cli: string;
}

/**
 * The wiring map, read from the requirement rather than from the sections it governs.
 *
 * Deriving the gate from the section under test would make the second mutation vacuous: removing the
 * gate name from the section would remove it from the expectation in the same edit.
 */
function wiringMap(): WiringEntry[] {
  const note = lastNote("배선 지도 (AC-3)");
  const entries = [...note.matchAll(/`(orchestrate_[a-z_]+)` → `§V\.([a-z-]+)` → 게이트 ((?:`[a-z-]+`(?: 와 )?)+)/g)];
  const clis = [...note.matchAll(/`(speckiwi orchestrate [a-z -]+)`/g)].map((match) => match[1] as string);
  return entries.map((match, index) => ({
    tool: match[1] as string,
    verb: match[2] as string,
    gates: [...(match[3] as string).matchAll(/`([a-z-]+)`/g)].map((gate) => gate[1] as string),
    cli: clis[index] ?? ""
  }));
}

const WIRING = wiringMap();

/** The gates AC-3 enumerates in its own sentence, so the map's second copy cannot drift from it. */
function gatesStatedByAc3(): string[] {
  const clause = /게이트 이름을 같은 절 안에 둔다 — 차례로 ([^다]*)다\./.exec(acText("AC-3"));
  if (clause === null) return [];
  return [...(clause[1] as string).matchAll(/`([a-z-]+)`/g)].map((match) => match[1] as string);
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
 * The `.action` callback of one CLI leaf, by brace matching from the leaf's registration.
 *
 * Anchored on `<parent>.command("<leaf>")` because that is how every leaf in this file is declared
 * and the parent variable is the first path segment; a leaf that stopped being declared that way
 * returns "" and the assertion reading it fails rather than passing over nothing.
 */
function handlerBody(segments: readonly string[]): string {
  const anchor = `${segments.slice(0, -1).join("")}.command("${segments.at(-1) as string}")`;
  const at = CLI_SOURCE.indexOf(anchor);
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
  const names = new Set([...body.matchAll(/\b[A-Za-z_][A-Za-z0-9_]*\b/g)].map((match) => match[0]));
  const modules = new Set<string>();
  for (const name of names) {
    const module = IMPORTED_FROM.get(name);
    if (module !== undefined) modules.add(module);
  }
  return [...modules];
}

/** One imported module's source, resolved against the command file that imports it. */
function moduleSource(specifier: string): string {
  const relative = path.posix.join(path.posix.dirname(ORCHESTRATE_CLI), specifier.replace(/\.js$/, ".ts"));
  try {
    return readRepoFile(relative);
  } catch {
    return "";
  }
}

/**
 * Whether `gate` is an identifier this tool's own path can raise.
 *
 * True when the handler refuses with it outright, or when a module the handler's kernel calls come
 * from defines the string. `unallocated-req-id` is neither for `orchestrate_readiness_check`: it is
 * produced by `checkWaveAllocation` in `allocation.ts`, a module no handler in this file imports.
 */
function raisesGate(tool: string, gate: string): boolean {
  const segments = PATH_OF.get(tool);
  if (segments === undefined) return false;
  const body = handlerBody(segments);
  if (body === "") return false;
  if (body.includes(`"${gate}"`)) return true;
  return handlerModules(body).some((module) => moduleSource(module).includes(`"${gate}"`));
}

// ── the wording the instruction has to keep, and the wording the section may not carry ───────────

/**
 * Hedges that would turn an instruction into a suggestion, read over the sentence that names the
 * tool. A wired call that "may" be made is a judgement still left to prose reading.
 */
const HEDGE =
  /수 있다|해도 된다|권장|바람직|원칙적으로|가능하면|되도록|경우에 따라|가급적|필요하면|필요 시|것이 좋다|선택적|해도 무방|권한다|생략해도/;

/** A closed-vocabulary term with the sample only it catches, the shape `FR-FLOW-164` established. */
interface PolarityTerm {
  readonly phrase: string;
  readonly sample: string;
}

/**
 * The verbs in which the three shipped instruction lines say the call is MADE (AC-7).
 *
 * READ OFF the shipped text rather than invented: `쓰고` is what the two route lines say, `파생하고`
 * is what the readiness line says, and `받는다` is how the probe line names the CLI fallback's
 * result. REQUIRED OF THE INSTRUCTION LINE ALONE — the line that names the MCP tool — because that
 * is the sentence AC-3 is about. Round 1 checked only for the tool NAME on that line, and the
 * negation `…를 부르지 않고 손으로 쓴다` carries the name while saying the opposite; it was green
 * over 69 files and 3517 tests, and a survival verb is what separates the two.
 */
const POLARITY_SURVIVES: readonly string[] = ["쓰고", "파생하고", "받는다"];

/**
 * The cancellations no BLOCK of a wired section may carry (AC-7), one entry per phrase.
 *
 * SCANNED OVER THE WHOLE SECTION, block by block, unlike `POLARITY_SURVIVES`. What a retraction has
 * to be read over is the section and not the sentence: round 1 left the instruction untouched and
 * added `다만 이 호출은 필요하면 생략해도 된다.` beside it, and because that sentence carries
 * neither the tool name nor the CLI citation it never joined the hedge reader's subject at all —
 * 69 files and 3517 tests green. Blocks rather than lines because a phrase folded across a soft
 * line break is carried by neither line while the rendered paragraph reads as one sentence, which
 * is the measurement `scanUnits` was extracted for.
 *
 * The two negations are spelled to the stem rather than to a sentence ending, because this
 * requirement's survival verbs are carried THROUGH a negation: `…를 부르지 않고 손으로 쓰고, … 도
 * 부르지 않은 채 같은 판정을 받는다` keeps `쓰고` and `받는다` while saying the opposite, and with
 * the endings closed it was green over 67 tests. `FR-FLOW-164` did not need this — its survival
 * phrase is the claim itself, which a negation cannot keep. Measured before widening: over the
 * three wired sections of all four renderings `부르지 않` and `호출하지 않` occur zero times, so the
 * stems cost no false positive here. `생략해도` is cut the same way and for the same reason: round 2
 * measured `다만 이 호출은 필요하면 생략해도 좋다.` green beside the untouched instruction, and only
 * the ending separated it from the form round 1 already caught.
 *
 * `손으로 쓴다` keeps its ending on purpose, and the difference is the point: `§V.freeze-route`
 * ships `lock 을 손으로 쓰지 않는다`, which is the rule and not its cancellation, and the two are
 * separated by the ending alone. Widening that phrase to `손으로 쓰` would refuse the shipped line.
 */
const POLARITY_OVERRIDES: readonly PolarityTerm[] = [
  { phrase: "부르지 않", sample: "이 절에서는 그 도구를 부르지 않고 넘어간다." },
  { phrase: "호출하지 않", sample: "MCP 도구를 호출하지 않은 채 진행한다." },
  { phrase: "손으로 쓴다", sample: "probe 파일은 손으로 쓴다." },
  { phrase: "생략해도", sample: "다만 이 호출은 필요하면 생략해도 된다." },
  { phrase: "건너뛴다", sample: "이 호출은 건너뛴다." },
  { phrase: "필수가 아니다", sample: "이 호출은 필수가 아니다." },
  { phrase: "선택이다", sample: "이 명령을 부를지는 선택이다." },
  { phrase: "폐기한다", sample: "위 지시는 이번 판에서 폐기한다." },
  { phrase: "강제하지 않는다", sample: "이 절은 그 호출을 강제하지 않는다." },
  { phrase: "무시하고 진행", sample: "게이트를 무시하고 진행한다." }
];

const OVERRIDE_PHRASES: readonly string[] = POLARITY_OVERRIDES.map((term) => term.phrase);

/** Every phrase of `phrases` this text carries. Both arguments required, so nothing is defaulted in. */
function polarityHits(text: string, phrases: readonly string[]): string[] {
  return phrases.filter((phrase) => text.includes(phrase));
}

/** The blocks of a section that cancel the instruction beside them. */
function cancellations(section: string, where: string): string[] {
  const found: string[] = [];
  for (const unit of scanUnits(section)) {
    const hits = polarityHits(unit.text, OVERRIDE_PHRASES);
    if (hits.length === 0) continue;
    found.push(`${where} (${unitAt(unit)}): cancels the instruction beside it — \`${hits.join("`, `")}\` in ${unit.text.slice(0, 110)}`);
  }
  return found;
}

/** The lines of a section that name the MCP tool. The instruction is one of them, and only one. */
function instructionLines(section: string, tool: string): string[] {
  return section.split("\n").filter((line) => line.includes(tool) && !line.trim().startsWith("|"));
}

/**
 * Every rendering this suite opened, beside the block Vitest was running when it opened it.
 *
 * The two sides come from different places on purpose. The expectation is the block title the
 * runner supplies; the actual is the argument `readVariant` was handed. Recording the argument
 * beside the call site would make both the same expression and the comparison vacuous, which is the
 * hole round 2 measured: replacing `bodyOf(relPath)` with `bodyOf(COPIES[0])` at all four call
 * sites left this suite at 67 passed and the per-copy product at 36, because `skills/claude`
 * satisfies every assertion the blocks make. It is not a harmless substitution — the only red
 * assertion `skills/etc` carries under a negated instruction is one of those per-copy blocks, so
 * three of the four renderings would have left the sweep with nothing reporting it.
 */
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
  // holds while a per-copy check reads whichever rendering it likes. Measured: those two edits
  // together left a substitution at all three per-copy sites at 69 passed. Neither side of this
  // comparison is something the recorder wrote — the left is the bytes going back to the caller,
  // the right is an independent read of the rendering the running block is named for — so a
  // weakened record cannot reconcile it. Only per-copy blocks are held to it; the sweep and the two
  // deliberately fixed reads run outside any such block and are answered by the ledger instead.
  if (block !== undefined) {
    expect(
      createHash("md5").update(body).digest("hex"),
      `${block} was handed bytes that ${block} does not ship, so this check is answering for a rendering it never opened`
    ).toBe(digestOf(block));
  }
  return body;
};

/** One node of the task tree Vitest built for this file, read through the running test's context. */
interface RegisteredCheck {
  readonly block: string;
  readonly name: string;
  readonly ran: boolean;
}

/**
 * Every test Vitest REGISTERED for this file, from the tree rather than from this file's source.
 *
 * `it.each(WIRING)` counted as a string in the source says how many blocks were written, not how
 * many checks exist: a block that reads one fixed rendering still contributes its share of that
 * count. The tree is also collection truth rather than run truth — a `-t` filter marks the
 * unselected tests `skip` and leaves them in the tree — so the registration floor below holds under
 * a filtered run while the read ledger is compared only against the checks that actually ran.
 * `FR-MCP-060` and `FR-FLOW-164` hold their own block titles against a set the requirement declares;
 * this reads the same titles, one layer lower, where the count is what has to be defended.
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

describe("FR-FLOW-167 the triage table", () => {
  it("the requirement block and its notes exist, or every assertion below is vacuous", () => {
    expect(BLOCK, `${REQUIREMENT_ID} is not in ${SRS_PATH}`).not.toBe("");
    expect(NOTES.length, "the requirement carries no Implementation Notes to read rows out of").toBeGreaterThan(18);
    expect(SKILL_CORPUS.length, "the skill corpus is empty, so the exclusion checks below prove nothing").toBeGreaterThan(100000);
    expect(CLI_SOURCE.length, `${ORCHESTRATE_CLI} is empty, so the gate provenance reader would report every gate absent`).toBeGreaterThan(10000);
  });

  it("the denominator is the binding array, and the exclusion set is the requirement's own", () => {
    // The three counts are held together so no single edit moves the boundary: the total comes from
    // the code, the exclusions from the requirement's note, and the row set is the difference.
    expect(REGISTERED.length, "the registered tool count changed; a new tool needs a row or an exclusion").toBe(27);
    expect(EXCLUSIONS.leaves, "the denominator note must name the eight excluded CLI leaves").toHaveLength(8);
    expect(EXCLUSIONS.tools, "eight leaves plus orchestrate_validate is nine exclusions").toHaveLength(9);
    expect(TRIAGED, "the triaged set is the registered tools minus the nine exclusions").toHaveLength(18);
  });

  it("every excluded leaf is one the shipped skills really call, so the exclusion is not a way out", () => {
    for (const leaf of EXCLUSIONS.leaves) {
      expect(SKILL_CORPUS.includes(leaf), `${leaf} is excluded as already called, but no shipped skill spells it`).toBe(true);
    }
    // `orchestrate_validate` is excluded on a different ground — another requirement owns it — so it
    // is checked against that requirement rather than against the skills.
    const owner = requirementBlock("FR-FLOW-155");
    expect(owner.includes("orchestrate_validate"), "FR-FLOW-155 must be the requirement that owns orchestrate_validate").toBe(true);
  });

  it.each(TRIAGED)("%s carries a row with (a0), (a), (b) and one disposition", (tool) => {
    const row = rowOf(tool);
    expect(row, `${tool} has no 판정표 row in the requirement`).not.toBe("");
    expect(/\(a0\) (있음|없음)/.test(row), `${tool}: (a0) must say 있음 or 없음`).toBe(true);
    expect(row.includes("(a) "), `${tool}: (a) is empty`).toBe(true);
    expect(row.includes("(b) "), `${tool}: (b) is empty`).toBe(true);
    expect(DISPOSITIONS as readonly string[], `${tool}: (c) is not one of the four dispositions`).toContain(dispositionOf(row));
  });

  it("a second row for one tool is a correction, and says so", () => {
    // The notes are append-only, so a corrected row arrives beside the one it retires and the reader
    // above takes the last. A second row that does not announce itself as a correction is two rows
    // disagreeing, with nothing saying which one the tree is being held to.
    const unmarked = TRIAGED.flatMap((tool) =>
      rowsFor(tool)
        .slice(1)
        .filter((row) => !row.includes("정정"))
        .map((row) => `${tool}: ${row.slice(0, 90)}`)
    );
    expect(unmarked, "a tool carries more than one row and the later one is not marked 정정").toEqual([]);
  });

  it("a row whose caller is partial, or whose disposition is 이연, records what is left over", () => {
    for (const tool of TRIAGED) {
      const row = rowOf(tool);
      const needsD = dispositionOf(row) === "이연" || row.includes("(a0) 있음(부분)");
      if (!needsD) continue;
      expect(row.includes("(d) "), `${tool}: a deferral or a partial caller must record (d)`).toBe(true);
    }
  });

  it("a row reporting 있음 names the caller by file and line", () => {
    for (const tool of TRIAGED) {
      const row = rowOf(tool);
      if (!row.includes("(a0) 있음")) continue;
      expect(/\.ts:\d+/.test(row), `${tool}: (a0) 있음 must name the caller by file and line`).toBe(true);
    }
  });

  it("the tally the rows produce is the tally AC-1 states", () => {
    const stated = /집계는 차례로 (\d+)·(\d+)·(\d+)·(\d+)/.exec(BLOCK);
    expect(stated, "AC-1 must state the tally so the rows can be held against it").not.toBeNull();
    const counted = DISPOSITIONS.map((disposition) => TRIAGED.filter((tool) => dispositionOf(rowOf(tool)) === disposition).length);
    expect(counted, "the rows and AC-1 disagree about the tally").toEqual([1, 2, 3, 4].map((index) => Number((stated as RegExpExecArray)[index])));
    expect(counted.reduce((sum, value) => sum + value, 0)).toBe(TRIAGED.length);
  });
});

describe("FR-FLOW-167 the wiring this requirement carries", () => {
  it("runs under floors the requirement names, so the wiring half cannot be emptied quietly", (context) => {
    // Round 1 held the two sides against each other and nothing else: demoting the three rows and
    // deleting the map note took both to zero, `0 === 0` passed, and `it.each([])` registers no test
    // at all — measured, an empty `it.each` beside one sibling reports `1 passed`. The floors are
    // read out of AC-3 so lowering the reach is a requirement diff, not a silent one.
    expect(WIRING.length, "tools the requirement says it wires itself").toBe(floor("wiring"));
    expect(CARRIED_HERE.length, "rows judged `배선 — 이 요구가 수행한다`").toBe(floor("wiring"));
    expect(COPIES, "kiwi-orchestrator ships three variants and is mirrored").toHaveLength(floor("copies"));
    expect(WIRING.flatMap((entry) => entry.gates).length, "gates the map holds across the wired tools").toBe(floor("gates"));

    // Counted from the tasks Vitest registered, not from `it.each(WIRING)` counted in this file's
    // source. The source count says how many blocks were WRITTEN; the floor is about how many
    // checks EXIST, and round 2 measured a block that keeps its string while dropping the rendering
    // it was handed. An emptied map registers nothing, a deleted block registers nine fewer, and
    // both show up here.
    const registered = perCopyChecks(context);
    expect(
      registered.length,
      "the per-copy wiring checks this suite registers; an emptied map or a deleted block lowers the count"
    ).toBe(floor("checks"));
    for (const relPath of COPIES) {
      expect(
        registered.filter((check) => check.block === relPath).length,
        `${relPath}: the renderings do not carry the same per-copy checks, so the floor is met by one of them covering another`
      ).toBe(floor("checks") / floor("copies"));
    }
  });

  it("reads every floor the requirement names, so an unread bound cannot outlive its assertion", () => {
    const source = readFileSync(SELF_PATH, "utf8");
    const consumed = new Set([...source.matchAll(/\bfloor\("([a-z]+)"\)/g)].map((match) => match[1] as string));
    const unread = [...FLOORS.keys()].filter((name) => !consumed.has(name));
    expect(
      unread,
      "a floor the requirement names is asserted nowhere in this file, so deleting the assertion that held it leaves the bound standing with nothing reading it."
    ).toEqual([]);
    expect(FLOORS.size, "the requirement names no floors, and a sweep with no bound is one nothing can shrink visibly").toBeGreaterThan(0);
  });

  it("the map and the rows name the same tools, and AC-3 names the same gates as the map", () => {
    expect(WIRING.map((entry) => entry.tool).sort(), "the map and the rows name different tools").toEqual([...CARRIED_HERE].sort());
    for (const entry of WIRING) {
      expect(entry.gates.length, `${entry.tool}: the map names no gate, so the second mutation would be vacuous`).toBeGreaterThan(0);
      expect(entry.cli, `${entry.tool}: the map names no CLI fallback`).not.toBe("");
    }
    // The map is stated twice — once as a note this file parses, once as AC-3's own sentence a
    // person reads. Round 1 corrected one copy of a gate list and left the other, so the two are
    // held against each other here rather than each being trusted on its own.
    expect(
      gatesStatedByAc3(),
      "AC-3's gate sentence and the wiring map disagree; a correction landed in one copy of the map and not the other"
    ).toEqual(WIRING.flatMap((entry) => entry.gates));
  });

  it("every gate the map names is one that tool's own handler can raise", () => {
    // Round 1's `unallocated-req-id` sat in the map, in AC-3 and in all four sections, and no
    // assertion looked at whether `orchestrate_readiness_check` could produce it. It cannot: the
    // identifier comes from `checkWaveAllocation`, which nothing in `src/` calls.
    const unreachable = WIRING.flatMap((entry) =>
      entry.gates.filter((gate) => !raisesGate(entry.tool, gate)).map((gate) => `${entry.tool} cannot raise ${gate}`)
    );
    expect(unreachable, "the map names a gate the tool's handler and its kernel modules never produce").toEqual([]);

    // The body is cut by bracket matching, which an unbalanced parenthesis inside a comment or a
    // string breaks. Cutting short fails closed — a shorter body reaches fewer modules and reports
    // a gate absent — but over-extending widens the module set and would let a gate the tool cannot
    // raise pass. Measured on this tree: an odd `(` in a comment of the readiness handler together
    // with an odd `)` after it took its body from 672 characters to 5778 and its module set from
    // one to five, swallowing the `schedule` leaf. A body that has run past its own handler carries
    // the next leaf's registration, and none of the three shipped bodies carries one.
    for (const entry of WIRING) {
      const body = handlerBody(PATH_OF.get(entry.tool) as readonly string[]);
      expect(body, `${entry.tool}: the handler body is empty, so every gate above would be reported absent`).not.toBe("");
      expect(
        body.includes('.command("'),
        `${entry.tool}: the cut body runs past its own handler into another leaf's registration, so the modules it reaches are wider than this tool's path`
      ).toBe(false);
    }

    // Both directions, so a reader that has stopped matching cannot report a clean tree.
    expect(raisesGate("orchestrate_readiness_check", "requirement-not-ready"), "the reader no longer finds a gate this handler does raise").toBe(true);
    expect(raisesGate("orchestrate_readiness_check", "unallocated-req-id"), "the reader accepts the gate round 1 shipped, so it would not have caught it").toBe(false);
    expect(raisesGate("orchestrate_route_probe", "requirement-not-ready"), "the reader accepts a gate from another tool's path").toBe(false);
  });

  it("keeps both polarity vocabularies answering for themselves", () => {
    expect(POLARITY_SURVIVES.length, "phrases the requirement holds the survival vocabulary to").toBe(floor("survives"));
    expect(POLARITY_OVERRIDES.length, "phrases the requirement holds the override vocabulary to").toBe(floor("overrides"));
    expect(new Set(POLARITY_SURVIVES).size, "two entries carrying one phrase would let either be deleted with the other covering for it").toBe(POLARITY_SURVIVES.length);
    expect(new Set(OVERRIDE_PHRASES).size, "two entries carrying one phrase would let either be deleted with the other covering for it").toBe(POLARITY_OVERRIDES.length);

    // A survival phrase no shipped instruction carries is padding: the disjunction stays satisfiable
    // through the others, so the phrase bounds nothing.
    const openedBefore = OPENED.length;
    const shipped = COPIES.flatMap((relPath) => WIRING.flatMap((entry) => instructionLines(verbSection(bodyOf(relPath), entry.verb), entry.tool)));
    expect(shipped.length, "no instruction line was read, so the probe below would prove nothing").toBeGreaterThan(0);
    // The three shipped instruction lines are byte-identical across the four renderings — measured —
    // so a sweep that reads one rendering four times produces the same lines and the same verdict as
    // a sweep that reads four. What separates them is which files were opened, which is why the
    // reader records that rather than this line asserting over what it got back.
    expect(
      OPENED.slice(openedBefore).map((opened) => opened.relPath),
      "the sweep read one rendering in place of the one it was handed, so a phrase carried by that rendering alone would look bounded while bounding nothing"
    ).toEqual(COPIES.flatMap((relPath) => WIRING.map(() => relPath)));
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
      if (covered.length > 0) {
        failures.push(`\`${term.phrase}\` is not what catches its sample — ${covered.join(", ")} does, so deleting the phrase would leave this probe green`);
      }
      if (POLARITY_SURVIVES.some((phrase) => term.sample.includes(phrase))) {
        failures.push(`the sample for \`${term.phrase}\` also reads as survival, so it does not isolate a cancellation`);
      }
    }
    expect(failures, "a vocabulary probed only as a whole survives losing one alternative, and the cancellation it caught then passes").toEqual([]);
  });

  it("keeps the cancellation reader answering in both directions", () => {
    const real = verbSection(bodyOf(COPIES[0] as string), (WIRING[0] as WiringEntry).verb);
    expect(real, "the first wired section is empty, so the probe below would prove nothing").not.toBe("");
    expect(cancellations(real, "shipped"), "the unmodified section must pass, or the reader is matching its own subject").toEqual([]);
    expect(
      cancellations(`${real}\n\n다만 이 호출은 필요하면 생략해도 된다.`, "probe").length,
      "a reader that has stopped matching reports nothing, which is what a clean tree reports"
    ).toBeGreaterThan(0);
  });

  describe.each(COPIES)("%s", (relPath) => {
    it.each(WIRING)("names $tool inside §V.$verb, with its CLI fallback and its gate", (entry) => {
      const section = verbSection(bodyOf(relPath), entry.verb);
      expect(section, `${relPath}: §V.${entry.verb} does not exist`).not.toBe("");
      expect(section.includes(entry.tool), `${relPath}: §V.${entry.verb} does not name ${entry.tool}`).toBe(true);
      // Flattened, because the three renderings wrap at different widths and a citation folded onto
      // a second line is the same instruction; reading the raw bytes would report a false red.
      expect(flat(section).includes(flat(entry.cli)), `${relPath}: §V.${entry.verb} does not name the CLI fallback ${entry.cli}`).toBe(true);
      for (const gate of entry.gates) {
        expect(section.includes(gate), `${relPath}: §V.${entry.verb} names ${entry.tool} but not the gate ${gate} that receives its verdict`).toBe(true);
      }
    });

    it.each(WIRING)("states the call for $tool as an instruction rather than as an option", (entry) => {
      const section = verbSection(bodyOf(relPath), entry.verb);
      const sentence = section
        .split(/(?<=[.。]|다\.)\s/)
        .filter((part) => part.includes(entry.tool) || part.includes(flat(entry.cli)))
        .join(" ");
      expect(sentence, `${relPath}: §V.${entry.verb} carries no sentence naming ${entry.tool}`).not.toBe("");
      expect(HEDGE.test(sentence), `${relPath}: §V.${entry.verb} hedges the call to ${entry.tool}`).toBe(false);
    });

    it.each(WIRING)("says the call for $tool is made, and nowhere in §V.$verb takes it back", (entry) => {
      const section = verbSection(bodyOf(relPath), entry.verb);
      const lines = instructionLines(section, entry.tool);
      expect(lines, `${relPath}: §V.${entry.verb} must name ${entry.tool} on exactly one line`).toHaveLength(1);
      const instruction = lines[0] as string;
      expect(
        POLARITY_SURVIVES.some((phrase) => instruction.includes(phrase)),
        `${relPath}: §V.${entry.verb} names ${entry.tool} without saying the call is made — presence does not separate an instruction from its negation`
      ).toBe(true);
      expect(cancellations(section, `${relPath}: §V.${entry.verb}`), "a block of the section takes the instruction back").toEqual([]);
    });
  });
});

// ── the input the wired section tells the agent to build ────────────────────────────────────────

/**
 * The wired entry whose section tells the agent to assemble the tool's input, found by the gate the
 * kernel names rather than by a tool name typed here — the map and `readiness.ts` have to agree for
 * this block to have a subject at all.
 */
const SNAPSHOT_ENTRY = WIRING.find((entry) => entry.gates.includes(REQUIREMENT_NOT_READY_GATE));

/**
 * One requirement record of the shape the workspace parser produces, for the real projector to
 * narrow. Nothing about the record itself is under test: what is under test is which of its fields
 * survive the projection the section names, and whether the snapshot parser accepts what survives.
 */
const SNAPSHOT_FIXTURE: RequirementRecord = {
  id: "FR-FLOW-000",
  title: "a record for the projector to narrow",
  type: "functional",
  target: "0.0.0",
  status: "verified",
  scope: "FLOW",
  filePath: "docs/spec/60.workflow-release.srs.md",
  headingLine: 1,
  stability: "stable",
  metadata: { Status: "verified", Stability: "stable" },
  acceptanceCriteria: [{ id: "AC-1", text: "the criterion the parser reads", checked: true, line: 2 }],
  verificationEvidence: [{ id: "VE-1", type: "test", reference: "test/skills", covers: "AC-1", notes: "-", line: 3 }],
  traceLinks: [{ type: "Code", reference: "src/core/orchestrator/readiness.ts", relation: "implements", notes: "-", line: 4 }],
  changeNotes: [{ date: "2026-08-30", change: "Created", reason: "fixture", line: 5 }],
  tags: []
};

const SNAPSHOT_SUMMARY: SpecTargetSummary = {
  target: SNAPSHOT_FIXTURE.target,
  total: 1,
  countsByStatus: { verified: 1 },
  countsByStability: { stable: 1 },
  blocked: [],
  implementedNotVerified: [],
  missingEvidence: [],
  draftRequirements: [],
  deprecatedRequirements: [],
  stabilityBlockers: [],
  diagnosticsSummary: { errors: 0, warnings: 0 }
};

/** What `run` threw, or null. Used where the assertion is about the thrown value's own fields. */
function thrownBy(run: () => unknown): unknown {
  try {
    run();
    return null;
  } catch (error) {
    return error;
  }
}

describe("FR-FLOW-167 the input the wired section tells the agent to build", () => {
  it("assembles the snapshot the way the section says to, and it reaches the gate", () => {
    // Round 2 measured what "the section says how" is worth when nothing runs it. The sentence read
    // `list_requirements` 응답과 `summarize_target` 응답을 한 JSON 문서로 합친 것 and the fence gave
    // the discriminator and the top-level keys, all of it true — and a document built exactly that
    // way ended at `{"ok":false,"error":"Malformed requirement snapshot: acceptanceCriteria"}`.
    // Both transports default to the compact projection, which carries neither `acceptanceCriteria`
    // nor `verificationEvidence`, and `parseRecord` requires both. The gate was never reached. So
    // the projection is part of the instruction, and this builds the input the way the section says
    // and takes it all the way to the gate rather than asserting that it would get there.
    expect(SNAPSHOT_ENTRY, `the wiring map holds no entry raising ${REQUIREMENT_NOT_READY_GATE}, so this block has no section to read`).toBeDefined();
    const entry = SNAPSHOT_ENTRY as WiringEntry;
    const section = verbSection(bodyOf(COPIES[0] as string), entry.verb);
    const declared = /레코드 투영 ([a-z]+)/.exec(section);
    expect(declared, `§V.${entry.verb} names no record projection, so an agent following it is handed the default`).not.toBeNull();
    const projection = (declared as RegExpExecArray)[1] as string;

    const answered = (chosen: string | undefined): unknown[] =>
      projectRequirementRecords([SNAPSHOT_FIXTURE], chosen === undefined ? {} : { projection: chosen as "ids" | "compact" | "full" })
        .records as unknown[];

    const built = {
      transport: "mcp-list-requirements",
      target: SNAPSHOT_FIXTURE.target,
      records: answered(projection),
      diagnostics: [],
      summary: SNAPSHOT_SUMMARY
    } as unknown as SnapshotPayload;

    const parsed = parseRequirementSnapshot(built);
    expect(parsed.records.map((record) => record.id), "the snapshot parsed but carries no record, so the gate below would fire for the wrong reason").toEqual([SNAPSHOT_FIXTURE.id]);

    const raised = thrownBy(() => assertRequirementsReady(parsed, SNAPSHOT_FIXTURE.target, ["FR-FLOW-000-absent"]));
    expect(raised, "the snapshot reached the readiness derivation but the gate did not fire on an id the document does not carry").toBeInstanceOf(RequirementNotReadyError);
    expect((raised as RequirementNotReadyError).gate, "the gate reached is not the one the wiring map names for this tool").toBe(REQUIREMENT_NOT_READY_GATE);
    expect(entry.gates, "the map no longer names the gate this section's input actually reaches").toContain((raised as RequirementNotReadyError).gate);

    // The other direction, so the projection clause is load-bearing rather than decorative: the same
    // assembly under the default projection does not reach the gate at all.
    expect(
      () => parseRequirementSnapshot({ ...(built as object), records: answered(undefined) } as unknown as SnapshotPayload),
      "the default projection reaches the gate too, so naming a projection in the section bounds nothing"
    ).toThrow(/Malformed requirement snapshot/);
  });
});

// Declared last on purpose: Vitest runs a file's tests in declaration order, so by the time this
// block runs every per-copy check above has recorded what it opened.
describe("FR-FLOW-167 what the per-copy checks read", () => {
  it("every per-copy check opened the rendering its own block is named for", (context) => {
    const registered = perCopyChecks(context);
    expect(
      registered.length,
      "no per-copy check is registered, so the ledger below has nothing to answer for"
    ).toBe(floor("checks"));

    // Against the checks that RAN rather than the checks that exist, so a `-t` filter narrows the
    // comparison instead of failing it. Each per-copy check opens exactly one rendering, and it
    // opens it before its first assertion, so a failing check is still counted here.
    const reads = OPENED.filter((opened) => opened.block !== "");
    expect(
      reads.length,
      "a per-copy check opened no rendering, or opened more than one, so the pairing below is not one check to one file"
    ).toBe(registered.filter((check) => check.ran).length);

    expect(
      reads.filter((opened) => opened.block !== opened.relPath).map((opened) => `${opened.block} opened ${opened.relPath}`),
      "a per-copy check read a rendering other than the one its block is named for, so that rendering is registered and counted while nothing reads it"
    ).toEqual([]);

    // The digest is of the bytes that came back, not of either label, so a recorder that logged the
    // block's own name in place of the argument it was handed still reports the wrong file here.
    // It separates three of the four renderings; `skills/codex` and its mirror are byte-identical,
    // and those two are told apart only by the path recorded above.
    expect(
      reads.filter((opened) => opened.digest !== digestOf(opened.block)).map((opened) => `${opened.block} was answered with bytes that are not its own`),
      "a per-copy check was handed a rendering's bytes under another rendering's name"
    ).toEqual([]);
  });
});
