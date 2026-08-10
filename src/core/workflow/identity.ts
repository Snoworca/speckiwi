import { createHash } from "node:crypto";

export const EMPTY_WORKFLOW_REQ_TOKEN = "<none>";

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

export function canonicalWorkflowJson(value: Record<string, unknown> = {}): string {
  return JSON.stringify(canonicalValue(value));
}

export function workflowJournalIdentity(input: WorkflowJournalIdentityInput): WorkflowJournalIdentity {
  const reqIdToken = input.reqId && input.reqId.length > 0 ? input.reqId : EMPTY_WORKFLOW_REQ_TOKEN;
  const taskId = input.taskId ?? "";
  const canonicalArgs = canonicalWorkflowJson(input.args ?? {});
  const material = `${input.tool}|${input.runId}|${taskId}|${reqIdToken}|${canonicalArgs}`;
  const journalKey = createHash("sha256").update(material).digest("hex");
  return { journalKey, idempotencyKey: journalKey, reqIdToken, canonicalArgs };
}

export function workflowRecordReclassificationRunId(journalKey: string): string {
  return `record-reclassification-${journalKey.slice(0, 16)}`;
}

export function isCanonicalWorkflowTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  const timestamp = new Date(value);
  return !Number.isNaN(timestamp.getTime()) && timestamp.toISOString() === value;
}

export function workflowRecordReclassificationProvenance(
  input: Omit<WorkflowJournalIdentityInput, "tool">
): WorkflowJournalIdentity & { overlayRunId: string } {
  const identity = workflowJournalIdentity({ tool: "workflow_record_reclassification", ...input });
  return { ...identity, overlayRunId: workflowRecordReclassificationRunId(identity.journalKey) };
}
