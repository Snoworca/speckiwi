import { describe, expect, it } from "vitest";
import { applyWorkflowMutation, type WorkflowJournalState, type WorkflowMutationInput, type WorkflowMutationKind } from "../../../src/core/workflow/mutation.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";
import { eventLine, jsonl, readText, sha256Of, treeDigest, writeText, type Json } from "../../support/workflow-harness.js";

// @req FR-NODE-030 AC-4 — the write order is stated for mutations that write more than one artifact.
// Since the plan and PM task mutations left (FR-NODE-211 AC-1) every remaining kind writes exactly one:
// what is asserted here is that single write, and that the journal state it records is one of the
// five the requirement names — planned on the line, then confirmed (or skipped_dry_run) on the result.

const JOURNAL_STATES: readonly WorkflowJournalState[] = ["planned", "applied", "confirmed", "failed", "skipped_dry_run"];
const PIPELINE = "kiwi/pipeline.jsonl";
const WORKLOG = ".kiwi/sessions/run-a/worklog.jsonl";

const TARGETLESS_CORRECTION = eventLine("audit-1", "CORRECTION", { summary: "an audit note written as a correction" });

interface Case {
  file: string;
  /** The journal_state the written line records; a reclassification overlay records none. */
  lineState: "planned" | undefined;
  input: (journal: string) => WorkflowMutationInput;
  /** A second call that turns a dry-run preview into the write, when the kind needs one. */
  apply?: (journal: string, preview: Json) => WorkflowMutationInput;
}

const base = { owner: "kiwi-pm", runId: "run-a" } as const;

function reclassification(journal: string, dryRun: boolean, repairToken?: string): WorkflowMutationInput {
  const byteOffset = journal.indexOf(TARGETLESS_CORRECTION);
  return {
    kind: "workflow_record_reclassification",
    owner: "kiwi-pm",
    runId: "run-a",
    reason: "an audit note, not a correction",
    jsonlPath: PIPELINE,
    recordType: "pipeline",
    line: journal.slice(0, byteOffset).split("\n").length,
    byteOffset,
    rawSha256: sha256Of(TARGETLESS_CORRECTION),
    eventKey: "kiwi-pm|audit-1",
    targetRunId: "audit-1",
    preimagePrefixSha256: sha256Of(journal),
    expectedSha256: sha256Of(journal),
    dryRun,
    ...(repairToken ? { repairToken } : {})
  };
}

// Keyed by the kind union, so a type check flags a mutation kind added later without a case here. No
// repository gate type-checks this file today (tsconfig.test.json does not include it), so that
// guarantee holds only where the file is compiled.
const CASE_BY_KIND: Record<WorkflowMutationKind, Case> = {
  pipeline_event_append: { file: PIPELINE, lineState: "planned", input: () => ({ ...base, kind: "pipeline_event_append", jsonlPath: PIPELINE, event: JSON.parse(eventLine("event-2")) }) },
  worklog_event_append: { file: WORKLOG, lineState: "planned", input: () => ({ ...base, kind: "worklog_event_append", jsonlPath: WORKLOG, event: JSON.parse(eventLine("event-2")) }) },
  workflow_repair_record: { file: WORKLOG, lineState: "planned", input: () => ({ ...base, kind: "workflow_repair_record", jsonlPath: WORKLOG, event: JSON.parse(eventLine("repair-2")) }) },
  workflow_logical_delete: { file: PIPELINE, lineState: "planned", input: () => ({ ...base, kind: "workflow_logical_delete", jsonlPath: PIPELINE, recordType: "pipeline_event", recordId: "event-1", reason: "obsolete" }) },
  workflow_record_reclassification: {
    file: PIPELINE,
    lineState: undefined,
    input: (journal) => reclassification(journal, true),
    apply: (journal, preview) => reclassification(journal, false, String(preview.repairToken))
  }
};
const CASES = Object.entries(CASE_BY_KIND).map(([label, item]) => ({ label, ...item }));

async function workspace(): Promise<{ root: string; journals: Record<string, string> }> {
  const root = await copyFixtureWorkspace("valid-basic");
  const journals = { [PIPELINE]: jsonl(eventLine("event-1"), TARGETLESS_CORRECTION), [WORKLOG]: jsonl(eventLine("event-1")) };
  for (const [relativePath, text] of Object.entries(journals)) await writeText(root, relativePath, text);
  return { root, journals };
}

function changedFiles(before: Record<string, string>, after: Record<string, string>): string[] {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((file) => before[file] !== after[file]).sort();
}

describe("FR-NODE-030 AC-4 — every mutation kind writes one artifact and records a named journal state", () => {
  for (const item of CASES) {
    it(`FR-NODE-030 AC-4: ${item.label} writes only its own journal, and its journal states are the named ones`, async () => {
      const { root, journals } = await workspace();
      const journal = journals[item.file]!;
      const before = await treeDigest(root);

      const first = await applyWorkflowMutation({ root }, item.input(journal));
      expect(first.ok, JSON.stringify(first.error)).toBe(true);
      const result = item.apply ? await applyWorkflowMutation({ root }, item.apply(journal, first.value as unknown as Json)) : first;
      expect(result.ok, JSON.stringify(result.error)).toBe(true);

      expect(changedFiles(before, await treeDigest(root))).toEqual([item.file]);
      expect(result.value).toMatchObject({ written: true, journalState: "confirmed", pendingOperations: [], completedOperations: [`write:${item.label}`, `confirm:${item.label}`] });
      expect(result.mutation?.journalState).toBe("confirmed");

      const appended = JSON.parse((await readText(root, item.file)).slice(journal.length).trim()) as Json;
      expect(appended.journal_key).toBe(result.value?.journalKey);
      expect(appended.journal_state).toBe(item.lineState);
      for (const state of [first.value?.journalState, result.value?.journalState, appended.journal_state].filter((value) => value !== undefined)) {
        expect(JOURNAL_STATES).toContain(state);
      }
    });
  }

  it("FR-NODE-030 AC-4: a dry run of every kind writes nothing and records skipped_dry_run", async () => {
    for (const item of CASES) {
      const { root, journals } = await workspace();
      const before = await treeDigest(root);
      const preview = await applyWorkflowMutation({ root }, { ...item.input(journals[item.file]!), dryRun: true });
      expect(preview, item.label).toMatchObject({ ok: true, value: { written: false, journalState: "skipped_dry_run" } });
      expect(await treeDigest(root), item.label).toEqual(before);
    }
  });
});
