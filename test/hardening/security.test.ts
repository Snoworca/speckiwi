import net from "node:net";
import { cp, mkdir, mkdtemp, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import { ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, describe, expect, it } from "vitest";
import { rebuildCache } from "../../src/core/cache.js";
import { listDocuments, readDocument } from "../../src/core/documents.js";
import { exportMarkdown } from "../../src/core/export-markdown.js";
import { createProposal } from "../../src/core/propose-change.js";
import { searchWorkspace } from "../../src/core/search.js";
import { validateWorkspace } from "../../src/core/validate.js";
import { normalizeStorePath, WorkspacePathError } from "../../src/io/path.js";
import { readMcpResource } from "../../src/mcp/resources.js";
import { createMcpServer } from "../../src/mcp/server.js";
import { createSpecKiwiCore } from "../../src/mcp/tools.js";

const repoRoot = resolve(import.meta.dirname, "../..");
const validFixtureRoot = resolve(repoRoot, "test/fixtures/workspaces/valid-basic");
const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("security hardening", () => {
  it("rejects path traversal, absolute paths, and Windows drive paths at storage and export boundaries", async () => {
    expectPathError("../outside.yaml", "INVALID_STORE_PATH");
    expectPathError("/tmp/outside.yaml", "INVALID_STORE_PATH");
    expectPathError("C:\\Users\\alice\\outside.yaml", "INVALID_STORE_PATH");
    expectPathError("C:outside.yaml", "INVALID_STORE_PATH");
    expectPathError("C:.", "INVALID_STORE_PATH");
    expectPathError("C:folder/outside.yaml", "INVALID_STORE_PATH");
    expectPathError("safe/../outside.yaml", "INVALID_STORE_PATH");

    const workspace = await copyFixture("speckiwi-security-path-");
    await expect(exportMarkdown({ root: workspace, outputRoot: "../outside" })).resolves.toMatchObject({
      ok: false,
      error: { code: "PATH_TRAVERSAL" }
    });
  });

  it("does not create DB artifacts or open HTTP listeners during core and MCP setup operations", async () => {
    const workspace = await copyFixture("speckiwi-security-artifacts-");
    const originalListen = net.Server.prototype.listen;
    let listenCalls = 0;

    net.Server.prototype.listen = function patchedListen(): net.Server {
      listenCalls += 1;
      throw new Error("SpecKiwi hardening test blocked a network listener.");
    } as typeof originalListen;

    try {
      await expect(validateWorkspace({ root: workspace })).resolves.toMatchObject({ ok: true });
      await expect(searchWorkspace({ root: workspace, query: "validation" })).resolves.toMatchObject({ ok: true });
      await expect(rebuildCache({ root: workspace })).resolves.toMatchObject({ ok: true });
      await expect(exportMarkdown({ root: workspace })).resolves.toMatchObject({ ok: true });
      await expect(
        createProposal({
          root: workspace,
          operation: "update_requirement",
          target: { kind: "requirement", requirementId: "FR-CORE-0001" },
          changes: [{ op: "replace", path: "/requirements/0/statement", value: "Security hardening shall remain local." }],
          reason: "Exercise local proposal generation."
        })
      ).resolves.toMatchObject({ ok: true, applied: false });

      const server = createMcpServer({ root: workspace });
      await server.close();
    } finally {
      net.Server.prototype.listen = originalListen;
    }

    expect(listenCalls).toBe(0);
    await assertNoDbOrHttpArtifacts(workspace);
  });

  it("rejects workspace-external symlink targets for core and MCP reads", async () => {
    const workspace = await copyFixture("speckiwi-security-read-symlink-");
    const external = await externalYaml("speckiwi-external-read-");

    await replaceWithSymlink(external, join(workspace, ".speckiwi", "overview.yaml"));
    await expect(readDocument({ root: workspace, id: "overview", includeRawYaml: true })).resolves.toMatchObject({
      ok: false,
      error: { code: "WORKSPACE_ESCAPE" }
    });
    await expect(readMcpResource("speckiwi://overview", createSpecKiwiCore({ root: workspace }))).rejects.toMatchObject({
      code: ErrorCode.InternalError,
      data: { code: "WORKSPACE_ESCAPE" }
    });

    await replaceWithSymlink(external, join(workspace, ".speckiwi", "srs", "core.yaml"));
    await expect(readDocument({ root: workspace, id: "srs.core", includeRawYaml: true })).resolves.toMatchObject({
      ok: false,
      error: { code: "WORKSPACE_ESCAPE" }
    });
    await expect(readMcpResource("speckiwi://documents/srs.core", createSpecKiwiCore({ root: workspace }))).rejects.toMatchObject({
      code: ErrorCode.InternalError,
      data: { code: "WORKSPACE_ESCAPE" }
    });

    const indexWorkspace = await copyFixture("speckiwi-security-index-symlink-");
    await replaceWithSymlink(external, join(indexWorkspace, ".speckiwi", "index.yaml"));
    await expect(readMcpResource("speckiwi://index", createSpecKiwiCore({ root: indexWorkspace }))).rejects.toMatchObject({
      code: ErrorCode.InternalError,
      data: { code: "WORKSPACE_ESCAPE" }
    });
  });

  it("returns security diagnostics when the store directory is a workspace-external symlink", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "speckiwi-security-store-symlink-"));
    const externalStore = await mkdtemp(join(tmpdir(), "speckiwi-external-store-"));
    tempRoots.push(workspace, externalStore);
    await rm(externalStore, { recursive: true, force: true });
    await cp(join(validFixtureRoot, ".speckiwi"), externalStore, { recursive: true });
    await symlink(externalStore, join(workspace, ".speckiwi"), "dir");

    await expect(listDocuments({ root: workspace })).resolves.toMatchObject({
      ok: false,
      error: { code: "WORKSPACE_ESCAPE" }
    });
    await expect(readDocument({ root: workspace, id: "overview", includeRawYaml: true })).resolves.toMatchObject({
      ok: false,
      error: { code: "WORKSPACE_ESCAPE" }
    });
  });
});

