import type { TextFile } from "../types.js";

export type PatchOperation =
  | { type: "replaceLine"; line: number; original?: string; replacement: string }
  | { type: "insertLines"; line: number; lines: string[]; expectedBefore?: string; expectedAfter?: string }
  | { type: "appendLines"; lines: string[]; expectedLastLine?: string }
  | { type: "replaceRange"; startLine: number; endLine: number; lines: string[] };

export interface PatchPlan {
  file: TextFile;
  operations: PatchOperation[];
}

export function createPatchPlan(file: TextFile, operations: PatchOperation[]): PatchPlan {
  return { file, operations };
}

function assertLineMatches(actual: string | undefined, expected: string, description: string): void {
  if (actual !== expected) {
    throw new Error(`Stale patch: expected ${description} to be ${expected}`);
  }
}

function assertInsertPreconditions(sourceLines: string[], operation: Extract<PatchOperation, { type: "insertLines" }>): void {
  if (operation.expectedBefore !== undefined) {
    assertLineMatches(sourceLines[operation.line - 2], operation.expectedBefore, `line ${operation.line - 1}`);
  }
  if (operation.expectedAfter !== undefined) {
    assertLineMatches(sourceLines[operation.line - 1], operation.expectedAfter, `line ${operation.line}`);
  }
}

function assertAppendPreconditions(sourceLines: string[], operation: Extract<PatchOperation, { type: "appendLines" }>): void {
  if (operation.expectedLastLine !== undefined) {
    assertLineMatches(sourceLines.at(-1), operation.expectedLastLine, "last line");
  }
}

export function renderPatchedLines(plan: PatchPlan): string[] {
  const sourceLines = [...plan.file.lines];
  let lines = [...plan.file.lines];
  if (lines.at(-1) === "") {
    lines = lines.slice(0, -1);
  }
  const operations = [...plan.operations].sort((a, b) => {
    const lineA = "line" in a ? a.line : "startLine" in a ? a.startLine : Number.MAX_SAFE_INTEGER;
    const lineB = "line" in b ? b.line : "startLine" in b ? b.startLine : Number.MAX_SAFE_INTEGER;
    return lineB - lineA;
  });
  for (const operation of operations) {
    if (operation.type === "replaceLine") {
      const current = lines[operation.line - 1];
      if (operation.original !== undefined && current !== operation.original) {
        throw new Error(`Stale patch: expected line ${operation.line} to be ${operation.original}`);
      }
      lines[operation.line - 1] = operation.replacement;
    } else if (operation.type === "insertLines") {
      assertInsertPreconditions(sourceLines, operation);
      lines.splice(operation.line - 1, 0, ...operation.lines);
    } else if (operation.type === "appendLines") {
      assertAppendPreconditions(sourceLines, operation);
      lines.push(...operation.lines);
    } else {
      lines.splice(operation.startLine - 1, operation.endLine - operation.startLine + 1, ...operation.lines);
    }
  }
  return lines;
}
