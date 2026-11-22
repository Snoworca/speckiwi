import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterAll, describe, expect, it, vi } from "vitest";
import { main } from "../../../src/cli/index.js";
import { addVerificationEvidence } from "../../../src/core/mutation/add-evidence.js";
import { setAcceptanceCriteriaChecked } from "../../../src/core/mutation/check-ac.js";
import { updateStatus } from "../../../src/core/mutation/update-status.js";
import * as fileReferences from "../../../src/core/parser/file-references.js";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { checkLinks } from "../../../src/core/query/links.js";
import type { ProjectRoot } from "../../../src/core/types.js";
import { collectEvidenceReferenceIssuesForRecord, collectMissingEvidenceReferences } from "../../../src/core/workflow/release-readiness.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer, createSdkServer } from "../../../src/mcp/server.js";
import { DIAGNOSTIC_DEFINITIONS } from "../../../src/core/diagnostic-registry.js";
import { cleanupFixtures, gitWorkspaceRepo, rawGit } from "../../mcp/support/workspace-root-fixture.js";

// @req FR-NODE-293 AC-5 AC-6 AC-7 — a comma list of lines (`:7,79,231,234`) is a line designation.
//
// OG (2026-11-21): `add_verification_evidence` wrote `docs/decisions/웹서버-교체/01.결정.md:7,79,231,234`
// with only an easily missed warning, and `update_status verified` then refused the same reference as
// naming no existing file. The line-designation rule knew `:N`, `:N:M` and `:N-M` only.

vi.setConfig({ testTimeout: 60_000 });

afterAll(async () => {
  await cleanupFixtures();
});

const ID = "FR-ARCH-001";
const JAVA = "src/main/Foo.java";
const KOREAN = "docs/decisions/웹서버-교체/01.결정.md";
const KOREAN_MISSING = "docs/decisions/웹서버-교체/없음.md";
const ARCH_DOC = path.join("docs", "spec", "10.product-architecture.srs.md");
const SELF_ROW = "| Requirement | FR-ARCH-001 | self | Fixture self link |";

/** A committed repository holding valid-basic, a Java file and a Korean-named decision file. */
async function workspace(): Promise<ProjectRoot> {
  const directory = await gitWorkspaceRepo("fr-node-293c-");
  const root = await resolveProjectRoot(directory);
  expect(path.resolve(root.root)).toBe(path.resolve(directory));
  expect(path.resolve(await rawGit(directory, "rev-parse", "--show-toplevel"))).toBe(path.resolve(directory));
  for (const file of [JAVA, KOREAN]) {
    await mkdir(path.dirname(path.join(directory, file)), { recursive: true });
    await writeFile(path.join(directory, file), Array.from({ length: 300 }, (_, index) => `line ${index + 1}`).join("\n"));
  }
  return root;
}

async function checkAll(root: ProjectRoot): Promise<void> {
  expect((await setAcceptanceCriteriaChecked(root, { id: ID, acIds: ["all"], checked: true })).ok).toBe(true);
}

async function issuesFor(root: ProjectRoot, reference: string, type = "test") {
  const found = (await parseWorkspace(root)).records.find((entry) => entry.id === ID);
  if (!found) throw new Error(`${ID} is not in the fixture`);
  return collectEvidenceReferenceIssuesForRecord(root.root, { ...found, verificationEvidence: [{ id: "VE-1", type, reference, covers: "all", notes: "-" }] });
}

function io() {
  return { stdout: new PassThrough(), stderr: new PassThrough() };
}

async function cli(root: ProjectRoot, args: string[]): Promise<{ ok: boolean; diagnostics?: Array<{ code: string; message: string }>; error?: { code: string; message: string } }> {
  const streams = io();
  await main(["--root", root.root, ...args, "--json"], streams);
  return JSON.parse(streams.stdout.read()?.toString() ?? "{}");
}

async function addTraceRows(root: ProjectRoot, rows: readonly string[]): Promise<void> {
  const file = path.join(root.root, ARCH_DOC);
  const text = await readFile(file, "utf8");
  if (!text.includes(SELF_ROW)) throw new Error("fixture changed: no Requirement trace row to append below");
  await writeFile(file, text.replace(SELF_ROW, [SELF_ROW, ...rows].join("\n")), "utf8");
}

