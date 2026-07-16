import { rm } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { diagnoseHealth } from "../../../src/core/health/doctor.js";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import { renderIndexTemplate } from "../../../src/core/bootstrap/templates.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

// FR-NODE-082 — health doctor checks SDS authoring rules installation.
//
// Red-phase suite: one test case per acceptance criterion (AC-1..AC-3). The suite
// fails while diagnoseHealth carries no SDS-rules check, until the green step adds
// the existence-only check (warn + init remediation when the bundled SDS rules
// document is missing from the workspace).
//
// Contract under test (docs/spec/50.nodejs-implementation.srs.md FR-NODE-082):
//   - AC-1: missing docs/rule/SDS-MD-Rules-v1.0.0.md → warn with an init remediation.
//   - AC-2: present → ok.
//   - AC-3: existence-only — the index template gains no SDS rules row.

const SDS_RULES_REL = path.join("docs", "rule", "SDS-MD-Rules-v1.0.0.md");

async function healthChecks(root: string) {
  const workspace = await parseWorkspace({ root });
  return (await diagnoseHealth(workspace)).checks;
}

describe("FR-NODE-082 — doctor SDS rules installation check", () => {
  it("FR-NODE-082 AC-1: a workspace without the SDS rules file warns with an init remediation", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    await rm(path.join(root, SDS_RULES_REL), { force: true });

    const checks = await healthChecks(root);
    const check = checks.find((entry) => /SDS/i.test(entry.label));

    expect(check, "diagnoseHealth must include an SDS rules check").toBeDefined();
    expect(check?.state).toBe("warn");
    expect(check?.remediation).toMatch(/speckiwi init/);
  });

  it("FR-NODE-082 AC-2: a workspace with the SDS rules file reports ok", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    // Install the SDS rules file where init would place it.
    const { mkdir, writeFile } = await import("node:fs/promises");
    await mkdir(path.join(root, "docs", "rule"), { recursive: true });
    await writeFile(path.join(root, SDS_RULES_REL), "# SDS-MD Authoring Rules v1.0.0\n", "utf8");

    const checks = await healthChecks(root);
    const check = checks.find((entry) => /SDS/i.test(entry.label));

    expect(check).toBeDefined();
    expect(check?.state).toBe("ok");
  });

  it("FR-NODE-082 AC-3: the index template gains no SDS rules row (existence-only check)", () => {
    const template = renderIndexTemplate();
    expect(template).not.toMatch(/SDS-MD-Rules/);
  });
});
