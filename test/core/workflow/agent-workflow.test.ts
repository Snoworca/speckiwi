import { describe, expect, it } from "vitest";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import { summarizeEvidenceWorkflow, summarizeImplementationWorkflow } from "../../../src/core/workflow/implementation-workflow.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

describe("agent workflow guides", () => {
  it("summarizes requirement lookup and evidence update steps", async () => {
    const workspace = await parseWorkspace(await resolveProjectRoot(await copyFixtureWorkspace("valid-basic")));
    const guide = summarizeImplementationWorkflow(workspace, "FR-ARCH-001");
    expect(guide.steps.join(" ")).toContain("docs/spec/00.index.md");
    expect(guide.steps.join(" ")).not.toContain("YAML");
    const evidence = summarizeEvidenceWorkflow(workspace.records[0]!);
    expect(evidence.canMarkVerified).toBe(false);
  });
});