describe("FR-NODE-293 AC-5 — a comma list of lines and ranges is judged like `:N`", () => {
  // @req FR-NODE-293 AC-5
  it("takes the request's own sequence through the CLI: add-evidence, check-ac, update-status verified", async () => {
    const root = await workspace();
    const added = await cli(root, ["add-evidence", ID, "--type", "inspection", "--reference", `${KOREAN}:7,79,231,234`, "--covers", "AC-1"]);
    expect(added.ok, JSON.stringify(added)).toBe(true);
    expect((added.diagnostics ?? []).map((entry) => entry.code)).not.toContain("SRS-W082");
    expect((await cli(root, ["check-ac", ID, "AC-1", "AC-2"])).ok).toBe(true);
    const promoted = await cli(root, ["update-status", ID, "verified"]);
    expect(promoted.ok, JSON.stringify(promoted)).toBe(true);
    expect(collectMissingEvidenceReferences(await parseWorkspace(root))).toEqual([]);
  });

  // @req FR-NODE-293 AC-5
  it("takes the same sequence through MCP", async () => {
    const root = await workspace();
    const server = createMcpServer({ root: root.root });
    const added = (await server.callTool("add_verification_evidence", { id: ID, type: "inspection", reference: `${KOREAN}:7,79,231,234`, covers: "AC-1" })) as {
      ok: boolean;
      diagnostics: Array<{ code: string }>;
    };
    expect(added.ok).toBe(true);
    expect(added.diagnostics.map((entry) => entry.code)).not.toContain("SRS-W082");
    expect(await server.callTool("check_acceptance_criteria", { id: ID, acIds: ["AC-1", "AC-2"], checked: true })).toMatchObject({ ok: true });
    expect(await server.callTool("update_status", { id: ID, status: "verified" })).toMatchObject({ ok: true });
  });

  // @req FR-NODE-293 AC-5
  it.each([`${JAVA}:3,7`, `${JAVA}:3,5-7`, `${KOREAN}:3,5-7,9`, `${KOREAN}:1,300`])("finds no issue with %s on an existing file", async (reference) => {
    const root = await workspace();
    expect(await issuesFor(root, reference)).toEqual([]);
    expect(await issuesFor(root, reference, "Code")).toEqual([]);
  });

  // @req FR-NODE-293 AC-5
  it("lets a root-level file with a comma list reach the file on a row whose type is not a path kind", async () => {
    const root = await workspace();
    await writeFile(path.join(root.root, "Root.java"), "class Root {}\n");
    expect(await issuesFor(root, "Root.java:3,7", "Code")).toEqual([]);
  });

  // @req FR-NODE-293 AC-5
  it.each([`${KOREAN_MISSING}:3,7`, "src/main/Missing.java:3,5-7"])("still refuses %s as missing at the verified transition", async (reference) => {
    const root = await workspace();
    await checkAll(root);
    expect((await addVerificationEvidence(root, { id: ID, type: "test", reference })).ok).toBe(true);
    const promoted = await updateStatus(root, { id: ID, status: "verified" });
    expect(promoted.ok).toBe(false);
    if (promoted.ok) return;
    expect(promoted.error.message).toContain(`${reference} [missing]`);
  });

  // @req FR-NODE-293 AC-5
  it("resolves a comma-list Trace Link reference in links check, and reports one naming a missing file", async () => {
    const root = await workspace();
    const baseline = await checkLinks(await parseWorkspace(root));
    await addTraceRows(root, [`| Code | ${JAVA}:3,7 | implements | - |`, "| Code | src/none.ts:3,5-7 | implements | - |"]);
    const result = await checkLinks(await parseWorkspace(root));
    expect(result.checked).toBe(baseline.checked + 2);
    expect(result.broken.map((entry) => entry.reference)).toEqual(["src/none.ts:3,5-7"]);
  });

  // @req FR-NODE-293 AC-4 AC-5
  it.each([":3,7", ":3,5-7", ":7,79,231,234"])("strips %s with the one exported rule", (suffix) => {
    expect(fileReferences.withoutLineDesignation(`${JAVA}${suffix}`)).toBe(JAVA);
    expect(fileReferences.traceReferencePath(`${JAVA}${suffix}`)).toBe(JAVA);
  });
});

