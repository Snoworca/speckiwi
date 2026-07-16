import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { toolSpecs, assertZeroDriftToolSurface } from "../../src/mcp/schemas.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

// IR-CLI-074 — step claim/update-state/promote CLI mirrors with registry relocation.
//
// Red-phase suite: one test case per acceptance criterion (AC-1..AC-4). The suite
// fails while the step container only exposes `validate` (commander rejects the
// unknown subcommands) until the green step wires the three CLI mirrors to the
// existing core mutations claimStep / updateStepState / promoteStepRequirement
// and relocates their mcpNames onto the new dedicated registry leaves.
//
// Contract under test (docs/spec/30.cli-interface.srs.md IR-CLI-074):
//   - AC-1: `step claim` appends the state.md row via core claimStep (exit 0/5).
//   - AC-2: `step update-state` rewrites the step row via core updateStepState.
//   - AC-3: `step promote` reaches core promoteStepRequirement with the
//           FR-NODE-074 evidence gate intact.
//   - AC-4: registry relocation — the three mcpNames live on the step leaves and
//           the former host rows carry no mcpName.

function io() {
  return { stdout: new PassThrough() as NodeJS.WriteStream, stderr: new PassThrough() as NodeJS.WriteStream };
}

function drain(stream: NodeJS.WriteStream): string {
  return (stream as unknown as PassThrough).read()?.toString() ?? "";
}

const SPEC_DIR = path.join("docs", "spec");
const REQ_ID = "FR-ARCH-001"; // exists in the valid-basic fixture

async function writeStateMd(root: string, options: { mode?: string; rows?: string[] } = {}): Promise<void> {
  const stepsDir = path.join(root, SPEC_DIR, "steps");
  await mkdir(stepsDir, { recursive: true });
  const lines = [
    "# Step State",
    "",
    `Mode: ${options.mode ?? "sdd"}`,
    "",
    "| Step | Status | DependsOn | TouchesScope | TouchesReq | Created | Updated |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...(options.rows ?? []),
    ""
  ];
  await writeFile(path.join(stepsDir, "state.md"), lines.join("\n"), "utf8");
}

async function stateText(root: string): Promise<string> {
  return readFile(path.join(root, SPEC_DIR, "steps", "state.md"), "utf8");
}

/** ARCH-scope step SRS file carrying one promotable requirement block (empty evidence table). */
async function writeStepScopeFile(root: string, stepName: string, id: string): Promise<void> {
  const stepDir = path.join(root, SPEC_DIR, "steps", stepName);
  await mkdir(stepDir, { recursive: true });
  const content = [
    "# Step Architecture",
    "",
    "| Field | Value |",
    "|---|---|",
    "| Document Type | scope_srs |",
    "| Scope | ARCH |",
    "| Scope Name | Product Architecture |",
    "",
    "## 4. Requirements",
    "",
    `### ${id} — Promotable step requirement`,
    "",
    "| Field | Value |",
    "| --- | --- |",
    "| Type | functional |",
    "| Target | v1.0.0 |",
    "| Status | planned |",
    "| Priority | high |",
    "| Tags | step, fixture |",
    "| Risk | low |",
    "| Stability | evolving |",
    "| Verification Method | test |",
    "| GitHub Issue | - |",
    "| Related Docs | - |",
    "",
    "#### Requirement",
    "",
    `Step-scoped requirement ${id}.`,
    "",
    "#### Rationale",
    "",
    "- -",
    "",
    "#### Acceptance Criteria",
    "",
    "- [ ] AC-1: Step criterion.",
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
    "| 2026-06-04 | Created | Fixture |"
  ].join("\n");
  await writeFile(path.join(stepDir, "10.product-architecture.srs.md"), content, "utf8");
}

