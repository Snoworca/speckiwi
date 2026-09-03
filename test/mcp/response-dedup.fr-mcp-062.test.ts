import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseWorkspace } from "../../src/core/parser/workspace-parser.js";
import { WORK_ORDER_ACTION_TOOLS } from "../../src/core/workflow/work-order.js";
import { workflowNextPlanTask } from "../../src/core/workflow/read.js";
import { DERIVATION_KEEPER, derivationSentence, toolSpecs, type ToolSpec } from "../../src/mcp/schemas.js";
import { createMcpServer, createSdkServer } from "../../src/mcp/server.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";
import { createWorkflowFixture, type WorkflowFixture } from "../fixtures/workflow-artifacts.js";

// @req FR-MCP-062 — a derived MCP reader delegates to the reader that owns the fact.
//
// Every call below goes through an SDK `Client` over `InMemoryTransport`, so what is measured is the
// protocol surface and not the adapter beneath it. That distinction is not decorative: a check that
// calls the registration handler directly cannot see a tool that failed to register, a schema that
// refuses the argument, a name that never reached `tools/list`, or a description that still tells an
// agent to make the call this requirement removed.
//
// WHAT THIS FILE DOES NOT HOLD, stated so it is not read into the green:
//  - AC-5's single-source claim in full. The delegation check below reads the two alias bodies, and
//    reading source is not running it; what proves the rule has one copy is the mutation recorded in
//    the requirement's evidence, which deletes the origin's rule and watches the alias's answer move.
//  - that the aliases are worth keeping. AC-3 and AC-4 assert the names are still reachable, which
//    is what `actionTool()` needs; they say nothing about whether an agent should call them.
//  - that a description is TRUE. AC-7 holds three things a machine can decide: the sentence the
//    registry composes for a tool is present verbatim in that tool description, the OTHER tool
//    names the description mentions are exactly the ones the declaration admits, and the field a
//    declaration names is a key the owner's reply carries over the same round trip. A description
//    can satisfy all three and still be wrong about what the tool does; only the composed half is
//    derived.
//  - that `resume` needs both of its conjuncts. Deleting `blocking !== true` from it is
//    behaviour-preserving and stays green, and so is substituting `blockedBy.length === 0` for it:
//    `selectNextTask` answers a task with an empty `blockedBy` or a null task with a non-empty one,
//    and its caller replaces `nextTask` with null whenever `blocking` holds, so all three predicates
//    agree on every reachable input. The invariant assertion under AC-1 is what fires the day those
//    branches split; nothing here separates the three today because nothing can.
//  - the CLI. `speckiwi workflow resume-hint` and `pipeline-next` share the core functions but are
//    not exercised here; `test/mcp/workflow-read-tools.test.ts` holds that parity.

const SRS_PATH = path.join("docs", "spec", "40.mcp-stdio-interface.srs.md");
const REQUIREMENT_ID = "FR-MCP-062";
const REPO_ROOT = path.resolve(".");

interface Session {
  client: Client;
  call: (name: string, args: Record<string, unknown>) => Promise<Record<string, unknown>>;
}

async function connect(root: string, label: string): Promise<Session> {
  const local = createMcpServer({ root, rootSource: "server-cwd-discovery" });
  const sdk = createSdkServer(local);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await sdk.connect(serverTransport);
  const client = new Client({ name: `speckiwi-${label}`, version: "1.0.0" }, { capabilities: {} });
  await client.connect(clientTransport);
  return {
    client,
    call: async (name, args) => {
      const result = (await client.callTool({ name, arguments: args })) as { content: Array<{ type: string; text: string }> };
      const text = result.content.find((item) => item.type === "text")?.text;
      if (text === undefined) throw new Error(`tools/call ${name} returned no text content`);
      return JSON.parse(text) as Record<string, unknown>;
    }
  };
}

