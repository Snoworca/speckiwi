import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const validRoot = resolve(root, "test/fixtures/workspaces/valid-basic");
const missingRoot = resolve(root, "test/fixtures/workspaces/init-empty");
const tempRoots: string[] = [];

describe("CLI doctor", () => {
  beforeAll(() => {
    execFileSync("npm", ["run", "build"], { cwd: root, stdio: "pipe" });
  });

  afterEach(() => {
    for (const path of tempRoots.splice(0)) {
      rmSync(path, { recursive: true, force: true });
    }
  });

  it("renders workspace checks for human output", () => {
    const result = runCli(["doctor", "--root", validRoot]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("SpecKiwi doctor");
    expect(result.stdout).toContain("node_version");
    expect(result.stdout).toContain("workspace");
  });

  it("returns DoctorResult JSON with required checks", () => {
    const result = runCli(["doctor", "--root", validRoot, "--json"]);
    const json = JSON.parse(result.stdout) as { ok: boolean; checks: Array<{ id: string; status: string }> };

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(json.ok).toBe(true);
    expect(json.checks.map((check) => check.id)).toEqual([
      "node_version",
      "package_version",
      "workspace",
      "required_files",
      "yaml_parse",
      "schema_validation",
      "cache_state",
      "mcp_binary",
      "stdout_policy",
      "stdio_policy"
    ]);
    expect(json.checks.find((check) => check.id === "mcp_binary")?.status).toMatch(/ok|warning/);
    expect(json.checks.find((check) => check.id === "stdio_policy")?.status).toBe("ok");
  });

  it("keeps doctor runnable when the workspace is missing", () => {
    const result = runCli(["doctor", "--root", missingRoot, "--json"]);
    const json = JSON.parse(result.stdout) as { checks: Array<{ id: string; status: string }> };

    expect(result.status).toBe(1);
    expect(json.checks.find((check) => check.id === "workspace")?.status).toBe("error");
    expect(json.checks.find((check) => check.id === "required_files")?.status).toBe("error");
  });

  it("returns validate JSON diagnostics for workspace-external store symlinks", () => {
    if (process.platform === "win32") {
      return;
    }

    const workspace = mkdtempSync(join(tmpdir(), "speckiwi-cli-validate-symlink-"));
    const externalStore = mkdtempSync(join(tmpdir(), "speckiwi-cli-external-store-"));
    tempRoots.push(workspace, externalStore);
    rmSync(externalStore, { recursive: true, force: true });
    cpSync(resolve(validRoot, ".speckiwi"), externalStore, { recursive: true });
    symlinkSync(externalStore, join(workspace, ".speckiwi"), "dir");

    const result = runCli(["validate", "--root", workspace, "--json"]);
    const json = JSON.parse(result.stdout) as { ok: boolean; valid: boolean; diagnostics: { errors: Array<{ code: string }> } };

    expect(result.status).toBe(2);
    expect(json.ok).toBe(false);
    expect(json.valid).toBe(false);
    expect(json.diagnostics.errors.map((diagnostic) => diagnostic.code)).toContain("WORKSPACE_ESCAPE");
  });
});

function runCli(args: string[]) {
  return spawnSync("node", ["bin/speckiwi", ...args], {
    cwd: root,
    encoding: "utf8"
  });
}
