import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import type { McpServerHandle, McpToolHandler } from "../../src/mcp/adapter.js";
import { createMcpServer, createSdkServer, sdkToolInputSchema, toolSchemas } from "../../src/mcp/server.js";
import { cleanupFixtures, gitWorkspaceRepo, linkedWorktree } from "./support/workspace-root-fixture.js";

// @req FR-MCP-063
//
// Every case below drives a real MCP client through `InMemoryTransport` into the SDK server, and
// that is the whole point of the file. The gate this gets at was already covered — by
// `workspace-root-gate.rel-mcp-005.test.ts`, which calls `createTestMcpServer(...).callTool(...)`,
// the adapter handle, directly. That handle is downstream of the SDK's argument parsing, so a key
// the SDK deletes is a key that file cannot ask about. Measured on 1340baca: through the handle,
// `list_requirements({workspaceRoot})` was refused; through the protocol, the same call answered
// from the startup root with `rootSource: "server-cwd-discovery"`.
//
// What this file does NOT establish, written down so it is not read into the green:
//  - that a schema-INVALID call reaches the gate. It does not, and it cannot: the SDK validates
//    arguments before the callback runs, so `add_requirement({workspaceRoot})` with no `type` is
//    answered by schema validation. Every case here therefore fills a tool's required arguments
//    from its own advertised schema first. Both outcomes are refusals; neither is a host answer.
//  - that an accepted `workspaceRoot` is honoured. That is FR-MCP-058 and FR-MCP-059, and nothing
//    here touches which tools accept one.
//  - that the refusal reasons are right for the right reasons. AC-6 asserts the shape of one
//    refusal payload; REL-MCP-005 owns which reason each failure earns.

interface Refusal {
  ok: false;
  error: { code: string; reason: string; message: string };
  diagnostics: Array<{ code: string; severity: string; message: string; details?: Record<string, unknown> }>;
  mcpWorkspace: { workspaceRoot: string; rootSource: string };
  recovery?: { message: string };
}

/** The two keys the registration gate decides by, and the only two this file sends. */
const ROOT_KEY = "root";
const WORKSPACE_ROOT_KEY = "workspaceRoot";

/**
 * The figure FR-MCP-063 records, compared with `toBe` rather than with a bound.
 *
 * A bound read off the same map the assertion walks is a tautology, so this is the number in the
 * requirement text and nothing else. If the registered surface grows, both sides move together and
 * only this line says so.
 */
const REGISTERED_TOOL_COUNT = 100;

/**
 * The refusing set is held to names rather than to a size.
 *
 * Its size is a fact about which tools may name a per-call root, and that membership belongs to
 * REL-MCP-005 and to the family requirements — it moved from 49 to 36 when FR-MCP-064 opened the SRS
 * query family, a change this requirement did not make and should not have reddened for. What a size
 * bought was a guard against a collapsed denominator, and two guards replace it: the set must be
 * non-empty, and it must contain these two by name. The other half of what the size caught — a tool
 * quietly gaining the argument — is held by FR-MCP-064 AC-1, which compares the opened family with
 * the names its requirement records in both directions.
 */
const REFUSING_WITNESSES = ["add_requirement", "update_status"] as const;

/**
 * The tool AC-5 and AC-6 are driven through: one that declares neither gate key and that the gate
 * refuses a per-call root for.
 *
 * `list_requirements` played this part until FR-MCP-064 opened it. Neither criterion names a tool —
 * AC-5 says "a tool that declares neither key" and AC-6 says "a protocol caller" — so what moved is
 * the means, not the criterion. `get_next_work_order` stays closed because its subject is run state
 * under `kiwi/`, and it declares own optional arguments, which AC-5 needs to show survive the parse
 * the gate's keys do not.
 */
const CLOSED_VEHICLE = "get_next_work_order";
const CLOSED_VEHICLE_OWN_KEY = "target";

/**
 * The one tool whose declared schema advertises a `workspaceRoot` the gate refuses.
 *
 * Named rather than counted. Both repairs are outside what FR-MCP-063 decides: dropping the
 * declaration takes the tree's declared-argument total below a floor that FR-FLOW-162 AC-1 holds
 * and records in its own verified text, and giving the tool the argument for real moves the
 * accepting family from 51 to 52.
 */
const ADVERTISED_BUT_REFUSED = "preview_legacy_workflow_migration";

