import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { diagnostic } from "../diagnostic.js";
import { applyPatchPlan, isStalePatchError, renderPlanText } from "../patch/apply-patch.js";
import { createPatchPlan, type PatchOperation } from "../patch/patch-plan.js";
import { classifyDocumentLines, SRS_RECORD_LINES, type ClassifyOptions } from "../parser/document-lines.js";
import { isTableLine } from "../parser/table.js";
import { parseWorkspace } from "../parser/workspace-parser.js";
import { checkRoadmap } from "../roadmap/compute-roadmap.js";
import { readRoadmapFile, resolveRoadmapDate, roadmapSourcesOf } from "../roadmap/load-roadmap.js";
import { isRoadmapBoundaryHeading, parseRoadmap, roadmapFieldValue, roadmapList, withoutOuterBlankLines } from "../roadmap/parse-roadmap.js";
import {
  ROADMAP_CREATED_FIELD,
  ROADMAP_EMPTY,
  ROADMAP_FIELDS,
  ROADMAP_PATH,
  ROADMAP_REASON_REQUIRED_FIELDS,
  type RoadmapFieldName,
  type RoadmapKind,
  type RoadmapLifecycle
} from "../roadmap/roadmap-grammar.js";
import type { RoadmapDocument, RoadmapItem, RoadmapSources } from "../roadmap/roadmap-model.js";
import {
  formatRoadmapList,
  formatRoadmapValue,
  planHistoryRows,
  renderAll,
  renderRoadmapHistoryRow,
  renderRoadmapItem,
  renderRoadmapMetadataRow,
  renderRoadmapSection,
  ROADMAP_DOCUMENT_HEAD,
  type RoadmapHistoryCells
} from "../roadmap/render-roadmap.js";
import type { Diagnostic, MutationResult, ProjectRoot, TextFile } from "../types.js";
import { assertOpensNoBlockBoundary, assertSingleLine } from "./block-prose.js";
import { mutationEnvelopeFromPlan, mutationNoopEnvelope, withMutationEnvelope } from "./envelope.js";
import { mutationFail, mutationOk } from "./guards.js";
import { withSrsMutationLock } from "./srs-lock.js";

// @req FR-NODE-256
//
// The only writers of `docs/roadmap.md`: add and update. Both run under the SRS mutation lock, because
// they check target and requirement names against the same SRS moment the SRS writers see, and both
// write through one patch plan that matches the lines it was made from. A write is refused when the
// roadmap check would report an error afterwards that it did not report before, so a tool write never
// breaks the document; the warnings of an allowed write are returned with it.

/** The settable metadata of an item. A list is given as its entries; `[]` or `"-"` empties a field. */
export interface RoadmapFieldInput {
  milestone?: string;
  targets?: readonly string[];
  requirements?: readonly string[];
  prd?: readonly string[];
  dependsOn?: readonly string[];
  owner?: string;
  githubIssue?: readonly string[];
  plannedStart?: string;
  plannedEnd?: string;
  actualStart?: string;
  actualEnd?: string;
  lifecycle?: RoadmapLifecycle;
}

/** The prose sections add and update write; `""` or `"-"` empties one. @req FR-NODE-268 AC-2 AC-3 */
export interface RoadmapSectionInput {
  description?: string;
  features?: string;
}

export interface RoadmapWriteOptions {
  /** Plan the change and write nothing. Defaults to false. */
  dryRun?: boolean;
  ignoreLock?: boolean;
  skipLock?: boolean;
  /** The Change History date, `YYYY-MM-DD`; defaults to today's local date. */
  date?: string;
}

export interface AddRoadmapItemInput extends RoadmapFieldInput, RoadmapSectionInput, RoadmapWriteOptions {
  kind: RoadmapKind;
  title: string;
  purpose?: string;
  /** Create the item from a registered target: `Targets` is that target and `Purpose` is `-`. */
  fromTarget?: string;
  /** Written into the item's `Created` history row. */
  reason: string;
}

export interface UpdateRoadmapItemInput extends RoadmapFieldInput, RoadmapSectionInput, RoadmapWriteOptions {
  id: string;
  title?: string;
  /** Required when a schedule, `Lifecycle`, `Milestone` or `Targets` value changes. */
  reason?: string;
}

