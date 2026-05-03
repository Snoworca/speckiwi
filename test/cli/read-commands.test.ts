import { execFileSync, spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { rebuildCache } from "../../src/core/cache.js";
import { listRequirements } from "../../src/core/requirements.js";

const root = resolve(import.meta.dirname, "../..");
const validRoot = resolve(root, "test/fixtures/workspaces/valid-basic");
const tempRoots: string[] = [];

describe("read-only CLI commands", () => {
  beforeAll(() => {
    execFileSync("npm", ["run", "build"], { cwd: root, stdio: "pipe" });
  });

  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
  });

  it("prints overview, document lists, and requirement lists as Core DTO JSON", () => {
    const overview = json(["overview", "--root", validRoot, "--json"]);
    const docs = json(["list", "docs", "--root", validRoot, "--type", "srs", "--json"]);
    const reqs = json(["list", "reqs", "--root", validRoot, "--scope", "core", "--json"]);

    expect(overview).toMatchObject({
      ok: true,
      project: { id: "speckiwi" },
      overview: { title: "SpecKiwi" },
      stats: { documents: 3, scopes: 1, requirements: 1 }
    });
    expect(docs).toMatchObject({ ok: true, documents: [{ id: "srs.core", type: "srs", path: "srs/core.yaml" }], page: { limit: 50 } });
    expect(reqs).toMatchObject({ ok: true, requirements: [{ id: "FR-CORE-0001", scope: "core" }], page: { limit: 50 } });
  });

  it("initializes a workspace and rebuilds and cleans cache artifacts through the CLI", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "speckiwi-cli-init-cache-"));
    tempRoots.push(workspace);

    const init = runCli(["init", "--root", workspace, "--project-id", "speckiwi-cli", "--project-name", "SpecKiwi CLI", "--json"]);
    expect(init.status).toBe(0);
    expect(JSON.parse(init.stdout)).toMatchObject({
      ok: true,
      created: expect.arrayContaining([".speckiwi/index.yaml", ".speckiwi/overview.yaml", ".speckiwi/dictionary.yaml"])
    });
    await expect(stat(join(workspace, ".speckiwi", "index.yaml"))).resolves.toMatchObject({ size: expect.any(Number) });
    await expect(readFile(join(workspace, ".speckiwi", "index.yaml"), "utf8")).resolves.toContain("speckiwi-cli");

    const rebuild = runCli(["cache", "rebuild", "--root", workspace, "--json"]);
    expect(rebuild.status).toBe(0);
    expect(JSON.parse(rebuild.stdout)).toMatchObject({
      ok: true,
      operation: "rebuild",
      touchedFiles: expect.arrayContaining([
        ".speckiwi/cache/manifest.json",
        ".speckiwi/cache/search-index.json",
        ".speckiwi/cache/graph.json",
        ".speckiwi/cache/diagnostics.json"
      ])
    });
    await expect(stat(join(workspace, ".speckiwi", "cache", "manifest.json"))).resolves.toMatchObject({ size: expect.any(Number) });
    await expect(stat(join(workspace, ".speckiwi", "cache", "search-index.json"))).resolves.toMatchObject({ size: expect.any(Number) });

    const clean = runCli(["cache", "clean", "--root", workspace, "--json"]);
    expect(clean.status).toBe(0);
    expect(JSON.parse(clean.stdout)).toMatchObject({ ok: true, operation: "clean" });
    await expect(stat(join(workspace, ".speckiwi", "cache", "search-index.json"))).rejects.toThrow();
    await expect(stat(join(workspace, ".speckiwi", "index.yaml"))).resolves.toMatchObject({ size: expect.any(Number) });
  });

  it("filters requirement lists by project id or name and clamps list pagination", () => {
    const byId = json(["list", "reqs", "--root", validRoot, "--project", "speckiwi", "--json"]);
    const byName = json(["list", "reqs", "--root", validRoot, "--project", "SpecKiwi", "--json"]);
    const unknown = json(["list", "reqs", "--root", validRoot, "--project", "missing", "--json"]);
    const combined = json(["list", "reqs", "--root", validRoot, "--project", "speckiwi", "--scope", "core", "--status", "active", "--json"]);
    const clampedReqs = json(["list", "reqs", "--root", validRoot, "--limit", "999", "--json"]);
    const clampedDocs = json(["list", "docs", "--root", validRoot, "--limit", "999", "--json"]);

    expect(byId).toMatchObject({ ok: true, requirements: [{ id: "FR-CORE-0001" }], page: { total: 1 } });
    expect(byName).toMatchObject({ ok: true, requirements: [{ id: "FR-CORE-0001" }], page: { total: 1 } });
    expect(unknown).toMatchObject({ ok: true, requirements: [], page: { returned: 0, total: 0 } });
    expect(combined).toMatchObject({ ok: true, requirements: [{ id: "FR-CORE-0001", scope: "core", status: "active" }] });
    expect(clampedReqs.page.limit).toBe(500);
    expect(clampedDocs.page.limit).toBe(500);
  }, 15000);

  it("filters requirement lists by project, scope, type, status, and tag combinations", async () => {
    const workspace = await createMultiRequirementWorkspace();

    const positive = json([
      "list",
      "reqs",
      "--root",
      workspace,
      "--project",
      "SpecKiwi",
      "--scope",
      "core",
      "--type",
      "functional",
      "--status",
      "active",
      "--tag",
      "validation",
      "--json"
    ]);
    const mixed = json([
      "list",
      "reqs",
      "--root",
      workspace,
      "--scope",
      "core,missing",
      "--type",
      "functional,data",
      "--status",
      "active,missing",
      "--tag",
      "validation,missing",
      "--json"
    ]);
    const unknownScope = json(["list", "reqs", "--root", workspace, "--scope", "missing", "--json"]);
    const wrongStatus = json(["list", "reqs", "--root", workspace, "--status", "retired", "--json"]);
    const wrongTag = json(["list", "reqs", "--root", workspace, "--tag", "missing", "--json"]);
    const wrongType = json(["list", "reqs", "--root", workspace, "--type", "data", "--json"]);
    const coreString = await listRequirements({ root: workspace, scope: "api", type: "interface", status: "active", tag: "api" });
    const coreArray = await listRequirements({
      root: workspace,
      scope: ["core", "api"],
      type: ["functional", "interface"],
      status: ["active"],
      tag: ["validation", "api"]
    });

    expect(positive).toMatchObject({
      ok: true,
      requirements: [{ id: "FR-SPEKIW-FILTER-0001", scope: "core", type: "functional", status: "active" }],
      page: { total: 1, returned: 1, hasMore: false, nextOffset: null }
    });
    expect(mixed).toMatchObject({ ok: true, requirements: [{ id: "FR-SPEKIW-FILTER-0001" }], page: { total: 1 } });
    expect(unknownScope).toMatchObject({ ok: true, requirements: [], page: { total: 0, returned: 0 } });
    expect(wrongStatus).toMatchObject({ ok: true, requirements: [], page: { total: 0, returned: 0 } });
    expect(wrongTag).toMatchObject({ ok: true, requirements: [], page: { total: 0, returned: 0 } });
    expect(wrongType).toMatchObject({ ok: true, requirements: [], page: { total: 0, returned: 0 } });
    expect(coreString).toMatchObject({ ok: true, requirements: [{ id: "IR-SPEKIW-FILTER-0003" }], page: { total: 1 } });
    expect(coreArray).toMatchObject({
      ok: true,
      requirements: [{ id: "FR-SPEKIW-FILTER-0001" }, { id: "IR-SPEKIW-FILTER-0003" }],
      page: { total: 2, returned: 2 }
    });
  }, 15000);

  it("wires search and requirement exact lookup without stdout diagnostics", () => {
    const search = runCli(["search", "Validate workspace", "--root", validRoot, "--mode", "bm25", "--json"]);
    const requirement = runCli(["req", "get", "FR-CORE-0001", "--relations", "--document", "--root", validRoot, "--json"]);

    expect(search.status).toBe(0);
    expect(search.stderr).toBe("");
    const searchJson = JSON.parse(search.stdout) as { results: Array<{ id: string; score: number }> };
    expect(searchJson.results[0]?.id).toBe("FR-CORE-0001");
    expect(searchJson.results[0]?.score).toBeGreaterThan(0);

    expect(requirement.status).toBe(0);
    expect(requirement.stderr).toBe("");
    expect(JSON.parse(requirement.stdout)).toMatchObject({
      ok: true,
      document: { id: "srs.core" },
      requirement: { id: "FR-CORE-0001" },
      relations: { incoming: [], outgoing: [] }
    });
  });

  it("normalizes graph aliases and computes requirement impact", () => {
    const graph = json(["graph", "--root", validRoot, "--type", "requirements", "--json"]);
    const impact = json(["impact", "FR-CORE-0001", "--root", validRoot, "--json"]);

    expect(graph).toMatchObject({ ok: true, graphType: "requirement" });
    expect(graph.nodes.every((node: { entityType: string }) => node.entityType === "requirement")).toBe(true);
    expect(impact).toMatchObject({ ok: true, requirementId: "FR-CORE-0001", impacted: [] });
  });

  it("emits graph diagnostics for invalid relation targets in JSON output", async () => {
    const workspace = await createMultiRequirementWorkspace();
    const apiPath = join(workspace, ".speckiwi", "srs", "api.yaml");
    await writeFile(
      apiPath,
      (await readFile(apiPath, "utf8")).replace("relations: []", "relations:\n      - type: depends_on\n        target: FR-SPEKIW-MISSING-9999"),
      "utf8"
    );

    const result = runCli(["graph", "--root", workspace, "--type", "requirements", "--json"]);
    const parsed = JSON.parse(result.stdout) as { diagnostics: { errors: Array<{ code: string }> } };

    expect(result.status).toBe(2);
    expect(parsed.diagnostics.errors.map((diagnostic) => diagnostic.code)).toContain("UNKNOWN_REQUIREMENT_RELATION_TARGET");
  });

  it("runs graph with --no-cache without creating cache artifacts", async () => {
    const workspace = await createMultiRequirementWorkspace();
    await rm(join(workspace, ".speckiwi", "cache"), { recursive: true, force: true });

    const result = runCli(["graph", "--root", workspace, "--no-cache", "--json"]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: true });
    await expect(stat(join(workspace, ".speckiwi", "cache"))).rejects.toThrow();
  });

  it("runs graph with --no-cache without mutating existing cache artifacts", async () => {
    const workspace = await createMultiRequirementWorkspace();
    await rebuildCache({ root: workspace });
    const manifestPath = join(workspace, ".speckiwi", "cache", "manifest.json");
    const manifestBefore = await readFile(manifestPath, "utf8");

    const result = runCli(["graph", "--root", workspace, "--no-cache", "--json"]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: true });
    await expect(readFile(manifestPath, "utf8")).resolves.toBe(manifestBefore);
  });

  it("runs search with --no-cache without reading poisoned cache artifacts", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "speckiwi-cli-search-no-cache-"));
    tempRoots.push(workspace);
    await cp(validRoot, workspace, { recursive: true });
    await rebuildCache({ root: workspace });
    await writeFile(join(workspace, ".speckiwi", "cache", "search-index.json"), "{not-json", "utf8");

    const result = runCli(["search", "Validate workspace", "--root", workspace, "--mode", "bm25", "--no-cache", "--json"]);
    const parsed = JSON.parse(result.stdout) as { ok: boolean; results: Array<{ id: string }>; diagnostics: { warnings: Array<{ code: string }> } };

    expect(result.status).toBe(0);
    expect(parsed.ok).toBe(true);
    expect(parsed.results.map((item) => item.id)).toContain("FR-CORE-0001");
    expect(parsed.diagnostics.warnings.map((warning) => warning.code)).not.toContain("SEARCH_CACHE_UNREADABLE");
  });

  it("renders human output for read commands", () => {
    const result = runCli(["list", "docs", "--root", validRoot, "--type", "srs"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("srs.core");
    expect(result.stdout).toContain("srs/core.yaml");
  });

  it("honors quiet output without breaking JSON output", () => {
    const quiet = runCli(["overview", "--root", validRoot, "--quiet"]);
    expect(quiet.status).toBe(0);
    expect(quiet.stdout).toBe("");
    expect(quiet.stderr).toBe("");

    const quietJson = runCli(["overview", "--root", validRoot, "--quiet", "--json"]);
    expect(quietJson.status).toBe(0);
    expect(quietJson.stderr).toBe("");
    expect(JSON.parse(quietJson.stdout)).toMatchObject({ ok: true, project: { id: "speckiwi" } });
  });
});