type JsonSchema = {
  type?: string;
  enum?: unknown[];
  anyOf?: JsonSchema[];
  items?: JsonSchema;
  pattern?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
};

/**
 * A sample for a `pattern`-constrained string, keyed by the pattern the running server advertises.
 *
 * A required property whose pattern is not in this table is collected into `patternGaps` and the
 * census fails naming it, rather than the call being answered by the validator and the tool
 * quietly counting as one this file drove. That is the difference between a loop over 49 tools and
 * a loop over the 44 whose arguments happened to be easy.
 */
const PATTERN_SAMPLES: Record<string, string> = {
  "^\\d{4}-\\d{2}-\\d{2}$": "2026-01-01",
  "^[a-f0-9]{64}$": "a".repeat(64)
};

const patternGaps: string[] = [];

/** A value the advertised schema admits, so the call reaches the gate instead of the validator. */
function sampleFor(where: string, schema: JsonSchema | undefined): unknown {
  if (schema?.enum && schema.enum.length > 0) return schema.enum[0];
  if (schema?.anyOf && schema.anyOf.length > 0) return sampleFor(where, schema.anyOf[0]);
  switch (schema?.type) {
    case "number":
    case "integer":
      return 1;
    case "boolean":
      return false;
    case "array":
      return [sampleFor(`${where}[]`, schema.items)];
    case "object": {
      const out: Record<string, unknown> = {};
      for (const name of schema.required ?? []) out[name] = sampleFor(`${where}.${name}`, schema.properties?.[name]);
      return out;
    }
    default:
      if (schema?.pattern === undefined) return "x";
      if (schema.pattern in PATTERN_SAMPLES) return PATTERN_SAMPLES[schema.pattern];
      patternGaps.push(`${where}: ${schema.pattern}`);
      return "x";
  }
}

/** The required half of a tool's advertised input, read from the running server. */
function requiredArguments(tool: Tool): Record<string, unknown> {
  const schema = tool.inputSchema as JsonSchema;
  const out: Record<string, unknown> = {};
  for (const name of schema.required ?? []) out[name] = sampleFor(`${tool.name}.${name}`, schema.properties?.[name]);
  return out;
}

/**
 * Every data property `Object.prototype` carries, which `key in declared` answers "declared" for.
 *
 * Written out rather than computed, because the computed form is the same expression the seam's
 * repair would reach for and deriving both sides from it would pass whatever the seam does. A
 * separate case compares this list against the computed set in both directions, so emptying or
 * trimming it reddens there instead of quietly shrinking what the cases below drive.
 * `__proto__` is not here - it is the one accessor, and it gets its own case.
 */
const PROTOTYPE_KEYS = [
  "__defineGetter__",
  "__defineSetter__",
  "__lookupGetter__",
  "__lookupSetter__",
  "constructor",
  "hasOwnProperty",
  "isPrototypeOf",
  "propertyIsEnumerable",
  "toLocaleString",
  "toString",
  "valueOf"
] as const;

/**
 * Undeclared keys that sit next to the gate's two.
 *
 * Measured to redden five loosenings of the membership test - a prefix, a suffix, a substring, a
 * case-fold, and a length or character-class bound - and not to be a census of every loosening
 * there is: a predicate that admits some name outside this list is not caught. {@link LOOSENINGS}
 * holds the five to the list; it does not hold the list to the world.
 *
 * The ordinary unknown keys this file also sends (`unknownKey`, `anotherUnknown`) and the inherited
 * eleven share a property that made them blind: not one of them starts with `root` or `workspace`.
 * Replacing the set membership with `key.startsWith("root") || key.startsWith("workspace")` passed
 * every case, measured - and that is the shape a person actually reaches for when widening the pair
 * to admit another path argument. Each name below is undeclared on `list_requirements` and is
 * neither gate key, so each must be dropped.
 */
const NEAR_MISS_KEYS = [
  "rootPath",
  "rootOverride",
  "roots",
  "workspaceDir",
  "workspaceRootPath",
  "workspaces",
  "myRoot",
  "hostWorkspaceRoot",
  "theRootKey",
  "ROOT",
  "WorkspaceRoot",
  "workspaceroot"
] as const;

