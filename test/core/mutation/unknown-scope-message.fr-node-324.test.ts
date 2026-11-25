import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../../src/cli/index.js";
import { addRequirement, promoteStepRequirement, type AddRequirementInput } from "../../../src/core/mutation/add-requirement.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";
import { snapshotTree } from "../../support/discarded-target-fixture.js";

// @req FR-NODE-324 AC-1 AC-2 AC-3 — the refusal of an unknown scope says which scopes exist and which
// prefix to use; the prefix stays the only identifier the write takes.

const specTree = (rootPath: string) => snapshotTree(path.join(rootPath, "docs", "spec"));

function input(scope: string): AddRequirementInput {
  return {
    type: "functional",
    scope,
    target: "v1.0.0",
    title: "Scope refusal",
    statement: "The system SHALL keep scopes apart.",
    acceptanceCriteria: ["THE SYSTEM SHALL keep scopes apart."],
    stability: "evolving"
  } as AddRequirementInput;
}

async function refused(scope: string): Promise<string> {
  const rootPath = await copyFixtureWorkspace("mutation-target");
  const before = await specTree(rootPath);
  const result = await addRequirement(await resolveProjectRoot(rootPath), input(scope));
  expect(result.ok).toBe(false);
  expect(result.error?.code).toBe("MUTATION_DENIED");
  expect(await specTree(rootPath)).toEqual(before);
  return result.error?.message ?? "";
}

describe("FR-NODE-324 AC-1 — the refusal lists the registered scopes", () => {
  it("FR-NODE-324 AC-1: an unrelated value is refused with every registered scope as PREFIX (Name)", async () => {
    const message = await refused("Billing");
    expect(message.startsWith("Unknown scope: Billing")).toBe(true);
    expect(message).toContain("ARCH (Product Architecture)");
    expect(message).not.toContain("use its prefix");
  });

  it("FR-NODE-324 AC-1: step promotion to an unknown scope gives the same list", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const dir = path.join(rootPath, "docs", "spec", "steps", "lane-s");
    await mkdir(dir, { recursive: true });
    const block = ["### FR-ZZZ-001 — Step requirement", "", "| Field | Value |", "| --- | --- |", "| Type | functional |", "| Target | v1.0.0 |", "| Status | planned |", "| Priority | medium |", "| Tags | - |", "| Risk | medium |", "| Stability | evolving |", "| Verification Method | test |", "| GitHub Issue | - |", "| Related Docs | - |", "", "#### Requirement", "", "The step SHALL hold one requirement.", "", "#### Acceptance Criteria", "", "- [ ] AC-1: The requirement can be listed.", ""];
    await writeFile(path.join(dir, "10.zzz.srs.md"), ["# Step", "", "| Field | Value |", "|---|---|", "| Document Type | scope_srs |", "| Scope | ZZZ |", "| Scope Name | Zed |", "", "## 4. Requirements", "", ...block].join("\n"), "utf8");
    const result = await promoteStepRequirement(await resolveProjectRoot(rootPath), { id: "FR-ZZZ-001", fromStep: "lane-s", toScope: "ZZZ" });
    expect(result.ok).toBe(false);
    expect(result.error?.message).toContain("Unknown scope: ZZZ");
    expect(result.error?.message).toContain("ARCH (Product Architecture)");
  });
});

describe("FR-NODE-324 AC-2 — a scope's name, slug or prefix in another case gets its prefix named", () => {
  it.each(["Product Architecture", "product architecture", "product-architecture", "arch"])("FR-NODE-324 AC-2: %s is refused with use its prefix ARCH", async (scope) => {
    const message = await refused(scope);
    expect(message).toContain(`Unknown scope: ${scope}`);
    expect(message).toContain("use its prefix ARCH");
  });
});

describe("FR-NODE-324 AC-3 — the --scope help says it takes a prefix", () => {
  it("FR-NODE-324 AC-3: add-requirement --help describes --scope as a scope prefix", async () => {
    const pipes = { stdout: new PassThrough(), stderr: new PassThrough() };
    await main(["add-requirement", "--help"], pipes);
    const help = (pipes.stdout.read()?.toString() ?? "").replace(/\s+/g, " ");
    expect(help).toMatch(/--scope <scope> scope prefix [^-]*USAGE/);
  });
});
