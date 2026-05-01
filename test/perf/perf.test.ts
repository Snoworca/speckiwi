import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { afterEach, describe, expect, it } from "vitest";
import { rebuildCache } from "../../src/core/cache.js";
import { getRequirement } from "../../src/core/requirements.js";
import { searchWorkspace } from "../../src/core/search.js";
import { validateWorkspace } from "../../src/core/validate.js";
import { createSpecKiwiCore } from "../../src/mcp/tools.js";
import type { SearchToolInput } from "../../src/mcp/schemas.js";

type FixtureWorkspace = {
  root: string;
  requirementCount: number;
  documentCount: number;
  targetId: string;
};

type LargeWorkspaceOptions = {
  requirementCount?: number;
  documentCount?: number;
};

const tempRoots: string[] = [];
const repoRoot = resolve(import.meta.dirname, "../..");
const isSrsScaleRun = process.env.SPECKIWI_PERF_PROFILE === "srs";

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("performance hardening", () => {
  it("exposes a named SRS-scale performance command", async () => {
    const packageJson = JSON.parse(await readFile(resolve(repoRoot, "package.json"), "utf8")) as { scripts?: Record<string, string> };
    expect(packageJson.scripts?.["perf:srs"]).toContain("SPECKIWI_PERF_PROFILE");
    expect(packageJson.scripts?.["perf:srs"]).toContain("test/perf/perf.test.ts");
  });

  it("records lookup, cache, search, validation, and MCP tool timings for a large workspace", async () => {
    const profile = readPerfProfile();
    const fixture = await buildLargeWorkspaceFixture({ requirementCount: profile.requirementCount, documentCount: profile.documentCount });

    if (profile.srsScale) {
      expect(fixture.requirementCount).toBe(10_000);
      expect(fixture.documentCount).toBe(1_000);
    }

    const exactLookup = await measure(async () => {
      const result = await getRequirement({ root: fixture.root, id: fixture.targetId });
      expect(result).toMatchObject({ ok: true, requirement: { id: fixture.targetId } });
    });

    const validation = await measure(async () => {
      const result = await validateWorkspace({ root: fixture.root });
      expect(result.ok).toBe(true);
    });

    const cacheRebuild = await measure(async () => {
      const result = await rebuildCache({ root: fixture.root });
      expect(result).toMatchObject({ ok: true });
    });

    const cachedSearch = await measure(async () => {
      const result = await searchWorkspace({ root: fixture.root, query: fixture.targetId, mode: "exact" });
      expect(result.ok && result.results[0]?.id).toBe(fixture.targetId);
    });

    const mcpToolCall = await measureMcpToolCall(fixture.root, "speckiwi_search", {
      query: fixture.targetId,
      mode: "exact"
    });

    const timings = {
      requirementCount: fixture.requirementCount,
      documentCount: fixture.documentCount,
      exactLookupMs: round(exactLookup),
      validationMs: round(validation),
      cacheRebuildMs: round(cacheRebuild),
      cachedSearchMs: round(cachedSearch),
      mcpToolCallMs: round(mcpToolCall)
    };
    console.info(`SpecKiwi performance timings ${JSON.stringify(timings)}`);

    const budget = profile.budget;
    expect(timings.exactLookupMs).toBeLessThanOrEqual(budget.exactLookupMs);
    expect(timings.validationMs).toBeLessThanOrEqual(budget.validationMs);
    expect(timings.cacheRebuildMs).toBeLessThanOrEqual(budget.cacheRebuildMs);
    expect(timings.cachedSearchMs).toBeLessThanOrEqual(budget.cachedSearchMs);
    expect(timings.mcpToolCallMs).toBeLessThanOrEqual(budget.mcpToolCallMs);
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

  const documents = Array.from({ length: documentCount }, (_, index) => {
    const sequence = `${index + 1}`.padStart(4, "0");
    return `  - id: srs.perf.${sequence}
    type: srs
    path: srs/perf-${sequence}.yaml
    scope: perf
`;
  }).join("");

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
links: []
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
      const start = Math.floor((requirementCount * documentIndex) / documentCount);
      const end = Math.floor((requirementCount * (documentIndex + 1)) / documentCount);
      const requirements = Array.from({ length: end - start }, (_, localIndex) => {
        const index = start + localIndex;
        const sequence = `${index + 1}`.padStart(4, "0");
        const id = `FR-SPECKIWI-PERF-${sequence}`;
        return `  - id: ${id}
    type: functional
    title: Performance requirement ${sequence}
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
scope: perf
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
    targetId: `FR-SPECKIWI-PERF-${`${requirementCount}`.padStart(4, "0")}`
  };
}

async function measureMcpToolCall(root: string, toolName: string, args: Record<string, unknown>): Promise<number> {
  const core = createSpecKiwiCore({ root });
  return measure(async () => {
    if (toolName !== "speckiwi_search") {
      throw new Error(`Unsupported MCP tool in perf test: ${toolName}`);
    }
    const result = await core.search(args as SearchToolInput);
    expect(result.ok && result.results[0]?.id).toBe(String(args.query));
  });
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
