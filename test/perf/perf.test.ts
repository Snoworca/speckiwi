import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpError } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, describe, expect, it } from "vitest";
import { rebuildCache } from "../../src/core/cache.js";
import type { PerfCounters } from "../../src/core/dto.js";
import { getRequirement } from "../../src/core/requirements.js";
import { searchWorkspace } from "../../src/core/search.js";
import { validateWorkspace } from "../../src/core/validate.js";
import { createMcpServer } from "../../src/mcp/server.js";

type FixtureWorkspace = {
  root: string;
  requirementCount: number;
  documentCount: number;
  targetId: string;
  targetQuery: string;
};

type LargeWorkspaceOptions = {
  requirementCount?: number;
  documentCount?: number;
};

const tempRoots: string[] = [];
const repoRoot = resolve(import.meta.dirname, "../..");
const isSrsScaleRun = process.env.SPECKIWI_PERF_PROFILE === "srs";
const assertSearchPerf = process.env.SPECKIWI_ASSERT_SEARCH_PERF === "1";

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("performance hardening", () => {
  it("exposes a named SRS-scale performance command", async () => {
    const packageJson = JSON.parse(await readFile(resolve(repoRoot, "package.json"), "utf8")) as { scripts?: Record<string, string> };
    expect(packageJson.scripts?.["perf:srs"]).toContain("SPECKIWI_PERF_PROFILE");
    expect(packageJson.scripts?.["perf:srs"]).toContain("SPECKIWI_ASSERT_SEARCH_PERF");
    expect(packageJson.scripts?.["perf:srs"]).toContain("test/perf/perf.test.ts");
  });

  it("records lookup, cache, search, validation, and MCP tool timings for a large workspace", async () => {
    const profile = readPerfProfile();
    const fixture = await buildLargeWorkspaceFixture({ requirementCount: profile.requirementCount, documentCount: profile.documentCount });
    const counters: Record<string, PerfCounters> = {};

    if (profile.srsScale) {
      expect(fixture.requirementCount).toBe(10_000);
      expect(fixture.documentCount).toBe(1_000);
    }

    const cacheRebuild = await measure(async () => {
      const result = await rebuildCache({ root: fixture.root });
      expect(result).toMatchObject({ ok: true });
      recordPerfCounters(counters, "cacheRebuild", {
        cacheHit: false,
        parsedFileCount: fixture.documentCount + 3,
        artifactHitCount: result.ok ? result.touchedFiles.length : 0,
        fallbackReason: result.ok ? undefined : result.error.message
      });
    });

    await getRequirement({ root: fixture.root, id: fixture.targetId });

    const exactLookup = await measure(async () => {
      const result = await getRequirement({ root: fixture.root, id: fixture.targetId });
      expect(result).toMatchObject({ ok: true, requirement: { id: fixture.targetId } });
      recordPerfCounters(counters, "exactLookup", {
        cacheHit: result.diagnostics.warnings.length === 0,
        parsedFileCount: result.diagnostics.warnings.length === 0 ? 0 : fixture.documentCount + 3,
        artifactHitCount: result.diagnostics.warnings.length === 0 ? 3 : 0,
        fallbackReason: result.diagnostics.warnings[0]?.code
      });
    });

    const validation = await measure(async () => {
      const result = await validateWorkspace({ root: fixture.root });
      expect(result.ok).toBe(true);
      recordPerfCounters(counters, "validation", {
        cacheHit: false,
        parsedFileCount: fixture.documentCount + 3,
        artifactHitCount: 0
      });
    });

    await expectSearchResult(
      await searchWorkspace({
        root: fixture.root,
        query: fixture.targetQuery,
        mode: "exact",
        filters: { entityType: "requirement" }
      }),
      fixture.targetId
    );

    const cachedSearch = await measure(async () => {
      const result = await searchWorkspace({
        root: fixture.root,
        query: fixture.targetQuery,
        mode: "exact",
        filters: { entityType: "requirement" }
      });
      expect(result.ok && result.results[0]?.id).toBe(fixture.targetId);
      recordPerfCounters(counters, "cachedSearch", {
        cacheHit: result.diagnostics.warnings.every((warning) => warning.code !== "SEARCH_CACHE_UNREADABLE" && warning.code !== "CACHE_REBUILD_DEGRADED"),
        parsedFileCount: result.diagnostics.warnings.some((warning) => warning.code === "SEARCH_CACHE_UNREADABLE" || warning.code === "CACHE_REBUILD_DEGRADED")
          ? fixture.documentCount + 3
          : 0,
        artifactHitCount: result.diagnostics.warnings.some((warning) => warning.code === "SEARCH_CACHE_UNREADABLE" || warning.code === "CACHE_REBUILD_DEGRADED")
          ? 0
          : 1,
        fallbackReason: result.diagnostics.warnings[0]?.code
      });
    });

    const mcpToolCall = await measureMcpToolCall(fixture.root, counters, "speckiwi_search", {
      query: fixture.targetQuery,
      mode: "exact",
      filters: { entityType: "requirement" },
      expectedId: fixture.targetId
    });

    const timings = {
      requirementCount: fixture.requirementCount,
      documentCount: fixture.documentCount,
      exactLookupMs: round(exactLookup),
      validationMs: round(validation),
      cacheRebuildMs: round(cacheRebuild),
      cachedSearchMs: round(cachedSearch),
      mcpToolCallMs: round(mcpToolCall),
      counters
    };
    console.info(`SpecKiwi performance timings ${JSON.stringify(timings)}`);

    const budget = profile.budget;
    expect(timings.exactLookupMs).toBeLessThanOrEqual(budget.exactLookupMs);
    expect(timings.validationMs).toBeLessThanOrEqual(budget.validationMs);
    expect(timings.cacheRebuildMs).toBeLessThanOrEqual(budget.cacheRebuildMs);
    if (assertSearchPerf) {
      expect(counters.cachedSearch?.cacheHit).toBe(true);
      expect(timings.cachedSearchMs).toBeLessThanOrEqual(budget.cachedSearchMs);
    }
    if (assertSearchPerf) {
      expect(counters.mcpToolCall?.cacheHit).toBe(true);
      expect(timings.mcpToolCallMs).toBeLessThanOrEqual(budget.mcpToolCallMs);
    }
  }, isSrsScaleRun ? 120_000 : 30_000);
});

