import { describe, expect, it } from "vitest";
import { parseWorkspace } from "../../src/core/parser/workspace-parser.js";
import { resolveProjectRoot } from "../../src/core/project-root.js";
import {
  citesALine,
  collectTraceLinkCitations,
  formatTraceLinkCitations
} from "../support/trace-link-citations.js";

// @req FR-NODE-206 AC-2 / AC-6 — a Trace Link reference names a file, never a line.
//
// Measured rather than argued: one item's work on three source files left twenty designations in
// docs/spec pointing at moved lines, and nothing reddened. The numbers are read by nothing — the link
// checker resolved Requirement rows only, releaseReadiness strips a trailing line suffix before it
// resolves the path, and add_requirement imposes no range on a Code row — so they are dropped rather
// than repaired. Repair would not converge: the Change Note each one needs shifts the lines below it,
// and this tree holds designations that point at docs/spec itself.

const REPO_ROOT = process.cwd();

async function repositoryRecords() {
  return (await parseWorkspace(await resolveProjectRoot(REPO_ROOT))).records;
}

describe("FR-NODE-206 AC-2 — no Trace Link reference in docs/spec carries a line suffix", () => {
  it("holds over every such row rather than over a sample", async () => {
    const records = await repositoryRecords();
    const rows = records.flatMap((record) => record.traceLinks.filter((row) => row.type !== "Requirement"));
    // The denominator is asserted alongside the verdict so an empty scan cannot pass for a clean one.
    expect(rows.length, "the scan reached no Trace Links row").toBeGreaterThan(0);

    const found = collectTraceLinkCitations(records);

    expect(
      formatTraceLinkCitations(found),
      "a Trace Link reference names a line that a source edit will move without it"
    ).toBe("");
  });
});

describe("FR-NODE-206 AC-6 — the ban is on the reference field, and it is inherited not reinvented", () => {
  const owner = (rows: Array<{ type: string; reference: string; notes: string }>) => [
    { id: "FR-ARCH-001", filePath: "docs/spec/10.product-architecture.srs.md", traceLinks: rows }
  ];

  it("reports a Code row that names a line, with its requirement, row type and reference", () => {
    const found = collectTraceLinkCitations(owner([{ type: "Code", reference: "src/cli/commands/read.ts:294", notes: "-" }]));

    expect(found).toEqual([
      {
        requirementId: "FR-ARCH-001",
        file: "docs/spec/10.product-architecture.srs.md",
        type: "Code",
        reference: "src/cli/commands/read.ts:294"
      }
    ]);
  });

  it("reports a range as well as a single line", () => {
    const found = collectTraceLinkCitations(owner([{ type: "Code", reference: "src/mcp/errors.ts:8-15", notes: "-" }]));

    expect(found.map((entry) => entry.reference)).toEqual(["src/mcp/errors.ts:8-15"]);
  });

  it("reports a line named at the head of a semicolon-separated list, where the anchor cannot reach", () => {
    // The designation sits mid-string, so the pattern's end anchor passes over it and only the
    // semicolon split brings it into view. A tail-only fixture leaves that split unasserted.
    const rows = [{ type: "Code", reference: "src/core/a.ts:40; src/core/b.ts", notes: "-" }];

    expect(collectTraceLinkCitations(owner(rows))).toHaveLength(1);
  });

  it("reports a line named at the tail of that list too", () => {
    const rows = [{ type: "Code", reference: "src/core/a.ts; src/core/b.ts:40", notes: "-" }];

    expect(collectTraceLinkCitations(owner(rows))).toHaveLength(1);
  });

  it("honours the exemption spelling FR-FLOW-141 established, on the row's own Notes cell", () => {
    const rows = [
      { type: "Code", reference: "src/cli/commands/read.ts:294", notes: "@cite-lint: ignore — the shape itself" },
      { type: "Code", reference: "src/cli/commands/write.ts:12", notes: "-" }
    ];

    expect(collectTraceLinkCitations(owner(rows)).map((entry) => entry.reference)).toEqual([
      "src/cli/commands/write.ts:12"
    ]);
  });

  it("leaves a Requirement row alone, whose reference is an id and not a path", () => {
    const rows = [{ type: "Requirement", reference: "FR-NODE-206", notes: "-" }];

    expect(collectTraceLinkCitations(owner(rows))).toEqual([]);
  });

  it("does not reach a designation written in the Notes cell, because the ban is on the field", () => {
    const rows = [{ type: "Code", reference: "src/core/query/links.ts", notes: "mirrored at read.ts:294" }];

    expect(collectTraceLinkCitations(owner(rows))).toEqual([]);
  });

  it("formats a report a reader can act on without searching", () => {
    const line = formatTraceLinkCitations([
      { requirementId: "FR-ARCH-001", file: "docs/spec/10.a.srs.md", type: "Code", reference: "src/a.ts:3" }
    ]);

    expect(line).toBe("docs/spec/10.a.srs.md FR-ARCH-001 [Code] cites src/a.ts:3");
  });
});

describe("FR-NODE-206 AC-6 — the extension anchor excludes a tally and a clock by structure", () => {
  it.each([
    ["a path with no suffix", "src/cli/commands/read.ts"],
    ["a path with a heading fragment", "skills/claude/kiwi-wave-master/SKILL.md#5.5"],
    ["a committee tally", "5:0"],
    ["a clock reading", "12:48:33"],
    ["a task id", "T-PH001-02"],
    ["a requirement id", "FR-NODE-206"],
    ["a version", "v2.5.0"],
    ["a sentence naming a rules document", "the SRS-MD rules document BUNDLED_SRS_RULES_FILENAME names, section 30.2"],
    ["a semicolon-separated list of files with no suffix", "src/core/a.ts; src/core/b.ts"],
    ["a dotted number that is not an extension", "1.2:34"]
  ])("passes %s", (_label, reference) => {
    expect(citesALine(reference)).toBe(false);
  });

  it.each([
    ["a single line", "src/cli/commands/read.ts:294"],
    ["a range", "src/mcp/errors.ts:8-15"],
    ["a line and column", "src/core/query/links.ts:30:5"],
    ["a markdown file", "skills/claude/_shared/kiwi/pipeline-event.md:118-120"],
    ["a manifest at the root", "package.json:1-4"]
  ])("reports %s", (_label, reference) => {
    expect(citesALine(reference)).toBe(true);
  });
});
