import { existsSync } from "node:fs";
import path from "node:path";
import { diagnostic } from "../diagnostic.js";
import { readUtf8File } from "../fs/read-text.js";
import { applyPatchPlans } from "../patch/apply-patch-plans.js";
import { createPatchPlan, type PatchOperation, type PatchPlan } from "../patch/patch-plan.js";
import { COMPLETED_WORK_LOG_HEADING, findHeadingMatching, TARGET_MAP_HEADING } from "../parser/index-parser.js";
import { parseMarkdownTable } from "../parser/table.js";
import { parseWorkspace } from "../parser/workspace-parser.js";
import { readResidueRows, splitResidueCells } from "../workflow/release-readiness.js";
import { readRoadmapFile, resolveRoadmapDate } from "../roadmap/load-roadmap.js";
import { parseRoadmap, roadmapFieldValue, roadmapList } from "../roadmap/parse-roadmap.js";
import { NO_ROADMAP_SOURCES } from "../roadmap/roadmap-model.js";
import { formatRoadmapList } from "../roadmap/render-roadmap.js";
import { planRoadmapItemChanges } from "./roadmap-items.js";
import type { MutationResult, ProjectRoot, TextFile } from "../types.js";
import { mutationFail, mutationOk } from "./guards.js";
import { withSrsMutationLock } from "./srs-lock.js";
import { planIndexMetadataWrite, planMetadataWrite, readIndexMetadataValue } from "./internal.js";
import { assertSafeMarkdownTableCells, escapeRegExp, replaceTableCell } from "./table-cell.js";

export interface RenameTargetInput {
  from: string;
  to: string;
  /** Defaults to true: a rename touches many files, so writing is the explicit choice. */
  dryRun?: boolean;
  ignoreLock?: boolean;
  skipLock?: boolean;
  /** The date of the roadmap Change History rows the rename appends; defaults to today's local date. */
  date?: string;
}

export type RenamedLocationKind =
  | "target-map-row"
  | "active-target"
  | "target-goal-heading"
  | "requirement-target"
  | "release-residue-row"
  | "completed-work-row"
  | "roadmap-targets";

export interface RenamedLocation {
  kind: RenamedLocationKind;
  /** Workspace-relative POSIX path. */
  file: string;
  /** 1-based line number. */
  line: number;
  before: string;
  after: string;
  requirementId?: string;
}

export interface RenameTargetOutput {
  from: string;
  to: string;
  dryRun: boolean;
  written: boolean;
  locations: RenamedLocation[];
}

const INDEX_PATH = "docs/spec/00.index.md";
const APPENDIX_PATH = "docs/spec/90.appendix.md";
const COMPLETED_WORK_PATH = "docs/spec/05.completed-work.md";
const COMPLETED_WORK_HISTORY_PATH = "docs/spec/91.completed-work-log.md";

async function readExisting(root: ProjectRoot, relativePaths: readonly string[]): Promise<TextFile[]> {
  const present = relativePaths.filter((relative) => existsSync(path.join(root.root, relative)));
  return Promise.all(present.map((relative) => readUtf8File(path.join(root.root, relative), root.root)));
}
// Same token shape the index parser accepts for a `### Target:` heading, so the renamed goal stays readable.
const TARGET_TOKEN_RE = /^[^\s/\\]+$/;

/**
 * Rewrites a residue row's Target cell. Release readiness accepts a row without its outer pipes, so
 * the leading pipe is optional here. Whether exactly the Target cell changed is judged by readiness's
 * own cell splitter, so `5.2` cannot rewrite the start of a `5.2.0` cell.
 */
function replaceResidueTarget(line: string, from: string, to: string): string | undefined {
  const after = line.replace(new RegExp(`^(\\s*\\|?\\s*)${escapeRegExp(from)}`), (_match, head: string) => `${head}${to}`);
  const [beforeTarget, ...beforeRest] = splitResidueCells(line);
  const [afterTarget, ...afterRest] = splitResidueCells(after);
  const unchangedRest = JSON.stringify(beforeRest) === JSON.stringify(afterRest);
  return beforeTarget === from && afterTarget === to && unchangedRest ? after : undefined;
}

function goalHeadingPattern(target: string): RegExp {
  return new RegExp(`^(### Target:\\s+)${escapeRegExp(target)}(\\s*)$`);
}

function replaceGoalHeading(line: string, from: string, to: string): string | undefined {
  const pattern = goalHeadingPattern(from);
  return pattern.test(line) ? line.replace(pattern, (_match, head: string, tail: string) => `${head}${to}${tail}`) : undefined;
}

class FilePlans {
  private readonly byFile = new Map<string, { file: TextFile; operations: PatchOperation[] }>();
  readonly locations: RenamedLocation[] = [];

