import {
  REQUIREMENT_STATUSES,
  STABILITY_LEVELS,
  type DiagnosticSeverity,
  type RequirementStatus,
  type Stability
} from "../types.js";

/**
 * Requirement readiness — harvest H3 from the deferred multi-root branch's
 * spec-client module, at the two pure functions `06` §3.1 H3 cites at lines 456-557.
 *
 * @req FR-NODE-103 — the two pure functions and their behavioural cases, re-run against a snapshot
 *   obtained from `speckiwi list --json` rather than MCP, which is what proves transport
 *   independence.
 * @req FR-NODE-132 — readiness is derived, never trusted: the three fields are computed from raw
 *   records, so a caller cannot self-attest, and the derivation fails closed on dependency cycles,
 *   duplicate requirement ids and a summary that contradicts the records.
 *
 * What is deliberately not harvested: the 780 lines of per-root MCP client that surrounded these
 * functions on the branch (`06` §3.2). It spawns a `speckiwi mcp` process from Node, which a skill
 * cannot call, which charter C1 makes unnecessary, and which `02:402` already records as
 * prohibited at the CLI surface. The functions here take a snapshot from any transport.
 *
 * This module is pure. It performs no I/O, reads no clock, and imports nothing but the repository's
 * requirement vocabulary.
 */

export const REQUIREMENT_NOT_READY_GATE = "requirement-not-ready";

export interface ReadinessDiagnostic {
  readonly code: string;
  readonly severity: DiagnosticSeverity;
  readonly message: string;
  readonly requirementId?: string;
  readonly filePath?: string;
  readonly line?: number;
}

export interface SpecRequirementRecord {
  readonly id: string;
  readonly target: string;
  readonly status: RequirementStatus;
  readonly stability: Stability;
  readonly acceptanceCriteria: readonly { readonly id: string; readonly checked: boolean }[];
  readonly verificationEvidence: readonly {
    readonly id: string;
    readonly type?: string;
    readonly covers: string;
    readonly reference: string;
    readonly notes?: string;
  }[];
  readonly traceLinks: readonly {
    readonly type: string;
    readonly reference: string;
    readonly relation: string;
  }[];
  readonly filePath?: string;
  readonly headingLine?: number;
  readonly blockEndLine?: number;
}

export interface SpecTargetSummary {
  readonly target: string;
  readonly total: number;
  readonly countsByStatus: Readonly<Record<string, number>>;
  readonly countsByStability: Readonly<Record<string, number>>;
  readonly blocked: readonly string[];
  readonly implementedNotVerified: readonly string[];
  readonly missingEvidence: readonly string[];
  readonly draftRequirements: readonly string[];
  readonly deprecatedRequirements: readonly string[];
  readonly stabilityBlockers: readonly string[];
  readonly diagnosticsSummary: { readonly errors: number; readonly warnings: number };
}

/**
 * A raw, read-only snapshot. It deliberately carries no readiness booleans: only this module
 * derives those, from the records themselves.
 */
export interface RequirementSnapshot {
  readonly target: string;
  readonly records: readonly SpecRequirementRecord[];
  readonly summary: SpecTargetSummary;
  readonly diagnostics: readonly ReadinessDiagnostic[];
}

export interface DerivedRequirementReadiness {
  readonly id: string;
  readonly target: string;
  readonly status: RequirementStatus;
  readonly stability: Stability;
  readonly hardDependenciesSatisfied: boolean;
  readonly evidenceDrift: boolean;
  readonly ownershipVerified: boolean;
}

/** The two shapes the same snapshot content arrives in. A closed vocabulary, declared once. */
export type SnapshotPayload =
  | {
    readonly transport: "speckiwi-list-json";
    readonly target: string;
    readonly list: Record<string, unknown>;
    readonly summary: Record<string, unknown>;
  }
  | {
    readonly transport: "mcp-list-requirements";
    readonly target: string;
    readonly records: readonly unknown[];
    readonly diagnostics: readonly unknown[];
    readonly summary: Record<string, unknown>;
  };

export class RequirementNotReadyError extends Error {
  /** §13's critical gate raised at Phase 3.c′ when derived readiness refuses the dispatch. */
  readonly gate = REQUIREMENT_NOT_READY_GATE;
  readonly notReady: readonly DerivedRequirementReadiness[];
  readonly unresolved: readonly string[];

