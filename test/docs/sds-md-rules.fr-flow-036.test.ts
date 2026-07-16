import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// FR-FLOW-036 — SDS-MD Authoring Rules v1.0.0 and design.md template. RED suite
// (content test, one case per AC). The suite fails on ENOENT until
// docs/rule/SDS-MD-Rules-v1.0.0.md ships with the required structure.
//
// Contract under test (docs/spec/60.workflow-release.srs.md FR-FLOW-036):
//   - AC-1: the seven required headings, the metadata table fields, and the
//           EARS SDS-AC format are defined.
//   - AC-2: the 200-line cap, the prohibition rules, the lifecycle with
//           size-scoped approval, and the trivial-change skip-gate are present.
//   - AC-3: the embedded design.md template contains the metadata table and
//           all seven required headings.

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const RULES_PATH = path.join(REPO_ROOT, "docs", "rule", "SDS-MD-Rules-v1.0.0.md");

const REQUIRED_HEADINGS = [
  "Context & Scope",
  "Goals / Non-goals",
  "Architecture Decisions",
  "Interfaces",
  "Acceptance Contracts",
  "Test Plan",
  "Open Questions"
] as const;

async function rules(): Promise<string> {
  return readFile(RULES_PATH, "utf8");
}

describe("FR-FLOW-036 SDS-MD Authoring Rules v1.0.0", () => {
  it("FR-FLOW-036 AC-1: defines the required headings, metadata fields, and EARS SDS-AC format", async () => {
    const content = await rules();
    for (const heading of REQUIRED_HEADINGS) {
      expect(content).toContain(heading);
    }
    // Metadata table fields for design.md.
    for (const field of ["Document Type", "sds", "Task", "Target", "Status", "Date"]) {
      expect(content).toContain(field);
    }
    // EARS acceptance contract format with SDS-AC ids.
    expect(content).toContain("SDS-AC-");
    expect(content).toContain("EARS");
    expect(content).toContain("THE SYSTEM SHALL");
    // The design.md location.
    expect(content).toContain("docs/spec/steps/");
    expect(content).toContain("design.md");
  });

  it("FR-FLOW-036 AC-2: states the line cap, prohibitions, lifecycle, and skip-gate", async () => {
    const content = await rules();
    // 200-line cap with split guidance.
    expect(content).toContain("200");
    expect(content).toMatch(/split/i);
    // Prohibition rules.
    expect(content).toMatch(/schema/i);
    expect(content).toMatch(/changelog/i);
    expect(content).toMatch(/weaken/i);
    expect(content).toMatch(/supersede/i);
    // Lifecycle with size-scoped approval.
    for (const token of ["draft", "agreed", "superseded", "self-agreed"]) {
      expect(content).toContain(token);
    }
    // Trivial-change skip-gate (EARS stub only).
    expect(content).toMatch(/skip/i);
    expect(content).toContain("EARS stub");
  });

  it("FR-FLOW-036 AC-4: the SDS rules document is additive — existing SRS-MD rules references stay unchanged", async () => {
    // The repository index still references the SRS-MD Authoring Rules; the SDS
    // rules ship as an independent new file beside them.
    const index = await readFile(path.join(REPO_ROOT, "docs", "spec", "00.index.md"), "utf8");
    expect(index).toContain("SRS-MD Authoring Rules v3.0.0");
    expect(index).toContain("../rule/SRS-MD-Rules-v3.0.0.md");
  });

  it("FR-FLOW-036 AC-3: embeds a copyable design.md template with all required headings", async () => {
    const content = await rules();
    // The template is an embedded fenced markdown block starting with the SDS title.
    expect(content).toContain("# SDS:");
    for (const heading of REQUIRED_HEADINGS) {
      // Template headings appear as `## N. <heading>` inside the fenced template.
      expect(content).toMatch(new RegExp(`## \\d+\\. ${heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    }
    // The template metadata table rows.
    expect(content).toContain("| Document Type | sds |");
  });
});
