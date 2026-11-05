// @req FR-NODE-216 — the wave declaration file: the decomposition's waves, their dependencies, their
// declared write sets and requirements, as the one machine-read source `schedule waves --waves` and
// `wave status --waves` plan from.
//
// Pure: the document and the journal's wave statuses arrive as values. Reading the file, the journal
// and the SDS files stays in the command.
import { createHash } from "node:crypto";
import { canonicalJson } from "./canonical-json.js";
import { compareStrings } from "./conflict.js";
import { COMPLETION_STATUS, DONE_WHEN_ID, ENGINES, waveNumber, type EventStatus } from "./journal-schema.js";
import { findDependencyCycle } from "./lane-plan.js";
import { normalisedPath } from "../sds/lite-sds.js";
import { REQUIREMENT_ID_SOURCE } from "../testing/test-citations.js";

export const WAVE_DECLARATION_SCHEMA_VERSION = "1.0.0";

/** The work-graph schema: nodes and edges, normalized to the same declaration. @req FR-NODE-244 */
export const WORK_GRAPH_SCHEMA_VERSION = "2.0.0";

/** The only wave name the journal view parses (`waveNumber`): `wave-<n>`, n from 1, no leading zero. */
const WAVE_NAME = /^wave-[1-9][0-9]*$/;

const DOCUMENT_KEYS = ["schema_version", "waves"] as const;
const ENTRY_KEYS = ["wave", "depends_on", "files", "requirements", "sds"] as const;

export interface WaveDeclarationEntry {
  /** `wave-<n>`. */
  readonly wave: string;
  /** `n`, which is also the journal's `order` for the wave. */
  readonly order: number;
  /** The declared `depends_on`, or every entry with a smaller `n` when the entry declared none; sorted. */
  readonly dependsOn: readonly string[];
  readonly files: readonly string[];
  readonly requirements: readonly string[];
  readonly sds?: readonly string[];
}

/** The entries in ascending `n`. */
export interface WaveDeclaration {
  readonly waves: readonly WaveDeclarationEntry[];
}

/** The gates a parse refusal names; `null` for a shape error that belongs to no gate. */
export type WaveDeclarationGate = "lane-plan-incomplete" | "schedule-cycle";

/** A parse refusal: the gate it names, if any, and the message naming what is wrong. */
export interface WaveDeclarationRefusal {
  readonly ok: false;
  readonly gate: WaveDeclarationGate | null;
  readonly message: string;
}

export type WaveDeclarationParse = { readonly ok: true; readonly declaration: WaveDeclaration } | WaveDeclarationRefusal;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isPathList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string" && item.length > 0);
}

function refused(message: string, gate: WaveDeclarationGate | null = null): WaveDeclarationRefusal {
  return { ok: false, gate, message };
}

function unknownKey(record: Record<string, unknown>, allowed: readonly string[]): string | undefined {
  return Object.keys(record).find((key) => !allowed.includes(key));
}

interface RawEntry {
  readonly wave: string;
  readonly order: number;
  readonly dependsOn: readonly string[] | undefined;
  readonly files: readonly string[];
  readonly requirements: readonly string[];
  readonly sds: readonly string[] | undefined;
}

/** One entry's shape, or the message naming what is wrong with it. */
function readEntry(value: unknown, index: number): RawEntry | string {
  const at = `waves[${index}]`;
  if (!isRecord(value)) return `${at} must be an object`;
  const extra = unknownKey(value, ENTRY_KEYS);
  if (extra !== undefined) return `${at} has the unknown key ${extra}`;
  const wave = value.wave;
  if (typeof wave !== "string" || !WAVE_NAME.test(wave)) return `${at}.wave must match ${WAVE_NAME.source}, not ${JSON.stringify(wave)}`;
  const dependsOn = value.depends_on;
  if (dependsOn !== undefined && (!Array.isArray(dependsOn) || dependsOn.some((item) => typeof item !== "string" || !WAVE_NAME.test(item)))) {
    return `${wave}.depends_on must be a list of wave-<n> names, not ${JSON.stringify(dependsOn)}`;
  }
  if (!isPathList(value.files)) return `${wave}.files must be a list of paths`;
  if (!Array.isArray(value.requirements) || value.requirements.some((item) => typeof item !== "string" || item.length === 0)) {
    return `${wave}.requirements must be a list of requirement ids`;
  }
  if (value.sds !== undefined && !isPathList(value.sds)) return `${wave}.sds must be a list of SDS paths`;
  const sds = value.sds === undefined ? undefined : normalisedList(wave, "sds", value.sds);
  if (typeof sds === "string") return sds;
  const files = normalisedList(wave, "files", value.files);
  if (typeof files === "string") return files;
  return {
    wave,
    order: waveNumber(wave) as number,
    dependsOn: dependsOn as string[] | undefined,
    files,
    requirements: value.requirements as string[],
    sds
  };
}

