import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { main } from "../../src/cli/index.js";
import { addChangeNote } from "../../src/core/mutation/add-change-note.js";
import { addRelatedDoc } from "../../src/core/mutation/add-related-doc.js";
import { resolveProjectRoot } from "../../src/core/project-root.js";
import { createTestMcpServer } from "../../src/mcp/adapter.js";
import { createMcpServer, isReadOnlyTool, toolSchemas } from "../../src/mcp/server.js";
import { registerMutationTools } from "../../src/mcp/tools/mutation-tools.js";
import { registerReadTools } from "../../src/mcp/tools/read-tools.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

// FR-MCP-049 — the `add_related_doc` and `add_change_note` MCP mutation tools. The fixture is
// mutation-target: FR-ARCH-001 holds `| Related Docs | - |` and one Change Notes row.

const SCOPE_DOC = path.join("docs", "spec", "10.product-architecture.srs.md");
const ID = "FR-ARCH-001";
const EXISTING_ROW = "| 2026-05-08 | Created | Fixture |";

async function scope(root: string): Promise<string> {
  return readFile(path.join(root, SCOPE_DOC), "utf8");
}

/** The lines of `after` that differ from `before`, by position; both texts must have the same length. */
function changedLines(before: string, after: string): Array<{ before: string; after: string }> {
  const a = before.split("\n");
  const b = after.split("\n");
  const out: Array<{ before: string; after: string }> = [];
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    if (a[index] !== b[index]) out.push({ before: a[index] ?? "", after: b[index] ?? "" });
  }
  return out;
}

async function holdLock(root: string): Promise<void> {
  await mkdir(path.join(root, "kiwi"), { recursive: true });
  await writeFile(
    path.join(root, "kiwi", ".srs.lock"),
    `${JSON.stringify({
      schemaVersion: "1.0.0",
      owner: "another-session",
      operation: "add_requirement",
      requestId: "held",
      acquiredAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 600_000).toISOString()
    })}\n`,
    "utf8"
  );
}

async function cli(root: string, args: string[]): Promise<{ code: number; stdout: string }> {
  const streams = { stdout: new PassThrough(), stderr: new PassThrough() };
  const code = await main(["--root", root, ...args], streams);
  return { code, stdout: streams.stdout.read()?.toString() ?? "" };
}

