// @req FR-NODE-111, FR-NODE-112, FR-NODE-117, FR-NODE-118, FR-NODE-212 — the producers of the route probe
// (`docs/research/kiwi-orchestrator/09.routing-design.md` §3.2, §10.1). The plan probe field S2 and its
// producers left with the plan rung (FR-NODE-212 AC-1).
//
// Every function here is pure: it is handed the bytes or the records someone else read. The orchestrator
// owns the calls; this module owns what the answers mean.

import { normalizeFilterReference } from "../query/filter.js";
import { PROBE_FIELD_IDS, type ProbeFieldId, type RouteProbe } from "./route.js";

/**
 * A requirement record as the routing probe reads it — the subset of `RequirementRecord` S3, S3c and S4
 * need. Declaring the shape structurally keeps the kernel off the parser's full record type while
 * letting a caller pass `list_requirements` output straight through.
 */
export interface RouteRequirementRecord {
  id: string;
  scope: string;
  traceReferences?: readonly string[];
  traceLinks?: ReadonlyArray<{ type: string; reference: string }>;
}

/** A row of the index's registered scope vocabulary (`IndexDocument.scopes`). */
export interface RegisteredScope {
  scope: string;
  prefix: string;
  document?: string;
}

// 09 §3.2 S7, §3.5 narrowing 1. Only these three forms carry an explicit ordering marker. The trailing
// `(?!\w)` on the 단계 form is `\b`'s intent spelled so it holds: `\b` after a non-word character never
// matches at end of input, so the literal reading of the design's `^\d+\s*단계\b` would reject `## 1단계`.
const ORDERED_SECTION_PATTERNS = [/^(Phase|Step)\s+\d+\b/i, /^\d+\s*단계(?!\w)/, /^\d+\s*[.)]\s+\S/];

// 09 §3.2 S3c. Only `Code`-typed rows count: `traceReferences` is populated from every Trace Links row
// regardless of type, so an unqualified count would clear the step rung vacuously in a repository whose
// requirements were never implemented through `kiwi-coder`.
const CODE_TRACE_TYPE = "code";

/**
 * The value an unreadable field takes (FR-NODE-111). It is deliberately not `0` and not `[]`: failing
 * open on the anchored-requirement field yields an empty anchor set, which *enables* the step rung.
 * `NaN` fails every threshold comparison, and the placeholder id matches no requirement id and no file
 * path, so every intersection it enters comes back empty.
 */
const UNREADABLE_NUMBER = Number.NaN;

/** What a malformed `unreadable[]` member is recorded as. Outside `PROBE_FIELD_IDS` on purpose. */
export const MALFORMED_FIELD_ID = "<malformed-unreadable-entry>";

function unreadableList(field: ProbeFieldId): string[] {
  return [`<unreadable:${field}>`];
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) return undefined;
  return value as string[];
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function nullableString(value: unknown): string | null | undefined {
  if (value === null) return null;
  return typeof value === "string" ? value : undefined;
}

/**
 * @req FR-NODE-117 — S7's counting rule. D4's threshold reads this count, so the counting rule is the
 * whole content of that disqualifier's left-hand side.
 */
export function countOrderedSections(text: string): number {
  let count = 0;
  for (const line of text.split(/\r?\n/)) {
    const heading = /^##(?!#)\s+(.+)$/.exec(line.trim());
    if (!heading) continue;
    const title = (heading[1] as string).trim();
    if (ORDERED_SECTION_PATTERNS.some((pattern) => pattern.test(title))) count += 1;
  }
  return count;
}

/**
 * @req FR-NODE-112 — S3. Normalized exact match against the type-erased trace-anchor list, using the
 * same normalization `list_requirements({traceReference})` applies, so the probe and the query it stands
 * in for cannot disagree about what "the same path" means.
 */
export function deriveAnchoredRequirements(records: readonly RouteRequirementRecord[], filePaths: readonly string[]): string[] {
  const wanted = new Set(filePaths.map(normalizeFilterReference).filter(Boolean));
  if (wanted.size === 0) return [];
  const anchored = records
    .filter((record) => (record.traceReferences ?? []).some((reference) => wanted.has(normalizeFilterReference(reference))))
    .map((record) => record.id);
  return unique(anchored);
}

