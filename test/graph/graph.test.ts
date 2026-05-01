import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
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

  it("builds graphs without creating cache files", async () => {
    const root = await createGraphWorkspace();
    const workspace = await loadWorkspaceForValidation(workspaceRootFromPath(root));

    expect(buildGraph(workspace).ok).toBe(true);
    await expect(stat(join(root, ".speckiwi", "cache"))).rejects.toThrow();
  });
});

async function loadGraphWorkspace() {
  const root = await createGraphWorkspace();
  return loadWorkspaceForValidation(workspaceRootFromPath(root));
}

async function createGraphWorkspace(): Promise<string> {
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
`,
    "utf8"
  );

  return root;
}
