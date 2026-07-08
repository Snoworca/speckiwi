import path from "node:path";
import { access, mkdir, writeFile } from "node:fs/promises";
import { readUtf8File } from "../fs/read-text.js";
import { applyPatchPlan } from "../patch/apply-patch.js";
import { createPatchPlan, type PatchOperation } from "../patch/patch-plan.js";
import { parseMarkdownTable } from "../parser/table.js";
import type { MutationResult, ProjectRoot } from "../types.js";
import { mutationOk } from "./guards.js";
import { HISTORY_BANNER } from "./add-completed-work.js";

export interface MigrateCompletedWorkInput {
  apply?: boolean;
}

const HISTORY_HEADING_RE = /^##\s+\d+\.\s+Completed Work Log$/;

function findHeading(lines: string[], pattern: RegExp): number {
  return lines.findIndex((line) => pattern.test(line.trim()));
}

// MIG-NODE-001: opt-in, dry-run-default migration of inline Completed Work Log rows from
// 00.index.md section-7 into docs/spec/91.completed-work-log.md. It never touches Requirement
// Blocks and is never invoked automatically by parsing, init, or other commands.
export async function migrateCompletedWork(root: ProjectRoot, input: MigrateCompletedWorkInput = {}): Promise<MutationResult> {
  const apply = input.apply ?? false;
  const indexFile = await readUtf8File(path.join(root.root, "docs", "spec", "00.index.md"), root.root);
  const heading = findHeading(indexFile.lines, HISTORY_HEADING_RE);
  const table = heading >= 0 ? parseMarkdownTable(indexFile.lines, heading + 1) : undefined;
  const rowLines = table?.rowLines ?? [];
  const rowTexts = rowLines.map((line) => indexFile.lines[line - 1] ?? "");
  const historyAbs = path.join(root.root, "docs", "spec", "91.completed-work-log.md");

  if (!table || rowTexts.length === 0) {
    return { ...mutationOk({ moved: 0, written: false }), patch: { filePath: historyAbs, operations: 0, dryRun: !apply, preview: [] } };
  }

  if (!apply) {
    return {
      ...mutationOk({ moved: rowTexts.length, written: false }),
      patch: { filePath: historyAbs, operations: rowTexts.length, dryRun: true, preview: rowTexts }
    };
  }

  // 1) Append the rows to the history file (bootstrapping it with a read-only banner when absent),
  //    preserving the index table column layout verbatim.
  const headerText = indexFile.lines[table.startLine - 1] ?? "";
  const separatorText = indexFile.lines[table.startLine] ?? "";
  const historyExists = await access(historyAbs).then(() => true).catch(() => false);
  if (!historyExists) {
    const lines = [HISTORY_BANNER, "", "## 7. Completed Work Log", "", headerText, separatorText, ...rowTexts];
    await mkdir(path.dirname(historyAbs), { recursive: true });
    await writeFile(historyAbs, `${lines.join("\n")}\n`, "utf8");
  } else {
    const historyFile = await readUtf8File(historyAbs, root.root);
    const historyHeading = findHeading(historyFile.lines, HISTORY_HEADING_RE);
    const historyTable = historyHeading >= 0 ? parseMarkdownTable(historyFile.lines, historyHeading + 1) : undefined;
    if (!historyTable) {
      const appendOp: PatchOperation = { type: "appendLines", lines: ["", "## 7. Completed Work Log", "", headerText, separatorText, ...rowTexts] };
      const lastLine = historyFile.lines.at(-1);
      if (lastLine !== undefined) appendOp.expectedLastLine = lastLine;
      await applyPatchPlan(createPatchPlan(historyFile, [appendOp]), { dryRun: false });
    } else {
      const insertAt = historyTable.endLine + 1;
      const insertOp: PatchOperation = { type: "insertLines", line: insertAt, lines: rowTexts };
      const before = historyFile.lines[insertAt - 2];
      if (before !== undefined) insertOp.expectedBefore = before;
      const after = historyFile.lines[insertAt - 1];
      if (after !== undefined) insertOp.expectedAfter = after;
      await applyPatchPlan(createPatchPlan(historyFile, [insertOp]), { dryRun: false });
    }
  }

  // 2) Remove the migrated data rows from the index section-7 table, keeping the heading,
  //    header, and separator so the section structure stays valid.
  const removeOp: PatchOperation = {
    type: "replaceRange",
    startLine: table.startLine,
    endLine: rowLines[rowLines.length - 1]!,
    lines: [headerText, separatorText]
  };
  await applyPatchPlan(createPatchPlan(indexFile, [removeOp]), { dryRun: false });

  return {
    ...mutationOk({ moved: rowTexts.length, written: true }),
    patch: { filePath: historyAbs, operations: rowTexts.length, dryRun: false, preview: rowTexts }
  };
}
