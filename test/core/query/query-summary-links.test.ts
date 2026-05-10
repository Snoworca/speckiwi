import { describe, expect, it } from "vitest";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import { checkLinks } from "../../../src/core/query/links.js";
import { getRequirement, listRequirements } from "../../../src/core/query/lookup.js";
import { isNewWorkCandidate, summarizeTarget } from "../../../src/core/query/summary.js";
import type { ParsedWorkspace, RequirementRecord } from "../../../src/core/types.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

function requirementVariant(base: RequirementRecord, id: string, status: RequirementRecord["status"], stability: NonNullable<RequirementRecord["stability"]>): RequirementRecord {
  return {
    ...base,
    id,
    title: `${id} fixture`,
    status,
    stability,
    metadata: { ...base.metadata, Status: status, Stability: stability }
  };
}

function withRecords(workspace: ParsedWorkspace, records: RequirementRecord[]): ParsedWorkspace {
  return { ...workspace, records };
}

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

  it("summarizes stability fields and deterministic new-work candidates", async () => {
    const workspace = await parseWorkspace(await resolveProjectRoot(await copyFixtureWorkspace("valid-basic")));
    const base = workspace.records[0];
    const records = [
      requirementVariant(base, "FR-ARCH-001", "planned", "stable"),
      requirementVariant(base, "FR-ARCH-002", "planned", "draft"),
      requirementVariant(base, "FR-ARCH-003", "blocked", "deprecated"),
      requirementVariant(base, "FR-ARCH-004", "in_progress", "volatile"),
      requirementVariant(base, "FR-ARCH-005", "implemented", "stable"),
      requirementVariant(base, "FR-ARCH-006", "discarded", "draft")
    ];
    const expanded = withRecords(workspace, records);

    expect(listRequirements(expanded, { status: "planned" }).map((record) => record.id)).toEqual(["FR-ARCH-001", "FR-ARCH-002"]);
    expect(listRequirements(expanded, { status: "blocked" }).map((record) => record.id)).toEqual(["FR-ARCH-003"]);
    expect(getRequirement(expanded, "FR-ARCH-003")).toMatchObject({ id: "FR-ARCH-003", stability: "deprecated" });
    expect(isNewWorkCandidate(records[0])).toBe(true);
    expect(isNewWorkCandidate(records[1])).toBe(false);
    expect(isNewWorkCandidate(records[2])).toBe(false);
    expect(isNewWorkCandidate(records[4])).toBe(false);
    expect(isNewWorkCandidate(records[5])).toBe(false);

    expect(summarizeTarget(expanded)).toMatchObject({
      countsByStability: { stable: 2, draft: 2, deprecated: 1, volatile: 1 },
      draftRequirements: ["FR-ARCH-002", "FR-ARCH-006"],
      deprecatedRequirements: ["FR-ARCH-003"],
      stabilityBlockers: ["FR-ARCH-002", "FR-ARCH-003"],
      stabilityWarnings: ["FR-ARCH-004"],
      newWorkCandidates: ["FR-ARCH-001", "FR-ARCH-004"],
      implementedNotVerified: ["FR-ARCH-005"]
    });
  });

  it("checks local links and requirement references without network calls", async () => {
    const workspace = await parseWorkspace(await resolveProjectRoot(await copyFixtureWorkspace("valid-basic")));
    const result = await checkLinks(workspace);
    expect(result.checked).toBeGreaterThan(0);
    expect(result.networkAccess).toBe(false);
  });
});
