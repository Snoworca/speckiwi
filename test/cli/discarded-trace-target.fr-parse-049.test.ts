import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { DIAGNOSTIC_DEFINITIONS, getDiagnosticDefinition } from "../../src/core/diagnostic-registry.js";
import { addTraceLink } from "../../src/core/mutation/add-trace.js";
import { updateStatus } from "../../src/core/mutation/update-status.js";
import type { Diagnostic } from "../../src/core/types.js";
import { createMcpServer, createSdkServer } from "../../src/mcp/server.js";
import { A, B, C, LIVE, S, SPEC_FILE, discardedTargetWorkspace, lineOf } from "../support/discarded-target-fixture.js";

// @req FR-PARSE-049 — links check (CLI) and validate (CLI and MCP validate_spec) warn on a Requirement
// Trace Link row whose target is discarded, naming its successor, and leave the supersede rows alone.

const CODE = "SRS-W081";

interface Broken {
  requirementId: string;
  reference: string;
  reason: string;
  code: string;
}

async function cli(rootPath: string, args: string[]): Promise<{ exitCode: number; json: Record<string, unknown> }> {
  const streams = { stdout: new PassThrough(), stderr: new PassThrough() };
  const exitCode = await main(["--root", rootPath, ...args, "--json"], streams);
  return { exitCode, json: JSON.parse(streams.stdout.read()?.toString() ?? "{}") as Record<string, unknown> };
}

async function linksCheck(rootPath: string): Promise<Broken[]> {
  return ((await cli(rootPath, ["links", "check"])).json.broken as Broken[]) ?? [];
}

async function validateWarnings(rootPath: string): Promise<Diagnostic[]> {
  return ((await cli(rootPath, ["validate"])).json.warnings as Diagnostic[]) ?? [];
}

function ofCode<T extends { code: string }>(entries: T[]): T[] {
  return entries.filter((entry) => entry.code === CODE);
}

async function mcpValidate(rootPath: string): Promise<Diagnostic[]> {
  const sdk = createSdkServer(createMcpServer({ root: rootPath, rootSource: "server-cwd-discovery" }));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await sdk.connect(serverTransport);
  const client = new Client({ name: "fr-parse-049", version: "1.0.0" }, { capabilities: {} });
  await client.connect(clientTransport);
  const result = (await client.callTool({ name: "validate_spec", arguments: {} })) as { content: Array<{ type: string; text: string }> };
  await client.close();
  const response = JSON.parse(result.content.find((item) => item.type === "text")?.text ?? "{}") as { value?: { diagnostics?: Diagnostic[] } };
  return response.value?.diagnostics ?? [];
}

/** Appends `row` to the Trace Links table of `holder`, by hand: the writers refuse some of these rows. */
async function appendTraceRow(rootPath: string, holder: string, row: string): Promise<void> {
  const file = path.join(rootPath, SPEC_FILE);
  const lines = (await readFile(file, "utf8")).split("\n");
  const heading = lines.findIndex((line) => line.includes(`${holder} — `));
  const tableHeader = lines.findIndex((line, index) => index > heading && line.startsWith("| Type | Reference | Relation | Notes |"));
  let end = tableHeader + 2;
  while (lines[end]?.startsWith("|")) end += 1;
  lines.splice(end, 0, row);
  await writeFile(file, lines.join("\n"), "utf8");
}

describe("FR-PARSE-049 AC-1 — links check reports the B and C rows and not the supersede row", () => {
  // @req FR-PARSE-049 AC-1
  it("holds exactly one entry for B and one for C under the new code, and none for S", async () => {
    const { rootPath } = await discardedTargetWorkspace();
    const broken = await linksCheck(rootPath);
    expect(
      ofCode(broken)
        .map(({ requirementId, reference }) => ({ requirementId, reference }))
        .sort((a, b) => a.requirementId.localeCompare(b.requirementId))
    ).toEqual([
      { requirementId: B, reference: A },
      { requirementId: C, reference: A }
    ]);
    expect(broken.filter((entry) => entry.requirementId === S)).toEqual([]);
  });
});

