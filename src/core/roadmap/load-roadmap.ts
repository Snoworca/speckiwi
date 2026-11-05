import { readdir } from "node:fs/promises";
import path from "node:path";
import { todayStamp } from "../date-stamp.js";
import { readUtf8File } from "../fs/read-text.js";
import { parseWorkspace } from "../parser/workspace-parser.js";
import { hasPrdFileSuffix, PRD_DIRECTORY } from "../prd/paths.js";
import { fail, ok, type Result } from "../result.js";
import type { Diagnostic, ParsedWorkspace, ProjectRoot, TextFile } from "../types.js";
import { checkRoadmap, computeRoadmapItems, type RoadmapItemView } from "./compute-roadmap.js";
import { isRoadmapDay } from "./roadmap-dates.js";
import { ROADMAP_PATH } from "./roadmap-grammar.js";
import type { RoadmapDocument, RoadmapSources } from "./roadmap-model.js";

// @req FR-NODE-255 AC-7 FR-PARSE-046 AC-8
//
// The disk side of the roadmap: it reads `docs/roadmap.md`, the workspace and the PRD file names, and
// hands them to the pure parser and computation. The clock is read here and nowhere below: the default
// as-of date is the writer's local calendar date from the shared date stamp.

export interface RoadmapRead {
  /** False when the workspace has no `docs/roadmap.md`; such a workspace has no item and no diagnostic. */
  readonly exists: boolean;
  /** `docs/roadmap.md@sha256:<hex>` of the bytes that were read, or null when the file does not exist. */
  readonly source: string | null;
  readonly asOf: string;
  readonly items: RoadmapItemView[];
  readonly diagnostics: Diagnostic[];
}

async function prdFileNames(rootPath: string): Promise<string[]> {
  const names = await readdir(path.join(rootPath, ...PRD_DIRECTORY.split("/"))).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return [] as string[];
    throw error;
  });
  return names.filter(hasPrdFileSuffix).sort().map((name) => `${PRD_DIRECTORY}/${name}`);
}

/** The SRS facts of a parsed workspace, in the form the roadmap functions take. */
export async function roadmapSourcesOf(workspace: ParsedWorkspace): Promise<RoadmapSources> {
  return {
    targets: workspace.index.targets,
    targetGoals: workspace.index.targetGoals,
    requirements: workspace.records,
    completedWork: workspace.index.completedWork,
    prdFiles: await prdFileNames(workspace.root.root)
  };
}

/** `docs/roadmap.md` as a text file, or undefined when the workspace has none. */
export async function readRoadmapFile(root: ProjectRoot): Promise<TextFile | undefined> {
  return readUtf8File(path.join(root.root, ...ROADMAP_PATH.split("/")), root.root).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
}

export function roadmapSourceStamp(file: TextFile): string {
  return `${ROADMAP_PATH}@sha256:${file.snapshot?.sha256 ?? ""}`;
}

/** Validates a caller's day (`label` names it in the refusal), or supplies today's local date when none is given. */
export function resolveRoadmapDate(value: string | undefined, label: string): Result<string> {
  if (value === undefined) return ok(todayStamp());
  return isRoadmapDay(value) ? ok(value) : fail("USAGE", `${label} must be a YYYY-MM-DD calendar date: ${value}`);
}

/** A read together with the parsed document and the SRS facts it was computed from; both null when the file does not exist. */
export interface LoadedRoadmap {
  readonly read: RoadmapRead;
  readonly document: RoadmapDocument | null;
  readonly sources: RoadmapSources | null;
}

// @req FR-NODE-255 AC-7
export async function loadRoadmap(root: ProjectRoot, options: { asOf?: string } = {}): Promise<Result<LoadedRoadmap>> {
  const asOf = resolveRoadmapDate(options.asOf, "as-of");
  if (!asOf.ok) return asOf;
  const file = await readRoadmapFile(root);
  if (!file) return ok({ read: { exists: false, source: null, asOf: asOf.value, items: [], diagnostics: [] }, document: null, sources: null });
  const sources = await roadmapSourcesOf(await parseWorkspace(root));
  const checked = checkRoadmap(file.text, sources);
  const read: RoadmapRead = {
    exists: true,
    source: roadmapSourceStamp(file),
    asOf: asOf.value,
    items: computeRoadmapItems(checked.document, sources, asOf.value),
    diagnostics: checked.diagnostics
  };
  return ok({ read, document: checked.document, sources });
}

// @req FR-NODE-255 AC-7
export async function readRoadmap(root: ProjectRoot, options: { asOf?: string } = {}): Promise<Result<RoadmapRead>> {
  const loaded = await loadRoadmap(root, options);
  return loaded.ok ? ok(loaded.value.read) : loaded;
}
