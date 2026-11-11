import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { addVerificationEvidence } from "../../../src/core/mutation/add-evidence.js";
import { addTraceLink } from "../../../src/core/mutation/add-trace.js";
import { setAcceptanceCriteriaChecked } from "../../../src/core/mutation/check-ac.js";
import { updateStatus } from "../../../src/core/mutation/update-status.js";
import * as fileReferences from "../../../src/core/parser/file-references.js";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { checkLinks } from "../../../src/core/query/links.js";
import type { ProjectRoot } from "../../../src/core/types.js";
import { collectCommandEvidencePolicyViolations, collectEvidenceReferenceIssuesForRecord, collectMissingEvidenceReferences } from "../../../src/core/workflow/release-readiness.js";
import { cleanupFixtures, gitWorkspaceRepo, rawGit } from "../../mcp/support/workspace-root-fixture.js";

// @req FR-NODE-296 — a reference enclosed whole in one pair of backticks is read as the text inside them.
//
// Rules §22.1 and §22.4 write a local evidence file as inline code, and the resolver refused exactly
// that spelling as a missing file whose name began and ended with a backtick.

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
  const directory = await gitWorkspaceRepo("fr-node-296-");
  const root = await resolveProjectRoot(directory);
  expect(path.resolve(root.root)).toBe(path.resolve(directory));
  expect(path.resolve(await rawGit(directory, "rev-parse", "--show-toplevel"))).toBe(path.resolve(directory));
  await mkdir(path.join(directory, "src", "main"), { recursive: true });
  await writeFile(path.join(directory, JAVA), Array.from({ length: 50 }, (_, index) => `// line ${index + 1}`).join("\n"));
  expect((await setAcceptanceCriteriaChecked(root, { id: ID, acIds: ["all"], checked: true })).ok).toBe(true);
  return root;
}

async function issuesFor(root: ProjectRoot, reference: string, type = "test") {
  const found = (await parseWorkspace(root)).records.find((entry) => entry.id === ID);
  if (!found) throw new Error(`${ID} is not in the fixture`);
  return collectEvidenceReferenceIssuesForRecord(root.root, { ...found, verificationEvidence: [{ id: "VE-1", type, reference, covers: "all", notes: "-" }] });
}

async function refusalOf(root: ProjectRoot, reference: string): Promise<string> {
  expect((await addVerificationEvidence(root, { id: ID, type: "test", reference })).ok).toBe(true);
  const promoted = await updateStatus(root, { id: ID, status: "verified" });
  expect(promoted.ok).toBe(false);
  return promoted.ok ? "" : promoted.error.message;
}

describe("FR-NODE-296 AC-1 — the text inside one pair of backticks is classified and resolved as if unwrapped", () => {
  it("lets an existing file written as inline code reach verified, with no write-time warning and nothing for release readiness", async () => {
    const root = await workspace();
    const written = await addVerificationEvidence(root, { id: ID, type: "test", reference: `\`${JAVA}\`` });
    expect(written.ok).toBe(true);
    if (!written.ok) return;
    expect(written.diagnostics.map((entry) => entry.code)).not.toContain("SRS-W082");
    const promoted = await updateStatus(root, { id: ID, status: "verified" });
    expect(promoted.ok, JSON.stringify(promoted)).toBe(true);
    expect(collectMissingEvidenceReferences(await parseWorkspace(root))).toEqual([]);
  });

  it("accepts an inline-code reference on a verified requirement's new row", async () => {
    const root = await workspace();
    expect((await addVerificationEvidence(root, { id: ID, type: "test", reference: DOC })).ok).toBe(true);
    expect((await updateStatus(root, { id: ID, status: "verified" })).ok).toBe(true);
    const answer = await addVerificationEvidence(root, { id: ID, type: "test", reference: `\`${JAVA}:44-46\`` });
    expect(answer.ok, JSON.stringify(answer)).toBe(true);
  });

  it.each([
    [`\`${JAVA}\``, "test"],
    [`\`${JAVA}:44-46\``, "test"],
    [`\`${JAVA}#a test title\``, "test"],
    [`${DOC}#title; \`${JAVA}\``, "test"],
    [`\`${DOC}\`; \`${JAVA}\``, "test"],
    ["`Root.java`", "Code"],
    ["`npm test`", "test"],
    ["`https://example.com/run/1`", "test"]
  ])("finds no issue with %s on a %s row", async (reference, type) => {
    const root = await workspace();
    await writeFile(path.join(root.root, "Root.java"), "class Root {}\n");
    expect(await issuesFor(root, reference, type)).toEqual([]);
  });

  it.each([
    ["`src/main/Missing.java`", "missing"],
    ["`src/main/Missing.java:44-46`", "missing"],
    ["`Missing.java`", "missing"],
    ["`https://`", "invalid-url"],
    ["`../elsewhere/nope.md`", "outside-project-root"]
  ])("judges %s as %s, as it judges the unwrapped text", async (reference, kind) => {
    const root = await workspace();
    const wrapped = await issuesFor(root, reference);
    const unwrapped = await issuesFor(root, reference.slice(1, -1));
    expect(wrapped.map((issue) => issue.issue)).toEqual([kind]);
    expect(unwrapped.map((issue) => issue.issue)).toEqual([kind]);
  });

  it("refuses a missing file written as inline code after `#anchor;` as its own reference", async () => {
    const root = await workspace();
    const message = await refusalOf(root, `${DOC}#title; \`src/main/Missing.java\``);
    expect(message).toContain("`src/main/Missing.java` [missing]");
  });

  it("does not absorb a separator-less file name in backticks into the anchor before it", async () => {
    const root = await workspace();
    const message = await refusalOf(root, `${DOC}#title; \`Missing.java:44-46\``);
    expect(message).toContain("`Missing.java:44-46` [missing]");
  });

  it.each(["`npm test`", "`npx vitest run test/a.test.ts`", "`$ npm test`"])(
    "lets the command %s reach verified and passes release readiness's command policy, as unwrapped",
    async (reference) => {
      const root = await workspace();
      expect((await addVerificationEvidence(root, { id: ID, type: "test", reference })).ok).toBe(true);
      const promoted = await updateStatus(root, { id: ID, status: "verified" });
      expect(promoted.ok, JSON.stringify(promoted)).toBe(true);
      expect(collectCommandEvidencePolicyViolations((await parseWorkspace(root)).records)).toEqual([]);
    }
  );

  it("still holds a wrapped command with a shell operator to the policy, as unwrapped", async () => {
    const root = await workspace();
    expect((await addVerificationEvidence(root, { id: ID, type: "test", reference: "`npm test && rm -rf x`" })).ok).toBe(true);
    expect((await updateStatus(root, { id: ID, status: "verified" })).ok).toBe(true);
    const violations = collectCommandEvidencePolicyViolations((await parseWorkspace(root)).records);
    expect(violations.map((entry) => entry.reference)).toEqual(["`npm test && rm -rf x`"]);
  });

  it("does not read a pair of backticks around only whitespace as the project root", async () => {
    const root = await workspace();
    expect((await issuesFor(root, "` `")).map((issue) => issue.issue)).toEqual(["missing"]);
    expect(fileReferences.withoutEnclosingBackticks("` `")).toBe("` `");
  });

  it("reads a long unclosed backtick cell in time proportional to its length", () => {
    const started = performance.now();
    expect(fileReferences.withoutEnclosingBackticks(`\`${"a".repeat(50_000)}`)).toBe(`\`${"a".repeat(50_000)}`);
    expect(performance.now() - started).toBeLessThan(200);
  });
});

