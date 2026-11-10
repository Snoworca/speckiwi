// @req FR-NODE-247 — `orchestrate wave propose`: the draft 2.0.0 work graph of a requirement set.
//
// Pure and byte-deterministic: the requirements, the expected-files map and the paths tracked at HEAD
// arrive as values, and every tie is broken by `compareStrings` (code-unit order), never by a locale
// or by input order. Reading the SRS, the `--files` file and `git ls-files` stays in the command. The
// tool never predicts a file: the map is the decomposition's impact analysis, and only its paths are
// checked here.
import { normalisedPath } from "../sds/lite-sds.js";
import { requirementDependencyIds } from "../requirement-dependency.js";
import { requirementIdsIn, testFileMatcher } from "../testing/test-citations.js";
import type { RequirementRecord } from "../types.js";
import { compareStrings } from "./conflict.js";
import { groundFiles, isGroundingRefusal } from "./grounding.js";
import { findDependencyCycle } from "./lane-plan.js";
import { WORK_GRAPH_SCHEMA_VERSION } from "./wave-declaration.js";

/** One requirement as the proposal reads it. Lists may hold IDs outside the set; they are ignored. */
export interface ProposalRequirement {
  readonly id: string;
  readonly title: string;
  /** The live acceptance criteria, `AC-<n>`. */
  readonly acs: readonly string[];
  /** The references of its `Requirement` / `depends_on` Trace Link rows. */
  readonly dependsOn: readonly string[];
  /** Every requirement ID its text names; those a `depends_on` row carries are not soft citations. */
  readonly cites: readonly string[];
}

export type ProposalScope = { readonly target: string } | { readonly requirements: readonly string[] };

export interface ProposalCaps {
  readonly requirements: number;
  readonly acs: number;
  /** Non-test paths. */
  readonly files: number;
}

/** @req FR-NODE-247 AC-6 */
export const DEFAULT_PROPOSAL_CAPS: ProposalCaps = Object.freeze({ requirements: 5, acs: 25, files: 25 });

/** The record fields the proposal reads; a parsed `RequirementRecord` is one. */
export type ProposalRecord = Pick<RequirementRecord, "id" | "title" | "target" | "status" | "acceptanceCriteria" | "traceLinks">
  & Partial<Pick<RequirementRecord, "requirement" | "rationale" | "research" | "implementationNotes">>;

declare const EXPECTED_FILES: unique symbol;
/** Requirement ID to normalised, distinct paths. Only {@link readExpectedFiles} makes one. */
export type ExpectedFiles = ReadonlyMap<string, readonly string[]> & { readonly [EXPECTED_FILES]: true };

export interface WaveProposalInput {
  readonly runId: string;
  readonly scope: ProposalScope;
  readonly requirements: readonly ProposalRequirement[];
  readonly expectedFiles: ExpectedFiles;
  /** The repository paths tracked at HEAD, which grounding compares against. */
  readonly trackedPaths: readonly string[];
  readonly caps?: Partial<ProposalCaps>;
}

export interface DraftNode {
  readonly wave: string;
  readonly title: string;
  readonly purpose: string;
  readonly acs: readonly string[];
  readonly done_when: readonly never[];
  readonly files: readonly string[];
}

export interface DraftEdge {
  readonly from: string;
  readonly to: string;
  readonly reason: string;
}

export interface DraftWorkGraph {
  readonly schema_version: typeof WORK_GRAPH_SCHEMA_VERSION;
  readonly run_id: string;
  readonly title: string;
  readonly scope: ProposalScope;
  readonly nodes: readonly DraftNode[];
  readonly edges: readonly DraftEdge[];
}

export interface UngroundedPath {
  readonly path: string;
  /** The tracked path within Levenshtein distance 2. */
  readonly nearest: string;
  readonly requirements: readonly string[];
}

export interface CycleOverCap {
  readonly requirements: readonly string[];
}