  add(file: TextFile, line: number, after: string, location: Omit<RenamedLocation, "file" | "line" | "before" | "after">): void {
    const before = file.lines[line - 1] ?? "";
    const entry = this.byFile.get(file.relativePath) ?? { file, operations: [] };
    entry.operations.push({ type: "replaceLine", line, original: before, replacement: after });
    this.byFile.set(file.relativePath, entry);
    this.locations.push({ ...location, file: file.relativePath, line, before, after });
  }

  /** An operation that rewrites no reported location, such as a Change History row that records one. */
  insert(file: TextFile, operation: PatchOperation): void {
    const entry = this.byFile.get(file.relativePath) ?? { file, operations: [] };
    entry.operations.push(operation);
    this.byFile.set(file.relativePath, entry);
  }

  plans(): PatchPlan[] {
    return [...this.byFile.values()].map(({ file, operations }) => createPatchPlan(file, operations));
  }
}

// @req IR-CLI-112
export async function renameTarget(root: ProjectRoot, input: RenameTargetInput): Promise<MutationResult<RenameTargetOutput>> {
  const dryRun = input.dryRun ?? true;
  return withSrsMutationLock(root, { operation: "rename_target", dryRun, ignoreLock: input.ignoreLock, skipLock: input.skipLock }, () =>
    renameTargetUnlocked(root, input, dryRun)
  );
}