function value(response: Record<string, unknown>): Record<string, unknown> {
  expect(response.ok, `${JSON.stringify(response).slice(0, 300)}`).toBe(true);
  return response.value as Record<string, unknown>;
}

// --- the bounds, read out of the requirement rather than written here ---------------------------

/**
 * Floors this file runs under, taken from the requirement's own AC-8.
 *
 * A floor written as a literal here is a floor a change to this file can lower, and lowering it
 * leaves no trace outside this file. `FR-MCP-060` AC-7 already paid for that lesson in this
 * repository and moved every one of its bounds into the requirement; this follows it.
 */
let floors: Map<string, number> | undefined;
let floorsFailure: unknown;

function floor(name: string): number {
  if (floorsFailure !== undefined) throw floorsFailure;
  const found = floors?.get(name);
  if (typeof found !== "number") {
    throw new Error(`${REQUIREMENT_ID} AC-8 names no floor \`${name}\`, and this assertion has nothing to run under`);
  }
  return found;
}

// --- fixtures -----------------------------------------------------------------------------------

/** A pipeline event, written by hand so the hint values here are this file's own and not a helper's. */
function pipelineEvent(runId: string, nextHint: string | null, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    ts: "2026-06-29T00:00:01.000Z",
    schema_version: "1.0.0",
    skill: "kiwi-planner",
    run_id: runId,
    target: "v1.0.0",
    status: "TASK_DONE",
    summary: runId,
    next_hint: nextHint,
    artifacts: { spec_files: [], plan_file: null, sidecar_file: null, analysis_dir: null },
    dry_run: false,
    ...extra
  });
}

/** The hint each fixture answers with, kept distinct so no single literal satisfies AC-2. */
const HINT_LIVE = "kiwi-coder";
const HINT_TOMBSTONE = "kiwi-wave-master";
const HINT_MAIN = "kiwi-pm";

let fixture: WorkflowFixture;
let session: Session;
/** A workspace carrying no pipeline journal at all, so `latestEvent` is null rather than merely stale. */
let bareSession: Session;
/**
 * A workspace whose journal ends in a logical-delete tombstone.
 *
 * It separates three things one fixture usually conflates. The visible answer differs from the raw
 * last line, so a reader that took `entries` instead of the projected `latestEntries` answers the
 * tombstone's hint. The answer moves under `includeDeleted`, so a tool that drops its arguments
 * answers the default. And its live hint differs from the main fixture's, so a value pinned to
 * either literal is wrong somewhere.
 */
let tombstoneSession: Session;

beforeAll(async () => {
  try {
    const workspace = await parseWorkspace({ root: REPO_ROOT });
    const record = workspace.records.find((item) => item.id === REQUIREMENT_ID);
    if (!record) throw new Error(`${SRS_PATH}: ${REQUIREMENT_ID} is not there, so this suite has no bounds to run under`);
    const ac8 = record.acceptanceCriteria.find((item) => item.id === "AC-8");
    if (!ac8) throw new Error(`${REQUIREMENT_ID} declares no AC-8, and this suite reads its bounds out of it`);
    floors = new Map([...ac8.text.matchAll(/`([A-Za-z]+) (\d+)`/g)].map((match) => [match[1] as string, Number(match[2])]));
  } catch (error) {
    floorsFailure = error;
  }
  fixture = await createWorkflowFixture();
  session = await connect(fixture.root, "dedup");
  bareSession = await connect(await copyFixtureWorkspace("valid-basic"), "dedup-bare");

  const tombstoneRoot = await copyFixtureWorkspace("valid-basic");
  const tombstone = pipelineEvent("tomb-1", HINT_TOMBSTONE, {
    status: "CORRECTION",
    corrects_run_id: "live-1",
    operation: { kind: "logical_delete" }
  });
  await mkdir(path.join(tombstoneRoot, "kiwi"), { recursive: true });
  await writeFile(
    path.join(tombstoneRoot, "kiwi", "pipeline.jsonl"),
    `${pipelineEvent("live-1", "kiwi-planner")}\n${pipelineEvent("live-2", HINT_LIVE)}\n${tombstone}\n`,
    "utf8"
  );
  tombstoneSession = await connect(tombstoneRoot, "dedup-tombstone");
});

