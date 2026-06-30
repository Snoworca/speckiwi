import path from "node:path";
import { readUtf8File } from "../fs/read-text.js";
import { applyPatchPlan } from "../patch/apply-patch.js";
import { createPatchPlan, type PatchOperation } from "../patch/patch-plan.js";
import { parseMarkdownTable } from "../parser/table.js";
import type { MutationResult, ProjectRoot, TextFile } from "../types.js";
import { mutationEnvelopeFromPlan, mutationNoopEnvelope, withMutationEnvelope } from "./envelope.js";
import { mutationFail, mutationOk } from "./guards.js";
import { withSrsMutationLock } from "./srs-lock.js";

/**
 * FR-MCP-019 — set_target_goal mutation core.
 * `reason` 정책 (update-status §AC-7) 과 동기화: max 500 UTF-16 + control char 거부.
 */
// eslint-disable-next-line no-control-regex
const CONTROL_CHAR_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F]/;
const MAX_GOAL_LENGTH = 500;
const TARGET_HEADING_RE = /^### Target:\s+(\S+)\s*$/;
const GOAL_LABEL_RE = /^\*\*Goal:\*\*\s*(.+)$/;

export interface SetTargetGoalInput {
  target: string;
  goal: string;
  dryRun?: boolean;
  ignoreLock?: boolean;
  skipLock?: boolean;
}

export interface SetTargetGoalOutput {
  target: string;
  goal: string;
  written: boolean;
}

function findTargetMapEnd(lines: readonly string[]): number | undefined {
  const targetHeadingIdx = lines.findIndex((line) => /^##\s+\d+\.\s+Target Map$/.test(line.trim()));
  if (targetHeadingIdx < 0) return undefined;
  let tableEnd = -1;
  for (let i = targetHeadingIdx + 1; i < lines.length; i += 1) {
    const text = lines[i] ?? "";
    if (text.trim().startsWith("|")) {
      tableEnd = i;
    } else if (tableEnd >= 0 && !text.trim().startsWith("|")) {
      break;
    }
  }
  if (tableEnd < 0) return undefined;
  let cursor = tableEnd + 1;
  while (cursor < lines.length && (lines[cursor] ?? "").trim() === "") cursor += 1;
  return cursor + 1;
}

function findTargetGoalBlock(lines: readonly string[], target: string): { headingLine: number; goalLine?: number } | undefined {
  for (let i = 0; i < lines.length; i += 1) {
    const match = TARGET_HEADING_RE.exec(lines[i] ?? "");
    if (match && match[1] === target) {
      for (let j = i + 1; j < lines.length; j += 1) {
        const inner = lines[j] ?? "";
        if (/^#{1,3}\s/.test(inner)) break;
        if (GOAL_LABEL_RE.test(inner)) {
          return { headingLine: i + 1, goalLine: j + 1 };
        }
      }
      return { headingLine: i + 1 };
    }
  }
  return undefined;
}

export async function setTargetGoal(root: ProjectRoot, input: SetTargetGoalInput): Promise<MutationResult<SetTargetGoalOutput>> {
  return withSrsMutationLock(root, { operation: "set_target_goal", dryRun: input.dryRun, ignoreLock: input.ignoreLock, skipLock: input.skipLock }, () => setTargetGoalUnlocked(root, input));
}

async function setTargetGoalUnlocked(root: ProjectRoot, input: SetTargetGoalInput): Promise<MutationResult<SetTargetGoalOutput>> {
  const target = input.target.trim();
  if (!target) return mutationFail("USAGE", "target is required");
  const goal = input.goal.trim();
  if (!goal) return mutationFail("USAGE", "goal is required (whitespace-only rejected)");
  if (goal.length > MAX_GOAL_LENGTH) return mutationFail("USAGE", `goal exceeds ${MAX_GOAL_LENGTH} UTF-16 code units`);
  if (CONTROL_CHAR_RE.test(goal)) return mutationFail("USAGE", "goal contains forbidden control characters (only TAB/LF/CR allowed)");

  const file: TextFile = await readUtf8File(path.join(root.root, "docs", "spec", "00.index.md"), root.root);
  const targetHeadingIdx = file.lines.findIndex((line) => /^##\s+\d+\.\s+Target Map$/.test(line.trim()));
  if (targetHeadingIdx < 0) return mutationFail("MUTATION_DENIED", "Target Map heading is missing");
  const targetTable = parseMarkdownTable(file.lines, targetHeadingIdx + 1);
  if (!targetTable) return mutationFail("MUTATION_DENIED", "Target Map table is missing");
  const exists = targetTable.rows.some((row) => (row.Target ?? "").trim() === target);
  if (!exists) return mutationFail("NOT_FOUND", `Target is not registered in Target Map: ${target}`);

  const existingBlock = findTargetGoalBlock(file.lines, target);
  const operations: PatchOperation[] = [];

  if (existingBlock?.goalLine) {
    const original = file.lines[existingBlock.goalLine - 1];
    if (original === undefined) return mutationFail("MUTATION_DENIED", "Goal line outside file");
    const replacement = `**Goal:** ${goal}`;
    if (original !== replacement) {
      operations.push({ type: "replaceLine", line: existingBlock.goalLine, original, replacement });
    }
  } else if (existingBlock) {
    operations.push({
      type: "insertLines",
      line: existingBlock.headingLine + 1,
      lines: ["", `**Goal:** ${goal}`]
    });
  } else {
    const tableEnd = findTargetMapEnd(file.lines);
    if (!tableEnd) return mutationFail("MUTATION_DENIED", "Could not locate Target Map insertion line");
    operations.push({
      type: "insertLines",
      line: tableEnd,
      lines: ["", `### Target: ${target}`, "", `**Goal:** ${goal}`, ""]
    });
  }

  if (operations.length === 0) {
    return withMutationEnvelope(
      mutationOk({ target, goal, written: false }),
      mutationNoopEnvelope("set_target_goal", file.relativePath, input.dryRun ?? false)
    );
  }
  const plan = createPatchPlan(file, operations);
  const dryRun = input.dryRun ?? false;
  const applied = await applyPatchPlan(plan, { dryRun });
  return withMutationEnvelope(
    mutationOk({ target, goal, written: applied.written }),
    mutationEnvelopeFromPlan("set_target_goal", plan, dryRun, applied.written)
  );
}
