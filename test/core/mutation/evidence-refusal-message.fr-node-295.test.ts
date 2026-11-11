import { readFileSync } from "node:fs";
import { mkdir, rm, symlink, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it, vi } from "vitest";
import { getDiagnosticDefinition } from "../../../src/core/diagnostic-registry.js";
import { addVerificationEvidence } from "../../../src/core/mutation/add-evidence.js";
import { addRequirement } from "../../../src/core/mutation/add-requirement.js";
import { setAcceptanceCriteriaChecked } from "../../../src/core/mutation/check-ac.js";
import { updateStatus } from "../../../src/core/mutation/update-status.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import type { ProjectRoot } from "../../../src/core/types.js";
import { renderToolDescriptions } from "../../../src/mcp/schemas.js";
import { cleanupFixtures, gitWorkspaceRepo, rawGit } from "../../mcp/support/workspace-root-fixture.js";

// @req FR-NODE-295 — an evidence refusal names each unresolved reference's row and, for a missing
// file, the root-relative path it looked for.
//
// OG (2026-11-11): `src/main/java/com/x/Foo.java; Bar.java` was refused, rightly, but three rows holding
// `Bar.java` produced three identical clauses joined by `; `, the cell's own separator.

// Each case seeds and commits a real repository, which takes seconds on Windows.
vi.setConfig({ testTimeout: 60_000 });

afterAll(async () => {
  await cleanupFixtures();
});

const ID = "FR-ARCH-001";
const FOO = "src/main/java/com/x/Foo.java";

/** A committed repository holding valid-basic plus Foo.java and a Bar.java beside it, checked to be the root in use. */
async function workspace(): Promise<ProjectRoot> {
  const directory = await gitWorkspaceRepo("fr-node-295-");
  const root = await resolveProjectRoot(directory);
  expect(path.resolve(root.root)).toBe(path.resolve(directory));
  expect(path.resolve(await rawGit(directory, "rev-parse", "--show-toplevel"))).toBe(path.resolve(directory));
  await mkdir(path.join(directory, "src/main/java/com/x"), { recursive: true });
  await writeFile(path.join(directory, FOO), "class Foo {}\n");
  await writeFile(path.join(directory, "src/main/java/com/x/Bar.java"), "class Bar {}\n");
  expect((await setAcceptanceCriteriaChecked(root, { id: ID, acIds: ["all"], checked: true })).ok).toBe(true);
  return root;
}

async function refusalWith(references: string[]): Promise<string> {
  const root = await workspace();
  for (const reference of references) expect((await addVerificationEvidence(root, { id: ID, type: "test", reference })).ok).toBe(true);
  const promoted = await updateStatus(root, { id: ID, status: "verified" });
  expect(promoted.ok).toBe(false);
  return promoted.ok ? "" : promoted.error.message;
}

describe("FR-NODE-295 AC-1 — each unresolved reference is named after its row", () => {
  it("tells apart three rows holding the same unresolved file name", async () => {
    const message = await refusalWith([`${FOO}; Bar.java`, "Bar.java", `${FOO}#ok; Bar.java`]);
    expect(message).toContain("VE-1 Bar.java [missing]");
    expect(message).toContain("VE-2 Bar.java [missing]");
    expect(message).toContain("VE-3 Bar.java [missing]");
  });

  it("names the row in add_verification_evidence's refusal on a verified requirement", async () => {
    const root = await workspace();
    expect((await addVerificationEvidence(root, { id: ID, type: "test", reference: FOO })).ok).toBe(true);
    expect((await updateStatus(root, { id: ID, status: "verified" })).ok).toBe(true);
    const answer = await addVerificationEvidence(root, { id: ID, type: "test", reference: "Bar.java" });
    expect(answer.ok).toBe(false);
    if (answer.ok) return;
    expect(answer.error.message).toContain("VE-2 Bar.java [missing]");
  });

  it("names the row once in SRS-W082", async () => {
    const root = await workspace();
    const answer = await addVerificationEvidence(root, { id: ID, type: "test", reference: `${FOO}; Bar.java` });
    expect(answer.ok).toBe(true);
    if (!answer.ok) return;
    const warning = answer.diagnostics.find((entry) => entry.code === "SRS-W082")?.message ?? "";
    expect(warning).toContain("VE-1 Bar.java [missing]");
    expect(warning.split("VE-1").length - 1).toBe(1);
  });

  it("names the row when add_requirement refuses a block created at verified", async () => {
    const root = await workspace();
    const created = await addRequirement(root, {
      type: "functional",
      scope: "ARCH",
      title: "Minted at verified with a bare file name",
      statement: "The system SHALL do something already proven.",
      acceptanceCriteria: ["It works."],
      checkedAcceptanceCriteria: ["AC-1"],
      status: "verified",
      evidence: [{ type: "test", reference: "Bar.java", covers: "AC-1" }]
    });
    expect(created.ok).toBe(false);
    if (created.ok) return;
    expect(created.error.message).toContain("VE-1 Bar.java [missing]");
  });
});

