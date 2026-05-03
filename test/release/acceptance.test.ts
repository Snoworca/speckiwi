import { execFileSync, spawnSync } from "node:child_process";
import { cp, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

type ReleaseCommand = {
  name: string;
  command: string;
  args: string[];
  timeoutMs?: number;
};

type ReleaseCheckModule = {
  releaseCommands: () => ReleaseCommand[];
  runReleaseCheck: (options?: {
    commands?: ReleaseCommand[];
    cwd?: string;
    stdio?: "pipe" | "ignore" | "inherit";
  }) => Promise<number>;
};

const repoRoot = resolve(import.meta.dirname, "../..");
const validFixtureRoot = resolve(repoRoot, "test/fixtures/workspaces/valid-basic");
const tempRoots: string[] = [];
const expectedRemediationReqIds = [
  "FR-PRD-006",
  "FR-REQ-016",
  "FR-CACHE-006",
  "FR-CACHE-007",
  "FR-CACHE-009",
  "FR-CACHE-010",
  "FR-CLI-013",
  "NFR-REL-008",
  "NFR-REL-009",
  "NFR-SEC-010",
  "FR-MCP-014",
  "FR-MCP-015",
  "NFR-REL-010",
  "NFR-PERF-007"
] as const;
const remediationAcceptanceMatrix = [
  {
    reqId: "FR-PRD-006",
    coverage: [
      { path: "test/validate/semantic.test.ts", anchors: ["DUPLICATE_PRD_ITEM_ID", "allows identical PRD item ids in different PRD documents"] }
    ]
  },
  {
    reqId: "FR-REQ-016",
    coverage: [
      { path: "test/cli/read-commands.test.ts", anchors: ["filters requirement lists by project id or name and clamps list pagination", "--project"] },
      { path: "test/mcp/tools.test.ts", anchors: ["accepts project filters and enforces separate search and list page limits", "project: \"SpecKiwi\""] }
    ]
  },
  {
    reqId: "FR-CACHE-006",
    coverage: [
      {
        path: "test/cache/cache.test.ts",
        anchors: ["regenerates stale entity, relation, and diagnostics sections before registry results", "Regenerated entity"]
      },
      {
        path: "test/graph/graph.test.ts",
        anchors: ["does not reuse memoized cached graph after source YAML changes", "Dependent Updated"]
      }
    ]
  },
  {
    reqId: "FR-CACHE-007",
    coverage: [
      { path: "test/cache/cache.test.ts", anchors: ["degrades to YAML search when cache files are corrupt or stale", "SEARCH_CACHE_UNREADABLE"] },
      { path: "test/cache/cache.test.ts", anchors: ["falls back to YAML exact lookup when a requirement shard is corrupt", "REQUIREMENT_SHARD_UNREADABLE"] },
      { path: "test/cache/cache.test.ts", anchors: ["falls back to YAML relation data when relation output hashes mismatch", "FR-SPEKIW-BOGUS-0001"] }
    ]
  },
  {
    reqId: "FR-CACHE-009",
    coverage: [{ path: "test/cache/cache.test.ts", anchors: ["filters cache-only search results even when the search cache and manifest look fresh", "FR-SPEKIW-CACHED-0001"] }]
  },
  {
    reqId: "FR-CACHE-010",
    coverage: [
      { path: "test/cli/req-write.test.ts", anchors: ["applies req update with --no-cache without creating a stale marker", "cacheStale: false"] },
      { path: "test/cli/req-write.test.ts", anchors: ["applies req update with --no-cache while ignoring an existing cache directory"] },
      { path: "test/cli/read-commands.test.ts", anchors: ["runs search with --no-cache without reading poisoned cache artifacts", "runs graph with --no-cache without mutating existing cache artifacts"] },
      { path: "test/cli/export.test.ts", anchors: ["exports in no-cache mode without mutating existing cache files"] },
      { path: "test/cache/cache.test.ts", anchors: ["rebuilds stale search cache but does not touch cache files in bypass mode"] }
    ]
  },
  {
    reqId: "FR-CLI-013",
    coverage: [
      { path: "test/search/search.test.ts", anchors: ["page.limit).toBe(10)", "page.limit).toBe(100)"] },
      { path: "test/cli/read-commands.test.ts", anchors: ["clampedReqs.page.limit).toBe(500)", "clampedDocs.page.limit).toBe(500)"] }
    ]
  },
  {
    reqId: "NFR-REL-008",
    coverage: [
      { path: "test/write/apply-concurrency.test.ts", anchors: ["allows only one same-target CLI apply process to win", "rejects a same-target write lock held by another node process"] }
    ]
  },
  {
    reqId: "NFR-REL-009",
    coverage: [
      { path: "test/hardening/reliability.test.ts", anchors: ["recovers stale apply locks and cleans up after a successful apply", "recovers malformed apply locks as stale state"] }
    ]
  },
  {
    reqId: "NFR-SEC-010",
    coverage: [
      { path: "test/hardening/security.test.ts", anchors: ["rejects workspace-external symlink targets for core and MCP reads", "WORKSPACE_ESCAPE"] },
      { path: "test/hardening/security.test.ts", anchors: ["rejects workspace-external cache manifest symlinks"] },
      { path: "test/mcp/tools.test.ts", anchors: ["returns structured validate diagnostics when the store directory is an external symlink"] }
    ]
  },
  {
    reqId: "FR-MCP-014",
    coverage: [{ path: "test/mcp/tools.test.ts", anchors: ["rejects tool shape errors as invalid params and returns ErrorResult for apply policy rejection", "ErrorCode.InvalidParams"] }]
  },
  {
    reqId: "FR-MCP-015",
    coverage: [
      { path: "test/mcp/tools.test.ts", anchors: ["outputSchema !== undefined", "toolOutputSchemaFor(\"speckiwi_search\")"] },
      { path: "src/mcp/tools.ts", anchors: ["outputSchema: toolOutputSchemaFor"] }
    ]
  },
  {
    reqId: "NFR-REL-010",
    coverage: [
      { path: "scripts/release-check.mjs", anchors: ["release-acceptance", "timeoutMs: releaseAcceptanceTimeoutMs"] },
      { path: "package.json", anchors: ["release:acceptance", "release:check"] }
    ]
  },
  {
    reqId: "NFR-PERF-007",
    coverage: [
      { path: "test/perf/perf.test.ts", anchors: ["records lookup, cache, search, validation, and MCP tool timings for a large workspace", "SPECKIWI_PERF_PROFILE"] },
      { path: "package.json", anchors: ["perf:srs"] }
    ]
  }
] as const;

beforeAll(() => {
  execFileSync("npm", ["run", "build"], { cwd: repoRoot, stdio: "pipe" });
});

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("release acceptance gate", () => {
  it("defines a release-check command sequence and propagates command failures", async () => {
    const releaseCheck = (await import("../../scripts/release-check.mjs")) as ReleaseCheckModule;
    const releaseCommands = releaseCheck.releaseCommands();

    expect(releaseCommands.map((command) => [command.command, ...command.args].join(" "))).toEqual([
      "npm run build",
      "npm run typecheck",
      "npm run lint",
      "npm test -- --exclude test/release/**",
      "npm run release:acceptance",
      "npm run perf:srs",
      "npm pack --dry-run"
    ]);
    expect(releaseCommands.find((command) => command.name === "release-acceptance")?.timeoutMs).toBeGreaterThanOrEqual(60_000);
    const perfSrsCommand = releaseCommands.find((command) => command.name === "perf-srs");
    expect(perfSrsCommand).toMatchObject({ command: "npm", args: ["run", "perf:srs"] });
    expect(perfSrsCommand?.timeoutMs).toBeGreaterThanOrEqual(120_000);

    await expect(
      releaseCheck.runReleaseCheck({
        commands: [{ name: "fail", command: process.execPath, args: ["-e", "process.exit(7)"] }],
        cwd: repoRoot,
        stdio: "ignore"
      })
    ).resolves.toBe(7);
  });

  it("runs v1 CLI acceptance commands against a fixture workspace", async () => {
    const workspace = await copyFixture("speckiwi-release-cli-");
    await assertV1Acceptance(workspace);
  });

  it("starts MCP over stdio from the packaged CLI entrypoint", async () => {
    const workspace = await copyFixture("speckiwi-release-mcp-");
    const transport = new StdioClientTransport({
      command: "node",
      args: ["bin/speckiwi", "mcp", "--root", workspace],
      cwd: repoRoot,
      stderr: "pipe"
    });
    const stderrChunks: Buffer[] = [];
    transport.stderr?.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
    const client = new Client({ name: "speckiwi-release", version: "1.0.0" });

    await client.connect(transport);
    const tools = await client.listTools();
    expect(tools.tools.some((tool) => tool.name === "speckiwi_overview")).toBe(true);
    expect(tools.tools.every((tool) => tool.outputSchema?.type === "object")).toBe(true);
    await expect(client.callTool({ name: "speckiwi_overview", arguments: { root: workspace } })).rejects.toMatchObject({
      code: ErrorCode.InvalidParams
    });
    await client.close().catch((error: unknown) => {
      if (!(error instanceof McpError)) {
        throw error;
      }
    });
    expect(Buffer.concat(stderrChunks).toString("utf8")).toBe("");
  });

  it("includes runtime artifacts and package metadata in npm pack dry-run", () => {
    const result = spawnSync("npm", ["pack", "--dry-run", "--json"], {
      cwd: repoRoot,
      encoding: "utf8"
    });

    expect(result.status, result.stderr).toBe(0);
    const packed = JSON.parse(result.stdout) as Array<{ files: Array<{ path: string }> }>;
    const paths = packed[0]?.files.map((file) => file.path).sort() ?? [];

    expect(paths).toContain("bin/speckiwi");
    expect(paths.some((path) => path.startsWith("dist/cli/index."))).toBe(true);
    expect(paths.some((path) => path.startsWith("schemas/") && path.endsWith(".schema.json"))).toBe(true);
    expect(paths).toContain("package.json");
    expect(paths).toContain("README.md");
  }, 20_000);

  it("installs the packed tarball into a temporary global prefix", async () => {
    const packRoot = await tempRoot("speckiwi-release-pack-");
    const globalPrefix = await tempRoot("speckiwi-release-global-");
    const initRoot = await tempRoot("speckiwi-release-installed-init-");

    const pack = spawnSync("npm", ["pack", "--json", "--pack-destination", packRoot], {
      cwd: repoRoot,
      encoding: "utf8"
    });
    expect(pack.status, pack.stderr).toBe(0);
    const packed = JSON.parse(pack.stdout) as Array<{ filename: string }>;
    const tarballPath = resolve(packRoot, packed[0]?.filename ?? "");
    await expect(pathExists(tarballPath)).resolves.toBe(true);

    const install = spawnSync("npm", ["install", "--global", "--prefix", globalPrefix, "--no-audit", "--no-fund", tarballPath], {
      cwd: repoRoot,
      encoding: "utf8"
    });
    expect(install.status, install.stderr).toBe(0);
    const installedBinary = await resolveInstalledBinary(globalPrefix);

    const help = runInstalledBinary(installedBinary, ["--help"]);
    expect(help.status, help.stderr).toBe(0);
    expect(help.stderr).toBe("");
    expect(help.stdout).toContain("Usage: speckiwi");

    const init = runInstalledBinary(installedBinary, [
      "init",
      "--root",
      initRoot,
      "--project-id",
      "release-smoke",
      "--project-name",
      "Release Smoke",
      "--language",
      "typescript",
      "--json"
    ]);
    expect(init.status, init.stderr).toBe(0);
    expect(init.stderr).toBe("");
    expect(JSON.parse(init.stdout)).toMatchObject({ ok: true });
    await expect(pathExists(join(initRoot, ".speckiwi", "index.yaml"))).resolves.toBe(true);
  }, 120_000);

  it("keeps README examples aligned with shipped CLI commands", async () => {
    const readme = await readFile(resolve(repoRoot, "README.md"), "utf8");

    for (const command of [
      "speckiwi init",
      "speckiwi validate",
      "speckiwi search \"상태 전이\"",
      "speckiwi search \"상태 전이\" --limit 10 --offset 0",
      "speckiwi req get FR-CORE-0001",
      "speckiwi list docs",
      "speckiwi list reqs",
      "speckiwi list reqs --scope core --status active --project speckiwi",
      "speckiwi req update FR-CORE-0001 --statement \"Updated requirement\" --apply --no-cache",
      "speckiwi export markdown",
      "speckiwi export markdown --no-cache",
      "speckiwi mcp --root /path/to/project"
    ]) {
      expect(readme).toContain(command);
    }
    expect(readme).toContain("npm run release:acceptance");
    expect(readme).toContain("npm run perf:srs");
  });

  it("maps every remediation checklist item to automated coverage", async () => {
    expect(remediationAcceptanceMatrix.map((item) => item.reqId)).toEqual(expectedRemediationReqIds);

    for (const item of remediationAcceptanceMatrix) {
      expect(item.coverage.length, item.reqId).toBeGreaterThan(0);
      for (const coverage of item.coverage) {
        const text = await readFile(resolve(repoRoot, coverage.path), "utf8");
        for (const anchor of coverage.anchors) {
          expect(text, `${item.reqId} ${coverage.path} missing ${anchor}`).toContain(anchor);
        }
      }
    }
  });
});

function runCli(args: string[]) {
  return spawnSync("node", ["bin/speckiwi", ...args], {
    cwd: repoRoot,
    encoding: "utf8"
  });
}

async function copyFixture(prefix: string): Promise<string> {
  const workspace = await tempRoot(prefix);
  await cp(validFixtureRoot, workspace, { recursive: true });
  return workspace;
}

async function tempRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

async function resolveInstalledBinary(prefix: string): Promise<string> {
  const candidates = process.platform === "win32" ? [join(prefix, "speckiwi.cmd"), join(prefix, "bin", "speckiwi.cmd")] : [join(prefix, "bin", "speckiwi")];
  for (const candidate of candidates) {
    if (await pathExists(candidate)) {
      return candidate;
    }
  }
  throw new Error(`Installed speckiwi binary was not found under ${prefix}.`);
}

function runInstalledBinary(binary: string, args: string[]) {
  return spawnSync(binary, args, {
    cwd: repoRoot,
    encoding: "utf8",
    shell: process.platform === "win32"
  });
}

export async function assertV1Acceptance(root: string): Promise<void> {
  const commands = [
    ["validate", "--root", root, "--json"],
    ["search", "validation", "--root", root, "--json"],
    ["req", "get", "FR-CORE-0001", "--root", root, "--json"],
    ["list", "docs", "--root", root, "--json"],
    ["list", "reqs", "--root", root, "--json"],
    ["export", "markdown", "--root", root, "--json"]
  ];

  for (const args of commands) {
    const result = runCli(args);
    expect(result.status, `${args.join(" ")} stderr=${result.stderr}`).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: true });
  }

  const filteredReqs = runCli(["list", "reqs", "--root", root, "--scope", "core", "--status", "active", "--project", "speckiwi", "--json"]);
  expect(filteredReqs.status, filteredReqs.stderr).toBe(0);
  expect(JSON.parse(filteredReqs.stdout)).toMatchObject({
    ok: true,
    requirements: [{ id: "FR-CORE-0001", scope: "core", status: "active" }],
    page: { limit: 50, total: 1, returned: 1 }
  });

  const unknownProject = runCli(["list", "reqs", "--root", root, "--project", "missing", "--json"]);
  expect(unknownProject.status, unknownProject.stderr).toBe(0);
  expect(JSON.parse(unknownProject.stdout)).toMatchObject({
    ok: true,
    requirements: [],
    page: { limit: 50, total: 0, returned: 0 }
  });

  const searchMax = runCli(["search", "validation", "--root", root, "--limit", "999", "--json"]);
  expect(searchMax.status, searchMax.stderr).toBe(0);
  expect(JSON.parse(searchMax.stdout)).toMatchObject({ ok: true, page: { limit: 100 } });

  const listMax = runCli(["list", "docs", "--root", root, "--limit", "999", "--json"]);
  expect(listMax.status, listMax.stderr).toBe(0);
  expect(JSON.parse(listMax.stdout)).toMatchObject({ ok: true, page: { limit: 500 } });

  const noCacheApply = runCli([
    "req",
    "update",
    "FR-CORE-0001",
    "--statement",
    "The system shall pass release acceptance no-cache apply.",
    "--apply",
    "--no-cache",
    "--root",
    root,
    "--json"
  ]);
  expect(noCacheApply.status, noCacheApply.stderr).toBe(0);
  expect(JSON.parse(noCacheApply.stdout)).toMatchObject({ ok: true, mode: "apply", applied: true, cacheStale: false });
  await expect(pathExists(join(root, ".speckiwi", "cache", "stale.json"))).resolves.toBe(false);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}
