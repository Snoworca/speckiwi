import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { McpServerHandle, McpToolHandler, McpToolMetadata } from "../../src/mcp/adapter.js";
import { createMcpServer, createSdkServer, toolSchemas } from "../../src/mcp/server.js";
import { registerReadTools } from "../../src/mcp/tools/read-tools.js";
import type * as ReadTools from "../../src/mcp/tools/read-tools.js";
import { registerMutationTools } from "../../src/mcp/tools/mutation-tools.js";
import { cleanupFixtures, gitWorkspaceRepo, linkedWorktree, rawGit } from "./support/workspace-root-fixture.js";

// @req FR-MCP-064
//
// Every behavioural case drives a real MCP client through `InMemoryTransport` into the SDK server.
// An adapter-handle call cannot stand in for it: the SDK parses a tool's arguments against that
// tool's declared schema before the callback runs, so a key the schema does not advertise is gone
// before the gate sees it — the defect FR-MCP-063 exists for.
//
// The one thing driven through the handle rather than the protocol is the census that splits the
// registered surface into accepting and refusing (AC-1). It probes the gate with a root that fails
// the first identity check, so no handler runs and no tool needs its required arguments synthesised;
// FR-MCP-063 is what guarantees the same refusal reaches the protocol, and AC-5 below re-drives one
// refusal and AC-3 all thirteen acceptances over the protocol so that guarantee is not assumed here.
//
// What this file does NOT establish, written down so it is not read into the green:
//  - that a write tool stays refused for the right reason. REL-MCP-005 owns that and its own suite
//    drives it; here the write family only appears as part of the census denominator.
//  - that the thirteen are the right thirteen. That is a decision the requirement records; this file
//    holds the implementation to the names the requirement wrote down.
//  - that `docs/spec` is the only shape of missing SRS. AC-6 drives one checkout holding no `docs/`
//    at all; a checkout holding a `docs/spec` without an index is not driven.

/** The thirteen FR-MCP-064 AC-1 names, written as the requirement writes them. */
const THIRTEEN = [
  "list_requirements",
  "search_requirements",
  "get_requirement",
  "validate_spec",
  "summarize_target",
  "get_active_target",
  "list_completed_work",
  "validate_step",
  "get_work_mode",
  "check_vibe_gate",
  "list_dirty_edges",
  "list_compat_edges",
  "list_steps"
] as const;

/** The tools AC-5 names as staying closed, each for a reason the requirement records. */
const STAY_CLOSED = [
  "mcp_workspace_info",
  "preview_legacy_workflow_migration",
  "get_next_work_order",
  "diagnose_requirement_id_collisions",
  "plan_requirement_id_collision_repair"
] as const;

const WORKSPACE_ROOT_KEY = "workspaceRoot";
const ROOT_KEY = "root";
/** The two modules holding the construction-time guards the last two AC-1 cases fire. */
const READ_TOOLS_MODULE = "../../src/mcp/tools/read-tools.js";
const SERVER_MODULE = "../../src/mcp/server.js";
/** The token that appears in the worktree's SRS and nowhere in the host's. */
const MARKER = "WORKTREEMARKER";
const WORKTREE_TARGET = "v9.9.9-WT";
const STEP = "alpha";

/**
 * One read whose answer differs between the two checkouts, per tool.
 *
 * `host` and `worktree` are the values the same call returns when the server's own startup root is
 * that checkout — measured, not guessed. Asserting only "the call was not refused" would pass on an
 * implementation that admits the argument at the gate and never threads it to the handler, which was
 * measured to answer from the startup root inside an envelope reporting `per-call-workspace-root`.
 */
interface Divergence {
  readonly tool: string;
  readonly args: Record<string, unknown>;
  readonly read: (payload: Answer) => unknown;
  readonly host: unknown;
  readonly worktree: unknown;
}

