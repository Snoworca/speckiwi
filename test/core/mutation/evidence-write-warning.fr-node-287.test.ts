import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterAll, describe, expect, it, vi } from "vitest";
import { main } from "../../../src/cli/index.js";
import { addVerificationEvidence } from "../../../src/core/mutation/add-evidence.js";
import { addRequirement, promoteStepRequirement } from "../../../src/core/mutation/add-requirement.js";
import { editRequirementTableRows } from "../../../src/core/mutation/edit-requirement.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import type { ProjectRoot } from "../../../src/core/types.js";
import { createMcpServer } from "../../../src/mcp/server.js";
import { cleanupFixtures, gitWorkspaceRepo, rawGit } from "../../mcp/support/workspace-root-fixture.js";

// @req FR-NODE-287 AC-5 — every writer of an evidence row warns as add_verification_evidence does.
//
// OG (2026-11-21, verdict cases J and K): add_requirement (not verified) and edit_requirement_table_rows
// wrote a reference the verified transition later refused, and said nothing when they wrote it.

vi.setConfig({ testTimeout: 60_000 });

afterAll(async () => {
  await cleanupFixtures();
});

const ID = "FR-ARCH-001";
const PRESENT = "src/a.md";
const MISSING = "docs/decisions/웹서버-교체/없음.md:3";

async function workspace(): Promise<ProjectRoot> {
  const directory = await gitWorkspaceRepo("fr-node-287w-");
  const root = await resolveProjectRoot(directory);
  expect(path.resolve(root.root)).toBe(path.resolve(directory));
  expect(path.resolve(await rawGit(directory, "rev-parse", "--show-toplevel"))).toBe(path.resolve(directory));
  await mkdir(path.join(directory, "src"), { recursive: true });
  await writeFile(path.join(directory, PRESENT), "line 1\nline 2\n");
  return root;
}

type Diagnostics = ReadonlyArray<{ code: string; message: string }>;

/** The W082 message with its requirement id taken out, so two writers can be compared. */
function w082(diagnostics: Diagnostics, id: string): string | undefined {
  return diagnostics.find((entry) => entry.code === "SRS-W082")?.message.replace(id, "<id>");
}

/** What add_verification_evidence says about the same reference: the message every other writer must match. */
async function referenceWarning(reference: string): Promise<string | undefined> {
  const root = await workspace();
  const answer = await addVerificationEvidence(root, { id: ID, type: "test", reference });
  expect(answer.ok).toBe(true);
  return answer.ok ? w082(answer.diagnostics, ID) : undefined;
}

function requirementInput(reference: string, status = "implemented") {
  return {
    type: "functional",
    scope: "ARCH",
    target: "v1.0.0",
    title: "Evidence warning fixture",
    statement: "The fixture SHALL hold.",
    acceptanceCriteria: ["THE fixture SHALL hold."],
    status,
    evidence: [{ type: "test", reference, covers: "AC-1", notes: "-" }]
  };
}

async function cli(root: ProjectRoot, args: string[]): Promise<{ ok: boolean; diagnostics?: Diagnostics; value?: { requirementId?: string } }> {
  const streams = { stdout: new PassThrough(), stderr: new PassThrough() };
  await main(["--root", root.root, ...args, "--json"], streams);
  return JSON.parse(streams.stdout.read()?.toString() ?? "{}");
}

describe("FR-NODE-287 AC-5 — add_requirement warns on an unresolved evidence reference", () => {
  // @req FR-NODE-287 AC-5
  it("writes the requirement and returns the warning add_verification_evidence returns", async () => {
    const expected = await referenceWarning(MISSING);
    expect(expected).toBeDefined();
    const root = await workspace();
    const created = await addRequirement(root, requirementInput(MISSING));
    expect(created.ok, JSON.stringify(created)).toBe(true);
    if (!created.ok) return;
    expect(created.value.written).toBe(true);
    expect(w082(created.diagnostics, created.value.requirementId)).toBe(expected);
  });

  // @req FR-NODE-287 AC-5
  it("returns no warning for a reference that resolves", async () => {
    const root = await workspace();
    const created = await addRequirement(root, requirementInput(`${PRESENT}:1,2`));
    expect(created.ok).toBe(true);
    if (created.ok) expect(created.diagnostics.map((entry) => entry.code)).not.toContain("SRS-W082");
  });

  // @req FR-NODE-287 AC-5
  it("warns through the CLI and MCP", async () => {
    const root = await workspace();
    const viaCli = await cli(root, ["add-requirement", "--type", "functional", "--scope", "ARCH", "--target", "v1.0.0", "--title", "CLI fixture", "--statement", "The fixture SHALL hold.", "--ac", "THE fixture SHALL hold.", "--status", "implemented", "--evidence", `test|${MISSING}|AC-1|-`]);
    expect(viaCli.ok, JSON.stringify(viaCli)).toBe(true);
    expect((viaCli.diagnostics ?? []).map((entry) => entry.code)).toContain("SRS-W082");
    const viaMcp = (await createMcpServer({ root: root.root }).callTool("add_requirement", requirementInput(MISSING))) as { ok: boolean; diagnostics: Diagnostics };
    expect(viaMcp.ok).toBe(true);
    expect(viaMcp.diagnostics.map((entry) => entry.code)).toContain("SRS-W082");
  });
});

