import { createHash } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import type { Command } from "commander";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { buildCommand } from "../../src/cli/command.js";
import { ORCHESTRATE_TOOL_BINDINGS, orchestrateVerbKind, registerOrchestrateCommands } from "../../src/cli/commands/orchestrate.js";
import { canonicalJson } from "../../src/core/orchestrator/canonical-json.js";
import { toolSchemas } from "../../src/mcp/server.js";

// @req IR-CLI-091 — `orchestrate replay plan`, the CLI caller of `replayDeferredMutations`.
//
// The leaf and its MCP mirror land together on purpose. `orchestrateSpecs()` emits a CLI-only spec
// when a leaf has no entry in `ORCHESTRATE_TOOL_BINDINGS`, so registering the CLI half alone would
// ship a tool that is simply absent from the MCP surface, with nothing red to say so —
// `orchestrate_round_record` already shipped uncallable that way. AC-6 is what makes that visible.

const TOOL = "orchestrate_replay_plan";

function io() {
  return { stdout: new PassThrough(), stderr: new PassThrough() };
}

function drain(stream: PassThrough): string {
  return stream.read()?.toString() ?? "";
}

function orchestrateCommand(): Command {
  const pipes = io();
  const command = buildCommand({ io: pipes });
  registerOrchestrateCommands(command, { io: pipes });
  return command.commands.find((sub) => sub.name() === "orchestrate") as Command;
}

function leafCommand(...segments: string[]): Command {
  let cursor: Command = orchestrateCommand();
  for (const segment of segments) {
    const next = cursor.commands.find((sub) => sub.name() === segment);
    expect(next, `orchestrate ${segments.join(" ")} must be registered`).toBeDefined();
    cursor = next as Command;
  }
  return cursor;
}

function longFlags(command: Command): string[] {
  return command.options.map((option) => option.long).filter((flag): flag is string => typeof flag === "string");
}

async function tempRoot(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "speckiwi-replay-plan-"));
}

/** The key the requirement defines, computed here rather than taken from the implementation. */
function hashOf(args: unknown): string {
  return createHash("sha1").update(canonicalJson(args), "utf8").digest("hex");
}

interface Invocation {
  exit: number;
  text: string;
  body: Record<string, unknown> | null;
}

async function run(argv: string[]): Promise<Invocation> {
  const pipes = io();
  const exit = await main(argv, pipes);
  const text = `${drain(pipes.stdout)}${drain(pipes.stderr)}`;
  let body: Record<string, unknown> | null = null;
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    body = null;
  }
  return { exit, text, body };
}

/** Four entries: two identical `update_status` calls, one `add_completed_work` sharing their args. */
const ARGS_A = { id: "FR-NODE-182", target: "2.6.0-phase2-parallel-lanes" };
const ARGS_B = { id: "IR-CLI-091", reference: "src/cli/commands/orchestrate.ts" };

const QUEUE_LINES = [
  JSON.stringify({ tool: "update_status", args: ARGS_A, args_hash: hashOf(ARGS_A), ok: true, dry_run: false }),
  JSON.stringify({ tool: "update_status", args: ARGS_A, args_hash: hashOf(ARGS_A), ok: true, dry_run: false }),
  JSON.stringify({ tool: "add_completed_work", args: ARGS_A, args_hash: hashOf(ARGS_A), ok: true, dry_run: false }),
  JSON.stringify({ tool: "add_trace_link", args: ARGS_B, args_hash: hashOf(ARGS_B), ok: true, dry_run: false })
];

async function seedQueue(root: string, lines: string[] = QUEUE_LINES): Promise<string> {
  const queue = path.join(root, "deferred-mutations.jsonl");
  await writeFile(queue, `${lines.join("\n")}\n`, "utf8");
  return queue;
}

function callsOf(body: Record<string, unknown> | null): Array<Record<string, unknown>> {
  const value = (body?.value ?? body) as Record<string, unknown> | undefined;
  return (value?.calls ?? []) as Array<Record<string, unknown>>;
}

function indexAfterOf(body: Record<string, unknown> | null): Record<string, string[]> {
  const value = (body?.value ?? body) as Record<string, unknown> | undefined;
  return (value?.indexAfter ?? {}) as Record<string, string[]>;
}

// ---------------------------------------------------------------------------------------------