const strictBudget = {
  exactLookupMs: 50,
  cachedSearchMs: 500,
  mcpToolCallMs: 1_000,
  cacheRebuildMs: 10_000,
  validationMs: 10_000
};

const localBudget = {
  exactLookupMs: 2_500,
  cachedSearchMs: 2_500,
  mcpToolCallMs: 2_500,
  cacheRebuildMs: 10_000,
  validationMs: 10_000
};

export async function buildLargeWorkspaceFixture(options: LargeWorkspaceOptions): Promise<FixtureWorkspace> {
  const requirementCount = Math.max(1, options.requirementCount ?? 600);
  const documentCount = Math.max(1, Math.min(options.documentCount ?? 1, requirementCount));
  const root = await mkdtemp(join(tmpdir(), "speckiwi-perf-"));
  tempRoots.push(root);
  await mkdir(join(root, ".speckiwi", "srs"), { recursive: true });

  const scopeIds = Array.from({ length: documentCount }, (_, index) => `perf.${`${index + 1}`.padStart(4, "0")}`);
  const documents = Array.from({ length: documentCount }, (_, index) => {
    const sequence = `${index + 1}`.padStart(4, "0");
    return `  - id: srs.perf.${sequence}
    type: srs
    path: srs/perf-${sequence}.yaml
    scope: ${scopeIds[index]}
`;
  }).join("");
  const scopes = scopeIds
    .map(
      (scope, index) => `  - id: ${scope}
    name: Performance ${`${index + 1}`.padStart(4, "0")}
    type: module
    parent: perf
`
    )
    .join("");

  await writeFile(
    join(root, ".speckiwi", "index.yaml"),
    `schemaVersion: speckiwi/index/v1
project:
  id: speckiwi
  name: SpecKiwi
  language: ko
settings:
  search:
    defaultMode: auto
documents:
  - id: overview
    type: overview
    path: overview.yaml
  - id: dictionary
    type: dictionary
    path: dictionary.yaml
${documents}scopes:
  - id: perf
    name: Performance
    type: module
${scopes}links: []
`,
    "utf8"
  );
  await writeFile(
    join(root, ".speckiwi", "overview.yaml"),
    `schemaVersion: speckiwi/overview/v1
id: overview
type: overview
title: Performance Fixture
status: active
summary: Large workspace fixture for local performance timing.
`,
    "utf8"
  );
  await writeFile(
    join(root, ".speckiwi", "dictionary.yaml"),
    `schemaVersion: speckiwi/dictionary/v1
id: dictionary
type: dictionary
title: Dictionary
status: active
synonyms:
  performance:
    - 속도
normalizations: {}
`,
    "utf8"
  );

  await Promise.all(
    Array.from({ length: documentCount }, async (_, documentIndex) => {
      const documentSequence = `${documentIndex + 1}`.padStart(4, "0");
      const documentScope = scopeIds[documentIndex] ?? "perf";
      const start = Math.floor((requirementCount * documentIndex) / documentCount);
      const end = Math.floor((requirementCount * (documentIndex + 1)) / documentCount);
      const requirements = Array.from({ length: end - start }, (_, localIndex) => {
        const index = start + localIndex;
        const sequence = `${index + 1}`.padStart(4, "0");
        const id = `FR-SPECKIWI-PERF-${sequence}`;
        const title = index + 1 === requirementCount ? `Unique target performance probe ${sequence}` : `Performance requirement ${sequence}`;
        return `  - id: ${id}
    type: functional
    title: ${title}
    status: active
    priority: medium
    statement: The system shall keep requirement ${sequence} queryable in large local workspaces.
    rationale: Local agents need deterministic lookup and search behavior.
    acceptanceCriteria:
      - id: AC-001
        method: test
        description: Requirement ${sequence} can be loaded and searched.
    relations: []
    tags:
      - performance
`;
      }).join("");

      await writeFile(
        join(root, ".speckiwi", "srs", `perf-${documentSequence}.yaml`),
        `schemaVersion: speckiwi/srs/v1
id: srs.perf.${documentSequence}
type: srs
scope: ${documentScope}
title: Performance SRS ${documentSequence}
status: active
requirements:
${requirements}`,
        "utf8"
      );
    })
  );

  return {
    root,
    requirementCount,
    documentCount,
    targetId: `FR-SPECKIWI-PERF-${`${requirementCount}`.padStart(4, "0")}`,
    targetQuery: `Unique target performance probe ${`${requirementCount}`.padStart(4, "0")}`
  };
}