afterAll(async () => {
  await session?.client.close();
  await bareSession?.client.close();
  await tombstoneSession?.client.close();
});

// --- AC-8 (read first: everything below divides by a bound it supplies) -------------------------

describe("FR-MCP-062 AC-8 — the suite runs under bounds the requirement sets, not its own", () => {
  it("reads every floor from the requirement and refuses an empty set of them", () => {
    expect(floorsFailure, "the requirement could not be read, so nothing bounds this file").toBeUndefined();
    expect(floors?.size ?? 0, "floors read out of AC-8").toBeGreaterThanOrEqual(1);
  });

  it("hands back the value the requirement wrote, and refuses a floor of zero", () => {
    // Two ways a bound stops bounding. `floor()` can stop reading the map — a version of it that
    // answered 0 to everything would leave every assertion below satisfied — and the requirement
    // can carry a zero, which is a lower bound every set meets.
    for (const [name, written] of floors ?? []) {
      expect(floor(name), `floor ${name} must be the number the requirement wrote`).toBe(written);
      expect(written, `floor ${name} is zero, which bounds nothing`).toBeGreaterThan(0);
    }
  });

  it("names no floor the requirement does not, and reads every floor the requirement names", async () => {
    const source = await readFile(path.join(REPO_ROOT, "test", "mcp", "response-dedup.fr-mcp-062.test.ts"), "utf8");
    const consumed = new Set([...source.matchAll(/\bfloor\("([A-Za-z]+)"\)/g)].map((match) => match[1] as string));
    expect(consumed.size, "no floor call was found, so the extraction has stopped matching").toBeGreaterThan(0);
    const unread = [...(floors?.keys() ?? [])].filter((name) => !consumed.has(name));
    expect(unread, "a floor the requirement names bounds nothing here, so deleting its assertion leaves no trace").toEqual([]);
  });
});

// --- AC-1 -------------------------------------------------------------------------------------

describe("FR-MCP-062 AC-1 — workflow_next_plan_task carries the resume decision itself", () => {
  /**
   * The three shapes the boolean is made of, so the assertion is not satisfied by a constant.
   * `resumable` has a next task and does not block, `blocking` blocks, `exhausted` has no next task.
   */
  const CASES = [
    { name: "resumable", path: () => fixture.planPath, expected: true },
    { name: "blocking", path: () => fixture.blockedPlanPath, expected: false },
    { name: "exhausted", path: () => fixture.completePlanPath, expected: false }
  ] as const;

  it("covers a resuming, a blocking and an exhausted plan", () => {
    expect(CASES.length).toBe(floor("resumeCases"));
    expect(new Set(CASES.map((item) => item.expected)).size).toBe(2);
  });

  for (const testCase of CASES) {
    it(`returns resume for the ${testCase.name} plan and it equals blocking !== true && nextTask !== null`, async () => {
      const next = value(await session.call("workflow_next_plan_task", { path: testCase.path() }));
      expect(Object.keys(next)).toContain("resume");
      expect(next.resume).toBe(next.blocking !== true && next.nextTask !== null);
      expect(next.resume).toBe(testCase.expected);
    });
  }

  /**
   * Why a predicate swapping `blocking` for `blockedBy` is not caught, measured rather than assumed.
   *
   * Over every plan fixture this repository ships, a non-null `nextTask` comes only with
   * `blocking === false` and an empty `blockedBy`. The two predicates are therefore extensionally
   * equal across the whole reachable space, and no fixture can separate them; substituting one for
   * the other is a behaviour-preserving edit today. The assertion below records the invariant that
   * makes it so, and goes red the day the validator first answers a task while blocking — which is
   * the day the two predicates stop agreeing and the substitution becomes a defect.
   */
  it("records the invariant that makes the resume predicate unsplittable by any shipped fixture", async () => {
    const plans = Object.entries(fixture).filter(([key, value]) => /[Pp]lanPath$/.test(key) && typeof value === "string");
    expect(plans.length, "plan fixtures walked").toBe(floor("planFixtures"));
    const violations: string[] = [];
    for (const [key, planPath] of plans) {
      const answer = await workflowNextPlanTask({ root: fixture.root }, { path: planPath as string });
      const inner = answer.value as { nextTask: unknown; blocking: boolean; blockedBy: string[] };
      if (inner.nextTask !== null && (inner.blocking === true || inner.blockedBy.length > 0)) violations.push(key);
    }
    expect(
      violations,
      "a fixture now answers a task while blocked, so `blocking` and `blockedBy` have separated and the resume predicate needs its own case"
    ).toEqual([]);
  });
});

