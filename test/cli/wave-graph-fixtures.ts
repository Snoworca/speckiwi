// Workspaces for the work-graph readers (`orchestrate wave status|show|actions|check`): a copy of the
// `valid-basic` workspace whose one scope document holds the requirements a test states, a 2.0.0 work
// graph, and a run journal whose first line references that graph by path and sha256 digest.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { main } from "../../src/cli/index.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";
import { writeUnder } from "../core/orchestrator/sds-fixtures.js";

export const JOURNAL = "kiwi/waves.jsonl";
export const GRAPH = "waves/waves.json";
export const RUN = "r1";

export type Line = Record<string, unknown>;

export interface RequirementSpec {
  /** `FR-ARCH-<nnn>`. */
  readonly id: string;
  readonly title?: string;
  readonly status?: string;
  readonly stability?: string;
  readonly target?: string;
  /** AC numbers and whether each is checked. */
  readonly acs: ReadonlyArray<{ readonly n: number; readonly checked?: boolean }>;
  /** The Covers cell of one Verification Evidence row; no row when absent. */
  readonly covers?: string;
  readonly dependsOn?: readonly string[];
  readonly rationale?: string;
}

function block(spec: RequirementSpec): string {
  const evidence = spec.covers === undefined ? [] : [`| VE-1 | test | test/x.test.ts | ${spec.covers} | - |`];
  const traces = (spec.dependsOn ?? []).map((id) => `| Requirement | ${id} | depends_on | - |`);
  return [
    `### ${spec.id} — ${spec.title ?? `Requirement ${spec.id}`}`,
    "",
    "| Field | Value |",
    "| --- | --- |",
    "| Type | functional |",
    `| Target | ${spec.target ?? "v1.0.0"} |`,
    `| Status | ${spec.status ?? "planned"} |`,
    "| Priority | high |",
    "| Tags | - |",
    "| Risk | low |",
    `| Stability | ${spec.stability ?? "evolving"} |`,
    "| Verification Method | test |",
    "| GitHub Issue | - |",
    "| Related Docs | - |",
    "",
    "#### Requirement",
    "",
    "The system shall do the thing.",
    "",
    "#### Rationale",
    "",
    spec.rationale ?? "Fixture.",
    "",
    "#### Acceptance Criteria",
    "",
    ...spec.acs.map((ac) => `- [${ac.checked === true ? "x" : " "}] AC-${ac.n}: The thing ${ac.n} holds.`),
    "",
    "#### Verification Evidence",
    "",
    "| Evidence ID | Type | Reference | Covers | Notes |",
    "| --- | --- | --- | --- | --- |",
    ...evidence,
    "",
    "#### Trace Links",
    "",
    "| Type | Reference | Relation | Notes |",
    "| --- | --- | --- | --- |",
    ...traces,
    "",
    "#### Research / Analysis",
    "",
    "- -",
    "",
    "#### Implementation Notes",
    "",
    "- -",
    "",
    "#### Change Notes",
    "",
    "| Date | Change | Reason |",
    "| --- | --- | --- |",
    "| 2026-11-05 | Created | Fixture |",
    ""
  ].join("\n");
}

/** The `valid-basic` scope document holding exactly `specs`. */
export function scopeDocument(specs: readonly RequirementSpec[]): string {
  return [
    "# Product Architecture",
    "",
    "| Field | Value |",
    "|---|---|",
    "| Document Type | scope_srs |",
    "| Scope | ARCH |",
    "| Scope Name | Product Architecture |",
    "",
    "## 1. Scope Overview",
    "",
    "Fixture architecture scope.",
    "",
    "## 2. Scope Boundaries",
    "",
    "### In Scope",
    "",
    "- Markdown requirements",
    "",
    "### Out of Scope",
    "",
    "- External database",
    "",
    "## 3. Assumptions and Constraints",
    "",
    "- None",
    "",
    "## 4. Requirements",
    "",
    ...specs.map(block)
  ].join("\n");
}

