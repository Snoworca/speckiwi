import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getDiagnosticDefinition } from "../../../src/core/diagnostic-registry.js";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { validateWorkspace } from "../../../src/core/validator/validate-workspace.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

// @req FR-PARSE-045 — a dependency written only in prose, and a depends_on row whose target is not a
// requirement, are reported, so every dependency the work graph needs is one the tools can read.

const PROSE = "SRS-W078";
const NOT_A_REQUIREMENT = "SRS-W080";
const SPEC = path.join("docs", "spec", "10.product-architecture.srs.md");

interface Block {
  requirement?: string;
  rationale?: string;
  criterion?: string;
  notes?: string;
  research?: string;
  traces?: string[];
  status?: string;
}

function secondRequirement(block: Block): string {
  return [
    "### FR-ARCH-002 — Second fixture requirement",
    "",
    "| Field | Value |",
    "| --- | --- |",
    "| Type | functional |",
    "| Target | v1.0.0 |",
    `| Status | ${block.status ?? "planned"} |`,
    "| Priority | high |",
    "| Tags | fixture |",
    "| Risk | low |",
    "| Stability | stable |",
    "| Verification Method | test |",
    "| GitHub Issue | - |",
    "| Related Docs | - |",
    "",
    "#### Requirement",
    "",
    block.requirement ?? "SpecKiwi must parse a second requirement.",
    "",
    "#### Rationale",
    "",
    block.rationale ?? "The rule needs two requirements.",
    "",
    "#### Acceptance Criteria",
    "",
    `- [ ] AC-1: ${block.criterion ?? "The requirement can be listed."}`,
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
    ...(block.traces ?? []),
    "",
    "#### Research / Analysis",
    "",
    block.research ?? "- -",
    "",
    "#### Implementation Notes",
    "",
    block.notes ?? "- -",
    "",
    "#### Change Notes",
    "",
    "| Date | Change | Reason |",
    "| --- | --- | --- |",
    "| 2026-11-04 | Created | Fixture |",
    ""
  ].join("\n");
}

async function diagnosticsFor(block: Block) {
  const root = await copyFixtureWorkspace("valid-basic");
  const specPath = path.join(root, SPEC);
  const text = await readFile(specPath, "utf8");
  await writeFile(specPath, `${text.trimEnd()}\n\n${secondRequirement(block)}`, "utf8");
  const workspace = await parseWorkspace(await resolveProjectRoot(root));
  if (!workspace.records.some((record) => record.id === "FR-ARCH-002")) throw new Error("the second fixture requirement did not parse");
  return validateWorkspace(workspace).diagnostics.filter((entry) => entry.code === PROSE || entry.code === NOT_A_REQUIREMENT);
}

describe("FR-PARSE-045 AC-1 — a dependency stated only in prose", () => {
  // @req FR-PARSE-045 AC-1
  it("FR-PARSE-045 AC-1: warns for depends on <ID> in the Requirement, Rationale, Acceptance Criteria or Implementation Notes text", async () => {
    for (const block of [
      { requirement: "This depends on FR-ARCH-001 for parsing." },
      { rationale: "It Depends On FR-ARCH-001." },
      { criterion: "WHEN listed, which DEPENDS ON the parse of FR-ARCH-001, THE SYSTEM SHALL list it." },
      { notes: "- Depends on C1 (FR-ARCH-001) landing first." }
    ]) {
      const found = await diagnosticsFor(block);
      expect(found.map((entry) => entry.code), JSON.stringify(block)).toEqual([PROSE]);
      expect(found[0]?.severity).toBe("warning");
      expect(found[0]?.message).toContain("FR-ARCH-002");
      expect(found[0]?.message).toContain("FR-ARCH-001");
    }
  });

  // @req FR-PARSE-045 AC-1
  it("FR-PARSE-045 AC-1: ignores an ID on another line, an ID before the phrase, a missing ID and another section", async () => {
    for (const block of [
      { requirement: "This depends on the parser.\nFR-ARCH-001 is the parser." },
      { requirement: "FR-ARCH-001 is what this depends on." },
      { requirement: "This depends on FR-ARCH-999, which does not exist." },
      { research: "- Depends on FR-ARCH-001 in an earlier draft." }
    ]) {
      expect(await diagnosticsFor(block), JSON.stringify(block)).toEqual([]);
    }
  });
});

