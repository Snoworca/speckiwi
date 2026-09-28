import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterAll, describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { createMcpServer } from "../../src/mcp/server.js";
import { cleanupFixtures, gitWorkspaceRepo, linkedWorktree } from "./support/workspace-root-fixture.js";

// FR-MCP-066 AC-1 / FR-MCP-064 AC-7 — check_test_sufficiency declares no path exemption, so under an
// accepted per-call workspaceRoot every argument it takes is scanned for a docs/spec destination. A
// full-profile step SDS lives at docs/spec/steps/<task>/design.md (FR-NODE-210 AC-6), so that input is
// refused there and answered only without a per-call root — where the CLI answers it the same way.

interface Answer {
  ok: boolean;
  value?: unknown;
  error?: { code?: string; reason?: string };
  diagnostics?: Array<{ details?: Record<string, unknown> }>;
  mcpWorkspace?: { workspaceRoot?: string; rootSource?: string };
}

const STEP = "alpha";
const STEP_SDS = `docs/spec/steps/${STEP}/design.md`;

const STEP_REQUIREMENT = [
  "# Step SRS: alpha",
  "",
  "## Requirements",
  "",
  "### FR-ARCH-050 — Step requirement awaiting promotion",
  "",
  "| Field | Value |",
  "| --- | --- |",
  "| Type | functional |",
  "| Target | v1.0.0 |",
  "| Status | implemented |",
  "| Priority | medium |",
  "| Tags | - |",
  "| Risk | low |",
  "| Stability | evolving |",
  "| Verification Method | test |",
  "| GitHub Issue | - |",
  "| Related Docs | - |",
  "",
  "#### Requirement",
  "",
  "The step SHALL be checked before it is promoted.",
  "",
  "#### Rationale",
  "",
  "-",
  "",
  "#### Acceptance Criteria",
  "",
  "- [ ] AC-1: The first criterion.",
  "",
  "#### Verification Evidence",
  "",
  "| Evidence ID | Type | Reference | Covers | Notes |",
  "| --- | --- | --- | --- | --- |",
  "",
  "#### Trace Links",
  "",
  "| Type | Reference | Relation | Notes |",
  "| --- | --- | --- | --- |",
  "",
  "#### Research / Analysis",
  "",
  "- -",
  "",
  "#### Implementation Notes",
  "",
  "- -",
  "",
  "#### Change Notes",
  "",
  "| Date | Change | Reason |",
  "| --- | --- | --- |",
  "| 2026-09-27 | Created | fixture |",
  ""
].join("\n");

const FULL_PROFILE_DESIGN = [
  "# SDS: alpha",
  "",
  "| Field | Value |",
  "|---|---|",
  "| Document Type | sds |",
  "| Task | alpha |",
  "| Target | v1.0.0 |",
  "| Status | agreed |",
  "| Date | 2026-09-27 |",
  "",
  "## 1. Context & Scope",
  "",
  "-",
  "",
  "## 2. Goals / Non-goals",
  "",
  "- Goal: -",
  "",
  "## 3. Architecture Decisions",
  "",
  "- none",
  "",
  "## 4. Interfaces",
  "",
  "- `check(): void` — checks",
  "",
  "## 5. Acceptance Contracts",
  "",
  "- SDS-AC-1: WHEN the step is checked THE SYSTEM SHALL answer.",
  "",
  "## 6. Test Plan",
  "",
  "| SDS-AC | Test file (planned) | Case summary |",
  "|---|---|---|",
  "| SDS-AC-1 | test/step.test.ts | answers |",
  "",
  "## 7. Open Questions",
  "",
  "- (none)",
  ""
].join("\n");

async function put(root: string, relative: string, text: string): Promise<void> {
  await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
  await writeFile(path.join(root, relative), text, "utf8");
}

async function seedStep(root: string): Promise<void> {
  await put(root, `docs/spec/steps/${STEP}/${STEP}.srs.md`, STEP_REQUIREMENT);
  await put(root, STEP_SDS, FULL_PROFILE_DESIGN);
  await put(root, "test/step.test.ts", "it('FR-ARCH-050 AC-1 SDS-AC-1', () => {});\n");
}

async function cli(root: string, ...args: string[]): Promise<unknown> {
  const streams = { stdout: new PassThrough(), stderr: new PassThrough() };
  await main(["--root", root, "coverage", "--tests", "--json", ...args], streams);
  return JSON.parse((streams.stdout as unknown as PassThrough).read()?.toString() ?? "") as unknown;
}

