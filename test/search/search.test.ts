import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { searchWorkspace } from "../../src/core/search.js";
import { tokenizeKorean } from "../../src/search/korean.js";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("search indexing and ranking", () => {
  it("covers exact lookup for document, scope, requirement, PRD, technical, ADR, and rule entities", async () => {
    const root = await createSearchWorkspace();

    await expectExact(root, "srs.core", "document", "srs.core");
    await expectExact(root, "core.search", "scope", "core.search");
    await expectExact(root, "FR-SPEKIW-CORE-0001", "requirement", "FR-SPEKIW-CORE-0001");
    await expectExact(root, "PRD-SEARCH-001", "prd_item", "PRD-SEARCH-001");
    await expectExact(root, "TECH-SEARCH-INDEX", "technical_section", "TECH-SEARCH-INDEX");
    await expectExact(root, "adr.local-yaml", "adr", "adr.local-yaml");
    await expectExact(root, "RULE-NO-DB", "rule", "RULE-NO-DB");
  });

  it("indexes overview, requirement fields, filters, pagination, and stable matched field ordering", async () => {
    const root = await createSearchWorkspace();

    const overview = await searchWorkspace({ root, query: "agent discovery shared glossary", mode: "bm25" });
    expect(overview.ok).toBe(true);
    expect(overview.ok && overview.results.some((item) => item.id === "overview" && item.entityType === "document")).toBe(true);
    expect(overview.ok && overview.page.limit).toBe(10);

    const clamped = await searchWorkspace({ root, query: "search", mode: "bm25", limit: 999 });
    expect(clamped.ok).toBe(true);
    expect(clamped.ok && clamped.page.limit).toBe(100);

    const filtered = await searchWorkspace({
      root,
      query: "deterministic acceptance",
      mode: "bm25",
      filters: { entityType: "requirement", scope: "core.search", status: "active", tag: "search" },
      limit: 1
    });
    expect(filtered.ok).toBe(true);
    if (!filtered.ok) {
      return;
    }
    expect(filtered.results).toHaveLength(1);
    expect(filtered.results[0]).toMatchObject({
      entityType: "requirement",
      id: "FR-SPEKIW-CORE-0001",
      score: expect.any(Number),
      matchedFields: ["title", "tags", "statement", "acceptanceCriteria"]
    });
    expect(filtered.results[0]?.score).toBeLessThanOrEqual(0.999);
    expect(filtered.page).toMatchObject({ limit: 1, offset: 0, returned: 1, total: 1, hasMore: false });

    const firstPage = await searchWorkspace({ root, query: "search", mode: "bm25", limit: 2 });
    const repeatedFirstPage = await searchWorkspace({ root, query: "search", mode: "bm25", limit: 2 });
    const secondPage = await searchWorkspace({ root, query: "search", mode: "bm25", limit: 2, offset: 2 });
    expect(firstPage.ok).toBe(true);
    expect(repeatedFirstPage.ok).toBe(true);
    expect(secondPage.ok).toBe(true);
    if (firstPage.ok && repeatedFirstPage.ok && secondPage.ok) {
      expect(firstPage.results).toEqual(repeatedFirstPage.results);
      expect(firstPage.results[0]?.score).toBeGreaterThanOrEqual(firstPage.results[1]?.score ?? 0);
      expect(new Set([...firstPage.results, ...secondPage.results].map((item) => `${item.entityType}:${item.id}`)).size).toBe(
        firstPage.results.length + secondPage.results.length
      );
      expect(secondPage.page.offset).toBe(2);
    }
  });

  it("tokenizes Korean phrases and applies dictionary synonym expansion without requiring dictionary presence", async () => {
    const root = await createSearchWorkspace();

    expect(tokenizeKorean("상태 전이")).toEqual(expect.arrayContaining(["상태", "전이", "상태전이", "태전"]));

    const korean = await searchWorkspace({ root, query: "상태 전이", mode: "bm25", filters: { entityType: "technical_section" } });
    expect(korean.ok).toBe(true);
    expect(korean.ok && korean.results[0]?.id).toBe("TECH-SEARCH-INDEX");

    const synonym = await searchWorkspace({ root, query: "요구사항명세", mode: "auto", filters: { entityType: "document" } });
    expect(synonym.ok).toBe(true);
    expect(synonym.ok && synonym.results.some((item) => item.id === "srs.core")).toBe(true);

    const noDictionaryRoot = await createSearchWorkspace({ dictionary: false });
    const fallback = await searchWorkspace({ root: noDictionaryRoot, query: "deterministic search", mode: "bm25" });
    expect(fallback.ok).toBe(true);
    expect(fallback.ok && fallback.results.length).toBeGreaterThan(0);
  });
});

async function expectExact(root: string, query: string, entityType: string, id: string): Promise<void> {
  const result = await searchWorkspace({ root, query, mode: "exact" });
  expect(result.ok).toBe(true);
  if (!result.ok) {
    return;
  }
  expect(result.results).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        entityType,
        id,
        score: 1,
        matchedFields: expect.arrayContaining(["id"])
      })
    ])
  );
}

