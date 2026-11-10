import { describe, expect, it } from "vitest";
import { addVerificationEvidence } from "../../../src/core/mutation/add-evidence.js";
import { setAcceptanceCriteriaChecked } from "../../../src/core/mutation/check-ac.js";
import { updateStatus } from "../../../src/core/mutation/update-status.js";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import type { ProjectRoot } from "../../../src/core/types.js";
import { collectMissingEvidenceReferences } from "../../../src/core/workflow/release-readiness.js";
import { createMcpServer } from "../../../src/mcp/server.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

// @req FR-NODE-287 — a `#` anchor keeps its own `;`, and add_verification_evidence judges the
// reference when it writes the row.
//
// SB15 (5.3.7): kiwi-coder §6.2 has the agent write `path#<test title>`; a title holding `;` was split
// before the anchor was removed, so `verified` was refused with `[missing]` on the title's tail, and
// add_verification_evidence had accepted the row without a word.

const ID = "FR-ARCH-001";
/** Exists in the `valid-basic` fixture. */
const FILE = "docs/spec/90.appendix.md";

async function workspace(): Promise<ProjectRoot> {
  const root = await resolveProjectRoot(await copyFixtureWorkspace("valid-basic"));
  expect((await setAcceptanceCriteriaChecked(root, { id: ID, acIds: ["all"], checked: true })).ok).toBe(true);
  return root;
}

async function record(root: ProjectRoot) {
  return (await parseWorkspace(root)).records.find((entry) => entry.id === ID);
}

describe("FR-NODE-287 AC-1 — a `;` inside a `#` anchor belongs to the anchor", () => {
  it.each([
    `${FILE}#DR-ARCH-001 AC-2 stale totals sum; aggregating again does not change any total`,
    `${FILE}#AC-1 one; two; three`,
    `${FILE}:3#AC-1 first half; second half`
  ])("lets %s reach verified and leaves release readiness quiet", async (reference) => {
    const root = await workspace();
    expect((await addVerificationEvidence(root, { id: ID, type: "test", reference })).ok).toBe(true);
    const promoted = await updateStatus(root, { id: ID, status: "verified" });
    expect(promoted.ok, JSON.stringify(promoted)).toBe(true);
    expect(collectMissingEvidenceReferences(await parseWorkspace(root))).toEqual([]);
  });
});

describe("FR-NODE-287 AC-2 — a path-shaped part after an anchor is still its own reference", () => {
  it.each([
    [`${FILE}#AC-1 rejects input; docs/spec/no-such-file.md`, "docs/spec/no-such-file.md"],
    [`${FILE}#AC-1 rejects input; missing.test.ts:12`, "missing.test.ts:12"],
    [`${FILE}#AC-1; docs/spec/no-such-file.md#AC-2 with words; more words`, "docs/spec/no-such-file.md#AC-2 with words; more words"]
  ])("refuses verified for %s naming the missing part", async (reference, missing) => {
    const root = await workspace();
    expect((await addVerificationEvidence(root, { id: ID, type: "test", reference })).ok).toBe(true);
    const promoted = await updateStatus(root, { id: ID, status: "verified" });
    expect(promoted.ok).toBe(false);
    if (promoted.ok) return;
    expect(promoted.error.message).toContain(`${missing} [missing]`);
    expect((await record(root))?.status).not.toBe("verified");
  });
});

describe("FR-NODE-287 AC-3 — an unresolvable reference is refused on a verified requirement", () => {
  it("refuses the row, names the reference and its cause, and writes nothing", async () => {
    const root = await workspace();
    expect((await addVerificationEvidence(root, { id: ID, type: "test", reference: FILE })).ok).toBe(true);
    expect((await updateStatus(root, { id: ID, status: "verified" })).ok).toBe(true);
    const before = (await record(root))?.verificationEvidence.length;
    const answer = await addVerificationEvidence(root, { id: ID, type: "test", reference: "test/no-such.test.ts" });
    expect(answer.ok).toBe(false);
    if (answer.ok) return;
    expect(answer.error.code).toBe("MUTATION_DENIED");
    expect(answer.error.message).toContain("test/no-such.test.ts [missing]");
    expect((await record(root))?.verificationEvidence.length).toBe(before);
  });

  it("refuses the same row through MCP", async () => {
    const root = await workspace();
    expect((await addVerificationEvidence(root, { id: ID, type: "test", reference: FILE })).ok).toBe(true);
    expect((await updateStatus(root, { id: ID, status: "verified" })).ok).toBe(true);
    const answer = (await createMcpServer({ root: root.root }).callTool("add_verification_evidence", { id: ID, type: "test", reference: "JAVA_HOME=/opt/jdk ./gradlew test" })) as {
      ok: boolean;
      error?: { code: string; message: string };
    };
    expect(answer.ok).toBe(false);
    expect(answer.error).toMatchObject({ code: "MUTATION_DENIED", message: expect.stringContaining("[missing]") });
  });

  it("still appends a resolvable row to a verified requirement", async () => {
    const root = await workspace();
    expect((await addVerificationEvidence(root, { id: ID, type: "test", reference: FILE })).ok).toBe(true);
    expect((await updateStatus(root, { id: ID, status: "verified" })).ok).toBe(true);
    expect((await addVerificationEvidence(root, { id: ID, type: "test", reference: `${FILE}#AC-1 a; b` })).ok).toBe(true);
  });
});

describe("FR-NODE-287 AC-4 — an unresolvable reference on a requirement not yet verified is written with SRS-W082", () => {
  it("writes the row and warns, naming the reference and its cause", async () => {
    const root = await workspace();
    const answer = await addVerificationEvidence(root, { id: ID, type: "test", reference: "test/later.test.ts" });
    expect(answer.ok).toBe(true);
    if (!answer.ok) return;
    expect(answer.diagnostics).toEqual([expect.objectContaining({ code: "SRS-W082", severity: "warning", message: expect.stringContaining("test/later.test.ts [missing]") })]);
    expect((await record(root))?.verificationEvidence.map((row) => row.reference)).toContain("test/later.test.ts");
  });

  it("carries the warning through MCP", async () => {
    const root = await workspace();
    const answer = (await createMcpServer({ root: root.root }).callTool("add_verification_evidence", { id: ID, type: "test", reference: "test/later.test.ts" })) as {
      ok: boolean;
      diagnostics?: Array<{ code: string }>;
    };
    expect(answer.ok).toBe(true);
    expect(answer.diagnostics?.map((entry) => entry.code)).toContain("SRS-W082");
  });

  it("adds no warning for a reference that resolves", async () => {
    const root = await workspace();
    const answer = await addVerificationEvidence(root, { id: ID, type: "test", reference: `${FILE}#AC-1 a; b` });
    expect(answer.ok).toBe(true);
    if (!answer.ok) return;
    expect(answer.diagnostics.map((entry) => entry.code)).not.toContain("SRS-W082");
  });
});
