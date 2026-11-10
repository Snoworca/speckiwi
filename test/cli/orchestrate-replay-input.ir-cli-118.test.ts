import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { main } from "../../src/cli/index.js";
import { addCompletedWork } from "../../src/core/mutation/add-completed-work.js";
import { addVerificationEvidence } from "../../src/core/mutation/add-evidence.js";
import { addTraceLink } from "../../src/core/mutation/add-trace.js";
import { updateStatus } from "../../src/core/mutation/update-status.js";
import { deferrableMutationArgumentNames, deferrableMutationInputRefusal } from "../../src/core/orchestrator/replay-input.js";
import { resolveProjectRoot } from "../../src/core/project-root.js";
import { toolSchemas } from "../../src/mcp/server.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

// @req IR-CLI-118 — replay checks every deferred call's input before it applies any, and the MCP
// schemas name the characters a table cell refuses.
//
// SB15 (5.3.7): a lane deferred an add_trace_link whose notes held `|`. `replay plan` and
// `replay apply --dry-run` passed it, and the host's apply stopped at call 77 of 92, leaving the SRS
// partly applied and the run halted for a human.

const ID = "FR-ARCH-001";
const GOOD_TRACE = { id: ID, type: "Code", reference: "src/x.ts", relation: "related_to", notes: "fine" };
const PIPE_TRACE = { ...GOOD_TRACE, notes: "INTERRUPTED(PERMISSION_REVOKED|VOLUME_LOST)" };

interface Run {
  readonly exit: number;
  readonly payload: Record<string, unknown>;
}

async function run(root: string, argv: string[]): Promise<Run> {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const exit = await main(["--root", root, "orchestrate", ...argv, "--json"], { stdout, stderr });
  const text = stdout.read()?.toString() ?? "";
  return { exit, payload: text.length > 0 ? (JSON.parse(text) as Record<string, unknown>) : {} };
}

async function workspace(): Promise<string> {
  return copyFixtureWorkspace("valid-basic");
}

async function writeQueue(root: string, entries: Array<{ tool: string; args: unknown }>): Promise<void> {
  await writeFile(path.join(root, "queue.jsonl"), entries.map((entry) => `${JSON.stringify(entry)}\n`).join(""), "utf8");
}

async function planFile(root: string, entries: Array<{ tool: string; args: unknown }>): Promise<Run> {
  await writeQueue(root, entries);
  const planned = await run(root, ["replay", "plan", "--queue", "queue.jsonl"]);
  await writeFile(path.join(root, "plan.json"), JSON.stringify({ calls: planned.payload.calls, indexAfter: planned.payload.indexAfter }), "utf8");
  return planned;
}

async function specText(root: string): Promise<string> {
  return readFile(path.join(root, "docs", "spec", "10.product-architecture.srs.md"), "utf8");
}

/** One input per tool that its mutation refuses before it reads the SRS. */
const BAD_INPUTS: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
  ["add_trace_link", PIPE_TRACE],
  ["add_trace_link", { ...GOOD_TRACE, reference: "a\nb" }],
  ["add_verification_evidence", { id: ID, type: "test", reference: "  " }],
  ["add_verification_evidence", { id: ID, type: "test", reference: "docs/spec/90.appendix.md", covers: "AC-1..AC-3" }],
  ["add_verification_evidence", { id: ID, type: "test", reference: "docs/spec/90.appendix.md", notes: "a|b" }],
  ["update_status", { id: ID, status: "done" }],
  ["update_status", { id: ID, status: "implemented", reason: "x".repeat(501) }],
  ["add_completed_work", { date: "2026/11/10", summary: "s" }],
  ["add_completed_work", { date: "2026-11-10", summary: "line one\nline two" }],
  ["add_completed_work", { date: "2026-11-10", summary: "   " }]
];

/** Inputs whose shape no mutation can read: refused by the replay check before anything runs. */
const MALFORMED: ReadonlyArray<readonly [string, unknown]> = [
  ["add_trace_link", { id: ID, type: "Code", relation: "related_to" }],
  ["add_verification_evidence", "not an object"],
  ["update_status", { id: 7, status: "implemented" }],
  ["add_completed_work", { date: "2026-11-10", summary: "s", requirementIds: "FR-ARCH-001" }]
];