export interface RequirementWithoutLiveAc {
  readonly requirement: string;
}

/** A citation with no `depends_on` row whose two requirements the draft put in different nodes. @req FR-NODE-288 */
export interface CrossNodeCitation {
  readonly requirement: string;
  readonly cites: string;
  readonly node: string;
  readonly citedNode: string;
}

export type WaveProposal =
  | { readonly ok: true; readonly graph: DraftWorkGraph; readonly hubs: readonly string[]; readonly crossNodeCitations: readonly CrossNodeCitation[] }
  | { readonly ok: false; readonly code: "files-not-grounded"; readonly violations: readonly UngroundedPath[] }
  | { readonly ok: false; readonly code: "requirement-cycle-over-cap"; readonly violations: readonly CycleOverCap[] }
  | { readonly ok: false; readonly code: "requirement-without-live-ac"; readonly violations: readonly RequirementWithoutLiveAc[] };

/** @req FR-NODE-247 AC-3 */
const HUB_MIN_REQUIREMENTS = 3;
const HUB_SHARE = 0.25;
/** @req FR-NODE-247 AC-5 */
const DEPENDENCY_WEIGHT = 3;
const CITATION_WEIGHT = 1;
const PATH_WEIGHT = 1;
const DIRECTORY_WEIGHT = 0.5;
const MODULE_DIRECTORY_SEGMENTS = 3;
/** @req FR-NODE-247 AC-6, AC-7 */
const MERGE_THRESHOLD = 1;
const FLOOR_REQUIREMENTS = 2;
const FLOOR_THRESHOLD = 0.5;
/** The FR-NODE-244 bounds on a node's descriptive fields. @req FR-NODE-247 AC-9 */
const TITLE_LIMIT = 60;
const PURPOSE_LIMIT = 300;

const isTestPath = testFileMatcher();