describe("IR-CLI-091 AC-1 — the leaf plans a harvested queue", () => {
  it("exits 0 and returns one call per queue entry, in the queue's order", async () => {
    const root = await tempRoot();
    const queue = await seedQueue(root);
    const result = await run(["orchestrate", "replay", "plan", "--queue", queue, "--json"]);

    expect(result.exit, result.text).toBe(0);
    const calls = callsOf(result.body);
    expect(calls).toHaveLength(QUEUE_LINES.length);
    expect(calls.map((call) => call.tool)).toEqual(["update_status", "update_status", "add_completed_work", "add_trace_link"]);

    // The whole plan reaches the caller, not just the parts the other cases happen to read. Without
    // these, a handler that dropped `argsHash` and returned a fabricated `indexAfter` would satisfy
    // every assertion in this file, while the criterion says it returns THE PLAN.
    expect(calls.map((call) => call.argsHash)).toEqual([hashOf(ARGS_A), hashOf(ARGS_A), hashOf(ARGS_A), hashOf(ARGS_B)]);
    expect(calls.map((call) => call.args)).toEqual([ARGS_A, ARGS_A, ARGS_A, ARGS_B]);
    expect(indexAfterOf(result.body)).toEqual({
      update_status: [hashOf(ARGS_A)],
      add_completed_work: [hashOf(ARGS_A)],
      add_trace_link: [hashOf(ARGS_B)]
    });
  });

  it("marks the repeated pair skip-duplicate and the shared-args different tool apply", async () => {
    // The queue deliberately carries the collision the design calls out: `update_status` and
    // `add_completed_work` with identical args, hence identical argsHash. Only the repeat of the
    // SAME pair may be skipped.
    const root = await tempRoot();
    const queue = await seedQueue(root);
    const result = await run(["orchestrate", "replay", "plan", "--queue", queue, "--json"]);

    expect(callsOf(result.body).map((call) => call.action)).toEqual(["apply", "skip-duplicate", "apply", "apply"]);
  });
});

describe("IR-CLI-091 AC-2 — --queue is required", () => {
  it("exits non-zero naming the option rather than planning an empty queue", async () => {
    const result = await run(["orchestrate", "replay", "plan", "--json"]);
    expect(result.exit).not.toBe(0);
    expect(result.text).toMatch(/--queue/);
  });
});

describe("IR-CLI-091 AC-3 — --index is optional and defaults to an empty index", () => {
  it("is declared optional on the leaf", () => {
    expect(longFlags(leafCommand("replay", "plan"))).toContain("--index");
  });

  it("marks every distinct pair apply when no index is supplied", async () => {
    const root = await tempRoot();
    const queue = await seedQueue(root, [QUEUE_LINES[0] as string, QUEUE_LINES[3] as string]);
    const result = await run(["orchestrate", "replay", "plan", "--queue", queue, "--json"]);

    expect(result.exit, result.text).toBe(0);
    expect(callsOf(result.body).map((call) => call.action)).toEqual(["apply", "apply"]);
  });

  it("refuses an index file that is not a map of tool to hash list", async () => {
    // Same boundary, same failure mode as a malformed queue line, so it gets the same treatment.
    // `new Set("abc")` is a set of three CHARACTERS: a string where a hash array belongs would not
    // throw, it would silently dedupe against nonsense and then persist that nonsense as the index.
    for (const bad of ["5", '"x"', "[]", '{"update_status":"abc"}', '{"update_status":[1,2]}', '{"update_status":null}']) {
      const root = await tempRoot();
      const queue = await seedQueue(root, [QUEUE_LINES[0] as string]);
      const index = path.join(root, "replay-index.json");
      await writeFile(index, bad, "utf8");

      const result = await run(["orchestrate", "replay", "plan", "--queue", queue, "--index", index, "--json"]);
      expect(result.exit, `${bad} must be refused, got: ${result.text}`).not.toBe(0);
      expect(result.text, `${bad} must name the index`).toContain("--index");
    }
  });

  it("honours an index entry whose tool name collides with Object.prototype", async () => {
    // The reader builds its own object from the parsed JSON, so it can drop a `__proto__` key the
    // same way the planner could — and dropping it means re-applying a mutation the index recorded.
    const root = await tempRoot();
    const args = { id: "P" };
    const queue = await seedQueue(root, [JSON.stringify({ tool: "__proto__", args })]);
    const index = path.join(root, "replay-index.json");
    // Written as literal JSON text, not via an object literal: `{ __proto__: [...] }` in source sets
    // the prototype, so `JSON.stringify` of it emits `{}` and the fixture would test nothing.
    // `JSON.parse` of this text, by contrast, does create an own property.
    await writeFile(index, `{"__proto__":["${hashOf(args)}"]}`, "utf8");

    const result = await run(["orchestrate", "replay", "plan", "--queue", queue, "--index", index, "--json"]);
    expect(result.exit, result.text).toBe(0);
    expect(callsOf(result.body).map((call) => call.action)).toEqual(["skip-duplicate"]);
  });

  it("skips a pair the supplied index already carries", async () => {
    // The counterpart of the case above: without this, `--index` could be parsed and ignored and
    // every assertion here would still pass.
    const root = await tempRoot();
    const queue = await seedQueue(root, [QUEUE_LINES[0] as string, QUEUE_LINES[3] as string]);
    const index = path.join(root, "replay-index.json");
    await writeFile(index, JSON.stringify({ update_status: [hashOf(ARGS_A)] }), "utf8");

    const result = await run(["orchestrate", "replay", "plan", "--queue", queue, "--index", index, "--json"]);

    expect(result.exit, result.text).toBe(0);
    expect(callsOf(result.body).map((call) => call.action)).toEqual(["skip-duplicate", "apply"]);
  });
});

