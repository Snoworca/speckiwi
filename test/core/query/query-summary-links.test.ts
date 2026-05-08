import { describe, expect, it } from "vitest";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import { checkLinks } from "../../../src/core/query/links.js";
import { getRequirement, listRequirements } from "../../../src/core/query/lookup.js";
import { summarizeTarget } from "../../../src/core/query/summary.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

describe("query services", () => {
  it("lists, filters, looks up, and summarizes requirements", async () => {
    const workspace = await parseWorkspace(await resolveProjectRoot(await copyFixtureWorkspace("valid-basic")));

    expect(listRequirements(workspace, { target: "v1.0.0" }).map((r) => r.id)).toContain("FR-ARCH-001");
    expect(listRequirements(workspace, { status: "planned" }).length).toBeGreaterThan(0);
    const detail = getRequirement(workspace, "FR-ARCH-001", { includeMarkdown: true });
    expect(detail.markdown).toContain("### FR-ARCH-001");
    expect(detail.requirement).toContain("SpecKiwi must parse");
    expect(summarizeTarget(workspace).target).toBe("v1.0.0");
  });

  it("checks local links and requirement references without network calls", async () => {
    const workspace = await parseWorkspace(await resolveProjectRoot(await copyFixtureWorkspace("valid-basic")));
    const result = await checkLinks(workspace);
    expect(result.checked).toBeGreaterThan(0);
    expect(result.networkAccess).toBe(false);
  });
});
