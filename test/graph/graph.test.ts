import { mkdir, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { isIndexSectionFresh, rebuildCache } from "../../src/core/cache.js";
import { createSpecKiwiCore } from "../../src/core/api.js";
import { loadReadModel } from "../../src/core/read-model.js";
import { buildGraph } from "../../src/graph/builder.js";
import { impactRequirement } from "../../src/graph/impact.js";
import { traceRequirement } from "../../src/graph/trace.js";
import { workspaceRootFromPath } from "../../src/io/workspace.js";
import { loadWorkspaceForValidation } from "../../src/validate/semantic.js";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("graph builder, trace, and impact", () => {
  it("builds deterministic document, scope, requirement, and traceability graphs", async () => {
    const workspace = await loadGraphWorkspace();

    const traceability = buildGraph(workspace);
    const requirement = buildGraph(workspace, "requirement");
    const rebuilt = buildGraph(workspace);

    expect(traceability.ok).toBe(true);
    expect(requirement.ok).toBe(true);
    expect(rebuilt).toEqual(traceability);
    if (!traceability.ok || !requirement.ok) {
      return;
    }

    expect(traceability.nodes.some((node) => node.id === "index")).toBe(false);
    expect(traceability.nodes.map((node) => node.key)).toEqual([
      "document:dictionary",
      "document:overview",
      "document:srs.api",
      "document:srs.core",
      "scope:api",
      "scope:core",
      "requirement:FR-SPEKIW-CORE-0001",
      "requirement:FR-SPEKIW-CORE-0002",
      "requirement:FR-SPEKIW-CORE-0003"
    ]);
    expect(traceability.edges.map((edge) => edge.key)).toContain(
      "document:srs.core|contains_requirement|requirement:FR-SPEKIW-CORE-0001"
    );
    expect(traceability.edges.map((edge) => edge.key)).toContain("scope:core|contains_scope|scope:api");
    expect(traceability.edges.map((edge) => edge.key)).toContain("document:overview|documents|document:srs.core");

    expect(requirement.nodes.every((node) => node.entityType === "requirement")).toBe(true);
    expect(requirement.edges.map((edge) => edge.key)).toEqual([
      "requirement:FR-SPEKIW-CORE-0002|depends_on|requirement:FR-SPEKIW-CORE-0001",
      "requirement:FR-SPEKIW-CORE-0003|relates_to|requirement:FR-SPEKIW-CORE-0001",
      "requirement:FR-SPEKIW-CORE-0003|depends_on|requirement:FR-SPEKIW-CORE-0002"
    ]);
  });

  it("traces upstream, downstream, both directions, and bounded cycles", async () => {
    const workspace = await loadGraphWorkspace();
    const graph = buildGraph(workspace);

    const upstream = traceRequirement({ id: "FR-SPEKIW-CORE-0002", direction: "upstream", depth: 1 }, graph);
    const downstream = traceRequirement({ id: "FR-SPEKIW-CORE-0001", direction: "downstream", depth: 2 }, graph);
    const both = traceRequirement({ id: "FR-SPEKIW-CORE-0002", direction: "both", depth: 5 }, graph);
    const defaultTrace = traceRequirement({ id: "FR-SPEKIW-CORE-0002", depth: 5 }, graph);

    expect(upstream.ok).toBe(true);
    expect(downstream.ok).toBe(true);
    expect(both.ok).toBe(true);
    expect(defaultTrace.ok).toBe(true);
    if (!upstream.ok || !downstream.ok || !both.ok || !defaultTrace.ok) {
      return;
    }

    expect(upstream.nodes.map((node) => node.id)).toEqual(["FR-SPEKIW-CORE-0001", "FR-SPEKIW-CORE-0002"]);
    expect(defaultTrace.direction).toBe("both");
    expect(downstream.nodes.map((node) => node.id)).toEqual([
      "FR-SPEKIW-CORE-0001",
      "FR-SPEKIW-CORE-0002",
      "FR-SPEKIW-CORE-0003"
    ]);
    expect(both.nodes.map((node) => node.id)).toEqual([
      "FR-SPEKIW-CORE-0001",
      "FR-SPEKIW-CORE-0002",
      "FR-SPEKIW-CORE-0003"
    ]);
  });

  it("computes downstream impact and honors context toggles", async () => {
    const workspace = await loadGraphWorkspace();
    const graph = buildGraph(workspace);

    const impact = impactRequirement({ id: "FR-SPEKIW-CORE-0001", depth: 2 }, graph);
    const withoutContext = impactRequirement({ id: "FR-SPEKIW-CORE-0001", depth: 2, includeDocuments: false, includeScopes: false }, graph);

    expect(impact.ok).toBe(true);
    expect(withoutContext.ok).toBe(true);
    if (!impact.ok || !withoutContext.ok) {
      return;
    }

    expect(impact.impacted).toEqual([
      {
        id: "FR-SPEKIW-CORE-0002",
        depth: 1,
        via: ["FR-SPEKIW-CORE-0001", "FR-SPEKIW-CORE-0002"],
        relationType: "depends_on",
        path: "srs/core.yaml"
      },
      {
        id: "FR-SPEKIW-CORE-0003",
        depth: 1,
        via: ["FR-SPEKIW-CORE-0001", "FR-SPEKIW-CORE-0003"],
        relationType: "relates_to",
        path: "srs/api.yaml"
      }
    ]);
    expect(withoutContext.nodes.every((node) => node.entityType === "requirement")).toBe(true);
    expect(withoutContext.edges.every((edge) => edge.sourceType === "requirement" && edge.targetType === "requirement")).toBe(true);
  });

  it("preserves invalid relation diagnostics through graph, trace, and impact results", async () => {
    const workspace = await loadGraphWorkspace({ unknownRelation: true });
    const graph = buildGraph(workspace, "requirement");

    expect(graph.ok).toBe(true);
    expect(graph.diagnostics.errors.map((diagnostic) => diagnostic.code)).toContain("UNKNOWN_REQUIREMENT_RELATION_TARGET");

    const trace = traceRequirement({ id: "FR-SPEKIW-CORE-0002", direction: "both", depth: 1 }, graph);
    const impact = impactRequirement({ id: "FR-SPEKIW-CORE-0002", depth: 1 }, graph);

    expect(trace.ok).toBe(true);
    expect(impact.ok).toBe(true);
    expect(trace.diagnostics.errors.map((diagnostic) => diagnostic.code)).toContain("UNKNOWN_REQUIREMENT_RELATION_TARGET");
    expect(impact.diagnostics.errors.map((diagnostic) => diagnostic.code)).toContain("UNKNOWN_REQUIREMENT_RELATION_TARGET");
  });

  it("serves fresh graph cache while preserving graph, trace, and impact diagnostics", async () => {
    const root = await createGraphWorkspace({ unknownRelation: true });
    await rebuildCache({ root });
    const sourceCore = createSpecKiwiCore({ root, cacheMode: "bypass" });
    const cachedCore = createSpecKiwiCore({ root });

    const model = await loadReadModel({ root, sections: ["graph"] });
    expect(model.stats).toMatchObject({ mode: "cache", cacheHit: true, artifactHitCount: 1 });

    const sourceGraph = await sourceCore.graph({ graphType: "requirement" });
    const cachedGraph = await cachedCore.graph({ graphType: "requirement" });
    const sourceTrace = await sourceCore.traceRequirement({ id: "FR-SPEKIW-CORE-0002", direction: "both", depth: 1 });
    const cachedTrace = await cachedCore.traceRequirement({ id: "FR-SPEKIW-CORE-0002", direction: "both", depth: 1 });
    const sourceImpact = await sourceCore.impact({ id: "FR-SPEKIW-CORE-0002", depth: 1 });
    const cachedImpact = await cachedCore.impact({ id: "FR-SPEKIW-CORE-0002", depth: 1 });

    expect(cachedGraph.ok).toBe(true);
    expect(cachedGraph.ok && cachedGraph.graphType).toBe("requirement");
    expect(cachedGraph.ok && cachedGraph.nodes.every((node) => node.entityType === "requirement")).toBe(true);
    expect(diagnosticCodes(cachedGraph)).toEqual(diagnosticCodes(sourceGraph));
    expect(diagnosticCodes(cachedTrace)).toEqual(diagnosticCodes(sourceTrace));
    expect(diagnosticCodes(cachedImpact)).toEqual(diagnosticCodes(sourceImpact));
    expect(diagnosticCodes(cachedGraph)).toContain("UNKNOWN_REQUIREMENT_RELATION_TARGET");
  });

  it("does not reuse memoized cached graph after source YAML changes", async () => {
    const root = await createGraphWorkspace();
    await rebuildCache({ root });
    const core = createSpecKiwiCore({ root });

    const before = await core.graph({ graphType: "requirement" });
    expect(before.ok && before.nodes.find((node) => node.id === "FR-SPEKIW-CORE-0002")?.title).toBe("Dependent");

    const sourcePath = join(root, ".speckiwi", "srs", "core.yaml");
    await writeFile((sourcePath), (await readFile(sourcePath, "utf8")).replace("title: Dependent", "title: Dependent Updated"), "utf8");

    const after = await core.graph({ graphType: "requirement" });
    const bypass = await core.graph({ graphType: "requirement", cacheMode: "bypass" });

    expect(after.ok && after.nodes.find((node) => node.id === "FR-SPEKIW-CORE-0002")?.title).toBe("Dependent Updated");
    expect(after).toEqual(bypass);
    expect(await isIndexSectionFresh(workspaceRootFromPath(root), "graph")).toBe(true);
    await expect(readFile(join(root, ".speckiwi", "cache", "graph.json"), "utf8")).resolves.toContain("Dependent Updated");
  });

  it("does not reuse memoized cached graph after same-size preserved-mtime source edits", async () => {
    const root = await createGraphWorkspace();
    await rebuildCache({ root });
    const core = createSpecKiwiCore({ root });

    const beforeGraph = await core.graph({ graphType: "requirement" });
    expect(beforeGraph.ok && beforeGraph.nodes.find((node) => node.id === "FR-SPEKIW-CORE-0002")?.title).toBe("Dependent");

    const sourcePath = join(root, ".speckiwi", "srs", "core.yaml");
    const before = await stat(sourcePath);
    const raw = await readFile(sourcePath, "utf8");
    await writeFile(sourcePath, replaceSameLength(raw, "title: Dependent", "title: Retitled!"), "utf8");
    await utimes(sourcePath, before.atime, before.mtime);

    const after = await core.graph({ graphType: "requirement" });
    const bypass = await core.graph({ graphType: "requirement", cacheMode: "bypass" });

    expect(after.ok && after.nodes.find((node) => node.id === "FR-SPEKIW-CORE-0002")?.title).toBe("Retitled!");
    expect(after).toEqual(bypass);
  });

  it("keeps duplicates and conflicts_with impact relations non-transitive", async () => {
    const workspace = await loadGraphWorkspace({ nonTransitiveRelations: true });
    const graph = buildGraph(workspace, "traceability");
    const impact = impactRequirement({ id: "FR-SPEKIW-CORE-0001", depth: 5, includeDocuments: false, includeScopes: false }, graph);

    expect(impact.ok).toBe(true);
    if (!impact.ok) {
      return;
    }
    expect(impact.impacted.map((item) => item.id)).toContain("FR-SPEKIW-CORE-0004");
    expect(impact.impacted.map((item) => item.id)).not.toContain("FR-SPEKIW-CORE-0005");
    expect(graph.ok && graph.edges.map((edge) => edge.relationType)).toEqual(expect.arrayContaining(["duplicates", "conflicts_with"]));
  });

  it("builds graphs without creating cache files", async () => {
    const root = await createGraphWorkspace();
    const workspace = await loadWorkspaceForValidation(workspaceRootFromPath(root));

    expect(buildGraph(workspace).ok).toBe(true);
    await expect(stat(join(root, ".speckiwi", "cache"))).rejects.toThrow();
  });
});

function diagnosticCodes(result: { diagnostics: { errors: Array<{ code: string }> } }): string[] {
  return result.diagnostics.errors.map((diagnostic) => diagnostic.code).sort();
}

function replaceSameLength(value: string, search: string, replacement: string): string {
  expect(replacement).toHaveLength(search.length);
  expect(value).toContain(search);
  return value.replace(search, replacement);
}

async function loadGraphWorkspace(options: GraphWorkspaceOptions = {}) {
  const root = await createGraphWorkspace(options);
  return loadWorkspaceForValidation(workspaceRootFromPath(root));
}

type GraphWorkspaceOptions = {
  unknownRelation?: boolean;
  nonTransitiveRelations?: boolean;
};

async function createGraphWorkspace(options: GraphWorkspaceOptions = {}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "speckiwi-graph-"));
  tempRoots.push(root);
  await mkdir(join(root, ".speckiwi", "srs"), { recursive: true });

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
    parent: core
    name: API
    type: submodule
