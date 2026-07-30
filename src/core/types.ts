export const REQUIREMENT_STATUSES = [
  "planned",
  "in_progress",
  "blocked",
  "implemented",
  "verified",
  "discarded"
] as const;

export const REQUIREMENT_TYPES = [
  "functional",
  "non_functional",
  "interface",
  "data",
  "security",
  "performance",
  "reliability",
  "observability",
  "operational",
  "migration",
  "constraint"
] as const;

export const PRIORITY_LEVELS = ["critical", "high", "medium", "low", "optional"] as const;
export const RISK_LEVELS = ["low", "medium", "high", "critical"] as const;
export const STABILITY_LEVELS = ["draft", "evolving", "stable", "frozen", "deprecated"] as const;
export const LEGACY_STABILITY_LEVELS = ["volatile"] as const;

export const TYPE_PREFIX: Record<RequirementType, RequirementPrefix> = {
  functional: "FR",
  non_functional: "NFR",
  interface: "IR",
  data: "DR",
  security: "SEC",
  performance: "PERF",
  reliability: "REL",
  observability: "OBS",
  operational: "OPS",
  migration: "MIG",
  constraint: "CON"
};

export const PREFIX_TYPE: Record<RequirementPrefix, RequirementType> = Object.fromEntries(
  Object.entries(TYPE_PREFIX).map(([type, prefix]) => [prefix, type])
) as Record<RequirementPrefix, RequirementType>;

export type RequirementStatus = (typeof REQUIREMENT_STATUSES)[number];
export type RequirementType = (typeof REQUIREMENT_TYPES)[number];
export type RequirementPrefix =
  | "FR"
  | "NFR"
  | "IR"
  | "DR"
  | "SEC"
  | "PERF"
  | "REL"
  | "OBS"
  | "OPS"
  | "MIG"
  | "CON";
export type Priority = (typeof PRIORITY_LEVELS)[number];
export type Risk = (typeof RISK_LEVELS)[number];
export type Stability = (typeof STABILITY_LEVELS)[number] | (typeof LEGACY_STABILITY_LEVELS)[number];
export type DiagnosticSeverity = "error" | "warning" | "info";

export interface DiagnosticDefinition {
  code: string;
  severity: DiagnosticSeverity;
  title: string;
  messageTemplate: string;
  sourceRule: string;
  since: string;
  remediation?: string;
}

export interface DiagnosticLocation {
  filePath?: string;
  line?: number;
  requirementId?: string;
}

export interface ProjectRoot {
  root: string;
}

export interface TextFileSnapshot {
  sha256: string;
  size: number;
  mtimeMs?: number;
}

export interface TextFile {
  path: string;
  relativePath: string;
  text: string;
  lines: string[];
  newline: "\n" | "\r\n";
  snapshot?: TextFileSnapshot;
}

export interface Diagnostic {
  code: string;
  severity: DiagnosticSeverity;
  message: string;
  filePath?: string;
  line?: number;
  requirementId?: string;
  details?: unknown;
}

export interface DiagnosticsSummary {
  errors: number;
  warnings: number;
  byCode: Record<string, number>;
}

export type TargetSource = "explicit" | "active-target";

export interface TargetSelectionOptions {
  target?: string;
}

export interface TargetSelection {
  target: string;
  targetSource: TargetSource;
}

export interface TargetEntry {
  target: string;
  type: string;
  status: string;
  description: string;
  line?: number;
}

export interface ScopeEntry {
  scope: string;
  prefix: string;
  document: string;
  description: string;
  line?: number;
}

export interface CompletedWorkEntry {
  date: string;
  target: string;
  scope: string;
  requirementIds: string[];
  summary: string;
  reportPaths: string[];
  filePath?: string;
  line?: number;
  reportPathsCell?: string;
}

export interface CompletedWorkPage {
  total: number;
  returned: number;
  limit: number;
  hasMore: boolean;
  nextOffset: number | null;
}

export interface CompletedWorkSourceInfo {
  mode: "external" | "legacy";
  authoritativeFilePath: "docs/spec/05.completed-work.md" | "docs/spec/00.index.md";
  sources: string[];
  hasExternalFile: boolean;
  hasLegacyRows: boolean;
  hasExternalRows: boolean;
  duplicateSources: boolean;
  migrationRecommended: boolean;
}

export interface CompletedWorkReadModel {
  completedWork: CompletedWorkEntry[];
  completedWorkPage: CompletedWorkPage;
  completedWorkSource: CompletedWorkSourceInfo;
}

export interface StatusSummaryEntry {
  status: string;
  count: number;
  line?: number;
}

export interface RequirementTypeSummaryEntry {
  type: string;
  prefix: string;
  count: number;
  line?: number;
}

export interface IndexDocument {
  metadata: Record<string, string>;
  activeTarget: string;
  targets: TargetEntry[];
  scopes: ScopeEntry[];
  statusSummary?: StatusSummaryEntry[];
  requirementTypeSummary?: RequirementTypeSummaryEntry[];
  completedWork: CompletedWorkEntry[];
  targetGoals: Record<string, string>;
}

