import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { initProject } from "../../../src/core/bootstrap/init-project.js";
import {
  nextScopeDocumentNumber,
  parseScopeOption,
  scopeDocumentName
} from "../../../src/core/bootstrap/templates.js";
import { scaffoldScope } from "../../../src/core/mutation/scaffold-scope.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

// FR-NODE-088 — scope document numbers are allocated sequentially and never collide.
//
// Users reported two distinct failures of the old allocation. `parseScopeOption` returned a
// hard-coded `10.<slug>.srs.md`, so every document the template path produced claimed the number
// 10; and `scaffoldScope` rounded up to the next decade, so a project's second scope document was
// numbered 20 where 02 was expected. Both are addressed by one allocation rule: the next number is
// one above the highest number already on disk, starting at 01.
//
// Every case builds a real project on disk and reads the resulting file names, so the assertions
// observe the actual allocation rather than an implementation-shaped mock.

const SPEC_DIR = ["docs", "spec"] as const;

async function emptyRepo(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "speckiwi-scope-number-"));
  await mkdir(path.join(root, ".git"));
  return root;
}

function specDir(rootPath: string): string {
  return path.join(rootPath, ...SPEC_DIR);
}

/** Scope SRS documents that sit directly in docs/spec, in on-disk order. */
async function scopeDocuments(rootPath: string): Promise<string[]> {
  const entries = await readdir(specDir(rootPath), { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".srs.md"))
    .map((entry) => entry.name)
    .sort();
}

/** The leading numeric token of a scope document file name, e.g. `01.auth.srs.md` -> "01". */
function leadingNumber(fileName: string): string | undefined {
  return /^(\d+)\./.exec(fileName)?.[1];
}

async function initOnce(rootPath: string): Promise<void> {
  const result = await initProject(await resolveProjectRoot(rootPath), {});
  if (!result.ok) throw new Error(result.error.message);
}

describe("FR-NODE-088 AC-1 — the first scope document in a project is 01", () => {
  it("names the scope document init scaffolds in an empty project 01.<slug>.srs.md", async () => {
    const rootPath = await emptyRepo();

    await initOnce(rootPath);

    const documents = await scopeDocuments(rootPath);
    expect(documents).toHaveLength(1);
    // The single scaffolded document carries the number 01 — not 10, which is what the hard-coded
    // template name produced before.
    expect(documents[0]).toMatch(/^01\..+\.srs\.md$/);
  });

  it("allocates 1 when no scope document exists at all", () => {
    expect(nextScopeDocumentNumber([])).toBe(1);
  });
});

describe("FR-NODE-088 AC-2 — the next number is one above the highest existing number", () => {
  it("allocates 02 after a project numbered 01", () => {
    expect(nextScopeDocumentNumber(["01.auth.srs.md"])).toBe(2);
  });

  it("allocates 61 after a project numbered 10 through 60, so decade-numbered sets continue", () => {
    const existing = [
      "10.product-architecture.srs.md",
      "20.parser-validation.srs.md",
      "30.cli-interface.srs.md",
      "40.mcp-stdio-interface.srs.md",
      "50.nodejs-implementation.srs.md",
      "60.workflow-release.srs.md"
    ];
    // One above the highest — not the next decade (70), which would leave nine numbers unused
    // and not the fixed 10, which would collide with the first document.
    expect(nextScopeDocumentNumber(existing)).toBe(61);
  });

  it("scaffolds the next number above the fixture's highest document, not the next decade", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");
    const root = await resolveProjectRoot(rootPath);

    // The fixture ships exactly one scope document, 10.product-architecture.srs.md.
    expect(await scopeDocuments(rootPath)).toEqual(["10.product-architecture.srs.md"]);

    const result = await scaffoldScope(root, { name: "Reporting", prefix: "RPT", apply: true });
    expect(result.ok).toBe(true);
    if (result.ok !== true || result.value === undefined) throw new Error("expected ok result");

    expect(result.value.document).toBe("11.reporting.srs.md");
  });
});

describe("FR-NODE-088 AC-3 — the allocated number is rendered as two digits", () => {
  it("pads a number below ten with a leading zero", () => {
    expect(scopeDocumentName("auth", 1)).toBe("01.auth.srs.md");
    expect(scopeDocumentName("auth", 9)).toBe("09.auth.srs.md");
  });

  it("leaves a number of ten or above unpadded", () => {
    expect(scopeDocumentName("auth", 10)).toBe("10.auth.srs.md");
    expect(scopeDocumentName("auth", 61)).toBe("61.auth.srs.md");
  });
});

describe("FR-NODE-088 AC-4 — the scope template helper carries no fixed document number", () => {
  it("returns no document number of its own from parseScopeOption", () => {
    const parsed = parseScopeOption("Reporting:RPT");
    expect(parsed.name).toBe("Reporting");
    expect(parsed.prefix).toBe("RPT");
    expect(parsed.slug).toBe("reporting");
    // The whole defect was a number baked into this helper. Whatever shape the helper returns, no
    // property of it may carry a document number — the number comes from allocation.
    for (const value of Object.values(parsed as Record<string, unknown>)) {
      if (typeof value === "string") expect(value).not.toMatch(/^\d+\./);
    }
  });

  it("returns the same parse result for the default scope, still without a number", () => {
    const parsed = parseScopeOption();
    for (const value of Object.values(parsed as Record<string, unknown>)) {
      if (typeof value === "string") expect(value).not.toMatch(/^\d+\./);
    }
  });
});

