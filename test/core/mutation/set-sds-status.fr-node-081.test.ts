import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { setSdsStatus } from "../../../src/core/mutation/set-sds-status.js";
import { createMcpServer } from "../../../src/mcp/server.js";
import { toolSpecs, assertZeroDriftToolSurface } from "../../../src/mcp/schemas.js";
import { main } from "../../../src/cli/index.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

// FR-NODE-081 — set SDS status mutation enforces the design lifecycle state machine.
//
// Red-phase suite: one test case per acceptance criterion (AC-1..AC-5). The suite
// fails while no set-sds-status mutation exists, until the green step adds the
// forward-only draft→agreed→superseded transition guard patching only the
// design.md metadata Status cell, exposed on CLI and MCP.
//
// Contract under test (docs/spec/50.nodejs-implementation.srs.md FR-NODE-081):
//   - AC-1: draft→agreed patches only the Status cell line.
//   - AC-2: backward transitions fail with a stable code and write nothing.
//   - AC-3: out-of-enum values fail with a stable code and write nothing.
//   - AC-4: missing design.md / missing Status row fail clearly.
//   - AC-5: CLI + MCP surfaces with parity green and dryRun writing nothing.

const TASK = "feature-sds-status";

function io() {
  return { stdout: new PassThrough() as NodeJS.WriteStream, stderr: new PassThrough() as NodeJS.WriteStream };
}

function drain(stream: NodeJS.WriteStream): string {
  return (stream as unknown as PassThrough).read()?.toString() ?? "";
}

function designPath(root: string, task: string): string {
  return path.join(root, "docs", "spec", "steps", task, "design.md");
}

function renderDesign(status?: string): string {
  return [
    "# SDS: fixture design",
    "",
    "| Field | Value |",
    "|---|---|",
    "| Document Type | sds |",
    `| Task | ${TASK} |`,
    "| Target | v1.0.0 |",
    ...(status !== undefined ? [`| Status | ${status} |`] : []),
    "| Date | 2026-07-16 |",
    "",
    "## 1. Context & Scope",
    "",
    "Fixture context.",
    ""
  ].join("\n");
}

async function writeDesign(root: string, status?: string): Promise<void> {
  const dir = path.join(root, "docs", "spec", "steps", TASK);
  await mkdir(dir, { recursive: true });
  await writeFile(designPath(root, TASK), renderDesign(status), "utf8");
}