describe("IR-CLI-118 AC-1 — replay plan reports each queued call whose input its mutation would refuse", () => {
  it("lists the refused calls with index, tool and message beside the whole plan", async () => {
    const root = await workspace();
    const planned = await planFile(root, [
      { tool: "add_trace_link", args: GOOD_TRACE },
      { tool: "add_trace_link", args: PIPE_TRACE },
      { tool: "add_completed_work", args: { date: "2026/11/10", summary: "s" } }
    ]);
    expect(planned.exit).toBe(0);
    expect(planned.payload.calls).toHaveLength(3);
    expect(planned.payload.inputRefusals).toEqual([
      { index: 1, tool: "add_trace_link", message: expect.stringContaining("Trace Link notes cannot contain pipe or newline characters") },
      { index: 2, tool: "add_completed_work", message: expect.stringContaining("YYYY-MM-DD") }
    ]);
  });

  it("carries an empty list for a queue whose calls all pass", async () => {
    const root = await workspace();
    const planned = await planFile(root, [{ tool: "add_trace_link", args: GOOD_TRACE }]);
    expect(planned.exit).toBe(0);
    expect(planned.payload.inputRefusals).toEqual([]);
  });

  it.each(MALFORMED)("refuses a %s call whose arguments no mutation can read", async (tool, args) => {
    const root = await workspace();
    const planned = await planFile(root, [{ tool, args }]);
    expect(planned.payload.inputRefusals).toEqual([{ index: 0, tool, message: expect.any(String) }]);
  });
});

describe("IR-CLI-118 AC-2 — replay apply applies nothing while any remaining call fails its input check", () => {
  it.each([[[]], [["--dry-run"]]])("dispatches nothing and names every refused call (%j)", async (extra) => {
    const root = await workspace();
    await planFile(root, [
      { tool: "add_trace_link", args: GOOD_TRACE },
      { tool: "add_trace_link", args: PIPE_TRACE },
      { tool: "update_status", args: { id: ID, status: "done" } }
    ]);
    const before = await specText(root);
    const applied = await run(root, ["replay", "apply", "--plan", "plan.json", "--applied", "applied.jsonl", ...extra]);
    expect(applied.exit).toBe(1);
    const error = String(applied.payload.error);
    expect(error).toContain("srs-mutation-replay-failed");
    expect(error).toContain("#1 add_trace_link");
    expect(error).toContain("#2 update_status");
    expect(await specText(root)).toBe(before);
    expect(existsSync(path.join(root, "applied.jsonl"))).toBe(false);
  });
});

describe("IR-CLI-118 AC-3 — a plan whose calls all pass applies as before", () => {
  it("applies the trace link and records the attempt", async () => {
    const root = await workspace();
    await planFile(root, [{ tool: "add_trace_link", args: GOOD_TRACE }]);
    const applied = await run(root, ["replay", "apply", "--plan", "plan.json", "--applied", "applied.jsonl"]);
    expect(applied).toMatchObject({ exit: 0, payload: { ok: true, applied: 1 } });
    expect(await specText(root)).toContain("| Code | src/x.ts | related_to | fine |");
  });

  it("still stops at a call the SRS state refuses, after applying the ones before it", async () => {
    const root = await workspace();
    await planFile(root, [
      { tool: "add_trace_link", args: GOOD_TRACE },
      { tool: "add_trace_link", args: { ...GOOD_TRACE, id: "FR-NOPE-999" } }
    ]);
    const applied = await run(root, ["replay", "apply", "--plan", "plan.json", "--applied", "applied.jsonl"]);
    expect(applied.exit).toBe(1);
    expect(String(applied.payload.error)).toContain("(applied 1)");
  });
});

