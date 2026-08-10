import { createHash, timingSafeEqual } from "node:crypto";
import { open, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { diagnostic } from "../diagnostic.js";
import { resolveInsideRoot } from "../fs/safe-path.js";
import { mutationFail, mutationOk } from "../mutation/guards.js";
import { withMutationEnvelope } from "../mutation/envelope.js";
import type { Diagnostic, MutationEnvelope, MutationOperationDetail, MutationResult, MutationStaleGuard, ProjectRoot } from "../types.js";
import * as artifactLockModule from "./artifact-lock.js";
import type { AcquireArtifactLockResult, ArtifactLockCapability, ReleaseArtifactLockResult } from "./artifact-lock.js";
import * as workflowJsonl from "./jsonl.js";
import type { WorkflowJsonlEntry, WorkflowJsonlEvent } from "./jsonl.js";
import { resolveWorkflowArtifacts } from "./artifacts.js";
import {
  canonicalWorkflowJson,
  workflowRecordReclassificationProvenance,
  workflowRecordReclassificationRunId,
  workflowJournalIdentity,
  type WorkflowJournalIdentity
} from "./identity.js";

export { EMPTY_WORKFLOW_REQ_TOKEN, canonicalWorkflowJson, workflowJournalIdentity } from "./identity.js";
export type { WorkflowJournalIdentity, WorkflowJournalIdentityInput } from "./identity.js";

export type WorkflowMutationKind =
  | "plan_checkbox_check"
  | "plan_checkbox_uncheck"
  | "plan_checklist_item_update"
  | "pm_task_status_update"
  | "pipeline_event_append"
  | "worklog_event_append"
  | "workflow_repair_record"
  | "workflow_record_reclassification"
  | "workflow_logical_delete";

export type WorkflowJournalState = "planned" | "applied" | "confirmed" | "failed" | "skipped_dry_run";

export interface WorkflowMutationInput {
  kind: WorkflowMutationKind;
  owner: string;
  runId: string;
  taskId?: string;
  reqId?: string;
  reason?: string;
  planPath?: string;
  pmStatePath?: string;
  sidecarPath?: string;
  jsonlPath?: string;
  expectedSha256?: string;
  recordType?: string;
  recordId?: string;
  checked?: boolean;
  status?: string;
  event?: WorkflowJsonlEvent;
  dryRun?: boolean;
  idempotencyKey?: string;
  path?: string;
  line?: number;
  byteOffset?: number;
  rawSha256?: string;
  eventKey?: string;
  targetRunId?: string;
  preimagePrefixSha256?: string;
  repairToken?: string;
}

export interface WorkflowPendingRepair {
  kind: string;
  message?: string;
  retry?: string | Readonly<Record<string, unknown>>;
  staleGuard?: MutationStaleGuard;
  [key: string]: unknown;
}

export interface WorkflowMutationOutput {
  kind: WorkflowMutationKind;
  written: boolean;
  journalKey: string;
  idempotencyKey: string;
  journalState: WorkflowJournalState;
  completedOperations: string[];
  pendingOperations: string[];
  pendingRepair: WorkflowPendingRepair | null;
  targetRecord: Record<string, unknown>;
  staleGuards: MutationStaleGuard[];
  repairToken?: string;
  operations?: MutationOperationDetail[];
  artifact?: WorkflowMutationArtifact;
  diagnosticDelta?: WorkflowDiagnosticDelta;
}

export interface WorkflowMutationArtifact {
  relativePath: string;
  kind: "pipeline" | "worklog";
  sha256: string;
}

export interface WorkflowDiagnosticDelta {
  removed: Diagnostic[];
  added: Diagnostic[];
  preserved: Diagnostic[];
}

function sha256Text(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function sha256Bytes(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function repairTokenMatches(supplied: string | undefined, expected: string): boolean {
  if (typeof supplied !== "string") return false;
  const suppliedBytes = Buffer.from(supplied, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  return suppliedBytes.length === expectedBytes.length && timingSafeEqual(suppliedBytes, expectedBytes);
}

function prependCompletedOperation(
  result: MutationResult<WorkflowMutationOutput>,
  operation: string
): MutationResult<WorkflowMutationOutput> {
  const value = result.value
    ? { ...result.value, completedOperations: [operation, ...result.value.completedOperations] }
    : undefined;
  const mutation = result.mutation
    ? { ...result.mutation, completedOperations: [operation, ...(result.mutation.completedOperations ?? [])] }
    : undefined;
  return {
    ...result,
    ...(value ? { value } : {}),
    ...(mutation ? { mutation } : {})
  };
}

async function appendUtf8LineAndSync(absolutePath: string, line: string, prependLineFeed = false): Promise<void> {
  const handle = await open(absolutePath, "a");
  try {
    await handle.writeFile(`${prependLineFeed ? "\n" : ""}${line}\n`, { encoding: "utf8" });
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function relativeLockPath(root: ProjectRoot, capability: ArtifactLockCapability): string {
  return path.relative(root.root, capability.lockPath).replaceAll("\\", "/");
}

function artifactLockDiagnostic(
  message: string,
  filePath: string,
  details: Record<string, unknown>
): Diagnostic {
  return diagnostic("SRS-E075", "error", message, { filePath }, details);
}

function isJsonlLineBoundaryPrefixHash(bytes: Buffer, expectedSha256: string): boolean {
  const hash = createHash("sha256");
  let segmentStart = 0;
  for (let index = 0; index < bytes.length; index += 1) {
    if (bytes[index] !== 0x0a) continue;
    hash.update(bytes.subarray(segmentStart, index + 1));
    segmentStart = index + 1;
    if (hash.copy().digest("hex") === expectedSha256) return true;
  }
  if (segmentStart < bytes.length) hash.update(bytes.subarray(segmentStart));
  return (bytes.length === 0 || bytes.at(-1) !== 0x0a) && hash.digest("hex") === expectedSha256;
}

async function readText(root: ProjectRoot, relativePath: string): Promise<{ absolutePath: string; text: string; sha256: string }> {
  const absolutePath = await resolveInsideRoot(root.root, relativePath);
  const text = await readFile(absolutePath, "utf8");
  return { absolutePath, text, sha256: sha256Text(text) };
}

function ownerDiagnostic(kind: WorkflowMutationKind, owner: string): Diagnostic {
  return diagnostic("SRS-E070", "error", "Workflow mutation owner is not allowed for this operation", {}, { kind, owner });
}

function usageDiagnostic(kind: WorkflowMutationKind, message: string): Diagnostic {
  return diagnostic("SRS-E071", "error", message, {}, { kind });
}

function staleDiagnostic(relativePath: string, expectedSha256: string, actualSha256?: string): Diagnostic {
  return diagnostic("SRS-E032", "error", "Mutation snapshot is stale", { filePath: relativePath }, { expectedSha256, actualSha256 });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function operationPreview(operation: MutationOperationDetail): string[] {
  if (operation.replacement !== undefined) return [operation.replacement];
  if (operation.lines) return operation.lines;
  return [];
}

function envelope(input: {
  kind: WorkflowMutationKind;
  filePath: string;
  dryRun: boolean;
  written: boolean;
  operations: MutationOperationDetail[];
  identity: WorkflowJournalIdentity;
  journalState: WorkflowJournalState;
  completedOperations: string[];
  pendingOperations: string[];
  pendingRepair: WorkflowPendingRepair | null;
  targetRecord: Record<string, unknown>;
  staleGuards: MutationStaleGuard[];
  artifact?: WorkflowMutationArtifact;
  diagnosticDelta?: WorkflowDiagnosticDelta;
}): MutationEnvelope {
  return {
    kind: input.kind,
    filePath: input.filePath,
    dryRun: input.dryRun,
    written: input.written,
    operations: input.operations,
    preview: input.operations.flatMap(operationPreview),
    journalKey: input.identity.journalKey,
    journalState: input.journalState,
    idempotencyKey: input.identity.idempotencyKey,
    completedOperations: input.completedOperations,
    pendingOperations: input.pendingOperations,
    pendingRepair: input.pendingRepair,
    targetRecord: input.targetRecord,
    staleGuards: input.staleGuards,
    ...(input.artifact ? { artifact: input.artifact } : {}),
    ...(input.diagnosticDelta ? { diagnosticDelta: input.diagnosticDelta } : {})
  };
}

function output(input: {
  kind: WorkflowMutationKind;
  written: boolean;
  identity: WorkflowJournalIdentity;
  journalState: WorkflowJournalState;
  completedOperations: string[];
  pendingOperations: string[];
  pendingRepair: WorkflowPendingRepair | null;
  targetRecord: Record<string, unknown>;
  staleGuards: MutationStaleGuard[];
  repairToken?: string;
  operations?: MutationOperationDetail[];
  artifact?: WorkflowMutationArtifact;
  diagnosticDelta?: WorkflowDiagnosticDelta;
}): WorkflowMutationOutput {
  return {
    kind: input.kind,
    written: input.written,
    journalKey: input.identity.journalKey,
    idempotencyKey: input.identity.idempotencyKey,
    journalState: input.journalState,
    completedOperations: input.completedOperations,
    pendingOperations: input.pendingOperations,
    pendingRepair: input.pendingRepair,
    targetRecord: input.targetRecord,
    staleGuards: input.staleGuards,
    ...(input.repairToken ? { repairToken: input.repairToken } : {}),
    ...(input.operations ? { operations: input.operations } : {}),
    ...(input.artifact ? { artifact: input.artifact } : {}),
    ...(input.diagnosticDelta ? { diagnosticDelta: input.diagnosticDelta } : {})
  };
}

function identityFor(input: WorkflowMutationInput): WorkflowJournalIdentity {
  if (input.kind === "workflow_record_reclassification") {
    return workflowJournalIdentity({
      tool: input.kind,
      runId: input.runId,
      ...(input.taskId ? { taskId: input.taskId } : {}),
      ...(input.reqId ? { reqId: input.reqId } : {}),
      args: {
        path: input.path ?? input.jsonlPath,
        recordType: input.recordType,
        line: input.line,
        byteOffset: input.byteOffset,
        rawSha256: input.rawSha256,
        eventKey: input.eventKey,
        targetRunId: input.targetRunId,
        preimagePrefixSha256: input.preimagePrefixSha256,
        effectiveRecordClass: "audit_note",
        owner: input.owner,
        reason: input.reason
      }
    });
  }
  return workflowJournalIdentity({
    tool: input.kind,
    runId: input.runId,
    ...(input.taskId ? { taskId: input.taskId } : {}),
    ...(input.reqId ? { reqId: input.reqId } : {}),
    args: {
      owner: input.owner,
      reason: input.reason,
      planPath: input.planPath,
      pmStatePath: input.pmStatePath,
      sidecarPath: input.sidecarPath,
      jsonlPath: input.jsonlPath,
      checked: input.checked,
      status: input.status,
      event: input.event,
      recordType: input.recordType,
      recordId: input.recordId
    }
  });
}

function isForbiddenOwner(input: WorkflowMutationInput): boolean {
  if (input.kind === "plan_checkbox_check" || input.kind === "plan_checkbox_uncheck" || input.kind === "plan_checklist_item_update" || input.kind === "pm_task_status_update") {
    return input.owner !== "kiwi-pm" && input.owner !== "pm";
  }
  if (input.kind === "workflow_logical_delete") {
    return input.owner !== "kiwi-pm" && input.owner !== "pm";
  }
  return input.owner.length === 0;
}

function failWithEnvelope(input: WorkflowMutationInput, filePath: string, identity: WorkflowJournalIdentity, diagnostics: Diagnostic[], message: string, pendingRepair: WorkflowPendingRepair | null, staleGuard?: MutationStaleGuard): MutationResult<WorkflowMutationOutput> {
  const mutation = envelope({
    kind: input.kind,
    filePath,
    dryRun: input.dryRun ?? false,
    written: false,
    operations: [],
    identity,
    journalState: "failed",
    completedOperations: [],
    pendingOperations: [],
    pendingRepair,
    targetRecord: targetRecord(input),
    staleGuards: staleGuard ? [staleGuard] : []
  });
  return withMutationEnvelope(mutationFail(staleGuard ? "STALE_PATCH" : "MUTATION_DENIED", message, diagnostics, staleGuard ? { staleGuard } : {}), mutation);
}

function targetRecord(input: WorkflowMutationInput): Record<string, unknown> {
  return {
    kind: input.kind,
    runId: input.runId,
    ...(input.taskId ? { taskId: input.taskId } : {}),
    ...(input.reqId ? { reqId: input.reqId } : {}),
    ...(input.planPath ? { planPath: input.planPath } : {}),
    ...(input.pmStatePath ? { pmStatePath: input.pmStatePath } : {}),
    ...(input.sidecarPath ? { sidecarPath: input.sidecarPath } : {}),
    ...(input.jsonlPath ? { jsonlPath: input.jsonlPath } : {}),
    ...(input.status ? { status: input.status } : {}),
    ...(input.recordType ? { recordType: input.recordType } : {}),
    ...(input.recordId ? { recordId: input.recordId, desiredState: "deleted" } : {}),
    ...(input.path ? { path: input.path } : {}),
    ...(input.line !== undefined ? { line: input.line } : {}),
    ...(input.byteOffset !== undefined ? { byteOffset: input.byteOffset } : {}),
    ...(input.rawSha256 ? { rawSha256: input.rawSha256 } : {}),
    ...(input.eventKey ? { eventKey: input.eventKey } : {}),
    ...(input.targetRunId ? { targetRunId: input.targetRunId } : {}),
    ...(input.preimagePrefixSha256 ? { preimagePrefixSha256: input.preimagePrefixSha256 } : {})
  };
}

function checkboxReplacement(text: string, taskId: string, checked: boolean): { operation: MutationOperationDetail | null; nextText: string; alreadyDesired: boolean } {
  const lines = text.split("\n");
  const marker = checked ? "x" : " ";
  const taskPattern = escapeRegExp(taskId);
  const pattern = new RegExp(`^(\\s*[-*]\\s+)\\[([ xX])\\](\\s+(?:\\*\\*)?(?:\\\`)?${taskPattern}\\b.*)$`);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const match = pattern.exec(line);
    if (!match) continue;
    const current = (match[2] ?? " ") !== " ";
    if (current === checked) return { operation: null, nextText: text, alreadyDesired: true };
    const replacement = `${match[1]}[${marker}]${match[3]}`;
    lines[index] = replacement;
    return {
      operation: { type: "replaceLine", line: index + 1, lineCount: 1, original: line, replacement },
      nextText: lines.join("\n"),
      alreadyDesired: false
    };
  }
  return { operation: null, nextText: text, alreadyDesired: false };
}

interface WorkflowMutationSidecarTask {
  id?: string;
  task_id?: string;
  depends_on_task?: string[];
  status?: string;
}

interface WorkflowMutationSidecar {
  tasks?: WorkflowMutationSidecarTask[];
}

interface WorkflowMutationPmState {
  tasks?: Array<{ task_id?: string; status?: string }>;
}

function frontmatterValue(text: string, key: string): string | undefined {
  if (!text.startsWith("---\n")) return undefined;
  const end = text.indexOf("\n---", 4);
  if (end < 0) return undefined;
  for (const line of text.slice(4, end).split(/\r?\n/)) {
    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!match || match[1] !== key) continue;
    return match[2]?.trim().replace(/^"|"$/g, "");
  }
  return undefined;
}

function sidecarPathForPlan(input: WorkflowMutationInput, planPath: string, planText: string): string | null {
  if (input.sidecarPath) return input.sidecarPath;
  const declared = frontmatterValue(planText, "sidecar_path");
  if (!declared) return null;
  const baseDir = path.posix.dirname(planPath);
  return path.posix.normalize(path.posix.join(baseDir, declared));
}

async function optionalJson<T>(root: ProjectRoot, relativePath: string): Promise<T | null> {
  try {
    const absolutePath = await resolveInsideRoot(root.root, relativePath);
    return JSON.parse(await readFile(absolutePath, "utf8")) as T;
  } catch {
    return null;
  }
}

function taskKey(task: WorkflowMutationSidecarTask): string {
  return String(task.id ?? task.task_id ?? "");
}

function doneLike(status: string | undefined): boolean {
  return status === "done" || status === "skipped";
}

async function dependencyBlockers(root: ProjectRoot, input: WorkflowMutationInput, planPath: string, planText: string): Promise<string[]> {
  if (!input.taskId) return [];
  const sidecarPath = sidecarPathForPlan(input, planPath, planText);
  if (!sidecarPath) return [];
  const sidecar = await optionalJson<WorkflowMutationSidecar>(root, sidecarPath);
  const tasks = Array.isArray(sidecar?.tasks) ? sidecar.tasks : [];
  const task = tasks.find((item) => taskKey(item) === input.taskId);
  const dependencies = Array.isArray(task?.depends_on_task) ? task.depends_on_task.filter((item): item is string => typeof item === "string") : [];
  if (dependencies.length === 0) return [];
  const pmStatePath = input.pmStatePath ?? `.kiwi/sessions/${input.runId}/pm-state.json`;
  const pmState = await optionalJson<WorkflowMutationPmState>(root, pmStatePath);
  const pmStatus = new Map((pmState?.tasks ?? []).filter((item) => typeof item.task_id === "string").map((item) => [String(item.task_id), item.status]));
  const sidecarStatus = new Map(tasks.map((item) => [taskKey(item), item.status]));
  return dependencies.filter((dep) => !doneLike(pmStatus.get(dep) ?? sidecarStatus.get(dep)));
}

async function applyCheckboxMutation(root: ProjectRoot, input: WorkflowMutationInput, identity: WorkflowJournalIdentity): Promise<MutationResult<WorkflowMutationOutput>> {
  const filePath = input.planPath;
  if (!filePath || !input.taskId) {
    const diagnostics = [usageDiagnostic(input.kind, "Workflow checkbox mutation requires planPath and taskId")];
    return failWithEnvelope(input, filePath ?? "-", identity, diagnostics, "Workflow checkbox mutation requires planPath and taskId", null);
  }
  const desired = input.kind === "plan_checkbox_uncheck" ? false : input.checked ?? true;
  const file = await readText(root, filePath);
  const staleGuard = { filePath, retry: "rerun workflow mutation with fresh source hash" };
  if (input.expectedSha256 && input.expectedSha256 !== file.sha256) {
    const diagnostics = [staleDiagnostic(filePath, input.expectedSha256, file.sha256)];
    const pendingRepair = { kind: "rerun_with_fresh_artifact", message: "Plan checkbox mutation saw a stale source hash", retry: staleGuard.retry, staleGuard };
    return failWithEnvelope(input, filePath, identity, diagnostics, "Workflow artifact snapshot is stale", pendingRepair, staleGuard);
  }
  const blockedBy = await dependencyBlockers(root, input, filePath, file.text);
  if (blockedBy.length > 0) {
    const diagnostics = [diagnostic("SRS-E074", "error", "Workflow mutation is blocked by task dependency state", { filePath }, { taskId: input.taskId, blockedBy })];
    return failWithEnvelope(input, filePath, identity, diagnostics, "Workflow mutation is blocked by task dependency state", { kind: "blocked_dependency", message: "Complete dependency tasks before mutating this workflow record", retry: "complete dependencies and retry" });
  }
  const replacement = checkboxReplacement(file.text, input.taskId, desired);
  if (!replacement.operation) {
    if (replacement.alreadyDesired) {
      const completedOperations = [`confirm:${input.kind}`];
      const value = output({ kind: input.kind, written: false, identity, journalState: "confirmed", completedOperations, pendingOperations: [], pendingRepair: null, targetRecord: targetRecord(input), staleGuards: [staleGuard] });
      return withMutationEnvelope(mutationOk(value), envelope({ kind: input.kind, filePath, dryRun: input.dryRun ?? false, written: false, operations: [], identity, journalState: "confirmed", completedOperations, pendingOperations: [], pendingRepair: null, targetRecord: targetRecord(input), staleGuards: [staleGuard] }));
    }
    const diagnostics = [usageDiagnostic(input.kind, `Workflow checkbox task was not found: ${input.taskId}`)];
    return failWithEnvelope(input, filePath, identity, diagnostics, "Workflow checkbox task was not found", null);
  }
  const pendingOperations = [`write:${input.kind}`];
  if (input.dryRun) {
    const value = output({ kind: input.kind, written: false, identity, journalState: "skipped_dry_run", completedOperations: [], pendingOperations, pendingRepair: null, targetRecord: targetRecord(input), staleGuards: [staleGuard] });
    return withMutationEnvelope(mutationOk(value), envelope({ kind: input.kind, filePath, dryRun: true, written: false, operations: [replacement.operation], identity, journalState: "skipped_dry_run", completedOperations: [], pendingOperations, pendingRepair: null, targetRecord: targetRecord(input), staleGuards: [staleGuard] }));
  }
  await writeFile(file.absolutePath, replacement.nextText, "utf8");
  const completedOperations = [`write:${input.kind}`, `confirm:${input.kind}`];
  const value = output({ kind: input.kind, written: true, identity, journalState: "confirmed", completedOperations, pendingOperations: [], pendingRepair: null, targetRecord: targetRecord(input), staleGuards: [staleGuard] });
  return withMutationEnvelope(mutationOk(value), envelope({ kind: input.kind, filePath, dryRun: false, written: true, operations: [replacement.operation], identity, journalState: "confirmed", completedOperations, pendingOperations: [], pendingRepair: null, targetRecord: targetRecord(input), staleGuards: [staleGuard] }));
}

async function applyPmTaskStatusMutation(root: ProjectRoot, input: WorkflowMutationInput, identity: WorkflowJournalIdentity): Promise<MutationResult<WorkflowMutationOutput>> {
  const filePath = input.pmStatePath;
  if (!filePath || !input.taskId || !input.status) {
    const diagnostics = [usageDiagnostic(input.kind, "PM task status mutation requires pmStatePath, taskId, and status")];
    return failWithEnvelope(input, filePath ?? "-", identity, diagnostics, "PM task status mutation requires pmStatePath, taskId, and status", null);
  }
  const file = await readText(root, filePath);
  const staleGuard = { filePath, retry: "rerun workflow mutation with fresh PM state hash" };
  if (input.expectedSha256 && input.expectedSha256 !== file.sha256) {
    const diagnostics = [staleDiagnostic(filePath, input.expectedSha256, file.sha256)];
    const pendingRepair = { kind: "rerun_with_fresh_artifact", message: "PM task mutation saw a stale source hash", retry: staleGuard.retry, staleGuard };
    return failWithEnvelope(input, filePath, identity, diagnostics, "Workflow artifact snapshot is stale", pendingRepair, staleGuard);
  }
  let data: { tasks?: Array<Record<string, unknown>> };
  try {
    data = JSON.parse(file.text) as { tasks?: Array<Record<string, unknown>> };
  } catch (error) {
    const diagnostics = [diagnostic("SRS-W050", "warning", `Workflow artifact parse warning: ${filePath}`, { filePath }, { message: (error as Error).message })];
    return failWithEnvelope(input, filePath, identity, diagnostics, "PM state is malformed", { kind: "repair_malformed_json", message: "Repair malformed PM state before mutation", retry: "repair PM state JSON" });
  }
  const task = Array.isArray(data.tasks) ? data.tasks.find((item) => item.task_id === input.taskId) : undefined;
  if (!task) {
    const diagnostics = [usageDiagnostic(input.kind, `PM task was not found: ${input.taskId}`)];
    return failWithEnvelope(input, filePath, identity, diagnostics, "PM task was not found", null);
  }
  if (task.status === input.status) {
    const completedOperations = [`confirm:${input.kind}`];
    const value = output({ kind: input.kind, written: false, identity, journalState: "confirmed", completedOperations, pendingOperations: [], pendingRepair: null, targetRecord: targetRecord(input), staleGuards: [staleGuard] });
    return withMutationEnvelope(mutationOk(value), envelope({ kind: input.kind, filePath, dryRun: input.dryRun ?? false, written: false, operations: [], identity, journalState: "confirmed", completedOperations, pendingOperations: [], pendingRepair: null, targetRecord: targetRecord(input), staleGuards: [staleGuard] }));
  }
  const next = { ...data, tasks: data.tasks?.map((item) => (item.task_id === input.taskId ? { ...item, status: input.status } : item)) };
  const lines = JSON.stringify(next, null, 2).split("\n");
  const operation: MutationOperationDetail = { type: "replaceRange", startLine: 1, endLine: file.text.split("\n").length, lineCount: lines.length, lines };
  const pendingOperations = [`write:${input.kind}`];
  if (input.dryRun) {
    const value = output({ kind: input.kind, written: false, identity, journalState: "skipped_dry_run", completedOperations: [], pendingOperations, pendingRepair: null, targetRecord: targetRecord(input), staleGuards: [staleGuard] });
    return withMutationEnvelope(mutationOk(value), envelope({ kind: input.kind, filePath, dryRun: true, written: false, operations: [operation], identity, journalState: "skipped_dry_run", completedOperations: [], pendingOperations, pendingRepair: null, targetRecord: targetRecord(input), staleGuards: [staleGuard] }));
  }
  await writeFile(file.absolutePath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  const completedOperations = [`write:${input.kind}`, `confirm:${input.kind}`];
  const value = output({ kind: input.kind, written: true, identity, journalState: "confirmed", completedOperations, pendingOperations: [], pendingRepair: null, targetRecord: targetRecord(input), staleGuards: [staleGuard] });
  return withMutationEnvelope(mutationOk(value), envelope({ kind: input.kind, filePath, dryRun: false, written: true, operations: [operation], identity, journalState: "confirmed", completedOperations, pendingOperations: [], pendingRepair: null, targetRecord: targetRecord(input), staleGuards: [staleGuard] }));
}

const retainedJsonlCleanup = new Map<string, MutationResult<WorkflowMutationOutput>>();

async function runLockedJsonlMutation(
  root: ProjectRoot,
  input: WorkflowMutationInput,
  filePath: string,
  identity: WorkflowJournalIdentity,
  target: Record<string, unknown>,
  execute: () => Promise<MutationResult<WorkflowMutationOutput>>
): Promise<MutationResult<WorkflowMutationOutput>> {
  const absolutePath = await resolveInsideRoot(root.root, filePath);
  const lockIdentity = await artifactLockModule.resolveArtifactLockIdentity(absolutePath);
  const retained = retainedJsonlCleanup.get(lockIdentity.canonicalPath);
  if (retained) {
    retainedJsonlCleanup.delete(lockIdentity.canonicalPath);
    const cleanup = await artifactLockModule.retryRetainedArtifactLockCleanup(lockIdentity.canonicalPath);
    if (!cleanup.ok || !cleanup.released) {
      retainedJsonlCleanup.set(lockIdentity.canonicalPath, retained);
      return retained;
    }
  }
  let acquired: Awaited<ReturnType<typeof artifactLockModule.acquireArtifactLock>>;
  try {
    acquired = await artifactLockModule.acquireArtifactLock({ artifactPath: absolutePath, owner: input.owner });
  } catch {
    acquired = { ok: false, reason: "held" };
  }
  if (!acquired.ok) {
    return failWithEnvelope(
      input,
      filePath,
      identity,
      [artifactLockDiagnostic("Workflow artifact mutation lock is held", filePath, {
        holderOwnerIdentitySha256: acquired.holder?.ownerIdentitySha256
      })],
      "Workflow artifact mutation lock is unavailable",
      null
    );
  }

  let result: MutationResult<WorkflowMutationOutput>;
  try {
    result = await execute();
  } catch (error) {
    await artifactLockModule.releaseArtifactLock(acquired.capability);
    throw error;
  }
  const released = await artifactLockModule.releaseArtifactLock(acquired.capability);
  if (released.ok && released.released) return result;

  const cleanupDiagnostic = released.ok
    ? { code: released.reason, message: "Workflow artifact lock was not released" }
    : released.cleanupDiagnostic;
  const diagnostics = [artifactLockDiagnostic("Workflow artifact lock cleanup failed", filePath, {
    ownerIdentitySha256: acquired.capability.ownerIdentitySha256,
    cleanupDiagnostic
  })];
  const completedOperations = result.mutation?.completedOperations ?? [];
  const pendingOperations = [`cleanup:${input.kind}`];
  const pendingRepair: WorkflowPendingRepair = {
    kind: "workflow_artifact_lock_cleanup",
    artifact: { relativePath: filePath },
    lock: {
      relativePath: relativeLockPath(root, acquired.capability),
      ownerIdentitySha256: acquired.capability.ownerIdentitySha256
    },
    cleanupDiagnostic,
    retry: { action: "retry_same_workflow_mutation", mode: "cleanup_then_replay" }
  };
  const mutation = envelope({
    kind: input.kind,
    filePath,
    dryRun: false,
    written: false,
    operations: result.mutation?.operations ?? [],
    identity,
    journalState: "failed",
    completedOperations,
    pendingOperations,
    pendingRepair,
    targetRecord: target,
    staleGuards: []
  });
  const failedResult: MutationResult<WorkflowMutationOutput> = mutationFail("MUTATION_DENIED", "Workflow artifact lock cleanup failed", diagnostics);
  const failure = withMutationEnvelope(failedResult, mutation);
  if (!released.ok) retainedJsonlCleanup.set(lockIdentity.canonicalPath, failure);
  return failure;
}

async function applyJsonlAppendMutation(root: ProjectRoot, input: WorkflowMutationInput, identity: WorkflowJournalIdentity): Promise<MutationResult<WorkflowMutationOutput>> {
  const filePath = input.jsonlPath;
  if (!filePath || !input.event) {
    const diagnostics = [usageDiagnostic(input.kind, "Workflow JSONL mutation requires jsonlPath and event")];
    return failWithEnvelope(input, filePath ?? "-", identity, diagnostics, "Workflow JSONL mutation requires jsonlPath and event", null);
  }
  if (input.event.status === "CORRECTION") {
    const correctionTarget = input.event.corrects_run_id;
    if (typeof correctionTarget !== "string" || correctionTarget.trim().length === 0) {
      const diagnostics = [usageDiagnostic(input.kind, "Workflow CORRECTION requires corrects_run_id to be a non-blank string")];
      return failWithEnvelope(input, filePath, identity, diagnostics, "Workflow CORRECTION requires a valid correction target", null);
    }
  }
  const event: WorkflowJsonlEvent = {
    ...input.event,
    workflow_run_id: input.runId,
    journal_key: identity.journalKey,
    idempotency_key: input.idempotencyKey ?? identity.idempotencyKey,
    journal_state: input.dryRun ? "skipped_dry_run" : "planned",
    owner: input.owner,
    ...(input.taskId && typeof input.event.task_id !== "string" ? { task_id: input.taskId } : {}),
    ...(input.reason ? { reason: input.reason } : {})
  };
  const execute = async (): Promise<MutationResult<WorkflowMutationOutput>> => {
  const parsed = await workflowJsonl.parseWorkflowJsonl(root, filePath);
  if (input.expectedSha256 && parsed.sha256 && input.expectedSha256 !== parsed.sha256) {
    const staleGuard = { filePath, retry: "rerun workflow JSONL append with fresh source hash" };
    const diagnostics = [staleDiagnostic(filePath, input.expectedSha256, parsed.sha256)];
    const pendingRepair = { kind: "rerun_with_fresh_artifact", message: "Workflow JSONL append saw a stale source hash", retry: staleGuard.retry, staleGuard };
    return failWithEnvelope(input, filePath, identity, diagnostics, "Workflow artifact snapshot is stale", pendingRepair, staleGuard);
  }
  const incomingEventKey = `${String(event.skill ?? "")}|${String(event.run_id ?? "")}`;
  if (parsed.entries.some((entry) => entry.eventKey === incomingEventKey)) {
    const completedOperations = [`confirm:${input.kind}`];
    const value = output({ kind: input.kind, written: false, identity, journalState: "confirmed", completedOperations, pendingOperations: [], pendingRepair: null, targetRecord: targetRecord(input), staleGuards: [] });
    return withMutationEnvelope(mutationOk(value, parsed.diagnostics), envelope({ kind: input.kind, filePath, dryRun: input.dryRun ?? false, written: false, operations: [], identity, journalState: "confirmed", completedOperations, pendingOperations: [], pendingRepair: null, targetRecord: targetRecord(input), staleGuards: [] }));
  }
  const appended = await workflowJsonl.appendWorkflowJsonl(root, filePath, event, {
    policy: "halt",
    ...(input.dryRun !== undefined ? { dryRun: input.dryRun } : {}),
    ...(input.expectedSha256 ? { expectedSha256: input.expectedSha256 } : {})
  });
  if (!appended.ok) {
    const staleGuard = appended.error?.staleGuard;
    const pendingRepair = staleGuard ? { kind: "rerun_with_fresh_artifact", message: "Workflow JSONL append saw a stale source hash", retry: staleGuard.retry, staleGuard } : { kind: "repair_jsonl_append", message: appended.error?.message ?? "Workflow JSONL append failed", retry: "repair workflow JSONL diagnostics and retry" };
    return failWithEnvelope(input, filePath, identity, appended.diagnostics, appended.error?.message ?? "Workflow JSONL append failed", pendingRepair, staleGuard);
  }
  const pendingOperations = input.dryRun ? [`write:${input.kind}`] : [];
  const completedOperations = input.dryRun ? [] : [`write:${input.kind}`, `confirm:${input.kind}`];
  const journalState: WorkflowJournalState = input.dryRun ? "skipped_dry_run" : "confirmed";
  const operations = appended.mutation?.operations ?? [];
  const value = output({ kind: input.kind, written: appended.value?.written ?? false, identity, journalState, completedOperations, pendingOperations, pendingRepair: null, targetRecord: targetRecord(input), staleGuards: [] });
  return withMutationEnvelope(mutationOk(value, appended.diagnostics), envelope({ kind: input.kind, filePath, dryRun: input.dryRun ?? false, written: appended.value?.written ?? false, operations, identity, journalState, completedOperations, pendingOperations, pendingRepair: null, targetRecord: targetRecord(input), staleGuards: [] }));
  };

  if (input.dryRun) return execute();
  return runLockedJsonlMutation(root, input, filePath, identity, targetRecord(input), execute);
}

interface ReclassificationTargetIdentity {
  path: string;
  recordType: "pipeline" | "worklog";
  line: number;
  byteOffset: number;
  rawSha256: string;
  eventKey: string;
  targetRunId: string;
  preimagePrefixSha256: string;
}

function reclassificationDiagnostic(message: string, details: Record<string, unknown>, code = "SRS-E071"): Diagnostic {
  return diagnostic(code, "error", message, {}, details);
}

function reclassificationIdentity(input: WorkflowMutationInput, target: ReclassificationTargetIdentity): WorkflowJournalIdentity {
  return workflowRecordReclassificationProvenance({
    runId: input.runId,
    ...(input.taskId ? { taskId: input.taskId } : {}),
    ...(input.reqId ? { reqId: input.reqId } : {}),
    args: { ...target, effectiveRecordClass: "audit_note", owner: input.owner, reason: input.reason }
  });
}

function reclassificationOverlay(
  input: WorkflowMutationInput,
  target: ReclassificationTargetIdentity,
  identity: WorkflowJournalIdentity
): WorkflowJsonlEvent {
  return {
    schema_version: "1.0.0",
    skill: "speckiwi",
    event: "record_reclassification",
    run_id: workflowRecordReclassificationRunId(identity.journalKey),
    ts: "1970-01-01T00:00:00.000Z",
    recordClass: "meta",
    effectiveRecordClass: "audit_note",
    operation: {
      kind: "record_reclassification",
      record_type: target.recordType,
      source_path: target.path,
      source_line: target.line,
      byte_offset: target.byteOffset,
      raw_sha256: target.rawSha256,
      event_key: target.eventKey,
      target_run_id: target.targetRunId,
      preimage_prefix_sha256: target.preimagePrefixSha256,
      owner: input.owner,
      reason: input.reason ?? ""
    },
    workflow_run_id: input.runId,
    ...(input.taskId ? { task_id: input.taskId } : {}),
    ...(input.reqId ? { req_id: input.reqId } : {}),
    journal_key: identity.journalKey,
    idempotency_key: identity.idempotencyKey,
    owner: input.owner,
    reason: input.reason ?? ""
  };
}

function repairTokenFor(target: ReclassificationTargetIdentity, identity: WorkflowJournalIdentity, overlayLine: string, expectedSha256: string, pendingRepair: WorkflowPendingRepair): string {
  return sha256Text(canonicalWorkflowJson({ target, journalKey: identity.journalKey, idempotencyKey: identity.idempotencyKey, overlayLine, expectedSha256, pendingRepair }));
}

function reclassificationTargetRecord(target: ReclassificationTargetIdentity): Record<string, unknown> {
  return { ...target };
}

function reclassificationArtifact(
  relativePath: string,
  kind: "pipeline" | "worklog",
  sha256: string
): WorkflowMutationArtifact {
  return { relativePath, kind, sha256 };
}

function diagnosticFingerprint(value: Diagnostic): string {
  return canonicalWorkflowJson(value as unknown as Record<string, unknown>);
}

function workflowDiagnosticDelta(before: Diagnostic[], after: Diagnostic[]): WorkflowDiagnosticDelta {
  const beforeKeys = new Set(before.map(diagnosticFingerprint));
  const afterKeys = new Set(after.map(diagnosticFingerprint));
  return {
    removed: before.filter((item) => !afterKeys.has(diagnosticFingerprint(item))),
    added: after.filter((item) => !beforeKeys.has(diagnosticFingerprint(item))),
    preserved: after.filter((item) => beforeKeys.has(diagnosticFingerprint(item)))
  };
}

function reclassificationPendingRepair(
  target: ReclassificationTargetIdentity,
  overlay: WorkflowJsonlEvent,
  overlayLine: string
): WorkflowPendingRepair {
  return {
    kind: "record_reclassification",
    message: "Apply the token-bound record reclassification overlay",
    retry: "apply with repairToken and unchanged identity",
    target,
    overlayEventKey: `${String(overlay.skill)}|${String(overlay.run_id)}`,
    overlayRunId: overlay.run_id,
    overlayTimestamp: overlay.ts,
    overlaySha256: sha256Text(`${overlayLine}\n`),
    durablePostAppend: false
  };
}

function reclassificationConfirmationRepair(
  relativePath: string,
  postAppendSha256: string,
  targetRecord: ReclassificationTargetIdentity,
  overlayEventKey: string
): WorkflowPendingRepair {
  return {
    kind: "record_reclassification_confirmation",
    artifact: { relativePath, postAppendSha256 },
    targetRecord,
    overlayEventKey,
    retry: { action: "retry_same_record_reclassification", mode: "confirm_only" }
  };
}

function reclassificationCleanupRepair(
  root: ProjectRoot,
  relativePath: string,
  postAppendSha256: string,
  capability: ArtifactLockCapability,
  cleanupDiagnostic: Readonly<Record<string, unknown>>
): WorkflowPendingRepair {
  return {
    kind: "record_reclassification_lock_cleanup",
    artifact: { relativePath, postAppendSha256 },
    lock: {
      relativePath: relativeLockPath(root, capability),
      ownerIdentitySha256: capability.ownerIdentitySha256
    },
    cleanupDiagnostic,
    retry: { action: "retry_same_record_reclassification", mode: "cleanup_then_replay" }
  };
}

interface RetainedReclassificationCleanup {
  readonly capability: ArtifactLockCapability;
  readonly failure: MutationResult<WorkflowMutationOutput>;
  readonly operationIdentitySha256: string;
  readonly repairToken: string;
}

const retainedReclassificationCleanup = new Map<string, RetainedReclassificationCleanup>();

type ReclassificationArtifactLockAttempt = AcquireArtifactLockResult | {
  readonly ok: false;
  readonly reason: "error";
  readonly error: Error & { code?: string };
};

function reclassificationOperationIdentity(input: WorkflowMutationInput): string {
  return sha256Text(canonicalWorkflowJson({
    kind: input.kind,
    owner: input.owner,
    reason: input.reason,
    runId: input.runId,
    taskId: input.taskId,
    reqId: input.reqId,
    idempotencyKey: input.idempotencyKey,
    path: input.path,
    jsonlPath: input.jsonlPath,
    recordType: input.recordType,
    line: input.line,
    byteOffset: input.byteOffset,
    rawSha256: input.rawSha256,
    eventKey: input.eventKey,
    targetRunId: input.targetRunId,
    preimagePrefixSha256: input.preimagePrefixSha256,
    expectedSha256: input.expectedSha256
  }));
}

function artifactLockAcquisitionError(error: unknown): Error & { code?: string } {
  if (error instanceof Error) return error as Error & { code?: string };
  return Object.assign(new Error(String(error)), { code: "UNKNOWN" });
}

async function acquireReclassificationArtifactLock(
  artifactPath: string,
  owner: string
): Promise<ReclassificationArtifactLockAttempt> {
  let result: AcquireArtifactLockResult;
  try {
    result = await artifactLockModule.acquireArtifactLock({ artifactPath, owner });
  } catch (error) {
    return { ok: false, reason: "error", error: artifactLockAcquisitionError(error) };
  }
  const startedAt = process.hrtime.bigint();
  const waitBudgetNanoseconds = 30_000_000_000n;
  while (!result.ok && process.hrtime.bigint() - startedAt < waitBudgetNanoseconds) {
    try {
      await readFile(artifactPath);
    } catch (error) {
      return { ok: false, reason: "error", error: artifactLockAcquisitionError(error) };
    }
    try {
      result = await artifactLockModule.acquireArtifactLock({ artifactPath, owner });
    } catch (error) {
      return { ok: false, reason: "error", error: artifactLockAcquisitionError(error) };
    }
  }
  return result;
}

function normalizedSelector(value: string): string {
  return path.posix.normalize(value.replace(/\\/g, "/"));
}

async function resolveReclassificationTarget(root: ProjectRoot, input: WorkflowMutationInput): Promise<
  | { ok: true; path: string; recordType: "pipeline" | "worklog" }
  | { ok: false; filePath: string; diagnostics: Diagnostic[]; message: string }
> {
  const requestedKind = input.recordType;
  if (requestedKind !== "pipeline" && requestedKind !== "worklog") {
    return { ok: false, filePath: input.path ?? input.jsonlPath ?? "-", diagnostics: [reclassificationDiagnostic("Unknown workflow record type", { path: input.path ?? input.jsonlPath, reason: "unknown" })], message: "Unknown workflow record type" };
  }
  const selector = input.path ?? input.jsonlPath;
  const resolved = await resolveWorkflowArtifacts(root, {
    ...(selector ? { explicitPath: selector } : {}),
    kind: requestedKind,
    allowAmbiguous: false
  });
  if (resolved.selected) {
    if (resolved.selected.legacy) {
      return { ok: false, filePath: resolved.selected.relativePath, diagnostics: [reclassificationDiagnostic("Legacy workflow artifacts cannot be reclassified", { path: resolved.selected.relativePath, reason: "legacy" })], message: "Legacy workflow artifacts cannot be reclassified" };
    }
    return { ok: true, path: resolved.selected.relativePath, recordType: requestedKind };
  }
  if (resolved.diagnostics.some((item) => item.code === "SRS-E050" || item.code === "SRS-E051")) {
    return { ok: false, filePath: selector ?? "-", diagnostics: resolved.diagnostics, message: "Workflow artifact resolution failed" };
  }
  if (selector) {
    const actual = await resolveWorkflowArtifacts(root, { explicitPath: selector, allowAmbiguous: false });
    const selected = actual.selected;
    if (selected && (selected.kind === "pipeline" || selected.kind === "worklog")) {
      return {
        ok: false,
        filePath: selected.relativePath,
        diagnostics: [reclassificationDiagnostic("Workflow artifact kind does not match recordType", { path: selected.relativePath, requestedKind, actualKind: selected.kind })],
        message: "Workflow artifact kind does not match recordType"
      };
    }
    return { ok: false, filePath: normalizedSelector(selector), diagnostics: [reclassificationDiagnostic("Unknown workflow artifact", { path: normalizedSelector(selector), reason: selected?.legacy ? "legacy" : "unknown" })], message: "Unknown workflow artifact" };
  }
  return { ok: false, filePath: "-", diagnostics: [reclassificationDiagnostic("Workflow artifact resolution is ambiguous", { reason: "ambiguous" }, "SRS-E051")], message: "Workflow artifact resolution is ambiguous" };
}

function identityMismatch(
  input: WorkflowMutationInput,
  target: WorkflowJsonlEntry,
  pathValue: string,
  recordType: "pipeline" | "worklog",
  validPreimagePrefixSha256: boolean
): string | null {
  const expected: ReclassificationTargetIdentity = {
    path: pathValue,
    recordType,
    line: target.line,
    byteOffset: target.byteOffset,
    rawSha256: sha256Text(target.raw),
    eventKey: target.eventKey,
    targetRunId: String(target.event.run_id),
    preimagePrefixSha256: input.preimagePrefixSha256 ?? ""
  };
  const supplied: Record<keyof ReclassificationTargetIdentity, unknown> = {
    path: input.path ? normalizedSelector(input.path) : pathValue,
    recordType: input.recordType,
    line: input.line,
    byteOffset: input.byteOffset,
    rawSha256: input.rawSha256,
    eventKey: input.eventKey,
    targetRunId: input.targetRunId,
    preimagePrefixSha256: input.preimagePrefixSha256
  };
  for (const key of Object.keys(expected) as Array<keyof ReclassificationTargetIdentity>) {
    if (key === "preimagePrefixSha256") continue;
    if (supplied[key] !== expected[key]) return key;
  }
  if (typeof input.preimagePrefixSha256 !== "string" || !validPreimagePrefixSha256) {
    return "preimagePrefixSha256";
  }
  return null;
}

async function applyWorkflowRecordReclassification(root: ProjectRoot, input: WorkflowMutationInput): Promise<MutationResult<WorkflowMutationOutput>> {
  if (!input.reason || input.reason.length === 0) {
    const identity = identityFor(input);
    return failWithEnvelope(input, input.path ?? input.jsonlPath ?? "-", identity, [reclassificationDiagnostic("Record reclassification requires a non-empty reason", { field: "reason" })], "Record reclassification requires a reason", null);
  }
  const resolution = await resolveReclassificationTarget(root, input);
  if (!resolution.ok) {
    return failWithEnvelope(input, resolution.filePath, identityFor(input), resolution.diagnostics, resolution.message, null);
  }
  const absolutePath = await resolveInsideRoot(root.root, resolution.path);
  const execute = async (): Promise<MutationResult<WorkflowMutationOutput>> => {
    const parsed = await workflowJsonl.parseWorkflowJsonl(root, resolution.path);
    const sha256 = parsed.sha256 ?? sha256Text("");
    const currentBytes = await readFile(parsed.absolutePath);
    const currentBytesSha256 = sha256Bytes(currentBytes);
    if (currentBytesSha256 !== sha256) {
      const staleGuard = { filePath: resolution.path, retry: "rerun record reclassification preview" };
      return failWithEnvelope(
        input,
        resolution.path,
        identityFor(input),
        [staleDiagnostic(resolution.path, sha256, currentBytesSha256)],
        "Workflow artifact changed while record reclassification was being prepared",
        null,
        staleGuard
      );
    }
    const candidates = parsed.entries.filter((entry) => {
      const correctsRunId = entry.event.corrects_run_id;
      return entry.event.status === "CORRECTION" && !(typeof correctsRunId === "string" && correctsRunId.trim().length > 0);
    });
    if (candidates.length !== 1) {
      const diagnostics = [...parsed.diagnostics, reclassificationDiagnostic("Workflow reclassification target is duplicate or ambiguous", { path: resolution.path, line: input.line })];
      return failWithEnvelope(input, resolution.path, identityFor(input), diagnostics, "Workflow reclassification target is duplicate or ambiguous", null);
    }
    const target = candidates[0]!;
    const overlaysForTarget = parsed.entries.filter((entry) => {
      const operationValue = entry.event.operation;
      if (typeof operationValue !== "object" || operationValue === null || Array.isArray(operationValue)) return false;
      const operationRecord = operationValue as Record<string, unknown>;
      return operationRecord.kind === "record_reclassification" && operationRecord.source_path === resolution.path && operationRecord.source_line === target.line;
    });
    const validPreimagePrefixSha256 = typeof input.preimagePrefixSha256 === "string"
      && isJsonlLineBoundaryPrefixHash(currentBytes, input.preimagePrefixSha256);
    const mismatch = identityMismatch(input, target, resolution.path, resolution.recordType, validPreimagePrefixSha256);
    if (mismatch) {
      return failWithEnvelope(input, resolution.path, identityFor(input), [reclassificationDiagnostic(`Workflow reclassification ${mismatch} identity mismatch`, { field: mismatch }, "SRS-E072")], `Workflow reclassification ${mismatch} identity mismatch`, null);
    }
    const targetIdentity: ReclassificationTargetIdentity = {
      path: resolution.path,
      recordType: resolution.recordType,
      line: target.line,
      byteOffset: target.byteOffset,
      rawSha256: sha256Text(target.raw),
      eventKey: target.eventKey,
      targetRunId: String(target.event.run_id),
      preimagePrefixSha256: input.preimagePrefixSha256 ?? ""
    };
    const identity = reclassificationIdentity(input, targetIdentity);
    if (input.idempotencyKey && input.idempotencyKey !== identity.idempotencyKey) {
      return failWithEnvelope(input, resolution.path, identity, [diagnostic("SRS-E072", "error", "Workflow idempotency key is incompatible with canonical journal identity", {}, { supplied: input.idempotencyKey, canonical: identity.idempotencyKey })], "Workflow idempotency key is incompatible with canonical journal identity", null);
    }
    const overlay = reclassificationOverlay(input, targetIdentity, identity);
    const overlayLine = JSON.stringify(overlay);
    const pendingRepair = reclassificationPendingRepair(targetIdentity, overlay, overlayLine);
    const token = repairTokenFor(targetIdentity, identity, overlayLine, input.expectedSha256 ?? "", pendingRepair);
    const operation: MutationOperationDetail = { type: "appendLines", lineCount: 1, lines: [overlayLine] };
    const targetRecordValue = reclassificationTargetRecord(targetIdentity);

    if (!input.dryRun && !repairTokenMatches(input.repairToken, token)) {
      return failWithEnvelope(input, resolution.path, identity, [reclassificationDiagnostic("Invalid or non-matching record reclassification repairToken", { field: "repairToken" })], "Invalid record reclassification repairToken", pendingRepair);
    }

    const exactOverlay = parsed.entries.find((entry) => entry.raw === overlayLine);
    if (exactOverlay && target.effectiveRecordClass === "audit_note") {
      const completedOperations = [`confirm:${input.kind}`];
      const artifact = reclassificationArtifact(resolution.path, resolution.recordType, sha256);
      const diagnosticDelta = workflowDiagnosticDelta(parsed.diagnostics, parsed.diagnostics);
      const value = output({ kind: input.kind, written: false, identity, journalState: "confirmed", completedOperations, pendingOperations: [], pendingRepair: null, targetRecord: targetRecordValue, staleGuards: [], operations: [], artifact, diagnosticDelta });
      return withMutationEnvelope(mutationOk(value, parsed.diagnostics), envelope({ kind: input.kind, filePath: resolution.path, dryRun: false, written: false, operations: [], identity, journalState: "confirmed", completedOperations, pendingOperations: [], pendingRepair: null, targetRecord: targetRecordValue, staleGuards: [], artifact, diagnosticDelta }));
    }
    if (overlaysForTarget.length > 0) {
      return failWithEnvelope(input, resolution.path, identity, [reclassificationDiagnostic("Conflicting non-identical record reclassification overlay", { path: resolution.path, line: targetIdentity.line })], "Conflicting non-identical record reclassification overlay", null);
    }
    if (targetIdentity.preimagePrefixSha256 !== sha256) {
      if (input.expectedSha256 === targetIdentity.preimagePrefixSha256) {
        const staleGuard = { filePath: resolution.path, retry: "rerun record reclassification preview" };
        return failWithEnvelope(
          input,
          resolution.path,
          identity,
          [staleDiagnostic(resolution.path, input.expectedSha256, sha256)],
          "Workflow artifact snapshot is stale",
          pendingRepair,
          staleGuard
        );
      }
      return failWithEnvelope(
        input,
        resolution.path,
        identity,
        [reclassificationDiagnostic("Workflow reclassification historical preimage must match expectedSha256", { field: "preimagePrefixSha256" }, "SRS-E072")],
        "Workflow reclassification historical preimage is incompatible with the current expectedSha256",
        null
      );
    }
    const allowedTargetDiagnostic = (item: Diagnostic): boolean => {
      const details = typeof item.details === "object" && item.details !== null && !Array.isArray(item.details)
        ? item.details as Record<string, unknown>
        : null;
      return item.code === "SRS-W054" && item.filePath === resolution.path && item.line === targetIdentity.line && details?.reason === "missing correction target";
    };
    const blockingDiagnostics = parsed.diagnostics.filter((item) => !allowedTargetDiagnostic(item) && item.code !== "SRS-W056");
    if (blockingDiagnostics.length > 0) {
      return failWithEnvelope(input, resolution.path, identity, parsed.diagnostics, "Workflow reclassification refuses unrelated diagnostics", null);
    }
    if (target.event.status !== "CORRECTION" || (typeof target.event.corrects_run_id === "string" && target.event.corrects_run_id.trim().length > 0)) {
      return failWithEnvelope(input, resolution.path, identity, [reclassificationDiagnostic("Target is not a targetless CORRECTION", { path: resolution.path, line: targetIdentity.line })], "Target is not a targetless CORRECTION", null);
    }
    if (input.dryRun) {
      const pendingOperations = [`write:${input.kind}`];
      const predictedDiagnostics = parsed.diagnostics.filter((item) => !allowedTargetDiagnostic(item));
      const artifact = reclassificationArtifact(resolution.path, resolution.recordType, sha256);
      const diagnosticDelta = workflowDiagnosticDelta(parsed.diagnostics, predictedDiagnostics);
      const value = output({ kind: input.kind, written: false, identity, journalState: "skipped_dry_run", completedOperations: [], pendingOperations, pendingRepair, targetRecord: targetRecordValue, staleGuards: [], repairToken: token, operations: [operation], artifact, diagnosticDelta });
      return withMutationEnvelope(mutationOk(value, parsed.diagnostics), envelope({ kind: input.kind, filePath: resolution.path, dryRun: true, written: false, operations: [operation], identity, journalState: "skipped_dry_run", completedOperations: [], pendingOperations, pendingRepair, targetRecord: targetRecordValue, staleGuards: [], artifact, diagnosticDelta }));
    }
    if (input.expectedSha256 !== sha256) {
      const staleGuard = { filePath: resolution.path, retry: "rerun record reclassification preview" };
      return failWithEnvelope(input, resolution.path, identity, [staleDiagnostic(resolution.path, input.expectedSha256 ?? "", sha256)], "Workflow artifact snapshot is stale", pendingRepair, staleGuard);
    }
    const guardedBytes = await readFile(absolutePath);
    const guardedSha256 = sha256Bytes(guardedBytes);
    if (guardedSha256 !== sha256) {
      const staleGuard = { filePath: resolution.path, retry: "rerun record reclassification preview" };
      return failWithEnvelope(input, resolution.path, identity, [staleDiagnostic(resolution.path, sha256, guardedSha256)], "Workflow artifact changed before guarded append", pendingRepair, staleGuard);
    }
    const prependLineFeed = currentBytes.length > 0 && currentBytes[currentBytes.length - 1] !== 0x0a;
    const appendPayload = Buffer.from(`${prependLineFeed ? "\n" : ""}${overlayLine}\n`, "utf8");
    try {
      await appendUtf8LineAndSync(absolutePath, overlayLine, prependLineFeed);
    } catch (error) {
      const durableBytes = await readFile(absolutePath);
      const artifact = reclassificationArtifact(resolution.path, resolution.recordType, sha256Bytes(durableBytes));
      const durableRepair = reclassificationConfirmationRepair(
        resolution.path,
        artifact.sha256,
        targetIdentity,
        `${String(overlay.skill)}|${String(overlay.run_id)}`
      );
      const diagnostics = [reclassificationDiagnostic("Record reclassification append durability requires confirmation", {
        path: resolution.path,
        operation: "append",
        code: typeof (error as NodeJS.ErrnoException).code === "string" ? (error as NodeJS.ErrnoException).code : "UNKNOWN",
        message: error instanceof Error ? error.message : String(error)
      })];
      const completedOperations = [`write:${input.kind}`];
      const pendingOperations = [`confirm:${input.kind}`];
      const mutation = envelope({ kind: input.kind, filePath: resolution.path, dryRun: false, written: false, operations: [operation], identity, journalState: "failed", completedOperations, pendingOperations, pendingRepair: durableRepair, targetRecord: targetRecordValue, staleGuards: [], artifact });
      const failedResult: MutationResult<WorkflowMutationOutput> = mutationFail("MUTATION_DENIED", "Record reclassification append durability requires confirmation", diagnostics);
      return withMutationEnvelope(failedResult, mutation);
    }
    let confirmed: Awaited<ReturnType<typeof workflowJsonl.parseWorkflowJsonl>>;
    try {
      confirmed = await workflowJsonl.parseWorkflowJsonl(root, resolution.path);
    } catch (error) {
      const artifact = reclassificationArtifact(
        resolution.path,
        resolution.recordType,
        sha256Bytes(Buffer.concat([currentBytes, appendPayload]))
      );
      const durableRepair = reclassificationConfirmationRepair(
        resolution.path,
        artifact.sha256,
        targetIdentity,
        `${String(overlay.skill)}|${String(overlay.run_id)}`
      );
      const diagnostics = [reclassificationDiagnostic("Authoritative record reclassification read-back failed", {
        path: resolution.path,
        error: error instanceof Error ? error.message : String(error)
      })];
      const completedOperations = [`write:${input.kind}`];
      const pendingOperations = [`confirm:${input.kind}`];
      const mutation = envelope({ kind: input.kind, filePath: resolution.path, dryRun: false, written: false, operations: [operation], identity, journalState: "failed", completedOperations, pendingOperations, pendingRepair: durableRepair, targetRecord: targetRecordValue, staleGuards: [], artifact });
      return withMutationEnvelope(mutationFail("MUTATION_DENIED", "Authoritative record reclassification read-back failed", diagnostics), mutation);
    }
    const durableOverlayCount = confirmed.entries.filter((entry) => entry.raw === overlayLine).length;
    const targetWarning = confirmed.diagnostics.some((item) => allowedTargetDiagnostic(item));
    const confirmationDiagnostics = confirmed.diagnostics.filter((item) => item.code !== "SRS-W056");
    const confirmedTarget = confirmed.entries.find((entry) => entry.line === targetIdentity.line);
    if (durableOverlayCount !== 1 || targetWarning || confirmationDiagnostics.length > 0 || !confirmedTarget || confirmedTarget.effectiveRecordClass !== "audit_note" || confirmed.latestEntries.includes(confirmedTarget)) {
      const completedOperations = [`write:${input.kind}`];
      const pendingOperations = [`confirm:${input.kind}`];
      const artifact = reclassificationArtifact(resolution.path, resolution.recordType, confirmed.sha256 ?? sha256Text(""));
      const durableRepair = reclassificationConfirmationRepair(
        resolution.path,
        artifact.sha256,
        targetIdentity,
        `${String(overlay.skill)}|${String(overlay.run_id)}`
      );
      const diagnosticDelta = workflowDiagnosticDelta(parsed.diagnostics, confirmed.diagnostics);
      const mutation = envelope({ kind: input.kind, filePath: resolution.path, dryRun: false, written: false, operations: [operation], identity, journalState: "failed", completedOperations, pendingOperations, pendingRepair: durableRepair, targetRecord: targetRecordValue, staleGuards: [], artifact, diagnosticDelta });
      return withMutationEnvelope(mutationFail("MUTATION_DENIED", "Authoritative record reclassification read-back failed", confirmed.diagnostics), mutation);
    }
    const completedOperations = [`write:${input.kind}`, `confirm:${input.kind}`];
    const artifact = reclassificationArtifact(resolution.path, resolution.recordType, confirmed.sha256 ?? sha256Text(""));
    const diagnosticDelta = workflowDiagnosticDelta(parsed.diagnostics, confirmed.diagnostics);
    const value = output({ kind: input.kind, written: true, identity, journalState: "confirmed", completedOperations, pendingOperations: [], pendingRepair: null, targetRecord: targetRecordValue, staleGuards: [], operations: [operation], artifact, diagnosticDelta });
    return withMutationEnvelope(mutationOk(value, confirmed.diagnostics), envelope({ kind: input.kind, filePath: resolution.path, dryRun: false, written: true, operations: [operation], identity, journalState: "confirmed", completedOperations, pendingOperations: [], pendingRepair: null, targetRecord: targetRecordValue, staleGuards: [], artifact, diagnosticDelta }));
  };

  if (input.dryRun) return execute();

  const lockIdentity = await artifactLockModule.resolveArtifactLockIdentity(absolutePath);
  const retained = retainedReclassificationCleanup.get(lockIdentity.canonicalPath);
  let cleanupCompleted = false;
  if (retained) {
    const operationIdentitySha256 = reclassificationOperationIdentity(input);
    if (!repairTokenMatches(input.repairToken, retained.repairToken) ||
        !repairTokenMatches(operationIdentitySha256, retained.operationIdentitySha256)) {
      return failWithEnvelope(
        input,
        resolution.path,
        identityFor(input),
        [reclassificationDiagnostic("Invalid retained record reclassification cleanup retry", {
          field: "repairToken",
          reason: "retained operation identity mismatch"
        })],
        "Invalid record reclassification repairToken",
        null
      );
    }
    retainedReclassificationCleanup.delete(lockIdentity.canonicalPath);
    const cleanup = await artifactLockModule.retryRetainedArtifactLockCleanup(lockIdentity.canonicalPath);
    if (!cleanup.ok || !cleanup.released) {
      retainedReclassificationCleanup.set(lockIdentity.canonicalPath, retained);
      return retained.failure;
    }
    cleanupCompleted = true;
  }

  const acquired = await acquireReclassificationArtifactLock(absolutePath, input.owner);
  if (!acquired.ok) {
    if (acquired.reason === "error") {
      const code = typeof acquired.error.code === "string" ? acquired.error.code : "UNKNOWN";
      return failWithEnvelope(
        input,
        resolution.path,
        identityFor(input),
        [artifactLockDiagnostic("Workflow artifact lock acquisition failed", resolution.path, {
          operation: "acquire",
          code,
          message: acquired.error.message
        })],
        "Workflow artifact lock acquisition failed",
        null
      );
    }
    return failWithEnvelope(
      input,
      resolution.path,
      identityFor(input),
      [artifactLockDiagnostic("Workflow artifact mutation lock is held", resolution.path, {
        holderOwnerIdentitySha256: acquired.holder?.ownerIdentitySha256
      })],
      "Workflow artifact mutation lock is unavailable",
      null
    );
  }

  let result: MutationResult<WorkflowMutationOutput>;
  try {
    result = await execute();
  } catch (error) {
    await artifactLockModule.releaseArtifactLock(acquired.capability);
    throw error;
  }
  if (cleanupCompleted) result = prependCompletedOperation(result, `cleanup:${input.kind}`);
  const released: ReleaseArtifactLockResult = await artifactLockModule.releaseArtifactLock(acquired.capability);
  if (released.ok && released.released) return result;

  if (!released.ok) {
    const artifact = result.value?.artifact ?? result.mutation?.artifact as WorkflowMutationArtifact | undefined;
    const completedOperations = result.mutation?.completedOperations ?? result.value?.completedOperations ?? [];
    if (!artifact || !completedOperations.includes(`write:${input.kind}`)) {
      return result;
    }
    const cleanupDiagnostic = released.cleanupDiagnostic;
    const pendingRepair = reclassificationCleanupRepair(
      root,
      resolution.path,
      artifact.sha256,
      acquired.capability,
      cleanupDiagnostic
    );
    const pendingOperations = [
      ...(result.mutation?.pendingOperations ?? result.value?.pendingOperations ?? []),
      `cleanup:${input.kind}`
    ];
    const diagnostics = [artifactLockDiagnostic("Record reclassification lock cleanup failed", resolution.path, {
      ownerIdentitySha256: acquired.capability.ownerIdentitySha256,
      cleanupDiagnostic
    })];
    const cleanupTargetRecord = result.value?.targetRecord
      ?? result.mutation?.targetRecord as Record<string, unknown> | undefined
      ?? targetRecord(input);
    const failureMutation = envelope({
      kind: input.kind,
      filePath: resolution.path,
      dryRun: false,
      written: false,
      operations: result.mutation?.operations ?? [],
      identity: identityFor(input),
      journalState: "failed",
      completedOperations,
      pendingOperations,
      pendingRepair,
      targetRecord: cleanupTargetRecord,
      staleGuards: [],
      artifact,
      ...(result.value?.diagnosticDelta ? { diagnosticDelta: result.value.diagnosticDelta } : {})
    });
    const failedResult: MutationResult<WorkflowMutationOutput> = mutationFail(
      "MUTATION_DENIED",
      "Record reclassification lock cleanup failed",
      diagnostics
    );
    const failure = withMutationEnvelope(
      failedResult,
      failureMutation
    );
    retainedReclassificationCleanup.set(lockIdentity.canonicalPath, {
      capability: acquired.capability,
      failure,
      operationIdentitySha256: reclassificationOperationIdentity(input),
      repairToken: input.repairToken ?? ""
    });
    return failure;
  }

  const cleanupDiagnostic = { code: released.reason, message: "Record reclassification lock was not released" };
  return failWithEnvelope(
    input,
    resolution.path,
    identityFor(input),
    [artifactLockDiagnostic("Record reclassification lock cleanup failed", resolution.path, {
      ownerIdentitySha256: acquired.capability.ownerIdentitySha256,
      cleanupDiagnostic
    })],
    "Record reclassification lock cleanup failed",
    null
  );
}

function logicalDeleteDiagnostic(message: string, details: Record<string, unknown>): Diagnostic {
  return diagnostic("SRS-E073", "error", message, {}, details);
}

function logicalDeleteTargetRecord(input: WorkflowMutationInput, tombstoneRunId?: string): Record<string, unknown> {
  return {
    ...targetRecord(input),
    desiredState: "deleted",
    ...(tombstoneRunId ? { tombstoneRunId } : {})
  };
}

function isDeletableJsonlRecordType(recordType: string | undefined): boolean {
  return recordType === "pipeline_event" || recordType === "worklog_event" || recordType === "repair_record";
}

function logicalDeleteTombstoneRunId(identity: WorkflowJournalIdentity): string {
  return `del-${identity.journalKey.slice(0, 24)}`;
}

function logicalDeleteFail(
  input: WorkflowMutationInput,
  identity: WorkflowJournalIdentity,
  diagnostics: Diagnostic[],
  message: string,
  pendingRepair: WorkflowPendingRepair | null = null,
  staleGuard?: MutationStaleGuard
): MutationResult<WorkflowMutationOutput> {
  const mutation = envelope({
    kind: input.kind,
    filePath: input.jsonlPath ?? "-",
    dryRun: input.dryRun ?? false,
    written: false,
    operations: [],
    identity,
    journalState: "failed",
    completedOperations: [],
    pendingOperations: [],
    pendingRepair,
    targetRecord: logicalDeleteTargetRecord(input),
    staleGuards: staleGuard ? [staleGuard] : []
  });
  return withMutationEnvelope(mutationFail(staleGuard ? "STALE_PATCH" : "MUTATION_DENIED", message, diagnostics, staleGuard ? { staleGuard } : {}), mutation);
}

function isCorrectionOrTombstone(entry: WorkflowJsonlEntry): boolean {
  return entry.event.status === "CORRECTION";
}

async function applyLogicalDeleteMutation(root: ProjectRoot, input: WorkflowMutationInput, identity: WorkflowJournalIdentity): Promise<MutationResult<WorkflowMutationOutput>> {
  const filePath = input.jsonlPath;
  if (!filePath || !input.recordType || !input.recordId) {
    const diagnostics = [usageDiagnostic(input.kind, "Workflow logical-delete requires jsonlPath, recordType, and recordId")];
    return logicalDeleteFail(input, identity, diagnostics, "Workflow logical-delete requires jsonlPath, recordType, and recordId");
  }
  if (!isDeletableJsonlRecordType(input.recordType)) {
    const diagnostics = [logicalDeleteDiagnostic("Workflow record class is not deletable", { recordType: input.recordType, recordId: input.recordId })];
    return logicalDeleteFail(input, identity, diagnostics, "Workflow record class is not deletable");
  }

  const execute = async (): Promise<MutationResult<WorkflowMutationOutput>> => {
  const parsed = await workflowJsonl.parseWorkflowJsonl(root, filePath, { includeDeleted: true });
  if (input.expectedSha256 && parsed.sha256 && input.expectedSha256 !== parsed.sha256) {
    const staleGuard = { filePath, retry: "rerun workflow logical-delete with fresh source hash" };
    const diagnostics = [staleDiagnostic(filePath, input.expectedSha256, parsed.sha256)];
    const pendingRepair = { kind: "rerun_with_fresh_artifact", message: "Workflow logical-delete saw a stale source hash", retry: staleGuard.retry, staleGuard };
    return logicalDeleteFail(input, identity, diagnostics, "Workflow artifact snapshot is stale", pendingRepair, staleGuard);
  }
  if (parsed.invalidLines.length > 0) {
    return logicalDeleteFail(input, identity, parsed.diagnostics, "Workflow logical-delete requires valid JSONL", { kind: "repair_malformed_jsonl", message: "Repair malformed workflow JSONL before deleting records", retry: "repair JSONL and retry" });
  }

  const target = parsed.tail.find((entry) => entry.event.run_id === input.recordId);
  if (!target) {
    const diagnostics = [logicalDeleteDiagnostic("Workflow record was not found", { recordType: input.recordType, recordId: input.recordId })];
    return logicalDeleteFail(input, identity, diagnostics, "Workflow record was not found");
  }
  if (isCorrectionOrTombstone(target)) {
    const diagnostics = [logicalDeleteDiagnostic("Workflow correction or tombstone records are not deletable", { recordType: input.recordType, recordId: input.recordId })];
    return logicalDeleteFail(input, identity, diagnostics, "Workflow correction or tombstone records are not deletable");
  }
  if (target.event.status === "DELETED") {
    const diagnostics = [logicalDeleteDiagnostic("Workflow status=DELETED records are invalid and cannot be deleted", { recordType: input.recordType, recordId: input.recordId })];
    return logicalDeleteFail(input, identity, diagnostics, "Workflow status=DELETED records are invalid and cannot be deleted");
  }
  if (target.deletedBy && target.deletedBy.length > 0) {
    const completedOperations = [`confirm:${input.kind}`];
    const value = output({
      kind: input.kind,
      written: false,
      identity,
      journalState: "confirmed",
      completedOperations,
      pendingOperations: [],
      pendingRepair: null,
      targetRecord: logicalDeleteTargetRecord(input, target.deletedBy[0]),
      staleGuards: []
    });
    return withMutationEnvelope(
      mutationOk(value, parsed.diagnostics),
      envelope({
        kind: input.kind,
        filePath,
        dryRun: input.dryRun ?? false,
        written: false,
        operations: [],
        identity,
        journalState: "confirmed",
        completedOperations,
        pendingOperations: [],
        pendingRepair: null,
        targetRecord: logicalDeleteTargetRecord(input, target.deletedBy[0]),
        staleGuards: []
      })
    );
  }

  const tombstoneRunId = logicalDeleteTombstoneRunId(identity);
  const event: WorkflowJsonlEvent = {
    ts: new Date().toISOString(),
    schema_version: "1.0.0",
    skill: "speckiwi",
    run_id: tombstoneRunId,
    status: "CORRECTION",
    corrects_run_id: input.recordId!,
    operation: {
      kind: "logical_delete",
      record_type: input.recordType!,
      record_id: input.recordId!,
      desired_state: "deleted",
      owner: input.owner,
      reason: input.reason ?? "",
      journal_key: identity.journalKey,
      source_path: filePath,
      source_sha256: parsed.sha256 ?? null
    },
    workflow_run_id: input.runId,
    journal_key: identity.journalKey,
    idempotency_key: input.idempotencyKey ?? identity.idempotencyKey,
    journal_state: input.dryRun ? "skipped_dry_run" : "planned",
    owner: input.owner,
    reason: input.reason ?? ""
  };
  const appended = await workflowJsonl.appendWorkflowJsonl(root, filePath, event, {
    policy: "halt",
    ...(input.dryRun !== undefined ? { dryRun: input.dryRun } : {}),
    ...(input.expectedSha256 ? { expectedSha256: input.expectedSha256 } : {})
  });
  if (!appended.ok) {
    const staleGuard = appended.error?.staleGuard;
    const pendingRepair = staleGuard ? { kind: "rerun_with_fresh_artifact", message: "Workflow logical-delete append saw a stale source hash", retry: staleGuard.retry, staleGuard } : { kind: "repair_logical_delete", message: appended.error?.message ?? "Workflow logical-delete append failed", retry: "repair workflow JSONL diagnostics and retry" };
    return logicalDeleteFail(input, identity, appended.diagnostics, appended.error?.message ?? "Workflow logical-delete append failed", pendingRepair, staleGuard);
  }
  const journalState: WorkflowJournalState = input.dryRun ? "skipped_dry_run" : "confirmed";
  const pendingOperations = input.dryRun ? [`write:${input.kind}`] : [];
  const completedOperations = input.dryRun ? [] : [`write:${input.kind}`, `confirm:${input.kind}`];
  const operations = appended.mutation?.operations ?? [];
  const record = logicalDeleteTargetRecord(input, tombstoneRunId);
  const value = output({
    kind: input.kind,
    written: appended.value?.written ?? false,
    identity,
    journalState,
    completedOperations,
    pendingOperations,
    pendingRepair: null,
    targetRecord: record,
    staleGuards: []
  });
  return withMutationEnvelope(
    mutationOk(value, appended.diagnostics),
    envelope({ kind: input.kind, filePath, dryRun: input.dryRun ?? false, written: appended.value?.written ?? false, operations, identity, journalState, completedOperations, pendingOperations, pendingRepair: null, targetRecord: record, staleGuards: [] })
  );
  };

  if (input.dryRun) return execute();
  return runLockedJsonlMutation(root, input, filePath, identity, logicalDeleteTargetRecord(input), execute);
}

// @req FR-NODE-030
export async function applyWorkflowMutation(root: ProjectRoot, input: WorkflowMutationInput): Promise<MutationResult<WorkflowMutationOutput>> {
  const identity = identityFor(input);
  if (isForbiddenOwner(input)) {
    return failWithEnvelope(input, input.planPath ?? input.pmStatePath ?? input.jsonlPath ?? "-", identity, [ownerDiagnostic(input.kind, input.owner)], "Workflow mutation owner is not allowed for this operation", null);
  }
  if (input.idempotencyKey && input.idempotencyKey !== identity.idempotencyKey) {
    const diagnostics = [diagnostic("SRS-E072", "error", "Workflow idempotency key is incompatible with canonical journal identity", {}, { supplied: input.idempotencyKey, canonical: identity.idempotencyKey })];
    return failWithEnvelope(input, input.planPath ?? input.pmStatePath ?? input.jsonlPath ?? "-", identity, diagnostics, "Workflow idempotency key is incompatible with canonical journal identity", null);
  }
  switch (input.kind) {
    case "plan_checkbox_check":
    case "plan_checkbox_uncheck":
    case "plan_checklist_item_update":
      return applyCheckboxMutation(root, input, identity);
    case "pm_task_status_update":
      return applyPmTaskStatusMutation(root, input, identity);
    case "pipeline_event_append":
    case "worklog_event_append":
    case "workflow_repair_record":
      return applyJsonlAppendMutation(root, input, identity);
    case "workflow_record_reclassification":
      return applyWorkflowRecordReclassification(root, input);
    case "workflow_logical_delete":
      return applyLogicalDeleteMutation(root, input, identity);
    default: {
      const diagnostics = [usageDiagnostic(input.kind, `Unsupported workflow mutation kind: ${String(input.kind)}`)];
      return failWithEnvelope(input, "-", identity, diagnostics, "Unsupported workflow mutation kind", null);
    }
  }
}
