import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  AGENT_INSTRUCTION_END_MARKER,
  AGENT_INSTRUCTION_HEADING_PREFIX,
  AGENT_INSTRUCTION_VERSION,
  BUNDLED_RULES_VERSION,
  BUNDLED_SRS_RULES_FILENAME,
  renderAgentInstructionSnippet
} from "../../src/core/bootstrap/templates.js";
import { createMcpServer, toolSchemas } from "../../src/mcp/server.js";

/** FR-MCP-011 — the init_project MCP tool, called through the registered server. */

const CURRENT = `${AGENT_INSTRUCTION_HEADING_PREFIX}${AGENT_INSTRUCTION_VERSION}`;

async function emptyRepo(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "speckiwi-init-tool-"));
  await mkdir(path.join(root, ".git"), { recursive: true });
  return root;
}

interface InitAnswer {
  ok: boolean;
  value?: { created: string[]; skipped: string[]; updated: string[] };
  error?: { code: string; message: string };
  diagnostics?: unknown[];
  diagnosticsSummary?: unknown;
}

async function init(root: string, input: Record<string, unknown> = {}): Promise<InitAnswer> {
  return (await createMcpServer({ root }).callTool("init_project", input)) as InitAnswer;
}

function count(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

describe("FR-MCP-011 — init_project", () => {
  it("FR-MCP-011 AC-1: target, scope and force are optional inputs", async () => {
    const schema = toolSchemas.init_project ?? {};
    for (const key of ["target", "scope", "force"]) {
      expect(schema[key], key).toBeDefined();
      expect(schema[key]?.safeParse(undefined).success, `${key} is optional`).toBe(true);
    }
    const root = await emptyRepo();
    expect(await init(root, { target: "v2.0.0", scope: "Payments:PAY" })).toMatchObject({ ok: true });
    expect(await readFile(path.join(root, "docs", "spec", "00.index.md"), "utf8")).toContain("| v2.0.0 | release | planned | Initial target |");
  });

  it("FR-MCP-011 AC-2 AC-3 AC-4 AC-5 AC-6 AC-7 AC-8: creates the structure, an index without requirements, the appendix, the rules document and both agent files with the managed block", async () => {
    const root = await emptyRepo();
    expect(await init(root)).toMatchObject({ ok: true });
    const index = await readFile(path.join(root, "docs", "spec", "00.index.md"), "utf8");
    expect(index).toContain("Target Map");
    expect(index).not.toMatch(/^### [A-Z]+-[A-Z]+-\d+/m);
    expect(await readFile(path.join(root, "docs", "spec", "90.appendix.md"), "utf8")).toContain("Report Paths");
    expect(await readFile(path.join(root, "docs", "rule", BUNDLED_SRS_RULES_FILENAME), "utf8")).toContain(`SRS-MD Authoring Rules v${BUNDLED_RULES_VERSION}`);
    for (const file of ["AGENTS.md", "CLAUDE.md"]) {
      const text = await readFile(path.join(root, file), "utf8");
      expect(text, file).toContain(CURRENT);
      expect(text, file).toContain(AGENT_INSTRUCTION_END_MARKER);
      expect(text, file).toContain("This repository uses `docs/spec/` as the required source of truth for requirements.");
      expect(text, file).toContain("Current work status workflow:");
    }
  });

  it("FR-MCP-011 AC-9: the current block is not inserted twice, and an older or legacy block is replaced", async () => {
    const root = await emptyRepo();
    await writeFile(path.join(root, "AGENTS.md"), `# Notes\n\n${renderAgentInstructionSnippet({ version: "1.4" })}\n`, "utf8");
    await writeFile(path.join(root, "CLAUDE.md"), "# Notes\n\n# SpecKiwi SRS workflow\n\nLegacy instructions.\n", "utf8");
    expect(await init(root)).toMatchObject({ ok: true });
    expect(await init(root)).toMatchObject({ ok: true });
    for (const file of ["AGENTS.md", "CLAUDE.md"]) {
      const text = await readFile(path.join(root, file), "utf8");
      expect(count(text, CURRENT), file).toBe(1);
      expect(count(text, AGENT_INSTRUCTION_END_MARKER), file).toBe(1);
    }
    expect(await readFile(path.join(root, "CLAUDE.md"), "utf8")).not.toContain("Legacy instructions.");
  });

  it("FR-MCP-011 AC-10: success returns created, skipped and updated paths with diagnostics", async () => {
    const root = await emptyRepo();
    const first = await init(root);
    expect(first).toMatchObject({ ok: true, value: { created: expect.any(Array), skipped: expect.any(Array), updated: expect.any(Array) }, diagnostics: expect.any(Array) });
    expect(first.value?.created.length).toBeGreaterThan(0);
    const second = await init(root);
    expect(second.value?.skipped.length).toBeGreaterThan(0);
  });

  it("FR-MCP-011 AC-11: a failure is a structured error, and without force an existing file is not overwritten", async () => {
    const root = await emptyRepo();
    const indexPath = path.join(root, "docs", "spec", "00.index.md");
    await mkdir(path.dirname(indexPath), { recursive: true });
    await writeFile(indexPath, "# hand-written index\n", "utf8");
    const kept = await init(root);
    expect(kept.ok).toBe(true);
    expect(await readFile(indexPath, "utf8")).toBe("# hand-written index\n");

    // A failing call: an SRS mutation lock held by someone else.
    await mkdir(path.join(root, "kiwi"), { recursive: true });
    const now = Date.now();
    await writeFile(
      path.join(root, "kiwi", ".srs.lock"),
      JSON.stringify({ schemaVersion: "1.0.0", owner: "x:1", operation: "other", requestId: "r", acquiredAt: new Date(now).toISOString(), expiresAt: new Date(now + 60_000).toISOString() }),
      "utf8"
    );
    const failed = await init(root, { force: true });
    expect(failed).toMatchObject({ ok: false, error: { code: "SRS_LOCKED", message: expect.any(String) }, diagnostics: expect.any(Array) });
    expect(await readFile(indexPath, "utf8")).toBe("# hand-written index\n");
  });
});
