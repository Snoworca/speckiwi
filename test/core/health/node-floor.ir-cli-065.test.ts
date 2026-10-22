import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { diagnoseHealth } from "../../../src/core/health/doctor.js";
import { NODE_ENGINES_RANGE, engineFloorVersion } from "../../../src/core/package-version.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

// @req IR-CLI-065 AC-5 — the floor doctor enforces is the one the package declares, not a copy of it.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

async function declaredEnginesRange(): Promise<string> {
  const manifest = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8")) as { engines: { node: string } };
  return manifest.engines.node;
}

async function nodeCheck(nodeVersion: string, nodeEnginesRange?: string) {
  const workspace = await parseWorkspace(await resolveProjectRoot(await copyFixtureWorkspace("valid-basic")));
  const report = await diagnoseHealth(workspace, { nodeVersion, ...(nodeEnginesRange === undefined ? {} : { nodeEnginesRange }) });
  const check = report.checks.find((candidate) => candidate.topic === "Node version");
  if (!check) throw new Error("no Node version check");
  return check;
}

describe("IR-CLI-065 AC-5 — the Node floor comes from package.json engines.node", () => {
  it("IR-CLI-065 AC-5: engineFloorVersion reads the version a >= range starts at", () => {
    expect(engineFloorVersion(">=22")).toEqual([22, 0, 0]);
    expect(engineFloorVersion(">= 20.5.1")).toEqual([20, 5, 1]);
    expect(engineFloorVersion(">=22.12")).toEqual([22, 12, 0]);
    expect(engineFloorVersion("^24.0.0")).toEqual([24, 0, 0]);
    expect(engineFloorVersion("*")).toBeUndefined();
  });

  it("IR-CLI-065 AC-5: the shipped range is the package's own, >=22, and doctor fails at 21 and passes at 22", async () => {
    expect(NODE_ENGINES_RANGE).toBe(await declaredEnginesRange());
    expect(engineFloorVersion(NODE_ENGINES_RANGE)).toEqual([22, 0, 0]);

    const below = await nodeCheck("v21.7.3");
    expect(below.state).toBe("fail");
    expect(below.message).toContain(">= 22");

    const at = await nodeCheck("v22.0.0");
    expect(at.state).toBe("ok");
    expect(at.message).toContain(">= 22");
  });

  it.each([
    [">=24", "v23.9.0", "v24.0.0"],
    [">=22.12", "v22.11.0", "v22.12.0"]
  ])("IR-CLI-065 AC-5: under engines %s doctor fails at %s and passes at %s", async (range, below, at) => {
    expect((await nodeCheck(below, range)).state).toBe("fail");
    expect((await nodeCheck(at, range)).state).toBe("ok");
  });
});
