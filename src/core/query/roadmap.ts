import { summarizeDiagnostics } from "../diagnostic.js";
import { fail, ok, type Result } from "../result.js";
import { roadmapDateCandidates, type RoadmapDateCandidate } from "../roadmap/actual-dates.js";
import { roadmapItemStatus, type RoadmapItemView } from "../roadmap/compute-roadmap.js";
import { loadRoadmap } from "../roadmap/load-roadmap.js";
import type { Diagnostic, DiagnosticsSummary, ProjectRoot } from "../types.js";
import { pageSlice, type PageInfo } from "./discovery.js";

// @req IR-CLI-115 IR-MCP-009
//
// The roadmap's JSON form: what `speckiwi roadmap list|show|check --json` prints and what the MCP
// readers return, built here once so the two surfaces cannot answer differently. List and show carry
// `schema: 1`; the file on disk stays the only source, and this output is generated from it.

export const ROADMAP_OUTPUT_SCHEMA = 1;

export interface RoadmapListOptions {
  asOf?: string;
  /** A computed status; the surfaces offer only the values of `ROADMAP_STATUSES`. */
  status?: string;
  kind?: string;
  /** An entry of the item's own `Targets`. */
  target?: string;
  /** The `Milestone` the item belongs to. */
  milestone?: string;
  offset?: number;
  limit?: number;
}

export interface RoadmapListOutput {
  schema: typeof ROADMAP_OUTPUT_SCHEMA;
  asOf: string;
  /** `docs/roadmap.md@sha256:<hex>`, or null when the file does not exist. */
  source: string | null;
  items: RoadmapItemView[];
  page: PageInfo;
}

export type RoadmapShownItem = RoadmapItemView & { actualDateCandidates: RoadmapDateCandidate[] };

export interface RoadmapShowOutput {
  schema: typeof ROADMAP_OUTPUT_SCHEMA;
  asOf: string;
  source: string;
  item: RoadmapShownItem;
}

export interface RoadmapCheckOutput {
  source: string | null;
  /** False while any error-level diagnostic remains. */
  passed: boolean;
  diagnostics: Diagnostic[];
  diagnosticsSummary: DiagnosticsSummary;
}

// @req IR-CLI-115 AC-1 AC-5 AC-6
export async function listRoadmapItems(root: ProjectRoot, options: RoadmapListOptions = {}): Promise<Result<RoadmapListOutput>> {
  const loaded = await loadRoadmap(root, options.asOf === undefined ? {} : { asOf: options.asOf });
  if (!loaded.ok) return loaded;
  const { read } = loaded.value;
  const matching = read.items.filter(
    (item) =>
      (options.status === undefined || item.status === options.status) &&
      (options.kind === undefined || item.kind === options.kind) &&
      (options.target === undefined || item.targets.includes(options.target)) &&
      (options.milestone === undefined || item.milestone === options.milestone)
  );
  const { items, page } = pageSlice(matching, { ...(options.offset !== undefined ? { offset: options.offset } : {}), ...(options.limit !== undefined ? { limit: options.limit } : {}) });
  return ok({ schema: ROADMAP_OUTPUT_SCHEMA, asOf: read.asOf, source: read.source, items, page });
}

// @req IR-CLI-115 AC-2 AC-5 AC-6
export async function getRoadmapItem(root: ProjectRoot, id: string, options: { asOf?: string } = {}): Promise<Result<RoadmapShowOutput>> {
  const loaded = await loadRoadmap(root, options);
  if (!loaded.ok) return loaded;
  const { read, document, sources } = loaded.value;
  const wanted = id.trim();
  // The views are computed from the document's items in order, so one index names both.
  const index = read.items.findIndex((candidate) => candidate.id === wanted);
  const view = read.items[index];
  const item = document?.items[index];
  if (!view || !item || !document || !sources || read.source === null) return fail("NOT_FOUND", `Roadmap item not found: ${id}`);
  const actualDateCandidates = roadmapDateCandidates(roadmapItemStatus(document, sources, item), sources, read.asOf);
  return ok({ schema: ROADMAP_OUTPUT_SCHEMA, asOf: read.asOf, source: read.source, item: { ...view, actualDateCandidates } });
}

// @req IR-CLI-115 AC-3 — the check reads no clock, so it takes no as-of date.
export async function checkRoadmapFile(root: ProjectRoot): Promise<Result<RoadmapCheckOutput>> {
  const loaded = await loadRoadmap(root);
  if (!loaded.ok) return loaded;
  const { source, diagnostics } = loaded.value.read;
  return ok({ source, passed: diagnostics.every((item) => item.severity !== "error"), diagnostics, diagnosticsSummary: summarizeDiagnostics(diagnostics) });
}