export interface RoadmapFieldChange {
  field: string;
  from: string;
  to: string;
}

export interface RoadmapWriteOutput {
  id: string;
  dryRun: boolean;
  written: boolean;
  /** True when this write creates `docs/roadmap.md`. */
  created: boolean;
  changes: RoadmapFieldChange[];
}

const INPUT_FIELDS = {
  milestone: "Milestone",
  targets: "Targets",
  requirements: "Requirements",
  prd: "PRD",
  dependsOn: "Depends On",
  owner: "Owner",
  githubIssue: "GitHub Issue",
  plannedStart: "Planned Start",
  plannedEnd: "Planned End",
  actualStart: "Actual Start",
  actualEnd: "Actual End",
  lifecycle: "Lifecycle"
} as const satisfies Record<keyof RoadmapFieldInput, RoadmapFieldName>;

const SECTION_INPUTS = { description: "Description", features: "Features" } as const satisfies Record<keyof RoadmapSectionInput, string>;
type InputSectionName = (typeof SECTION_INPUTS)[keyof RoadmapSectionInput];

const LIST_FIELDS: ReadonlySet<RoadmapFieldName> = new Set(["Targets", "Requirements", "PRD", "Depends On", "GitHub Issue"]);
const TITLE_FIELD = "Title";

/** A cell as the writers render it, so two spellings of one list compare equal. */
function canonicalCell(field: RoadmapFieldName, value: string): string {
  return LIST_FIELDS.has(field) ? formatRoadmapList(roadmapList(value)) : formatRoadmapValue(value);
}

/** The cells the caller gave, rendered, by field. */
function givenCells(input: RoadmapFieldInput): Partial<Record<RoadmapFieldName, string>> {
  const cells: Partial<Record<RoadmapFieldName, string>> = {};
  for (const [key, field] of Object.entries(INPUT_FIELDS) as [keyof RoadmapFieldInput, RoadmapFieldName][]) {
    const value = input[key];
    if (value === undefined) continue;
    cells[field] = typeof value === "string" ? canonicalCell(field, value) : formatRoadmapList(value);
  }
  return cells;
}

/**
 * The section texts the caller gave, line for line without their outer blank lines, `-` for an empty
 * one, refused when one would break the item. @req FR-NODE-268 AC-5
 */
function givenSections(input: RoadmapSectionInput): { ok: true; sections: Partial<Record<InputSectionName, string>> } | { ok: false; refusal: MutationResult<RoadmapWriteOutput> } {
  const sections: Partial<Record<InputSectionName, string>> = {};
  for (const [key, name] of Object.entries(SECTION_INPUTS) as [keyof RoadmapSectionInput, InputSectionName][]) {
    const value = input[key];
    if (value === undefined) continue;
    const text = withoutOuterBlankLines(value.split("\n")).join("\n") || ROADMAP_EMPTY;
    const unsafe = assertSectionText(key, text);
    if (unsafe) return { ok: false, refusal: unsafe };
    sections[name] = text;
  }
  return { ok: true, sections };
}

function isInputSection(field: string): field is InputSectionName {
  return (Object.values(SECTION_INPUTS) as string[]).includes(field);
}

/** A section's text as a Change History cell: the text cannot fit one, so the row names the section only. */
function sectionHistoryCell(text: string): string {
  return text === ROADMAP_EMPTY ? ROADMAP_EMPTY : "(text)";
}

/**
 * The operation that sets one section's text: over the section's lines when the item has the section,
 * otherwise a new section right before the item's Change History heading, or after the item's last
 * line when it has none. Either way no line outside that section moves.
 * @req FR-NODE-268 AC-3 AC-4
 */
