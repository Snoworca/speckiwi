import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const tempRoots: string[] = [];

beforeAll(() => {
  execFileSync("npm", ["run", "build"], { cwd: root, stdio: "pipe" });
});

afterEach(() => {
  for (const path of tempRoots.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

describe("requirement write CLI", () => {
  it("defaults req update to proposal mode and keeps source YAML unchanged", () => {
    const workspace = copyFixture();
    const source = join(workspace, ".speckiwi", "srs", "core.yaml");
    const before = readFileSync(source, "utf8");
    const result = runCli([
      "req",
      "update",
      "FR-CORE-0001",
      "--statement",
      "The system shall validate workspace YAML documents through CLI proposals.",
      "--root",
      workspace,
      "--json"
    ]);

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, mode: "propose", applied: false });
    expect(readFileSync(source, "utf8")).toBe(before);
  });

  it("applies req update only when --apply is explicit", () => {
    const workspace = copyFixture();
    const result = runCli([
      "req",
      "update",
      "FR-CORE-0001",
      "--statement",
      "The system shall validate workspace YAML documents through explicit CLI apply.",
      "--apply",
      "--root",
      workspace,
      "--json"
    ]);

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, mode: "apply", applied: true });
    expect(readFileSync(join(workspace, ".speckiwi", "srs", "core.yaml"), "utf8")).toContain("explicit CLI apply");
  });

  it("applies req update with --no-cache without creating a stale marker", () => {
    const workspace = copyFixture();
    const result = runCli([
      "req",
      "update",
      "FR-CORE-0001",
      "--statement",
      "The system shall validate workspace YAML documents through no-cache CLI apply.",
      "--apply",
      "--no-cache",
      "--root",
      workspace,
      "--json"
    ]);

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, mode: "apply", applied: true, cacheStale: false });
    expect(readFileSync(join(workspace, ".speckiwi", "srs", "core.yaml"), "utf8")).toContain("no-cache CLI apply");
    expect(existsSync(join(workspace, ".speckiwi", "cache", "stale.json"))).toBe(false);
  });

  it("creates requirement proposals with deterministic generated IDs", () => {
    const workspace = copyFixture();
    const result = runCli([
      "req",
      "create",
      "--scope",
      "core",
      "--type",
      "functional",
      "--title",
      "Create by CLI",
      "--statement",
      "The system shall create requirement proposals from the CLI.",
      "--root",
      workspace,
      "--json"
    ]);

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      mode: "propose",
      proposal: { target: { requirementId: "FR-SPE-CORE-0001" } }
    });
  });
});

function copyFixture(): string {
  const workspace = mkdtempSync(join(tmpdir(), "speckiwi-cli-write-"));
  tempRoots.push(workspace);
  cpSync(resolve(root, "test/fixtures/workspaces/valid-basic"), workspace, { recursive: true });
  return workspace;
}

function runCli(args: string[]) {
  return spawnSync("node", ["bin/speckiwi", ...args], {
    cwd: root,
    encoding: "utf8"
  });
}
