import { readdirSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it, vi } from "vitest";
import { addVerificationEvidence } from "../../../src/core/mutation/add-evidence.js";
import { setAcceptanceCriteriaChecked } from "../../../src/core/mutation/check-ac.js";
import { updateStatus } from "../../../src/core/mutation/update-status.js";
import * as fileReferences from "../../../src/core/parser/file-references.js";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import type { ProjectRoot } from "../../../src/core/types.js";
import { collectEvidenceReferenceIssuesForRecord, collectMissingEvidenceReferences } from "../../../src/core/workflow/release-readiness.js";
import { createMcpServer } from "../../../src/mcp/server.js";
import { cleanupFixtures, gitWorkspaceRepo, rawGit } from "../../mcp/support/workspace-root-fixture.js";

// @req FR-NODE-293 — an evidence reference's `:N-M` line range is read like `:N`, by the one
// line-designation rule the Trace Link resolver uses.
//
// OG (2026-11-11): `update_status(verified)` refused `...Repository.java:44-46` as naming no existing
// file while `...java:46` passed, and `a.md#anchor; Missing.java:44-46` let a missing file through.

// Each case seeds and commits a real repository, which takes seconds on Windows.
vi.setConfig({ testTimeout: 60_000 });

afterAll(async () => {
  await cleanupFixtures();
});

const ID = "FR-ARCH-001";
const JAVA = "src/main/Foo.java";
/** Exists in the `valid-basic` fixture. */
const DOC = "docs/spec/90.appendix.md";

/** A committed repository holding valid-basic and a 50-line Java file, checked to be the root in use. */
async function workspace(): Promise<ProjectRoot> {
  const directory = await gitWorkspaceRepo("fr-node-293-");
  const root = await resolveProjectRoot(directory);
  expect(path.resolve(root.root)).toBe(path.resolve(directory));
  expect(path.resolve(await rawGit(directory, "rev-parse", "--show-toplevel"))).toBe(path.resolve(directory));
  await mkdir(path.join(directory, "src", "main"), { recursive: true });
  await writeFile(path.join(directory, JAVA), Array.from({ length: 50 }, (_, index) => `// line ${index + 1}`).join("\n"));
  expect((await setAcceptanceCriteriaChecked(root, { id: ID, acIds: ["all"], checked: true })).ok).toBe(true);
  return root;
}

async function record(root: ProjectRoot) {
  return (await parseWorkspace(root)).records.find((entry) => entry.id === ID);
}

async function issuesFor(root: ProjectRoot, reference: string, type = "test") {
  const found = await record(root);
  if (!found) throw new Error(`${ID} is not in the fixture`);
  return collectEvidenceReferenceIssuesForRecord(root.root, { ...found, verificationEvidence: [{ id: "VE-1", type, reference, covers: "all", notes: "-" }] });
}

describe("FR-NODE-293 AC-1 — `path:N-M` is judged like `path:N`", () => {
  it("lets an existing file with a line range reach verified, with no write-time warning and nothing for release readiness", async () => {
    const root = await workspace();
    const written = await addVerificationEvidence(root, { id: ID, type: "test", reference: `${JAVA}:44-46` });
    expect(written.ok).toBe(true);
    if (!written.ok) return;
    expect(written.diagnostics.map((entry) => entry.code)).not.toContain("SRS-W082");
    const promoted = await updateStatus(root, { id: ID, status: "verified" });
    expect(promoted.ok, JSON.stringify(promoted)).toBe(true);
    expect(collectMissingEvidenceReferences(await parseWorkspace(root))).toEqual([]);
  });

  it("lets the same reference reach verified through MCP", async () => {
    const root = await workspace();
    const server = createMcpServer({ root: root.root });
    expect(await server.callTool("add_verification_evidence", { id: ID, type: "test", reference: `${JAVA}:44-46` })).toMatchObject({ ok: true });
    expect(await server.callTool("update_status", { id: ID, status: "verified" })).toMatchObject({ ok: true });
  });

  it("accepts a range on a verified requirement's new row instead of refusing it", async () => {
    const root = await workspace();
    expect((await addVerificationEvidence(root, { id: ID, type: "test", reference: DOC })).ok).toBe(true);
    expect((await updateStatus(root, { id: ID, status: "verified" })).ok).toBe(true);
    const answer = await addVerificationEvidence(root, { id: ID, type: "test", reference: `${JAVA}:352-404` });
    expect(answer.ok, JSON.stringify(answer)).toBe(true);
  });

  // A type that is not a path kind decides by the extension alone when the reference has no separator,
  // so the designation must come off before that test too.
  it.each(["Missing.java", "Missing.java:46", "Missing.java:44-46"])("refuses the root-level %s as missing on a Code row", async (reference) => {
    const root = await workspace();
    expect((await addVerificationEvidence(root, { id: ID, type: "Code", reference })).ok).toBe(true);
    const promoted = await updateStatus(root, { id: ID, status: "verified" });
    expect(promoted.ok).toBe(false);
    if (promoted.ok) return;
    expect(promoted.error.message).toContain(`${reference} [missing]`);
  });

  it("lets a root-level existing file with a range reach verified on a Code row", async () => {
    const root = await workspace();
    await writeFile(path.join(root.root, "Root.java"), "class Root {}\n");
    expect(await issuesFor(root, "Root.java:44-46", "Code")).toEqual([]);
  });

  it.each(["src/main/Missing.java", "src/main/Missing.java:46", "src/main/Missing.java:44-46"])("still refuses %s as missing", async (reference) => {
    const root = await workspace();
    expect((await addVerificationEvidence(root, { id: ID, type: "test", reference })).ok).toBe(true);
    const promoted = await updateStatus(root, { id: ID, status: "verified" });
    expect(promoted.ok).toBe(false);
    if (promoted.ok) return;
    expect(promoted.error.message).toContain(`${reference} [missing]`);
    expect((await record(root))?.status).not.toBe("verified");
  });
});

