import { readFileSync } from "node:fs";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterAll, describe, expect, it, vi } from "vitest";
import { main } from "../../src/cli/index.js";
import { addVerificationEvidence } from "../../src/core/mutation/add-evidence.js";
import { setAcceptanceCriteriaChecked } from "../../src/core/mutation/check-ac.js";
import { updateStatus } from "../../src/core/mutation/update-status.js";
import { parseWorkspace } from "../../src/core/parser/workspace-parser.js";
import { resolveProjectRoot } from "../../src/core/project-root.js";
import { createMcpServer } from "../../src/mcp/server.js";
import { cleanupFixtures, gitWorkspaceRepo, rawGit } from "./support/workspace-root-fixture.js";

// @req FR-NODE-297 — a granular edit refused on a verified requirement says which steps change it.
//
// SSO-run-close-4908 (2026-11-11): edit_requirement_table_rows refused a verified requirement's stale
// Code trace row with "change status through a guarded status mutation first", and the session edited
// the Markdown by hand.

// Each case seeds and commits a real repository, which takes seconds on Windows.
vi.setConfig({ testTimeout: 60_000 });

afterAll(async () => {
  await cleanupFixtures();
});

const ID = "FR-ARCH-001";
const SPEC = "docs/spec/10.product-architecture.srs.md";

/** A committed repository whose FR-ARCH-001 is verified with resolving evidence, checked to be the root in use. */
async function verifiedWorkspace(): Promise<string> {
  const directory = await gitWorkspaceRepo("fr-node-297-");
  const root = await resolveProjectRoot(directory);
  expect(path.resolve(root.root)).toBe(path.resolve(directory));
  expect(path.resolve(await rawGit(directory, "rev-parse", "--show-toplevel"))).toBe(path.resolve(directory));
  expect((await setAcceptanceCriteriaChecked(root, { id: ID, acIds: ["all"], checked: true })).ok).toBe(true);
  expect((await addVerificationEvidence(root, { id: ID, type: "test", reference: "docs/spec/90.appendix.md" })).ok).toBe(true);
  expect((await updateStatus(root, { id: ID, status: "verified" })).ok).toBe(true);
  return directory;
}

const EDITS = [
  {
    name: "edit_requirement_fields",
    mcp: { id: ID, title: "Edited title for FR-NODE-297" },
    cli: ["edit-requirement", ID, "--title", "Edited title for FR-NODE-297"]
  },
  {
    name: "edit_requirement_table_rows",
    mcp: { id: ID, section: "verification_evidence", operations: [{ kind: "update", rowId: "VE-1", values: { notes: "edited" } }] },
    cli: ["edit-requirement-table-rows", ID, "--section", "verification_evidence", "--operations", JSON.stringify([{ kind: "update", rowId: "VE-1", values: { notes: "edited" } }])]
  },
  {
    name: "replace_acceptance_criteria",
    mcp: { id: ID, items: [{ text: "Replaced criterion for FR-NODE-297", checked: true }] },
    cli: ["replace-acceptance-criteria", ID, "--items", JSON.stringify([{ text: "Replaced criterion for FR-NODE-297", checked: true }])]
  },
  {
    name: "edit_acceptance_criterion",
    mcp: { id: ID, acId: "AC-1", text: "Reworded criterion for FR-NODE-297" },
    cli: ["edit-ac", ID, "AC-1", "--text", "Reworded criterion for FR-NODE-297"]
  },
  {
    name: "append_acceptance_criterion",
    mcp: { id: ID, text: "Appended criterion for FR-NODE-297" },
    cli: ["append-ac", ID, "--text", "Appended criterion for FR-NODE-297"]
  }
] as const;

/** The steps, in order, each refusal has to name. */
function expectSteps(message: string): void {
  expect(message).toContain(ID);
  const order = [
    "update_status",
    `speckiwi update-status ${ID} implemented --reason`,
    "again",
    "check_acceptance_criteria",
    `speckiwi check-ac ${ID}`,
    `speckiwi update-status ${ID} verified --reason`
  ].map((needle) => message.indexOf(needle));
  expect(order.every((at) => at >= 0), message).toBe(true);
  expect([...order].sort((a, b) => a - b)).toEqual(order);
}

async function cli(root: string, args: readonly string[]): Promise<{ code: number; body: { ok: boolean; error?: { code: string; message: string } } }> {
  const streams = { stdout: new PassThrough(), stderr: new PassThrough() };
  const code = await main(["--root", root, ...args, "--json"], streams);
  return { code, body: JSON.parse(streams.stdout.read()?.toString() ?? "{}") };
}