async function renameTargetUnlocked(root: ProjectRoot, input: RenameTargetInput, dryRun: boolean): Promise<MutationResult<RenameTargetOutput>> {
  const from = input.from.trim();
  const to = input.to.trim();
  if (!from) return mutationFail("USAGE", "from is required");
  if (!to) return mutationFail("USAGE", "to is required");
  if (!TARGET_TOKEN_RE.test(to)) return mutationFail("USAGE", `to must be one token without whitespace or path separators: ${to}`);
  const unsafe = assertSafeMarkdownTableCells<RenameTargetOutput>({ "Target Map Target": to });
  if (unsafe) return unsafe;

  const workspace = await parseWorkspace(root);
  const registered = new Set(workspace.index.targets.map((entry) => entry.target.trim()));
  // @req IR-CLI-112 AC-2 — both refusals happen before any file is planned, so nothing is written.
  if (!registered.has(from)) {
    const message = `Target is not registered: ${from}`;
    return mutationFail("NOT_FOUND", message, [diagnostic("SRS-W002", "warning", message, { filePath: INDEX_PATH })]);
  }
  if (registered.has(to)) {
    const message = `Duplicate Target Map target: ${to}`;
    return mutationFail("MUTATION_DENIED", message, [diagnostic("SRS-E022", "error", message, { filePath: INDEX_PATH }, { renameFrom: from })]);
  }

  const plans = new FilePlans();
  const indexFile = await readUtf8File(path.join(root.root, INDEX_PATH), root.root);

  // A row the parser reads as naming `from` that cannot be rewritten makes the whole rename a refusal:
  // reporting success while the parser still reads the old name would leave a stale reference.
  const unrewritable: string[] = [];

  // The index's own metadata table goes through the shared metadata writer, by header name.
  if (readIndexMetadataValue(indexFile, "Active Target")?.trim() === from) {
    const write = planIndexMetadataWrite(indexFile, "Active Target", to);
    if (!write.ok) return mutationFail("MUTATION_DENIED", `${write.message}; nothing was renamed`);
    if (write.operation.type === "replaceLine") plans.add(indexFile, write.operation.line, write.operation.replacement, { kind: "active-target" });
  }

  // Target Map and Completed Work Log are located with the index parser's own heading lookup.
  const renameTargetColumn = (file: TextFile, headingIndex: number, kind: RenamedLocationKind): void => {
    const table = headingIndex >= 0 ? parseMarkdownTable(file.lines, headingIndex + 1) : undefined;
    const column = table ? table.headers.indexOf("Target") : -1;
    if (!table || column < 0) return;
    table.rows.forEach((row, index) => {
      const line = table.rowLines[index];
      if (line === undefined || (row.Target ?? "").trim() !== from) return;
      const after = replaceTableCell(file.lines[line - 1] ?? "", column, from, to);
      if (after === undefined) unrewritable.push(`${file.relativePath}:${line}`);
      else plans.add(file, line, after, { kind });
    });
  };

  renameTargetColumn(indexFile, findHeadingMatching(indexFile.lines, TARGET_MAP_HEADING), "target-map-row");
  // @req IR-CLI-112 AC-5 — a residue row still naming the old target goes stale and blocks release
  // readiness again, and a Completed Work Log row raises SRS-W012. The register is located by release readiness's own reader, so a fenced example or a setext heading
  // is judged the same way here as where the rows are honoured.
  for (const row of readResidueRows(workspace).rows) {
    if (row.target !== from) continue;
    const after = replaceResidueTarget(indexFile.lines[row.line - 1] ?? "", from, to);
    if (after === undefined) unrewritable.push(`${indexFile.relativePath}:${row.line}`);
    else plans.add(indexFile, row.line, after, { kind: "release-residue-row" });
  }
  for (const file of [indexFile, ...(await readExisting(root, [COMPLETED_WORK_PATH, COMPLETED_WORK_HISTORY_PATH]))]) {
    renameTargetColumn(file, findHeadingMatching(file.lines, COMPLETED_WORK_LOG_HEADING), "completed-work-row");
  }

  // Goal blocks live in the index and, optionally, the appendix (FR-PARSE-018).
  const appendix = workspace.files.find((file) => file.relativePath === APPENDIX_PATH);
  const goalFiles = [indexFile, ...(appendix ? [await readUtf8File(path.join(root.root, APPENDIX_PATH), root.root)] : [])];
  // @req IR-CLI-112 AC-2 — the new name must be unused wherever the index parser reads a target name,
  // not only in the Target Map: a goal heading already under it would be read after the renamed one
  // (the parser keeps the last block, index and appendix alike) and hide the renamed target's goal,
  // and an Active Target already naming it would silently start pointing at the renamed target.
  for (const file of goalFiles) {
    const line = file.lines.findIndex((text) => goalHeadingPattern(to).test(text));
    if (line >= 0) {
      return mutationFail("MUTATION_DENIED", `${to} already has a goal heading at ${file.relativePath}:${line + 1}; remove or merge it before renaming ${from}`);
    }
  }
  if (readIndexMetadataValue(indexFile, "Active Target")?.trim() === to) {
    return mutationFail("MUTATION_DENIED", `${to} is already the Active Target although no Target Map row registers it; set the Active Target before renaming ${from}`);
  }
  for (const file of goalFiles) {
    file.lines.forEach((text, index) => {
      const after = replaceGoalHeading(text, from, to);
      if (after !== undefined) plans.add(file, index + 1, after, { kind: "target-goal-heading" });
    });
  }

  const records = [...workspace.records, ...(workspace.stepRecords ?? [])].filter((record) => record.target === from);
  const recordFiles = new Map<string, TextFile>();
  for (const record of records) {
    const file = recordFiles.get(record.filePath) ?? (await readUtf8File(path.join(root.root, record.filePath), root.root));
    recordFiles.set(record.filePath, file);
    // The record's Target is `from` exactly, so the shared metadata writer rewrites only that row.
    const write = planMetadataWrite(file, record, "Target", to);
    if (!write.ok) return mutationFail("MUTATION_DENIED", `${write.message} for ${record.id}`);
    if (write.operation.type === "replaceLine") {
      plans.add(file, write.operation.line, write.operation.replacement, { kind: "requirement-target", requirementId: record.id });
    }
  }

  // @req FR-NODE-258 AC-1 AC-2 — the roadmap names targets in its Targets lists. Each whole entry naming
  // `from` is replaced in the same transaction as the SRS, with a history row that names the rename,
  // so the rename leaves no roadmap reference to the old name and the change history explains the edit.
  const roadmap = await readRoadmapFile(root);
  if (roadmap) {
    const date = resolveRoadmapDate(input.date, "date");
    if (!date.ok) return mutationFail(date.error.code, date.error.message);
    const reason = `Renamed target ${from} to ${to}`;
    const document = parseRoadmap(roadmap.text, NO_ROADMAP_SOURCES).document;
    for (const item of document.items) {
      const entries = roadmapList(roadmapFieldValue(item, "Targets"));
      if (!entries.includes(from)) continue;
      const renamed = formatRoadmapList([...new Set(entries.map((entry) => (entry === from ? to : entry)))]);
      const planned = planRoadmapItemChanges(roadmap, document, item, [{ field: "Targets", from: roadmapFieldValue(item, "Targets"), to: renamed }], date.value, reason);
      if (!planned.ok) return mutationFail("MUTATION_DENIED", `${planned.message}; nothing was renamed`);
      for (const operation of planned.operations) {
        if (operation.type === "replaceLine") plans.add(roadmap, operation.line, operation.replacement, { kind: "roadmap-targets" });
        else plans.insert(roadmap, operation);
      }
    }
  }

  if (unrewritable.length > 0) {
    return mutationFail("MUTATION_DENIED", `rows naming ${from} could not be rewritten: ${unrewritable.join(", ")}; nothing was renamed`);
  }

  // One change across several documents: the shared transaction writes all of them or none.
  const applied = await applyPatchPlans(plans.plans(), { dryRun });
  return mutationOk({ from, to, dryRun, written: applied.written, locations: plans.locations });
}