interface Answer {
  ok?: boolean;
  value?: Record<string, unknown>;
  error?: { code?: string; reason?: string; message?: string };
  recovery?: { message?: string };
  mcpWorkspace?: { workspaceRoot?: string; rootSource?: string };
}

const val = (payload: Answer): Record<string, unknown> => (payload.value ?? {}) as Record<string, unknown>;
const codes = (payload: Answer): string[] =>
  Object.keys(((val(payload).summary as { byCode?: Record<string, number> })?.byCode ?? {})).sort();

const DIVERGENCES: readonly Divergence[] = [
  {
    tool: "list_requirements",
    args: { projection: "ids" },
    read: (payload) => val(payload).ids,
    host: ["FR-ARCH-001"],
    worktree: ["FR-ARCH-001", "FR-ARCH-002"]
  },
  {
    tool: "search_requirements",
    args: { query: MARKER },
    read: (payload) => (val(payload).records as Array<{ id: string }>).map((record) => record.id),
    host: [],
    worktree: ["FR-ARCH-002"]
  },
  {
    tool: "get_requirement",
    args: { id: "FR-ARCH-002" },
    read: (payload) => (payload.ok === true ? val(payload).title : payload.error?.code),
    host: "NOT_FOUND",
    worktree: `${MARKER} worktree only requirement`
  },
  {
    tool: "validate_spec",
    args: {},
    read: codes,
    host: ["SRS-W015"],
    worktree: ["SRS-W015", "SRS-W019", "SRS-W020"]
  },
  {
    tool: "summarize_target",
    args: {},
    read: (payload) => ({ target: val(payload).target, total: val(payload).total }),
    host: { target: "v1.0.0", total: 1 },
    worktree: { target: WORKTREE_TARGET, total: 2 }
  },
  {
    tool: "get_active_target",
    args: {},
    read: (payload) => val(payload).activeTarget,
    host: "v1.0.0",
    worktree: WORKTREE_TARGET
  },
  {
    tool: "list_completed_work",
    args: {},
    read: (payload) => (val(payload).completedWork as Array<{ summary: string }>)[0]?.summary,
    host: "Fixture parser coverage completed.",
    worktree: `${MARKER} completed work.`
  },
  {
    // @req FR-MCP-064 AC-4 — the one tool that calls two root helpers, and the reason this row's
    // expected value is a diagnostic set rather than a flag. Which SDS advisory fires is decided by
    // both halves at once: the work mode comes from the parsed workspace and the design/intent files
    // from the project root. Threading only the workspace half leaves design.md unfound and the
    // answer becomes SDS-E054; threading only the project-root half leaves the mode `wait` and no SDS
    // diagnostic fires at all. Only both halves pointing at the worktree produce SDS-W051 alone.
    tool: "validate_step",
    args: { step: STEP },
    read: (payload) => (val(payload).summary as { byCode?: Record<string, number> })?.byCode,
    host: {},
    worktree: { "SDS-W051": 1 }
  },
  {
    tool: "get_work_mode",
    args: {},
    read: (payload) => val(payload),
    host: { mode: "wait" },
    worktree: { mode: "tdd", activeTask: STEP }
  },
  {
    tool: "check_vibe_gate",
    args: {},
    read: (payload) => val(payload),
    host: { mode: "wait", blocked: false },
    worktree: { mode: "tdd", activeTask: STEP, blocked: false }
  },
  {
    tool: "list_dirty_edges",
    args: {},
    read: (payload) => (val(payload).edges as Array<{ self: string }>).map((edge) => edge.self),
    host: [],
    worktree: ["FR-ARCH-002"]
  },
  {
    tool: "list_compat_edges",
    args: {},
    read: (payload) => (val(payload).edges as Array<{ self: string }>).map((edge) => edge.self),
    host: [],
    worktree: ["FR-ARCH-002"]
  },
  {
    tool: "list_steps",
    args: {},
    read: (payload) => (val(payload).steps as Array<{ step: string }>).map((entry) => entry.step),
    host: [],
    worktree: [STEP]
  }
];