links:
  - from: overview
    to: srs.core
    type: documents
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
summary: Graph fixture.
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
synonyms: {}
normalizations: {}
`,
    "utf8"
  );
  await writeFile(
    join(root, ".speckiwi", "srs", "core.yaml"),
    `schemaVersion: speckiwi/srs/v1
id: srs.core
type: srs
scope: core
title: Core SRS
status: active
requirements:
  - id: FR-SPEKIW-CORE-0001
    type: functional
    title: Root
    status: active
    statement: The system shall keep root requirements traceable across graph queries.
    rationale: Traceability needs a stable root.
    acceptanceCriteria:
      - id: AC-001
        method: test
        description: Graph includes the root requirement.
    relations: []
  - id: FR-SPEKIW-CORE-0002
    type: functional
    title: Dependent
    status: active
    statement: The system shall report dependencies from dependent requirements.
    rationale: Dependency lookup drives impact analysis.
    acceptanceCriteria:
      - id: AC-001
        method: test
        description: Trace follows depends_on.
    relations:
      - type: depends_on
        target: FR-SPEKIW-CORE-0001
${options.unknownRelation === true ? "      - type: depends_on\n        target: FR-SPEKIW-MISSING-9999\n" : ""}
`,
    "utf8"
  );
  await writeFile(
    join(root, ".speckiwi", "srs", "api.yaml"),
    `schemaVersion: speckiwi/srs/v1
