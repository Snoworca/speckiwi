import path from "node:path";
import { describe, expect, it } from "vitest";
import { acquireArtifactLock, releaseArtifactLock } from "../../src/core/workflow/artifact-lock.js";
import { parseWorkflowJsonl } from "../../src/core/workflow/jsonl.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";
import { eventLine, jsonl, readText, runCli, sha256Of, treeDigest, writeText } from "../support/workflow-harness.js";

// @req IR-CLI-042 AC-3 / AC-6 — the CLI workflow mutations refuse before writing.
// @req IR-CLI-043 AC-1 — CLI logical delete reaches every record class core deletes.
// The invalid-JSONL clauses of IR-CLI-042 AC-3 and AC-6 are not asserted here: FR-NODE-193 made an
// unreadable line a warning an append steps over, and that requirement is the later, verified one.

const PIPELINE = "kiwi/pipeline.jsonl";
const WORKLOG = ".kiwi/sessions/run-a/worklog.jsonl";

async function workspace(): Promise<string> {
  const root = await copyFixtureWorkspace("valid-basic");
  await writeText(root, PIPELINE, jsonl(eventLine("event-1")));
  await writeText(root, WORKLOG, jsonl(eventLine("step-1"), eventLine("repair-1", "TASK_DONE", { repair: { kind: "rerun_with_fresh_artifact" } })));
  return root;
}

const COMMANDS: Array<[string, string[]]> = [
  ["pipeline-emit", ["workflow", "pipeline-emit", "--run-id", "run-a", "--event", eventLine("event-2")]],
  ["worklog-emit", ["workflow", "worklog-emit", "--run-id", "run-a", "--event", eventLine("step-2")]],
  ["repair-record", ["workflow", "repair-record", "--run-id", "run-a", "--event", eventLine("repair-2")]],
  ["logical-delete", ["workflow", "logical-delete", "--run-id", "run-a", "--record-type", "pipeline_event", "--record-id", "event-1", "--reason", "obsolete"]]
];

describe("IR-CLI-042 AC-3 / AC-6 — the CLI refuses stale hashes and forbidden owners before writing", () => {
  for (const [label, args] of COMMANDS) {
    it(`IR-CLI-042 AC-3 AC-6: ${label} rejects a stale artifact hash, exits 5 and writes nothing`, async () => {
      const root = await workspace();
      const before = await treeDigest(root);
      const run = await runCli(root, [...args, "--expected-sha256", sha256Of("a journal that is no longer there")]);
      expect(run.code).toBe(5);
      expect(run.json).toMatchObject({ ok: false, error: { code: "STALE_PATCH" }, diagnostics: [expect.objectContaining({ code: "SRS-E032" })], mutation: { written: false } });
      expect(await treeDigest(root)).toEqual(before);
    });

    it(`IR-CLI-042 AC-3: ${label} rejects a forbidden owner before writing`, async () => {
      const root = await workspace();
      const before = await treeDigest(root);
      const owner = label === "logical-delete" ? "kiwi-coder" : "";
      const run = await runCli(root, [...args, "--owner", owner]);
      expect(run.code).toBe(5);
      expect(run.json).toMatchObject({ ok: false, diagnosticsSummary: { byCode: { "SRS-E070": 1 } } });
      expect(await treeDigest(root)).toEqual(before);
    });
  }

  it("IR-CLI-042 AC-6: a fresh hash is accepted, so the stale refusal is about the hash and not the option", async () => {
    const root = await workspace();
    const run = await runCli(root, [...COMMANDS[0]![1], "--expected-sha256", sha256Of(await readText(root, PIPELINE))]);
    expect(run).toMatchObject({ code: 0, json: { ok: true, value: { written: true } } });
  });

  it("IR-CLI-042 AC-6: a worklog append that cannot take its artifact fails with exit 5 and leaves the worklog as it was", async () => {
    const root = await workspace();
    const held = await acquireArtifactLock({ artifactPath: path.join(root, WORKLOG), owner: "another-writer" });
    expect(held.ok).toBe(true);
    try {
      const before = await readText(root, WORKLOG);
      const run = await runCli(root, COMMANDS[1]![1]);
      expect(run.code).toBe(5);
      expect(run.json).toMatchObject({ ok: false, error: { code: "MUTATION_DENIED" }, diagnostics: [expect.objectContaining({ code: "SRS-E075" })], mutation: { written: false, journalState: "failed" } });
      expect(await readText(root, WORKLOG)).toBe(before);
    } finally {
      if (held.ok) await releaseArtifactLock(held.capability);
    }
  });

  it("IR-CLI-042 AC-6: a worklog append whose event is not a valid correction fails with exit 5 and writes nothing", async () => {
    const root = await workspace();
    const before = await treeDigest(root);
    const run = await runCli(root, ["workflow", "worklog-emit", "--run-id", "run-a", "--event", eventLine("fix-1", "CORRECTION")]);
    expect(run.code).toBe(5);
    expect(run.json).toMatchObject({ ok: false, diagnostics: [expect.objectContaining({ code: "SRS-E071" })], mutation: { written: false } });
    expect(await treeDigest(root)).toEqual(before);
  });
});

describe("IR-CLI-043 AC-1 — CLI logical delete reaches worklog events and repair records", () => {
  for (const [recordType, recordId] of [["worklog_event", "step-1"], ["repair_record", "repair-1"]] as const) {
    it(`IR-CLI-043 AC-1: logical-delete deletes a ${recordType} and keeps its line`, async () => {
      const root = await workspace();
      const original = await readText(root, WORKLOG);
      const run = await runCli(root, ["workflow", "logical-delete", "--run-id", "run-a", "--path", WORKLOG, "--record-type", recordType, "--record-id", recordId, "--reason", "obsolete"]);

      expect(run).toMatchObject({ code: 0, json: { ok: true, value: { written: true, targetRecord: { recordType, recordId, desiredState: "deleted" } } } });
      expect((await readText(root, WORKLOG)).startsWith(original)).toBe(true);
      expect((await parseWorkflowJsonl({ root }, WORKLOG)).latestEntries.map((entry) => entry.event.run_id)).not.toContain(recordId);
      const tail = await runCli(root, ["workflow", "worklog-tail", "--path", WORKLOG, "--include-deleted"]);
      const events = (tail.json.value as { events: Array<{ event: { run_id: string }; deletedBy?: string[] }> }).events;
      expect(events.find((entry) => entry.event.run_id === recordId)?.deletedBy).toHaveLength(1);
    });
  }
});