// --- AC-2 -------------------------------------------------------------------------------------

describe("FR-MCP-062 AC-2 — workflow_pipeline_status carries the next hint itself", () => {
  it("answers at least the required number of distinct hint outcomes, so no literal satisfies it", async () => {
    const answers = await Promise.all([
      session.call("workflow_pipeline_status", {}),
      tombstoneSession.call("workflow_pipeline_status", {}),
      tombstoneSession.call("workflow_pipeline_status", { includeDeleted: true }),
      bareSession.call("workflow_pipeline_status", {})
    ]);
    const hints = answers.map((answer) => value(answer).nextHint);
    expect(new Set(hints.map((hint) => JSON.stringify(hint))).size).toBe(floor("hintOutcomes"));
    expect(hints).toEqual([HINT_MAIN, HINT_LIVE, HINT_TOMBSTONE, null]);
  });

  it("returns nextHint equal to the next_hint of the latestEvent in the same response", async () => {
    for (const [label, answer] of [
      ["main", await session.call("workflow_pipeline_status", {})],
      ["tombstone-visible", await tombstoneSession.call("workflow_pipeline_status", {})],
      ["tombstone-included", await tombstoneSession.call("workflow_pipeline_status", { includeDeleted: true })]
    ] as const) {
      const status = value(answer);
      expect(Object.keys(status), label).toContain("nextHint");
      const latest = status.latestEvent as { event: { next_hint: unknown } } | null;
      expect(latest, label).not.toBeNull();
      expect(status.nextHint, label).toBe(latest?.event.next_hint);
    }
  });

  it("reads the projected event and not the raw last line of the journal", async () => {
    // The tombstone is the last line the file carries and it is not the visible latest event. A
    // reader taking `entries` rather than `latestEntries` answers its hint; the visible answer is
    // the live event before it.
    const status = value(await tombstoneSession.call("workflow_pipeline_status", {}));
    expect(status.nextHint).toBe(HINT_LIVE);
    expect(status.nextHint).not.toBe(HINT_TOMBSTONE);
    expect(status.total, "the raw line is counted, so the two sets really do differ").toBeGreaterThan(2);
  });

  it("returns a null nextHint when the response carries no latestEvent", async () => {
    const status = value(await bareSession.call("workflow_pipeline_status", {}));
    expect(Object.keys(status)).toContain("nextHint");
    expect(status.latestEvent).toBeNull();
    expect(status.nextHint).toBeNull();
  });
});

// --- AC-3 -------------------------------------------------------------------------------------