describe("FR-PARSE-049 AC-2 — validate reports the same rows with their location and successor", () => {
  // @req FR-PARSE-049 AC-2
  it("reports both rows as warnings at the trace row's line, with the discarded ID and successor in details (CLI)", async () => {
    const { rootPath } = await discardedTargetWorkspace();
    const warnings = ofCode(await validateWarnings(rootPath));
    const extendsLine = await lineOf(rootPath, `| Requirement | ${A} | extends |`);
    const dependsLine = await lineOf(rootPath, `| Requirement | ${A} | depends_on |`);
    expect(warnings.map(({ severity, filePath, line, details }) => ({ severity, filePath, line, details })).sort((a, b) => (a.line ?? 0) - (b.line ?? 0))).toEqual([
      { severity: "warning", filePath: SPEC_FILE, line: extendsLine, details: { discardedId: A, successorIds: [S] } },
      { severity: "warning", filePath: SPEC_FILE, line: dependsLine, details: { discardedId: A, successorIds: [S] } }
    ]);
  });

  // @req FR-PARSE-049 AC-2
  it("reports the same two rows through MCP validate_spec", async () => {
    const { rootPath } = await discardedTargetWorkspace();
    const cliRows = ofCode(await validateWarnings(rootPath)).map(({ line, details }) => ({ line, details }));
    const mcpRows = ofCode(await mcpValidate(rootPath)).map(({ line, details }) => ({ line, details }));
    expect(mcpRows).toHaveLength(2);
    expect(mcpRows).toEqual(cliRows);
  });

  // @req FR-PARSE-049 AC-2
  it("lists the successors in the order the discarded marker's see slot uses: file path, then line", async () => {
    const { rootPath } = await discardedTargetWorkspace();
    // LIVE sits above S in the file, so a second supersedes row there comes first although its
    // holder was not the one that discarded A.
    await appendTraceRow(rootPath, LIVE, `| Requirement | ${A} | supersedes | - |`);
    const warnings = ofCode(await validateWarnings(rootPath));
    expect(warnings).toHaveLength(2);
    for (const warning of warnings) expect(warning.details).toEqual({ discardedId: A, successorIds: [LIVE, S] });
  });
});

describe("FR-PARSE-049 AC-3 — the message names the successor, or says none is recorded", () => {
  // @req FR-PARSE-049 AC-3
  it("names the successor in the message of each of the two reports, in links check and in validate", async () => {
    const { rootPath } = await discardedTargetWorkspace();
    const reasons = ofCode(await linksCheck(rootPath)).map((entry) => entry.reason);
    const messages = ofCode(await validateWarnings(rootPath)).map((warning) => warning.message);
    expect(reasons.filter((reason) => reason.includes(S))).toHaveLength(2);
    expect(messages.filter((message) => message.includes(S))).toHaveLength(2);
  });

  // @req FR-PARSE-049 AC-3
  it("says no successor is recorded when no requirement supersedes the target", async () => {
    const { rootPath, root } = await discardedTargetWorkspace();
    // B is discarded without a supersede; LIVE points at B through a row written while B was live.
    const added = await addTraceLink(root, { id: LIVE, type: "Requirement", reference: B, relation: "related_to" });
    expect(added.ok, JSON.stringify(added.error)).toBe(true);
    const discarded = await updateStatus(root, { id: B, status: "discarded" });
    expect(discarded.ok, JSON.stringify(discarded.error)).toBe(true);
    const link = ofCode(await linksCheck(rootPath)).find((entry) => entry.reference === B);
    expect(link?.reason).toMatch(/no successor is recorded/);
    const warning = ofCode(await validateWarnings(rootPath)).find((entry) => (entry.details as { discardedId?: string } | undefined)?.discardedId === B);
    expect(warning?.message).toMatch(/no successor is recorded/);
    expect(warning?.details).toEqual({ discardedId: B, successorIds: [] });
  });
});