describe("IR-CLI-118 AC-4 — the mutation and the replay share one input check per tool", () => {
  async function mutate(tool: string, input: Record<string, unknown>) {
    const root = await resolveProjectRoot(await copyFixtureWorkspace("valid-basic"));
    const call = input as never;
    if (tool === "add_trace_link") return addTraceLink(root, call);
    if (tool === "add_verification_evidence") return addVerificationEvidence(root, call);
    if (tool === "update_status") return updateStatus(root, call);
    return addCompletedWork(root, call);
  }

  it.each(BAD_INPUTS)("%s refuses %j with the message the replay check reports", async (tool, input) => {
    const refusal = deferrableMutationInputRefusal(tool, input);
    expect(refusal, "the replay check passed an input the mutation refuses").not.toBeNull();
    const answer = await mutate(tool, input);
    expect(answer.ok).toBe(false);
    if (answer.ok) return;
    expect(answer.error?.message).toBe(refusal);
  });

  it.each([
    ["add_trace_link", GOOD_TRACE],
    ["add_verification_evidence", { id: ID, type: "test", reference: "docs/spec/90.appendix.md", covers: "AC-1", notes: "n" }],
    ["update_status", { id: ID, status: "in_progress", reason: "r" }],
    ["add_completed_work", { date: "2026-11-10", summary: "s", target: "v1.0.0" }]
  ])("%s passes %j through the check", (tool, input) => {
    expect(deferrableMutationInputRefusal(tool, input)).toBeNull();
  });
});

describe("IR-CLI-118 AC-5 — each table-cell field's MCP schema names the pipe and the line break", () => {
  const FIELDS: ReadonlyArray<readonly [string, readonly string[]]> = [
    ["add_trace_link", ["type", "reference", "relation", "notes"]],
    ["add_verification_evidence", ["type", "reference", "covers", "notes"]],
    ["add_completed_work", ["target", "scope", "summary", "requirementIds"]]
  ];

  it.each(FIELDS)("%s describes %j", (tool, fields) => {
    const json = z.toJSONSchema(z.object(toolSchemas[tool as keyof typeof toolSchemas] ?? {})) as { properties: Record<string, { description?: string }> };
    for (const field of fields) {
      const description = json.properties[field]?.description ?? "";
      expect(description, `${tool}.${field}`).toMatch(/pipe/);
      expect(description, `${tool}.${field}`).toMatch(/line break/);
    }
  });
});

describe("IR-CLI-118 AC-6 — a queued call is judged by the names its MCP tool declares", () => {
  it.each(["add_trace_link", "add_verification_evidence", "update_status", "add_completed_work"])("%s declares exactly its MCP input schema's names", (tool) => {
    const schemaNames = Object.keys(toolSchemas[tool as keyof typeof toolSchemas] ?? {}).sort();
    expect([...deferrableMutationArgumentNames(tool)].sort()).toEqual(schemaNames);
  });

  it("refuses a name the tool does not declare, which the mutation would drop without a word", async () => {
    const refusal = deferrableMutationInputRefusal("add_completed_work", { date: "2026-11-10", summary: "s", sds_id: "SDS-1" });
    expect(refusal).toContain("sds_id is not an argument of add_completed_work");
    const root = await workspace();
    const planned = await planFile(root, [{ tool: "update_status", args: { id: ID, status: "implemented", target: "v1.0.0" } }]);
    expect(planned.payload.inputRefusals).toEqual([{ index: 0, tool: "update_status", message: expect.stringContaining("target is not an argument of update_status") }]);
  });

  it("reads null as absent where the mutation does, and applies such calls", async () => {
    const root = await workspace();
    const calls = [
      { tool: "add_trace_link", args: { ...GOOD_TRACE, notes: null } },
      { tool: "add_verification_evidence", args: { id: ID, type: "test", reference: "docs/spec/90.appendix.md", covers: null, notes: null } },
      { tool: "add_completed_work", args: { date: "2026-11-10", summary: "s", target: null, reportPaths: null, requirementIds: null } }
    ];
    for (const call of calls) expect(deferrableMutationInputRefusal(call.tool, call.args), call.tool).toBeNull();
    await planFile(root, calls);
    const applied = await run(root, ["replay", "apply", "--plan", "plan.json", "--applied", "applied.jsonl"]);
    expect(applied).toMatchObject({ exit: 0, payload: { ok: true, applied: 3 } });
  });

  it("refuses a null reason, which update_status would read as text", () => {
    expect(deferrableMutationInputRefusal("update_status", { id: ID, status: "implemented", reason: null })).toContain("reason must be a string");
  });
});