export interface AcceptanceCriterion {
  id: string;
  text: string;
  checked: boolean;
  line: number;
}

export interface EvidenceRow {
  id: string;
  type: string;
  reference: string;
  covers: string;
  notes: string;
  line?: number;
}

export interface TraceLink {
  type: string;
  reference: string;
  relation: string;
  notes: string;
  line?: number;
}

export interface ChangeNoteRow {
  date: string;
  change: string;
  reason: string;
  line?: number;
}

export interface RequirementRecord {
  id: string;
  title: string;
  type: RequirementType;
  target: string;
  status: RequirementStatus;
  scope: string;
  filePath: string;
  headingLine: number;
  marker?: "DISCARDED" | "DRAFT";
  metadata: Record<string, string>;
  acceptanceCriteria: AcceptanceCriterion[];
  verificationEvidence: EvidenceRow[];
  traceLinks: TraceLink[];
  changeNotes: ChangeNoteRow[];
  tags: string[];
  relatedDocs?: string[];
  evidenceReferences?: string[];
  traceReferences?: string[];
  newWorkCandidate?: boolean;
  requirement?: string;
  rationale?: string;
  research?: string;
  implementationNotes?: string;
  priority?: Priority;
  risk?: Risk;
  stability?: Stability;
  markdown?: string;
  blockStartLine?: number;
  blockEndLine?: number;
  sectionLines?: Record<string, number>;
  stepName?: string;
}

export interface ParsedWorkspace {
  root: ProjectRoot;
  index: IndexDocument;
  files: TextFile[];
  records: RequirementRecord[];
  diagnostics: Diagnostic[];
  stateFile?: TextFile;
  stepRecords?: RequirementRecord[];
  /**
   * FR-PARSE-037 — every Markdown document directly under docs/spec, as workspace-relative POSIX
   * paths. `files` carries only the documents the parser reads, which is a fixed set: the index, the
   * scope documents and three known sidecars. A consumer's own numbered document is in neither, so a
   * rule that needs to know which ordering numbers are occupied cannot work from `files`.
   */
  specDocuments?: string[];
}

export interface ValidationResult {
  diagnostics: Diagnostic[];
  errors: Diagnostic[];
  warnings: Diagnostic[];
}

export interface TargetSummary {
  target: string;
  targetSource: TargetSource;
  countsByStatus: Record<string, number>;
  countsByType: Record<string, number>;
  countsByStability: Record<string, number>;
  total: number;
  blocked: string[];
  implementedNotVerified: string[];
  missingEvidence: string[];
  draftRequirements: string[];
  deprecatedRequirements: string[];
  newWorkCandidates: string[];
  stabilityBlockers: string[];
  stabilityWarnings: string[];
  diagnosticsSummary: DiagnosticsSummary;
  completedWork: CompletedWorkEntry[];
  completedWorkPage: CompletedWorkPage;
  goal: string | null;
}

export interface ReadDiagnosticsPayload {
  diagnostics: Diagnostic[];
  errors: Diagnostic[];
  warnings: Diagnostic[];
  diagnosticsSummary: DiagnosticsSummary;
}

export type ReadEnvelope<T extends object> = T & ReadDiagnosticsPayload;

export interface AcCoverageGap {
  requirementId: string;
  missingAcIds: string[];
}

export interface EvidenceReferenceIssue {
  requirementId: string;
  evidenceId?: string;
  reference: string;
  issue?: string;
}

export interface CommandEvidencePolicyViolation {
  requirementId: string;
  evidenceId?: string;
  reference: string;
  policy: string;
}

export interface ReleaseReadinessSummary {
  target: string;
  targetSource: TargetSource;
  ready: boolean;
  diagnosticsSummary: DiagnosticsSummary;
  validationErrors: number;
  blocked: string[];
  plannedOrInProgress: string[];
  implementedNotVerified: string[];
  draftRequirements: string[];
  deprecatedRequirements: string[];
  stabilityBlockers: string[];
  stabilityWarnings: string[];
  criticalHighUnverified: string[];
  missingEvidence: string[];
  acCoverageGaps: AcCoverageGap[];
  missingEvidenceReferences: EvidenceReferenceIssue[];
  brokenTraceLinks: string[];
  commandEvidencePolicyViolations: CommandEvidencePolicyViolation[];
  warnings: string[];
  baselineCommand: string;
}

export interface MutationResult<T = unknown> {
  ok: boolean;
  value?: T;
  error?: { code: string; message: string; diagnostics?: Diagnostic[]; staleGuard?: MutationStaleGuard; lock?: SrsMutationLockError };
  diagnostics: Diagnostic[];
  diagnosticsSummary: DiagnosticsSummary;
  patch?: PatchSummary;
  mutation?: MutationEnvelope;
  indexSync?: IndexSyncMutationSummary;
}

