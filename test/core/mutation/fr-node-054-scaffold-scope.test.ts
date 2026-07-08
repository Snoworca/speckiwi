import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
// scaffoldScope is the FR-NODE-065 core mutation introduced by the green task (T-PH003-74).
// It lives in src/core/mutation/scaffold-scope.ts and does not exist yet, so this import fails
// at collection time — the red signal for the whole suite. ScaffoldScopeInput / ScaffoldScopeOutput
// are the public contract types the cases below assert against. Unlike registerScopes
// (FR-NODE-064), which only adds Scope Map rows for already-existing unregistered documents,
// scaffoldScope CREATES a brand-new scope srs.md from the template and registers it in BOTH the
// index SRS Documents section and the Scope Map section in one operation.
import {
  scaffoldScope,
  type ScaffoldScopeInput,
  type ScaffoldScopeOutput
} from "../../../src/core/mutation/scaffold-scope.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

// FR-NODE-065 — scaffold-scope core creates and registers a new scope.
//
// The valid-basic fixture ships an index with one registered scope (Product Architecture, prefix
// ARCH, document 10.product-architecture.srs.md) listed in both the §2 SRS Documents section and
// the §4 Scope Map section. scaffoldScope must add a NEW scope (e.g. Reporting / prefix RPT):
//   - AC-1: create a new numbered scope srs.md file from the scope template,
//   - AC-2: add one row to the §2 SRS Documents section and one row to the §4 Scope Map section,
//   - AC-3: reject (ok false, write nothing) a name/prefix that collides with an existing scope,
//   - AC-4: default to dry-run, returning a preview of the file and index rows while writing no file.

const INDEX_REL = path.join("docs", "spec", "00.index.md");

function indexPath(rootPath: string): string {
  return path.join(rootPath, INDEX_REL);
}

/** True when the file exists on disk. */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

/** Extracts the table rows under an index heading (between the heading and the next `## ` heading). */
function sectionRows(indexText: string, heading: RegExp): string[] {
  const lines = indexText.split(/\r?\n/);
  const start = lines.findIndex((line) => heading.test(line.trim()));
  if (start === -1) return [];
  const rows: string[] = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (/^##\s/.test(line)) break;
    if (line.trim().startsWith("|")) rows.push(line);
  }
  return rows;
}

const SRS_DOCUMENTS_HEADING = /^##\s+\d+\.\s+SRS Documents$/;
const SCOPE_MAP_HEADING = /^##\s+\d+\.\s+Scope Map$/;

