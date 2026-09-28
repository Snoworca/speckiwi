import { mkdir, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { copyFixtureWorkspace } from "./fixture-utils.js";

/**
 * A workflow workspace whose units of work are lite SDS files (FR-NODE-211 AC-2, AC-4). Each SDS path
 * names one work-order state: the sds-id is the file name, and the kiwi-pm session for it lives under
 * `.kiwi/sessions/{sds_id}/`.
 */
export interface WorkflowFixture {
  root: string;
  /** The sds-id of {@link sdsPath}, whose kiwi-pm session is part-way through. */
  runId: string;
  /** Agreed, with a session still running: `resume-session`. */
  sdsPath: string;
  /** Agreed, with no session yet: `execute-sds`. */
  freshSdsPath: string;
  /** Still draft: `create-sds`, because kiwi-sds has not finished it. */
  draftSdsPath: string;
  /** Names a requirement that does not exist, so `sds check` reports an error: `fix-artifact`. */
  invalidSdsPath: string;
  /** Agreed, with a blocked session record: `blocked`. */
  blockedSdsPath: string;
  /** Agreed, with every session record done: `complete`. */
  completeSdsPath: string;
}

async function write(root: string, relativePath: string, text: string): Promise<void> {
  const absolutePath = path.join(root, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, text, "utf8");
}

/** A lite SDS (SDS-MD-Rules §9) over FR-ARCH-001, or over `requirementId` when a case needs another. */
function liteSds(sdsId: string, status: "draft" | "agreed", requirementId = "FR-ARCH-001", target = "v1.0.0"): string {
  return [
    `# SDS: ${sdsId}`,
    "",
    "| Field | Value |",
    "|---|---|",
    "| Document Type | sds |",
    "| Profile | lite |",
    `| Target | ${target} |`,
    `| Status | ${status} |`,
    "| Date | 2026-09-27 |",
    "",
    "## Interfaces",
    "",
    "### Files",
    "",
    `- \`src/${sdsId}.ts\` — fixture unit @req ${requirementId}`,
    "  - `run(input: string): string` — answers the fixture ← cli",
    "",
    "## Acceptance Contracts",
    "",
    `- SDS-AC-1 (${requirementId} AC-1): WHEN run is called THE SYSTEM SHALL answer → \`run\``,
    "",
    "## Test Plan",
    "",
    "| SDS-AC | Test file | Case summary |",
    "|---|---|---|",
    `| SDS-AC-1 | test/${sdsId}.test.ts | answers |`,
    ""
  ].join("\n");
}

/** A kiwi-pm session in the SDS-era shape (kiwi-pm SKILL.md §2.2): one run per SDS, no task list. */
function pmState(sdsId: string, runStatus: "pending" | "running" | "done" | "failed" | "blocked"): string {
  return JSON.stringify({ run_id: sdsId, sds_path: `docs/sds/${sdsId}.sds.md`, target_slug: "v1.0.0", run: { status: runStatus, attempts: 1 } }, null, 2);
}

function event(runId: string, nextHint: string | null, taskId?: string): string {
  return JSON.stringify({
    ts: `2026-06-29T00:00:0${runId.length}.000Z`,
    schema_version: "1.0.0",
    skill: "kiwi-planner",
    run_id: runId,
    target: "v1.0.0",
    status: "TASK_DONE",
    summary: runId,
    next_hint: nextHint,
    ...(taskId ? { task_id: taskId } : {}),
    artifacts: { spec_files: [], plan_file: null, sidecar_file: null, analysis_dir: null },
    dry_run: false
  });
}

function srsBlock(index: number): string {
  const id = `FR-ARCH-${String(index + 10).padStart(3, "0")}`;
  return [
    `### ${id} — Workflow corpus requirement ${index}`,
    "",
    "| Field | Value |",
    "| --- | --- |",
    "| Type | functional |",
    "| Target | v1.0.0 |",
    "| Status | planned |",
    "| Priority | medium |",
    "| Tags | workflow, fixture, corpus |",
    "| Risk | low |",
    "| Stability | stable |",
    "| Verification Method | test |",
    "| GitHub Issue | - |",
    "| Related Docs | - |",
    "",
    "#### Requirement",
    "",
    "The workflow fixture corpus must include a realistic generated SRS requirement.",
    "",
    "#### Rationale",
    "",
    "Agent workflow tests need enough requirement content to make compact reads meaningful.",
    "",
    "#### Acceptance Criteria",
    "",
    "- [ ] AC-1: The generated fixture requirement is present.",
    "",
    "#### Verification Evidence",
    "",
    "| Evidence ID | Type | Reference | Covers | Notes |",
    "| --- | --- | --- | --- | --- |",
    "",
    "#### Trace Links",
    "",
    "| Type | Reference | Relation | Notes |",
    "| --- | --- | --- | --- |",
    "",
    "#### Research / Analysis",
    "",
    "- Fixture generated for REL-NODE-002.",
    "",
    "#### Implementation Notes",
    "",
    "- Generated in a temporary test workspace.",
    "",
    "#### Change Notes",
    "",
    "| Date | Change | Reason |",
    "| --- | --- | --- |",
    "| 2026-06-29 | Generated | Workflow fixture corpus |"
  ].join("\n");
}

async function writeSrsCorpus(root: string): Promise<void> {
  await write(root, "docs/spec/70.workflow-corpus.srs.md", ["# Workflow Corpus", "", "## 4. Requirements", "", ...Array.from({ length: 16 }, (_, index) => srsBlock(index + 1))].join("\n\n"));
}

export async function createWorkflowFixture(): Promise<WorkflowFixture> {
  const root = await copyFixtureWorkspace("valid-basic");
  await writeSrsCorpus(root);
  const runId = "workflow-run";
  const sdsPath = `docs/sds/${runId}.sds.md`;
  const freshSdsPath = "docs/sds/fresh-run.sds.md";
  const draftSdsPath = "docs/sds/draft-run.sds.md";
  const invalidSdsPath = "docs/sds/invalid-run.sds.md";
  const blockedSdsPath = "docs/sds/blocked-run.sds.md";
  const completeSdsPath = "docs/sds/complete-run.sds.md";

  await write(root, sdsPath, liteSds(runId, "agreed"));
  await write(root, `.kiwi/sessions/${runId}/pm-state.json`, pmState(runId, "running"));
  await write(root, `.kiwi/sessions/${runId}/worklog.jsonl`, `${event("worklog-a", null, `${runId}-1`)}\n${event("worklog-b", null)}\n`);
  await write(root, freshSdsPath, liteSds("fresh-run", "agreed"));
  await write(root, draftSdsPath, liteSds("draft-run", "draft"));
  await write(root, invalidSdsPath, liteSds("invalid-run", "agreed", "FR-NOPE-999"));
  await write(root, blockedSdsPath, liteSds("blocked-run", "agreed"));
  await write(root, ".kiwi/sessions/blocked-run/pm-state.json", pmState("blocked-run", "blocked"));
  await write(root, completeSdsPath, liteSds("complete-run", "agreed"));
  await write(root, ".kiwi/sessions/complete-run/pm-state.json", pmState("complete-run", "done"));
  await write(root, ".kiwi/sessions/complete-run/worklog.jsonl", `${event("complete-a", null, "complete-run-1")}\n`);
  await write(root, "docs/plan/legacy.plan.md", ["---", "run_id: legacy-run", "target: v1.0.0", "---", "# Legacy plan", ""].join("\n"));

  await write(root, "kiwi/pipeline.jsonl", `${event("pipeline-a", "kiwi-planner")}\n{bad json\n${event("pipeline-b", "kiwi-pm")}\n`);
  // Two lanes of one session with one mtime: resolving that session's pm-state without a lane is a tie.
  await write(root, ".kiwi/sessions/tie-run/lanes/a/pm-state.json", pmState("tie-run", "pending"));
  await write(root, ".kiwi/sessions/tie-run/lanes/b/pm-state.json", pmState("tie-run", "pending"));
  const mtime = new Date("2026-06-29T00:00:00Z");
  await utimes(path.join(root, ".kiwi/sessions/tie-run/lanes/a/pm-state.json"), mtime, mtime);
  await utimes(path.join(root, ".kiwi/sessions/tie-run/lanes/b/pm-state.json"), mtime, mtime);
  return { root, runId, sdsPath, freshSdsPath, draftSdsPath, invalidSdsPath, blockedSdsPath, completeSdsPath };
}