describe("FR-NODE-293 AC-2 — only the file is judged, for a single line and for a range alike", () => {
  it.each([":46-44", ":0-0", ":40-99999", ":0", ":99999", ":46:3"])("finds no issue with %s on an existing file", async (suffix) => {
    const root = await workspace();
    expect(await issuesFor(root, `${JAVA}${suffix}`)).toEqual([]);
  });
});

describe("FR-NODE-293 AC-3 — a path-shaped part with a range after an anchor is its own reference", () => {
  it("refuses a missing file written after `#anchor;` with a line range", async () => {
    const root = await workspace();
    expect((await addVerificationEvidence(root, { id: ID, type: "test", reference: `${DOC}#title; Missing.java:44-46` })).ok).toBe(true);
    const promoted = await updateStatus(root, { id: ID, status: "verified" });
    expect(promoted.ok).toBe(false);
    if (promoted.ok) return;
    expect(promoted.error.message).toContain("Missing.java:44-46 [missing]");
  });

  it("passes an existing file written after `#anchor;` with a line range", async () => {
    const root = await workspace();
    expect(await issuesFor(root, `${DOC}#title; ${JAVA}:44-46`)).toEqual([]);
  });

  it("keeps anchor prose holding a number range attached to the anchor", async () => {
    const root = await workspace();
    expect(await issuesFor(root, `${DOC}#AC-1 lines 44-46 hold; the rest of the title`)).toEqual([]);
  });
});

describe("FR-NODE-293 AC-4 — one line-designation rule, shared by evidence and trace resolution", () => {
  const SUFFIXES = ["", ":46", ":46:3", ":44-46", ":46-44", ":0-0", ":40-99999", ":abc", ":44-", "-46", ":44-46-48"];

  it.each(SUFFIXES)("the two resolvers agree on whether %s leaves the file reachable", async (suffix) => {
    const root = await workspace();
    const traced = fileReferences.traceReferencePath(`${JAVA}${suffix}`) === JAVA;
    const evidenced = (await issuesFor(root, `${JAVA}${suffix}`)).length === 0;
    expect(evidenced).toBe(traced);
  });

  it("exports the rule from file-references and no other source file carries a line-designation pattern", () => {
    expect(typeof (fileReferences as Record<string, unknown>).withoutLineDesignation).toBe("function");
    const strip = (fileReferences as unknown as { withoutLineDesignation: (value: string) => string }).withoutLineDesignation;
    expect(strip(`${JAVA}:44-46`)).toBe(JAVA);
    expect(strip(`${JAVA}:46:3`)).toBe(JAVA);
    expect(strip(`${JAVA}:46`)).toBe(JAVA);
    expect(strip(JAVA)).toBe(JAVA);

    const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "src");
    // A literal colon before digits; the `:` of a `(?:\d+` group is not a line designation. Counted
    // over every source file, so a second copy inside file-references is caught as well.
    const carriers = (readdirSync(src, { recursive: true }) as string[])
      .filter((entry) => entry.endsWith(".ts"))
      .flatMap((entry) => (readFileSync(path.join(src, entry), "utf8").match(/(?<!\?):\\d\+/g) ?? []).map(() => entry.split(path.sep).join("/")));
    expect(carriers).toEqual(["core/parser/file-references.ts"]);
  });
});