function sortedDistinct(values: Iterable<string>): string[] {
  return [...new Set(values)].sort(compareStrings);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * The `--files` JSON object, each path in the form the work graph's `files` takes, or the message
 * naming what is wrong. @req FR-NODE-247 AC-2
 */
export function readExpectedFiles(value: unknown): { ok: true; files: ExpectedFiles } | { ok: false; message: string } {
  if (!isRecord(value)) return { ok: false, message: "the files map must be a JSON object of requirement ID to path list" };
  const files = new Map<string, string[]>();
  for (const [id, raw] of Object.entries(value)) {
    if (!Array.isArray(raw)) return { ok: false, message: `the files map entry ${id} must be a list of paths` };
    const paths: string[] = [];
    for (const item of raw) {
      if (typeof item !== "string") return { ok: false, message: `the files map entry ${id} holds ${JSON.stringify(item)}, which is not a path` };
      const normalised = normalisedPath(item);
      if ("reason" in normalised) return { ok: false, message: `the files map entry ${id}: ${normalised.reason}` };
      paths.push(normalised.path);
    }
    files.set(id, [...new Set(paths)]);
  }
  return { ok: true, files: files as unknown as ExpectedFiles };
}

/** The requirement text the soft citations are read from: the statement sections and the live criteria. */
function citedIds(record: ProposalRecord): string[] {
  const text = [record.requirement, record.rationale, record.research, record.implementationNotes, ...record.acceptanceCriteria.map((criterion) => criterion.text)];
  return sortedDistinct(requirementIdsIn(text.filter((part): part is string => part !== undefined).join("\n")));
}

export interface InvalidRequirementId {
  readonly id: string;
  readonly reason: "not-a-requirement" | "discarded";
}

export type ProposalSelection =
  | { readonly ok: true; readonly requirements: readonly ProposalRequirement[] }
  | { readonly ok: false; readonly code: "invalid-requirement-id"; readonly violations: readonly InvalidRequirementId[] };

/** @req FR-NODE-247 AC-11 — every named ID that is no requirement or a discarded one, in ID order. */
function invalidNamedIds(records: readonly ProposalRecord[], named: readonly string[]): InvalidRequirementId[] {
  return sortedDistinct(named).flatMap((id): InvalidRequirementId[] => {
    const matches = records.filter((record) => record.id === id);
    if (matches.length === 0) return [{ id, reason: "not-a-requirement" }];
    return matches.every((record) => record.status === "discarded") ? [{ id, reason: "discarded" }] : [];
  });
}

/**
 * The scope's non-discarded requirements, by ID. Dependencies are read from `Requirement` /
 * `depends_on` rows only, the one form a dependency is read in; no SRS field supplies a path. A
 * named ID that is no requirement or a discarded one is refused, never dropped. @req FR-NODE-247 AC-2, AC-11
 */
export function proposalRequirementsOf(records: readonly ProposalRecord[], scope: ProposalScope): ProposalSelection {
  if (!("target" in scope)) {
    const invalid = invalidNamedIds(records, scope.requirements);
    if (invalid.length > 0) return { ok: false, code: "invalid-requirement-id", violations: invalid };
  }
  const inScope = "target" in scope ? (record: ProposalRecord) => record.target === scope.target : (record: ProposalRecord) => scope.requirements.includes(record.id);
  const requirements = records
    .filter((record) => record.status !== "discarded" && inScope(record))
    .map((record) => ({
      id: record.id,
      title: record.title,
      acs: record.acceptanceCriteria.map((criterion) => criterion.id),
      dependsOn: sortedDistinct(requirementDependencyIds(record)),
      cites: citedIds(record)
    }))
    .sort((left, right) => compareStrings(left.id, right.id));
  return { ok: true, requirements };
}

/** A requirement with every list restricted to the set and put in canonical order. */
interface Member {
  readonly id: string;
  readonly title: string;
  readonly acs: readonly string[];
  readonly dependsOn: ReadonlySet<string>;
  readonly cites: ReadonlySet<string>;
  readonly files: readonly string[];
}

function acNumber(acId: string): number {
  return Number.parseInt(acId.replace(/^AC-/u, ""), 10);
}

function membersOf(requirements: readonly ProposalRequirement[], expectedFiles: ExpectedFiles): Member[] {
  const ids = new Set(requirements.map((entry) => entry.id));
  const inSet = (id: string, self: string): boolean => id !== self && ids.has(id);
  return [...requirements]
    .sort((left, right) => compareStrings(left.id, right.id))
    .map((entry) => {
      const dependsOn = new Set(sortedDistinct(entry.dependsOn).filter((id) => inSet(id, entry.id)));
      return {
        id: entry.id,
        title: entry.title,
        acs: [...new Set(entry.acs)].sort((left, right) => acNumber(left) - acNumber(right) || compareStrings(left, right)),
        dependsOn,
        // @req FR-NODE-247 AC-2 — a citation without a depends_on row; the row already counts as a link.
        cites: new Set(sortedDistinct(entry.cites).filter((id) => inSet(id, entry.id) && !dependsOn.has(id))),
        files: expectedFiles.get(entry.id) ?? []
      };
    });
}

/** @req FR-NODE-247 AC-2 — the IR-CLI-084 rule, through the detector `schedule waves` uses. */
function ungroundedPaths(members: readonly Member[], trackedPaths: readonly string[]): UngroundedPath[] {
  const declared = sortedDistinct(members.flatMap((member) => member.files));
  return groundFiles(declared, trackedPaths, false)
    .filter((entry) => isGroundingRefusal(entry.verdict))
    .map((entry) => ({
      path: entry.path,
      nearest: entry.nearest as string,
      requirements: members.filter((member) => member.files.includes(entry.path)).map((member) => member.id)
    }));
}

/** @req FR-NODE-247 AC-3 */
function hubPaths(members: readonly Member[]): Set<string> {
  const counts = new Map<string, number>();
  for (const member of members) for (const path of member.files) counts.set(path, (counts.get(path) ?? 0) + 1);
  return new Set(
    [...counts].filter(([, count]) => count >= HUB_MIN_REQUIREMENTS && count >= HUB_SHARE * members.length).map(([path]) => path)
  );
}

/** Tarjan's strongly connected components, visited in ID order, each sorted. @req FR-NODE-247 AC-4 */
function stronglyConnected(members: readonly Member[]): string[][] {
  const byId = new Map(members.map((member) => [member.id, member]));
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const components: string[][] = [];
  const visit = (id: string): void => {
    index.set(id, index.size);
    low.set(id, index.get(id) as number);
    stack.push(id);
    onStack.add(id);
    for (const next of byId.get(id)?.dependsOn ?? []) {
      if (!index.has(next)) {
        visit(next);
        low.set(id, Math.min(low.get(id) as number, low.get(next) as number));
      } else if (onStack.has(next)) {
        low.set(id, Math.min(low.get(id) as number, index.get(next) as number));
      }
    }
    if (low.get(id) !== index.get(id)) return;
    const component: string[] = [];
    let popped: string;
    do {
      popped = stack.pop() as string;
      onStack.delete(popped);
      component.push(popped);
    } while (popped !== id);
    components.push(component.sort(compareStrings));
  };
  for (const member of members) if (!index.has(member.id)) visit(member.id);
  return components;
}

interface Unit {
  /** The smallest requirement ID: unique, since units are disjoint. */
  readonly key: string;
  readonly ids: readonly string[];
  readonly acs: number;
  readonly files: ReadonlySet<string>;
  /** Non-hub paths and their module directories: what affinity reads. @req FR-NODE-247 AC-3 */
  readonly paths: ReadonlySet<string>;
  readonly directories: ReadonlySet<string>;
}

/** The directory holding the file, cut to its first three segments. @req FR-NODE-247 AC-5 */
function moduleDirectory(path: string): string {
  return path.split("/").slice(0, -1).slice(0, MODULE_DIRECTORY_SEGMENTS).join("/");
}

function unitOf(ids: readonly string[], byId: ReadonlyMap<string, Member>, hubs: ReadonlySet<string>): Unit {
  const sorted = [...ids].sort(compareStrings);
  const members = sorted.map((id) => byId.get(id) as Member);
  const files = new Set(members.flatMap((member) => member.files));
  const paths = new Set([...files].filter((path) => !hubs.has(path)));
  return {
    key: sorted[0] as string,
    ids: sorted,
    acs: members.reduce((sum, member) => sum + member.acs.length, 0),
    files,
    paths,
    directories: new Set([...paths].map(moduleDirectory))
  };
}

function nonTestCount(files: Iterable<string>): number {
  let count = 0;
  for (const path of files) if (!isTestPath(path)) count += 1;
  return count;
}

/** @req FR-NODE-247 AC-4, AC-6 */
function withinCaps(ids: number, acs: number, files: Iterable<string>, caps: ProposalCaps): boolean {
  return ids <= caps.requirements && acs <= caps.acs && nonTestCount(files) <= caps.files;
}

function countShared(left: ReadonlySet<string>, right: ReadonlySet<string>): number {
  let count = 0;
  for (const value of left) if (right.has(value)) count += 1;
  return count;
}

/** @req FR-NODE-247 AC-5 */
function affinity(left: Unit, right: Unit, byId: ReadonlyMap<string, Member>): number {
  let links = 0;
  let citations = 0;
  for (const a of left.ids) {
    const first = byId.get(a) as Member;
    for (const b of right.ids) {
      const second = byId.get(b) as Member;
      links += Number(first.dependsOn.has(b)) + Number(second.dependsOn.has(a));
      citations += Number(first.cites.has(b)) + Number(second.cites.has(a));
    }
  }
  return DEPENDENCY_WEIGHT * links
    + CITATION_WEIGHT * citations
    + PATH_WEIGHT * countShared(left.paths, right.paths)
    + DIRECTORY_WEIGHT * countShared(left.directories, right.directories);
}

/** Each unit's key to the keys of the units its requirements depend on. */
function unitGraph(units: readonly Unit[], byId: ReadonlyMap<string, Member>): Map<string, string[]> {
  const owner = new Map(units.flatMap((unit) => unit.ids.map((id) => [id, unit.key] as const)));
  return new Map(
    units.map((unit) => [
      unit.key,
      sortedDistinct(unit.ids.flatMap((id) => [...(byId.get(id) as Member).dependsOn].map((dependency) => owner.get(dependency) as string)))
        .filter((key) => key !== unit.key)
    ])
  );
}

/** Whether contracting `a` and `b` into one unit closes a cycle in the unit graph. @req FR-NODE-247 AC-6 */
function mergeMakesCycle(graph: ReadonlyMap<string, readonly string[]>, a: string, b: string): boolean {
  const rename = (key: string): string => (key === b ? a : key);
  const contracted = new Map<string, string[]>();
  for (const [key, dependencies] of graph) {
    const into = contracted.get(rename(key)) ?? [];
    into.push(...dependencies.map(rename).filter((dependency) => dependency !== rename(key)));
    contracted.set(rename(key), into);
  }
  return findDependencyCycle([...contracted.keys()], contracted) !== null;
}

type MergeKey = readonly [number, number, string];

function compareKeys(left: MergeKey, right: MergeKey): number {
  return left[0] - right[0] || left[1] - right[1] || compareStrings(left[2], right[2]);
}

/**
 * Merges the qualifying pair with the smallest key until none qualifies: affinity at least
 * `threshold`, the merge within the caps and acyclic, and `eligible` true of the pair.
 * @req FR-NODE-247 AC-6, AC-7
 */
function mergeGreedily(
  start: readonly Unit[],
  context: { byId: ReadonlyMap<string, Member>; hubs: ReadonlySet<string>; caps: ProposalCaps },
  threshold: number,
  eligible: (left: Unit, right: Unit) => boolean
): Unit[] {
  let units = [...start];
  for (;;) {
    const graph = unitGraph(units, context.byId);
    let best: { left: Unit; right: Unit; key: MergeKey } | null = null;
    for (const [at, left] of units.entries()) {
      for (const right of units.slice(at + 1)) {
        if (!eligible(left, right)) continue;
        const count = left.ids.length + right.ids.length;
        if (!withinCaps(count, left.acs + right.acs, new Set([...left.files, ...right.files]), context.caps)) continue;
        const score = affinity(left, right, context.byId);
        if (score < threshold) continue;
        const key: MergeKey = [-score, count, [...left.ids, ...right.ids].sort(compareStrings).join(",")];
        if (best !== null && compareKeys(key, best.key) >= 0) continue;
        if (mergeMakesCycle(graph, left.key, right.key)) continue;
        best = { left, right, key };
      }
    }
    if (best === null) return units;
    const { left, right } = best;
    const merged = unitOf([...left.ids, ...right.ids], context.byId, context.hubs);
    // The key is a total order, so the order units are held in never decides a merge.
    units = [...units.filter((unit) => unit !== left && unit !== right), merged];
  }
}

/**
 * Topological layers, a key's layer one above the highest among its dependencies, ties within a layer
 * by key. The graph is acyclic by construction. @req FR-NODE-247 AC-8
 */
function layeredOrder(keys: readonly string[], dependsOn: ReadonlyMap<string, readonly string[]>): string[] {
  const layer = new Map<string, number>();
  const depth = (key: string): number => {
    const known = layer.get(key);
    if (known !== undefined) return known;
    const value = 1 + Math.max(0, ...(dependsOn.get(key) ?? []).map(depth));
    layer.set(key, value);
    return value;
  };
  return [...keys].sort((left, right) => depth(left) - depth(right) || compareStrings(left, right));
}

/**
 * A node's requirements in dependency order, ties by ID. A dependency cycle inside the node has no
 * order of its own, so its members are one step, in ID order. @req FR-NODE-247 AC-4, AC-8
 */
function requirementOrder(unit: Unit, components: readonly string[][], byId: ReadonlyMap<string, Member>): string[] {
  const inside = new Set(unit.ids);
  const groups = components.filter((component) => inside.has(component[0] as string));
  const groupOf = new Map(groups.flatMap((group) => group.map((id) => [id, group[0] as string] as const)));
  const dependsOn = new Map(
    groups.map((group) => [
      group[0] as string,
      sortedDistinct(group.flatMap((id) => [...(byId.get(id) as Member).dependsOn].filter((dependency) => inside.has(dependency)).map((dependency) => groupOf.get(dependency) as string)))
        .filter((key) => key !== group[0])
    ])
  );
  const byKey = new Map(groups.map((group) => [group[0] as string, group]));
  return layeredOrder([...byKey.keys()], dependsOn).flatMap((key) => byKey.get(key) as string[]);
}

/** At most `limit` code points, an over-long text cut with an ellipsis. */
function bounded(text: string, limit: number): string {
  const points = [...text.replace(/\s+/gu, " ").trim()];
  return points.length <= limit ? points.join("") : `${points.slice(0, limit - 1).join("")}…`;
}

/** @req FR-NODE-247 AC-8, AC-9 */
function draftNode(wave: string, order: readonly string[], unit: Unit, byId: ReadonlyMap<string, Member>): DraftNode {
  const members = order.map((id) => byId.get(id) as Member);
  return {
    wave,
    title: bounded(order.join(", "), TITLE_LIMIT),
    purpose: bounded(members.map((member) => `${member.id} ${member.title}`).join("; "), PURPOSE_LIMIT),
    acs: members.flatMap((member) => member.acs.map((acId) => `${member.id} ${acId}`)),
    done_when: [],
    files: sortedDistinct(unit.files)
  };
}

/** One edge per ordered node pair, its reason every requirement dependency it carries. @req FR-NODE-247 AC-8 */
function draftEdges(units: readonly Unit[], waveOf: ReadonlyMap<string, number>, byId: ReadonlyMap<string, Member>): DraftEdge[] {
  const owner = new Map(units.flatMap((unit) => unit.ids.map((id) => [id, unit.key] as const)));
  const pairs = new Map<string, { from: number; to: number; reasons: string[] }>();
  for (const unit of units) {
    for (const id of unit.ids) {
      for (const dependency of (byId.get(id) as Member).dependsOn) {
        const from = waveOf.get(owner.get(dependency) as string) as number;
        const to = waveOf.get(unit.key) as number;
        if (from === to) continue;
        const entry = pairs.get(`${from}:${to}`) ?? { from, to, reasons: [] };
        entry.reasons.push(`${id} depends on ${dependency}`);
        pairs.set(`${from}:${to}`, entry);
      }
    }
  }
  return [...pairs.values()]
    .sort((left, right) => left.from - right.from || left.to - right.to)
    .map((entry) => ({ from: `wave-${entry.from}`, to: `wave-${entry.to}`, reason: entry.reasons.join("; ") }));
}

/**
 * @req FR-NODE-288 AC-1, AC-2 — every soft citation the draft split across two nodes. It draws no
 * edge (edges come from `depends_on` rows only, FR-NODE-247 AC-8), so the author is told where an
 * edge may be missing; a citation a `depends_on` row backs is not in `cites` at all.
 */
function crossNodeCitations(units: readonly Unit[], waveOf: ReadonlyMap<string, number>, byId: ReadonlyMap<string, Member>): CrossNodeCitation[] {
  const nodeOf = new Map(units.flatMap((unit) => unit.ids.map((id) => [id, `wave-${waveOf.get(unit.key) as number}`] as const)));
  return [...byId.values()]
    .flatMap((member) =>
      [...member.cites]
        .filter((cited) => nodeOf.get(cited) !== nodeOf.get(member.id))
        .map((cited) => ({ requirement: member.id, cites: cited, node: nodeOf.get(member.id) as string, citedNode: nodeOf.get(cited) as string }))
    )
    .sort((left, right) => compareStrings(left.requirement, right.requirement) || compareStrings(left.cites, right.cites));
}

function canonicalScope(scope: ProposalScope): ProposalScope {
  return "target" in scope ? { target: scope.target } : { requirements: sortedDistinct(scope.requirements) };
}

function graphTitle(scope: ProposalScope): string {
  return "target" in scope ? `Draft work graph for target ${scope.target}` : `Draft work graph for ${scope.requirements.length} named requirements`;
}

/**
 * The draft work graph: whole requirements grouped by a deterministic greedy merge under the caps,
 * or the refusal that stops it. The same input in any order yields the same bytes. @req FR-NODE-247
 */
export function proposeWaves(input: WaveProposalInput): WaveProposal {
  const caps: ProposalCaps = { ...DEFAULT_PROPOSAL_CAPS, ...input.caps };
  const members = membersOf(input.requirements, input.expectedFiles);
  // @req FR-NODE-247 AC-12 — a node tracks completion by its ACs, so a requirement with none would vanish.
  const withoutAcs = members.filter((member) => member.acs.length === 0).map((member) => ({ requirement: member.id }));
  if (withoutAcs.length > 0) return { ok: false, code: "requirement-without-live-ac", violations: withoutAcs };
  const ungrounded = ungroundedPaths(members, input.trackedPaths);
  if (ungrounded.length > 0) return { ok: false, code: "files-not-grounded", violations: ungrounded };

  const byId = new Map(members.map((member) => [member.id, member]));
  const hubs = hubPaths(members);
  const components = stronglyConnected(members);
  const start = components.map((component) => unitOf(component, byId, hubs)).sort((a, b) => compareStrings(a.key, b.key));
  // @req FR-NODE-247 AC-4 — a cycle cannot be split and cannot exceed a cap, so it is the user's to break.
  const overCap = start.filter((unit) => unit.ids.length > 1 && !withinCaps(unit.ids.length, unit.acs, unit.files, caps));
  if (overCap.length > 0) return { ok: false, code: "requirement-cycle-over-cap", violations: overCap.map((unit) => ({ requirements: unit.ids })) };

  const context = { byId, hubs, caps };
  const merged = mergeGreedily(start, context, MERGE_THRESHOLD, () => true);
  const units = mergeGreedily(merged, context, FLOOR_THRESHOLD, (left, right) => left.ids.length < FLOOR_REQUIREMENTS || right.ids.length < FLOOR_REQUIREMENTS);

  const unitByKey = new Map(units.map((unit) => [unit.key, unit]));
  const ordered = layeredOrder([...unitByKey.keys()], unitGraph(units, byId)).map((key) => unitByKey.get(key) as Unit);
  const waveOf = new Map(ordered.map((unit, index) => [unit.key, index + 1]));
  const scope = canonicalScope(input.scope);
  return {
    ok: true,
    graph: {
      schema_version: WORK_GRAPH_SCHEMA_VERSION,
      run_id: input.runId,
      title: graphTitle(scope),
      scope,
      nodes: ordered.map((unit, index) => draftNode(`wave-${index + 1}`, requirementOrder(unit, components, byId), unit, byId)),
      edges: draftEdges(ordered, waveOf, byId)
    },
    hubs: sortedDistinct(hubs),
    crossNodeCitations: crossNodeCitations(ordered, waveOf, byId)
  };
}