/** sha256 of the bytes, lowercase hex: the digest a `graph` reference carries. */
export function digestOf(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function node(n: number, acs: readonly string[], extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { wave: `wave-${n}`, title: `node ${n}`, purpose: `purpose ${n}`, acs, done_when: [], files: [`src/w${n}.ts`], ...extra };
}

export function graphOf(nodes: readonly Record<string, unknown>[], edges: readonly Record<string, unknown>[] = [], extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { schema_version: "2.0.0", run_id: RUN, title: "graph", scope: { target: "v1.0.0" }, nodes, edges, ...extra };
}

/** A wave-state line of the run. */
export function waveLine(n: number, status: string, extra: Line = {}): Line {
  return {
    schema_version: "2.0.0",
    ts: `2026-11-05T0${n}:00:00.000Z`,
    run_id: RUN,
    engine: "kiwi-orchestrator",
    wave: `wave-${n}`,
    order: n,
    target: "v1.0.0",
    status,
    summary: `wave ${n} ${status}`,
    ...extra
  };
}

/** A `node-complete-action` line; a line without `result` is the intent. */
export function actionLine(n: number, actionId: string, completionRef: string, extra: Line = {}): Line {
  return {
    schema_version: "2.0.0",
    ts: "2026-11-05T09:30:00.000Z",
    run_id: RUN,
    engine: "kiwi-orchestrator",
    verb: "node-complete-action",
    wave: `wave-${n}`,
    action_id: actionId,
    completion_ref: completionRef,
    attempt: 1,
    ...extra
  };
}

export interface WorkspaceSpec {
  readonly requirements: readonly RequirementSpec[];
  readonly graph?: Record<string, unknown>;
  /** The run's lines after the first; the first line is a `pending` line of wave-1 carrying the graph reference. */
  readonly lines?: readonly Line[];
  /** Replaces the generated first line. */
  readonly firstLine?: Line | null;
  readonly files?: Record<string, string>;
  /** No journal file at all. */
  readonly noJournal?: boolean;
}

export interface Workspace {
  readonly root: string;
  readonly graphText: string;
}

/** The first line of the run: it references the graph by path and digest. */
export function firstLineFor(graphText: string, extra: Line = {}): Line {
  return { ...waveLine(1, "pending"), graph: { path: GRAPH, digest: digestOf(graphText) }, ...extra };
}

export async function workGraphWorkspace(spec: WorkspaceSpec): Promise<Workspace> {
  const root = await copyFixtureWorkspace("valid-basic");
  await writeUnder(root, "docs/spec/10.product-architecture.srs.md", scopeDocument(spec.requirements));
  const graphText = spec.graph === undefined ? "" : `${JSON.stringify(spec.graph, null, 2)}\n`;
  if (spec.graph !== undefined) await writeUnder(root, GRAPH, graphText);
  if (spec.noJournal !== true) {
    const first = spec.firstLine === undefined ? (spec.graph === undefined ? null : firstLineFor(graphText)) : spec.firstLine;
    const lines = [...(first === null ? [] : [first]), ...(spec.lines ?? [])];
    await writeUnder(root, JOURNAL, lines.map((line) => `${JSON.stringify(line)}\n`).join(""));
  }
  for (const [relativePath, text] of Object.entries(spec.files ?? {})) await writeUnder(root, relativePath, text);
  return { root, graphText };
}

export interface Run {
  readonly exit: number;
  readonly payload: Record<string, unknown>;
}

export async function orchestrate(root: string, argv: readonly string[]): Promise<Run> {
  const pipes = { stdout: new PassThrough(), stderr: new PassThrough() };
  const exit = await main(["--root", root, "orchestrate", ...argv, "--json"], pipes);
  const text = pipes.stdout.read()?.toString() ?? "";
  return { exit, payload: text.length > 0 ? (JSON.parse(text) as Record<string, unknown>) : {} };
}

export async function bytesOf(root: string, relativePath: string): Promise<string> {
  return readFile(path.join(root, relativePath), "utf8");
}