describe("FR-NODE-297 AC-1 — the refusal names the requirement and the steps, in order", () => {
  it.each(EDITS)("$name through MCP", async (edit) => {
    const root = await verifiedWorkspace();
    const before = readFileSync(path.join(root, SPEC));
    const answer = (await createMcpServer({ root }).callTool(edit.name, edit.mcp)) as { ok: boolean; error?: { code: string; message: string } };
    expect(answer.ok).toBe(false);
    expect(answer.error?.code).toBe("MUTATION_DENIED");
    expectSteps(answer.error?.message ?? "");
    expect(readFileSync(path.join(root, SPEC)).equals(before)).toBe(true);
  });

  it.each(EDITS)("$name through the CLI", async (edit) => {
    const root = await verifiedWorkspace();
    const before = readFileSync(path.join(root, SPEC));
    const answer = await cli(root, edit.cli);
    expect(answer.code).not.toBe(0);
    expect(answer.body.error?.code).toBe("MUTATION_DENIED");
    expectSteps(answer.body.error?.message ?? "");
    expect(readFileSync(path.join(root, SPEC)).equals(before)).toBe(true);
  });
});

describe("FR-NODE-297 AC-2 — following the named steps changes the requirement", () => {
  it("downgrades, edits, and re-promotes with a Change Notes row for each status move", async () => {
    const root = await verifiedWorkspace();
    const server = createMcpServer({ root });
    const refused = (await server.callTool("edit_requirement_table_rows", EDITS[1].mcp)) as { ok: boolean };
    expect(refused.ok).toBe(false);
    expect(await server.callTool("update_status", { id: ID, status: "implemented", reason: "correct the evidence note" })).toMatchObject({ ok: true });
    expect(await server.callTool("edit_requirement_table_rows", EDITS[1].mcp)).toMatchObject({ ok: true });
    expect(await server.callTool("update_status", { id: ID, status: "verified", reason: "evidence note corrected; criteria not re-judged" })).toMatchObject({ ok: true });
    const record = (await parseWorkspace(await resolveProjectRoot(root))).records.find((entry) => entry.id === ID);
    expect(record?.status).toBe("verified");
    expect(record?.verificationEvidence[0]?.notes).toBe("edited");
    const reasons = record?.changeNotes.map((note) => note.reason) ?? [];
    expect(reasons).toContain("correct the evidence note");
    expect(reasons).toContain("evidence note corrected; criteria not re-judged");
  });
});

describe("FR-NODE-297 AC-2 — an edit that adds an unchecked criterion follows the check step the refusal names", () => {
  it("appends a criterion, ticks it, and re-promotes", async () => {
    const root = await verifiedWorkspace();
    const server = createMcpServer({ root });
    expect(((await server.callTool("append_acceptance_criterion", EDITS[4].mcp)) as { ok: boolean }).ok).toBe(false);
    expect(await server.callTool("update_status", { id: ID, status: "implemented", reason: "add a criterion" })).toMatchObject({ ok: true });
    const appended = (await server.callTool("append_acceptance_criterion", EDITS[4].mcp)) as { ok: boolean; value?: { acId?: string } };
    expect(appended.ok).toBe(true);
    const premature = (await server.callTool("update_status", { id: ID, status: "verified", reason: "too early" })) as { ok: boolean };
    expect(premature.ok).toBe(false);
    const ticked = await server.callTool("check_acceptance_criteria", { id: ID, acIds: [appended.value?.acId], checked: true });
    expect(ticked, JSON.stringify(ticked)).toMatchObject({ ok: true });
    const covered = await server.callTool("add_verification_evidence", { id: ID, type: "test", reference: "docs/spec/90.appendix.md", covers: appended.value?.acId });
    expect(covered, JSON.stringify(covered)).toMatchObject({ ok: true });
    const promoted = await server.callTool("update_status", { id: ID, status: "verified", reason: "criterion added and met" });
    expect(promoted, JSON.stringify(promoted)).toMatchObject({ ok: true });
  });
});

describe("FR-NODE-297 AC-3 — one refusal text for every refusing tool", () => {
  it("gives the five tools the same message", async () => {
    const messages = new Set<string>();
    for (const edit of EDITS) {
      const root = await verifiedWorkspace();
      const answer = (await createMcpServer({ root }).callTool(edit.name, edit.mcp)) as { error?: { message: string } };
      messages.add(answer.error?.message ?? "");
    }
    expect(messages.size).toBe(1);
  });
});
