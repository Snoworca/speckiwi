import path from "node:path";
import { PassThrough } from "node:stream";
import { afterAll, describe, expect, it, vi } from "vitest";
import { main } from "../../src/cli/index.js";
import { addVerificationEvidence } from "../../src/core/mutation/add-evidence.js";
import { resolveProjectRoot } from "../../src/core/project-root.js";
import { createMcpServer } from "../../src/mcp/server.js";
import { renderToolDescriptions } from "../../src/mcp/schemas.js";
import { cleanupFixtures, gitWorkspaceRepo, rawGit } from "./support/workspace-root-fixture.js";

// @req FR-NODE-294 — the three granular edit tools answer with the mutation summary, not the whole
// re-read requirement.
//
// OG (2026-11-11): one evidence cell edited through edit_requirement_table_rows answered 48,000 to
// 55,000 characters, 98% of it `value.record`, and once overran the tool output limit.

// Each case seeds and commits a real repository, which takes seconds on Windows.
vi.setConfig({ testTimeout: 60_000 });

afterAll(async () => {
  await cleanupFixtures();
});

const ID = "FR-ARCH-001";
const NEW_REFERENCE = "docs/spec/90.appendix.md";

interface Answer {
  ok: boolean;
  value?: Record<string, unknown> & { mutation?: { operations: unknown[]; preview: string[]; written: boolean; dryRun: boolean } };
  mutation?: { operations: unknown[]; preview: string[]; written: boolean; dryRun: boolean };
}

/** A committed repository holding valid-basic with one evidence row, checked to be the root in use. */
async function workspace(): Promise<string> {
  const directory = await gitWorkspaceRepo("fr-node-294-");
  const root = await resolveProjectRoot(directory);
  expect(path.resolve(root.root)).toBe(path.resolve(directory));
  expect(path.resolve(await rawGit(directory, "rev-parse", "--show-toplevel"))).toBe(path.resolve(directory));
  expect((await addVerificationEvidence(root, { id: ID, type: "test", reference: "old.ts", covers: "all", notes: "-" })).ok).toBe(true);
  return directory;
}

/** The arguments each tool takes for one real change, by MCP name and by CLI argv. */
const TOOLS = [
  {
    name: "edit_requirement_table_rows",
    mcp: { id: ID, section: "verification_evidence", operations: [{ kind: "update", rowId: "VE-1", values: { reference: NEW_REFERENCE } }] },
    cli: ["edit-requirement-table-rows", ID, "--section", "verification_evidence", "--operations", JSON.stringify([{ kind: "update", rowId: "VE-1", values: { reference: NEW_REFERENCE } }])],
    changed: NEW_REFERENCE
  },
  {
    name: "edit_requirement_fields",
    mcp: { id: ID, title: "Edited title for FR-NODE-294" },
    cli: ["edit-requirement", ID, "--title", "Edited title for FR-NODE-294"],
    changed: "Edited title for FR-NODE-294"
  },
  {
    name: "replace_acceptance_criteria",
    mcp: { id: ID, items: [{ text: "Replaced criterion for FR-NODE-294", checked: false }] },
    cli: ["replace-acceptance-criteria", ID, "--items", JSON.stringify([{ text: "Replaced criterion for FR-NODE-294", checked: false }])],
    changed: "Replaced criterion for FR-NODE-294"
  }
] as const;

async function cli(root: string, args: readonly string[]): Promise<Answer> {
  const streams = { stdout: new PassThrough(), stderr: new PassThrough() };
  const code = await main(["--root", root, ...args, "--json"], streams);
  const stdout = streams.stdout.read()?.toString() ?? "";
  expect(code, stdout || streams.stderr.read()?.toString()).toBe(0);
  return JSON.parse(stdout) as Answer;
}

function envelope(answer: Answer) {
  return answer.mutation ?? answer.value?.mutation;
}

describe("FR-NODE-294 AC-1 — a write answers with the mutation summary and no record", () => {
  it.each(TOOLS)("$name through MCP", async (tool) => {
    const root = await workspace();
    const answer = (await createMcpServer({ root }).callTool(tool.name, tool.mcp)) as Answer;
    expect(answer.ok, JSON.stringify(answer).slice(0, 500)).toBe(true);
    expect(answer.value).toMatchObject({ id: ID, written: true, updatedFields: expect.any(Array) });
    expect(answer.value).not.toHaveProperty("record");
    expect(envelope(answer)?.written).toBe(true);
    expect(envelope(answer)?.operations.length).toBeGreaterThan(0);
    expect(envelope(answer)?.preview.join("\n")).toContain(tool.changed);
  });

  it.each(TOOLS)("$name through the CLI with --json", async (tool) => {
    const root = await workspace();
    const answer = await cli(root, tool.cli);
    expect(answer.ok).toBe(true);
    expect(answer.value).toMatchObject({ id: ID, written: true });
    expect(answer.value).not.toHaveProperty("record");
    expect(envelope(answer)?.preview.join("\n")).toContain(tool.changed);
  });

  it("keeps the edit_requirement_table_rows answer small however large the block is", async () => {
    const root = await workspace();
    const projectRoot = await resolveProjectRoot(root);
    for (let index = 0; index < 6; index += 1) {
      expect((await addVerificationEvidence(projectRoot, { id: ID, type: "test", reference: `old-${index}.ts`, covers: "all", notes: "n".repeat(2000) })).ok).toBe(true);
    }
    const answer = await createMcpServer({ root }).callTool("edit_requirement_table_rows", TOOLS[0].mcp);
    expect(JSON.stringify(answer).length).toBeLessThan(4000);
  });
});

describe("FR-NODE-294 AC-2 — a dry run and a no-op answer in the same shape", () => {
  it.each(TOOLS)("$name with dryRun", async (tool) => {
    const root = await workspace();
    const answer = (await createMcpServer({ root }).callTool(tool.name, { ...tool.mcp, dryRun: true })) as Answer;
    expect(answer.ok).toBe(true);
    expect(answer.value).toMatchObject({ id: ID, written: false });
    expect(answer.value).not.toHaveProperty("record");
    expect(envelope(answer)?.dryRun).toBe(true);
  });

  it("edit_requirement_fields with nothing to change", async () => {
    const root = await workspace();
    const answer = (await createMcpServer({ root }).callTool("edit_requirement_fields", { id: ID })) as Answer;
    expect(answer.ok, JSON.stringify(answer).slice(0, 500)).toBe(true);
    expect(answer.value).toMatchObject({ id: ID, written: false });
    expect(answer.value).not.toHaveProperty("record");
  });
});

describe("FR-NODE-294 AC-3 — each description says what comes back and where the whole requirement is read", () => {
  it.each(TOOLS.map((tool) => tool.name))("%s", (name) => {
    const description = renderToolDescriptions()[name] ?? "";
    expect(description).toMatch(/mutation summary/i);
    expect(description).toContain("`get_requirement`");
  });
});