describe("FR-MCP-062 AC-3 — workflow_resume_hint stays registered and adds nothing of its own", () => {
  it("is listed by tools/list", async () => {
    const names = (await session.client.listTools()).tools.map((tool) => tool.name);
    expect(names).toContain("workflow_resume_hint");
  });

  for (const planKey of ["planPath", "blockedPlanPath", "completePlanPath"] as const) {
    it(`answers the ${planKey} call key for key as workflow_next_plan_task does`, async () => {
      const args = { path: fixture[planKey] };
      const alias = value(await session.call("workflow_resume_hint", args));
      const origin = value(await session.call("workflow_next_plan_task", args));
      expect(Object.keys(alias).sort()).toEqual(Object.keys(origin).sort());
      expect(alias).toEqual(origin);
    });
  }

  it("answers differently for different arguments, so an alias that drops them is caught", async () => {
    const resumable = value(await session.call("workflow_resume_hint", { path: fixture.planPath }));
    const blocking = value(await session.call("workflow_resume_hint", { path: fixture.blockedPlanPath }));
    expect(resumable.resume).toBe(true);
    expect(blocking.resume).toBe(false);
  });
});

// --- AC-4 -------------------------------------------------------------------------------------

describe("FR-MCP-062 AC-4 — workflow_pipeline_next stays registered and reports the origin's values", () => {
  it("is listed by tools/list", async () => {
    const names = (await session.client.listTools()).tools.map((tool) => tool.name);
    expect(names).toContain("workflow_pipeline_next");
  });

  for (const [label, holder, args] of [
    ["main", () => session, {}],
    ["tombstone-visible", () => tombstoneSession, {}],
    ["tombstone-included", () => tombstoneSession, { includeDeleted: true }],
    ["bare", () => bareSession, {}]
  ] as const) {
    it(`answers key for key as workflow_pipeline_status does — ${label}`, async () => {
      const alias = value(await holder().call("workflow_pipeline_next", args));
      const origin = value(await holder().call("workflow_pipeline_status", args));
      expect(Object.keys(alias).sort()).toEqual(Object.keys(origin).sort());
      expect(alias).toEqual(origin);
    });
  }

  it("carries its arguments through, so an alias that discards them is caught", async () => {
    // The same workspace, two argument sets, two different answers. An alias that called the origin
    // with `{}` would answer the visible hint under both.
    const withDefaults = value(await tombstoneSession.call("workflow_pipeline_next", {}));
    const withDeleted = value(await tombstoneSession.call("workflow_pipeline_next", { includeDeleted: true }));
    expect(withDefaults.nextHint).toBe(HINT_LIVE);
    expect(withDeleted.nextHint).toBe(HINT_TOMBSTONE);
    expect(withDefaults.nextHint).not.toEqual(withDeleted.nextHint);
  });
});

// --- AC-5 -------------------------------------------------------------------------------------

describe("FR-MCP-062 AC-5 — the derived rule exists once", () => {
  it("gives each alias a body that only delegates", async () => {
    // A source reading, and labelled as one: it establishes that no second copy is WRITTEN, never
    // that the shipped tool behaves. What establishes the behaviour is the mutation in the
    // evidence, which deletes the origin's rule and watches the alias's answer move with it.
    const source = await readFile(path.join(REPO_ROOT, "src", "core", "workflow", "read.ts"), "utf8");
    // The property, not one spelling of it. An earlier version of this check compared the body to a
    // literal string and went red on `return await origin(root, options);` — a correct restatement.
    // What must hold is that the body passes its own arguments to the origin and re-derives nothing:
    // no mention of the derived value, and no second envelope built here.
    const bodies = [
      { alias: "workflowResumeHint", origin: "workflowNextPlanTask", derived: ["resume", "blocking !==", "nextTask !=="] },
      { alias: "workflowPipelineNext", origin: "workflowPipelineStatus", derived: ["next_hint", "nextHint"] }
    ];
    for (const { alias, origin, derived } of bodies) {
      const match = new RegExp(`export async function ${alias}\\([^)]*\\)[^{]*\\{([\\s\\S]*?)\\n\\}`).exec(source);
      expect(match, `${alias} was not found in read.ts, so this reading is of nothing`).not.toBeNull();
      const body = (match?.[1] ?? "").trim();
      expect(body, `${alias} must hand its own arguments to ${origin}`).toContain(`${origin}(root, options)`);
      expect(body, `${alias} must not build a second envelope of its own`).not.toContain("envelope(");
      for (const token of derived) {
        expect(body, `${alias} names ${token}, so a second copy of the rule is being written here`).not.toContain(token);
      }
    }
  });

  it("shows each derived key in the alias answer, which is where the origin's single copy reaches", async () => {
    const resume = value(await session.call("workflow_resume_hint", { path: fixture.planPath }));
    expect(Object.keys(resume)).toContain("resume");
    const hint = value(await tombstoneSession.call("workflow_pipeline_next", {}));
    expect(Object.keys(hint)).toContain("nextHint");
    expect(hint.nextHint).toBe(HINT_LIVE);
  });
});

