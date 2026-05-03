import net from "node:net";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, relative, resolve } from "node:path";
import { ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, describe, expect, it } from "vitest";
import { applyChange } from "../../src/core/apply-change.js";
import { createSpecKiwiCore } from "../../src/core/api.js";
import { cleanCache, rebuildCache, readCacheManifest } from "../../src/core/cache.js";
import { listDocuments, readDocument } from "../../src/core/documents.js";
import { exportMarkdown } from "../../src/core/export-markdown.js";
import { createProposal } from "../../src/core/propose-change.js";
import { searchWorkspace } from "../../src/core/search.js";
import { validateWorkspace } from "../../src/core/validate.js";
import { normalizeStorePath, WorkspacePathError } from "../../src/io/path.js";
import { readMcpResource } from "../../src/mcp/resources.js";
import { createMcpServer } from "../../src/mcp/server.js";
import { readArtifact, writeArtifact } from "../../src/indexing/serialization.js";
import { workspaceRootFromPath } from "../../src/io/workspace.js";

const repoRoot = resolve(import.meta.dirname, "../..");
const validFixtureRoot = resolve(repoRoot, "test/fixtures/workspaces/valid-basic");
const tempRoots: string[] = [];

type PackageSurface = {
  bin?: Record<string, string>;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
};

const forbiddenDatabaseVectorPackagePatterns: ReadonlyArray<{ label: string; pattern: RegExp }> = [
  { label: "sqlite", pattern: /(^|[:/@_-])sqlite3?($|[:/@_-])/i },
  { label: "better-sqlite3", pattern: /(^|[:/@_-])better-sqlite3($|[:/@_-])/i },
  { label: "postgres", pattern: /(^|[:/@_-])postgres(?:ql)?($|[:/@_-])/i },
  { label: "pg", pattern: /(^|[:/@_-])pg($|[:/@_-])/i },
  { label: "mysql", pattern: /(^|[:/@_-])mysql2?($|[:/@_-])/i },
  { label: "mongodb", pattern: /(^|[:/@_-])mongodb($|[:/@_-])/i },
  { label: "duckdb", pattern: /(^|[:/@_-])duckdb($|[:/@_-])/i },
  { label: "lancedb", pattern: /(^|[:/@_-])lancedb($|[:/@_-])/i },
  { label: "qdrant", pattern: /(^|[:/@_-])qdrant($|[:/@_-])/i },
  { label: "chroma", pattern: /(^|[:/@_-])chroma(?:db)?($|[:/@_-])/i },
  { label: "weaviate", pattern: /(^|[:/@_-])weaviate($|[:/@_-])/i },
  { label: "typeorm", pattern: /(^|[:/@_-])typeorm($|[:/@_-])/i },
  { label: "prisma", pattern: /(^|[:/@_-])prisma($|[:/@_-])/i },
  { label: "knex", pattern: /(^|[:/@_-])knex($|[:/@_-])/i },
  { label: "sequelize", pattern: /(^|[:/@_-])sequelize($|[:/@_-])/i }
];

