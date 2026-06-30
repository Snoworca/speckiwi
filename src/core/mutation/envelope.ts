import type { MutationEnvelope, MutationOperationDetail, MutationResult, PatchSummary } from "../types.js";
import type { PatchOperation, PatchPlan } from "../patch/patch-plan.js";

function operationLineCount(operation: PatchOperation): number | undefined {
  if (operation.type === "replaceLine") return 1;
  if (operation.type === "insertLines" || operation.type === "appendLines" || operation.type === "replaceRange") return operation.lines.length;
  return undefined;
}

// @req FR-NODE-017
export function describePatchOperation(operation: PatchOperation): MutationOperationDetail {
  const lineCount = operationLineCount(operation);
  const detail: MutationOperationDetail = {
    type: operation.type,
    ...(lineCount !== undefined ? { lineCount } : {})
  };
  if ("line" in operation) detail.line = operation.line;
  if ("startLine" in operation) detail.startLine = operation.startLine;
  if ("endLine" in operation) detail.endLine = operation.endLine;
  if ("original" in operation && operation.original !== undefined) detail.original = operation.original;
  if ("replacement" in operation) detail.replacement = operation.replacement;
  if ("lines" in operation) detail.lines = operation.lines;
  if ("expectedBefore" in operation && operation.expectedBefore !== undefined) detail.expectedBefore = operation.expectedBefore;
  if ("expectedAfter" in operation && operation.expectedAfter !== undefined) detail.expectedAfter = operation.expectedAfter;
  if ("expectedLastLine" in operation && operation.expectedLastLine !== undefined) detail.expectedLastLine = operation.expectedLastLine;
  return detail;
}

// @req FR-NODE-017
export function previewPatchOperations(operations: readonly PatchOperation[]): string[] {
  return operations.flatMap((operation) => {
    if (operation.type === "replaceLine") return [operation.replacement];
    if (operation.type === "insertLines" || operation.type === "appendLines" || operation.type === "replaceRange") return operation.lines;
    return [];
  });
}

// @req FR-NODE-017
export function mutationEnvelopeFromPlan(kind: string, plan: PatchPlan, dryRun: boolean, written: boolean): MutationEnvelope {
  return {
    kind,
    filePath: plan.file.relativePath,
    dryRun,
    written,
    operations: plan.operations.map(describePatchOperation),
    preview: previewPatchOperations(plan.operations)
  };
}

// @req FR-NODE-017
export function mutationNoopEnvelope(kind: string, filePath: string, dryRun: boolean): MutationEnvelope {
  return {
    kind,
    filePath,
    dryRun,
    written: false,
    operations: [],
    preview: []
  };
}

// @req FR-NODE-017
export function patchSummaryFromPlan(plan: PatchPlan, dryRun: boolean): PatchSummary {
  return {
    filePath: plan.file.relativePath,
    operations: plan.operations.length,
    dryRun,
    preview: previewPatchOperations(plan.operations)
  };
}

// @req FR-NODE-017
export function withMutationEnvelope<T>(result: MutationResult<T>, mutation: MutationEnvelope, patch?: PatchSummary): MutationResult<T> {
  return {
    ...result,
    mutation,
    ...(patch ? { patch } : {})
  };
}
