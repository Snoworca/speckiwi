import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { JOURNAL_WRITER_STAMP, ORCHESTRATE_TOOL_BINDINGS, orchestrateVerbKind } from "../../src/cli/commands/orchestrate.js";
import { writeUnder } from "../core/orchestrator/sds-fixtures.js";
import { GRAPH, JOURNAL, actionLine, bytesOf, digestOf, firstLineFor, graphOf, node, orchestrate, waveLine, workGraphWorkspace, type RequirementSpec } from "./wave-graph-fixtures.js";

// FR-NODE-251 — `orchestrate wave actions` computes the due completion actions of finished nodes, the
// text to send, the channel alias and an idempotency key, and sends nothing itself.

const DONE: RequirementSpec = { id: "FR-ARCH-001", acs: [{ n: 1, checked: true }], covers: "all" };
const NOTIFY = { kind: "notify", id: "tell", channel: "team-chat", message: "{wave} {title} done: {acs_done}/{acs_total} in {run_id}, issues {github_issues}, at {completed_at}, for {purpose}" };
const NOTE = { kind: "instruction", id: "note", text: "update the board", blocking: true };
const CITE = { "test/cite.test.ts": "// @req FR-ARCH-001 AC-1\n" };

interface ActionRow {
  wave: string;
  action_id: string;
  kind: string;
  key: string;
  state: string;
  blocking: boolean;
  channel?: string;
  text?: string;
  message?: string;
  append?: { intent: Record<string, unknown>; result: Record<string, unknown> };
}

function rows(payload: Record<string, unknown>): ActionRow[] {
  return payload.actions as ActionRow[];
}

async function finished(extra: { lines?: Record<string, unknown>[]; files?: Record<string, string>; nodeExtra?: Record<string, unknown> } = {}) {
  return workGraphWorkspace({
    requirements: [DONE],
    graph: graphOf([node(1, ["FR-ARCH-001 AC-1"], { on_complete: [NOTIFY, NOTE], github_issues: [12, "org/repo#3"], ...extra.nodeExtra })]),
    lines: extra.lines ?? [waveLine(1, "complete")],
    files: extra.files ?? CITE
  });
}

describe("FR-NODE-251 AC-1 a read verb that always scans and finds the graph itself", () => {
  // @req FR-NODE-251 AC-1
  it("FR-NODE-251 AC-1 is a read verb, offers no option that skips the scan, and leaves the journal and the graph unchanged", async () => {
    expect(orchestrateVerbKind(["wave", "actions"])).toBe("read");
    const binding = ORCHESTRATE_TOOL_BINDINGS.find((entry) => entry.tool === "orchestrate_wave_actions");
    expect(binding?.kind).toBe("read");
    expect(binding?.options.map((option) => option.flag).sort()).toEqual(["--engine", "--journal", "--run-id", "--waves"]);
    const { root, graphText } = await finished();
    const journal = await bytesOf(root, JOURNAL);
    const run = await orchestrate(root, ["wave", "actions"]);
    expect(run.exit, JSON.stringify(run.payload)).toBe(0);
    expect(await bytesOf(root, JOURNAL)).toBe(journal);
    expect(await bytesOf(root, GRAPH)).toBe(graphText);
    const refused = await orchestrate(root, ["wave", "actions", "--with-tests"]);
    expect(refused.exit).not.toBe(0);
  });

  // @req FR-NODE-251 AC-1
  it("FR-NODE-251 AC-1 the node state is scanned: an AC no test cites holds the node's actions as held-unverified", async () => {
    const { root } = await finished({ files: {} });
    const run = await orchestrate(root, ["wave", "actions", "--run-id", "r1"]);
    expect(run.exit, JSON.stringify(run.payload)).toBe(0);
    expect(run.payload.cited_checked).toBe(true);
    expect(rows(run.payload).map((row) => row.state)).toEqual(["held-unverified", "held-unverified"]);
    expect(rows(run.payload).some((row) => row.append !== undefined)).toBe(false);
  });

  // @req FR-NODE-251 AC-1
  it("FR-NODE-251 AC-1 without --waves it reads the graph of the run's latest redecompose line", async () => {
    const v2 = `${JSON.stringify(graphOf([node(1, ["FR-ARCH-001 AC-1"], { on_complete: [{ kind: "notify", id: "v2", channel: "team" }] })]))}\n`;
    const { root } = await finished({
      lines: [waveLine(1, "in_progress", { phase: "redecompose", graph: { path: "waves/v2.json", digest: digestOf(v2) } }), waveLine(1, "complete")],
      files: { ...CITE, "waves/v2.json": v2 }
    });
    const run = await orchestrate(root, ["wave", "actions", "--run-id", "r1"]);
    expect(run.exit, JSON.stringify(run.payload)).toBe(0);
    expect(rows(run.payload).map((row) => row.action_id)).toEqual(["v2"]);
  });
});

describe("FR-NODE-251 AC-3 AC-4 the reported states", () => {
  // @req FR-NODE-251 AC-3 AC-4
  it("FR-NODE-251 AC-3 AC-4 a sent, waived, interrupted or failed action is reported in that state and is never due", async () => {
    const lines = [waveLine(1, "complete"), actionLine(1, "tell", "L2"), actionLine(1, "tell", "L2", { result: "failed", error: "503" }), actionLine(1, "note", "L2")];
    const { root } = await finished({ lines });
    const run = await orchestrate(root, ["wave", "actions", "--run-id", "r1"]);
    expect(run.exit, JSON.stringify(run.payload)).toBe(0);
    expect(rows(run.payload).map((row) => [row.action_id, row.state])).toEqual([
      ["tell", "failed"],
      ["note", "interrupted"]
    ]);
  });
});