function planSectionText(file: TextFile, item: RoadmapItem, name: InputSectionName, text: string): PatchOperation {
  const section = item.sections[name];
  if (section) return { type: "replaceRange", startLine: section.line + 1, endLine: section.lastLine, lines: ["", ...text.split(/\r?\n/)] };
  const history = item.sections["Change History"];
  if (history) return { type: "insertLines", line: history.line, lines: renderRoadmapSection(name, text), expectedAfter: file.lines[history.line - 1] ?? "" };
  return { type: "insertLines", line: item.lastLine + 1, lines: ["", ...renderRoadmapSection(name, text).slice(0, -1)], expectedBefore: file.lines[item.lastLine - 1] ?? "" };
}

/**
 * The refusal for a document holding a code fence that never closes: the fence hides every line after
 * it, item headings included, so no write can tell where an item ends. @req FR-NODE-268 AC-4
 */
export function unclosedFenceRefusal(document: RoadmapDocument): { code: string; message: string } | undefined {
  if (document.unclosedFenceLine === undefined) return undefined;
  return {
    code: "MUTATION_DENIED",
    message: `${ROADMAP_PATH} line ${document.unclosedFenceLine} opens a code fence that never closes, so where the items after it end is unknown; nothing was written; close the fence by hand first`
  };
}

function staleFailure<T>(filePath: string): MutationResult<T> {
  const message = `Mutation snapshot is stale for ${filePath}; rerun the command to retry against the latest file.`;
  return mutationFail("STALE_PATCH", message, [diagnostic("SRS-E032", "error", message, { filePath })], { staleGuard: { filePath, retry: "rerun the command" } });
}

function errorKey(item: Diagnostic): string {
  return `${item.code}\u0000${item.message}`;
}

/** The errors in `after` that `before` does not account for, counting repeats. */
function addedErrors(before: readonly Diagnostic[], after: readonly Diagnostic[]): Diagnostic[] {
  const seen = new Map<string, number>();
  for (const item of before.filter((entry) => entry.severity === "error")) seen.set(errorKey(item), (seen.get(errorKey(item)) ?? 0) + 1);
  return after.filter((item) => {
    if (item.severity !== "error") return false;
    const left = seen.get(errorKey(item)) ?? 0;
    if (left === 0) return true;
    seen.set(errorKey(item), left - 1);
    return false;
  });
}

/** The Purpose check: refuses a heading, a fence, a comment block or a table in the purpose prose. */
function assertSafeProse(label: string, value: string): MutationResult<RoadmapWriteOutput> | undefined {
  const boundary = assertOpensNoBlockBoundary<RoadmapWriteOutput>(label, value);
  if (boundary) return boundary;
  const table = value.split(/\r?\n/).find((line) => isTableLine(line));
  return table === undefined ? undefined : mutationFail("USAGE", `${label} contains a table row; the roadmap writers keep tables out of Purpose: ${table.trim()}`);
}

/**
 * The value is classified with every opener taken as open: a fence or comment it never closes would,
 * once written, meet a closer somewhere later in the document — another item's `-->` or fence — and
 * hide every line in between.
 */
const SECTION_VALUE_LINES: ClassifyOptions = { ...SRS_RECORD_LINES, unclosedOpens: true };

/**
 * Refuses a Description or Features value only for a line the roadmap reader would take as structure
 * once it is written: a heading line outside code, or a code fence or HTML comment the value opens and
 * never closes. Tables, closed comment blocks and code are text in these sections. @req FR-NODE-268 AC-5
 */
function assertSectionText(label: string, value: string): MutationResult<RoadmapWriteOutput> | undefined {
  const lines = value.split(/\r?\n/);
  const classified = classifyDocumentLines(lines, SECTION_VALUE_LINES);
  const unclosed = classified.findIndex((line) => line.unclosed === true);
  if (unclosed >= 0) {
    const what = classified[unclosed]!.kind === "comment" ? "an HTML comment" : "a code fence";
    return mutationFail("USAGE", `${label} opens ${what} it never closes, which would hide the lines after it from the roadmap reader: ${lines[unclosed]!.trim()}`);
  }
  const heading = lines.find((line, index) => classified[index]?.body === true && isRoadmapBoundaryHeading(line));
  return heading === undefined
    ? undefined
    : mutationFail("USAGE", `${label} contains a heading line outside code, which the roadmap reader would take for an item or section boundary: ${heading.trim()}`);
}