/**
 * The SDS Files rule applied to a list: `\` and `/` are one separator, `.` segments vanish, and an
 * absolute path or one that leaves the root is refused — otherwise two spellings of one file would
 * land in one stage. `files` is also sorted and deduplicated, so its order is not part of the entry's
 * digest; `sds` keeps the declared order, which names a grouped wave's parts.
 */
function normalisedList(wave: string, key: "files" | "sds", raw: readonly string[]): string[] | string {
  const paths: string[] = [];
  for (const item of raw) {
    const normalised = normalisedPath(item);
    if ("reason" in normalised) return `${wave}.${key}: ${normalised.reason}`;
    paths.push(normalised.path);
  }
  return key === "files" ? [...new Set(paths)].sort(compareStrings) : paths;
}

/**
 * Parses a declaration document. Everything the plan could be wrong about is refused here, before a
 * journal is read or a lock is written: a name outside `wave-<n>`, an unknown key, a malformed entry,
 * a duplicate wave, a dependency naming no entry and a cycle. @req FR-NODE-216 AC-1
 *
 * A `schema_version` 2.0.0 document is a work graph and yields the same declaration. @req FR-NODE-244 AC-7
 */
export function parseWaveDeclaration(value: unknown): WaveDeclarationParse {
  if (!isRecord(value)) return refused("the wave declaration must be a JSON object");
  if (value.schema_version === WORK_GRAPH_SCHEMA_VERSION) {
    const graph = parseWorkGraph(value);
    return graph.ok ? { ok: true, declaration: graph.graph.declaration } : graph;
  }
  const extra = unknownKey(value, DOCUMENT_KEYS);
  if (extra !== undefined) return refused(`the wave declaration has the unknown key ${extra}`);
  if (value.schema_version !== WAVE_DECLARATION_SCHEMA_VERSION) {
    return refused(`the wave declaration schema_version must be ${WAVE_DECLARATION_SCHEMA_VERSION} or ${WORK_GRAPH_SCHEMA_VERSION}`);
  }
  if (!Array.isArray(value.waves)) return refused("the wave declaration needs a waves list");

  const raw: RawEntry[] = [];
  for (const [index, item] of value.waves.entries()) {
    const read = readEntry(item, index);
    if (typeof read === "string") return refused(read);
    const twice = declaredTwice(raw, read);
    if (twice !== null) return twice;
    raw.push(read);
  }
  raw.sort((left, right) => left.order - right.order);

  const names = new Set(raw.map((entry) => entry.wave));
  const dependsOn = new Map<string, string[]>();
  for (const entry of raw) {
    const declared = entry.dependsOn ?? raw.filter((other) => other.order < entry.order).map((other) => other.wave);
    const missing = declared.find((name) => !names.has(name));
    if (missing !== undefined) return refused(`${entry.wave} depends on ${missing}, which the declaration does not name`);
    dependsOn.set(entry.wave, [...new Set(declared)].sort(compareStrings));
  }
  return declarationOf(raw, dependsOn);
}

/** The refusal for an entry or node whose wave an earlier one already declared, or `null`. */
function declaredTwice(earlier: readonly RawEntry[], read: RawEntry): WaveDeclarationRefusal | null {
  return earlier.some((entry) => entry.wave === read.wave) ? refused(`${read.wave} is declared twice`, "lane-plan-incomplete") : null;
}

