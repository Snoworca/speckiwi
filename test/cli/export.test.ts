import { execFileSync, spawnSync } from "node:child_process";
import { cp, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const fixtureRoot = resolve(root, "test/fixtures/workspaces/valid-basic");
const tempRoot = resolve(root, "test/.tmp-export-cli");

beforeAll(() => {
  execFileSync("npm", ["run", "build"], { cwd: root, stdio: "pipe" });
});

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

describe("export CLI", () => {
  it("exports Markdown through JSON and human CLI modes", async () => {
    const workspace = await exportFixture("basic");

    const json = runCli(["export", "markdown", "--root", workspace, "--json"]);
    const human = runCli(["export", "markdown", "--root", workspace, "--type", "srs"]);

    expect(json.status).toBe(0);
    expect(json.stderr).toBe("");
    expect(JSON.parse(json.stdout)).toMatchObject({
      ok: true,
      writtenFiles: [{ path: "index.md" }, { path: "overview.md" }, { path: "srs/core.md" }]
    });
    expect(human.status).toBe(0);
    expect(human.stdout).toContain("Exported Markdown files:");
    expect(human.stdout).toContain(".speckiwi/exports/srs/core.md");
  });

  it("maps unsupported export types and strict validation failures to documented exit codes", async () => {
    const workspace = await exportFixture("errors");
    await writeFile(
      resolve(workspace, ".speckiwi/srs/core.yaml"),
      `schemaVersion: speckiwi/srs/v1
id: srs.core
type: srs
scope: core
title: Core SRS
status: active
requirements:
  - id: FR-CORE-0001
    type: functional
    title: Missing statement
    status: active
`,
      "utf8"
    );

    const unsupported = runCli(["export", "markdown", "--root", workspace, "--type", "rule", "--json"]);
    const strict = runCli(["export", "markdown", "--root", workspace, "--strict", "--json"]);

    expect(unsupported.status).toBe(4);
    expect(JSON.parse(unsupported.stdout)).toMatchObject({ ok: false, error: { code: "EXPORT_TYPE_NOT_SUPPORTED" } });
    expect(strict.status).toBe(2);
    expect(JSON.parse(strict.stdout)).toMatchObject({ ok: false, strict: true, writtenFiles: [] });
  });

  it("exports in no-cache mode without creating cache files", async () => {
    const workspace = await exportFixture("no-cache");
    await rm(resolve(workspace, ".speckiwi/cache"), { recursive: true, force: true });

    const result = runCli(["export", "markdown", "--root", workspace, "--no-cache", "--json"]);

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: true });
    await expect(stat(resolve(workspace, ".speckiwi/cache"))).rejects.toThrow();
  });
});

async function exportFixture(name: string): Promise<string> {
  const workspace = resolve(tempRoot, name);
  await cp(fixtureRoot, workspace, { recursive: true });
  await mkdir(resolve(workspace, ".speckiwi/srs"), { recursive: true });
  return workspace;
}

function runCli(args: string[]) {
  return spawnSync("node", ["bin/speckiwi", ...args], {
    cwd: root,
    encoding: "utf8"
  });
}