/** @req FR-NODE-112 — S3c, the fraction of the active target's requirements carrying a `Code` anchor. */
export function computeAnchorCoverage(records: readonly RouteRequirementRecord[]): number {
  if (records.length === 0) return 0;
  const anchored = records.filter((record) => (record.traceLinks ?? []).some((link) => link.type.trim().toLowerCase() === CODE_TRACE_TYPE));
  return anchored.length / records.length;
}

/**
 * The key one scope name is counted under. Resolution against the registered vocabulary is what stops
 * one scope being counted twice under two spellings, which matters because D3 removes the step rung on a
 * scope count of two or more.
 */
function scopeKey(value: string): string {
  const withoutDocument = value.trim().replace(/^\.\//, "").replace(/^.*\//, "").replace(/\.srs\.md$/i, "").replace(/\.md$/i, "");
  return withoutDocument.replace(/^\d+[.\-_]/, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Every spelling of a registered scope — its name, its prefix and its document — mapped to its prefix. */
function scopeVocabulary(registeredScopes: readonly RegisteredScope[]): Map<string, string> {
  const vocabulary = new Map<string, string>();
  for (const entry of registeredScopes) {
    for (const spelling of [entry.scope, entry.prefix, entry.document ?? ""]) {
      const key = scopeKey(spelling);
      if (key && !vocabulary.has(key)) vocabulary.set(key, entry.prefix);
    }
  }
  return vocabulary;
}

/**
 * @req FR-NODE-118 — S4. An unresolvable reported name is a naming miss rather than an unreadable field,
 * so it is recorded in `unresolved` rather than escalated to D8's fail-closed path, and no predicate
 * reads it. A record's own `scope` is a parsed field rather than a free-text label, so it is never
 * dropped even when it resolves against nothing.
 */
export function deriveScopes(records: readonly RouteRequirementRecord[], reportedNames: readonly string[], registeredScopes: readonly RegisteredScope[]): { scopes: string[]; unresolved: string[] } {
  const vocabulary = scopeVocabulary(registeredScopes);
  const scopes: string[] = [];
  const unresolved: string[] = [];
  const seen = new Set<string>();
  const add = (value: string): void => {
    const key = scopeKey(value);
    if (!key || seen.has(key)) return;
    seen.add(key);
    scopes.push(value);
  };

  for (const record of records) add(vocabulary.get(scopeKey(record.scope)) ?? record.scope);
  for (const name of reportedNames) {
    const resolved = vocabulary.get(scopeKey(name));
    if (resolved === undefined) unresolved.push(name);
    else add(resolved);
  }
  return { scopes, unresolved };
}

/** @req FR-NODE-118 — S4's `scope_req_ids`, off the same records S3c already read. */
export function deriveScopeRequirementIds(records: readonly RouteRequirementRecord[], scopes: readonly string[]): string[] {
  if (scopes.length === 0) return [];
  const keys = new Set(scopes.map(scopeKey));
  return unique(records.filter((record) => keys.has(scopeKey(record.scope))).map((record) => record.id));
}

/**
 * S11's list, kept whole. A member that is not a string, and a list that is not an array, both become
 * `MALFORMED_FIELD_ID` rather than vanishing: discarding the list because one member had the wrong type
 * would lose every other member's declaration too, which is the same fail-open the parser exists to
 * close. An unrecognised member is removed fail-closed by D8's `UNRECOGNISED_FIELD_GATES`.
 */
function declaredUnreadable(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return [MALFORMED_FIELD_ID];
  return value.map((entry) => (typeof entry === "string" ? entry : MALFORMED_FIELD_ID));
}

function fieldValues(json: unknown): Map<ProbeFieldId, Record<string, unknown>> {
  const document = isRecord(json) ? json : {};
  const fields = isRecord(document.fields) ? document.fields : {};
  const values = new Map<ProbeFieldId, Record<string, unknown>>();
  for (const id of PROBE_FIELD_IDS) {
    const envelope = fields[id];
    if (!isRecord(envelope)) continue;
    if (!isRecord(envelope.value)) continue;
    values.set(id, envelope.value);
  }
  return values;
}

/**
 * @req FR-NODE-111 — `routing/probe.json` into the `RouteProbe` projection. Every field it could not read
 * becomes an explicit `unreadable[]` entry and **never** a default value, because D8's fail-closed
 * removal is only correct if the parser distinguishes a field it could not read from a value a producer
 * legitimately returned, and that distinction cannot be recovered later.
 */
export function parseRouteProbe(json: unknown): RouteProbe {
  const document = isRecord(json) ? json : {};
  const values = fieldValues(json);
  // An id the producer declared unreadable is kept whether or not this version recognises it. Dropping
  // one would turn "a field could not be read" into "every field was read", which buys the §8.2
  // zero-deliberation fast path on a probe that failed — the fail-open direction this parser exists to
  // close. D8 handles the unrecognised id from there (`UNRECOGNISED_FIELD_GATES`).
  const declared = declaredUnreadable(document.unreadable);
  const unreadable = new Set<string>(declared);
  const mark = <T>(field: ProbeFieldId, value: T | undefined, fallback: T): T => {
    if (value !== undefined) return value;
    unreadable.add(field);
    return fallback;
  };

  const s9 = values.get("S9");
  const readActiveTarget = s9 ? nullableString(s9.activeTarget) : undefined;
  const activeTarget = mark<string | null>("S9", readActiveTarget, null);
  // 09 §3.2 S3c: when the active target is empty the denominator does not exist, so the producer call is
  // not made and its three consumers take their empty-denominator value. An unregistered target is a
  // value `get_active_target` returned — not an unreadable field.
  // The test is on what was *read*: an S9 that could not be read is unreadable, not empty.
  const emptyDenominator = readActiveTarget !== undefined && !readActiveTarget;

  const s1 = values.get("S1");
  const mode = s1 && typeof s1.mode === "string" && ["sdd", "vibe", "wait", "tdd"].includes(s1.mode) ? (s1.mode as RouteProbe["mode"]) : undefined;
  const modeSource = s1 && typeof s1.source === "string" && ["mcp", "cli", "default-wait"].includes(s1.source) ? (s1.source as RouteProbe["modeSource"]) : undefined;

  const s3 = values.get("S3");
  const s3c = values.get("S3c");
  const s4 = values.get("S4");
  const s5 = values.get("S5");
  const s6 = values.get("S6");
  const s7 = values.get("S7");
  const s8 = values.get("S8");
  const s10 = values.get("S10");
  const s12 = values.get("S12");

  const anchorCoverage = s3c === undefined && emptyDenominator ? 0 : mark("S3c", s3c ? finiteNumber(s3c.anchor_coverage) : undefined, UNREADABLE_NUMBER);
  const blockedStability = s10 === undefined && emptyDenominator ? [] : mark("S10", s10 ? stringArray(s10.blocked_stability) : undefined, unreadableList("S10"));
  const scopeReqIds = s4 && !("scope_req_ids" in s4) && emptyDenominator ? [] : mark("S4", s4 ? stringArray(s4.scope_req_ids) : undefined, unreadableList("S4"));

  const probe: RouteProbe = {
    // S1's fail-open lands on `wait`, the work-mode's own default, and no disqualifier reads it;
    // §8.2 clause 4 is what withholds the fast path on it.
    mode: mark("S1", mode, "wait"),
    modeSource: mark("S1", modeSource, "default-wait"),
    anchoredReqs: mark("S3", s3 ? stringArray(s3.anchored_reqs) : undefined, unreadableList("S3")),
    anchorCoverage,
    scopes: mark("S4", s4 ? stringArray(s4.scopes) : undefined, unreadableList("S4")),
    scopeReqIds,
    externalPaths: mark("S5", s5 ? stringArray(s5.external_paths) : undefined, unreadableList("S5")),
    ambiguities: mark("S6", s6 ? finiteNumber(s6.ambiguities) : undefined, UNREADABLE_NUMBER),
    orderedSections: mark("S7", s7 ? finiteNumber(s7.ordered_sections) : undefined, UNREADABLE_NUMBER),
    linkedSubIssues: mark("S8", s8 ? finiteNumber(s8.linked_sub_issues) : undefined, UNREADABLE_NUMBER),
    taskListGroups: mark("S8", s8 ? finiteNumber(s8.task_list_groups) : undefined, UNREADABLE_NUMBER),
    declaredExistingReqEdit: mark("S12", s12 ? (typeof s12.declared_existing_req_edit === "boolean" ? s12.declared_existing_req_edit : undefined) : undefined, false),
    activeTarget,
    blockedStability,
    // Known ids first, in the fixed field order, then anything unrecognised in the order the producer
    // wrote it: the projection has to be deterministic for `freezeRoute` to be byte-reproducible.
    unreadable: [...PROBE_FIELD_IDS.filter((id) => unreadable.has(id)), ...declared.filter((id) => !(PROBE_FIELD_IDS as readonly string[]).includes(id))]
  };
  return probe;
}