/**
 * The loosenings {@link NEAR_MISS_KEYS} exists to catch, each as the predicate it would become.
 *
 * A separate case requires every row to be satisfied by at least one name, so deleting the only
 * name that catches one loosening reddens there rather than silently narrowing what is driven.
 * What this does NOT establish: that these are the only ways to loosen the test. A predicate that
 * admits a name outside this list - a hash, a spelling nobody guessed - is not caught here.
 */
const LOOSENINGS: ReadonlyArray<readonly [string, (key: string) => boolean]> = [
  ["startsWith root", (key) => key.startsWith("root")],
  ["startsWith workspace", (key) => key.startsWith("workspace")],
  ["endsWith Root", (key) => key.endsWith("Root")],
  ["contains root, case-folded", (key) => key.toLowerCase().includes("root")],
  ["equals a gate key, case-folded", (key) => key.toLowerCase() === "root" || key.toLowerCase() === "workspaceroot"]
];

/**
 * The value each near-miss key is sent with, cycling through three shapes.
 *
 * Sending them all as `"x"` left a second axis blind: a predicate that reads the VALUE rather than
 * the key - `typeof value === "string" && value.includes("/")` - admitted all twelve at once and
 * every case stayed green, measured. Two of the three shapes look like paths, one on each slash,
 * because that is what such a predicate would key on; the third stays opaque so the list does not
 * become a census of path-shaped values either.
 */
function nearMissValue(key: string): string {
  const shape = NEAR_MISS_KEYS.indexOf(key as (typeof NEAR_MISS_KEYS)[number]) % 3;
  if (shape === 0) return "C:/tmp/near-miss/probe";
  if (shape === 1) return "C:\\tmp\\near-miss\\probe";
  return "x";
}

/** `Object.prototype`'s data properties, computed. The other half of the cross-check. */
function computedPrototypeDataKeys(): string[] {
  return Object.getOwnPropertyNames(Object.prototype)
    .filter((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(Object.prototype, key);
      return descriptor !== undefined && descriptor.get === undefined && descriptor.set === undefined;
    })
    .sort();
}

type Outcome =
  | { kind: "refusal"; payload: Refusal }
  | { kind: "answered"; detail: string };

let host = "";
let worktree = "";
let local: McpServerHandle;
let client: Client;
let listed: Tool[] = [];
const refusing: string[] = [];
const accepting: string[] = [];
const unclassified: string[] = [];
/** What the seam handed each registered tool, recorded without changing what it hands. */
const seen: Array<{ name: string; keys: string[] }> = [];

/**
 * How many times {@link protocolCall} has been entered.
 *
 * The witness that the census loops spent their denominator. Without it,
 * `expect(escaped).toEqual([])` reads the same whether every tool refused or the loop never ran:
 * emptying the array `notRefusedWith` walks left all eight cases green, measured.
 *
 * It witnesses entry, not a completed roundtrip - the increment is the first statement of a
 * function that then does make the call and reports any failure through `escaped`, so within that
 * function the count is honest, but a caller that replaced the call site with an increment and a
 * fabricated answer would not be caught here. Measured, and left as residue.
 */
let protocolCalls = 0;

async function protocolCall(tool: Tool, extra: Record<string, unknown>): Promise<Outcome> {
  protocolCalls += 1;
  try {
    const result = await client.callTool({ name: tool.name, arguments: { ...requiredArguments(tool), ...extra } });
    const text = (result.content as Array<{ type: string; text?: string }> | undefined)?.[0]?.text ?? "";
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { kind: "answered", detail: `unparsable body: ${text.slice(0, 120)}` };
    }
    const payload = parsed as Partial<Refusal> & { mcpWorkspace?: { rootSource?: string } };
    if (typeof payload?.error?.code === "string") return { kind: "refusal", payload: payload as Refusal };
    return { kind: "answered", detail: `rootSource=${payload?.mcpWorkspace?.rootSource ?? "(no envelope)"}` };
  } catch (error) {
    return { kind: "answered", detail: `threw ${(error as Error).message.slice(0, 160)}` };
  }
}

/** Names for which the protocol answer was not the gate's `code` refusal, with why. */
async function notRefusedWith(code: string, key: string, names: string[]): Promise<string[]> {
  const escaped: string[] = [];
  for (const name of names) {
    const tool = listed.find((candidate) => candidate.name === name);
    if (!tool) {
      escaped.push(`${name}: not listed over the protocol`);
      continue;
    }
    const outcome = await protocolCall(tool, { [key]: worktree });
    if (outcome.kind === "answered") escaped.push(`${name}: ${outcome.detail}`);
    else if (outcome.payload.error.code !== code) escaped.push(`${name}: ${outcome.payload.error.code}`);
  }
  return escaped;
}