/**
 * Applies a roadmap patch plan: refuses it when it adds a roadmap error, writes nothing under dry-run,
 * creates the file only if it still does not exist, and otherwise writes only over the bytes the plan
 * was made from. Answers with the envelope every SRS mutation answers with.
 */
export async function commitRoadmapWrite<T extends { dryRun: boolean; written: boolean }>(
  kind: string,
  file: TextFile,
  operations: PatchOperation[],
  sources: RoadmapSources,
  output: T,
  options: { dryRun: boolean; create: boolean }
): Promise<MutationResult<T>> {
  const plan = createPatchPlan(file, operations);
  const rendered = renderPlanText(plan);
  const before = options.create ? [] : checkRoadmap(file.text, sources).diagnostics;
  const after = checkRoadmap(rendered.text, sources).diagnostics;
  const added = addedErrors(before, after);
  if (added.length > 0) {
    return mutationFail("MUTATION_DENIED", `The change would add roadmap errors: ${added.map((item) => `${item.code} ${item.message}`).join("; ")}`, added);
  }
  let written = false;
  if (!options.dryRun) {
    if (options.create) {
      await mkdir(path.dirname(file.path), { recursive: true });
      const created = await writeFile(file.path, rendered.text, { encoding: "utf8", flag: "wx" }).then(
        () => true,
        (error: NodeJS.ErrnoException) => {
          if (error.code === "EEXIST") return false;
          throw error;
        }
      );
      if (!created) return staleFailure<T>(file.relativePath);
      written = true;
    } else {
      try {
        written = (await applyPatchPlan(plan, { dryRun: false })).written;
      } catch (error) {
        if (isStalePatchError(error)) return staleFailure<T>(file.relativePath);
        throw error;
      }
    }
  }
  const warnings = after.filter((item) => item.severity === "warning");
  return withMutationEnvelope(mutationOk({ ...output, dryRun: options.dryRun, written }, warnings), mutationEnvelopeFromPlan(kind, plan, options.dryRun, written));
}

// @req FR-NODE-256 AC-1 AC-2 AC-5 AC-6
export async function addRoadmapItem(root: ProjectRoot, input: AddRoadmapItemInput): Promise<MutationResult<RoadmapWriteOutput>> {
  const dryRun = input.dryRun ?? false;
  return withSrsMutationLock(root, { operation: "add_roadmap_item", dryRun, ignoreLock: input.ignoreLock, skipLock: input.skipLock }, () => addUnlocked(root, input, dryRun));
}