  constructor(notReady: readonly DerivedRequirementReadiness[], unresolved: readonly string[]) {
    super(`Requirements are not ready for dispatch: ${[...notReady.map((entry) => entry.id), ...unresolved].join(", ")}`);
    this.name = "RequirementNotReadyError";
    this.notReady = notReady;
    this.unresolved = unresolved;
  }
}

// -- snapshot parsing ----------------------------------------------------------------------------

function malformed(what: string): never {
  throw new Error(`Malformed requirement snapshot: ${what}`);
}

function objectOf(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) malformed(what);
  return value as Record<string, unknown>;
}

function arrayOf(value: unknown, what: string): unknown[] {
  if (!Array.isArray(value)) malformed(what);
  return value;
}

function stringOf(value: unknown, what: string): string {
  if (typeof value !== "string" || value.trim() === "") malformed(what);
  return value;
}

function optionalString(value: unknown, what: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  return stringOf(value, what);
}

function integerOf(value: unknown, what: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) malformed(what);
  return value;
}

function optionalInteger(value: unknown, what: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  return integerOf(value, what);
}

function stringArrayOf(value: unknown, what: string): string[] {
  return arrayOf(value, what).map((entry) => stringOf(entry, what));
}

function countsOf(value: unknown, what: string): Record<string, number> {
  const raw = objectOf(value, what);
  const counts: Record<string, number> = {};
  for (const [key, count] of Object.entries(raw)) counts[key] = integerOf(count, what);
  return counts;
}

/**
 * Builds the record from the fields this module reads and no others. Anything else the transport
 * carried — including a readiness boolean a caller attached — does not survive parsing, which is
 * what makes self-attestation structurally impossible rather than merely ignored.
 */
function parseRecord(value: unknown): SpecRequirementRecord {
  const raw = objectOf(value, "requirement record");
  const status = stringOf(raw.status, "requirement status");
  if (!(REQUIREMENT_STATUSES as readonly string[]).includes(status)) malformed(`unknown status ${status}`);
  const stability = stringOf(raw.stability, "requirement stability");
  if (!(STABILITY_LEVELS as readonly string[]).includes(stability)) malformed(`unknown stability ${stability}`);

  const filePath = optionalString(raw.filePath, "requirement filePath");
  const headingLine = optionalInteger(raw.headingLine, "requirement headingLine");
  const blockEndLine = optionalInteger(raw.blockEndLine, "requirement blockEndLine");

  return {
    id: stringOf(raw.id, "requirement id"),
    target: stringOf(raw.target, "requirement target"),
    status: status as RequirementStatus,
    stability: stability as Stability,
    acceptanceCriteria: arrayOf(raw.acceptanceCriteria, "acceptanceCriteria").map((entry) => {
      const criterion = objectOf(entry, "acceptance criterion");
      if (typeof criterion.checked !== "boolean") malformed("acceptance criterion checked");
      return { id: stringOf(criterion.id, "acceptance criterion id"), checked: criterion.checked };
    }),
    verificationEvidence: arrayOf(raw.verificationEvidence, "verificationEvidence").map((entry) => {
      const row = objectOf(entry, "verification evidence row");
      const type = optionalString(row.type, "evidence type");
      const notes = optionalString(row.notes, "evidence notes");
      return {
        id: typeof row.id === "string" ? row.id : malformed("evidence id"),
        covers: typeof row.covers === "string" ? row.covers : malformed("evidence covers"),
        reference: typeof row.reference === "string" ? row.reference : malformed("evidence reference"),
        ...(type === undefined ? {} : { type }),
        ...(notes === undefined ? {} : { notes })
      };
    }),
    traceLinks: arrayOf(raw.traceLinks, "traceLinks").map((entry) => {
      const row = objectOf(entry, "trace link row");
      return {
        type: stringOf(row.type, "trace link type"),
        reference: stringOf(row.reference, "trace link reference"),
        relation: stringOf(row.relation, "trace link relation")
      };
    }),
    ...(filePath === undefined ? {} : { filePath }),
    ...(headingLine === undefined ? {} : { headingLine }),
    ...(blockEndLine === undefined ? {} : { blockEndLine })
  };
}