describe("FR-NODE-295 AC-2 — a missing reference says which root-relative path was looked for", () => {
  it("says it looked for Bar.java from the project root and that references are paths from the root", async () => {
    const message = await refusalWith(["Bar.java"]);
    expect(message).toContain("looked for Bar.java from the project root");
    expect(message).toMatch(/written as a path from the project root/);
  });

  it("gives the normalised root-relative path, without the anchor and the line designation", async () => {
    const message = await refusalWith(["./src/main/../main/Missing.java:44-46#a title"]);
    expect(message).toContain("looked for src/main/Missing.java from the project root");
  });

  it("gives the root-relative path for an absolute path and for a path through the root's own name", async () => {
    const root = await workspace();
    const absolute = path.join(root.root, "src", "main", "Gone.java").split(path.sep).join("/");
    const throughParent = `../${path.basename(root.root)}/src/main/Gone2.java`;
    for (const reference of [absolute, throughParent]) expect((await addVerificationEvidence(root, { id: ID, type: "test", reference })).ok).toBe(true);
    const promoted = await updateStatus(root, { id: ID, status: "verified" });
    expect(promoted.ok).toBe(false);
    if (promoted.ok) return;
    expect(promoted.error.message).toContain("looked for src/main/Gone.java from the project root");
    expect(promoted.error.message).toContain("looked for src/main/Gone2.java from the project root");
  });

  it("gives the root-relative path when the root is reached through a link and the reference is the real path", async () => {
    // `orchestrate` builds its root with path.resolve and no realpath, so a linked root reaches these
    // mutations; the message has to measure from the root the resolver measured from.
    const root = await workspace();
    const linked = `${root.root}-lnk`;
    await symlink(root.root, linked, "junction");
    try {
      const reference = path.join(root.root, "src", "main", "Gone.java").split(path.sep).join("/");
      const viaLink = { ...root, root: linked };
      expect((await addVerificationEvidence(viaLink, { id: ID, type: "test", reference })).ok).toBe(true);
      const promoted = await updateStatus(viaLink, { id: ID, status: "verified" });
      expect(promoted.ok).toBe(false);
      if (promoted.ok) return;
      expect(promoted.error.message).toContain("looked for src/main/Gone.java from the project root");
    } finally {
      await rm(linked, { force: true, recursive: false }).catch(() => unlink(linked));
    }
  });

  it("still refuses a file name whose file exists only below the root, searching nothing by name", async () => {
    const message = await refusalWith(["Bar.java"]);
    expect(message).toContain("Bar.java [missing]");
    expect(message).not.toContain("src/main/java/com/x/Bar.java");
  });

  it("keeps the outside-root cause free of the missing guidance", async () => {
    const message = await refusalWith(["../elsewhere/nope.md"]);
    expect(message).toContain("[outside-project-root]");
    expect(message).not.toContain("looked for");
  });
});

describe("FR-NODE-295 AC-3 — issues are separated by ` | `, not by the cell's `;`", () => {
  it("joins three issues with ` | ` and each starts with its row", async () => {
    const message = await refusalWith([`${FOO}; Bar.java`, "Bar.java", "../outside.java"]);
    const issues = message.replace(/^Cannot mark verified: /, "").split(" | ");
    expect(issues).toHaveLength(3);
    expect(issues.map((issue) => issue.slice(0, 5))).toEqual(["VE-1 ", "VE-2 ", "VE-3 "]);
    expect(message).not.toMatch(/; VE-\d/);
  });
});

describe("FR-NODE-295 AC-4 — the documents say a local evidence path is written from the project root", () => {
  const ROOT_SENTENCE = /relative to the project root/;

  it("SRS-MD Rules section 22.4", () => {
    const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
    const rules = readFileSync(path.join(repo, "docs/rule/SRS-MD-Rules-v2.6.0.md"), "utf8").replace(/\r\n/g, "\n");
    const section = rules.slice(rules.indexOf("### 22.4 Evidence Reference Rules"), rules.indexOf("## 23. Trace Links Rules"));
    expect(section).toMatch(ROOT_SENTENCE);
  });

  it("the SRS-W082 remediation", () => {
    expect(getDiagnosticDefinition("SRS-W082").remediation).toMatch(ROOT_SENTENCE);
  });

  it.each(["add_verification_evidence", "update_status"])("the MCP description of %s", (name) => {
    expect(renderToolDescriptions()[name] ?? "").toMatch(ROOT_SENTENCE);
  });
});
