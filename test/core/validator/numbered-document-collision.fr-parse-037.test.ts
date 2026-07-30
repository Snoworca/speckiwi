import { writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DIAGNOSTIC_DEFINITIONS } from "../../../src/core/diagnostic-registry.js";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { validateWorkspace } from "../../../src/core/validator/validate-workspace.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

// FR-PARSE-037 — a numbered document under docs/spec that is not a scope SRS document still occupies
// an ordering position, so sharing a number with a scope document is the same ambiguity SRS-W070
// reports between two scope documents.
//
// This was left open in v2.5.0 for a concrete reason: discovery resolved a fixed set of sidecar names
// rather than reading the directory, so the validator could not see an arbitrary numbered file. An
// earlier attempt to union the sidecars into the checked set was dead code, because the scope-document
// filter removed the union one line later. AC-5 below is the guard against repeating that.

const CODE = "SRS-W072";
const SPEC = ["docs", "spec"] as const;

function specPath(rootPath: string, fileName: string): string {
  return path.join(rootPath, ...SPEC, fileName);
}

function emptyScopeDocument(name: string, prefix: string): string {
  return [
    `# ${name}`,
    "",
    "| Field | Value |",
    "|---|---|",
    "| Document Type | scope_srs |",
    `| Scope | ${prefix} |`,
    `| Scope Name | ${name} |`,
    "",
    "## 1. Scope Overview",
    "",
    "Describe the scope.",
    "",
    "## 4. Requirements",
    ""
  ].join("\n");
}

async function workspaceFor(rootPath: string) {
  return parseWorkspace(await resolveProjectRoot(rootPath));
}

async function diagnosticsFor(rootPath: string) {
  return validateWorkspace(await workspaceFor(rootPath)).diagnostics;
}

describe("FR-PARSE-037 AC-1 — the parsed workspace carries the docs/spec listing", () => {
  it("lists the documents directly under docs/spec, including one no fixed sidecar set knows about", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");
    await writeFile(specPath(rootPath, "07.glossary.md"), "# Glossary\n", "utf8");

    const workspace = await workspaceFor(rootPath);

    expect(workspace.specDocuments).toContain("docs/spec/00.index.md");
    expect(workspace.specDocuments).toContain("docs/spec/10.product-architecture.srs.md");
    expect(workspace.specDocuments).toContain("docs/spec/90.appendix.md");
    // The consumer's own document: unknown to the fixed sidecar set, present in the listing.
    expect(workspace.specDocuments).toContain("docs/spec/07.glossary.md");
  });

  it("excludes a document in a subdirectory, which holds no ordering position", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");

    const workspace = await workspaceFor(rootPath);

    expect(workspace.specDocuments?.every((entry) => /^docs\/spec\/[^/]+$/.test(entry))).toBe(true);
  });
});

describe("FR-PARSE-037 AC-2 — a colliding non-scope document is reported", () => {
  it("reports a consumer document that shares a scope document's number and names both files", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");
    await writeFile(specPath(rootPath, "10.glossary.md"), "# Glossary\n", "utf8");

    const found = (await diagnosticsFor(rootPath)).filter((entry) => entry.code === CODE);

    expect(found).toHaveLength(1);
    expect(found[0]?.severity).toBe("warning");
    expect(found[0]?.message).toContain("10.glossary.md");
    expect(found[0]?.message).toContain("10.product-architecture.srs.md");
  });

  it("reports the legacy completed-work sidecar when a scope document takes its number", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");
    await writeFile(specPath(rootPath, "05.completed-work.md"), "# Completed Work\n", "utf8");
    await writeFile(specPath(rootPath, "05.five.srs.md"), emptyScopeDocument("Five", "FIVE"), "utf8");

    const found = (await diagnosticsFor(rootPath)).filter((entry) => entry.code === CODE);

    expect(found).toHaveLength(1);
    expect(found[0]?.message).toContain("05.completed-work.md");
    expect(found[0]?.message).toContain("05.five.srs.md");
  });

  it("keeps the collision a warning, so a project already in that state still validates", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");
    await writeFile(specPath(rootPath, "10.glossary.md"), "# Glossary\n", "utf8");

    const diagnostics = await diagnosticsFor(rootPath);

    expect(diagnostics.filter((entry) => entry.severity === "error")).toHaveLength(0);
  });
});

describe("FR-PARSE-037 AC-3 — a number no scope document holds is not a collision", () => {
  it("reports nothing for a numbered sidecar on a free number", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");
    await writeFile(specPath(rootPath, "07.glossary.md"), "# Glossary\n", "utf8");

    expect((await diagnosticsFor(rootPath)).filter((entry) => entry.code === CODE)).toHaveLength(0);
  });

  it("reports nothing for the fixture's own untouched sidecars", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");

    expect((await diagnosticsFor(rootPath)).filter((entry) => entry.code === CODE)).toHaveLength(0);
  });

  it("reports nothing for a document with no leading number", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");
    await writeFile(specPath(rootPath, "glossary.md"), "# Glossary\n", "utf8");

    expect((await diagnosticsFor(rootPath)).filter((entry) => entry.code === CODE)).toHaveLength(0);
  });
});

describe("FR-PARSE-037 AC-4 — the two collision diagnostics do not overlap", () => {
  it("keeps a scope-to-scope collision on SRS-W070 with its existing message and adds no SRS-W072", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");
    await writeFile(specPath(rootPath, "10.reporting.srs.md"), emptyScopeDocument("Reporting", "RPT"), "utf8");

    const diagnostics = await diagnosticsFor(rootPath);
    const scopeCollision = diagnostics.find((entry) => entry.code === "SRS-W070");

    expect(scopeCollision?.message).toContain("Scope SRS documents share the leading number 10");
    expect(diagnostics.filter((entry) => entry.code === CODE)).toHaveLength(0);
  });

  it("registers the new code as a warning sourced to this requirement", () => {
    const definition = DIAGNOSTIC_DEFINITIONS.find((candidate) => candidate.code === CODE);

    expect(definition).toBeDefined();
    expect(definition?.severity).toBe("warning");
    expect(definition?.sourceRule).toBe("FR-PARSE-037");
    expect(definition?.remediation.length).toBeGreaterThan(0);
  });
});

describe("FR-PARSE-037 AC-5 — the listing is load-bearing, not filtered back out", () => {
  it("stops reporting the collision when the listing is removed from the parsed workspace", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");
    await writeFile(specPath(rootPath, "10.glossary.md"), "# Glossary\n", "utf8");
    const workspace = await workspaceFor(rootPath);

    expect(validateWorkspace(workspace).diagnostics.filter((entry) => entry.code === CODE)).toHaveLength(1);

    const withoutListing = { ...workspace, specDocuments: [] };
    expect(validateWorkspace(withoutListing).diagnostics.filter((entry) => entry.code === CODE)).toHaveLength(0);
  });
});
