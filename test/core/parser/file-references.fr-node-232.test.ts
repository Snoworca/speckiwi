import { describe, expect, it } from "vitest";
import { sameRepositoryPath } from "../../../src/core/parser/file-references.js";

// One answer to "do these two references name the same file", shared by links check (which asks the
// file system) and renameScope (which compares paths).

describe("sameRepositoryPath", () => {
  // @req FR-NODE-232 AC-6
  it("ignores case on a case-insensitive file system and keeps it on a case-sensitive one", () => {
    expect(sameRepositoryPath("docs/spec/10.Product-Architecture.srs.md", "docs/spec/10.product-architecture.srs.md", { caseInsensitive: true })).toBe(true);
    expect(sameRepositoryPath("docs/spec/10.Product-Architecture.srs.md", "docs/spec/10.product-architecture.srs.md", { caseInsensitive: false })).toBe(false);
    expect(sameRepositoryPath("docs/spec/a.md", "docs/spec/b.md", { caseInsensitive: true })).toBe(false);
  });

  // @req FR-NODE-232 AC-6
  it("compares normalised paths and treats an undefined side as no match", () => {
    expect(sameRepositoryPath("docs/spec/./x/../a.md", "docs/spec/a.md", { caseInsensitive: false })).toBe(true);
    expect(sameRepositoryPath(undefined, "docs/spec/a.md")).toBe(false);
  });

  it("defaults to the file system the process runs on", () => {
    const insensitive = process.platform === "win32" || process.platform === "darwin";
    expect(sameRepositoryPath("docs/spec/A.md", "docs/spec/a.md")).toBe(insensitive);
  });
});