/** The declaration of entries sorted by `n` and their resolved dependencies, refusing a cycle. */
function declarationOf(raw: readonly RawEntry[], dependsOn: ReadonlyMap<string, string[]>): WaveDeclarationParse {
  const cycle = findDependencyCycle(raw.map((entry) => entry.wave), dependsOn);
  if (cycle !== null) return refused(cycle, "schedule-cycle");

  return {
    ok: true,
    declaration: {
      waves: raw.map((entry) => ({
        wave: entry.wave,
        order: entry.order,
        dependsOn: dependsOn.get(entry.wave) as string[],
        files: entry.files,
        requirements: entry.requirements,
        ...(entry.sds === undefined ? {} : { sds: entry.sds })
      }))
    }
  };
}

// ---------------------------------------------------------------------------------------------
// Schema 2.0.0 — the work graph. @req FR-NODE-244
//
// The declaration keeps only `wave`, `files`, `sds`, the requirement set computed from `acs`, and
// `depends_on` computed from the edges, which is why an edit of a descriptive field cannot move the
// digest (AC-8). The descriptive fields are kept beside it, on the graph, for the readers that derive
// a node's completion and check the graph (FR-NODE-249, FR-NODE-246).
// ---------------------------------------------------------------------------------------------

/** A completion action that reports through a channel alias. @req FR-NODE-244 AC-5 */
export interface NotifyAction {
  readonly kind: "notify";
  readonly id: string;
  readonly channel: string;
  readonly message?: string;
  /** Defaults to false. */
  readonly blocking: boolean;
}

/** A completion action the agent carries out from its text. @req FR-NODE-244 AC-5 */
export interface InstructionAction {
  readonly kind: "instruction";
  readonly id: string;
  readonly text: string;
  /** Defaults to false. */
  readonly blocking: boolean;
}

export type CompletionAction = NotifyAction | InstructionAction;

/** A completion condition the run confirms with `done_when_confirmed`. @req FR-NODE-244 AC-4 */
export interface DoneWhen {
  readonly id: string;
  readonly text: string;
}

export interface WorkGraphNode {
  readonly wave: string;
  /** `n` of `wave-<n>`. */
  readonly order: number;
  readonly title: string;
  readonly purpose: string;
  readonly description?: string;
  readonly githubIssues?: readonly (number | string)[];
  readonly cautions?: readonly string[];
  /** `<REQ-ID> AC-<n>`, as declared. */
  readonly acs: readonly string[];
  /** The requirement set of `acs`, in first-occurrence order. */
  readonly requirements: readonly string[];
  readonly doneWhen: readonly DoneWhen[];
  /** The node's own actions; absent when it declared none, so `defaults.on_complete` applies. */
  readonly onComplete?: readonly CompletionAction[];
  /** Normalized, sorted and deduplicated, as in the declaration. */
  readonly files: readonly string[];
  readonly sds?: readonly string[];
}

export interface WorkGraphEdge {
  readonly from: string;
  readonly to: string;
  readonly reason?: string;
}

export type WorkGraphScope = { readonly target: string } | { readonly requirements: readonly string[] };

/** A parsed 2.0.0 work graph: every field it declares, and the declaration it normalizes to. */
export interface WorkGraph {
  readonly runId: string;
  readonly title: string;
  readonly scope: WorkGraphScope;
  readonly engine?: string;
  readonly prd?: string;
  readonly defaultOnComplete?: readonly CompletionAction[];
  /** In ascending `n`. */
  readonly nodes: readonly WorkGraphNode[];
  /** In declared order. */
  readonly edges: readonly WorkGraphEdge[];
  /** What 1.0.0 would yield for the same waves: what `computeLanePlan` and `waveReadiness` read. */
  readonly declaration: WaveDeclaration;
}

export type WorkGraphParse = { readonly ok: true; readonly graph: WorkGraph } | WaveDeclarationRefusal;