describe("FR-PARSE-049 AC-4 — supersedes and superseded_by rows are not reported", () => {
  // @req FR-PARSE-049 AC-4
  it("leaves a superseded_by row to the discarded target unreported, as the supersedes row", async () => {
    const { rootPath } = await discardedTargetWorkspace();
    await appendTraceRow(rootPath, LIVE, `| Requirement | ${A} | superseded_by | - |`);
    expect(ofCode(await linksCheck(rootPath)).filter((entry) => entry.requirementId === LIVE || entry.requirementId === S)).toEqual([]);
    const supersedeLines = [await lineOf(rootPath, `| Requirement | ${A} | superseded_by |`), await lineOf(rootPath, `| Requirement | ${A} | supersedes |`)];
    expect(ofCode(await validateWarnings(rootPath)).filter((entry) => supersedeLines.includes(entry.line ?? -1))).toEqual([]);
  });

  // @req FR-PARSE-049 AC-4
  it("reports any other relation, such as related_to, on the same holder", async () => {
    const { rootPath } = await discardedTargetWorkspace();
    await appendTraceRow(rootPath, LIVE, `| Requirement | ${A} | related_to | - |`);
    expect(ofCode(await linksCheck(rootPath)).filter((entry) => entry.requirementId === LIVE)).toHaveLength(1);
  });
});

describe("FR-PARSE-049 AC-5 — checked_compatible rows and rows held by a discarded requirement are left alone", () => {
  // @req FR-PARSE-049 AC-5
  it("does not report a checked_compatible row to the discarded target", async () => {
    const { rootPath } = await discardedTargetWorkspace();
    await appendTraceRow(rootPath, LIVE, `| Requirement | ${A} | checked_compatible | fpv: fpv1; self: a; peer: b; checked-at: x |`);
    expect(ofCode(await linksCheck(rootPath)).filter((entry) => entry.requirementId === LIVE)).toEqual([]);
    const line = await lineOf(rootPath, `| Requirement | ${A} | checked_compatible |`);
    expect(ofCode(await validateWarnings(rootPath)).filter((entry) => entry.line === line)).toEqual([]);
  });

  // @req FR-PARSE-049 AC-5
  it("does not report the extends and depends_on rows of discarded holders, and reports the same rows held by a live requirement", async () => {
    const { rootPath, root } = await discardedTargetWorkspace();
    for (const holder of [B, C]) {
      const discarded = await updateStatus(root, { id: holder, status: "discarded" });
      expect(discarded.ok, JSON.stringify(discarded.error)).toBe(true);
    }
    // The writers refuse these rows, so they are written by hand; the notes tell them from B's and C's rows.
    await appendTraceRow(rootPath, LIVE, `| Requirement | ${A} | extends | live holder |`);
    await appendTraceRow(rootPath, LIVE, `| Requirement | ${A} | depends_on | live holder |`);
    const spec = await readFile(path.join(rootPath, SPEC_FILE), "utf8");
    // The discarded holders keep their rows: the test is not passing because the rows are gone.
    const lines = spec.split(/\r?\n/);
    expect(lines.filter((line) => line.startsWith(`| Requirement | ${A} | extends |`))).toHaveLength(2);
    expect(lines.filter((line) => line.startsWith(`| Requirement | ${A} | depends_on |`))).toHaveLength(2);

    expect(ofCode(await linksCheck(rootPath)).map(({ requirementId, reference }) => ({ requirementId, reference }))).toEqual([
      { requirementId: LIVE, reference: A },
      { requirementId: LIVE, reference: A }
    ]);
    const liveLines = [await lineOf(rootPath, `| ${A} | extends | live holder |`), await lineOf(rootPath, `| ${A} | depends_on | live holder |`)];
    const warnings = ofCode(await validateWarnings(rootPath));
    expect(warnings.map((warning) => warning.line).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual(liveLines.sort((a, b) => a - b));
    expect(warnings.map((warning) => warning.requirementId)).toEqual([LIVE, LIVE]);
  });
});

describe("FR-PARSE-049 AC-6 — a registered warning that fails only under --fail-on-warning", () => {
  // @req FR-PARSE-049 AC-6
  it("registers the code as a warning, numbered next in the registry's SRS-W sequence", () => {
    const definition = getDiagnosticDefinition(CODE);
    expect(definition).toMatchObject({ severity: "warning", sourceRule: "FR-PARSE-049" });
    // Codes registered in a later release (SRS-W082, v5.4.0) come after it and are not its predecessors.
    const release = (since: string | undefined): number[] => (since ?? "v0").replace(/^v/, "").split(".").map(Number);
    const notLater = (since: string | undefined): boolean => {
      const [a, b] = [release(since), release(definition?.since)];
      for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
        if ((a[index] ?? 0) !== (b[index] ?? 0)) return (a[index] ?? 0) < (b[index] ?? 0);
      }
      return true;
    };
    const others = DIAGNOSTIC_DEFINITIONS.filter((entry) => notLater(entry.since))
      .map((entry) => entry.code)
      .filter((code) => code.startsWith("SRS-W") && code !== CODE)
      .map((code) => Number(code.slice("SRS-W".length)));
    expect(Number(CODE.slice("SRS-W".length))).toBe(Math.max(...others) + 1);
  });

  // @req FR-PARSE-049 AC-6
  it("exits validate 0 when this warning is the only finding, and non-zero under --fail-on-warning", async () => {
    const { rootPath } = await discardedTargetWorkspace();
    const plain = await cli(rootPath, ["validate"]);
    expect((plain.json.summary as { byCode: Record<string, number> }).byCode).toEqual({ [CODE]: 2 });
    expect(plain.exitCode).toBe(0);
    expect((await cli(rootPath, ["validate", "--fail-on-warning"])).exitCode).not.toBe(0);
  });

  // @req FR-PARSE-049 AC-6
  it("keeps the links check exit code as it is: 0, even with entries under the new code", async () => {
    const { rootPath } = await discardedTargetWorkspace();
    const result = await cli(rootPath, ["links", "check"]);
    expect(ofCode(result.json.broken as Broken[])).toHaveLength(2);
    expect(result.exitCode).toBe(0);
  });
});

