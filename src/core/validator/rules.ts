import { createHash } from "node:crypto";
import { diagnostic } from "../diagnostic.js";
import { parseReportPathCell } from "../completed-work/report-paths.js";
import {
  PREFIX_TYPE,
  LEGACY_STABILITY_LEVELS,
  PRIORITY_LEVELS,
  REQUIREMENT_STATUSES,
  REQUIREMENT_TYPES,
  RISK_LEVELS,
  STABILITY_LEVELS,
  type Diagnostic,
  type ParsedWorkspace,
  type RequirementRecord
} from "../types.js";
import { registerValidationRule } from "./rule-registry.js";

function includes(values: readonly string[], value: string): boolean {
  return values.includes(value);
}

function splitCsv(value: string): string[] {
  return value
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean);
}

/**
 * @req FR-PARSE-034 — group scope documents by the ordering number their file name leads with.
 * The number is compared by value, so `01.` and `1.` are one position rather than two, and the
 * returned file names are the bare names a reader sees in docs/spec. Documents with no leading
 * number carry no ordering position and are left out.
 */
function scopeDocumentsByLeadingNumber(relativePaths: Iterable<string>): Map<number, string[]> {
  const byNumber = new Map<number, string[]>();
  for (const relativePath of relativePaths) {
    // Only files that sit directly in docs/spec hold an ordering position, so two files with the same
    // name in different directories are not a collision (FR-NODE-088 AC-6). The caller decides which
    // of those files to consider; filtering to .srs.md here would silently drop the numbered sidecars
    // it deliberately passes in.
    if (!/^docs\/spec\/[^/]+$/.test(relativePath.replace(/\\/g, "/"))) continue;
    const fileName = relativePath.slice(relativePath.lastIndexOf("/") + 1);
    const match = /^(\d+)\./.exec(fileName);
    if (!match) continue;
    const value = Number.parseInt(match[1] ?? "", 10);
    if (!Number.isFinite(value)) continue;
    const bucket = byNumber.get(value);
    if (bucket) bucket.push(fileName);
    else byNumber.set(value, [fileName]);
  }
  for (const documents of byNumber.values()) documents.sort();
  return byNumber;
}

