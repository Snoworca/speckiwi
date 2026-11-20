import { PassThrough } from "node:stream";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { updateField } from "../../src/core/mutation/update-field.js";
import { updateStability } from "../../src/core/mutation/update-stability.js";
import { ENGINES } from "../../src/core/orchestrator/journal-schema.js";
import { DEFERRAL_REASON_CLASSES, deferIssue, ISSUE_CLASSES, openIssue, planIssue, type IssueRow } from "../../src/core/orchestrator/issue-ledger.js";
import { PRD_CURSOR_VERDICTS } from "../../src/core/prd/ledger.js";
import { resolveProjectRoot } from "../../src/core/project-root.js";
import { PRIORITY_LEVELS, REQUIREMENT_STATUSES, REQUIREMENT_TYPES, RISK_LEVELS, STABILITY_LEVELS } from "../../src/core/types.js";
import { createMcpServer, createSdkServer } from "../../src/mcp/server.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

// @req FR-MCP-075 — two OG lanes found append_section_note's accepted keys only by reading the built
// source (FR-MCP-018). The same shape held elsewhere: add_requirement answered a bad type with
// "Invalid requirement type", naming neither the value nor the set, and no field described its values.

type Answer = { ok: boolean; error?: { code: string; message: string } };

/** Every accepted value appears in `text`, and so does the refused one when given. */
function expectListed(text: string | undefined, values: readonly string[], refused?: string): void {
  // Whole words, so `non_functional` does not stand in for `functional`.
  const words = new Set((text ?? "").split(/[\s,;:()'"]+/).filter((word) => word !== ""));
  for (const value of values) expect([...words], value).toContain(value);
  if (refused !== undefined) expect([...words]).toContain(refused);
}

async function workspace(): Promise<string> {
  return copyFixtureWorkspace("mutation-target");
}

async function call(rootPath: string, tool: string, args: Record<string, unknown>): Promise<Answer> {
  return (await createMcpServer({ root: rootPath }).callTool(tool, args)) as Answer;
}

const REQUIREMENT = { scope: "ARCH", target: "v1.0.0", title: "Closed values", requirement: "SpecKiwi SHALL keep it.", acceptanceCriteria: ["It is kept."] };
const BAD = "not-a-value";

describe("FR-MCP-075 AC-2 — each field describes its values from the guard's constant", () => {
  const FIELDS: Array<[string, string, readonly string[]]> = [
    ["add_requirement", "type", REQUIREMENT_TYPES],
    ["add_requirement", "status", REQUIREMENT_STATUSES],
    ["add_requirement", "stability", STABILITY_LEVELS],
    ["supersede_requirement", "type", REQUIREMENT_TYPES],
    ["update_status", "status", REQUIREMENT_STATUSES],
    ["edit_requirement_fields", "priority", PRIORITY_LEVELS],
    ["edit_requirement_fields", "risk", RISK_LEVELS],
    ["update_step_state", "status", ["active", "merging", "merged", "abandoned"]],
    ["set_sds_status", "status", ["draft", "agreed", "superseded"]],
    ["prd_cursor", "verdict", [...PRD_CURSOR_VERDICTS["prd-to-srs"], ...PRD_CURSOR_VERDICTS["srs-to-prd"]]],
    ["orchestrate_resume", "engine", ENGINES],
    ["orchestrate_wave_status", "engine", ENGINES],
    ["orchestrate_issue_plan", "class", ISSUE_CLASSES],
    ["orchestrate_issue_defer", "reason", DEFERRAL_REASON_CLASSES]
  ];

  // @req FR-MCP-075 AC-2 AC-3
  it("lists every accepted value in each field description, which stays a plain string", async () => {
    const sdk = createSdkServer(createMcpServer({ root: process.cwd(), rootSource: "server-cwd-discovery" }));
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await sdk.connect(serverTransport);
    const client = new Client({ name: "fr-mcp-075", version: "1.0.0" }, { capabilities: {} });
    await client.connect(clientTransport);
    const tools = await client.listTools();
    await client.close();
    for (const [tool, field, values] of FIELDS) {
      const schema = tools.tools.find((item) => item.name === tool)?.inputSchema as { properties?: Record<string, { type?: string; description?: string; enum?: unknown }> };
      const property = schema?.properties?.[field];
      expect(property?.type, `${tool}.${field}`).toBe("string");
      expect(property?.enum, `${tool}.${field}`).toBeUndefined();
      expectListed(property?.description, values);
    }
  });
});

describe("FR-MCP-075 AC-1 AC-3 — a refusal names the value and the set, with its code unchanged", () => {
  // @req FR-MCP-075 AC-1 AC-3
  it("add_requirement type, status and stability", async () => {
    const rootPath = await workspace();
    for (const [field, values] of [["type", REQUIREMENT_TYPES], ["status", REQUIREMENT_STATUSES], ["stability", STABILITY_LEVELS]] as const) {
      const args = { type: "functional", ...REQUIREMENT, [field]: BAD };
      const answer = await call(rootPath, "add_requirement", args);
      expect(answer.ok, field).toBe(false);
      expect(answer.error?.code, field).toBe("USAGE");
      expectListed(answer.error?.message, values, BAD);
    }
  });

  // @req FR-MCP-075 AC-1
  it("supersede_requirement type", async () => {
    const answer = await call(await workspace(), "supersede_requirement", { oldId: "FR-ARCH-001", scope: "ARCH", target: "v1.0.0", title: "Next", statement: "SpecKiwi SHALL keep it.", acceptanceCriteria: ["It is kept."], type: BAD, dryRun: true });
    expect(answer.ok).toBe(false);
    expectListed(answer.error?.message, REQUIREMENT_TYPES, BAD);
  });

  // @req FR-MCP-075 AC-1 AC-3
  it("update_status status, edit_requirement_fields priority and risk", async () => {
    const rootPath = await workspace();
    const status = await call(rootPath, "update_status", { id: "FR-ARCH-001", status: BAD });
    expect(status.error?.code).toBe("USAGE");
    expectListed(status.error?.message, REQUIREMENT_STATUSES, BAD);
    const priority = await call(rootPath, "edit_requirement_fields", { id: "FR-ARCH-001", priority: BAD, dryRun: true });
    expect(priority.error?.code).toBe("USAGE");
    expectListed(priority.error?.message, PRIORITY_LEVELS, BAD);
    const risk = await call(rootPath, "edit_requirement_fields", { id: "FR-ARCH-001", risk: BAD, dryRun: true });
    expectListed(risk.error?.message, RISK_LEVELS, BAD);
  });

  // @req FR-MCP-075 AC-1
  it("update_stability stability and update_field type, refused by the core guards the CLI reaches", async () => {
    const root = await resolveProjectRoot(await workspace());
    const stability = await updateStability(root, { id: "FR-ARCH-001", stability: BAD } as never);
    expect(stability.error?.code).toBe("USAGE");
    expectListed(stability.error?.message, STABILITY_LEVELS, BAD);
    const type = await updateField(root, { id: "FR-ARCH-001", field: "type", value: BAD, dryRun: true });
    expect(type.error?.code).toBe("USAGE");
    expectListed(type.error?.message, REQUIREMENT_TYPES, BAD);
  });

  // @req FR-MCP-075 AC-1
  it("orchestrate issue class and deferral reason", () => {
    const row: IssueRow = { issueId: "I-1", wave: 1, class: "local-defect", source: null, resolutionKind: null, resolutionRef: null, userDecisionRef: null, designLockDigest: null } as IssueRow;
    const planned = planIssue([row], "I-1", BAD);
    expectListed(planned.violations.map((item) => item.detail).join("\n"), ISSUE_CLASSES, BAD);
    const opened = openIssue([], { ...row, class: BAD });
    expectListed(opened.violations.map((item) => item.detail).join("\n"), ISSUE_CLASSES, BAD);
    const deferred = deferIssue([row], "I-1", BAD);
    expectListed(deferred.violations.map((item) => item.detail).join("\n"), DEFERRAL_REASON_CLASSES, BAD);
  });
});

describe("FR-MCP-075 AC-3 AC-4 — values accepted before still are, and the CLI prints the same list", () => {
  // @req FR-MCP-075 AC-3
  it("every accepted type is still accepted", async () => {
    const rootPath = await workspace();
    for (const type of REQUIREMENT_TYPES) {
      const answer = await call(rootPath, "add_requirement", { type, ...REQUIREMENT, dryRun: true });
      expect(answer.ok, type).toBe(true);
    }
  });

  // @req FR-MCP-075 AC-4
  it("the CLI refusal of add-requirement --type lists the types", async () => {
    const rootPath = await workspace();
    const streams = { stdout: new PassThrough(), stderr: new PassThrough() };
    await main(["--root", rootPath, "add-requirement", "--type", BAD, "--scope", "ARCH", "--target", "v1.0.0", "--title", "T", "--statement", "SpecKiwi SHALL keep it.", "--ac", "It is kept.", "--json"], streams);
    const answer = JSON.parse(streams.stdout.read()?.toString() ?? "{}") as Answer;
    expect(answer.ok).toBe(false);
    expectListed(answer.error?.message, REQUIREMENT_TYPES, BAD);
  });
});