describe("FR-PARSE-049 AC-7 — a duplicated ID counts as discarded only when every holder is", () => {
  /** Inserts a second, live block holding the ID A above FR-ARCH-001. */
  async function addLiveDuplicateOfA(rootPath: string, status = "planned"): Promise<void> {
    const file = path.join(rootPath, SPEC_FILE);
    const text = await readFile(file, "utf8");
    const start = text.indexOf(`### ${LIVE} — `);
    const end = text.indexOf("\n### ", start + 1);
    const copy = text.slice(start, end).replace(`### ${LIVE} — `, `### ${A} — `).replace(/^\| Status \| \w+ \|$/m, `| Status | ${status} |`).replace(/^\| Requirement \|.*\n/gm, "");
    await writeFile(file, text.slice(0, start) + copy + "\n" + text.slice(start), "utf8");
  }

  // @req FR-PARSE-049 AC-7
  it("does not report rows to an ID that a live block also holds", async () => {
    const { rootPath } = await discardedTargetWorkspace();
    await addLiveDuplicateOfA(rootPath);
    expect(ofCode(await linksCheck(rootPath))).toEqual([]);
    expect(ofCode(await validateWarnings(rootPath))).toEqual([]);
  });

  // @req FR-PARSE-049 AC-7
  it("reports them when every block holding the ID is discarded", async () => {
    const { rootPath } = await discardedTargetWorkspace();
    await addLiveDuplicateOfA(rootPath, "discarded");
    expect(ofCode(await linksCheck(rootPath))).toHaveLength(2);
    expect(ofCode(await validateWarnings(rootPath))).toHaveLength(2);
  });
});