/** The requirement block that exists only in the worktree, marker-bearing on every axis read here. */
const WORKTREE_ONLY_REQUIREMENT = `
### FR-ARCH-002 — ${MARKER} worktree only requirement

| Field | Value |
| --- | --- |
| Type | functional |
| Target | ${WORKTREE_TARGET} |
| Status | planned |
| Priority | medium |
| Tags | - |
| Risk | low |
| Stability | evolving |
| Verification Method | test |
| GitHub Issue | - |
| Related Docs | - |

#### Requirement

The fixture SHALL carry a second requirement that exists only in the linked worktree.

#### Rationale

-

#### Acceptance Criteria

- [ ] AC-1: ${MARKER} is readable from this checkout only.

#### Verification Evidence

| Evidence ID | Type | Reference | Covers | Notes |
| --- | --- | --- | --- | --- |

#### Trace Links

| Type | Reference | Relation | Notes |
| --- | --- | --- | --- |
| Requirement | FR-ARCH-001 | checked_compatible | ${MARKER} edge |

#### Research / Analysis

- -

#### Implementation Notes

- -

#### Change Notes

| Date | Change | Reason |
| --- | --- | --- |
| 2026-09-04 | Created | fixture |
`;

/** An SDS missing exactly one required heading, so the worktree answers SDS-W051 and nothing else. */
const WORKTREE_STEP_DESIGN = [
  `# ${STEP} SDS`,
  "",
  "## Context & Scope",
  "-",
  "## Goals / Non-goals",
  "-",
  "## Architecture Decisions",
  "-",
  "## Interfaces",
  "-",
  "## Acceptance Contracts",
  "- SDS-AC-1: WHEN the worktree answers SHALL it name itself.",
  "## Test Plan",
  "- SDS-AC-1 is covered.",
  ""
].join("\n");

const WORKTREE_STEP_STATE = [
  "# Step State",
  "",
  "Mode: tdd",
  `Active Task: ${STEP}`,
  "",
  "| Step | Status | DependsOn | TouchesScope | TouchesReq | Created | Updated |",
  "| --- | --- | --- | --- | --- | --- | --- |",
  `| ${STEP} | active | - | ARCH | FR-ARCH-001 | 2026-09-04 | 2026-09-04 |`,
  ""
].join("\n");

/** Rewrites the worktree's SRS so every row of {@link DIVERGENCES} reads differently there. */
async function divergeWorktree(worktree: string): Promise<void> {
  const indexPath = path.join(worktree, "docs", "spec", "00.index.md");
  const index = await readFile(indexPath, "utf8");
  await writeFile(
    indexPath,
    index.split("v1.0.0").join(WORKTREE_TARGET).split("Fixture parser coverage completed.").join(`${MARKER} completed work.`),
    "utf8"
  );
  const srsPath = path.join(worktree, "docs", "spec", "10.product-architecture.srs.md");
  const srs = await readFile(srsPath, "utf8");
  await writeFile(srsPath, `${srs.split("v1.0.0").join(WORKTREE_TARGET)}${WORKTREE_ONLY_REQUIREMENT}`, "utf8");
  await mkdir(path.join(worktree, "docs", "spec", "steps", STEP), { recursive: true });
  await writeFile(path.join(worktree, "docs", "spec", "steps", "state.md"), WORKTREE_STEP_STATE, "utf8");
  await writeFile(path.join(worktree, "docs", "spec", "steps", STEP, "design.md"), WORKTREE_STEP_DESIGN, "utf8");
}

