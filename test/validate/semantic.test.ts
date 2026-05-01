import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { validateWorkspace } from "../../src/core/validate.js";

const fixtureRoot = new URL("../fixtures/workspaces/", import.meta.url);
const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("semantic workspace validation", () => {
  it("passes a valid fixture with deterministic diagnostics", async () => {
    const result = await validateWorkspace({ root: new URL("valid-basic", fixtureRoot).pathname });

    expect(result).toEqual({
      ok: true,
      valid: true,
      diagnostics: {
        errors: [],
        warnings: [],
        infos: [],
        summary: { errorCount: 0, warningCount: 0, infoCount: 0 }
      }
    });
  });

  it("detects manifest path, link, and scope errors", async () => {
    const result = await validateWorkspace({ root: new URL("invalid-manifest", fixtureRoot).pathname });

    expect(codes(result)).toEqual([
      "DOCUMENT_PATH_NOT_FOUND",
      "PATH_TRAVERSAL",
      "SCOPE_PARENT_CYCLE",
      "UNKNOWN_DOCUMENT_LINK_TARGET"
    ]);
  });

  it("detects schema and unregistered content errors without cascading references", async () => {
    const result = await validateWorkspace({ root: new URL("invalid-schema", fixtureRoot).pathname });

    expect(codes(result)).toEqual(["DUPLICATE_PRD_ITEM_ID", "INVALID_METADATA", "UNKNOWN_FIELD", "UNREGISTERED_CONTENT_DOCUMENT"]);
    expect(result.diagnostics.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "DUPLICATE_PRD_ITEM_ID",
          path: ".speckiwi/prd/duplicate-items.yaml",
          details: expect.objectContaining({
            id: "PRD-DUP-001",
            firstItemIndex: 0,
            duplicateItemIndex: 1
          })
        })
      ])
    );
  });

  it("detects duplicate and dangling requirement relations while keeping warnings non-fatal to execution", async () => {
    const result = await validateWorkspace({ root: new URL("invalid-relations", fixtureRoot).pathname });

    expect(codes(result)).toEqual([
      "DEPENDS_ON_CYCLE",
      "DUPLICATE_REQUIREMENT_ID",
      "MISSING_ACCEPTANCE_CRITERIA",
      "MISSING_RATIONALE",
      "SELF_RELATION",
      "UNKNOWN_REQUIREMENT_RELATION_TARGET",
      "WEAK_REQUIREMENT_STATEMENT"
    ]);
    expect(result.ok).toBe(false);
  });

  it("allows identical PRD item ids in different PRD documents", async () => {
    const root = await copyValidFixture("speckiwi-prd-local-ids-");
    await addPrdDocument(root, "prd/one.yaml", "prd.one", "PRD-SHARED-001");
    await addPrdDocument(root, "prd/two.yaml", "prd.two", "PRD-SHARED-001");
    await writeIndexWithPrds(root, [
      { id: "prd.one", path: "prd/one.yaml" },
      { id: "prd.two", path: "prd/two.yaml" }
    ]);

    const result = await validateWorkspace({ root });

    expect(codes(result)).not.toContain("DUPLICATE_PRD_ITEM_ID");
    expect(result.ok).toBe(true);
  });

  it("keeps existing PRD requirement link target validation", async () => {
    const root = await copyValidFixture("speckiwi-prd-link-");
    await addPrdDocument(root, "prd/link.yaml", "prd.link", "PRD-LINK-001", "FR-MISSING-0001");
    await writeIndexWithPrds(root, [{ id: "prd.link", path: "prd/link.yaml" }]);

    const result = await validateWorkspace({ root });

    expect(codes(result)).toContain("UNKNOWN_REQUIREMENT_RELATION_TARGET");
  });
});

function codes(result: Awaited<ReturnType<typeof validateWorkspace>>): string[] {
  return [...new Set([...result.diagnostics.errors, ...result.diagnostics.warnings].map((diagnostic) => diagnostic.code))].sort();
}

async function copyValidFixture(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  tempRoots.push(root);
  await cp(new URL("valid-basic", fixtureRoot).pathname, root, { recursive: true });
  await mkdir(join(root, ".speckiwi", "prd"), { recursive: true });
  return root;
}

async function addPrdDocument(root: string, storePath: string, documentId: string, itemId: string, requirementTarget?: string): Promise<void> {
  const link = requirementTarget === undefined ? "" : `\n    links:\n      - type: derives_from\n        target: ${requirementTarget}\n        targetType: requirement`;
  await writeFile(
    join(root, ".speckiwi", storePath),
    `schemaVersion: speckiwi/prd/v1
id: ${documentId}
type: prd
title: ${documentId}
status: active
items:
  - id: ${itemId}
    type: feature
    title: Shared item
    body: PRD item ids are scoped to the containing document.${link}
`,
    "utf8"
  );
}

async function writeIndexWithPrds(root: string, prds: Array<{ id: string; path: string }>): Promise<void> {
  await writeFile(
    join(root, ".speckiwi", "index.yaml"),
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
  - id: srs.core
    type: srs
    path: srs/core.yaml
    scope: core
${prds.map((prd) => `  - id: ${prd.id}\n    type: prd\n    path: ${prd.path}`).join("\n")}
scopes:
  - id: core
    name: Core
    type: module
links:
  - from: overview
    to: srs.core
    type: documents
`,
    "utf8"
  );
}