describe("FR-NODE-293 AC-6 — a malformed comma list is not a line designation", () => {
  // @req FR-NODE-293 AC-6
  it.each([":3, 7", ":3,5:7", ":3,", ":3,,7", ":,3", ":3-,7"])("leaves %s unresolved for evidence and for trace alike", async (suffix) => {
    const root = await workspace();
    const issues = await issuesFor(root, `${JAVA}${suffix}`);
    expect(issues.map((issue) => issue.issue)).toEqual(["missing"]);
    expect(fileReferences.traceReferencePath(`${JAVA}${suffix}`)).not.toBe(JAVA);
  });
});

describe("FR-NODE-293 AC-7 — an unresolved reference's message lists the accepted forms once", () => {
  const forms = (fileReferences as unknown as { LOCAL_REFERENCE_FORMS?: string }).LOCAL_REFERENCE_FORMS ?? "";
  const count = (text: string, part: string) => text.split(part).length - 1;

  // @req FR-NODE-293 AC-7
  it("exports one definition naming every accepted spelling", () => {
    for (const spelling of ["`path`", "`path:N`", "`path:N-M`", "`path:N,M,...`", "`path:N:M`", "`#`"]) expect(forms).toContain(spelling);
  });

  // @req FR-NODE-293 AC-7
  it("puts the forms once into the SRS-W082 warning, however many references are missing", async () => {
    const root = await workspace();
    const added = await addVerificationEvidence(root, { id: ID, type: "test", reference: `${JAVA}:3, 7; ${KOREAN_MISSING}:3` });
    expect(added.ok).toBe(true);
    const warning = added.diagnostics.find((entry) => entry.code === "SRS-W082")?.message ?? "";
    expect(count(warning, "[missing]")).toBe(2);
    expect(count(warning, forms)).toBe(1);
  });

  // @req FR-NODE-293 AC-7
  it("puts the forms once into the MUTATION_DENIED refusal of the verified transition, CLI and MCP", async () => {
    const root = await workspace();
    await checkAll(root);
    expect((await addVerificationEvidence(root, { id: ID, type: "test", reference: `${KOREAN}:3,5:7` })).ok).toBe(true);
    const refused = await cli(root, ["update-status", ID, "verified"]);
    expect(refused.ok).toBe(false);
    expect(count(refused.error?.message ?? "", forms)).toBe(1);
    const viaMcp = (await createMcpServer({ root: root.root }).callTool("update_status", { id: ID, status: "verified" })) as { ok: boolean; error?: { message: string } };
    expect(viaMcp.ok).toBe(false);
    expect(count(viaMcp.error?.message ?? "", forms)).toBe(1);
  });

  // @req FR-NODE-293 AC-7
  it("leaves the forms out when no reference is missing", async () => {
    const root = await workspace();
    const added = await addVerificationEvidence(root, { id: ID, type: "test", reference: "../outside.md" });
    const warning = added.ok ? (added.diagnostics.find((entry) => entry.code === "SRS-W082")?.message ?? "") : "";
    expect(warning).toContain("[outside-project-root]");
    expect(warning).not.toContain(forms);
  });

  // @req FR-NODE-293 AC-7
  it("lists the same forms in the tool description, its reference parameter, the CLI --reference help and the SRS-W082 remediation", async () => {
    const root = await workspace();
    const sdk = createSdkServer(createMcpServer({ root: root.root, rootSource: "server-cwd-discovery" }));
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await sdk.connect(serverTransport);
    const client = new Client({ name: "fr-node-293", version: "1.0.0" }, { capabilities: {} });
    await client.connect(clientTransport);
    const tools = (await client.listTools()).tools;
    const tool = tools.find((entry) => entry.name === "add_verification_evidence");
    expect(tool?.description ?? "").toContain(forms);
    const reference = (tool?.inputSchema.properties as Record<string, { description?: string }> | undefined)?.reference;
    expect(reference?.description ?? "").toContain(forms);
    expect(DIAGNOSTIC_DEFINITIONS.find((entry) => entry.code === "SRS-W082")?.remediation ?? "").toContain(forms);
    const streams = io();
    await main(["add-evidence", "--help"], streams);
    const help = (streams.stdout.read()?.toString() ?? "").replace(/\s+/g, " ");
    expect(help).toContain(forms);
  });
});
