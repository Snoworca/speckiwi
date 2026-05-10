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
export const STABILITY_LEVELS = ["stable", "evolving", "volatile"] as const;

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
export type Stability = (typeof STABILITY_LEVELS)[number];
export type DiagnosticSeverity = "error" | "warning" | "info";

export interface DiagnosticDefinition {
  code: string;
  severity: DiagnosticSeverity;
  title: string;
  messageTemplate: string;
  sourceRule: string;
  since: string;
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
}

export interface ScopeEntry {
  scope: string;
  prefix: string;
  document: string;
  description: string;
}

export interface CompletedWorkEntry {
  date: string;
  target: string;
  scope: string;
  requirementIds: string[];
  summary: string;
  line?: number;
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

export interface RequirementRecord {
  id: string;
  title: string;
  type: RequirementType;
  target: string;
  status: RequirementStatus;
  scope: string;
  filePath: string;
  headingLine: number;
  metadata: Record<string, string>;
  acceptanceCriteria: AcceptanceCriterion[];
  verificationEvidence: EvidenceRow[];
  traceLinks: TraceLink[];
  tags: string[];
  requirement?: string;
  rationale?: string;
  priority?: Priority;
  risk?: Risk;
  stability?: Stability;
  markdown?: string;
  blockStartLine?: number;
  blockEndLine?: number;
  sectionLines?: Record<string, number>;
}

export interface ParsedWorkspace {
  root: ProjectRoot;
  index: IndexDocument;
  files: TextFile[];
  records: RequirementRecord[];
  diagnostics: Diagnostic[];
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
  total: number;
  blocked: string[];
  implementedNotVerified: string[];
  missingEvidence: string[];
  diagnosticsSummary: DiagnosticsSummary;
  completedWork: CompletedWorkEntry[];
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
  error?: { code: string; message: string; diagnostics?: Diagnostic[] };
  diagnostics: Diagnostic[];
  patch?: PatchSummary;
}

export interface PatchSummary {
  filePath: string;
  operations: number;
  dryRun: boolean;
  preview: string[];
}

export interface RequirementFilter {
  target?: string;
  status?: RequirementStatus;
  type?: RequirementType;
  scope?: string;
  tag?: string;
}