describe("FR-NODE-081 — set SDS status lifecycle mutation", () => {
  it("FR-NODE-081 AC-1: draft→agreed patches only the Status cell line", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    await writeDesign(root, "draft");
    const before = await readFile(designPath(root, TASK), "utf8");

    const result = await setSdsStatus({ root }, { task: TASK, status: "agreed" });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.from).toBe("draft");
      expect(result.value.to).toBe("agreed");
    }
    const after = await readFile(designPath(root, TASK), "utf8");
    expect(after).toContain("| Status | agreed |");
    expect(after).not.toContain("| Status | draft |");
    // Only the Status line differs.
    const beforeLines = before.split(/\r?\n/);
    const afterLines = after.split(/\r?\n/);
    expect(afterLines.length).toBe(beforeLines.length);
    const changed = afterLines.filter((line, index) => line !== beforeLines[index]);
    expect(changed).toEqual(["| Status | agreed |"]);
  });

  it("FR-NODE-081 AC-2: backward transitions fail with INVALID_SDS_TRANSITION and write nothing", async () => {
    const agreedRoot = await copyFixtureWorkspace("valid-basic");
    await writeDesign(agreedRoot, "agreed");
    const agreedBefore = await readFile(designPath(agreedRoot, TASK), "utf8");
    const backward = await setSdsStatus({ root: agreedRoot }, { task: TASK, status: "draft" });
    expect(backward).toMatchObject({ ok: false, error: { code: "INVALID_SDS_TRANSITION" } });
    expect(await readFile(designPath(agreedRoot, TASK), "utf8")).toBe(agreedBefore);

    const supersededRoot = await copyFixtureWorkspace("valid-basic");
    await writeDesign(supersededRoot, "superseded");
    const supersededBefore = await readFile(designPath(supersededRoot, TASK), "utf8");
    const outOfTerminal = await setSdsStatus({ root: supersededRoot }, { task: TASK, status: "agreed" });
    expect(outOfTerminal).toMatchObject({ ok: false, error: { code: "INVALID_SDS_TRANSITION" } });
    expect(await readFile(designPath(supersededRoot, TASK), "utf8")).toBe(supersededBefore);
  });

  it("FR-NODE-081 AC-3: out-of-enum values fail with INVALID_SDS_STATUS and write nothing", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    await writeDesign(root, "draft");
    const before = await readFile(designPath(root, TASK), "utf8");

    const result = await setSdsStatus({ root }, { task: TASK, status: "bogus" });

    expect(result).toMatchObject({ ok: false, error: { code: "INVALID_SDS_STATUS" } });
    expect(await readFile(designPath(root, TASK), "utf8")).toBe(before);
  });

  it("FR-NODE-081 AC-3 (guard): a task name with separators or traversal is rejected before any path use", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    for (const task of ["../escape", "a/b", "a\\b", "..", "."]) {
      const result = await setSdsStatus({ root }, { task, status: "agreed" });
      expect(result.ok, `task '${task}' must be rejected`).toBe(false);
      if (!result.ok) expect(result.error?.code).toBe("INVALID_STEP_NAME");
    }
  });

  it("FR-NODE-081 AC-4: missing design.md or missing Status row fail clearly", async () => {
    const noDesign = await copyFixtureWorkspace("valid-basic");
    const missingFile = await setSdsStatus({ root: noDesign }, { task: TASK, status: "agreed" });
    expect(missingFile).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });

    const noStatusRow = await copyFixtureWorkspace("valid-basic");
    await writeDesign(noStatusRow, undefined);
    const missingRow = await setSdsStatus({ root: noStatusRow }, { task: TASK, status: "agreed" });
    expect(missingRow).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    if (!missingRow.ok) expect(missingRow.error?.message).toContain("Status");
  });

  it("FR-NODE-081 AC-5: CLI + MCP surfaces with parity green and dryRun writing nothing", async () => {
    // Registry declaration.
    const spec = toolSpecs.find((candidate) => candidate.cliName === "sds-status");
    expect(spec, "registry must declare the `sds-status` CLI leaf").toBeDefined();
    expect(spec?.mcpName).toBe("set_sds_status");
    expect(() => assertZeroDriftToolSurface()).not.toThrow();

    // dryRun evaluates the transition without writing.
    const dryRoot = await copyFixtureWorkspace("valid-basic");
    await writeDesign(dryRoot, "draft");
    const dry = await setSdsStatus({ root: dryRoot }, { task: TASK, status: "agreed", dryRun: true });
    expect(dry).toMatchObject({ ok: true });
    expect(await readFile(designPath(dryRoot, TASK), "utf8")).toContain("| Status | draft |");

    // CLI surface: success exits 0 and patches; invalid transition exits 5.
    const cliRoot = await copyFixtureWorkspace("valid-basic");
    await writeDesign(cliRoot, "draft");
    const streams = io();
    const code = await main(["--root", cliRoot, "step", "sds-status", TASK, "agreed", "--json"], streams);
    expect(code).toBe(0);
    expect(JSON.parse(drain(streams.stdout)).ok).toBe(true);
    expect(await readFile(designPath(cliRoot, TASK), "utf8")).toContain("| Status | agreed |");

    const badStreams = io();
    const badCode = await main(["--root", cliRoot, "step", "sds-status", TASK, "draft", "--json"], badStreams);
    expect(badCode).toBe(5);

    // MCP surface reaches the core mutation.
    const mcpRoot = await copyFixtureWorkspace("valid-basic");
    await writeDesign(mcpRoot, "draft");
    const server = createMcpServer({ root: mcpRoot });
    const result = await server.callTool("set_sds_status", { task: TASK, status: "agreed" });
    expect(result).toMatchObject({ ok: true });
    expect(await readFile(designPath(mcpRoot, TASK), "utf8")).toContain("| Status | agreed |");

    // Appendix documentation (tool-signature parity input).
    const appendix = await readFile(path.join(process.cwd(), "docs", "spec", "90.appendix.md"), "utf8");
    expect(appendix).toContain("`set_sds_status`");
  });
});