async function hostAndWorktree(prefix: string): Promise<{ host: string; worktree: string }> {
  const host = await gitWorkspaceRepo(`${prefix}-host`);
  const worktree = await linkedWorktree(host, `${prefix}-wt`, prefix);
  await seedStep(host);
  await seedStep(worktree);
  return { host, worktree };
}

afterAll(async () => {
  await cleanupFixtures();
});

describe("check_test_sufficiency — a docs/spec step SDS under a per-call workspaceRoot", { timeout: 120_000 }, () => {
  it("FR-MCP-066 AC-1: a full-profile step SDS under docs/spec is refused under a per-call workspaceRoot and answered, as the CLI answers it, without one", async () => {
    const { host, worktree } = await hostAndWorktree("fr-mcp-066-spec-sds");
    const server = createMcpServer({ root: host });
    const designBefore = await readFile(path.join(worktree, ...STEP_SDS.split("/")), "utf8");

    const refused = (await server.callTool("check_test_sufficiency", { ids: ["FR-ARCH-050"], sds: STEP_SDS, workspaceRoot: worktree })) as Answer;
    expect(refused.ok).toBe(false);
    expect(refused.error).toMatchObject({ code: "MCP_WORKSPACE_ROOT_REFUSED", reason: "workspace-root-forbidden-for-srs" });
    expect(refused.diagnostics?.[0]?.details?.destination, "the refusal names the sds argument").toBe(STEP_SDS);
    expect(refused.value, "a refused call carries no coverage answer").toBeUndefined();
    expect(await readFile(path.join(worktree, ...STEP_SDS.split("/")), "utf8")).toBe(designBefore);

    // The same per-call root answers once the docs/spec argument is gone, so the refusal is the sds input's.
    const withoutSds = (await server.callTool("check_test_sufficiency", { ids: ["FR-ARCH-050"], workspaceRoot: worktree })) as Answer;
    expect(withoutSds.ok).toBe(true);
    expect(withoutSds.mcpWorkspace?.rootSource).toBe("per-call-workspace-root");

    // Without a per-call root the same input is answered, and the answer is the CLI's (the route AC-1 names).
    const answered = (await server.callTool("check_test_sufficiency", { ids: ["FR-ARCH-050"], sds: STEP_SDS })) as Answer;
    expect(answered.ok).toBe(true);
    expect(answered.mcpWorkspace?.rootSource).toBe("server-cwd-discovery");
    expect(answered.value).toEqual(await cli(host, "--ids", "FR-ARCH-050", "--sds", STEP_SDS));
    // The worktree's own CLI answers that input too — the route a caller in that workspace takes.
    expect(await cli(worktree, "--ids", "FR-ARCH-050", "--sds", STEP_SDS)).toMatchObject({
      sdsContracts: [{ sdsAcId: "SDS-AC-1", cited: true }]
    });
  });

  it("FR-MCP-064 AC-7: check_test_sufficiency, declaring no path, has every argument scanned under an accepted per-call workspaceRoot", async () => {
    const { host, worktree } = await hostAndWorktree("fr-mcp-064-ac7-scan");
    const server = createMcpServer({ root: host });
    const absoluteSds = path.join(worktree, "docs", "spec", "steps", STEP, "design.md");

    const probes: Array<[string, Record<string, unknown>]> = [
      ["relative sds", { ids: ["FR-ARCH-050"], sds: STEP_SDS }],
      ["absolute sds", { ids: ["FR-ARCH-050"], sds: absoluteSds }],
      ["testGlob, an argument not named as a path", { target: "v1.0.0", testGlob: ["docs/spec/**"] }]
    ];
    for (const [label, input] of probes) {
      const refused = (await server.callTool("check_test_sufficiency", { ...input, workspaceRoot: worktree })) as Answer;
      expect(refused.ok, label).toBe(false);
      expect(refused.error, label).toMatchObject({ code: "MCP_WORKSPACE_ROOT_REFUSED", reason: "workspace-root-forbidden-for-srs" });
    }

    // A declaring SRS query, by contrast, filters on a docs/spec reference under the same root.
    const filtered = (await server.callTool("list_requirements", {
      workspaceRoot: worktree,
      relatedDoc: "docs/spec/10.product-architecture.srs.md",
      projection: "ids"
    })) as Answer;
    expect(filtered.error?.reason).toBeUndefined();
    expect(filtered.mcpWorkspace?.rootSource).toBe("per-call-workspace-root");
  });
});