describe("FR-MCP-049 — add_related_doc and add_change_note are MCP mutation tools", () => {
  // @req FR-MCP-049 AC-1
  it("AC-1: add_related_doc appends the reference to Related Docs and changes no other line", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    const before = await scope(root);
    const handle = createMcpServer({ root });

    const first = (await handle.callTool("add_related_doc", { id: ID, link: "docs/a.md" })) as { ok: boolean };
    expect(first.ok).toBe(true);
    const once = await scope(root);
    expect(changedLines(before, once)).toEqual([{ before: "| Related Docs | - |", after: "| Related Docs | docs/a.md |" }]);

    const second = (await handle.callTool("add_related_doc", { id: ID, link: "docs/b.md" })) as { ok: boolean };
    expect(second.ok).toBe(true);
    expect(changedLines(once, await scope(root))).toEqual([{ before: "| Related Docs | docs/a.md |", after: "| Related Docs | docs/a.md, docs/b.md |" }]);
  });

  // @req FR-MCP-049 AC-2
  it("AC-2: add_change_note appends one dated row and keeps the existing rows", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    const before = await scope(root);
    const answer = (await createMcpServer({ root }).callTool("add_change_note", { id: ID, change: "AC-2 wording fixed", reason: "OG request", date: "2020-01-02" })) as { ok: boolean };
    expect(answer.ok).toBe(true);
    const after = await scope(root);
    expect(after).toContain(`${EXISTING_ROW}\n| 2020-01-02 | AC-2 wording fixed | OG request |`);
    expect(after.split("\n").length).toBe(before.split("\n").length + 1);
    expect(after.replace("| 2020-01-02 | AC-2 wording fixed | OG request |\n", "")).toBe(before);
  });

  // @req FR-MCP-049 AC-3
  it("AC-3: both tools take one Requirement ID as a string and refuse a list at the schema", () => {
    const relatedDoc = z.object(toolSchemas.add_related_doc as Record<string, z.ZodTypeAny>);
    const changeNote = z.object(toolSchemas.add_change_note as Record<string, z.ZodTypeAny>);
    expect(relatedDoc.safeParse({ id: ID, link: "docs/a.md" }).success).toBe(true);
    expect(relatedDoc.safeParse({ id: [ID, "FR-ARCH-002"], link: "docs/a.md" }).success).toBe(false);
    expect(changeNote.safeParse({ id: ID, change: "c", reason: "r" }).success).toBe(true);
    expect(changeNote.safeParse({ id: [ID, "FR-ARCH-002"], change: "c", reason: "r" }).success).toBe(false);
  });

  // @req FR-MCP-049 AC-4
  it("AC-4: add_change_note with no date writes an ISO calendar date as the row's first cell", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    const answer = (await createMcpServer({ root }).callTool("add_change_note", { id: ID, change: "Undated", reason: "default date" })) as { ok: boolean };
    expect(answer.ok).toBe(true);
    expect(await scope(root)).toMatch(/\n\| \d{4}-\d{2}-\d{2} \| Undated \| default date \|\n/);
  });

  // @req FR-MCP-049 AC-5
  it("AC-5: both tools sit on the mutation surface, not the read surface", () => {
    const mutation = createTestMcpServer({});
    registerMutationTools(mutation, {});
    const read = createTestMcpServer({});
    registerReadTools(read, {});
    for (const tool of ["add_related_doc", "add_change_note"]) {
      expect(mutation.toolKinds[tool], tool).toBe("req-scoped");
      expect(Object.keys(read.tools)).not.toContain(tool);
      expect(isReadOnlyTool(tool), tool).toBe(false);
    }
  });

  // @req FR-MCP-049 AC-5
  it("AC-5: dryRun returns the patch preview and writes nothing on both tools", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    const before = await scope(root);
    const handle = createMcpServer({ root });
    const doc = (await handle.callTool("add_related_doc", { id: ID, link: "docs/a.md", dryRun: true })) as { ok: boolean; value: { written: boolean }; patch: { preview: string[] } };
    const note = (await handle.callTool("add_change_note", { id: ID, change: "Previewed", reason: "dry", date: "2020-01-03", dryRun: true })) as { ok: boolean; value: { written: boolean }; patch: { preview: string[] } };
    expect(doc).toMatchObject({ ok: true, value: { written: false } });
    expect(doc.patch.preview).toEqual(["| Related Docs | docs/a.md |"]);
    expect(note).toMatchObject({ ok: true, value: { written: false } });
    expect(note.patch.preview).toEqual(["| 2020-01-03 | Previewed | dry |"]);
    expect(await scope(root)).toBe(before);
  });

  // @req FR-MCP-049 AC-6
  it("AC-6: the core mutations hold the SRS lock themselves and ignoreLock gets through", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    await holdLock(rootPath);
    const before = await scope(rootPath);
    const root = await resolveProjectRoot(rootPath);

    const doc = await addRelatedDoc(root, { id: ID, reference: "docs/a.md" });
    const note = await addChangeNote(root, { id: ID, date: "2026-11-08", change: "c", reason: "r" });
    expect(doc.error?.code).toBe("SRS_LOCKED");
    expect(note.error?.code).toBe("SRS_LOCKED");
    expect(await scope(rootPath)).toBe(before);

    expect((await addRelatedDoc(root, { id: ID, reference: "docs/a.md", ignoreLock: true })).ok).toBe(true);
    expect((await addChangeNote(root, { id: ID, date: "2026-11-08", change: "c", reason: "r", ignoreLock: true })).ok).toBe(true);
  });

  // @req FR-MCP-049 AC-6
  it("AC-6: the MCP tools and the CLI commands refuse under a held lock and pass with the override", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    await holdLock(root);
    const before = await scope(root);
    const handle = createMcpServer({ root });

    const blockedDoc = (await handle.callTool("add_related_doc", { id: ID, link: "docs/a.md" })) as { ok: boolean; error?: { code: string } };
    const blockedNote = (await handle.callTool("add_change_note", { id: ID, change: "c", reason: "r" })) as { ok: boolean; error?: { code: string } };
    expect(blockedDoc.error?.code).toBe("SRS_LOCKED");
    expect(blockedNote.error?.code).toBe("SRS_LOCKED");
    expect((await cli(root, ["add-related-doc", ID, "--link", "docs/a.md", "--json"])).code).toBe(5);
    expect((await cli(root, ["add-change-note", ID, "--change", "c", "--reason", "r", "--json"])).code).toBe(5);
    expect(await scope(root)).toBe(before);

    expect(((await handle.callTool("add_related_doc", { id: ID, link: "docs/a.md", ignoreLock: true })) as { ok: boolean }).ok).toBe(true);
    expect(((await handle.callTool("add_change_note", { id: ID, change: "c", reason: "r", ignoreLock: true })) as { ok: boolean }).ok).toBe(true);
    expect((await cli(root, ["add-related-doc", ID, "--link", "docs/b.md", "--ignore-lock", "--json"])).code).toBe(0);
    expect((await cli(root, ["add-change-note", ID, "--change", "c2", "--reason", "r2", "--ignore-lock", "--json"])).code).toBe(0);
  });
});