describe("FR-NODE-251 AC-2 AC-5 what a due action carries", () => {
  // @req FR-NODE-251 AC-2 AC-5
  it("FR-NODE-251 AC-2 AC-5 carries its key, kind, alias or text, blocking, the rendered message and the lines to append", async () => {
    const { root } = await finished();
    const run = await orchestrate(root, ["wave", "actions", "--run-id", "r1"]);
    expect(run.exit, JSON.stringify(run.payload)).toBe(0);
    const [tell, note] = rows(run.payload);
    expect(tell).toMatchObject({ wave: "wave-1", action_id: "tell", kind: "notify", key: "r1:wave-1:tell:L2", state: "due", blocking: false, channel: "team-chat" });
    expect(tell?.message).toBe("wave-1 node 1 done: 1/1 in r1, issues 12, org/repo#3, at 2026-11-05T01:00:00.000Z, for purpose 1");
    expect(note).toMatchObject({ action_id: "note", kind: "instruction", key: "r1:wave-1:note:L2", state: "due", blocking: true, text: "update the board" });
    expect(note?.message).toBe("wave-1 node 1 is complete in run r1: 1 of 1 acceptance criteria done.");
    expect(tell?.append?.intent).toMatchObject({ run_id: "r1", engine: "kiwi-orchestrator", verb: "node-complete-action", wave: "wave-1", action_id: "tell", completion_ref: "L2", attempt: 1 });
    expect(tell?.append?.intent).not.toHaveProperty("result");
    expect(tell?.append?.result).toMatchObject({ ...tell?.append?.intent, result: "sent" });
  });

  // @req FR-NODE-251 AC-5
  it("FR-NODE-251 AC-5 the lines to append are accepted by journal append, and once written the action is no longer due", async () => {
    // A journal that journal append accepts: stamped lines, and a passing wave-verify before the complete line.
    const stamped = { writer: JOURNAL_WRITER_STAMP, verification: { verdict: "pass" } };
    const { root, graphText } = await workGraphWorkspace({
      requirements: [DONE],
      graph: graphOf([node(1, ["FR-ARCH-001 AC-1"], { on_complete: [NOTIFY, NOTE] })]),
      firstLine: null,
      lines: [],
      files: CITE
    });
    await writeUnder(root, JOURNAL, [firstLineFor(graphText, { writer: JOURNAL_WRITER_STAMP }), waveLine(1, "in_progress", { ...stamped, phase: "wave-verify" }), waveLine(1, "complete", stamped)].map((line) => `${JSON.stringify(line)}\n`).join(""));
    const first = await orchestrate(root, ["wave", "actions", "--run-id", "r1"]);
    const [tell] = rows(first.payload);
    for (const line of [tell?.append?.intent, tell?.append?.result]) {
      const appended = await orchestrate(root, ["journal", "append", "--run-id", "r1", "--payload", JSON.stringify(line)]);
      expect(appended.exit, JSON.stringify(appended.payload)).toBe(0);
    }
    const again = await orchestrate(root, ["wave", "actions", "--run-id", "r1"]);
    expect(rows(again.payload).map((row) => [row.action_id, row.state])).toEqual([
      ["tell", "sent"],
      ["note", "due"]
    ]);
  });
});

describe("FR-NODE-251 AC-6 no journal, no due action", () => {
  // @req FR-NODE-251 AC-6
  it("FR-NODE-251 AC-6 a missing journal exits 1 with an error and reports no action", async () => {
    const { root } = await workGraphWorkspace({ requirements: [DONE], graph: graphOf([node(1, ["FR-ARCH-001 AC-1"], { on_complete: [NOTIFY] })]), noJournal: true, files: CITE });
    for (const argv of [["wave", "actions"], ["wave", "actions", "--run-id", "r1", "--waves", GRAPH]]) {
      const run = await orchestrate(root, argv);
      expect(run.exit, argv.join(" ")).toBe(1);
      expect(typeof run.payload.error).toBe("string");
      expect(run.payload).not.toHaveProperty("actions");
    }
  });

  // @req FR-NODE-251 AC-6
  it("FR-NODE-251 AC-6 a journal holding no line of the run exits 1 with an error and reports no action", async () => {
    const { root } = await finished();
    const run = await orchestrate(root, ["wave", "actions", "--run-id", "other", "--waves", GRAPH]);
    expect(run.exit).toBe(1);
    expect(typeof run.payload.error).toBe("string");
    expect(run.payload).not.toHaveProperty("actions");
  });
});

describe("FR-NODE-251 AC-7 the alias only", () => {
  // @req FR-NODE-251 AC-7
  it("FR-NODE-251 AC-7 carries the alias as the graph names it, and the computing modules open no connection and read no address table", async () => {
    const { root } = await finished();
    const run = await orchestrate(root, ["wave", "actions", "--run-id", "r1"]);
    expect(rows(run.payload)[0]?.channel).toBe("team-chat");
    expect(JSON.stringify(run.payload)).not.toMatch(/https?:\/\//);
    for (const file of ["src/core/orchestrator/completion-actions.ts", "src/core/orchestrator/wave-report.ts"]) {
      const source = await readFile(path.join(process.cwd(), file), "utf8");
      expect(source, file).not.toMatch(/from "node:|fetch\(|require\(/);
    }
  });
});