export function normalizeScopeDocument(document: string): string {
  const withoutAnchor = document.trim().replace(/#.*$/, "").replace(/\\/g, "/");
  if (!withoutAnchor) return "";
  const withoutDot = withoutAnchor.replace(/^\.\//, "");
  return withoutDot.startsWith("docs/spec/") ? withoutDot : `docs/spec/${withoutDot}`;
}

function countBy(values: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}

interface DuplicateRequirementOccurrence {
  filePath: string;
  headingLine: number;
  title: string;
  target: string;
  status: string;
  stability?: string;
  marker?: "DISCARDED" | "DRAFT";
  markerState?: "DISCARDED" | "DRAFT";
  blockHash: string;
}

interface DuplicateRequirementDiagnosticDetails {
  duplicateId: string;
  occurrences: DuplicateRequirementOccurrence[];
  nextAction: {
    kind: "select-duplicate-occurrence";
    requiresSelectedOccurrence: true;
    message: string;
  };
}

// @req REL-PARSE-003
function compareRecordLocation(left: RequirementRecord, right: RequirementRecord): number {
  const fileOrder = left.filePath.localeCompare(right.filePath);
  if (fileOrder !== 0) return fileOrder;
  return left.headingLine - right.headingLine;
}

// @req REL-PARSE-003
function blockHashFor(record: RequirementRecord): string {
  const source = record.markdown ?? `${record.id}\n${record.filePath}\n${record.headingLine}\n${record.title}`;
  return createHash("sha256").update(source).digest("hex");
}

// @req REL-PARSE-003
function duplicateRequirementDetails(duplicateId: string, records: RequirementRecord[]): DuplicateRequirementDiagnosticDetails {
  const occurrences = records.map((record) => {
    const occurrence: DuplicateRequirementOccurrence = {
      filePath: record.filePath,
      headingLine: record.headingLine,
      title: record.title,
      target: record.target,
      status: record.status,
      blockHash: blockHashFor(record)
    };
    if (record.stability) occurrence.stability = record.stability;
    if (record.marker) {
      occurrence.marker = record.marker;
      occurrence.markerState = record.marker;
    }
    return occurrence;
  });
  return {
    duplicateId,
    occurrences,
    nextAction: {
      kind: "select-duplicate-occurrence",
      requiresSelectedOccurrence: true,
      message: "Select one duplicate occurrence before repair planning can modify SRS Markdown."
    }
  };
}

interface DiagnosticNextAction {
  recommendedTool: string;
  message: string;
}

interface IndexedRowOccurrence {
  value: string;
  line?: number;
}

interface SummaryDrift {
  key: string;
  expectedCount: number;
  actualCount: number;
  line?: number;
}

// @req REL-PARSE-002
function nextAction(recommendedTool: string, message: string): DiagnosticNextAction {
  return { recommendedTool, message };
}

// @req REL-PARSE-002
function location(filePath: string, line?: number): { filePath: string; line?: number } {
  return {
    filePath,
    ...(typeof line === "number" ? { line } : {})
  };
}

// @req REL-PARSE-002
function duplicateRowDetails(kind: string, field: "target" | "prefix", value: string, occurrences: IndexedRowOccurrence[]): Record<string, unknown> {
  return {
    kind,
    [field]: value,
    occurrences,
    nextAction: nextAction("edit-index-row", `Resolve the duplicate ${field} row before continuing validation repair.`)
  };
}

// @req REL-PARSE-002
function rollupDriftDetails(summary: string, drift: SummaryDrift): Record<string, unknown> {
  return {
    kind: "rollup-drift",
    summary,
    key: drift.key,
    expectedCount: drift.expectedCount,
    actualCount: drift.actualCount,
    nextAction: nextAction("update-index-rollup", `Recalculate the ${summary} row for ${drift.key}.`)
  };
}

// @req REL-PARSE-002
function missingScopeDocumentDetails(scopeDocument: string, scope: string): Record<string, unknown> {
  return {
    kind: "missing-scope-document",
    document: scopeDocument,
    scope,
    nextAction: nextAction("create-scope-document-or-fix-scope-map", "Create the missing SRS file or correct the Scope Map document path.")
  };
}

// @req REL-PARSE-002
function malformedReportPathDetails(token: string, reason: string): Record<string, unknown> {
  return {
    kind: "malformed-completed-work-report-path",
    token,
    reason,
    nextAction: nextAction("fix-completed-work-report-path", "Replace the malformed Completed Work Log report path with a repository-relative POSIX path.")
  };
}

// @req FR-PARSE-021
function duplicateCompletedWorkSourceDetails(sources: string[]): Record<string, unknown> {
  return {
    kind: "duplicate-completed-work-source",
    sources,
    nextAction: nextAction("migrate-completed-work-log", "Keep Completed Work Log rows in one source before continuing.")
  };
}

// @req FR-PARSE-021
function uniqueCompletedWorkSources(entries: Array<{ filePath?: string }>): string[] {
  return [...new Set(entries.map((entry) => entry.filePath ?? "docs/spec/00.index.md"))].sort();
}

// @req REL-PARSE-002
function summaryDrifts<T extends { count: number; line?: number }>(entries: T[], actual: Map<string, number>, keyFor: (entry: T) => string): SummaryDrift[] {
  const expectedKeys = new Set<string>();
  const drifts: SummaryDrift[] = [];
  for (const entry of entries) {
    const key = keyFor(entry).trim();
    if (!key) continue;
    expectedKeys.add(key);
    const actualCount = actual.get(key) ?? 0;
    if (actualCount !== entry.count) {
      drifts.push({
        key,
        expectedCount: entry.count,
        actualCount,
        ...(typeof entry.line === "number" ? { line: entry.line } : {})
      });
    }
  }
  for (const [key, actualCount] of actual) {
    if (!expectedKeys.has(key)) {
      drifts.push({ key, expectedCount: 0, actualCount });
    }
  }
  return drifts;
}

function isKnownStabilityValue(value: string): boolean {
  return includes(STABILITY_LEVELS, value) || includes(LEGACY_STABILITY_LEVELS, value);
}

function isLegacyStabilityValue(value: string): boolean {
  return includes(LEGACY_STABILITY_LEVELS, value);
}

function targetIsActiveOrReleased(status: string): boolean {
  return status === "active" || status === "released";
}

export function isRequirementInActiveOrReleasedTarget(workspace: ParsedWorkspace, record: RequirementRecord): boolean {
  if (!record.target) return false;
  if (workspace.index.activeTarget === record.target) return true;
  return workspace.index.targets.some((target) => target.target === record.target && targetIsActiveOrReleased(target.status));
}

export function isDraftImplementationContractBlocked(record: RequirementRecord): boolean {
  return record.stability === "draft" && record.status !== "discarded";
}

function isExplicitChangeNoteCell(value: string): boolean {
  const normalized = value.trim();
  return normalized !== "" && normalized !== "-";
}

function hasExplicitChangeNote(record: RequirementRecord): boolean {
  return (record.changeNotes ?? []).some(
    (row) => isExplicitChangeNoteCell(row.date) && isExplicitChangeNoteCell(row.change) && isExplicitChangeNoteCell(row.reason)
  );
}

export function isVerifiedRequirementValid(record: RequirementRecord): boolean {
  return (
    record.acceptanceCriteria.length > 0 &&
    record.acceptanceCriteria.every((criterion) => criterion.checked) &&
    record.verificationEvidence.some((row) => row.reference.trim() !== "")
  );
}

export function registerDefaultRules(): void {
  registerValidationRule((workspace) => {
    const diagnostics: Diagnostic[] = [...workspace.diagnostics];
    const targets = new Set(workspace.index.targets.map((target) => target.target));
    const scopes = new Set(workspace.index.scopes.flatMap((scope) => [scope.prefix, scope.scope]).filter(Boolean));
    const ids = new Set(workspace.records.map((record) => record.id));
    const recordsById = new Map(workspace.records.map((record) => [record.id, record]));
    const explicitActiveTarget = (workspace.index.metadata["Active Target"] ?? "").trim();
    const indexLocation = { filePath: "docs/spec/00.index.md" };
    const recordsByRequirementId = new Map<string, RequirementRecord[]>();

    for (const record of workspace.records) {
      const records = recordsByRequirementId.get(record.id);
      if (records) records.push(record);
      else recordsByRequirementId.set(record.id, [record]);
    }

    const targetRows = new Map<string, IndexedRowOccurrence[]>();
    for (const entry of workspace.index.targets) {
      const target = entry.target.trim();
      if (!target) continue;
      const rows = targetRows.get(target) ?? [];
      rows.push({ value: target, ...(typeof entry.line === "number" ? { line: entry.line } : {}) });
      targetRows.set(target, rows);
    }
    for (const [target, rows] of targetRows) {
      if (rows.length <= 1) continue;
      const diagnosticLine = rows.at(-1)?.line;
      diagnostics.push(
        diagnostic(
          "SRS-E022",
          "error",
          `Duplicate Target Map target: ${target}`,
          location("docs/spec/00.index.md", diagnosticLine),
          duplicateRowDetails("duplicate-target-row", "target", target, rows)
        )
      );
    }

    const scopeRows = new Map<string, IndexedRowOccurrence[]>();
    for (const entry of workspace.index.scopes) {
      const prefix = entry.prefix.trim();
      if (!prefix) continue;
      const rows = scopeRows.get(prefix) ?? [];
      rows.push({ value: prefix, ...(typeof entry.line === "number" ? { line: entry.line } : {}) });
      scopeRows.set(prefix, rows);
    }
    for (const [prefix, rows] of scopeRows) {
      if (rows.length <= 1) continue;
      const diagnosticLine = rows.at(-1)?.line;
      diagnostics.push(
        diagnostic(
          "SRS-E023",
          "error",
          `Duplicate Scope Map prefix: ${prefix}`,
          location("docs/spec/00.index.md", diagnosticLine),
          duplicateRowDetails("duplicate-scope-row", "prefix", prefix, rows)
        )
      );
    }
    const activeTargets = workspace.index.targets.filter((target) => target.status === "active");
    if (activeTargets.length > 1) {
      diagnostics.push(
        diagnostic(
          "SRS-E024",
          "error",
          "Multiple Target Map rows are marked active",
          location("docs/spec/00.index.md", activeTargets.at(-1)?.line),
          {
            kind: "multiple-active-target-rows",
            occurrences: activeTargets.map((target) => ({ value: target.target, ...(typeof target.line === "number" ? { line: target.line } : {}) })),
            nextAction: nextAction("edit-index-row", "Keep exactly one active target row in the Target Map.")
          }
        )
      );
    }

    const discoveredScopeDocuments = new Set(workspace.files.map((file) => file.relativePath).filter((filePath) => filePath.endsWith(".srs.md")));
    const registeredScopeDocuments = new Set(workspace.index.scopes.map((scope) => normalizeScopeDocument(scope.document)).filter(Boolean));
    for (const scope of workspace.index.scopes) {
      const document = normalizeScopeDocument(scope.document);
      if (document && !discoveredScopeDocuments.has(document)) {
        diagnostics.push(
          diagnostic(
            "SRS-E025",
            "error",
            `Scope document file is missing: ${scope.document}`,
            location("docs/spec/00.index.md", scope.line),
            missingScopeDocumentDetails(document, scope.scope || scope.prefix)
          )
        );
      }
    }
    for (const filePath of discoveredScopeDocuments) {
      if (!registeredScopeDocuments.has(filePath)) {
        diagnostics.push(diagnostic("SRS-W018", "warning", `Scope SRS document is not registered in Scope Map: ${filePath}`, indexLocation));
      }
    }

    // FR-PARSE-037 — a numbered document that is not a scope SRS document occupies the same ordering
    // position, so sharing a number with a scope document is the same ambiguity. It is a separate code
    // from SRS-W070 because the repair differs: the non-scope document is renamed, while a scope
    // document's number is named by its Scope Map row. The listing comes from the parsed workspace
    // rather than from `files`, which holds only the fixed set the parser reads.
    const scopeNumbers = scopeDocumentsByLeadingNumber(discoveredScopeDocuments);
    for (const [number, documents] of scopeDocumentsByLeadingNumber(
      (workspace.specDocuments ?? []).filter((filePath) => !filePath.endsWith(".srs.md"))
    )) {
      const scopeDocuments = scopeNumbers.get(number);
      if (!scopeDocuments || scopeDocuments.length === 0) continue;
      for (const document of documents) {
        diagnostics.push(
          diagnostic(
            "SRS-W072",
            "warning",
            `${document} shares the leading number ${number} with the scope document ${scopeDocuments.join(", ")}`,
            location(`docs/spec/${document}`),
            { number, document, scopeDocuments }
          )
        );
      }
    }

    // FR-PARSE-034 — two scope documents on one leading number make the ordering ambiguous and are
    // the observable symptom of an allocation that stopped allocating. Reported once per colliding
    // number, as a warning, so a project already in that state can still validate while it is repaired.
    for (const [number, documents] of scopeNumbers) {
      if (documents.length < 2) continue;
      diagnostics.push(
        diagnostic(
          "SRS-W070",
          "warning",
          `Scope SRS documents share the leading number ${number}: ${documents.join(", ")}`,
          indexLocation,
          { number, documents }
        )
      );
    }

    if (workspace.index.statusSummary) {
      const actual = countBy(workspace.records.map((record) => record.status));
      for (const drift of summaryDrifts(workspace.index.statusSummary, actual, (entry) => entry.status)) {
        diagnostics.push(
          diagnostic(
            "SRS-W019",
            "warning",
            `Status Summary count drift for ${drift.key}`,
            location("docs/spec/00.index.md", drift.line),
            rollupDriftDetails("Status Summary", drift)
          )
        );
      }
    }
    if (workspace.index.requirementTypeSummary) {
      const actual = countBy(workspace.records.map((record) => record.type));
      for (const drift of summaryDrifts(workspace.index.requirementTypeSummary, actual, (entry) => entry.type)) {
        diagnostics.push(
          diagnostic(
            "SRS-W020",
            "warning",
            `Requirement Type Summary count drift for ${drift.key}`,
            location("docs/spec/00.index.md", drift.line),
            rollupDriftDetails("Requirement Type Summary", drift)
          )
        );
      }
    }

    if (explicitActiveTarget) {
      const activeTarget = workspace.index.targets.find((target) => target.target === explicitActiveTarget);
      if (!activeTarget) {
        diagnostics.push(diagnostic("SRS-E017", "error", `Active Target is not registered: ${explicitActiveTarget}`, { filePath: "docs/spec/00.index.md" }));
      } else if (activeTarget.status !== "active") {
        diagnostics.push(diagnostic("SRS-W010", "warning", `Active Target row is not marked active: ${explicitActiveTarget}`, { filePath: "docs/spec/00.index.md" }));
      }
    }

    for (const [duplicateId, records] of [...recordsByRequirementId.entries()].sort(([left], [right]) => left.localeCompare(right))) {
      if (records.length <= 1) continue;
      const occurrences = [...records].sort(compareRecordLocation);
      const primary = occurrences[0]!;
      diagnostics.push(
        diagnostic(
          "SRS-E002",
          "error",
          `Duplicate requirement ID: ${duplicateId}`,
          { filePath: primary.filePath, line: primary.headingLine, requirementId: duplicateId },
          duplicateRequirementDetails(duplicateId, occurrences)
        )
      );
    }

    for (const record of workspace.records) {
      for (const field of ["Type", "Target", "Status"]) {
        if (!record.metadata[field]) {
          diagnostics.push(diagnostic("SRS-E003", "error", `Missing required metadata field: ${field}`, { filePath: record.filePath, line: record.headingLine }));
        }
      }

      const prefix = record.id.split("-")[0] as keyof typeof PREFIX_TYPE;
      if (!includes(REQUIREMENT_TYPES, record.type) || PREFIX_TYPE[prefix] !== record.type) {
        diagnostics.push(diagnostic("SRS-E004", "error", `Type does not match ID prefix for ${record.id}`, { filePath: record.filePath, line: record.headingLine }));
      }
      if (!includes(REQUIREMENT_STATUSES, record.status)) {
        diagnostics.push(diagnostic("SRS-E005", "error", `Invalid status for ${record.id}`, { filePath: record.filePath, line: record.headingLine }));
      }
      if (record.priority && !includes(PRIORITY_LEVELS, record.priority)) {
        diagnostics.push(diagnostic("SRS-E006", "error", `Invalid priority for ${record.id}`, { filePath: record.filePath, line: record.headingLine }));
      }
      if (record.risk && !includes(RISK_LEVELS, record.risk)) {
        diagnostics.push(diagnostic("SRS-E007", "error", `Invalid risk for ${record.id}`, { filePath: record.filePath, line: record.headingLine }));
      }
      if (record.stability && !isKnownStabilityValue(record.stability)) {
        diagnostics.push(diagnostic("SRS-E011", "error", `Invalid stability for ${record.id}`, { filePath: record.filePath, line: record.headingLine }));
      }
      if (record.stability && isLegacyStabilityValue(record.stability)) {
        diagnostics.push(diagnostic("SRS-W022", "warning", `Legacy volatile stability should be migrated: ${record.id}`, { filePath: record.filePath, line: record.headingLine }));
      }
      if (record.status === "verified" && record.stability === "draft") {
        diagnostics.push(diagnostic("SRS-E033", "error", `Verified requirement uses draft stability: ${record.id}`, { filePath: record.filePath, line: record.headingLine }));
      } else if (isDraftImplementationContractBlocked(record) && isRequirementInActiveOrReleasedTarget(workspace, record)) {
        diagnostics.push(
          diagnostic("SRS-W023", "warning", `Draft requirement is not ready as an implementation contract: ${record.id}`, {
            filePath: record.filePath,
            line: record.headingLine
          })
        );
      }
      if (record.stability === "frozen" && record.status !== "discarded" && !hasExplicitChangeNote(record)) {
        diagnostics.push(diagnostic("SRS-W009", "warning", `Frozen target requirement changed without Change Notes: ${record.id}`, { filePath: record.filePath, line: record.headingLine }));
      }
      if (record.acceptanceCriteria.length === 0) {
        diagnostics.push(diagnostic("SRS-E008", "error", `Acceptance Criteria missing for ${record.id}`, { filePath: record.filePath, line: record.headingLine }));
      }
      if (record.status === "verified" && !isVerifiedRequirementValid(record)) {
        diagnostics.push(diagnostic("SRS-E010", "error", `Verified requirement lacks checked AC or evidence: ${record.id}`, { filePath: record.filePath, line: record.headingLine }));
      }
      for (const trace of record.traceLinks) {
        if (trace.type === "Requirement" && trace.reference && !ids.has(trace.reference)) {
          diagnostics.push(diagnostic("SRS-E012", "error", `Trace target does not exist: ${trace.reference}`, {
            filePath: record.filePath,
            ...(typeof trace.line === "number" ? { line: trace.line } : {})
          }));
        }
      }
      if (record.target && !targets.has(record.target)) {
        diagnostics.push(diagnostic("SRS-W002", "warning", `Target is not registered: ${record.target}`, { filePath: record.filePath, line: record.headingLine }));
      }
      if (record.scope && !scopes.has(record.scope)) {
        diagnostics.push(diagnostic("SRS-E015", "error", `Scope prefix is not registered: ${record.scope}`, { filePath: record.filePath, line: record.headingLine }));
      }
      // FR-PARSE-036 — the Rationale section answers why the requirement exists, which is the one
      // thing a later reader cannot reconstruct from the statement. Reported at the heading line,
      // because the absent section has no line of its own.
      if (record.sectionLines?.Rationale === undefined) {
        diagnostics.push(diagnostic("SRS-W001", "warning", `Rationale section missing for ${record.id}`, { filePath: record.filePath, line: record.headingLine }));
      }
      if ((record.risk === "high" || record.risk === "critical") && !record.markdown?.includes("#### Research / Analysis")) {
        diagnostics.push(diagnostic("SRS-W008", "warning", `High risk requirement lacks Research / Analysis: ${record.id}`, { filePath: record.filePath, line: record.headingLine }));
      }
    }
    for (const scope of workspace.index.scopes) {
      if (!scope.document) {
        diagnostics.push(diagnostic("SRS-E016", "error", `Scope document is missing for ${scope.prefix || scope.scope}`, location("docs/spec/00.index.md", scope.line)));
      }
    }
    const completedWorkSources = uniqueCompletedWorkSources(workspace.index.completedWork);
    if (completedWorkSources.includes("docs/spec/00.index.md") && completedWorkSources.includes("docs/spec/05.completed-work.md")) {
      const externalEntry = workspace.index.completedWork.find((entry) => entry.filePath === "docs/spec/05.completed-work.md");
      diagnostics.push(
        diagnostic(
          "SRS-W041",
          "warning",
          "Completed Work Log rows exist in both 00.index.md and 05.completed-work.md",
          location("docs/spec/05.completed-work.md", externalEntry?.line),
          duplicateCompletedWorkSourceDetails(completedWorkSources)
        )
      );
    }
    for (const entry of workspace.index.completedWork) {
      const entryLocation = location(entry.filePath ?? "docs/spec/00.index.md", entry.line);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.date)) {
        diagnostics.push(diagnostic("SRS-W011", "warning", `Completed Work Log date is not YYYY-MM-DD: ${entry.date}`, entryLocation));
      }
      if (entry.target.trim() && !targets.has(entry.target.trim())) {
        diagnostics.push(diagnostic("SRS-W012", "warning", `Completed Work Log target is not registered: ${entry.target}`, entryLocation));
      }
      for (const scope of splitCsv(entry.scope)) {
        if (!scopes.has(scope)) {
          diagnostics.push(diagnostic("SRS-W013", "warning", `Completed Work Log scope is not registered: ${scope}`, entryLocation));
        }
      }
      for (const id of entry.requirementIds) {
        const record = recordsById.get(id);
        if (!record) {
          diagnostics.push(diagnostic("SRS-W014", "warning", `Completed Work Log requirement does not exist: ${id}`, entryLocation));
        } else if (record.status !== "implemented" && record.status !== "verified") {
          diagnostics.push(diagnostic("SRS-W015", "warning", `Completed Work Log requirement is not completed: ${id}`, entryLocation));
        }
      }
      for (const issue of parseReportPathCell(entry.reportPathsCell ?? entry.reportPaths.join(", ")).issues) {
        diagnostics.push(
          diagnostic(
            "SRS-W024",
            "warning",
            `Completed Work Log report path is malformed: ${issue.token || issue.reason}`,
            entryLocation,
            malformedReportPathDetails(issue.token ?? "", issue.reason)
          )
        );
      }
    }
    return diagnostics;
  });
}
