import { describe, expect, it, vi } from "vitest";
import type * as PackageVersion from "../../../src/core/package-version.js";
import { diagnoseHealth } from "../../../src/core/health/doctor.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

// @req IR-CLI-065 AC-5 — the default path, with no range injected, must read the package's declared floor.
// The package module is stood in with a different range, so a floor written into doctor (22, or a
// re-parse of ">=22") disagrees with it and this case turns red.

vi.mock("../../../src/core/package-version.js", async (original) => {
  const actual = await original<typeof PackageVersion>();
  return { ...actual, NODE_ENGINES_RANGE: ">=24", NODE_FLOOR: actual.parseNodeFloor(">=24") };
});

async function nodeCheck(nodeVersion: string) {
  const workspace = await parseWorkspace(await resolveProjectRoot(await copyFixtureWorkspace("valid-basic")));
  const report = await diagnoseHealth(workspace, { nodeVersion });
  const check = report.checks.find((candidate) => candidate.topic === "Node version");
  if (!check) throw new Error("no Node version check");
  return check;
}

describe("IR-CLI-065 AC-5 — doctor's default floor is the package's engines.node", () => {
  it("IR-CLI-065 AC-5: with the package declaring >=24, doctor fails at Node 22 and passes at 24", async () => {
    const at22 = await nodeCheck("v22.0.0");
    expect(at22.state).toBe("fail");
    expect(at22.message).toContain(">= 24");
    expect((await nodeCheck("v24.0.0")).state).toBe("ok");
  });
});
