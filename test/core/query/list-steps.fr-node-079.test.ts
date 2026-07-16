import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { listSteps } from "../../../src/core/query/list-steps.js";
import { createMcpServer } from "../../../src/mcp/server.js";

// FR-NODE-079 — listSteps exposes SDS design visibility.
//
// Red-phase suite: one test case per acceptance criterion (AC-1..AC-4). The suite
// fails while StepListEntry carries only step/status/dependsOn, until the green
// step loads each step's design.md (loadStepDesign) and surfaces sdsPresent plus
// the metadata-table Status value as sdsStatus.
//
// Contract under test (docs/spec/50.nodejs-implementation.srs.md FR-NODE-079):
//   - AC-1: design.md with `| Status | draft |` → sdsPresent=true, sdsStatus="draft".
//   - AC-2: no design.md → sdsPresent=false, no sdsStatus.
//   - AC-3: design.md without a Status row → sdsPresent=true, no sdsStatus.
//   - AC-4: the MCP list_steps tool returns the new fields.

const SCOPE_FILE = "50.nodejs-implementation.srs.md";

function renderIndexDocument(): string {
  return [
    "# SpecKiwi SDS Visibility Fixture Index",
    "",
    "| Field | Value |",
    "|---|---|",
    "| Document Type | srs_index |",
    "| Product | SpecKiwi |",
    "| Product Version | 3.0.0 |",
    "| Active Target | v3.0.0 |",
    "| Status | baseline |",
    "",
    "## 1. Purpose",
    "",
    "SDS visibility fixture index.",
    "",
    "## 2. SRS Documents",
    "",
    "| Scope | Document | Prefix | Description |",
    "|---|---|---|---|",
    `| Node.js Implementation | [${SCOPE_FILE}](./${SCOPE_FILE}) | NODE | Node |`,
    "",
    "## 3. Target Map",
    "",
    "| Target | Type | Status | Description |",
    "|---|---|---|---|",
    "| v3.0.0 | release | active | Fixture release |",
    "",
    "## 4. Scope Map",
    "",
    "| Scope | Document | Prefix | Description |",
    "|---|---|---|---|",
    `| Node.js Implementation | [${SCOPE_FILE}](./${SCOPE_FILE}) | NODE | Node |`,
    "",
    "## 5. Completed Work Log",
    "",
    "| Date | Target | Scope | Requirement IDs | Summary |",
    "|---|---|---|---|---|",
    ""
  ].join("\n");
}

function renderScopeDocument(): string {
  return [
    "# Node.js Implementation",
    "",
    "| Field | Value |",
    "|---|---|",
    "| Document Type | scope_srs |",
    "| Scope | NODE |",
    "| Scope Name | Node.js Implementation |",
    "",
    "## 1. Scope Overview",
    "",
    "SDS visibility fixture.",
    "",
    "## 2. Scope Boundaries",
    "",
    "### In Scope",
    "",
    "- Markdown requirements",
    "",
    "### Out of Scope",
    "",
    "- None",
    "",
    "## 3. Assumptions and Constraints",
    "",
    "- None",
    "",
    "## 4. Requirements",
    "",
    ""
  ].join("\n");
}

function renderStateDocument(steps: string[]): string {
  const rendered = steps.map((step) => `| ${step} | active | - | NODE | - | 2026-06-01 | 2026-06-02 |`);
  return [
    "# Step State",
    "",
    "Mode: tdd",
    "",
    "| Step | Status | DependsOn | TouchesScope | TouchesReq | Created | Updated |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...rendered,
    ""
  ].join("\n");
}

function renderDesign(options: { status?: string } = {}): string {
  return [
    "# SDS: fixture design",
    "",
    "| Field | Value |",
    "|---|---|",
    "| Document Type | sds |",
    "| Task | fixture |",
    "| Target | v3.0.0 |",
    ...(options.status !== undefined ? [`| Status | ${options.status} |`] : []),
    "| Date | 2026-07-16 |",
    "",
    "## 1. Context & Scope",
    "",
    "Fixture context.",
    ""
  ].join("\n");
}

async function buildWorkspace(steps: Array<{ name: string; design?: { status?: string } }>): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "speckiwi-fr-node-079-"));
  const specDir = path.join(root, "docs", "spec");
  await mkdir(specDir, { recursive: true });
  await writeFile(path.join(specDir, "00.index.md"), renderIndexDocument(), "utf8");
  await writeFile(path.join(specDir, SCOPE_FILE), renderScopeDocument(), "utf8");
  const stepsDir = path.join(specDir, "steps");
  await mkdir(stepsDir, { recursive: true });
  await writeFile(path.join(stepsDir, "state.md"), renderStateDocument(steps.map((s) => s.name)), "utf8");
  for (const step of steps) {
    if (step.design) {
      const stepDir = path.join(stepsDir, step.name);
      await mkdir(stepDir, { recursive: true });
      await writeFile(path.join(stepDir, "design.md"), renderDesign(step.design), "utf8");
    }
  }
  return root;
}

describe("FR-NODE-079 — listSteps SDS design visibility", () => {
  it("FR-NODE-079 AC-1: a design.md with a Status metadata row reports sdsPresent=true and sdsStatus", async () => {
    const root = await buildWorkspace([{ name: "step-with-sds", design: { status: "draft" } }]);

    const result = await listSteps({ root });

    const entry = result.steps.find((step) => step.step === "step-with-sds");
    expect(entry).toBeDefined();
    expect(entry?.sdsPresent).toBe(true);
    expect(entry?.sdsStatus).toBe("draft");
  });

  it("FR-NODE-079 AC-2: a step without design.md reports sdsPresent=false and no sdsStatus", async () => {
    const root = await buildWorkspace([{ name: "step-bare" }]);

    const result = await listSteps({ root });

    const entry = result.steps.find((step) => step.step === "step-bare");
    expect(entry).toBeDefined();
    expect(entry?.sdsPresent).toBe(false);
    expect(entry?.sdsStatus).toBeUndefined();
  });

  it("FR-NODE-079 AC-3: a design.md without a Status metadata row reports sdsPresent=true and no sdsStatus", async () => {
    const root = await buildWorkspace([{ name: "step-no-status", design: {} }]);

    const result = await listSteps({ root });

    const entry = result.steps.find((step) => step.step === "step-no-status");
    expect(entry).toBeDefined();
    expect(entry?.sdsPresent).toBe(true);
    expect(entry?.sdsStatus).toBeUndefined();
  });

  it("FR-NODE-079 AC-4: the MCP list_steps tool returns the new SDS fields", async () => {
    const root = await buildWorkspace([
      { name: "step-with-sds", design: { status: "agreed" } },
      { name: "step-bare" }
    ]);
    const server = createMcpServer({ root });

    const result = (await server.callTool("list_steps", {})) as {
      ok: boolean;
      value: { steps: Array<{ step: string; sdsPresent?: boolean; sdsStatus?: string }> };
    };

    expect(result.ok).toBe(true);
    const withSds = result.value.steps.find((step) => step.step === "step-with-sds");
    const bare = result.value.steps.find((step) => step.step === "step-bare");
    expect(withSds?.sdsPresent).toBe(true);
    expect(withSds?.sdsStatus).toBe("agreed");
    expect(bare?.sdsPresent).toBe(false);
    expect(bare?.sdsStatus).toBeUndefined();
  });
});