const GRAPH_REQUIRED_KEYS = ["schema_version", "run_id", "title", "scope", "nodes", "edges"] as const;
const GRAPH_KEYS = [...GRAPH_REQUIRED_KEYS, "engine", "prd", "defaults"] as const;
const NODE_REQUIRED_KEYS = ["wave", "title", "purpose", "acs", "done_when", "files"] as const;
const NODE_KEYS = [...NODE_REQUIRED_KEYS, "description", "github_issues", "cautions", "on_complete", "sds"] as const;
const EDGE_KEYS = ["from", "to", "reason"] as const;
const NOTIFY_KEYS = ["id", "kind", "channel", "message", "blocking"] as const;
const INSTRUCTION_KEYS = ["id", "kind", "text", "blocking"] as const;

const REQUIREMENT_ID = new RegExp(`^${REQUIREMENT_ID_SOURCE}$`);
/** `<REQ-ID> AC-<n>`, one space; the group is the requirement. @req FR-NODE-244 AC-3 */
const AC_REFERENCE = new RegExp(`^(${REQUIREMENT_ID_SOURCE}) AC-[1-9][0-9]*$`);
const GITHUB_ISSUE_REFERENCE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+#[1-9][0-9]*$/;
const CHANNEL_ALIAS = /^[a-z][a-z0-9-]{0,39}$/;

/** A string whose length in code points lies in `[min, max]`. */
function boundedText(value: unknown, min: number, max: number): value is string {
  if (typeof value !== "string") return false;
  const length = [...value].length;
  return length >= min && length <= max;
}