async function createSearchWorkspace(options: { dictionary?: boolean } = {}): Promise<string> {
  const includeDictionary = options.dictionary ?? true;
  const root = await mkdtemp(join(tmpdir(), "speckiwi-search-"));
  tempRoots.push(root);
  for (const directory of ["prd", "srs", "tech", "adr", "rules"]) {
    await mkdir(join(root, ".speckiwi", directory), { recursive: true });
  }

  await writeFile(
    join(root, ".speckiwi", "index.yaml"),
    `schemaVersion: speckiwi/index/v1
project:
  id: spec-kiwi
  name: SpecKiwi
documents:
  - id: overview
    type: overview
    path: overview.yaml
    tags: [overview, search]
  - id: dictionary
    type: dictionary
    path: dictionary.yaml
  - id: prd.search
    type: prd
    path: prd/search.yaml
    scope: core.search
  - id: srs.core
    type: srs
    path: srs/core.yaml
    scope: core.search
  - id: tech.search
    type: technical
    path: tech/search.yaml
    scope: core.search
  - id: adr.local-yaml
    type: adr
    path: adr/local-yaml.yaml
  - id: rules.security
    type: rule
    path: rules/security.yaml
scopes:
  - id: core.search
    name: Search Core
    type: module
    description: Search cache and discovery metadata
    tags: [search]
links: []
`,
    "utf8"
  );
  await writeFile(
    join(root, ".speckiwi", "overview.yaml"),
    `schemaVersion: speckiwi/overview/v1
id: overview
type: overview
title: Overview
status: active
summary: SpecKiwi provides deterministic search for agent discovery.
goals:
  - id: GOAL-SEARCH
    statement: Shared glossary terms help agent discovery.
nonGoals:
  - id: NGOAL-VECTOR
    statement: Vector database search is not part of v1.
glossary:
  - term: agent discovery
    definition: Finding requirements and design records for coding agents.
`,
    "utf8"
  );
  await writeFile(
    join(root, ".speckiwi", "dictionary.yaml"),
    includeDictionary
      ? `schemaVersion: speckiwi/dictionary/v1
id: dictionary
type: dictionary
title: Dictionary
status: active
synonyms:
  srs:
    - 요구사항명세
    - requirement spec
  state-transition:
    - 상태 전이
    - 상태전이
normalizations: {}
`
      : `schemaVersion: speckiwi/dictionary/v1
id: dictionary
type: dictionary
title: Dictionary
status: active
normalizations: {}
`,
    "utf8"
  );
  await writeFile(
    join(root, ".speckiwi", "prd", "search.yaml"),
    `schemaVersion: speckiwi/prd/v1
id: prd.search
type: prd
title: Search PRD
status: active
items:
  - id: PRD-SEARCH-001
    type: feature
    title: Search item
    body: Users need local search across requirements and rules.
    tags: [search]
`,
    "utf8"
  );
  await writeFile(
    join(root, ".speckiwi", "srs", "core.yaml"),
    `schemaVersion: speckiwi/srs/v1
id: srs.core
type: srs
scope: core.search
title: Core Search SRS
status: active
requirements:
  - id: FR-SPEKIW-CORE-0001
    type: functional
    title: Search deterministic acceptance
    status: active
    statement: The system shall provide deterministic local search for requirements.
    rationale: Search must be stable for coding agents.
    acceptanceCriteria:
      - id: AC-001
        method: test
        description: Search returns deterministic acceptance matches.
    tags: [search, deterministic]
    relations: []
  - id: FR-SPEKIW-CORE-0002
    type: reliability
    title: Cache degraded fallback
    status: active
    statement: The system shall degrade to YAML source data when cache rebuild fails.
    rationale: Cache is not the source of truth.
    acceptanceCriteria:
      - id: AC-001
        method: test
        description: Cache fallback still returns search results.
    tags: [cache]
    relations: []
`,
    "utf8"
  );
  await writeFile(
    join(root, ".speckiwi", "tech", "search.yaml"),
    `schemaVersion: speckiwi/technical/v1
id: tech.search
type: technical
title: Search Technical Design
status: active
scope: core.search
implements:
  - FR-SPEKIW-CORE-0001
sections:
  - id: TECH-SEARCH-INDEX
    title: Korean state transition search
    body: 상태 전이 queries use Korean n-gram tokens and dictionary expansion.
`,
    "utf8"
  );
  await writeFile(
    join(root, ".speckiwi", "adr", "local-yaml.yaml"),
    `schemaVersion: speckiwi/adr/v1
id: adr.local-yaml
type: adr
title: Local YAML Storage
status: accepted
decision: Use local YAML files instead of a database for search source data.
context: Users need repository local state.
consequences:
  - Cache is always rebuildable from YAML.
`,
    "utf8"
  );
  await writeFile(
    join(root, ".speckiwi", "rules", "security.yaml"),
    `schemaVersion: speckiwi/rule/v1
id: rules.security
type: rule
title: Security Rules
status: active
rules:
  - id: RULE-NO-DB
    level: must_not
    statement: The system must not require a vector database for search.
    rationale: Local-first operation is mandatory.
    tags: [security, search]
`,
    "utf8"
  );

  return root;
}