describe("FR-NODE-296 AC-2 — a refusal names the reference as written and the path without backticks", () => {
  it("keeps the backticks in the reference and drops them from the path it looked for", async () => {
    const root = await workspace();
    const message = await refusalOf(root, "`src/main/Missing.java:44-46`");
    expect(message).toContain("VE-1 `src/main/Missing.java:44-46` [missing]");
    expect(message).toContain("looked for src/main/Missing.java from the project root");
    expect(message).not.toMatch(/looked for [^ ]*`/);
  });

  it("reports the reference as written in release readiness", async () => {
    const root = await workspace();
    const issues = await issuesFor(root, "`src/main/Missing.java`");
    expect(issues.map((issue) => issue.reference)).toEqual(["`src/main/Missing.java`"]);
  });
});

describe("FR-NODE-296 AC-3 — backticks that do not enclose the whole part leave it as written", () => {
  it.each([
    `\`${JAVA}\` and its neighbour`,
    `\`${JAVA}`,
    `${JAVA}\``,
    `\`src/main\`/\`Foo.java\``,
    `\`\`${JAVA}\`\``
  ])("still refuses %s as missing", async (reference) => {
    const root = await workspace();
    const issues = await issuesFor(root, reference);
    expect(issues.map((issue) => [issue.reference, issue.issue])).toEqual([[reference, "missing"]]);
  });

  it("judges an OG-style prose cell holding a code span as before", async () => {
    const root = await workspace();
    expect((await issuesFor(root, "SetNode ExpressionService `{{ $json.user.name }}` eval PASS", "manual"))).toEqual([]);
  });
});

describe("FR-NODE-296 AC-4 — one rule, used by the evidence and the Trace Link resolvers", () => {
  it("exports the rule from file-references", () => {
    const strip = (fileReferences as unknown as { withoutEnclosingBackticks?: (value: string) => string }).withoutEnclosingBackticks;
    expect(typeof strip).toBe("function");
    if (!strip) return;
    expect(strip(`\`${JAVA}\``)).toBe(JAVA);
    expect(strip(` \`${JAVA}\` `)).toBe(JAVA);
    expect(strip(`\`${JAVA}\` x`)).toBe(`\`${JAVA}\` x`);
    expect(strip(`\`\`${JAVA}\`\``)).toBe(`\`\`${JAVA}\`\``);
    expect(strip(JAVA)).toBe(JAVA);
  });

  const SPELLINGS = [`\`${JAVA}\``, `\`${JAVA}:46\``, `\`${JAVA}#t\``, `\`${JAVA}\` x`, `\`${JAVA}`, `\`\`${JAVA}\`\``, JAVA];

  it.each(SPELLINGS)("the two resolvers agree on whether %s names the file", async (reference) => {
    const root = await workspace();
    const traced = fileReferences.traceReferencePath(reference) === JAVA;
    const evidenced = (await issuesFor(root, reference)).length === 0;
    expect(evidenced).toBe(traced);
  });

  it("links check reads a Trace Link reference in backticks as the path inside them", async () => {
    const root = await workspace();
    for (const reference of [`\`${JAVA}:3\``, "`src/main/Gone.java`"]) {
      expect((await addTraceLink(root, { id: ID, type: "Code", reference, relation: "implements" })).ok).toBe(true);
    }
    const result = await checkLinks(await parseWorkspace(root));
    const traceProblems = result.broken.filter((entry) => entry.code === "SRS-W074").map((entry) => entry.reason);
    expect(traceProblems).toEqual(["Code trace path missing: src/main/Gone.java"]);
  });
});
