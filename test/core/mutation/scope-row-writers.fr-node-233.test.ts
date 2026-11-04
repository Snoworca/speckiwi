import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { registerScopes } from "../../../src/core/mutation/register-scopes.js";
import { scaffoldScope } from "../../../src/core/mutation/scaffold-scope.js";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

// FR-NODE-233 — both scope-row writers place cells by column name. Section 4 of this repository's
// own index lists `| Scope | Prefix | Primary Document | Notes |` while section 2 lists
// `| Scope | Document | Prefix | Description |`; the init template gives both the section-2 order.

const SECTION_2_HEADER = "| Scope | Document | Prefix | Description |";
const SECTION_4_REORDERED = "| Scope | Prefix | Primary Document | Notes |";

function indexPath(rootPath: string): string {
  return path.join(rootPath, "docs", "spec", "00.index.md");
}

/** Rewrites the section-4 header (and its existing row) to the given column order. */
async function reorderScopeMap(rootPath: string, header: string, existingRow: string): Promise<void> {
  const text = await readFile(indexPath(rootPath), "utf8");
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  const heading = lines.findIndex((line) => /^## 4\. Scope Map/.test(line));
  expect(lines[heading + 2]).toBe(SECTION_2_HEADER);
  lines[heading + 2] = header;
  lines[heading + 4] = existingRow;
  await writeFile(indexPath(rootPath), lines.join(newline), "utf8");
}

function sectionRows(text: string, heading: RegExp): string[] {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => heading.test(line));
  const rows: string[] = [];
  for (let i = start + 1; i < lines.length && !/^##\s/.test(lines[i] ?? ""); i += 1) {
    if ((lines[i] ?? "").startsWith("|")) rows.push(lines[i] ?? "");
  }
  return rows;
}

describe("FR-NODE-233 scope-row writers address cells by column name", () => {
  // @req FR-NODE-233 AC-2
  it("scaffoldScope writes the section-4 row in section 4's own column order", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");
    await reorderScopeMap(
      rootPath,
      SECTION_4_REORDERED,
      "| Product Architecture | ARCH | [10.product-architecture.srs.md](./10.product-architecture.srs.md) | Architecture |"
    );
    const root = await resolveProjectRoot(rootPath);

    const result = await scaffoldScope(root, { name: "Reporting", prefix: "RPT", apply: true });
    expect(result.ok).toBe(true);

    const text = await readFile(indexPath(rootPath), "utf8");
    expect(sectionRows(text, /^## 4\. Scope Map/).at(-1)).toBe("| Reporting | RPT | [11.reporting.srs.md](./11.reporting.srs.md) | Reporting |");
    expect(sectionRows(text, /^## 2\. SRS Documents/).at(-1)).toBe("| Reporting | [11.reporting.srs.md](./11.reporting.srs.md) | RPT | Reporting |");
    const workspace = await parseWorkspace(root);
    expect(workspace.index.scopes.find((scope) => scope.scope === "Reporting")).toMatchObject({
      prefix: "RPT",
      document: "./11.reporting.srs.md",
      description: "Reporting"
    });
  });

  // @req FR-NODE-233 AC-2
  it("scaffoldScope previews the section-4 row in section 4's own column order", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");
    await reorderScopeMap(
      rootPath,
      SECTION_4_REORDERED,
      "| Product Architecture | ARCH | [10.product-architecture.srs.md](./10.product-architecture.srs.md) | Architecture |"
    );
    const result = await scaffoldScope(await resolveProjectRoot(rootPath), { name: "Reporting", prefix: "RPT" });
    expect(result.value?.scopeMapRow).toBe("| Reporting | RPT | [11.reporting.srs.md](./11.reporting.srs.md) | Reporting |");
    expect(result.value?.srsDocumentsRow).toBe("| Reporting | [11.reporting.srs.md](./11.reporting.srs.md) | RPT | Reporting |");
  });

  // @req FR-NODE-233 AC-2
  it("registerScopes writes the section-4 row in section 4's own column order", async () => {
    const rootPath = await copyFixtureWorkspace("index-drift-unregistered-srs");
    await reorderScopeMap(
      rootPath,
      SECTION_4_REORDERED,
      "| Product Architecture | ARCH | [10.product-architecture.srs.md](./10.product-architecture.srs.md) | Architecture |"
    );
    const root = await resolveProjectRoot(rootPath);

    const result = await registerScopes(root, { apply: true });
    expect(result.ok).toBe(true);

    const text = await readFile(indexPath(rootPath), "utf8");
    expect(sectionRows(text, /^## 4\. Scope Map/).at(-1)).toBe("| EXTRA | EXTRA | ./20.unregistered.srs.md | - |");
    const workspace = await parseWorkspace(root);
    expect(workspace.index.scopes.find((scope) => scope.prefix === "EXTRA")?.document).toBe("./20.unregistered.srs.md");
  });

  // @req FR-NODE-233 AC-1
  it("scaffoldScope refuses, writing nothing, when section 4 has no column for a value it must place", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");
    await reorderScopeMap(rootPath, "| Scope | Prefix | Owner | Notes |", "| Product Architecture | ARCH | team | Architecture |");
    const before = await readFile(indexPath(rootPath), "utf8");

    const result = await scaffoldScope(await resolveProjectRoot(rootPath), { name: "Reporting", prefix: "RPT", apply: true });

    expect(result.ok).toBe(false);
    expect(result.error?.message).toContain("Document");
    expect(await readFile(indexPath(rootPath), "utf8")).toBe(before);
    await expect(readFile(path.join(rootPath, "docs", "spec", "11.reporting.srs.md"), "utf8")).rejects.toThrow();
  });

  // @req FR-NODE-233 AC-1
  it("registerScopes refuses, writing nothing, when section 4 has no column for a value it must place", async () => {
    const rootPath = await copyFixtureWorkspace("index-drift-unregistered-srs");
    await reorderScopeMap(rootPath, "| Scope | Prefix | Owner | Notes |", "| Product Architecture | ARCH | team | Architecture |");
    const before = await readFile(indexPath(rootPath), "utf8");

    const result = await registerScopes(await resolveProjectRoot(rootPath), { apply: true });

    expect(result.ok).toBe(false);
    expect(await readFile(indexPath(rootPath), "utf8")).toBe(before);
  });
});
