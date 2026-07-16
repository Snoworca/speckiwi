import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { renderSdsDesignTemplate, renderStepIntentTemplate } from "../bootstrap/templates.js";
import { mutationFail, mutationOk } from "./guards.js";
import type { MutationResult, ProjectRoot } from "../types.js";

// @req FR-NODE-080
/**
 * FR-NODE-080 — step scaffold mutation.
 *
 * Creates docs/spec/steps/<task>/ with a design.md stub (SDS-MD Rules §8 template,
 * Status=draft, headings synced with the validator set) and an intent.md stub using
 * writeIfMissing semantics: an existing file is never overwritten (reported as
 * skipped) while missing siblings are still created. The stubs are empty skeletons —
 * SDS and step content remain directly authored.
 */
export interface ScaffoldStepInput {
  task: string;
  target?: string;
  dryRun?: boolean;
}

export interface ScaffoldStepValue {
  task: string;
  created: string[];
  skipped: string[];
  written: boolean;
}

// @req FR-NODE-080
/** A step/task name is a single path segment: no separators, traversal, or empties. */
export function isSafeTaskName(task: string): boolean {
  return task.trim().length > 0 && !/[\\/]/.test(task) && task !== "." && task !== "..";
}

export async function scaffoldStep(root: ProjectRoot, input: ScaffoldStepInput): Promise<MutationResult<ScaffoldStepValue>> {
  if (!isSafeTaskName(input.task)) {
    return mutationFail("INVALID_STEP_NAME", `Task '${input.task}' must be a single path segment (no separators or traversal)`);
  }
  const stepDir = path.join(root.root, "docs", "spec", "steps", input.task);
  const dryRun = input.dryRun === true;
  const stubs: Array<{ relPath: string; content: string }> = [
    {
      relPath: path.join("docs", "spec", "steps", input.task, "design.md"),
      content: renderSdsDesignTemplate({ task: input.task, ...(input.target !== undefined ? { target: input.target } : {}) })
    },
    {
      relPath: path.join("docs", "spec", "steps", input.task, "intent.md"),
      content: renderStepIntentTemplate(input.task)
    }
  ];

  const created: string[] = [];
  const skipped: string[] = [];
  if (!dryRun) await mkdir(stepDir, { recursive: true });
  for (const stub of stubs) {
    const absolute = path.join(root.root, stub.relPath);
    if (dryRun) {
      // Dry-run classifies would-be creations vs existing files without touching the filesystem.
      const exists = await stat(absolute).then(() => true).catch(() => false);
      (exists ? skipped : created).push(stub.relPath);
      continue;
    }
    try {
      // wx: fail when the file already exists — writeIfMissing, never overwrite.
      await writeFile(absolute, stub.content, { encoding: "utf8", flag: "wx" });
      created.push(stub.relPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      skipped.push(stub.relPath);
    }
  }

  return mutationOk<ScaffoldStepValue>({
    task: input.task,
    created,
    skipped,
    written: !dryRun && created.length > 0
  });
}