/** What each tool was registered with, read off the registration surface rather than the wrapper. */
function registrations(root: string): Map<string, { arity: number; metadata: McpToolMetadata | undefined }> {
  const captured = new Map<string, { arity: number; metadata: McpToolMetadata | undefined }>();
  const probe = {
    tools: {} as Record<string, McpToolHandler>,
    resourceTemplates: [] as string[],
    toolKinds: {} as Record<string, never>,
    registerTool(name: string, handler: McpToolHandler, metadata?: McpToolMetadata) {
      captured.set(name, { arity: handler.length, metadata });
    },
    registerResource() {
      /* resources carry no workspace metadata */
    },
    async callTool() {
      throw new Error("the registration probe never calls a tool");
    }
  } as unknown as McpServerHandle;
  registerReadTools(probe, { root });
  registerMutationTools(probe, { root });
  return captured;
}

let host = "";
let worktree = "";
let bare = "";
let local: McpServerHandle;
let client: Client;
let listed: Tool[] = [];
const accepting: string[] = [];
const refusing: string[] = [];
const unclassified: string[] = [];

async function call(tool: string, args: Record<string, unknown>): Promise<Answer> {
  const result = await client.callTool({ name: tool, arguments: args });
  const text = (result.content as Array<{ type: string; text?: string }> | undefined)?.[0]?.text ?? "";
  return JSON.parse(text) as Answer;
}

beforeAll(async () => {
  host = await gitWorkspaceRepo("fr-mcp-064-host");
  worktree = await linkedWorktree(host, "fr-mcp-064-wt", "fr-mcp-064");
  await divergeWorktree(worktree);
  bare = await linkedWorktree(host, "fr-mcp-064-bare", "fr-mcp-064-bare");
  await rm(path.join(bare, "docs"), { recursive: true, force: true });

  local = createMcpServer({ root: host, rootSource: "server-cwd-discovery" });
  const sdk = createSdkServer(local);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await sdk.connect(serverTransport);
  client = new Client({ name: "speckiwi-fr-mcp-064", version: "1.0.0" }, { capabilities: {} });
  await client.connect(clientTransport);
  listed = (await client.listTools()).tools;

  // The census asks the gate, through the handle, with a root that fails the first identity check:
  // a tool that takes the argument reaches that check and answers MCP_WORKSPACE_ROOT_REFUSED with
  // `workspace-root-not-absolute`, and one that does not answers MCP_WORKSPACE_ROOT_UNSUPPORTED. The
  // split is read off the code rather than the reason because a tool may name its own refusal reason
  // — `orchestrate_replay_apply` does — while still being refused. No handler runs either way, so
  // this walk of every registered tool reads nothing from disk and writes nothing.
  for (const name of Object.keys(local.tools).filter((candidate) => !candidate.startsWith("resource:"))) {
    const answer = (await local.callTool(name, { [WORKSPACE_ROOT_KEY]: "relative/not/absolute" })) as Answer;
    const code = answer.error?.code;
    if (code === "MCP_WORKSPACE_ROOT_REFUSED" && answer.error?.reason === "workspace-root-not-absolute") accepting.push(name);
    else if (code === "MCP_WORKSPACE_ROOT_UNSUPPORTED") refusing.push(name);
    else unclassified.push(`${name}: ${code ?? "answered"}/${answer.error?.reason ?? "-"}`);
  }
}, 180000);

afterAll(async () => {
  await client?.close();
  await rawGit(host, "worktree", "prune").catch(() => "");
  await cleanupFixtures();
});