export async function assertNoDbOrHttpArtifacts(root: string): Promise<void> {
  const findings: string[] = [];
  await walk(root, async (path) => {
    const name = path.split(/[\\/]/).at(-1) ?? "";
    const extension = extname(name).toLowerCase();
    if (
      [".db", ".sqlite", ".sqlite3", ".sqlite-journal", ".db-journal"].includes(extension) ||
      /(?:^|\.)(sqlite|sqlite3|database|http-server)\b/i.test(name)
    ) {
      findings.push(path);
    }
  });
  expect(findings).toEqual([]);
}

function expectPathError(input: string, code: WorkspacePathError["code"]): void {
  expect(() => normalizeStorePath(input)).toThrow(WorkspacePathError);
  try {
    normalizeStorePath(input);
  } catch (error) {
    expect(error).toBeInstanceOf(WorkspacePathError);
    expect((error as WorkspacePathError).code).toBe(code);
  }
}

async function copyFixture(prefix: string): Promise<string> {
  const workspace = await mkdtemp(join(tmpdir(), prefix));
  tempRoots.push(workspace);
  await cp(validFixtureRoot, workspace, { recursive: true });
  return workspace;
}

async function externalYaml(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  tempRoots.push(directory);
  const path = join(directory, "external.yaml");
  await writeFile(path, "schemaVersion: speckiwi/overview/v1\ntitle: External Secret\n", "utf8");
  return path;
}

async function replaceWithSymlink(target: string, linkPath: string): Promise<void> {
  await rm(linkPath, { force: true });
  await mkdir(resolve(linkPath, ".."), { recursive: true });
  await symlink(target, linkPath, "file");
}

async function walk(root: string, visit: (path: string) => Promise<void> | void): Promise<void> {
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      await walk(path, visit);
    } else if (entry.isFile() || entry.isSymbolicLink()) {
      await stat(path);
      await visit(path);
    }
  }
}
