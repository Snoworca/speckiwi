import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { normalizeStorePath, resolveStorePath } from "../../src/io/path.js";
import { workspaceRootFromPath } from "../../src/io/workspace.js";
import { loadYamlDocument } from "../../src/io/yaml-loader.js";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("YAML loader", () => {
  it("loads valid YAML into JSON-compatible values", async () => {
    const path = await writeWorkspaceYaml("overview.yaml", "schemaVersion: speckiwi/overview/v1\nid: overview\nitems:\n  - one\n");

    const loaded = await loadYamlDocument(path);

    expect(loaded.diagnostics.summary.errorCount).toBe(0);
    expect(loaded.value).toEqual({
      schemaVersion: "speckiwi/overview/v1",
      id: "overview",
      items: ["one"]
    });
  });

  it("returns line and column diagnostics for invalid YAML", async () => {
    const path = await writeWorkspaceYaml("broken.yaml", "schemaVersion: speckiwi/overview/v1\nid: [\n");

    const loaded = await loadYamlDocument(path);

    expect(loaded.value).toBeUndefined();
    expect(loaded.diagnostics.errors[0]).toMatchObject({
      severity: "error",
      path: "broken.yaml"
    });
    expect(loaded.diagnostics.errors[0]?.line).toBeGreaterThanOrEqual(2);
  });

  it("rejects anchors, aliases, and merge keys as subset errors", async () => {
    const path = await writeWorkspaceYaml("subset.yaml", "base: &base\n  enabled: true\ncopy: *base\nmerged:\n  <<: *base\n");

    const loaded = await loadYamlDocument(path);

    expect(loaded.value).toBeUndefined();
    expect([...loaded.diagnostics.errors.map((diagnostic) => diagnostic.code)].sort()).toEqual([
      "YAML_ANCHOR_FORBIDDEN",
      "YAML_ALIAS_FORBIDDEN",
      "YAML_ALIAS_FORBIDDEN",
      "YAML_MERGE_KEY_FORBIDDEN"
    ].sort());
  });
});

async function writeWorkspaceYaml(storePath: string, content: string) {
  const rootPath = await mkdtemp(join(tmpdir(), "speckiwi-yaml-"));
  tempRoots.push(rootPath);
  const root = workspaceRootFromPath(rootPath);
  await mkdir(root.speckiwiPath, { recursive: true });
  const workspacePath = resolveStorePath(root, normalizeStorePath(storePath));
  await writeFile(workspacePath.absolutePath, content, "utf8");
  return workspacePath;
}
