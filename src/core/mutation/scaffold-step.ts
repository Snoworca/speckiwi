import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { renderSdsDesignTemplate, renderStepIntentTemplate } from "../bootstrap/templates.js";
import { mutationFail, mutationOk } from "./guards.js";
import { assertSafeMarkdownTableCell } from "./table-cell.js";
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

// @req FR-NODE-080 — the guard lives in the shared dependency-free module; re-exported
// so existing importers (set-sds-status) keep their import path.
import { isSafeTaskName } from "../step-name.js";
export { isSafeTaskName };

export async function scaffoldStep(root: ProjectRoot, input: ScaffoldStepInput): Promise<MutationResult<ScaffoldStepValue>> {
  if (!isSafeTaskName(input.task)) {
    return mutationFail("INVALID_STEP_NAME", `Task '${input.task}' must be a single path segment (no separators or traversal)`);
  }
  const stepDir = path.join(root.root, "docs", "spec", "steps", input.task);
  const dryRun = input.dryRun === true;
  // `target` is interpolated into a table cell of the generated `design.md`, which
  // `synthesize_step_srs` later splices verbatim into the step SRS and `promote_step_requirement`
  // copies into a body document. Measured through all three hops: a target carrying a newline and a
  // forged `### FR-… | Status | verified |` block landed a verified requirement in the body with
  // zero validation errors. A target names one release; one line, no pipes.
  if (input.target !== undefined) {
    const targetCell = assertSafeMarkdownTableCell<ScaffoldStepValue>("target", input.target);
    if (targetCell) return targetCell;
  }
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