// --- AC-6 -------------------------------------------------------------------------------------

/**
 * The actions whose tool name is not a registered tool.
 *
 * Written as a function over two sets rather than as a loop of assertions so the negative controls
 * below can run it against a registry with a name removed. An action whose entry is missing or
 * empty is REPORTED, not skipped — that is the difference between a total denominator and one the
 * predicate quietly narrowed.
 */
function unresolvedActions(actionTools: Readonly<Record<string, string>>, registered: ReadonlySet<string>): string[] {
  return Object.keys(actionTools)
    .filter((action) => {
      const tool = actionTools[action];
      return typeof tool !== "string" || tool.length === 0 || !registered.has(tool);
    })
    .sort();
}

describe("FR-MCP-062 AC-6 — every tool the work order names next is a tool that exists", () => {
  let registered: Set<string>;

  beforeAll(async () => {
    registered = new Set((await session.client.listTools()).tools.map((tool) => tool.name));
  });

  it("takes its denominator from the whole action union", () => {
    // The type is `Record<WorkOrderAction, string>`, so the compiler refuses a table that omits an
    // action. The floors guard the sets this file actually iterates: if the export ever degraded to
    // an empty object, or the registry to a handful, the checks under it would pass vacuously.
    expect(Object.keys(WORK_ORDER_ACTION_TOOLS).length).toBe(floor("actions"));
    expect(registered.size).toBe(floor("tools"));
  });

  it("resolves every action to a registered tool", () => {
    expect(unresolvedActions(WORK_ORDER_ACTION_TOOLS, registered)).toEqual([]);
  });

  it("goes red when any one of the named tools leaves the registry", () => {
    const named = [...new Set(Object.values(WORK_ORDER_ACTION_TOOLS))].sort();
    expect(named.length).toBe(floor("actionTools"));
    for (const tool of named) {
      const without = new Set([...registered].filter((name) => name !== tool));
      const broken = unresolvedActions(WORK_ORDER_ACTION_TOOLS, without);
      expect(broken.length, `removing ${tool} must strand at least one action`).toBeGreaterThan(0);
      for (const action of broken) expect(WORK_ORDER_ACTION_TOOLS[action as keyof typeof WORK_ORDER_ACTION_TOOLS]).toBe(tool);
    }
  });

  it("reports an action whose entry is missing or empty rather than skipping it", () => {
    expect(unresolvedActions({ ...WORK_ORDER_ACTION_TOOLS, "no-action": "" }, registered)).toEqual(["no-action"]);
    const dropped = { ...WORK_ORDER_ACTION_TOOLS } as Record<string, string>;
    delete dropped["complete"];
    expect(unresolvedActions({ ...dropped, complete: undefined as unknown as string }, registered)).toEqual(["complete"]);
  });
});

// --- AC-7 -------------------------------------------------------------------------------------