async function measureMcpToolCall(root: string, counters: Record<string, PerfCounters>, toolName: string, args: Record<string, unknown>): Promise<number> {
  const profile = readPerfProfile();
  const { expectedId, ...toolArguments } = args;
  let elapsed = 0;
  await withPerfMcpClient(root, async (client) => {
    await expectMcpSearchResult(await client.callTool({ name: toolName, arguments: toolArguments }), String(expectedId));
    elapsed = await measure(async () => {
      if (toolName !== "speckiwi_search") {
        throw new Error(`Unsupported MCP tool in perf test: ${toolName}`);
      }
      const result = await client.callTool({ name: toolName, arguments: toolArguments });
      const structuredContent = result.structuredContent as {
        ok?: boolean;
        results?: Array<{ id?: string }>;
        diagnostics?: { warnings?: Array<{ code: string }> };
      };
      expect(structuredContent.ok).toBe(true);
      expect(structuredContent.results?.[0]?.id).toBe(String(expectedId));
      const warnings = structuredContent.diagnostics?.warnings ?? [];
      recordPerfCounters(counters, "mcpToolCall", {
        cacheHit: warnings.every((warning) => warning.code !== "SEARCH_CACHE_UNREADABLE" && warning.code !== "CACHE_REBUILD_DEGRADED"),
        parsedFileCount: warnings.some((warning) => warning.code === "SEARCH_CACHE_UNREADABLE" || warning.code === "CACHE_REBUILD_DEGRADED")
          ? profile.documentCount + 3
          : 0,
        artifactHitCount: warnings.some((warning) => warning.code === "SEARCH_CACHE_UNREADABLE" || warning.code === "CACHE_REBUILD_DEGRADED")
          ? 0
          : 1,
        fallbackReason: warnings[0]?.code
      });
    });
  });
  return elapsed;
}

function expectMcpSearchResult(result: Awaited<ReturnType<Client["callTool"]>>, expectedId: string): void {
  const structuredContent = result.structuredContent as {
    ok?: boolean;
    results?: Array<{ id?: string }>;
  };
  expect(structuredContent.ok).toBe(true);
  expect(structuredContent.results?.[0]?.id).toBe(expectedId);
}

async function withPerfMcpClient(root: string, callback: (client: Client) => Promise<void>): Promise<void> {
  const server = createMcpServer({ root });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "speckiwi-perf", version: "1.0.0" });

  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    await callback(client);
  } finally {
    await client.close().catch((error: unknown) => {
      if (!(error instanceof McpError)) {
        throw error;
      }
    });
    await server.close();
  }
}

function expectSearchResult(result: Awaited<ReturnType<typeof searchWorkspace>>, expectedId: string): void {
  expect(result.ok && result.results[0]?.id).toBe(expectedId);
}

function readPerfProfile(): {
  srsScale: boolean;
  requirementCount: number;
  documentCount: number;
  budget: typeof strictBudget;
} {
  return {
    srsScale: isSrsScaleRun,
    requirementCount: Number(process.env.SPECKIWI_PERF_REQUIREMENTS ?? (isSrsScaleRun ? 10_000 : 600)),
    documentCount: Number(process.env.SPECKIWI_PERF_DOCUMENTS ?? (isSrsScaleRun ? 1_000 : 1)),
    budget: process.env.SPECKIWI_STRICT_PERF === "1" ? strictBudget : localBudget
  };
}

async function measure(callback: () => Promise<void>): Promise<number> {
  const start = performance.now();
  await callback();
  return performance.now() - start;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function recordPerfCounters(target: Record<string, PerfCounters>, label: string, counters: PerfCounters): void {
  target[label] = counters;
}
