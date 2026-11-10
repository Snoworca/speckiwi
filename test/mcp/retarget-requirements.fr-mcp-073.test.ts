import { readFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { createMcpServer } from "../../src/mcp/server.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

// @req FR-MCP-073 — MCP exposes retarget, so moving requirements between targets needs no CLI
// fallback. The selection and the refusals live in one core function both surfaces call.
//
// Fixture (mutation-target): the Target Map registers v1.0.0 and v1.1.0; FR-ARCH-001 targets v1.0.0.

const SCOPE_DOC = path.join("docs", "spec", "10.product-architecture.srs.md");
const ID = "FR-ARCH-001";

type Answer = Record<string, unknown> & { ok: boolean; error?: { code: string; message: string } };

async function cli(root: string, argv: string[]): Promise<{ exit: number; payload: Answer }> {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const exit = await main(["--root", root, "retarget", ...argv, "--json"], { stdout, stderr });
  const text = stdout.read()?.toString() ?? "";
  return { exit, payload: (text.length > 0 ? JSON.parse(text) : {}) as Answer };
}

async function mcp(root: string, input: Record<string, unknown>): Promise<Answer> {
  return (await createMcpServer({ root }).callTool("retarget_requirements", input)) as Answer;
}

async function scope(root: string): Promise<string> {
  return (await readFile(path.join(root, SCOPE_DOC), "utf8")).replace(/\| \d{4}-\d{2}-\d{2} \|/g, "| DATE |");
}

describe("FR-MCP-073 AC-1 — the MCP tool writes what retarget --apply writes, and previews without apply", () => {
  it.each([
    ["by id", ["--id", ID], { ids: [ID] }],
    ["by source target", ["--from", "v1.0.0"], { from: "v1.0.0" }]
  ])("moves %s exactly as the CLI does", async (_label, argv, input) => {
    const viaCli = await copyFixtureWorkspace("mutation-target");
    const viaMcp = await copyFixtureWorkspace("mutation-target");
    const cliRun = await cli(viaCli, [...argv, "--to", "v1.1.0", "--reason", "moved for 5.4.0", "--apply"]);
    expect(cliRun.exit, JSON.stringify(cliRun.payload)).toBe(0);
    const answer = await mcp(viaMcp, { ...input, to: "v1.1.0", reason: "moved for 5.4.0", apply: true });
    expect(answer.ok, JSON.stringify(answer)).toBe(true);
    expect(await scope(viaMcp)).toBe(await scope(viaCli));
    expect(await scope(viaMcp)).toContain("| Target | v1.1.0 |");
  });

  it("writes nothing without apply, and returns the CLI's preview", async () => {
    const viaCli = await copyFixtureWorkspace("mutation-target");
    const viaMcp = await copyFixtureWorkspace("mutation-target");
    const before = await scope(viaMcp);
    const preview = await mcp(viaMcp, { ids: [ID], to: "v1.1.0", reason: "preview" });
    const cliPreview = await cli(viaCli, ["--id", ID, "--to", "v1.1.0", "--reason", "preview"]);
    expect(preview.ok).toBe(true);
    expect(await scope(viaMcp)).toBe(before);
    expect((preview as { value?: unknown }).value).toEqual((cliPreview.payload as { value?: unknown }).value);
  });

  it("refuses apply together with dryRun", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    const answer = await mcp(root, { ids: [ID], to: "v1.1.0", reason: "r", apply: true, dryRun: true });
    expect(answer).toMatchObject({ ok: false, error: { code: "USAGE" } });
  });
});

describe("FR-MCP-073 AC-2 — the MCP tool refuses what the CLI refuses, with the same code", () => {
  it.each([
    ["an unregistered source target", ["--from", "v9.9.9"], { from: "v9.9.9" }, "NOT_FOUND"],
    ["an id that names no requirement", ["--id", "FR-ARCH-999"], { ids: ["FR-ARCH-999"] }, "NOT_FOUND"],
    ["an id outside the selection", ["--from", "v1.1.0", "--id", ID], { from: "v1.1.0", ids: [ID] }, "MUTATION_DENIED"]
  ])("refuses %s", async (_label, argv, input, code) => {
    const viaCli = await copyFixtureWorkspace("mutation-target");
    const viaMcp = await copyFixtureWorkspace("mutation-target");
    const before = await scope(viaMcp);
    const cliRun = await cli(viaCli, [...argv, "--to", "v1.1.0", "--reason", "r", "--apply"]);
    expect(cliRun.payload).toMatchObject({ ok: false, error: { code } });
    expect(await mcp(viaMcp, { ...input, to: "v1.1.0", reason: "r", apply: true })).toMatchObject({ ok: false, error: { code } });
    expect(await scope(viaMcp)).toBe(before);
  });

  it("refuses a call naming neither from nor ids with USAGE", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    expect(await mcp(root, { to: "v1.1.0", reason: "r", apply: true })).toMatchObject({ ok: false, error: { code: "USAGE" } });
  });

  it("answers an unregistered destination as the CLI does: every item skipped as target-not-registered", async () => {
    const viaCli = await copyFixtureWorkspace("mutation-target");
    const viaMcp = await copyFixtureWorkspace("mutation-target");
    const before = await scope(viaMcp);
    const cliRun = await cli(viaCli, ["--id", ID, "--to", "v9.9.9", "--reason", "r", "--apply"]);
    const answer = await mcp(viaMcp, { ids: [ID], to: "v9.9.9", reason: "r", apply: true });
    expect((answer as { value?: unknown }).value).toEqual((cliRun.payload as { value?: unknown }).value);
    expect(JSON.stringify(answer)).toContain("target-not-registered");
    expect(await scope(viaMcp)).toBe(before);
  });
});