function parseDiagnostic(value: unknown): ReadinessDiagnostic {
  const raw = objectOf(value, "diagnostic");
  const severity = stringOf(raw.severity, "diagnostic severity");
  if (severity !== "error" && severity !== "warning" && severity !== "info") {
    malformed(`unknown diagnostic severity ${severity}`);
  }
  const requirementId = optionalString(raw.requirementId, "diagnostic requirementId");
  const filePath = optionalString(raw.filePath, "diagnostic filePath");
  const line = optionalInteger(raw.line, "diagnostic line");
  return {
    code: stringOf(raw.code, "diagnostic code"),
    severity,
    message: typeof raw.message === "string" ? raw.message : malformed("diagnostic message"),
    ...(requirementId === undefined ? {} : { requirementId }),
    ...(filePath === undefined ? {} : { filePath }),
    ...(line === undefined ? {} : { line })
  };
}

function parseSummary(value: unknown): SpecTargetSummary {
  const raw = objectOf(value, "target summary");
  const diagnostics = objectOf(raw.diagnosticsSummary, "target summary diagnosticsSummary");
  return {
    target: stringOf(raw.target, "target summary target"),
    total: integerOf(raw.total, "target summary total"),
    countsByStatus: countsOf(raw.countsByStatus, "target summary countsByStatus"),
    countsByStability: countsOf(raw.countsByStability, "target summary countsByStability"),
    blocked: stringArrayOf(raw.blocked, "target summary blocked"),
    implementedNotVerified: stringArrayOf(raw.implementedNotVerified, "target summary implementedNotVerified"),
    missingEvidence: stringArrayOf(raw.missingEvidence, "target summary missingEvidence"),
    draftRequirements: stringArrayOf(raw.draftRequirements, "target summary draftRequirements"),
    deprecatedRequirements: stringArrayOf(raw.deprecatedRequirements, "target summary deprecatedRequirements"),
    stabilityBlockers: stringArrayOf(raw.stabilityBlockers, "target summary stabilityBlockers"),
    diagnosticsSummary: {
      errors: integerOf(diagnostics.errors, "target summary diagnostics errors"),
      warnings: integerOf(diagnostics.warnings, "target summary diagnostics warnings")
    }
  };
}

/**
 * The one entry point that turns a transport payload into a snapshot. Both shapes normalise to the
 * identical `RequirementSnapshot`, which is what makes the MCP and CLI readings provably the same
 * question rather than two similar ones.
 */
export function parseRequirementSnapshot(payload: SnapshotPayload): RequirementSnapshot {
  const target = stringOf(payload?.target, "snapshot target");
  if (payload.transport === "speckiwi-list-json") {
    const list = objectOf(payload.list, "speckiwi list --json envelope");
    return {
      target,
      records: arrayOf(list.records, "speckiwi list --json records").map(parseRecord),
      diagnostics: arrayOf(list.diagnostics ?? [], "speckiwi list --json diagnostics").map(parseDiagnostic),
      summary: parseSummary(payload.summary)
    };
  }
  if (payload.transport === "mcp-list-requirements") {
    return {
      target,
      records: arrayOf(payload.records, "MCP list_requirements records").map(parseRecord),
      diagnostics: arrayOf(payload.diagnostics ?? [], "MCP diagnostics").map(parseDiagnostic),
      summary: parseSummary(payload.summary)
    };
  }
  return malformed(`unknown transport ${String((payload as { transport: string }).transport)}`);
}

// -- derivation ----------------------------------------------------------------------------------

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  const a = new Set(left);
  const b = new Set(right);
  return a.size === left.length && b.size === right.length && a.size === b.size &&
    [...a].every((value) => b.has(value));
}

function positiveCounts(values: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}

function sameCounts(left: Readonly<Record<string, number>>, right: Readonly<Record<string, number>>): boolean {
  const normalize = (input: Readonly<Record<string, number>>): [string, number][] => Object.entries(input)
    .filter(([, count]) => count > 0)
    .sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
}

function rawMissingEvidence(record: SpecRequirementRecord): boolean {
  return (record.status === "implemented" || record.status === "verified") &&
    record.verificationEvidence.length === 0;
}

/**
 * The only function in this module that reads the target summary, and it never contributes to a
 * ready verdict: a summary that disagrees with the records makes the whole snapshot untrustworthy.
 * Everything the three readiness fields are computed from is a raw record.
 */