describe("FR-NODE-065 scaffoldScope core mutation", () => {
  // AC-1: scaffoldScope (with apply) creates a new numbered scope srs.md file that contains the
  // scope template frontmatter (Document Type scope_srs, the chosen Scope prefix) and the template
  // sections. The created document is named with a numeric prefix and the .srs.md suffix.
  it("FR-NODE-065 AC-1: creates a new numbered scope srs.md from the scope template", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");
    const root = await resolveProjectRoot(rootPath);

    const result = await scaffoldScope(root, {
      name: "Reporting",
      prefix: "RPT",
      apply: true
    } satisfies ScaffoldScopeInput);
    expect(result.ok).toBe(true);
    if (result.ok !== true || result.value === undefined) throw new Error("expected ok result");

    const created = result.value.document;
    // The new document is a numbered scope srs.md (e.g. 20.reporting.srs.md), not the index and not
    // the already-registered architecture document.
    expect(created).toMatch(/^\d+\..*\.srs\.md$/);
    expect(created).not.toBe("10.product-architecture.srs.md");

    const createdAbs = path.join(rootPath, "docs", "spec", path.basename(created));
    expect(await fileExists(createdAbs)).toBe(true);

    const body = await readFile(createdAbs, "utf8");
    // Template frontmatter and sections are present, carrying the chosen prefix.
    expect(body).toContain("| Document Type | scope_srs |");
    expect(body).toContain("| Scope | RPT |");
    expect(body).toContain("## 1. Scope Overview");
    expect(body).toContain("## 4. Requirements");
  });

  // AC-2: scaffoldScope (with apply) adds exactly one row to the §2 SRS Documents section and
  // exactly one row to the §4 Scope Map section, both naming the newly created document with its
  // prefix. No other existing row in either section is disturbed.
  it("FR-NODE-065 AC-2: adds one row to SRS Documents and one row to Scope Map", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");
    const root = await resolveProjectRoot(rootPath);

    const before = await readFile(indexPath(rootPath), "utf8");
    const docsBefore = sectionRows(before, SRS_DOCUMENTS_HEADING);
    const mapBefore = sectionRows(before, SCOPE_MAP_HEADING);

    const result = await scaffoldScope(root, {
      name: "Reporting",
      prefix: "RPT",
      apply: true
    } satisfies ScaffoldScopeInput);
    expect(result.ok).toBe(true);
    if (result.ok !== true || result.value === undefined) throw new Error("expected ok result");

    const created = result.value.document;
    const after = await readFile(indexPath(rootPath), "utf8");
    const docsAfter = sectionRows(after, SRS_DOCUMENTS_HEADING);
    const mapAfter = sectionRows(after, SCOPE_MAP_HEADING);

    // Exactly one new row in each section (header + separator rows are unchanged).
    expect(docsAfter.length).toBe(docsBefore.length + 1);
    expect(mapAfter.length).toBe(mapBefore.length + 1);

    // The new rows reference the created document and its prefix in each section.
    const docsNewRow = docsAfter.find((row) => !docsBefore.includes(row));
    const mapNewRow = mapAfter.find((row) => !mapBefore.includes(row));
    expect(docsNewRow).toBeDefined();
    expect(mapNewRow).toBeDefined();
    expect(docsNewRow).toContain(path.basename(created));
    expect(docsNewRow).toContain("RPT");
    expect(mapNewRow).toContain(path.basename(created));
    expect(mapNewRow).toContain("RPT");
  });

  // AC-3: A scaffoldScope call whose name or prefix collides with an existing scope returns
  // ok false and writes no file. The valid-basic fixture already registers Product Architecture /
  // prefix ARCH, so reusing that prefix must be rejected without creating or modifying any file.
  it("FR-NODE-065 AC-3: a colliding name/prefix returns ok false and writes no file", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");
    const root = await resolveProjectRoot(rootPath);

    const indexBefore = await readFile(indexPath(rootPath), "utf8");
    const archBefore = await readFile(
      path.join(rootPath, "docs", "spec", "10.product-architecture.srs.md"),
      "utf8"
    );

    // ARCH is already registered in the fixture; reusing it is a collision.
    const result = await scaffoldScope(root, {
      name: "Product Architecture",
      prefix: "ARCH",
      apply: true
    } satisfies ScaffoldScopeInput);
    expect(result.ok).toBe(false);

    // No new scope srs.md file was written, and existing files are byte-identical.
    expect(await readFile(indexPath(rootPath), "utf8")).toBe(indexBefore);
    expect(
      await readFile(path.join(rootPath, "docs", "spec", "10.product-architecture.srs.md"), "utf8")
    ).toBe(archBefore);
  });

  // AC-4: A dry-run call (the default — no apply flag) returns a preview of the new file body and
  // the index rows it would add, and writes no file. The on-disk index stays byte-identical.
  it("FR-NODE-065 AC-4: dry-run returns a preview and writes no file", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");
    const root = await resolveProjectRoot(rootPath);

    const before = await readFile(indexPath(rootPath), "utf8");

    // No apply flag supplied — the mutation must default to dry-run.
    const result = await scaffoldScope(root, {
      name: "Reporting",
      prefix: "RPT"
    } satisfies ScaffoldScopeInput);
    expect(result.ok).toBe(true);
    if (result.ok !== true || result.value === undefined) throw new Error("expected ok result");

    const preview: ScaffoldScopeOutput = result.value;
    expect(preview.dryRun).toBe(true);

    // Preview names the new document and previews its template body and the index rows to add.
    expect(preview.document).toMatch(/\.srs\.md$/);
    expect(preview.filePreview).toContain("| Document Type | scope_srs |");
    expect(preview.filePreview).toContain("| Scope | RPT |");
    expect(preview.srsDocumentsRow).toContain(path.basename(preview.document));
    expect(preview.scopeMapRow).toContain(path.basename(preview.document));

    // No file was created and the index is byte-identical.
    const createdAbs = path.join(rootPath, "docs", "spec", path.basename(preview.document));
    expect(await fileExists(createdAbs)).toBe(false);
    expect(await readFile(indexPath(rootPath), "utf8")).toBe(before);
  });
});
