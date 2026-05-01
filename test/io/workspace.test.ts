import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { atomicWriteText } from "../../src/io/file-store.js";
import { normalizeStorePath, resolveStorePath } from "../../src/io/path.js";
import { findWorkspaceRoot, workspaceRootFromPath } from "../../src/io/workspace.js";
import { initWorkspace } from "../../src/core/init.js";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("workspace root and file store", () => {
  it("discovers the nearest .speckiwi directory from a nested cwd", async () => {
    const root = await tempRoot();
    await mkdir(join(root, ".speckiwi"), { recursive: true });
    const nested = join(root, "packages", "app", "src");
    await mkdir(nested, { recursive: true });

    const workspace = await findWorkspaceRoot(nested);

    expect(workspace).toEqual({
      rootPath: root,
      speckiwiPath: join(root, ".speckiwi"),
      explicit: false
    });
  });

  it("uses an explicit root before parent discovery", async () => {
    const outer = await tempRoot();
    const inner = join(outer, "nested");
    const explicit = join(outer, "explicit");
    await mkdir(join(outer, ".speckiwi"), { recursive: true });
    await mkdir(join(explicit, ".speckiwi"), { recursive: true });
    await mkdir(inner, { recursive: true });

    const workspace = await findWorkspaceRoot(inner, explicit);

    expect(workspace.rootPath).toBe(explicit);
    expect(workspace.explicit).toBe(true);
  });

  it("rejects traversal, absolute, and Windows drive store paths", () => {
    const root = workspaceRootFromPath(resolve("/tmp/spec-root"));

    expect(() => normalizeStorePath("../overview.yaml")).toThrow("parent segments");
    expect(() => normalizeStorePath("/overview.yaml")).toThrow("relative");
    expect(() => normalizeStorePath("C:\\temp\\overview.yaml")).toThrow("relative");
    expect(() => resolveStorePath(root, normalizeStorePath("srs/../overview.yaml"))).toThrow("parent segments");
  });

  it("resolves valid store paths inside .speckiwi", () => {
    const root = workspaceRootFromPath(resolve("/tmp/spec-root"));
    const path = resolveStorePath(root, normalizeStorePath("srs/main.yaml"));

    expect(path.absolutePath).toBe(resolve("/tmp/spec-root/.speckiwi/srs/main.yaml"));
    expect(path.storePath).toBe("srs/main.yaml");
  });

  it("writes atomically and removes temporary files after rename failure", async () => {
    const root = await tempRoot();
    const target = join(root, "target.yaml");
    await mkdir(target);

    await expect(atomicWriteText(target, "content")).rejects.toThrow();
    expect(await readdir(root)).toEqual(["target.yaml"]);
  });
});

describe("workspace init", () => {
  it("creates the full .speckiwi directory tree and templates", async () => {
    const root = await tempRoot();

    const result = await initWorkspace({
      root,
      projectId: "speckiwi",
      projectName: "SpecKiwi",
      language: "ko"
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.created).toContain(".speckiwi/index.yaml");
      expect(result.created).toContain(".speckiwi/srs");
    }
    await expect(readFile(join(root, ".speckiwi/index.yaml"), "utf8")).resolves.toContain("schemaVersion: speckiwi/index/v1");
    await expect(readFile(join(root, ".speckiwi/overview.yaml"), "utf8")).resolves.toContain("id: overview");
    await expect(readFile(join(root, ".speckiwi/dictionary.yaml"), "utf8")).resolves.toContain("id: dictionary");

    for (const directory of ["prd", "srs", "tech", "adr", "rules", "proposals", "templates", "cache", "exports"]) {
      await expect(readdir(join(root, ".speckiwi", directory))).resolves.toEqual([]);
    }
  });

  it("rejects an existing workspace without force", async () => {
    const root = await tempRoot();
    await mkdir(join(root, ".speckiwi"), { recursive: true });

    const result = await initWorkspace({ root });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "WORKSPACE_ALREADY_EXISTS" },
      diagnostics: { summary: { errorCount: 1 } }
    });
  });

  it("does not overwrite existing template files in force mode", async () => {
    const root = await tempRoot();
    await mkdir(join(root, ".speckiwi"), { recursive: true });
    await writeFile(join(root, ".speckiwi/index.yaml"), "existing: true\n", "utf8");

    const result = await initWorkspace({ root, force: true });

    expect(result.ok).toBe(true);
    await expect(readFile(join(root, ".speckiwi/index.yaml"), "utf8")).resolves.toBe("existing: true\n");
  });
});

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "speckiwi-"));
  tempRoots.push(root);
  return root;
}