function summaryContradictsRecords(snapshot: RequirementSnapshot, target: string): boolean {
  const summary = snapshot.summary;
  if (snapshot.target !== target || summary.target !== target) return true;
  const records = snapshot.records.filter((record) => record.target === target);
  const errors = snapshot.diagnostics.filter((item) => item.severity === "error").length;
  const warnings = snapshot.diagnostics.filter((item) => item.severity === "warning").length;
  const agrees = summary.total === records.length
    && sameCounts(summary.countsByStatus, positiveCounts(records.map((record) => record.status)))
    && sameCounts(summary.countsByStability, positiveCounts(records.map((record) => record.stability)))
    && sameStringSet(summary.blocked, records.filter((record) => record.status === "blocked").map((record) => record.id))
    && sameStringSet(summary.implementedNotVerified, records.filter((record) => record.status === "implemented").map((record) => record.id))
    && sameStringSet(summary.missingEvidence, records.filter(rawMissingEvidence).map((record) => record.id))
    && sameStringSet(summary.draftRequirements, records.filter((record) => record.stability === "draft").map((record) => record.id))
    && sameStringSet(summary.deprecatedRequirements, records.filter((record) => record.stability === "deprecated").map((record) => record.id))
    && sameStringSet(
      summary.stabilityBlockers,
      records
        .filter((record) => record.status !== "discarded" && (record.stability === "draft" || record.stability === "deprecated"))
        .map((record) => record.id)
    )
    && summary.diagnosticsSummary.errors === errors
    && summary.diagnosticsSummary.warnings === warnings;
  return !agrees;
}

function isLifecycleReady(record: SpecRequirementRecord): boolean {
  return ["planned", "in_progress", "implemented", "verified"].includes(record.status)
    && ["evolving", "stable", "frozen"].includes(record.stability);
}

function hardDependencyIds(record: SpecRequirementRecord): string[] {
  return [...new Set(record.traceLinks
    .filter((trace) => trace.type.trim().toLowerCase() === "requirement")
    .filter((trace) => trace.relation.trim().toLowerCase().replace(/[\s-]+/gu, "_") === "depends_on")
    .map((trace) => trace.reference.trim())
    .filter(Boolean))];
}

function isSubstantiveEvidence(row: SpecRequirementRecord["verificationEvidence"][number]): boolean {
  return row.id.trim() !== "" && row.reference.trim() !== "";
}

function hasSubstantiveEvidence(evidence: SpecRequirementRecord["verificationEvidence"]): boolean {
  return evidence.some(isSubstantiveEvidence);
}

function evidenceCoverTokens(covers: string): string[] {
  return covers
    .split(/[,;\s]+/u)
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
    .flatMap((value) => {
      const range = /^ac-(\d+)\.\.ac-(\d+)$/u.exec(value);
      if (!range) return [value];
      const first = Number.parseInt(range[1]!, 10);
      const last = Number.parseInt(range[2]!, 10);
      if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) || first < 1 || last < first || last - first > 999) {
        return [value];
      }
      return Array.from({ length: last - first + 1 }, (_, index) => `ac-${first + index}`);
    });
}

function evidenceCovers(evidence: SpecRequirementRecord["verificationEvidence"], acId: string): boolean {
  const expected = acId.trim().toLowerCase();
  return evidence.some((row) => isSubstantiveEvidence(row)
    && evidenceCoverTokens(row.covers).some((value) => value === "all" || value === expected));
}

function legacyEvidenceMarker(row: SpecRequirementRecord["verificationEvidence"][number]): boolean {
  return [row.id, row.type ?? "", row.covers, row.reference, row.notes ?? ""]
    .some((value) => /(^|[^a-z0-9])legacy([^a-z0-9]|$)/iu.test(value));
}

/**
 * Verification Evidence is append-only, so a later substantive `covers=all` row is the canonical
 * proof generation for the current AC set and earlier AC-specific rows are history. Rows appended
 * *after* that proof stay security-significant.
 */
function authoritativeEvidence(record: SpecRequirementRecord): SpecRequirementRecord["verificationEvidence"] {
  let start = 0;
  for (const [index, row] of record.verificationEvidence.entries()) {
    if (isSubstantiveEvidence(row) && !legacyEvidenceMarker(row) && evidenceCoverTokens(row.covers).includes("all")) {
      start = index;
    }
  }
  return record.verificationEvidence.slice(start);
}