async function addUnlocked(root: ProjectRoot, input: AddRoadmapItemInput, dryRun: boolean): Promise<MutationResult<RoadmapWriteOutput>> {
  const title = input.title.trim();
  if (!title) return mutationFail("USAGE", "title is required");
  const titleOnOneLine = assertSingleLine<RoadmapWriteOutput>("title", title);
  if (titleOnOneLine) return titleOnOneLine;
  const reason = input.reason.trim();
  if (!reason) return mutationFail("USAGE", "reason is required: it is written into the item's Created history row");
  if (input.fromTarget !== undefined && (input.targets !== undefined || input.purpose !== undefined)) {
    return mutationFail("USAGE", "fromTarget sets Targets and borrows the target goal as the purpose; give targets and purpose without it");
  }
  const purpose = input.purpose?.trim() || ROADMAP_EMPTY;
  const unsafePurpose = assertSafeProse("purpose", purpose);
  if (unsafePurpose) return unsafePurpose;
  const sections = givenSections(input);
  if (!sections.ok) return sections.refusal;
  const date = resolveRoadmapDate(input.date, "date");
  if (!date.ok) return mutationFail(date.error.code, date.error.message);

  const workspace = await parseWorkspace(root);
  const sources = await roadmapSourcesOf(workspace);
  const values = Object.fromEntries(ROADMAP_FIELDS.map((field) => [field, ROADMAP_EMPTY])) as Record<RoadmapFieldName, string>;
  Object.assign(values, { Kind: input.kind, Lifecycle: "open" }, givenCells(input));
  if (input.fromTarget !== undefined) {
    const target = input.fromTarget.trim();
    if (!workspace.index.targets.some((entry) => entry.target.trim() === target)) {
      return mutationFail("NOT_FOUND", `Target is not registered in the Target Map: ${target}`);
    }
    values.Targets = target;
  }

  const existing = await readRoadmapFile(root);
  const document: RoadmapDocument = existing ? parseRoadmap(existing.text, sources).document : { items: [] };
  const refusal = unclosedFenceRefusal(document);
  if (refusal) return mutationFail(refusal.code, refusal.message);
  const items = document.items;
  const id = `RM-${Math.max(0, ...items.map((item) => item.number)) + 1}`;
  const block = renderRoadmapItem({ id, title, values, purpose, description: sections.sections.Description, features: sections.sections.Features, history: [{ date: date.value, field: ROADMAP_CREATED_FIELD, from: ROADMAP_EMPTY, to: ROADMAP_EMPTY, reason }] });
  if (!block.ok) return mutationFail(block.error.code, block.error.message);

  const output: RoadmapWriteOutput = { id, dryRun, written: false, created: existing === undefined, changes: [] };
  if (existing) {
    const body = existing.lines.at(-1) === "" ? existing.lines.slice(0, -1) : existing.lines;
    const gap = (body.at(-1) ?? "").trim() === "" ? [] : [""];
    const operation: PatchOperation = { type: "appendLines", lines: [...gap, ...block.value], expectedLastLine: existing.lines.at(-1) ?? "" };
    return commitRoadmapWrite("add_roadmap_item", existing, [operation], sources, output, { dryRun, create: false });
  }
  const newline = workspace.files[0]?.newline ?? "\n";
  const file: TextFile = { path: path.join(root.root, ...ROADMAP_PATH.split("/")), relativePath: ROADMAP_PATH, text: "", lines: [""], newline };
  return commitRoadmapWrite("add_roadmap_item", file, [{ type: "appendLines", lines: [...ROADMAP_DOCUMENT_HEAD, "", ...block.value, ""] }], sources, output, { dryRun, create: true });
}

/**
 * The patch operations that move `item` to the values in `changes` and append one Change History row
 * per change. Shared by update and sync, so both record a change the same way.
 */
export function planRoadmapItemChanges(
  file: TextFile,
  document: RoadmapDocument,
  item: RoadmapItem,
  changes: readonly RoadmapFieldChange[],
  date: string,
  reason: string
): { ok: true; operations: PatchOperation[] } | { ok: false; code: string; message: string } {
  const refusal = unclosedFenceRefusal(document);
  if (refusal) return { ok: false, ...refusal };
  const operations: PatchOperation[] = [];
  const sectionOperations: PatchOperation[] = [];
  for (const change of changes) {
    if (isInputSection(change.field)) {
      sectionOperations.unshift(planSectionText(file, item, change.field, change.to));
      continue;
    }
    if (change.field === TITLE_FIELD) {
      operations.push({ type: "replaceLine", line: item.line, original: file.lines[item.line - 1] ?? "", replacement: `### ${item.id} — ${change.to}` });
      continue;
    }
    const field = change.field as RoadmapFieldName;
    const row = item.fields[field];
    if (!row) return { ok: false, code: "MUTATION_DENIED", message: `${item.id} has no ${field} row to change; add the row by hand first` };
    const rendered = renderRoadmapMetadataRow(field, change.to);
    if (!rendered.ok) return { ok: false, code: rendered.error.code, message: rendered.error.message };
    operations.push({ type: "replaceLine", line: row.line, original: file.lines[row.line - 1] ?? "", replacement: rendered.value });
  }
  const cells: RoadmapHistoryCells[] = changes.map((change) =>
    isInputSection(change.field)
      ? { date, field: change.field, from: sectionHistoryCell(change.from), to: sectionHistoryCell(change.to), reason }
      : { date, field: change.field, from: change.from, to: change.to, reason }
  );
  const rows = renderAll(cells, renderRoadmapHistoryRow);
  if (!rows.ok) return { ok: false, code: rows.error.code, message: rows.error.message };
  const history = planHistoryRows(item, file.lines, rows.value);
  if (!history) return { ok: false, code: "MUTATION_DENIED", message: `${item.id} has a Change History section without a readable table; repair it by hand first` };
  // Operations at one line land in reverse array order. In an item without Change History everything
  // new lands after its last line: a replaced empty section's text first, under its heading, then the
  // new sections in grammar order, then the new Change History.
  const inserted = sectionOperations.filter((operation) => operation.type === "insertLines");
  const replaced = sectionOperations.filter((operation) => operation.type !== "insertLines");
  operations.push(history, ...inserted, ...replaced);
  return { ok: true, operations };
}

