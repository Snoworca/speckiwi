import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { setActiveTarget } from "../../../src/core/mutation/set-active-target.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

describe("set active target mutation", () => {
  it("updates Active Target metadata and Target Map status rows", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const result = await setActiveTarget(await resolveProjectRoot(rootPath), { target: "v1.1.0" });

    expect(result).toMatchObject({ ok: true, value: { activeTarget: "v1.1.0", previousActiveTarget: "v1.0.0", written: true } });
    const index = await readFile(path.join(rootPath, "docs", "spec", "00.index.md"), "utf8");
    expect(index).toContain("| Active Target | v1.1.0 |");
    expect(index).toContain("| v1.0.0 | release | planned | Fixture release |");
    expect(index).toContain("| v1.1.0 | version | active | Next fixture target |");
  });

  it("inserts Active Target metadata for older index files", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const indexPath = path.join(rootPath, "docs", "spec", "00.index.md");
    const original = await readFile(indexPath, "utf8");
    await writeFile(indexPath, original.replace("| Active Target | v1.0.0 |\n", ""), "utf8");

    const result = await setActiveTarget(await resolveProjectRoot(rootPath), { target: "v1.1.0" });

    expect(result).toMatchObject({ ok: true, value: { activeTarget: "v1.1.0", previousActiveTarget: "v1.0.0", written: true } });
    await expect(readFile(indexPath, "utf8")).resolves.toContain("| Active Target | v1.1.0 |");
  });

  it("finds Target Map by heading text after section renumbering", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const indexPath = path.join(rootPath, "docs", "spec", "00.index.md");
    await writeFile(indexPath, (await readFile(indexPath, "utf8")).replace("## 3. Target Map", "## 4. Target Map"), "utf8");

    const result = await setActiveTarget(await resolveProjectRoot(rootPath), { target: "v1.1.0" });

    expect(result).toMatchObject({ ok: true, value: { activeTarget: "v1.1.0", written: true } });
  });

  it("rejects unknown targets without changing the index", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const indexPath = path.join(rootPath, "docs", "spec", "00.index.md");
    const before = await readFile(indexPath, "utf8");
    const result = await setActiveTarget(await resolveProjectRoot(rootPath), { target: "v9.9.9" });

    expect(result).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    await expect(readFile(indexPath, "utf8")).resolves.toBe(before);
  });
});