export interface IndexSyncMutationSummary {
  filePath: string;
  written: boolean;
  statusSummaryChanged: boolean;
  typeSummaryChanged: boolean;
  statusCounts: Record<string, number>;
  typeCounts: Record<string, number>;
}

export interface PatchSummary {
  filePath: string;
  operations: number;
  dryRun: boolean;
  preview: string[];
}

export interface MutationOperationDetail {
  type: string;
  line?: number;
  startLine?: number;
  endLine?: number;
  lineCount?: number;
  original?: string;
  replacement?: string;
  lines?: string[];
  expectedBefore?: string;
  expectedAfter?: string;
  expectedLastLine?: string;
}

export interface MutationStaleGuard {
  filePath: string;
  retry: string;
}

export interface SrsMutationLockMetadata {
  schemaVersion: "1.0.0";
  owner: string;
  operation: string;
  requestId: string;
  acquiredAt: string;
  expiresAt: string;
}

export interface SrsMutationLockRetry {
  message: string;
  recommendedDelayMs: number;
}

export interface SrsMutationLockError extends SrsMutationLockMetadata {
  retry: SrsMutationLockRetry;
}

export interface MutationEnvelope {
  kind: string;
  filePath: string;
  dryRun: boolean;
  written: boolean;
  operations: MutationOperationDetail[];
  preview: string[];
  staleGuard?: MutationStaleGuard;
  journalKey?: string;
  journalState?: string;
  idempotencyKey?: string;
  completedOperations?: string[];
  pendingOperations?: string[];
  pendingRepair?: unknown;
  targetRecord?: unknown;
  staleGuards?: MutationStaleGuard[];
}

export interface RequirementFilter {
  target?: string;
  status?: RequirementStatus;
  type?: RequirementType;
  scope?: string;
  tag?: string;
  stability?: Stability;
  priority?: Priority;
  missingEvidence?: boolean;
  relatedDoc?: string;
  evidenceReference?: string;
  traceReference?: string;
  newWorkCandidate?: boolean;
}

// ── v3.0.0 step-state infrastructure ──────────────────────────────────
export type StepStateStatus = "active" | "merging" | "merged" | "abandoned";
export type StepStateMode = "sdd" | "vibe" | "wait" | "tdd";

export interface StepStateEntry {
  step: string;
  status: string;
  dependsOn: string;
  touchesScope: string;
  touchesReq: string;
  created: string;
  updated: string;
  invalidStatus?: boolean;
}

export type StepStateParseResult = StepStateEntry[] & {
  mode: StepStateMode;
  activeTask?: string;
  modeInvalid?: boolean;
};

export interface StepListEntry {
  step: string;
  status: string;
  dependsOn: string[];
  /** FR-NODE-079 — whether docs/spec/steps/<step>/design.md exists. */
  sdsPresent: boolean;
  /** FR-NODE-079 — the design.md metadata-table Status value when parseable. */
  sdsStatus?: string;
}

export interface StepAdvisory {
  code: string;
  step?: string;
  message?: string;
}

export interface ListStepsResult {
  steps: StepListEntry[];
  advisories: StepAdvisory[];
  cycle: boolean;
}

export interface StepDiffEntry {
  id: string;
  classification: "NEW" | "UPDATE" | "CONFLICT-PARTIAL" | "CONFLICT-FULL-GUARDED";
  stepSha: string;
  bodySha?: string;
}

export interface DiffStepsResult {
  entries: StepDiffEntry[];
}

export interface DiffStepsOptions {
  stepName?: string;
}

// ── v3.0.0 scope/target mutation output types ─────────────────────────
export interface RegisterScopesInput {
  apply?: boolean;
  dryRun?: boolean;
}
export type RegisterScopesSkipReason = "cannot-infer-prefix" | "prefix-conflict";
export interface RegisterScopesItemPlan {
  document: string;
  prefix?: string;
  skipReason?: RegisterScopesSkipReason;
}
export interface RegisterScopesOutput {
  dryRun: boolean;
  items: RegisterScopesItemPlan[];
}

export interface RetargetInput {
  ids: string[];
  toTarget: string;
  exclude?: string[];
  reason?: string;
  dryRun?: boolean;
}
export type RetargetSkipReason = "excluded" | "not-found" | "target-not-registered" | "frozen-needs-change-note";
export interface RetargetItemPlan {
  id: string;
  fromTarget?: string;
  toTarget?: string;
  skipReason?: RetargetSkipReason;
}
export interface RetargetOutput {
  dryRun: boolean;
  items: RetargetItemPlan[];
}

export interface ScaffoldScopeInput {
  name: string;
  prefix: string;
  apply?: boolean;
  ignoreLock?: boolean;
}
export interface ScaffoldScopeOutput {
  dryRun: boolean;
  document: string;
  filePreview: string;
  srsDocumentsRow: string;
  scopeMapRow: string;
}