describe("FR-NODE-088 AC-5 — init scaffolds a default scope document only when none exists", () => {
  it("adds no scope document when the project already has one under a different name", async () => {
    const rootPath = await emptyRepo();
    await mkdir(specDir(rootPath), { recursive: true });
    // A consumer's own scope document, numbered and named nothing like the tool's default.
    await writeFile(path.join(specDir(rootPath), "07.billing.srs.md"), "# Billing\n", "utf8");

    await initOnce(rootPath);

    // Init must not add a second, empty default scope document beside the consumer's own.
    expect(await scopeDocuments(rootPath)).toEqual(["07.billing.srs.md"]);
  });

  it("adds none even with --force, which rewrites the index and would otherwise overwrite the document", async () => {
    const rootPath = await emptyRepo();
    await mkdir(specDir(rootPath), { recursive: true });
    const existing = path.join(specDir(rootPath), "07.billing.srs.md");
    await writeFile(
      existing,
      ["# Billing", "", "| Field | Value |", "|---|---|", "| Document Type | scope_srs |", "| Scope | BILL |", "| Scope Name | Billing |", "", "## 4. Requirements", ""].join("\n"),
      "utf8"
    );

    const result = await initProject(await resolveProjectRoot(rootPath), { force: true });
    expect(result.ok).toBe(true);

    // --force rewrites the index, so this is the case where dropping the guard would replace the
    // consumer's own scope document with an empty template.
    expect(await scopeDocuments(rootPath)).toEqual(["07.billing.srs.md"]);
    expect(await readFile(existing, "utf8")).toContain("| Scope | BILL |");
  });

  it("registers an existing document under its own scope identity, not the default one", async () => {
    const rootPath = await emptyRepo();
    await mkdir(specDir(rootPath), { recursive: true });
    await writeFile(
      path.join(specDir(rootPath), "07.billing.srs.md"),
      ["# Billing", "", "| Field | Value |", "|---|---|", "| Document Type | scope_srs |", "| Scope | BILL |", "| Scope Name | Billing |", "", "## 4. Requirements", ""].join("\n"),
      "utf8"
    );

    await initOnce(rootPath);

    const index = await readFile(path.join(specDir(rootPath), "00.index.md"), "utf8");
    // Binding the document to the default ARCH identity would file every ARCH requirement into the
    // Billing document while validation stayed clean.
    expect(index).toContain("| Billing | [07.billing.srs.md](./07.billing.srs.md) | BILL | Billing |");
    expect(index).not.toContain("ARCH");
    expect(index).not.toContain("Product Architecture");
  });

  it("reports an explicit --scope it did not act on instead of dropping it silently", async () => {
    const rootPath = await emptyRepo();
    await mkdir(specDir(rootPath), { recursive: true });
    await writeFile(path.join(specDir(rootPath), "07.billing.srs.md"), "# Billing\n", "utf8");

    const result = await initProject(await resolveProjectRoot(rootPath), { scope: "Auth:AUTH" });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);

    expect(await scopeDocuments(rootPath)).toEqual(["07.billing.srs.md"]);
    const warning = (result.value.warnings ?? []).find((text) => text.includes("Auth"));
    expect(warning).toBeDefined();
    expect(warning).toContain("scaffold-scope");
  });

  it("leaves an existing default-named scope document untouched and adds no other", async () => {
    const rootPath = await emptyRepo();
    await mkdir(specDir(rootPath), { recursive: true });
    const existing = path.join(specDir(rootPath), "01.product-architecture.srs.md");
    await writeFile(existing, "# Product Architecture\n\nauthored by hand\n", "utf8");

    await initOnce(rootPath);

    expect(await scopeDocuments(rootPath)).toEqual(["01.product-architecture.srs.md"]);
    expect(await readFile(existing, "utf8")).toContain("authored by hand");
  });
});

describe("FR-NODE-088 AC-6 — an allocated number never reuses an existing one", () => {
  it("skips a number already taken even when the taken numbers have gaps", () => {
    // Highest wins: a gap at 02..06 does not tempt the allocator into refilling a hole, because
    // refilling would reuse an ordering position a reader has already anchored on.
    expect(nextScopeDocumentNumber(["01.a.srs.md", "07.b.srs.md"])).toBe(8);
  });

  it("renames no existing document when scaffolding a new one", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");
    const root = await resolveProjectRoot(rootPath);
    const before = await readFile(
      path.join(specDir(rootPath), "10.product-architecture.srs.md"),
      "utf8"
    );

    const result = await scaffoldScope(root, { name: "Reporting", prefix: "RPT", apply: true });
    expect(result.ok).toBe(true);

    const after = await scopeDocuments(rootPath);
    // The pre-existing document keeps both its name and its bytes.
    expect(after).toContain("10.product-architecture.srs.md");
    expect(
      await readFile(path.join(specDir(rootPath), "10.product-architecture.srs.md"), "utf8")
    ).toBe(before);

    // Every document in the set carries a distinct leading number.
    const numbers = after.map(leadingNumber);
    expect(new Set(numbers).size).toBe(numbers.length);
  });
});