function hasLegacyOrStaleEvidence(
  evidence: SpecRequirementRecord["verificationEvidence"],
  acceptanceCriteria: SpecRequirementRecord["acceptanceCriteria"]
): boolean {
  if (evidence.length === 0) return false;
  const current = new Set(acceptanceCriteria.map((criterion) => criterion.id.trim().toLowerCase()));
  return evidence.some((row) => {
    if (legacyEvidenceMarker(row)) return true;
    const acceptanceTokens = evidenceCoverTokens(row.covers)
      .filter((value) => value === "all" || value.startsWith("ac-"));
    if (acceptanceTokens.length === 0 || current.size === 0) return true;
    return acceptanceTokens.some((value) => value !== "all" && !current.has(value));
  });
}

/** Computed from the record alone; `snapshotInvalid` is the fail-closed flag, not a data source. */
function recordEvidenceDrift(record: SpecRequirementRecord, snapshotInvalid: boolean): boolean {
  if (snapshotInvalid) return true;
  const evidence = authoritativeEvidence(record);
  if (hasLegacyOrStaleEvidence(evidence, record.acceptanceCriteria)) return true;
  if (rawMissingEvidence(record)) return true;
  if ((record.status === "planned" || record.status === "in_progress") && record.verificationEvidence.length > 0) {
    return !evidence.some((row) => isSubstantiveEvidence(row) && evidenceCoverTokens(row.covers).includes("all"));
  }
  if (record.status === "implemented") return !hasSubstantiveEvidence(evidence);
  if (record.status !== "verified") return false;
  return record.acceptanceCriteria.length === 0
    || !hasSubstantiveEvidence(evidence)
    || record.acceptanceCriteria.some((criterion) => !criterion.checked || !evidenceCovers(evidence, criterion.id));
}

function deterministicOccurrence(records: readonly SpecRequirementRecord[]): SpecRequirementRecord {
  return [...records].sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))[0]!;
}

function normalizedDiagnosticPath(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\.\//u, "");
}

function diagnosticRequirementIds(
  diagnostic: ReadinessDiagnostic,
  records: readonly SpecRequirementRecord[]
): ReadonlySet<string> {
  const owners = new Set<string>();
  if (diagnostic.requirementId) owners.add(diagnostic.requirementId);
  if (diagnostic.filePath && diagnostic.line !== undefined) {
    const expectedPath = normalizedDiagnosticPath(diagnostic.filePath);
    const line = diagnostic.line;
    const matches = records.filter((record) =>
      record.filePath !== undefined &&
      normalizedDiagnosticPath(record.filePath) === expectedPath &&
      record.headingLine !== undefined &&
      line >= record.headingLine &&
      (record.blockEndLine === undefined || line <= record.blockEndLine));
    if (matches.length > 1) {
      throw new Error(`Readiness diagnostic ${diagnostic.code} maps to multiple Requirement blocks`);
    }
    if (matches.length === 1) {
      const locatedId = matches[0]!.id;
      if (diagnostic.requirementId !== undefined && diagnostic.requirementId !== locatedId) {
        throw new Error(`Readiness diagnostic ${diagnostic.code} has contradictory Requirement ownership`);
      }
      owners.add(locatedId);
    }
  }
  return owners;
}

/**
 * Keeps errors and warnings deterministically owned by the exact allowlist or its transitive hard
 * dependencies, so an unrelated baseline warning cannot silently widen a lane's requirement scope.
 */
export function scopeRequirementDiagnostics(
  records: readonly SpecRequirementRecord[],
  diagnostics: readonly ReadinessDiagnostic[],
  requirementIds: readonly string[],
  options: { readonly preserveWarningCodes?: ReadonlySet<string> } = {}
): ReadinessDiagnostic[] {
  const byId = new Map<string, SpecRequirementRecord[]>();
  for (const record of records) {
    const occurrences = byId.get(record.id) ?? [];
    occurrences.push(record);
    byId.set(record.id, occurrences);
  }
  const relevantIds = new Set<string>();
  const visit = (id: string): void => {
    if (relevantIds.has(id)) return;
    relevantIds.add(id);
    const occurrences = byId.get(id) ?? [];
    if (occurrences.length !== 1) return;
    for (const dependencyId of hardDependencyIds(occurrences[0]!)) visit(dependencyId);
  };
  for (const id of requirementIds) visit(id);

  return diagnostics.filter((item) => {
    if (item.severity === "error") return true;
    if (item.severity !== "warning" || item.code === "SRS-W015") return false;
    if (options.preserveWarningCodes?.has(item.code)) return true;
    const owners = [...diagnosticRequirementIds(item, records)];
    if (owners.length > 0) return owners.some((owner) => relevantIds.has(owner));
    // Unknown, source-less and global structural warnings stay fail-closed. Only a precisely
    // located Completed Work history warning is known unrelated baseline debt.
    const provenCompletedWorkBaseline = (item.code === "SRS-W012" || item.code === "SRS-W013")
      && item.filePath !== undefined
      && item.line !== undefined;
    return !provenCompletedWorkBaseline;
  });
}

