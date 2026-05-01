import { execFileSync, spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { mapCoreResultToExitCode, exitCodes } from "../../src/cli/exit-code.js";
import { createDiagnosticBag, fail, validationResult } from "../../src/core/result.js";

const root = resolve(import.meta.dirname, "../..");
const fixtureRoot = resolve(root, "test/fixtures/workspaces");

describe("CLI common options, JSON stdout, and exit codes", () => {
  beforeAll(() => {
    execFileSync("npm", ["run", "build"], { cwd: root, stdio: "pipe" });
  });

  it("prints exactly one JSON object to stdout in --json mode", () => {
    const result = runCli(["validate", "--root", resolve(fixtureRoot, "valid-basic"), "--json"]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout.trim().split("\n")).toHaveLength(1);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, valid: true });
  });

  it("maps validation, workspace, invalid argument, and not found failures", () => {
    expect(mapCoreResultToExitCode(validationResult(createDiagnosticBag([{ severity: "error", code: "X", message: "x" }])))).toBe(
      exitCodes.validation
    );
    expect(mapCoreResultToExitCode(fail({ code: "WORKSPACE_NOT_FOUND", message: "missing" }))).toBe(exitCodes.workspaceNotFound);
    expect(mapCoreResultToExitCode(fail({ code: "IMPACT_TARGET_TYPE_NOT_SUPPORTED", message: "bad target" }))).toBe(
      exitCodes.invalidArgument
    );
    expect(mapCoreResultToExitCode(fail({ code: "REQUIREMENT_NOT_FOUND", message: "missing" }))).toBe(exitCodes.error);
  });

  it("returns documented exit codes from command handlers", () => {
    const invalid = runCli(["validate", "--root", resolve(fixtureRoot, "invalid-relations"), "--json"]);
    const notFound = runCli(["req", "get", "FR-NOPE-0001", "--root", resolve(fixtureRoot, "valid-basic"), "--json"]);
    const invalidTarget = runCli(["impact", "FR-CORE-0001", "--scope", "--root", resolve(fixtureRoot, "valid-basic"), "--json"]);

    expect(invalid.status).toBe(2);
    expect(JSON.parse(invalid.stdout)).toMatchObject({ ok: false, valid: false });
    expect(notFound.status).toBe(1);
    expect(JSON.parse(notFound.stdout)).toMatchObject({ ok: false, error: { code: "REQUIREMENT_NOT_FOUND" } });
    expect(invalidTarget.status).toBe(4);
    expect(JSON.parse(invalidTarget.stdout)).toMatchObject({ ok: false, error: { code: "IMPACT_TARGET_TYPE_NOT_SUPPORTED" } });
  });
});

function runCli(args: string[]) {
  return spawnSync("node", ["bin/speckiwi", ...args], {
    cwd: root,
    encoding: "utf8"
  });
}
