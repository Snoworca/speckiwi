import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { diagnostic } from "../diagnostic.js";
import { resolveInsideRoot } from "../fs/safe-path.js";
import { mutationFail, mutationOk } from "../mutation/guards.js";
import { withMutationEnvelope } from "../mutation/envelope.js";
import type { Diagnostic, MutationEnvelope, MutationOperationDetail, MutationResult, MutationStaleGuard, ProjectRoot } from "../types.js";
import { appendWorkflowJsonl, parseWorkflowJsonl, type WorkflowJsonlEntry, type WorkflowJsonlEvent } from "./jsonl.js";

export const EMPTY_WORKFLOW_REQ_TOKEN = "<none>";

export type WorkflowMutationKind =
  | "plan_checkbox_check"
  | "plan_checkbox_uncheck"
  | "plan_checklist_item_update"
  | "pm_task_status_update"
  | "pipeline_event_append"
  | "worklog_event_append"
  | "workflow_repair_record"
  | "workflow_logical_delete";

export type WorkflowJournalState = "planned" | "applied" | "confirmed" | "failed" | "skipped_dry_run";

export interface WorkflowJournalIdentityInput {
  tool: string;
  runId: string;
  taskId?: string;
  reqId?: string;
  args?: Record<string, unknown>;
}

export interface WorkflowJournalIdentity {
  journalKey: string;
  idempotencyKey: string;
  reqIdToken: string;
  canonicalArgs: string;
}

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
}

export interface WorkflowPendingRepair {
  kind: string;
  message: string;
  retry: string;
  staleGuard?: MutationStaleGuard;
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
}

type JsonObject = Record<string, unknown>;

function isPlainObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => (item === undefined ? null : canonicalValue(item)));
  if (!isPlainObject(value)) return value;
  const result: JsonObject = {};
  for (const key of Object.keys(value).sort()) {
    const child = value[key];
    if (child === undefined) continue;
    result[key] = canonicalValue(child);
  }
  return result;
}

// @req FR-NODE-028
export function canonicalWorkflowJson(value: Record<string, unknown> = {}): string {
  return JSON.stringify(canonicalValue(value));
}

// @req FR-NODE-028
export function workflowJournalIdentity(input: WorkflowJournalIdentityInput): WorkflowJournalIdentity {
  const reqIdToken = input.reqId && input.reqId.length > 0 ? input.reqId : EMPTY_WORKFLOW_REQ_TOKEN;
  const taskId = input.taskId ?? "";
  const canonicalArgs = canonicalWorkflowJson(input.args ?? {});
  const material = `${input.tool}|${input.runId}|${taskId}|${reqIdToken}|${canonicalArgs}`;
  const journalKey = createHash("sha256").update(material).digest("hex");
  return { journalKey, idempotencyKey: journalKey, reqIdToken, canonicalArgs };
}

function sha256Text(text: string): string {
  return createHash("sha256").update(text).digest("hex");
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
    staleGuards: input.staleGuards
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
    staleGuards: input.staleGuards
  };
}

function identityFor(input: WorkflowMutationInput): WorkflowJournalIdentity {
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
    ...(input.recordId ? { recordId: input.recordId, desiredState: "deleted" } : {})
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

async function applyJsonlAppendMutation(root: ProjectRoot, input: WorkflowMutationInput, identity: WorkflowJournalIdentity): Promise<MutationResult<WorkflowMutationOutput>> {
  const filePath = input.jsonlPath;
  if (!filePath || !input.event) {
    const diagnostics = [usageDiagnostic(input.kind, "Workflow JSONL mutation requires jsonlPath and event")];
    return failWithEnvelope(input, filePath ?? "-", identity, diagnostics, "Workflow JSONL mutation requires jsonlPath and event", null);
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
  const parsed = await parseWorkflowJsonl(root, filePath);
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
  const appended = await appendWorkflowJsonl(root, filePath, event, {
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

  const parsed = await parseWorkflowJsonl(root, filePath, { includeDeleted: true });
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
    corrects_run_id: input.recordId,
    operation: {
      kind: "logical_delete",
      record_type: input.recordType,
      record_id: input.recordId,
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
  const appended = await appendWorkflowJsonl(root, filePath, event, {
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
    case "workflow_logical_delete":
      return applyLogicalDeleteMutation(root, input, identity);
    default: {
      const diagnostics = [usageDiagnostic(input.kind, `Unsupported workflow mutation kind: ${String(input.kind)}`)];
      return failWithEnvelope(input, "-", identity, diagnostics, "Unsupported workflow mutation kind", null);
    }
  }
}