describe("FR-MCP-064 — the SRS query tools answer from a per-call workspace root", { timeout: 180_000 }, () => {
  // @req FR-MCP-064 AC-1
  it("opens exactly the thirteen it names outside the workflow_* and orchestrate_* families", () => {
    expect(unclassified).toEqual([]);
    const opened = accepting
      .filter((name) => !name.startsWith("workflow_") && !name.startsWith("orchestrate_"))
      .sort();
    // Both directions: a fourteenth tool quietly gaining the argument reddens here, and so does a
    // name in the requirement being dropped from the implementation.
    expect(opened).toEqual([...THIRTEEN].sort());
    expect(refusing.filter((name) => (THIRTEEN as readonly string[]).includes(name))).toEqual([]);
  });

  // @req FR-MCP-064 AC-1 — the schema and the gate come from one declaration, so neither can move alone.
  it("advertises the argument on each of the thirteen and hands each handler the call context", () => {
    const registered = registrations(host);
    for (const tool of THIRTEEN) {
      expect(Object.prototype.hasOwnProperty.call(toolSchemas[tool] ?? {}, WORKSPACE_ROOT_KEY), `${tool} must advertise ${WORKSPACE_ROOT_KEY}`).toBe(true);
      expect(listed.find((candidate) => candidate.name === tool)?.inputSchema.properties, `${tool} must advertise it over tools/list`).toHaveProperty(WORKSPACE_ROOT_KEY);
    }
    // A necessary condition read off the registration surface, paired with the roundtrip below
    // rather than standing in for it: a handler that never takes the context cannot honour the root.
    // Every tool the gate accepts satisfied this before this requirement, and each of the thirteen
    // did not.
    const arityGaps = accepting
      .filter((name) => (registered.get(name)?.arity ?? 0) < 2)
      .sort();
    expect(arityGaps, "an accepting tool whose handler cannot receive the call context").toEqual([]);
  });

  // @req FR-MCP-064 AC-1 — the first of the two guards that hold the opened set to its declaration.
  //
  // The two cases above compare the set as it is; these two hold the code that refuses to build a
  // wrong one. Both guards are construction-time and both are module-private, so neither can be
  // called directly and neither fires on this tree — a name outside the thirteen only ever arrives
  // as a typo in the source. Each case therefore injects that typo's effect through the one seam the
  // module leaves open and then drives the real code path, rather than reading the source for the
  // throw: a scan proves the line is written, not that it runs.
  //
  // Here the seam is the derivation itself. `SRS_READ_WORKSPACE_METADATA` is built by one
  // `Object.fromEntries` over the thirteen and then frozen, so dropping an entry as it is built
  // reproduces exactly what a mistyped registration name produces — a lookup that finds nothing —
  // and is the only condition the guard can see. The interception is asserted before the throw is,
  // so a refactor that moves the derivation fails this case loudly instead of vacating it.
  it("refuses to register a name the thirteen do not declare, and names it", async () => {
    const fromEntries = Object.fromEntries;
    let dropped = "";
    vi.resetModules();
    Object.fromEntries = ((entries: Iterable<readonly [PropertyKey, unknown]>) => {
      const built = fromEntries(entries as never) as Record<string, unknown>;
      const pairs = Array.isArray(entries) ? (entries as Array<readonly [PropertyKey, unknown]>) : [];
      if (pairs.length === THIRTEEN.length && pairs.every(([key]) => (THIRTEEN as readonly string[]).includes(String(key)))) {
        dropped = String(pairs[pairs.length - 1][0]);
        delete built[dropped];
      }
      return built;
    }) as typeof Object.fromEntries;
    let readTools: typeof ReadTools;
    try {
      readTools = await import(READ_TOOLS_MODULE);
    } finally {
      Object.fromEntries = fromEntries;
    }
    expect(dropped, "the derivation this case drops an entry from is no longer the one being built").toBe("list_steps");

    const probe = {
      registerTool() {
        /* the guard runs before the handle is asked to keep anything */
      },
      registerResource() {
        /* resources carry no workspace metadata */
      }
    } as unknown as McpServerHandle;
    // Named, not merely thrown: a guard that refuses without saying which name it refused leaves the
    // caller with a startup failure and no way to find the typo. The message itself is deliberately
    // not pinned, so rewording it stays free.
    expect(() => readTools.registerReadTools(probe, { root: host }), "registration must refuse an undeclared name").toThrow(/list_steps/);
    vi.resetModules();
  });

  // @req FR-MCP-064 AC-1 — the second guard, in the schema derivation rather than the registration.
  //
  // Its seam is the import boundary: `server.ts` reads the opened set through
  // `perCallWorkspaceRootTools`, so mocking that one export puts a name into the set that no schema
  // literal declares — the shape a typo in `SRS_READ_WORKSPACE_SCOPED` takes on this side. The guard
  // runs while the module is evaluated, so the rejection is the import's own. Without it the
  // misspelt name would take `{ workspaceRoot }` and nothing else and the tool would advertise the
  // argument while declaring no schema, which is what the mutation record measured as green.
  it("refuses to derive a schema for an opened name that declares none, and names it", async () => {
    const misspelt = `${THIRTEEN[THIRTEEN.length - 1]}s`;
    vi.resetModules();
    vi.doMock(READ_TOOLS_MODULE, async (importOriginal) => {
      const original = await importOriginal<typeof ReadTools>();
      return { ...original, perCallWorkspaceRootTools: () => [...original.perCallWorkspaceRootTools(), misspelt] };
    });
    try {
      await expect(import(SERVER_MODULE), "schema derivation must refuse a name it has no schema for").rejects.toThrow(new RegExp(misspelt));
    } finally {
      vi.doUnmock(READ_TOOLS_MODULE);
      vi.resetModules();
    }
  });

  // @req FR-MCP-064 AC-2
  it("answers from the startup root, unchanged, when the argument is omitted", async () => {
    for (const row of DIVERGENCES) {
      const payload = await call(row.tool, row.args);
      expect(row.read(payload), `${row.tool} with no ${WORKSPACE_ROOT_KEY}`).toEqual(row.host);
      expect(payload.mcpWorkspace, `${row.tool} envelope`).toMatchObject({
        workspaceRoot: host,
        rootSource: "server-cwd-discovery"
      });
    }
    expect(DIVERGENCES).toHaveLength(THIRTEEN.length);
  });

  // @req FR-MCP-064 AC-3 / AC-4
  it("answers from the named worktree, in the answer's own content and in the envelope", async () => {
    for (const row of DIVERGENCES) {
      const payload = await call(row.tool, { ...row.args, [WORKSPACE_ROOT_KEY]: worktree });
      expect(payload.error?.reason, `${row.tool} must not be refused`).toBeUndefined();
      // The content, not merely the envelope: a gate-only implementation reports
      // `per-call-workspace-root` here while returning the startup root's answer.
      expect(row.read(payload), `${row.tool} must read the worktree`).toEqual(row.worktree);
      expect(payload.mcpWorkspace, `${row.tool} envelope`).toMatchObject({
        workspaceRoot: worktree,
        rootSource: "per-call-workspace-root"
      });
    }
  });

  // @req FR-MCP-064 AC-4 — stated separately from the loop so the two-helper tool is named.
  it("resolves both of validate_step's roots from the supplied worktree", async () => {
    const answer = await call("validate_step", { step: STEP, [WORKSPACE_ROOT_KEY]: worktree });
    expect(answer.error?.reason, "validate_step must not be refused").toBeUndefined();
    const summary = (val(answer).summary ?? {}) as { byCode?: Record<string, number> };
    // SDS-W051 requires the tdd mode, which comes from the parsed workspace, AND a design.md that is
    // present but incomplete, which comes from the project root. SDS-E054 is what the workspace half
    // alone produces; an empty set is what the project-root half alone produces.
    expect(summary.byCode).toEqual({ "SDS-W051": 1 });
    expect(Object.keys(summary.byCode ?? {})).not.toContain("SDS-E054");
    expect(answer.mcpWorkspace?.workspaceRoot).toBe(worktree);
  });

  // @req FR-MCP-064 AC-5
  it("leaves mcp_workspace_info and the four other named readers closed", async () => {
    const declared = toolSchemas.mcp_workspace_info ?? {};
    expect(Object.prototype.hasOwnProperty.call(declared, WORKSPACE_ROOT_KEY)).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(declared, ROOT_KEY)).toBe(false);
    expect(listed.find((tool) => tool.name === "mcp_workspace_info")?.inputSchema.properties ?? {}).not.toHaveProperty(WORKSPACE_ROOT_KEY);

    for (const name of STAY_CLOSED) {
      expect(refusing, `${name} must stay refused`).toContain(name);
    }
    // Re-driven over the protocol so the census is not the only witness for the closed side.
    const refused = await call("mcp_workspace_info", { [WORKSPACE_ROOT_KEY]: worktree });
    expect(refused.error?.code).toBe("MCP_WORKSPACE_ROOT_UNSUPPORTED");
    expect(refused.error?.reason).toBe("workspace-root-unsupported-for-tool");
    expect(refused.mcpWorkspace?.workspaceRoot).toBe(host);
  });

  // @req FR-MCP-064 AC-6
  it("refuses a checkout that holds no SRS index, naming the checkout and creating nothing", async () => {
    const before = await readdir(bare);
    const answer = await call("list_requirements", { [WORKSPACE_ROOT_KEY]: bare });
    expect(answer.error?.code).toBe("MCP_WORKSPACE_ROOT_REFUSED");
    expect(answer.error?.reason).toBe("workspace-root-missing-srs-index");
    // The recovery names the checkout that was examined. It is not a repair command: `init --force`
    // is recorded as deleting requirements without a symptom, and a refusal must not teach it.
    expect(answer.recovery?.message).toContain(bare);
    expect(answer.recovery?.message, "the recovery names a checkout, not a repair command").not.toMatch(/--force|\binit\b/i);
    expect(await readdir(bare)).toEqual(before);
    expect(before).not.toContain("docs");
  });

  // @req FR-MCP-064 AC-6 — the check belongs to this family, not to the gate as a whole.
  it("still answers a workflow_* call for a checkout that holds no docs at all", async () => {
    const answer = await call("workflow_doctor", { [WORKSPACE_ROOT_KEY]: bare });
    expect(answer.error?.reason, "workflow_doctor must not inherit the SRS index check").toBeUndefined();
    expect(answer.ok).toBe(true);
  });

  // @req FR-MCP-064 AC-7
  it("declares that the thirteen take no caller-supplied path, and nothing else declares it", () => {
    const registered = registrations(host);
    const declaring = [...registered.entries()]
      .filter(([, record]) => Array.isArray(record.metadata?.callerPathKeys))
      .map(([name]) => name)
      .sort();
    expect(declaring).toEqual([...THIRTEEN].sort());
    for (const tool of THIRTEEN) {
      expect(registered.get(tool)?.metadata?.callerPathKeys, `${tool} takes no caller-supplied path`).toEqual([]);
    }
  });

  // @req FR-MCP-064 AC-7 — the declaration's point: a docs/spec filter is an SRS query's normal use.
  it("lets an SRS query filter on a docs/spec reference while a workflow_* path there stays refused", async () => {
    const answered = await call("list_requirements", {
      [WORKSPACE_ROOT_KEY]: worktree,
      relatedDoc: "docs/spec/10.product-architecture.srs.md",
      projection: "ids"
    });
    expect(answered.error?.reason, "a declared-path-free tool is not scanned").toBeUndefined();
    expect(answered.mcpWorkspace?.rootSource).toBe("per-call-workspace-root");

    // REL-MCP-005 AC-6 keeps scanning every argument of a tool that declares nothing, and this is the
    // read whose refusal that criterion's own evidence asserts.
    const refused = await call("workflow_plan_status", {
      [WORKSPACE_ROOT_KEY]: worktree,
      path: path.join(worktree, "docs", "spec", "00.index.md")
    });
    expect(refused.error?.reason).toBe("workspace-root-forbidden-for-srs");
  });
});