describe("FR-PARSE-045 AC-2 — a depends_on row whose target is not a requirement", () => {
  // @req FR-PARSE-045 AC-2
  it("FR-PARSE-045 AC-2: warns naming the requirement and the Reference", async () => {
    const found = await diagnosticsFor({ traces: ["| Code | B1 | depends_on | - |"] });
    expect(found.map((entry) => entry.code)).toEqual([NOT_A_REQUIREMENT]);
    expect(found[0]?.severity).toBe("warning");
    expect(found[0]?.message).toContain("FR-ARCH-002");
    expect(found[0]?.message).toContain("B1");
  });

  // @req FR-PARSE-045 AC-2
  it("FR-PARSE-045 AC-2: reads Type and Relation as the readiness reader does, so a row it reads as a requirement dependency raises nothing", async () => {
    expect(await diagnosticsFor({ traces: ["| requirement | FR-ARCH-001 | depends-on | - |"] })).toEqual([]);
    expect((await diagnosticsFor({ traces: ["| Task | T-1 | Depends On | - |"] })).map((entry) => entry.code)).toEqual([NOT_A_REQUIREMENT]);
    expect(await diagnosticsFor({ traces: ["| Code | src/x.ts | related_to | - |"] })).toEqual([]);
  });
});

describe("FR-PARSE-045 AC-4 — a closed requirement is not reopened", () => {
  const both: Block = { requirement: "This depends on FR-ARCH-001 for parsing.", traces: ["| Code | B1 | depends_on | - |"] };

  // @req FR-PARSE-045 AC-4
  it("FR-PARSE-045 AC-4: a verified or discarded block raises neither warning", async () => {
    for (const status of ["verified", "discarded"]) {
      expect(await diagnosticsFor({ ...both, status }), status).toEqual([]);
    }
  });

  // @req FR-PARSE-045 AC-4
  it("FR-PARSE-045 AC-4: every other status raises both warnings", async () => {
    for (const status of ["planned", "in_progress", "blocked", "implemented"]) {
      expect((await diagnosticsFor({ ...both, status })).map((entry) => entry.code).sort(), status).toEqual([PROSE, NOT_A_REQUIREMENT]);
    }
  });
});

describe("FR-PARSE-045 AC-3 — a dependency the tools can read raises neither warning", () => {
  // @req FR-PARSE-045 AC-3
  it("FR-PARSE-045 AC-3: a prose dependency backed by a Requirement / depends_on row raises nothing", async () => {
    expect(
      await diagnosticsFor({ requirement: "This depends on FR-ARCH-001 for parsing.", traces: ["| Requirement | FR-ARCH-001 | depends_on | - |"] })
    ).toEqual([]);
    expect(await diagnosticsFor({ requirement: "This depends on FR-ARCH-001.", traces: ["| requirement | FR-ARCH-001 | depends_on | - |"] })).toEqual([]);
    expect(await diagnosticsFor({ requirement: "This depends on FR-ARCH-001.", traces: ["| Requirement | FR-ARCH-001 | related_to | - |"] })).toEqual([
      expect.objectContaining({ code: PROSE })
    ]);
  });

  // @req FR-PARSE-045 AC-3
  it("FR-PARSE-045 AC-3: both codes are registered as warnings", () => {
    expect(getDiagnosticDefinition(PROSE).severity).toBe("warning");
    expect(getDiagnosticDefinition(NOT_A_REQUIREMENT).severity).toBe("warning");
    expect(getDiagnosticDefinition(PROSE).sourceRule).toBe("FR-PARSE-045");
    expect(getDiagnosticDefinition(NOT_A_REQUIREMENT).sourceRule).toBe("FR-PARSE-045");
  });
});