describe("IR-CLI-074 — step claim/update-state/promote CLI mirrors", () => {
  it("IR-CLI-074 AC-1: step claim appends the state.md row via core claimStep", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    await writeStateMd(root);

    const streams = io();
    const code = await main(
      ["--root", root, "step", "claim", "feature-x", "--touches-scope", "ARCH", "--touches-req", REQ_ID, "--json"],
      streams
    );

    expect(code).toBe(0);
    const output = JSON.parse(drain(streams.stdout));
    expect(output.ok).toBe(true);
    const after = await stateText(root);
    expect(after).toMatch(/\|\s*feature-x\s*\|\s*active\s*\|.*\|\s*ARCH\s*\|\s*FR-ARCH-001\s*\|/);

    // The core write-skew gate is reached (exit 5, nothing written): a direct
    // TouchesReq conflict with the incumbent row HARD-BLOCKs.
    const blocked = io();
    const blockedCode = await main(
      ["--root", root, "step", "claim", "challenger", "--touches-scope", "ARCH", "--touches-req", REQ_ID, "--json"],
      blocked
    );
    expect(blockedCode).toBe(5);
    const blockedOutput = JSON.parse(drain(blocked.stdout));
    expect(blockedOutput).toMatchObject({ ok: false, error: { code: "STEP_DIRECT_CONFLICT" } });
    expect(await stateText(root)).not.toContain("challenger");
  });

  it("IR-CLI-074 AC-2: step update-state rewrites the step row via core updateStepState", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    await writeStateMd(root, {
      rows: ["| feature-y | active | - | ARCH | FR-ARCH-001 | 2026-06-01 | 2026-06-02 |"]
    });

    const streams = io();
    const code = await main(["--root", root, "step", "update-state", "feature-y", "--status", "merging", "--json"], streams);

    expect(code).toBe(0);
    const output = JSON.parse(drain(streams.stdout));
    expect(output.ok).toBe(true);
    expect(await stateText(root)).toMatch(/\|\s*feature-y\s*\|\s*merging\s*\|/);

    // The core enum guard is reached (exit 5): an out-of-enum status is rejected.
    const bad = io();
    const badCode = await main(["--root", root, "step", "update-state", "feature-y", "--status", "bogus", "--json"], bad);
    expect(badCode).toBe(5);
    expect(JSON.parse(drain(bad.stdout))).toMatchObject({ ok: false, error: { code: "INVALID_STATUS" } });

    // --depends-on rewrites the DependsOn cell through the same core mutation.
    const deps = io();
    const depsCode = await main(
      ["--root", root, "step", "update-state", "feature-y", "--depends-on", "feature-x", "--json"],
      deps
    );
    expect(depsCode).toBe(0);
    expect(await stateText(root)).toMatch(/\|\s*feature-y\s*\|\s*merging\s*\|\s*feature-x\s*\|/);
  });

  it("IR-CLI-074 AC-3: step promote reaches core promoteStepRequirement with the evidence gate intact", async () => {
    // tdd work-mode + evidence-less step block → the FR-NODE-074 gate refuses with
    // EVIDENCE_REQUIRED (exit 5), proving the CLI reaches the real core mutation.
    const root = await copyFixtureWorkspace("valid-basic");
    await writeStateMd(root, { mode: "tdd" });
    const STEP_ID = "FR-ARCH-501";
    await writeStepScopeFile(root, "feature-x", STEP_ID);

    const gated = io();
    const gatedCode = await main(
      ["--root", root, "step", "promote", STEP_ID, "--from-step", "feature-x", "--to-scope", "ARCH", "--json"],
      gated
    );
    expect(gatedCode).toBe(5);
    expect(JSON.parse(drain(gated.stdout))).toMatchObject({ ok: false, error: { code: "EVIDENCE_REQUIRED" } });

    // Outside tdd mode the same promote succeeds and inserts the id into the body scope.
    await writeStateMd(root, { mode: "sdd" });
    const streams = io();
    const code = await main(
      ["--root", root, "step", "promote", STEP_ID, "--from-step", "feature-x", "--to-scope", "ARCH", "--json"],
      streams
    );
    expect(code).toBe(0);
    const output = JSON.parse(drain(streams.stdout));
    expect(output.ok).toBe(true);
    const bodyText = await readFile(path.join(root, SPEC_DIR, "10.product-architecture.srs.md"), "utf8");
    expect(bodyText).toContain(`### ${STEP_ID} `);
  });

  it("IR-CLI-074 AC-4: registry relocation puts the three mcpNames on the step leaves", () => {
    const byCli = new Map(toolSpecs.map((spec) => [spec.cliName, spec] as const));

    expect(byCli.get("claim")?.mcpName).toBe("claim_step");
    expect(byCli.get("update-state")?.mcpName).toBe("update_step_state");
    expect(byCli.get("promote")?.mcpName).toBe("promote_step_requirement");

    // The former host rows are CLI-only again.
    expect(byCli.get("set-supersede")?.mcpName).toBeUndefined();
    expect(byCli.get("scaffold-scope")?.mcpName).toBeUndefined();
    expect(byCli.get("register-scopes")?.mcpName).toBeUndefined();

    expect(() => assertZeroDriftToolSurface()).not.toThrow();
  });
});
