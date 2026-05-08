import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildLargeSrsFixture, copyFixtureWorkspace } from "./fixture-utils.js";

describe("fixture workspaces", () => {
  it("copies named fixture workspaces and preserves CRLF bytes", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    await expect(readFile(path.join(root, "docs", "spec", "00.index.md"), "utf8")).resolves.toContain("Target Map");

    const crlf = await copyFixtureWorkspace("crlf-basic");
    const bytes = await readFile(path.join(crlf, "docs", "spec", "10.product-architecture.srs.md"), "utf8");
    expect(bytes).toContain("\r\n");
  });

  it("exposes separate invalid fixture categories", async () => {
    await expect(copyFixtureWorkspace("duplicate-id")).resolves.toContain("duplicate-id");
    await expect(copyFixtureWorkspace("missing-metadata")).resolves.toContain("missing-metadata");
    await expect(copyFixtureWorkspace("missing-fixture")).rejects.toThrow(/unknown fixture/i);
  });

  it("builds a large 500 requirement fixture", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    await buildLargeSrsFixture(500, root);
    const text = await readFile(path.join(root, "docs", "spec", "10.product-architecture.srs.md"), "utf8");
    expect(text.match(/^### FR-ARCH-/gm)?.length).toBeGreaterThanOrEqual(500);
  });
});
