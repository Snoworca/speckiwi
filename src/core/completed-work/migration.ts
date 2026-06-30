import type { CompletedWorkEntry, ParsedWorkspace } from "../types.js";

export interface CompletedWorkMigrationPlanOptions {
  dryRun?: boolean;
}

export interface CompletedWorkMigrationPlan {
  kind: "completed_work_migration_plan";
  dryRun: boolean;
  sourceFilePath: "docs/spec/00.index.md";
  targetFilePath: "docs/spec/05.completed-work.md";
  indexNavigationLink: "[Completed Work Log](05.completed-work.md)";
  rows: CompletedWorkEntry[];
  rowCount: number;
  written: false;
}

export function planCompletedWorkMigration(workspace: ParsedWorkspace, options: CompletedWorkMigrationPlanOptions = {}): CompletedWorkMigrationPlan {
  const rows = workspace.index.completedWork.filter((entry) => (entry.filePath ?? "docs/spec/00.index.md") === "docs/spec/00.index.md");
  return {
    kind: "completed_work_migration_plan",
    dryRun: options.dryRun ?? true,
    sourceFilePath: "docs/spec/00.index.md",
    targetFilePath: "docs/spec/05.completed-work.md",
    indexNavigationLink: "[Completed Work Log](05.completed-work.md)",
    rows,
    rowCount: rows.length,
    written: false
  };
}
