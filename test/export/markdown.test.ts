import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { exportMarkdown } from "../../src/core/export-markdown.js";
import { renderDocumentMarkdown, renderExportIndex, type ContentDocument } from "../../src/export/templates.js";

const root = resolve(import.meta.dirname, "../..");
const tempRoot = resolve(root, "test/.tmp-export");
const fixtureRoot = resolve(root, "test/fixtures/workspaces/valid-basic");

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

describe("Markdown export", () => {
  it("writes deterministic Markdown files and an export index for all exportable types", async () => {
    const workspace = await workspaceWithAllDocumentTypes("all-types");

    const result = await exportMarkdown({ root: workspace });

    expect(result.ok).toBe(true);
    expect(result.writtenFiles.map((file) => file.path)).toEqual([
      "adr/0001-local-yaml-storage.md",
      "index.md",
      "overview.md",
      "prd/spec-context.md",
      "srs/agent-kernel.loop.md",
      "tech/search-index-builder.md"
    ]);
    expect(result.writtenFiles.every((file) => !file.path.startsWith("/") && !file.path.includes("dictionary"))).toBe(true);
    await expect(readFile(resolve(workspace, ".speckiwi/exports/index.md"), "utf8")).resolves.toContain("diagnostics-summary");
    await expect(readFile(resolve(workspace, ".speckiwi/exports/srs/agent-kernel.loop.md"), "utf8")).resolves.toContain("FR-AGK-LOOP-0001");
    await expect(readFile(resolve(workspace, ".speckiwi/exports/tech/search-index-builder.md"), "utf8")).resolves.toContain("## Implements");
  });

  it("supports --out, --type, and --document filters without exporting unsupported document types", async () => {
    const workspace = await workspaceWithAllDocumentTypes("filters");

    const result = await exportMarkdown({ root: workspace, outputRoot: "docs-out", type: "srs", documentId: "srs.agent-kernel.loop" });

    expect(result.ok).toBe(true);
    expect(result.outputRoot).toBe("docs-out");
    expect(result.writtenFiles.map((file) => file.path)).toEqual(["index.md", "srs/agent-kernel.loop.md"]);
    await expect(readFile(resolve(workspace, "docs-out/index.md"), "utf8")).resolves.toContain("Agent Kernel Loop SRS");
  });

  it("returns documented errors for unsupported export types", async () => {
    const workspace = await workspaceWithAllDocumentTypes("unsupported");

    const result = await exportMarkdown({ root: workspace, type: "rule" });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "EXPORT_TYPE_NOT_SUPPORTED" }
    });
  });

  it("skips invalid source documents in non-strict mode and aborts before writing in strict mode", async () => {
    const workspace = await workspaceWithInvalidSrs("strict");

    const nonStrict = await exportMarkdown({ root: workspace });
    const strict = await exportMarkdown({ root: workspace, outputRoot: "strict-out", strict: true });

    expect(nonStrict.ok).toBe(true);
    expect(nonStrict.skippedFiles).toEqual([
      {
        sourceDocumentId: "srs.broken",
        sourcePath: "srs/broken.yaml",
        reasonCode: "EXPORT_SOURCE_SCHEMA_INVALID",
        message: "Source document failed schema validation: srs/broken.yaml."
      }
    ]);
    expect(nonStrict.writtenFiles.map((file) => file.path)).toEqual(["index.md", "overview.md"]);
    expect(strict).toMatchObject({ ok: false, strict: true, writtenFiles: [] });
    await expect(readFile(resolve(workspace, "strict-out/index.md"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("renders document and index templates from typed document summaries", () => {
    const document: ContentDocument = {
      id: "overview",
      type: "overview",
      path: "overview.yaml",
      title: "SpecKiwi",
      status: "active",
      value: {
        schemaVersion: "speckiwi/overview/v1",
        id: "overview",
        type: "overview",
        title: "SpecKiwi",
        status: "active",
        summary: "Local YAML knowledge graph.",
        goals: [{ id: "G-001", statement: "Keep implementation context queryable." }],
        glossary: [{ term: "SRS", definition: "Software requirements specification." }]
      }
    };

    expect(renderDocumentMarkdown(document)).toContain("## Glossary");
    expect(renderExportIndex([document])).toContain("[SpecKiwi](overview.md)");
  });
});

async function workspaceWithAllDocumentTypes(name: string): Promise<string> {
  const workspace = resolve(tempRoot, name);
  await cp(fixtureRoot, workspace, { recursive: true });
  await writeFile(
    resolve(workspace, ".speckiwi/index.yaml"),
    `schemaVersion: speckiwi/index/v1
project:
  id: speckiwi
  name: SpecKiwi
  language: ko
documents:
  - id: overview
    type: overview
    path: overview.yaml
  - id: dictionary
    type: dictionary
    path: dictionary.yaml
  - id: srs.agent-kernel.loop
    type: srs
    path: srs/agent-kernel.loop.yaml
    scope: agent-kernel.loop
  - id: prd.spec-context
    type: prd
    path: prd/spec-context.yaml
  - id: tech.search-index-builder
    type: technical
    path: tech/search-index-builder.yaml
    scope: search
  - id: adr.0001-local-yaml-storage
    type: adr
    path: adr/0001-local-yaml-storage.yaml
scopes:
  - id: agent-kernel.loop
    name: Agent Kernel Loop
    type: module
  - id: search
    name: Search
    type: module
links: []
`,
    "utf8"
  );
  await mkdir(resolve(workspace, ".speckiwi/srs"), { recursive: true });
  await mkdir(resolve(workspace, ".speckiwi/prd"), { recursive: true });
  await mkdir(resolve(workspace, ".speckiwi/tech"), { recursive: true });
  await mkdir(resolve(workspace, ".speckiwi/adr"), { recursive: true });
  await writeFile(resolve(workspace, ".speckiwi/srs/agent-kernel.loop.yaml"), srsYaml, "utf8");
  await writeFile(resolve(workspace, ".speckiwi/prd/spec-context.yaml"), prdYaml, "utf8");
  await writeFile(resolve(workspace, ".speckiwi/tech/search-index-builder.yaml"), technicalYaml, "utf8");
  await writeFile(resolve(workspace, ".speckiwi/adr/0001-local-yaml-storage.yaml"), adrYaml, "utf8");
  return workspace;
}

async function workspaceWithInvalidSrs(name: string): Promise<string> {
  const workspace = await workspaceWithAllDocumentTypes(name);
  await writeFile(
    resolve(workspace, ".speckiwi/index.yaml"),
    `schemaVersion: speckiwi/index/v1
project:
  id: speckiwi
  name: SpecKiwi
documents:
  - id: overview
    type: overview
    path: overview.yaml
  - id: srs.broken
    type: srs
    path: srs/broken.yaml
    scope: broken
scopes:
  - id: broken
    name: Broken
    type: module
links: []
`,
    "utf8"
  );
  await writeFile(
    resolve(workspace, ".speckiwi/srs/broken.yaml"),
    `schemaVersion: speckiwi/srs/v1
id: srs.broken
type: srs
scope: broken
title: Broken SRS
status: active
requirements:
  - id: FR-BROKEN-0001
    type: functional
    title: Missing statement
    status: active
`,
    "utf8"
  );
  return workspace;
}

const srsYaml = `schemaVersion: speckiwi/srs/v1
id: srs.agent-kernel.loop
type: srs
scope: agent-kernel.loop
title: Agent Kernel Loop SRS
status: active
requirements:
  - id: FR-AGK-LOOP-0001
    type: functional
    title: LLM response state transition
    status: active
    priority: high
    statement: The agent kernel shall choose the next execution state from the LLM response type.
    rationale: State transition conditions must be explicit for implementation and tests.
    acceptanceCriteria:
      - id: AC-001
        method: test
        description: Tool calls transition to tool execution.
    relations: []
    tags:
      - agent-loop
`;

const prdYaml = `schemaVersion: speckiwi/prd/v1
id: prd.spec-context
type: prd
title: Spec Context PRD
status: active
items:
  - id: PRD-001
    type: problem
    title: Requirement document sprawl
    body: SDD projects accumulate documents, making accurate context difficult.
`;

const technicalYaml = `schemaVersion: speckiwi/technical/v1
id: tech.search-index-builder
type: technical
title: Search Index Builder Technical Design
status: active
scope: search
implements:
  - FR-SRCH-001
sections:
  - id: SEC-001
    title: Flatten Document Model
    body: Convert YAML documents into searchable flat documents.
`;

const adrYaml = `schemaVersion: speckiwi/adr/v1
id: adr.0001-local-yaml-storage
type: adr
title: ADR-0001 Local YAML Storage
status: accepted
date: 2026-04-28
context: SpecKiwi needs reviewable local storage.
decision: SpecKiwi v1 uses YAML files as the source of truth.
consequences:
  - Git diff and review are straightforward.
`;