describe("FR-MCP-062 AC-7 — the descriptions send an agent to the tool that answers in one call", () => {
  let listed: Tool[];
  let toolNames: string[];

  beforeAll(async () => {
    listed = (await session.client.listTools()).tools;
    toolNames = listed.map((item) => item.name);
  });

  function describedAs(name: string): string {
    const tool = listed.find((item) => item.name === name);
    expect(tool, `${name} is not in tools/list, so it has no description to read`).toBeDefined();
    const description = tool?.description ?? "";
    expect(description.length, `${name} carries no description`).toBeGreaterThan(0);
    return description;
  }

  /** The declarations, taken from the registry rather than listed here. */
  function declared(): Array<{ name: string; derivation: NonNullable<ToolSpec["derivation"]> }> {
    return toolSpecs
      .filter((spec): spec is ToolSpec & { mcpName: string; derivation: NonNullable<ToolSpec["derivation"]> } =>
        typeof spec.mcpName === "string" && spec.derivation !== undefined)
      .map((spec) => ({ name: spec.mcpName, derivation: spec.derivation }));
  }

  /**
   * Which OTHER shipped tools a description points at.
   *
   * The MCP name for all 100 tools, plus the CLI name and the core function name for the FOUR that
   * carry a declaration — and no further than those four. Three spellings are read for them because
   * the registry binds `resume-hint` and `workflowResumeHint` to `workflow_resume_hint` as firmly
   * as it binds that name, so a description using either is naming the tool. The other 96 are read
   * by MCP spelling alone, which means a description naming one of THEM by its CLI or core function
   * spelling is not seen here. That is a hole, and it is written down in the requirement's VE-4
   * rather than papered over by a sentence claiming the alphabet is wider than it is.
   *
   * Closing it by reading all 192 remaining non-MCP spellings was measured and rejected rather than
   * overlooked: 56 of the CLI names are bare lowercase words (`next`, `plan`, `status`, `resume`,
   * `pipeline`, `latest`, `decide` …), and reading them would raise 13 false positives spread over
   * all four of these descriptions exactly as they ship today.
   *
   * The widening that WAS taken costs nothing, and that too was measured first. Across all 100
   * shipped descriptions exactly two contain one of the four CLI names, and the only one of those
   * on a declared tool is the alias naming its own owner, which its declaration already admits;
   * none contains one of the four core function names.
   */
  function pointsAt(description: string, self: string): string[] {
    // A CLI name carries hyphens, so its boundary must exclude one; a core function name is a plain
    // identifier and takes the same boundary as an MCP name.
    const otherSpellings = toolSpecs
      .filter((spec) => typeof spec.mcpName === "string" && spec.derivation !== undefined)
      .flatMap((spec) => [
        { spelling: spec.cliName, boundary: "A-Za-z0-9_-", tool: spec.mcpName as string },
        { spelling: spec.coreFn, boundary: "A-Za-z0-9_", tool: spec.mcpName as string }
      ]);
    const named = new Set<string>();
    for (const name of toolNames) {
      if (new RegExp(`(?<![A-Za-z0-9_])${name}(?![A-Za-z0-9_])`).test(description)) named.add(name);
    }
    for (const { spelling, boundary, tool } of otherSpellings) {
      if (new RegExp(`(?<![${boundary}])${spelling}(?![${boundary}])`).test(description)) named.add(tool);
    }
    named.delete(self);
    return [...named].sort();
  }

  it("declares the derivation pairs the code actually has, and no others", () => {
    // The declaration set is not a hand list either: it must be exactly the functions whose body is
    // a bare delegation, so a fifth alias added to `read.ts` without a declaration arrives here.
    const rows = declared();
    expect(rows.length, "declared derivation rows").toBe(floor("derivations"));
    const owners = rows.filter((row) => row.derivation.role === "owner").map((row) => row.name).sort();
    const aliases = rows.filter((row) => row.derivation.role === "alias");
    expect(owners).toEqual(["workflow_next_plan_task", "workflow_pipeline_status"]);
    expect(aliases.map((row) => row.derivation.owner).sort()).toEqual(owners);
    for (const row of rows) expect(toolNames, `${row.name} is declared but not registered`).toContain(row.name);
  });

  it("carries the sentence its own declaration composes, so a hand-written claim about it is caught", () => {
    for (const { name, derivation } of declared()) {
      expect(describedAs(name), `${name} must carry the sentence its declaration composes`).toContain(derivationSentence(derivation));
    }
  });

  it("names a field the owner's reply actually carries, so a consistently false declaration fails", async () => {
    // Without this the declaration is its own ground: changing `field` in the declaration and in the
    // composed sentence together left both checks satisfied and the description saying the reply
    // carries a key it does not. The owner is asked over the same round trip AC-1 and AC-2 use.
    const ownerArgs: Record<string, Record<string, unknown>> = {
      workflow_next_plan_task: { path: fixture.planPath },
      workflow_pipeline_status: {}
    };
    const owners = declared().filter((row) => row.derivation.role === "owner");
    expect(owners.length, "owner declarations to check against a live reply").toBeGreaterThan(0);
    for (const { name, derivation } of owners) {
      const args = ownerArgs[name];
      expect(args, `${name} is declared an owner but this check has no call for it`).toBeDefined();
      const keys = Object.keys(value(await session.call(name, args as Record<string, unknown>)));
      expect(keys, `${name} declares it carries \`${derivation.field}\`, and its reply does not`).toContain(derivation.field);
    }
    // An alias declares the same field as the owner it delegates to, so the reply it returns carries
    // it for the same reason; asserting the pair agrees is what ties the two declarations together.
    for (const { name, derivation } of declared().filter((row) => row.derivation.role === "alias")) {
      const owner = owners.find((row) => row.name === derivation.owner);
      expect(owner, `${name} delegates to ${derivation.owner ?? "?"}, which declares nothing`).toBeDefined();
      expect(derivation.field, `${name} and its owner must name the same field`).toBe(owner?.derivation.field);
    }
  });

  it("lets no description point an agent at a tool its declaration does not admit", () => {
    // The negative half, and the symmetric one: an owner may name no other tool at all, and an
    // alias may name only the owner it delegates to and the tool that keeps it alive. What this
    // decides is the NAME, in any spelling the registry binds to a tool — never the sense of the
    // sentence around it. An owner description that sends the reader on to the alias WITHOUT naming
    // it in any of those spellings passes here, and that escape is enumerated in the requirement's
    // VE-4 rather than left to be found.
    for (const { name, derivation } of declared()) {
      const admitted = derivation.role === "owner" ? [] : [derivation.owner as string, DERIVATION_KEEPER].sort();
      expect(pointsAt(describedAs(name), name), `${name} points at a tool its declaration does not admit`).toEqual(admitted);
    }
  });

  it("reads a closed set of names, so the negative half is not a pattern that matches nothing", () => {
    expect(toolNames.length).toBe(floor("tools"));
    expect(pointsAt("call workflow_resume_hint after workflow_pipeline_next", "x")).toEqual([
      "workflow_pipeline_next",
      "workflow_resume_hint"
    ]);
    expect(pointsAt("no tool is named here", "x")).toEqual([]);
    // A name inside a longer identifier is not a reference to that tool.
    expect(pointsAt("see workflow_resume_hint_v2 for the old shape", "x")).toEqual([]);
    // The other two spellings the registry binds to the same four tools, and the boundary each one
    // needs: a CLI name may not be a fragment of a longer hyphenated word either.
    expect(pointsAt("prefer resume-hint over this", "x")).toEqual(["workflow_resume_hint"]);
    expect(pointsAt("prefer workflowResumeHint over this", "x")).toEqual(["workflow_resume_hint"]);
    expect(pointsAt("the legacy resume-hint-v2 command is gone", "x")).toEqual([]);
    expect(pointsAt("the legacy workflowResumeHintV2 helper is gone", "x")).toEqual([]);
  });
});