function json(args: string[]) {
  const result = runCli(args);
  expect(result.status).toBe(0);
  expect(result.stderr).toBe("");
  return JSON.parse(result.stdout);
}

function runCli(args: string[]) {
  return spawnSync("node", ["bin/speckiwi", ...args], {
    cwd: root,
    encoding: "utf8"
  });
}

async function createMultiRequirementWorkspace(): Promise<string> {
  const workspace = await mkdtemp(join(tmpdir(), "speckiwi-cli-filters-"));
  tempRoots.push(workspace);
  await mkdir(join(workspace, ".speckiwi", "srs"), { recursive: true });
  await writeFile(
    join(workspace, ".speckiwi", "index.yaml"),
    `schemaVersion: speckiwi/index/v1
project:
  id: speckiwi
  name: SpecKiwi
documents:
  - id: overview
    type: overview
    path: overview.yaml
  - id: dictionary
    type: dictionary
    path: dictionary.yaml
  - id: srs.core
    type: srs
    path: srs/core.yaml
    scope: core
  - id: srs.api
    type: srs
    path: srs/api.yaml
    scope: api
scopes:
  - id: core
    name: Core
    type: module
  - id: api
    name: API
    type: module
links: []
`,
    "utf8"
  );
  await writeFile(
    join(workspace, ".speckiwi", "overview.yaml"),
    `schemaVersion: speckiwi/overview/v1
id: overview
type: overview
title: Filter Overview
status: active
summary: Filter fixture.
`,
    "utf8"
  );
  await writeFile(
    join(workspace, ".speckiwi", "dictionary.yaml"),
    `schemaVersion: speckiwi/dictionary/v1
id: dictionary
type: dictionary
title: Dictionary
status: active
synonyms: {}
normalizations: {}
`,
    "utf8"
  );
  await writeFile(
    join(workspace, ".speckiwi", "srs", "core.yaml"),
    `schemaVersion: speckiwi/srs/v1
id: srs.core
type: srs
scope: core
title: Core SRS
status: active
requirements:
  - id: FR-SPEKIW-FILTER-0001
    type: functional
    title: Active validation filter
    status: active
    statement: The system shall filter active validation requirements.
    rationale: CLI filters need multiple positive and negative cases.
    acceptanceCriteria:
      - id: AC-001
        method: test
        description: Filter returns this requirement.
    tags: [validation, cache]
    relations: []
  - id: REL-SPEKIW-FILTER-0002
    type: reliability
    title: Proposed companion filter
    status: draft
    statement: The system shall keep proposed companion requirements separate.
    rationale: Status filters need negative controls.
    acceptanceCriteria:
      - id: AC-001
        method: test
        description: Status filter excludes this requirement.
    tags: [companion]
    relations: []
`,
    "utf8"
  );
  await writeFile(
    join(workspace, ".speckiwi", "srs", "api.yaml"),
    `schemaVersion: speckiwi/srs/v1
id: srs.api
type: srs
scope: api
title: API SRS
status: active
requirements:
  - id: IR-SPEKIW-FILTER-0003
    type: interface
    title: API filter
    status: active
    statement: The system shall filter API interface requirements.
    rationale: Array filters need a second scope.
    acceptanceCriteria:
      - id: AC-001
        method: test
        description: API filter returns this requirement.
    tags: [api]
    relations: []
`,
    "utf8"
  );
  return workspace;
}