describe("IR-CLI-091 AC-4 — the queue is JSONL, and a malformed line is an error", () => {
  it("ignores blank lines", async () => {
    const root = await tempRoot();
    const queue = path.join(root, "deferred-mutations.jsonl");
    await writeFile(queue, `\n${QUEUE_LINES[0] as string}\n\n${QUEUE_LINES[3] as string}\n\n`, "utf8");

    const result = await run(["orchestrate", "replay", "plan", "--queue", queue, "--json"]);
    expect(result.exit, result.text).toBe(0);
    expect(callsOf(result.body)).toHaveLength(2);
  });

  it("fails on a malformed line rather than skipping it", async () => {
    // Skipping silently is the dangerous failure: a lane's mutation would vanish from the plan and
    // the run would report success, which is precisely the traceability break the deferral exists
    // to prevent.
    const root = await tempRoot();
    const queue = path.join(root, "deferred-mutations.jsonl");
    // Blank line first, so the reported number can only be right if it counts FILE lines rather than
    // surviving entries — the two differ here, which is the point.
    await writeFile(queue, `\n${QUEUE_LINES[0] as string}\n{not json\n`, "utf8");

    const result = await run(["orchestrate", "replay", "plan", "--queue", queue, "--json"]);
    expect(result.exit).not.toBe(0);
    expect(result.text).toContain("deferred-mutations.jsonl");
    expect(result.text, "the criterion promises the line number, so it is asserted").toContain("line 3");
  });

  it("fails on a line that parses but is not an entry", async () => {
    // `JSON.parse` succeeds on `5`, `"x"` and `[]`. Casting the parsed array straight to the kernel's
    // input type would plan a call with `tool: undefined` and report success — the queue is written
    // by a skill, not by this code, so a well-formed-JSON-but-wrong-shape line is the realistic
    // corruption, not an impossible one.
    for (const bad of ["5", '"update_status"', "[]", '{"tool":"update_status"}', '{"args":{}}', '{"tool":7,"args":{}}']) {
      const root = await tempRoot();
      const queue = path.join(root, "deferred-mutations.jsonl");
      await writeFile(queue, `${QUEUE_LINES[0] as string}\n${bad}\n`, "utf8");

      const result = await run(["orchestrate", "replay", "plan", "--queue", queue, "--json"]);
      expect(result.exit, `${bad} must be refused, got: ${result.text}`).not.toBe(0);
      // Option, path AND line number together — the criterion promises all three in one message.
      expect(result.text, `${bad} must name the queue`).toContain("--queue");
      expect(result.text, `${bad} must name the path`).toContain("deferred-mutations.jsonl");
      expect(result.text, `${bad} must name the line`).toContain("line 2");
    }
  });

  it("fails when the queue file does not exist, naming the path it could not read", async () => {
    // Asserting only a non-zero exit would pass against a leaf that is not registered at all, so the
    // path has to appear in the message for this case to be about the missing file.
    const root = await tempRoot();
    const result = await run(["orchestrate", "replay", "plan", "--queue", path.join(root, "absent.jsonl"), "--json"]);
    expect(result.exit).not.toBe(0);
    expect(result.text).toContain("absent.jsonl");
  });
});

describe("IR-CLI-091 AC-5 — it is a read verb", () => {
  it("carries --json and not --dry-run", () => {
    const flags = longFlags(leafCommand("replay", "plan"));
    expect(flags).toContain("--json");
    expect(flags).not.toContain("--dry-run");
  });

  it("is classified read by orchestrateVerbKind", () => {
    expect(orchestrateVerbKind(["replay", "plan"])).toBe("read");
  });
});

describe("IR-CLI-091 AC-6 — the MCP mirror is generated from the same declaration", () => {
  it("declares the binding that the MCP spec generator looks up", () => {
    const binding = ORCHESTRATE_TOOL_BINDINGS.find((entry) => entry.path.join(" ") === "replay plan");
    expect(binding, "the leaf must be bound, or orchestrateSpecs emits a CLI-only spec").toBeDefined();
    expect(binding?.tool).toBe(TOOL);
    expect(binding?.kind).toBe("read");
  });

  it("registers an input schema carrying queue and index", () => {
    // Naming a tool is not registering one. `server.ts` derives the schema from the binding's
    // options, so an option omitted there leaves the field uncallable over MCP while the CLI works.
    const schema = toolSchemas[TOOL];
    expect(schema, `${TOOL} must have an input schema`).toBeDefined();
    expect(Object.keys(schema ?? {})).toEqual(expect.arrayContaining(["queue", "index"]));
  });
});