const forbiddenPackageSurfacePatterns: ReadonlyArray<{ label: string; pattern: RegExp }> = [
  ...forbiddenDatabaseVectorPackagePatterns,
  { label: "migration", pattern: /\b(?:db:)?migrat(?:e|ion|ions)\b/i }
];

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

  it("does not define HTTP server, database, vector-store, or daemon package entry points", async () => {
    const packageJson = JSON.parse(await readFile(resolve(repoRoot, "package.json"), "utf8")) as PackageSurface;
    const searchable = JSON.stringify({
      bin: packageJson.bin,
      scripts: packageJson.scripts,
      dependencies: packageJson.dependencies
    });

    expect(searchable).not.toMatch(/\b(express|fastify|koa|hapi|sqlite|postgres|mysql|mongodb|redis|pm2|forever|nodemon)\b/i);
    expect(collectForbiddenPackageSurfaceFindings(packageJson)).toEqual([]);
    expect(searchable).not.toMatch(/\b(http-server|daemon|listen)\b/i);
  });

  it("does not define database or vector-store direct dependencies", async () => {
    const packageJson = JSON.parse(await readFile(resolve(repoRoot, "package.json"), "utf8")) as PackageSurface;

    expect(collectForbiddenPackageSurfaceFindings(packageJson)).toEqual([]);
    expect(
      collectForbiddenPackageSurfaceFindings({
        dependencies: {
          "better-sqlite3": "^11.0.0",
          lancedb: "^0.18.0"
        },
        scripts: {
          "db:migrate": "prisma migrate deploy"
        }
      })
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining("dependencies.better-sqlite3"),
        expect.stringContaining("dependencies.lancedb"),
        expect.stringContaining("scripts.db:migrate")
      ])
    );
  });

  it("documents the stdio-only MCP runtime and transitive HTTP package boundary", async () => {
    const readme = await readFile(resolve(repoRoot, "README.md"), "utf8");

    expect(readme).toMatch(/\bstdio-only MCP server\b/i);
    expect(readme).toMatch(/\bStdioServerTransport\b/);
    expect(readme).toMatch(/\bdoes not start an HTTP server\b/i);
    expect(readme).toMatch(/\btransitive-only SDK dependencies\b/i);
    expect(readme).toMatch(/\bnot direct SpecKiwi dependencies\b/i);
  });

  it("documents the database and vector-store out-of-scope boundary", async () => {
    const readme = await readFile(resolve(repoRoot, "README.md"), "utf8");

    expect(readme).toMatch(/\bSQLite\b/);
    expect(readme).toMatch(/\bdatabase migration systems\b/i);
    expect(readme).toMatch(/\bvector databases\/vector stores\b/i);
    expect(readme).toMatch(/\bmust not be added as direct dependencies\b/i);
    expect(readme).toMatch(/\bProduct workflows must not create database files\b/i);
    expect(readme).toMatch(/\bparent-package internals\b/i);
  });

  it("keeps HTTP server startup code out of runtime source files", async () => {
    const sourceFiles: string[] = [];
    await walk(resolve(repoRoot, "src"), async (path) => {
      if (extname(path) === ".ts") {
        sourceFiles.push(path);
      }
    });

    const forbiddenRuntimePatterns = [
      /from\s+["']node:(?:http|https|http2)["']/,
      /\b(?:createServer|createSecureServer|createHttpServer)\s*\(/,
      /\.(?:listen)\s*\(/,
      /\b(?:StreamableHTTPServerTransport|SSEServerTransport)\b/,
      /@modelcontextprotocol\/sdk\/server\/(?:streamableHttp|sse)/,
      /\b(?:express|fastify|koa|hapi)\s*\(/,
      /\bnew\s+Hono\s*\(/
    ];
    const findings: string[] = [];

    for (const path of sourceFiles) {
      const source = await readFile(path, "utf8");
      for (const pattern of forbiddenRuntimePatterns) {
        if (pattern.test(source)) {
          findings.push(`${relative(repoRoot, path).replace(/\\/g, "/")}: ${pattern.source}`);
        }
      }
    }

    expect(findings).toEqual([]);
  });

  it("keeps database and vector-store package imports out of product source files", async () => {
    const sourceFiles: string[] = [];
    for (const root of [resolve(repoRoot, "src"), resolve(repoRoot, "bin")]) {
      await walk(root, async (path) => {
        if (root.endsWith("/src") && extname(path) !== ".ts") {
          return;
        }
        sourceFiles.push(path);
      });
    }

    const findings: string[] = [];
    for (const path of sourceFiles) {
      findings.push(
        ...collectForbiddenSourceImportFindings(relative(repoRoot, path).replace(/\\/g, "/"), await readFile(path, "utf8"))
      );
    }

    expect(findings).toEqual([]);
    expect(
      collectForbiddenSourceImportFindings(
        "synthetic.ts",
        'import sqlite from "better-sqlite3";\nconst vectorStore = await import("lancedb");\n'
      )
    ).toEqual(expect.arrayContaining([expect.stringContaining("better-sqlite3"), expect.stringContaining("lancedb")]));
  });

  it("allows MCP SDK HTTP packages only as transitive dependencies", async () => {
    const packageJson = JSON.parse(await readFile(resolve(repoRoot, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
    };
    const packageLock = JSON.parse(await readFile(resolve(repoRoot, "package-lock.json"), "utf8")) as {
      packages?: Record<string, { dependencies?: Record<string, string> }>;
    };
    const directDependencies = Object.keys(packageJson.dependencies ?? {});
    const mcpSdkDependencies = Object.keys(packageLock.packages?.["node_modules/@modelcontextprotocol/sdk"]?.dependencies ?? {});
    const httpSdkDependencies = ["@hono/node-server", "cors", "express", "express-rate-limit", "hono"];

    expect(directDependencies).toContain("@modelcontextprotocol/sdk");
    expect(directDependencies).not.toEqual(expect.arrayContaining(httpSdkDependencies));
    expect(mcpSdkDependencies).toEqual(expect.arrayContaining(httpSdkDependencies));
  });

  it("keeps Git history primary by avoiding alternate history databases during propose and apply workflows", async () => {
    const workspace = await copyFixture("speckiwi-security-git-history-");
    const beforeFiles = await listWorkspaceFiles(workspace);
    const proposal = await createProposal({
      root: workspace,
      operation: "update_requirement",
      target: { kind: "requirement", requirementId: "FR-CORE-0001" },
      changes: [{ op: "replace", path: "/requirements/0/statement", value: "Security hardening shall keep Git history primary." }],
      reason: "Exercise managed proposal YAML without a history database."
    });
    expect(proposal).toMatchObject({
      ok: true,
      applied: false,
      proposal: { path: expect.stringMatching(/^\.speckiwi\/proposals\/.+\.yaml$/) }
    });
    if (!proposal.ok) {
      return;
    }
    const proposalPath = proposal.proposal.path;

    expect(newFilesSince(beforeFiles, await listWorkspaceFiles(workspace))).toEqual([proposalPath]);
    await assertNoDbOrHttpArtifacts(workspace);

    await expect(applyChange({ root: workspace, confirm: true, proposalPath: proposal.proposal.path })).resolves.toMatchObject({
      ok: true,
      applied: true,
      modifiedFiles: [".speckiwi/srs/core.yaml"]
    });
    const newFiles = newFilesSince(beforeFiles, await listWorkspaceFiles(workspace));
    expect(newFiles).toContain(proposalPath);
    expect(newFiles).toContain(".speckiwi/cache/stale.json");
    expect(newFiles.some((path) => /^\.speckiwi\/cache\/backups\/[^/]+\/srs\/core\.yaml$/.test(path))).toBe(true);
    expect(newFiles.filter((path) => !isManagedProposeApplyArtifact(path, proposalPath))).toEqual([]);
    await assertNoDbOrHttpArtifacts(workspace);
  });

  it("does not create database or vector-store artifacts during product workflows", async () => {
    const workspace = await copyFixture("speckiwi-security-db-vector-artifacts-");

    await expect(validateWorkspace({ root: workspace })).resolves.toMatchObject({ ok: true });
    await expect(searchWorkspace({ root: workspace, query: "validation" })).resolves.toMatchObject({ ok: true });
    await expect(rebuildCache({ root: workspace })).resolves.toMatchObject({ ok: true });
    await expect(exportMarkdown({ root: workspace })).resolves.toMatchObject({ ok: true });
    const proposal = await createProposal({
      root: workspace,
      operation: "update_requirement",
      target: { kind: "requirement", requirementId: "FR-CORE-0001" },
      changes: [{ op: "replace", path: "/requirements/0/statement", value: "Security hardening shall avoid DB and vector artifacts." }],
      reason: "Exercise product workflows without database or vector stores."
    });
    expect(proposal).toMatchObject({ ok: true, applied: false });
    if (!proposal.ok) {
      return;
    }
    await expect(applyChange({ root: workspace, confirm: true, proposalPath: proposal.proposal.path })).resolves.toMatchObject({
      ok: true,
      applied: true
    });

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

  it("rejects workspace-external cache artifact symlinks and injected artifact paths", async () => {
    const workspace = await copyFixture("speckiwi-security-cache-artifact-");
    const external = await externalYaml("speckiwi-external-cache-artifact-");
    const artifactPath = join(workspace, ".speckiwi", "cache", "search-index.json");
    await mkdir(resolve(artifactPath, ".."), { recursive: true });
    await replaceWithSymlink(external, artifactPath);

    await expect(
      readArtifact(workspaceRootFromPath(workspace), "cache/search-index.json", (value) =>
        typeof value === "object" && value !== null ? value : undefined
      )
    ).resolves.toMatchObject({
      warning: {
        code: "CACHE_ARTIFACT_UNREADABLE",
        path: ".speckiwi/cache/search-index.json"
      }
    });

    await expect(writeArtifact(workspaceRootFromPath(workspace), "../outside.json", { ok: true })).rejects.toThrow(
      "Store path cannot contain empty, current, or parent segments."
    );
  });

  it("rejects workspace-external cache manifest symlinks", async () => {
    if (process.platform === "win32") {
      return;
    }

    const workspace = await copyFixture("speckiwi-security-cache-manifest-");
    await rebuildCache({ root: workspace });
    const manifestPath = join(workspace, ".speckiwi", "cache", "manifest.json");
    const manifestText = await readFile(manifestPath, "utf8");
    const external = await mkdtemp(join(tmpdir(), "speckiwi-external-cache-manifest-"));
    tempRoots.push(external);
    const externalManifest = join(external, "manifest.json");
    await writeFile(externalManifest, manifestText, "utf8");
    await replaceWithSymlink(externalManifest, manifestPath);

    await expect(readCacheManifest(workspaceRootFromPath(workspace))).resolves.toBeUndefined();
    await expect(readFile(externalManifest, "utf8")).resolves.toBe(manifestText);
  });

  it("does not delete external files through symlinked requirement cache cleanup", async () => {
    if (process.platform === "win32") {
      return;
    }

    const workspace = await copyFixture("speckiwi-security-cache-cleanup-symlink-");
    const external = await mkdtemp(join(tmpdir(), "speckiwi-external-cache-cleanup-"));
    tempRoots.push(external);
    const shardName = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.json";
    const externalShard = join(external, shardName);
    await writeFile(externalShard, "{}\n", "utf8");
    await mkdir(join(workspace, ".speckiwi", "cache"), { recursive: true });
    await rm(join(workspace, ".speckiwi", "cache", "requirements"), { recursive: true, force: true });
    await symlink(external, join(workspace, ".speckiwi", "cache", "requirements"), "dir");

    await expect(rebuildCache({ root: workspace })).resolves.toMatchObject({ ok: false });
    await expect(stat(externalShard)).resolves.toMatchObject({ size: 3 });

    await expect(cleanCache({ root: workspace })).rejects.toThrow("Store path escapes .speckiwi");
    await expect(stat(externalShard)).resolves.toMatchObject({ size: 3 });
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
    await expect(validateWorkspace({ root: workspace })).resolves.toMatchObject({
      ok: false,
      valid: false,
      diagnostics: {
        errors: [{ code: "WORKSPACE_ESCAPE" }]
      }
    });
  });
});

export async function assertNoDbOrHttpArtifacts(root: string): Promise<void> {
  const findings: string[] = [];
  await walkArtifactPaths(root, async (path, isDirectory) => {
    const name = path.split(/[\\/]/).at(-1) ?? "";
    const lowerName = name.toLowerCase();
    const relativePath = relative(root, path).replace(/\\/g, "/");
    const lowerRelativePath = relativePath.toLowerCase();
    const extension = extname(name).toLowerCase();
    if (
      [
        ".db",
        ".sqlite",
        ".sqlite3",
        ".sqlite-journal",
        ".sqlite-wal",
        ".sqlite-shm",
        ".sqlite3-journal",
        ".sqlite3-wal",
        ".sqlite3-shm",
        ".db-journal",
        ".db-wal",
        ".db-shm"
      ].includes(extension) ||
      /(?:^|[._-])(?:db|sqlite3?|database)(?:[._-]|$)/i.test(lowerName) ||
      /(?:^|[._-])http-server(?:[._-]|$)/i.test(lowerName) ||
      /(?:^|\/)(?:migrations?|prisma\/migrations)(?:\/|$)/i.test(lowerRelativePath) ||
      /(?:^|[._/-])(?:vector(?:-?store|-?index)?|embeddings?|lancedb|qdrant|chroma|weaviate|faiss|hnsw)(?:[._/-]|$)/i.test(
        lowerRelativePath
      )
    ) {
      findings.push(isDirectory ? `${relativePath}/` : relativePath);
    }
  });
  expect(findings).toEqual([]);
}

function collectForbiddenPackageSurfaceFindings(packageJson: PackageSurface): string[] {
  const findings: string[] = [];
  for (const [name] of Object.entries(packageJson.dependencies ?? {})) {
    collectPatternFindings(`dependencies.${name}`, name, forbiddenDatabaseVectorPackagePatterns, findings);
  }
  for (const [name, value] of Object.entries(packageJson.bin ?? {})) {
    collectPatternFindings(`bin.${name}`, `${name} ${value}`, forbiddenPackageSurfacePatterns, findings);
  }
  for (const [name, value] of Object.entries(packageJson.scripts ?? {})) {
    collectPatternFindings(`scripts.${name}`, `${name} ${value}`, forbiddenPackageSurfacePatterns, findings);
  }
  return findings.sort();
}

function collectForbiddenSourceImportFindings(relativePath: string, source: string): string[] {
  const findings: string[] = [];
  const importSpecifierPattern =
    /(?:from\s+["']([^"']+)["']|import\s+["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)|require\s*\(\s*["']([^"']+)["']\s*\))/g;
  for (const match of source.matchAll(importSpecifierPattern)) {
    const specifier = match[1] ?? match[2] ?? match[3] ?? match[4];
    const packageName = specifier === undefined ? undefined : packageNameFromSpecifier(specifier);
    if (packageName !== undefined) {
      collectPatternFindings(`${relativePath}:${specifier}`, packageName, forbiddenDatabaseVectorPackagePatterns, findings);
    }
  }
  return findings.sort();
}

function collectPatternFindings(
  location: string,
  value: string,
  patterns: ReadonlyArray<{ label: string; pattern: RegExp }>,
  findings: string[]
): void {
  for (const { label, pattern } of patterns) {
    if (pattern.test(value)) {
      findings.push(`${location}: ${label}`);
    }
  }
}

function packageNameFromSpecifier(specifier: string): string | undefined {
  if (specifier.startsWith(".") || specifier.startsWith("/") || specifier.startsWith("#")) {
    return undefined;
  }
  if (specifier.startsWith("node:")) {
    return specifier;
  }
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

async function listWorkspaceFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  await walk(root, async (path) => {
    files.push(relative(root, path).replace(/\\/g, "/"));
  });
  return files.sort();
}

function newFilesSince(before: string[], after: string[]): string[] {
  const existing = new Set(before);
  return after.filter((path) => !existing.has(path)).sort();
}

function isManagedProposeApplyArtifact(path: string, proposalPath: string): boolean {
  return (
    path === proposalPath ||
    path === ".speckiwi/cache/stale.json" ||
    /^\.speckiwi\/cache\/backups\/[^/]+\/srs\/core\.yaml$/.test(path)
  );
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

async function walkArtifactPaths(root: string, visit: (path: string, isDirectory: boolean) => Promise<void> | void): Promise<void> {
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      await visit(path, true);
      await walkArtifactPaths(path, visit);
    } else if (entry.isFile() || entry.isSymbolicLink()) {
      await stat(path);
      await visit(path, false);
    }
  }
}