beforeAll(async () => {
  host = await gitWorkspaceRepo("fr-mcp-063-host");
  worktree = await linkedWorktree(host, "fr-mcp-063-wt", "fr-mcp-063");
  local = createMcpServer({ root: host, rootSource: "server-cwd-discovery" });

  for (const name of Object.keys(local.tools)) {
    const inner = local.tools[name] as McpToolHandler;
    local.tools[name] = (input, context) => {
      seen.push({ name, keys: Object.keys(input) });
      return inner(input, context);
    };
  }

  const sdk = createSdkServer(local);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await sdk.connect(serverTransport);
  client = new Client({ name: "speckiwi-fr-mcp-063", version: "1.0.0" }, { capabilities: {} });
  await client.connect(clientTransport);
  listed = (await client.listTools()).tools;

  // The census runs through the adapter handle on purpose: it asks what the GATE does, which is the
  // denominator the protocol cases are then measured against. A workspace root that does not exist
  // is refused before any handler runs, so this walk of every registered tool writes nothing.
  const absent = path.join(host, "no-such-workspace-root");
  for (const name of Object.keys(local.tools).filter((candidate) => !candidate.startsWith("resource:"))) {
    const answer = (await local.callTool(name, { [WORKSPACE_ROOT_KEY]: absent })) as Partial<Refusal>;
    const code = answer?.error?.code;
    if (code === "MCP_WORKSPACE_ROOT_UNSUPPORTED") refusing.push(name);
    else if (code === "MCP_WORKSPACE_ROOT_REFUSED") accepting.push(name);
    else unclassified.push(`${name}: ${code ?? "answered"}`);
  }
}, 120000);

afterAll(async () => {
  await client?.close();
  await cleanupFixtures();
});