// @req FR-NODE-256 AC-3 AC-4 AC-5 AC-6 AC-7
export async function updateRoadmapItem(root: ProjectRoot, input: UpdateRoadmapItemInput): Promise<MutationResult<RoadmapWriteOutput>> {
  const dryRun = input.dryRun ?? false;
  return withSrsMutationLock(root, { operation: "update_roadmap_item", dryRun, ignoreLock: input.ignoreLock, skipLock: input.skipLock }, () => updateUnlocked(root, input, dryRun));
}

async function updateUnlocked(root: ProjectRoot, input: UpdateRoadmapItemInput, dryRun: boolean): Promise<MutationResult<RoadmapWriteOutput>> {
  const title = input.title?.trim();
  if (title !== undefined) {
    if (!title) return mutationFail("USAGE", "title cannot be empty");
    const titleOnOneLine = assertSingleLine<RoadmapWriteOutput>("title", title);
    if (titleOnOneLine) return titleOnOneLine;
  }
  const sections = givenSections(input);
  if (!sections.ok) return sections.refusal;
  const date = resolveRoadmapDate(input.date, "date");
  if (!date.ok) return mutationFail(date.error.code, date.error.message);
  const file = await readRoadmapFile(root);
  if (!file) return mutationFail("NOT_FOUND", `${ROADMAP_PATH} does not exist; add an item first`);
  const sources = await roadmapSourcesOf(await parseWorkspace(root));
  const document = parseRoadmap(file.text, sources).document;
  const refusal = unclosedFenceRefusal(document);
  if (refusal) return mutationFail(refusal.code, refusal.message);
  const item = document.items.find((candidate) => candidate.id === input.id.trim());
  if (!item) return mutationFail("NOT_FOUND", `Roadmap item not found: ${input.id}`);

  const changes: RoadmapFieldChange[] = [];
  if (title !== undefined && title !== item.title) changes.push({ field: TITLE_FIELD, from: item.title, to: title });
  const given = givenCells(input);
  for (const field of ROADMAP_FIELDS) {
    const next = given[field];
    const current = roadmapFieldValue(item, field);
    if (next !== undefined && next !== canonicalCell(field, current)) changes.push({ field, from: current, to: next });
  }
  // @req FR-NODE-268 AC-3
  for (const name of Object.values(SECTION_INPUTS)) {
    const next = sections.sections[name];
    const current = item.sections[name]?.text || ROADMAP_EMPTY;
    if (next !== undefined && next !== current) changes.push({ field: name, from: current, to: next });
  }
  const output: RoadmapWriteOutput = { id: item.id, dryRun, written: false, created: false, changes };
  if (changes.length === 0) {
    return withMutationEnvelope(mutationOk(output), mutationNoopEnvelope("update_roadmap_item", file.relativePath, dryRun));
  }
  const reason = input.reason?.trim() ?? "";
  const needsReason = changes.filter((change) => (ROADMAP_REASON_REQUIRED_FIELDS as readonly string[]).includes(change.field)).map((change) => change.field);
  if (needsReason.length > 0 && !reason) {
    return mutationFail("USAGE", `reason is required to change ${needsReason.join(", ")}: a plan change is recorded with why it moved`);
  }
  const planned = planRoadmapItemChanges(file, document, item, changes, date.value, reason || ROADMAP_EMPTY);
  if (!planned.ok) return mutationFail(planned.code, planned.message);
  return commitRoadmapWrite("update_roadmap_item", file, planned.operations, sources, output, { dryRun, create: false });
}
