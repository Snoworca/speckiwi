import { execFileSync, spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const validRoot = resolve(root, "test/fixtures/workspaces/valid-basic");
const missingRoot = resolve(root, "test/fixtures/workspaces/init-empty");

describe("CLI doctor", () => {
  beforeAll(() => {
    execFileSync("npm", ["run", "build"], { cwd: root, stdio: "pipe" });
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
      "stdout_policy"
    ]);
  });

  it("keeps doctor runnable when the workspace is missing", () => {
    const result = runCli(["doctor", "--root", missingRoot, "--json"]);
    const json = JSON.parse(result.stdout) as { checks: Array<{ id: string; status: string }> };

    expect(result.status).toBe(1);
    expect(json.checks.find((check) => check.id === "workspace")?.status).toBe("error");
    expect(json.checks.find((check) => check.id === "required_files")?.status).toBe("error");
  });
});

function runCli(args: string[]) {
  return spawnSync("node", ["bin/speckiwi", ...args], {
    cwd: root,
    encoding: "utf8"
  });
}