describe("FR-MCP-063 a path argument a tool does not accept is refused at the protocol surface", () => {
  it("splits every registered tool into accepting or refusing, with nothing left over", () => {
    expect(unclassified).toEqual([]);
    expect(listed).toHaveLength(REGISTERED_TOOL_COUNT);
    expect(refusing.length + accepting.length).toBe(REGISTERED_TOOL_COUNT);
  });

  it("can build schema-valid arguments for every tool it drives", () => {
    for (const tool of listed) requiredArguments(tool);
    expect(patternGaps).toEqual([]);
  });

  // @req FR-MCP-063 AC-1
  it("refuses workspaceRoot over tools/call on every tool the gate does not accept it for", async () => {
    // The denominator is held to names: non-empty, and carrying these two. A derivation that
    // collapsed to nothing is what a size caught, and an empty set with two named members cannot.
    expect(refusing.length, "the refusing set must not be empty").toBeGreaterThan(0);
    for (const name of REFUSING_WITNESSES) {
      expect(refusing, `${name} must be refused a per-call workspace root`).toContain(name);
    }
    const before = protocolCalls;
    const escaped = await notRefusedWith("MCP_WORKSPACE_ROOT_UNSUPPORTED", WORKSPACE_ROOT_KEY, refusing);
    // The denominator was spent, not merely sized. Asserted before the escape list, because an empty
    // escape list is what a loop that never ran also produces.
    expect(protocolCalls - before, "roundtrips actually made").toBe(refusing.length);
    expect(escaped).toEqual([]);
  }, 180000);

  // @req FR-MCP-063 AC-2
  it("refuses root over tools/call on every registered tool, the accepting ones included", async () => {
    expect(accepting.length).toBeGreaterThan(0);
    const everyName = listed.map((tool) => tool.name);
    expect(everyName).toHaveLength(REGISTERED_TOOL_COUNT);
    const before = protocolCalls;
    const escaped = await notRefusedWith("MCP_WORKSPACE_ROOT_UNSUPPORTED", ROOT_KEY, everyName);
    expect(protocolCalls - before, "roundtrips actually made").toBe(REGISTERED_TOOL_COUNT);
    expect(escaped).toEqual([]);
  }, 180000);

  // @req FR-MCP-063 AC-3
  it("hands the tool the gate's two keys and no other key the tool does not declare", async () => {
    seen.length = 0;
    await client.callTool({ name: "list_requirements", arguments: { limit: 1, unknownKey: "x", anotherUnknown: 2 } });
    expect(seen.map((record) => record.name)).toEqual(["list_requirements"]);
    expect(seen[0]?.keys).toEqual(["limit"]);

    // The gate key and an unknown key in the same call, asserted as an exact set: sending one the
    // seam must carry does not open the door to one it must drop. An earlier draft asserted
    // `not.toContain("unknownKey")` after a call that never sent it, which was true whatever the
    // seam did.
    seen.length = 0;
    await client.callTool({
      name: "list_requirements",
      arguments: { limit: 1, unknownKey: "x", [WORKSPACE_ROOT_KEY]: worktree }
    });
    expect([...(seen[0]?.keys ?? [])].sort()).toEqual([WORKSPACE_ROOT_KEY, "limit"].sort());
  });

  // @req FR-MCP-063 AC-3
  it("does not hand the tool a key that merely looks like one of the gate's two", async () => {
    const declared = toolSchemas.list_requirements;
    for (const key of NEAR_MISS_KEYS) {
      expect(Object.prototype.hasOwnProperty.call(declared, key), `${key} must be undeclared`).toBe(false);
      expect(key === ROOT_KEY || key === WORKSPACE_ROOT_KEY, `${key} must not be a gate key`).toBe(false);
    }

    seen.length = 0;
    await client.callTool({
      name: "list_requirements",
      arguments: { limit: 1, ...Object.fromEntries(NEAR_MISS_KEYS.map((key) => [key, nearMissValue(key)])) }
    });
    expect(seen[0]?.keys, "keys the seam handed the tool").toEqual(["limit"]);

    for (const key of NEAR_MISS_KEYS) {
      seen.length = 0;
      await client.callTool({ name: "list_requirements", arguments: { limit: 1, [key]: nearMissValue(key) } });
      expect(seen[0]?.keys, `${key} must not reach the tool`).toEqual(["limit"]);
    }
  });

  // @req FR-MCP-063 AC-3 — the list above cannot shrink, on either axis, without a case going red.
  it("keeps one near-miss name per loosening it exists to catch, and all three value shapes", () => {
    for (const [label, predicate] of LOOSENINGS) {
      expect(NEAR_MISS_KEYS.filter(predicate), `no name left that catches: ${label}`).not.toEqual([]);
    }
    const values = NEAR_MISS_KEYS.map(nearMissValue);
    expect(values.filter((value) => value.includes("/")), "no forward-slash value left").not.toEqual([]);
    expect(values.filter((value) => value.includes("\\")), "no backslash value left").not.toEqual([]);
    expect(values.filter((value) => !value.includes("/") && !value.includes("\\")), "no opaque value left").not.toEqual([]);
  });

  // @req FR-MCP-063 AC-3
  it("drives every inherited name, and the list it drives them from is the computed set", () => {
    for (const key of PROTOTYPE_KEYS) {
      expect(key in {}, `${key} must be inherited`).toBe(true);
      expect(Object.prototype.hasOwnProperty.call({}, key), `${key} must not be an own key`).toBe(false);
    }
    expect([...PROTOTYPE_KEYS].sort()).toEqual(computedPrototypeDataKeys());
  });

  // @req FR-MCP-063 AC-3 — the names an ordinary unknown key does not cover.
  it("does not hand the tool a key it inherits rather than declares", async () => {
    const inherited = Object.fromEntries(PROTOTYPE_KEYS.map((key) => [key, "x"]));
    seen.length = 0;
    await client.callTool({ name: "list_requirements", arguments: { limit: 1, ...inherited } });
    expect(seen[0]?.keys, "keys the seam handed the tool").toEqual(["limit"]);

    // Each name again on its own, so one surviving key is named rather than hidden inside a single
    // array comparison.
    for (const key of PROTOTYPE_KEYS) {
      seen.length = 0;
      await client.callTool({ name: "list_requirements", arguments: { limit: 1, [key]: "x" } });
      expect(seen[0]?.keys, `${key} must not reach the tool`).toEqual(["limit"]);
    }
  });

  // @req FR-MCP-063 AC-3 — `__proto__` is the one inherited name that is an accessor rather than a
  // data property, and the only one that can write through the object it lands on.
  //
  // What holds this today is NOT this seam. Measured on zod 4.4.1: the object parse deletes the own
  // `__proto__` key before `narrowToDeclaredAndGateKeys` runs, so the narrow never sees it and no
  // mutation of the narrow can turn this case red - restoring `in` and asserting pollution on the
  // handler's own input both leave it green. It is kept as a guard over the composed pipeline,
  // because if that parse ever stopped stripping, `"__proto__" in declared` is true and the widened
  // narrow would assign through it. Recorded in AC-3 as residue rather than as evidence for the seam.
  it("drops __proto__ when it arrives as a real own key, and writes nothing through it", async () => {
    // Built with JSON.parse rather than as an object literal on purpose: a literal `__proto__:`
    // sets the prototype and leaves no own key, so a literal would assert nothing. Parsing is also
    // what the stdio transport does to every request it receives.
    const args = JSON.parse('{"limit":1,"__proto__":{"polluted":"yes"}}') as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(args, "__proto__"), "the fixture must carry a real own key").toBe(true);

    seen.length = 0;
    await client.callTool({ name: "list_requirements", arguments: args });
    expect(seen[0]?.keys, "__proto__ must not reach the tool").toEqual(["limit"]);
    expect(({} as Record<string, unknown>).polluted, "Object.prototype must be untouched").toBeUndefined();
  });

  // @req FR-MCP-063 AC-4
  it("advertises workspaceRoot on every tool the gate accepts it for, and on one more it names", () => {
    const advertised = listed
      .filter((tool) => WORKSPACE_ROOT_KEY in ((tool.inputSchema as JsonSchema).properties ?? {}))
      .map((tool) => tool.name)
      .sort();
    const acceptedNames = [...accepting].sort();
    // No accepting tool hides the argument: a caller reading tools/list can find every root the
    // gate would honour.
    expect(acceptedNames.filter((name) => !advertised.includes(name))).toEqual([]);
    // The other direction is where the known disagreement lives, and it is held to exactly one
    // name rather than to a count, so a second tool advertising what the gate refuses reddens here
    // and so does this one being fixed without the requirement being updated with it.
    expect(advertised.filter((name) => !acceptedNames.includes(name))).toEqual([ADVERTISED_BUT_REFUSED]);
  });

  // @req FR-MCP-063 AC-5
  it("parses with a schema that keeps the gate's two keys where the tool's own shape drops them", () => {
    const declared = toolSchemas[CLOSED_VEHICLE] as Record<string, z.ZodTypeAny>;
    expect(WORKSPACE_ROOT_KEY in declared).toBe(false);
    expect(ROOT_KEY in declared).toBe(false);

    const args = { [CLOSED_VEHICLE_OWN_KEY]: "x", [WORKSPACE_ROOT_KEY]: worktree, [ROOT_KEY]: worktree };
    const droppedByDeclaredShape = z.object(declared).parse(args) as Record<string, unknown>;
    expect(Object.keys(droppedByDeclaredShape)).toEqual([CLOSED_VEHICLE_OWN_KEY]);

    const keptBySeamSchema = sdkToolInputSchema(CLOSED_VEHICLE).parse(args) as Record<string, unknown>;
    expect(Object.keys(keptBySeamSchema).sort()).toEqual([CLOSED_VEHICLE_OWN_KEY, ROOT_KEY, WORKSPACE_ROOT_KEY].sort());
  });

  // @req FR-MCP-063 AC-6
  it("answers the refusal with the gate's own diagnostic rather than a schema validation error", async () => {
    const tool = listed.find((candidate) => candidate.name === CLOSED_VEHICLE);
    expect(tool).toBeDefined();
    const outcome = await protocolCall(tool as Tool, { [WORKSPACE_ROOT_KEY]: worktree });
    expect(outcome.kind).toBe("refusal");
    const payload = (outcome as { payload: Refusal }).payload;
    expect(payload.error.code).toBe("MCP_WORKSPACE_ROOT_UNSUPPORTED");
    expect(payload.error.reason).toBe("workspace-root-unsupported-for-tool");
    expect(payload.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["SRS-E075"]);
    expect(payload.diagnostics[0]?.details).toMatchObject({ workspaceRoot: worktree });
    expect(payload.recovery?.message).toContain("MCP server process working directory");
    expect(payload.mcpWorkspace.workspaceRoot).toBe(host);
    expect(payload.mcpWorkspace.rootSource).toBe("server-cwd-discovery");
  });
});