function nonEmptyText(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function missingKey(record: Record<string, unknown>, required: readonly string[]): string | undefined {
  return required.find((key) => record[key] === undefined);
}

/** The scope: exactly one of `target` or a non-empty requirement list. @req FR-NODE-244 AC-1 */
function scopeProblem(value: unknown): string | null {
  const wrong = "scope must hold exactly one of target (a string) or requirements (a non-empty list of requirement ids)";
  if (!isRecord(value) || unknownKey(value, ["target", "requirements"]) !== undefined) return wrong;
  const hasTarget = value.target !== undefined;
  if (hasTarget === (value.requirements !== undefined)) return wrong;
  if (hasTarget) return nonEmptyText(value.target) ? null : wrong;
  const requirements = value.requirements;
  const valid = Array.isArray(requirements) && requirements.length > 0 && requirements.every((id) => typeof id === "string" && REQUIREMENT_ID.test(id));
  return valid ? null : wrong;
}

/** A completion action list of the two closed kinds, `notify` and `instruction`. @req FR-NODE-244 AC-5 */
function readActions(value: unknown, at: string): CompletionAction[] | string {
  if (!Array.isArray(value)) return `${at} must be a list of actions`;
  const actions: CompletionAction[] = [];
  for (const [index, action] of value.entries()) {
    const where = `${at}[${index}]`;
    if (!isRecord(action)) return `${where} must be an object`;
    const keys = action.kind === "notify" ? NOTIFY_KEYS : action.kind === "instruction" ? INSTRUCTION_KEYS : null;
    if (keys === null) return `${where}.kind must be notify or instruction, not ${JSON.stringify(action.kind)}`;
    const extra = unknownKey(action, keys);
    if (extra !== undefined) return `${where} has the unknown key ${extra}`;
    if (!nonEmptyText(action.id)) return `${where}.id must be a non-empty string`;
    if (action.blocking !== undefined && typeof action.blocking !== "boolean") return `${where}.blocking must be true or false`;
    const blocking = action.blocking === true;
    if (action.kind === "notify") {
      if (typeof action.channel !== "string" || !CHANNEL_ALIAS.test(action.channel)) return `${where}.channel must be a channel alias matching ${CHANNEL_ALIAS.source}`;
      if (action.message !== undefined && !nonEmptyText(action.message)) return `${where}.message must be a non-empty string`;
      actions.push({ kind: "notify", id: action.id, channel: action.channel, ...(action.message === undefined ? {} : { message: action.message }), blocking });
    } else if (!nonEmptyText(action.text)) {
      return `${where}.text must be a non-empty string`;
    } else {
      actions.push({ kind: "instruction", id: action.id, text: action.text, blocking });
    }
  }
  return actions;
}

/** The requirement set of `acs`, in first-occurrence order, or the message naming the bad item. @req FR-NODE-244 AC-3 */
function requirementsOfAcs(value: unknown, wave: string): string[] | string {
  if (!Array.isArray(value) || value.length === 0) return `${wave}.acs must be a non-empty list of "<REQ-ID> AC-<n>"`;
  const requirements: string[] = [];
  for (const item of value) {
    const match = typeof item === "string" ? AC_REFERENCE.exec(item) : null;
    if (match === null) return `${wave}.acs item ${JSON.stringify(item)} is not of the form "<REQ-ID> AC-<n>"`;
    if (value.indexOf(item) !== value.lastIndexOf(item)) return `${wave}.acs lists ${item} twice`;
    const requirement = match[1] as string;
    if (!requirements.includes(requirement)) requirements.push(requirement);
  }
  return requirements;
}

/** `done_when`: `{id, text}` items with ids unique in the node; empty is allowed. @req FR-NODE-244 AC-4 */
function readDoneWhen(value: unknown, wave: string): DoneWhen[] | string {
  if (!Array.isArray(value)) return `${wave}.done_when must be a list`;
  const ids = new Set<string>();
  const doneWhen: DoneWhen[] = [];
  for (const item of value) {
    if (!isRecord(item) || unknownKey(item, ["id", "text"]) !== undefined) return `${wave}.done_when items must be {id, text}`;
    if (typeof item.id !== "string" || !DONE_WHEN_ID.test(item.id)) return `${wave}.done_when id ${JSON.stringify(item.id)} must match ${DONE_WHEN_ID.source}`;
    if (!nonEmptyText(item.text)) return `${wave}.done_when ${item.id} needs a text`;
    if (ids.has(item.id)) return `${wave}.done_when lists ${item.id} twice`;
    ids.add(item.id);
    doneWhen.push({ id: item.id, text: item.text });
  }
  return doneWhen;
}

function isGithubIssue(item: unknown): boolean {
  return (typeof item === "number" && Number.isInteger(item) && item >= 1) || (typeof item === "string" && GITHUB_ISSUE_REFERENCE.test(item));
}

/** One node and the entry the declaration keeps of it, or the message naming what is wrong. @req FR-NODE-244 AC-2 */
function readNode(value: unknown, index: number): { readonly node: WorkGraphNode; readonly entry: RawEntry } | string {
  const at = `nodes[${index}]`;
  if (!isRecord(value)) return `${at} must be an object`;
  const missing = missingKey(value, NODE_REQUIRED_KEYS);
  if (missing !== undefined) return `${at} needs ${missing}`;
  const extra = unknownKey(value, NODE_KEYS);
  if (extra !== undefined) return `${at} has the unknown key ${extra}`;
  const wave = value.wave;
  if (typeof wave !== "string" || !WAVE_NAME.test(wave)) return `${at}.wave must match ${WAVE_NAME.source}, not ${JSON.stringify(wave)}`;
  if (!boundedText(value.title, 1, 60)) return `${wave}.title must be 1 to 60 characters`;
  if (!boundedText(value.purpose, 1, 300)) return `${wave}.purpose must be 1 to 300 characters`;
  if (value.description !== undefined && !boundedText(value.description, 0, 4000)) return `${wave}.description must be at most 4000 characters`;
  if (value.github_issues !== undefined && !(Array.isArray(value.github_issues) && value.github_issues.every(isGithubIssue))) {
    return `${wave}.github_issues must list positive issue numbers or owner/repo#<n>`;
  }
  if (value.cautions !== undefined && !(Array.isArray(value.cautions) && value.cautions.every((item) => boundedText(item, 0, 300)))) {
    return `${wave}.cautions must be a list of strings of at most 300 characters`;
  }
  const requirements = requirementsOfAcs(value.acs, wave);
  if (typeof requirements === "string") return requirements;
  const doneWhen = readDoneWhen(value.done_when, wave);
  if (typeof doneWhen === "string") return doneWhen;
  const onComplete = value.on_complete === undefined ? undefined : readActions(value.on_complete, `${wave}.on_complete`);
  if (typeof onComplete === "string") return onComplete;
  if (!isPathList(value.files)) return `${wave}.files must be a list of paths`;
  if (value.sds !== undefined && !isPathList(value.sds)) return `${wave}.sds must be a list of SDS paths`;
  const sds = value.sds === undefined ? undefined : normalisedList(wave, "sds", value.sds);
  if (typeof sds === "string") return sds;
  const files = normalisedList(wave, "files", value.files);
  if (typeof files === "string") return files;
  const order = waveNumber(wave) as number;
  const node: WorkGraphNode = {
    wave,
    order,
    title: value.title,
    purpose: value.purpose,
    ...(value.description === undefined ? {} : { description: value.description as string }),
    ...(value.github_issues === undefined ? {} : { githubIssues: value.github_issues as (number | string)[] }),
    ...(value.cautions === undefined ? {} : { cautions: value.cautions as string[] }),
    acs: value.acs as string[],
    requirements,
    doneWhen,
    ...(onComplete === undefined ? {} : { onComplete }),
    files,
    ...(sds === undefined ? {} : { sds })
  };
  return { node, entry: { wave, order, dependsOn: undefined, files, requirements, sds } };
}

/**
 * `edges` as each node's dependencies: `to` starts only after `from`. Nothing is implied from node
 * order; an unknown endpoint and a repeated edge are refused here, a self edge and a cycle by the
 * cycle check. @req FR-NODE-244 AC-6
 */
function dependenciesOfEdges(
  value: unknown,
  raw: readonly RawEntry[]
): { readonly dependsOn: Map<string, string[]>; readonly edges: WorkGraphEdge[] } | WaveDeclarationRefusal {
  if (!Array.isArray(value)) return refused("edges must be a list of {from, to, reason?}");
  const dependsOn = new Map<string, string[]>(raw.map((entry) => [entry.wave, []]));
  const edges: WorkGraphEdge[] = [];
  for (const [index, edge] of value.entries()) {
    const at = `edges[${index}]`;
    if (!isRecord(edge)) return refused(`${at} must be an object`);
    const extra = unknownKey(edge, EDGE_KEYS);
    if (extra !== undefined) return refused(`${at} has the unknown key ${extra}`);
    if (edge.reason !== undefined && !nonEmptyText(edge.reason)) return refused(`${at}.reason must be a non-empty string`);
    const { from, to } = edge;
    if (typeof from !== "string" || typeof to !== "string") return refused(`${at} needs from and to`);
    const unknown = [from, to].find((name) => !dependsOn.has(name));
    if (unknown !== undefined) return refused(`${at} names ${unknown}, which no node declares`, "lane-plan-incomplete");
    const into = dependsOn.get(to) as string[];
    if (into.includes(from)) return refused(`${at} repeats the edge ${from} -> ${to}`, "lane-plan-incomplete");
    into.push(from);
    edges.push({ from, to, ...(edge.reason === undefined ? {} : { reason: edge.reason as string }) });
  }
  for (const list of dependsOn.values()) list.sort(compareStrings);
  return { dependsOn, edges };
}

/** The top level of a 2.0.0 document, or the message naming what is wrong. @req FR-NODE-244 AC-1, AC-5 */
function graphTopLevelProblem(value: Record<string, unknown>): string | null {
  const missing = missingKey(value, GRAPH_REQUIRED_KEYS);
  if (missing !== undefined) return `a schema_version ${WORK_GRAPH_SCHEMA_VERSION} work graph needs ${missing}`;
  const extra = unknownKey(value, GRAPH_KEYS);
  if (extra !== undefined) return `a schema_version ${WORK_GRAPH_SCHEMA_VERSION} work graph has the unknown key ${extra}`;
  if (!nonEmptyText(value.run_id)) return "the work graph run_id must be a non-empty string";
  if (!nonEmptyText(value.title)) return "the work graph title must be a non-empty string";
  const scope = scopeProblem(value.scope);
  if (scope !== null) return scope;
  if (value.engine !== undefined && !(ENGINES as readonly unknown[]).includes(value.engine)) return `engine must be one of ${ENGINES.join(", ")}`;
  if (value.prd !== undefined && !nonEmptyText(value.prd)) return "prd must be a non-empty path";
  if (value.defaults === undefined) return null;
  if (!isRecord(value.defaults) || unknownKey(value.defaults, ["on_complete"]) !== undefined) return "defaults may hold only on_complete";
  return null;
}

/**
 * A `schema_version` 2.0.0 document: every field it declares, and the declaration 1.0.0 would yield.
 * The one parse of a work graph; `parseWaveDeclaration` keeps only its declaration. @req FR-NODE-244 AC-7
 */
export function parseWorkGraph(value: unknown): WorkGraphParse {
  if (!isRecord(value) || value.schema_version !== WORK_GRAPH_SCHEMA_VERSION) {
    return refused(`a work graph is a JSON object with schema_version ${WORK_GRAPH_SCHEMA_VERSION}`);
  }
  const problem = graphTopLevelProblem(value);
  if (problem !== null) return refused(problem);
  const defaults = value.defaults as Record<string, unknown> | undefined;
  const defaultOnComplete = defaults?.on_complete === undefined ? undefined : readActions(defaults.on_complete, "defaults.on_complete");
  if (typeof defaultOnComplete === "string") return refused(defaultOnComplete);
  if (!Array.isArray(value.nodes)) return refused("the work graph needs a nodes list");

  const raw: RawEntry[] = [];
  const nodes: WorkGraphNode[] = [];
  for (const [index, item] of value.nodes.entries()) {
    const read = readNode(item, index);
    if (typeof read === "string") return refused(read);
    const twice = declaredTwice(raw, read.entry);
    if (twice !== null) return twice;
    raw.push(read.entry);
    nodes.push(read.node);
  }
  raw.sort((left, right) => left.order - right.order);
  nodes.sort((left, right) => left.order - right.order);

  const edges = dependenciesOfEdges(value.edges, raw);
  if ("ok" in edges) return edges;
  const declared = declarationOf(raw, edges.dependsOn);
  if (!declared.ok) return declared;
  const scope = value.scope as Record<string, unknown>;
  return {
    ok: true,
    graph: {
      runId: value.run_id as string,
      title: value.title as string,
      scope: scope.target === undefined ? { requirements: scope.requirements as string[] } : { target: scope.target as string },
      ...(value.engine === undefined ? {} : { engine: value.engine as string }),
      ...(value.prd === undefined ? {} : { prd: value.prd as string }),
      ...(defaultOnComplete === undefined ? {} : { defaultOnComplete }),
      nodes,
      edges: edges.edges,
      declaration: declared.declaration
    }
  };
}

/**
 * sha256 of the canonical JSON of the entry's `{wave, depends_on, files, sds}`. `requirements[]` is
 * left out: `unallocated-req-id` checks it, and a re-entry may revise it. @req FR-NODE-216 AC-7
 */
export function declarationEntryDigest(entry: WaveDeclarationEntry): string {
  const covered = { wave: entry.wave, depends_on: entry.dependsOn, files: entry.files, ...(entry.sds === undefined ? {} : { sds: entry.sds }) };
  return createHash("sha256").update(canonicalJson(covered)).digest("hex");
}

export interface WaveReadiness {
  /** Not complete, every dependency complete: what `schedule waves --waves` plans. */
  readonly ready: readonly WaveDeclarationEntry[];
  /** Not complete, some dependency not complete. */
  readonly deferred: readonly WaveDeclarationEntry[];
  readonly complete: readonly WaveDeclarationEntry[];
}

/**
 * Splits the declaration by the journal's latest wave statuses (`computeRunProgress(view).waveStatuses`,
 * the predicate resume and `wave status` read). The one function both `schedule waves --waves` and
 * `wave status --waves` call. @req FR-NODE-216 AC-2, IR-CLI-104 AC-2
 */
export function waveReadiness(declaration: WaveDeclaration, waveStatuses: ReadonlyMap<number, EventStatus>): WaveReadiness {
  const isComplete = (wave: string): boolean => waveStatuses.get(waveNumber(wave) as number) === COMPLETION_STATUS;
  const ready: WaveDeclarationEntry[] = [];
  const deferred: WaveDeclarationEntry[] = [];
  const complete: WaveDeclarationEntry[] = [];
  for (const entry of declaration.waves) {
    if (isComplete(entry.wave)) complete.push(entry);
    else if (entry.dependsOn.every(isComplete)) ready.push(entry);
    else deferred.push(entry);
  }
  return { ready, deferred, complete };
}