/**
 * Derives `hardDependenciesSatisfied`, `evidenceDrift` and `ownershipVerified` from raw records.
 * Extra properties a caller attached are never consulted, so readiness cannot be self-attested.
 */
export function deriveCanonicalRequirementReadiness(
  snapshot: RequirementSnapshot,
  target: string,
  requirementIds: readonly string[]
): DerivedRequirementReadiness[] {
  if (!target.trim()) throw new Error("A target is required for canonical readiness derivation");
  if (requirementIds.length === 0 || !sameStringSet(requirementIds, [...new Set(requirementIds)])) {
    throw new Error("Canonical readiness requires a non-empty, duplicate-free requirement allowlist");
  }

  const byId = new Map<string, SpecRequirementRecord[]>();
  for (const record of snapshot.records) {
    const occurrences = byId.get(record.id) ?? [];
    occurrences.push(record);
    byId.set(record.id, occurrences);
  }

  const scopedDiagnostics = scopeRequirementDiagnostics(snapshot.records, snapshot.diagnostics, requirementIds);
  const globalInvalid = snapshot.diagnostics.some((item) => item.severity === "error")
    || summaryContradictsRecords(snapshot, target)
    || scopedDiagnostics.some((item) =>
      item.severity === "warning" && diagnosticRequirementIds(item, snapshot.records).size === 0);
  const warningAffectedIds = new Set(scopedDiagnostics.flatMap((item) =>
    item.severity === "warning" ? [...diagnosticRequirementIds(item, snapshot.records)] : []));
  const recordInvalid = (id: string): boolean => globalInvalid || warningAffectedIds.has(id);
  const selectedIds = new Set(requirementIds);

  const dependencyReady = (dependencyId: string, visiting: Set<string>): boolean => {
    if (visiting.has(dependencyId)) return false;
    const occurrences = byId.get(dependencyId) ?? [];
    if (occurrences.length !== 1) return false;
    const dependency = occurrences[0]!;
    if (recordInvalid(dependency.id)) return false;
    if (!isLifecycleReady(dependency)) return false;
    if (!selectedIds.has(dependencyId) && dependency.status !== "implemented" && dependency.status !== "verified") {
      return false;
    }
    if (recordEvidenceDrift(dependency, recordInvalid(dependency.id))) return false;
    return hardDependencyIds(dependency).every((id) => dependencyReady(id, new Set(visiting).add(dependencyId)));
  };

  return requirementIds.flatMap((id) => {
    const occurrences = byId.get(id) ?? [];
    if (occurrences.length === 0) return [];
    const record = deterministicOccurrence(occurrences);
    const invalid = recordInvalid(record.id);
    return [{
      id: record.id,
      target: record.target,
      status: record.status,
      stability: record.stability,
      hardDependenciesSatisfied: !invalid
        && isLifecycleReady(record)
        && hardDependencyIds(record).every((dependencyId) => dependencyReady(dependencyId, new Set([record.id]))),
      evidenceDrift: recordEvidenceDrift(record, invalid),
      ownershipVerified: !invalid && occurrences.length === 1 && record.target === target
    }];
  });
}

/**
 * Phase 3.c′: refuses the dispatch unless every requested requirement derives as ready. A
 * requirement the snapshot does not carry has no derivation at all, so it is reported unresolved
 * rather than dropped — the drop is what would let an unknown id pass as satisfied.
 */
export function assertRequirementsReady(
  snapshot: RequirementSnapshot,
  target: string,
  requirementIds: readonly string[]
): DerivedRequirementReadiness[] {
  const derived = deriveCanonicalRequirementReadiness(snapshot, target, requirementIds);
  const resolved = new Set(derived.map((entry) => entry.id));
  const unresolved = requirementIds.filter((id) => !resolved.has(id));
  const notReady = derived.filter((entry) =>
    !entry.hardDependenciesSatisfied || entry.evidenceDrift || !entry.ownershipVerified);
  if (notReady.length > 0 || unresolved.length > 0) throw new RequirementNotReadyError(notReady, unresolved);
  return derived;
}