describe("FR-NODE-287 AC-5 — edit_requirement_table_rows warns on an unresolved evidence reference", () => {
  async function withRow(): Promise<ProjectRoot> {
    const root = await workspace();
    expect((await addVerificationEvidence(root, { id: ID, type: "test", reference: PRESENT })).ok).toBe(true);
    return root;
  }

  // @req FR-NODE-287 AC-5
  it("writes the new reference and returns the warning add_verification_evidence returns", async () => {
    const expected = await referenceWarning(MISSING);
    const root = await withRow();
    const edited = await editRequirementTableRows(root, { id: ID, section: "verification_evidence", operations: [{ kind: "update", rowId: "VE-1", values: { reference: MISSING } }] });
    expect(edited.ok, JSON.stringify(edited)).toBe(true);
    if (!edited.ok) return;
    expect(edited.value.written).toBe(true);
    expect(w082(edited.diagnostics, ID)).toBe(expected);
  });

  // @req FR-NODE-287 AC-5
  it("returns no warning when the updated row resolves, or when a row is deleted", async () => {
    const root = await withRow();
    const edited = await editRequirementTableRows(root, { id: ID, section: "verification_evidence", operations: [{ kind: "update", rowId: "VE-1", values: { reference: `${PRESENT}:1,2`, notes: "moved" } }] });
    expect(edited.ok).toBe(true);
    if (edited.ok) expect(edited.diagnostics.map((entry) => entry.code)).not.toContain("SRS-W082");
    const deleted = await editRequirementTableRows(root, { id: ID, section: "verification_evidence", operations: [{ kind: "delete", rowId: "VE-1" }] });
    expect(deleted.ok).toBe(true);
    if (deleted.ok) expect(deleted.diagnostics.map((entry) => entry.code)).not.toContain("SRS-W082");
  });

  // @req FR-NODE-287 AC-5
  it("warns through the CLI and MCP", async () => {
    const root = await withRow();
    const viaCli = await cli(root, ["edit-requirement-table-rows", ID, "--section", "verification_evidence", "--operations", JSON.stringify([{ kind: "update", rowId: "VE-1", values: { reference: MISSING } }])]);
    expect(viaCli.ok, JSON.stringify(viaCli)).toBe(true);
    expect((viaCli.diagnostics ?? []).map((entry) => entry.code)).toContain("SRS-W082");
    const viaMcp = (await createMcpServer({ root: root.root }).callTool("edit_requirement_table_rows", {
      id: ID,
      section: "verification_evidence",
      operations: [{ kind: "update", rowId: "VE-1", values: { reference: `${MISSING},7` } }]
    })) as { ok: boolean; diagnostics: Diagnostics };
    expect(viaMcp.ok).toBe(true);
    expect(viaMcp.diagnostics.map((entry) => entry.code)).toContain("SRS-W082");
  });
});

describe("FR-NODE-287 AC-5 — a step promotion that is not verified warns on an unresolved evidence reference", () => {
  async function stepWorkspace(reference: string): Promise<ProjectRoot> {
    const root = await workspace();
    const steps = path.join(root.root, "docs", "spec", "steps");
    await mkdir(path.join(steps, "feature-x"), { recursive: true });
    await writeFile(
      path.join(steps, "state.md"),
      ["# Step State", "", "Mode: tdd", "Active Task: feature-x", "", "| Step | Status | DependsOn | TouchesScope | TouchesReq | Created | Updated |", "| --- | --- | --- | --- | --- | --- | --- |", "| feature-x | active | - | ARCH | - | 2026-11-22 | 2026-11-22 |", ""].join("\n")
    );
    const block = [
      "### FR-ARCH-511 — Step fixture", "", "| Field | Value |", "| --- | --- |", "| Type | functional |", "| Target | v1.0.0 |", "| Status | implemented |", "| Priority | high |",
      "| Tags | step |", "| Risk | low |", "| Stability | evolving |", "| Verification Method | test |", "| GitHub Issue | - |", "| Related Docs | - |", "", "#### Requirement", "", "Step requirement.", "",
      "#### Rationale", "", "- -", "", "#### Acceptance Criteria", "", "- [x] AC-1: Step criterion.", "", "#### Verification Evidence", "", "| Evidence ID | Type | Reference | Covers | Notes |", "| --- | --- | --- | --- | --- |",
      `| VE-1 | test | ${reference} | AC-1 | - |`, "", "#### Trace Links", "", "| Type | Reference | Relation | Notes |", "| --- | --- | --- | --- |", "", "#### Research / Analysis", "", "- -", "", "#### Implementation Notes", "", "- -", "",
      "#### Change Notes", "", "| Date | Change | Reason |", "| --- | --- | --- |", "| 2026-11-22 | Created | Fixture |"
    ];
    const scope = ["# Step Architecture", "", "| Field | Value |", "|---|---|", "| Document Type | scope_srs |", "| Scope | ARCH |", "| Scope Name | Product Architecture |", "", "## 4. Requirements", "", ...block].join("\n");
    await writeFile(path.join(steps, "feature-x", "10.product-architecture.srs.md"), scope);
    return root;
  }

  // @req FR-NODE-287 AC-5
  it("promotes the block and returns the warning add_verification_evidence returns", async () => {
    const expected = await referenceWarning(MISSING);
    const root = await stepWorkspace(MISSING);
    const promoted = await promoteStepRequirement(root, { id: "FR-ARCH-511", fromStep: "feature-x", toScope: "ARCH" });
    expect(promoted.ok, JSON.stringify(promoted)).toBe(true);
    if (promoted.ok) expect(w082(promoted.diagnostics, "FR-ARCH-511")).toBe(expected);
  });

  // @req FR-NODE-287 AC-5
  it("returns no warning when the promoted block's references resolve", async () => {
    const root = await stepWorkspace(PRESENT);
    const promoted = await promoteStepRequirement(root, { id: "FR-ARCH-511", fromStep: "feature-x", toScope: "ARCH" });
    expect(promoted.ok, JSON.stringify(promoted)).toBe(true);
    if (promoted.ok) expect(promoted.diagnostics.map((entry) => entry.code)).not.toContain("SRS-W082");
  });
});