id: srs.api
type: srs
scope: api
title: API SRS
status: active
requirements:
  - id: FR-SPEKIW-CORE-0003
    type: functional
    title: API Dependent
    status: active
    statement: The system shall expose graph impact information for API consumers.
    rationale: API consumers need deterministic impact output.
    acceptanceCriteria:
      - id: AC-001
        method: test
        description: Impact includes API dependent requirements.
    relations:
      - type: depends_on
        target: FR-SPEKIW-CORE-0002
      - type: relates_to
        target: FR-SPEKIW-CORE-0001
${options.nonTransitiveRelations === true ? `  - id: FR-SPEKIW-CORE-0004
    type: functional
    title: Duplicate candidate
    status: active
    statement: The system shall keep duplicate impact hops non transitive.
    rationale: Impact traversal must not over-expand duplicate relations.
    acceptanceCriteria:
      - id: AC-001
        method: test
        description: Impact includes duplicate candidate only.
    relations:
      - type: duplicates
        target: FR-SPEKIW-CORE-0001
      - type: conflicts_with
        target: FR-SPEKIW-CORE-0005
  - id: FR-SPEKIW-CORE-0005
    type: functional
    title: Conflict neighbor
    status: active
    statement: The system shall remain outside duplicate impact traversal.
    rationale: Non transitive relation rules prevent false impact spread.
    acceptanceCriteria:
      - id: AC-001
        method: test
        description: Impact does not include this neighbor through duplicate candidate.
    relations: []
` : ""}
`,
    "utf8"
  );

  return root;
}
