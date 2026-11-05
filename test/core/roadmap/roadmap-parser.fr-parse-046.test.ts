import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { parseRoadmap } from "../../../src/core/roadmap/parse-roadmap.js";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";
import { lineOf, roadmapText, sources, type ItemSpec } from "./roadmap-fixture.js";

// FR-PARSE-046 — the roadmap parser: `docs/roadmap.md` read with its own grammar, as a pure function
// of the text and the SRS facts, every defect reported with a ROADMAP- code at its line.

function found(text: string, src = sources()): string[] {
  return parseRoadmap(text, src).diagnostics.map((item) => `${item.code}@${item.line}`);
}

function codes(text: string, src = sources()): string[] {
  return parseRoadmap(text, src).diagnostics.map((item) => item.code);
}

const clean: ItemSpec[] = [
  { n: 1, title: "First", fields: { Kind: "milestone", Targets: "1.0.0", "Planned Start": "2026-11", "Planned End": "2026-Q4" } },
  { n: 2, title: "Second", fields: { Milestone: "RM-1", Requirements: "FR-A-001", PRD: "docs/prd/2026-11-01.alpha.prd.md", "Planned End": "2026-11-20" } }
];

describe("FR-PARSE-046 a clean document", () => {
  it("parses items, fields, sections and history with no diagnostic", () => {
    const text = roadmapText(...clean);
    const parsed = parseRoadmap(text, sources());
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.document.items.map((item) => [item.id, item.number, item.title, item.line])).toEqual([
      ["RM-1", 1, "First", lineOf(text, "### RM-1")],
      ["RM-2", 2, "Second", lineOf(text, "### RM-2")]
    ]);
    const second = parsed.document.items[1]!;
    expect(second.fields.Milestone?.value).toBe("RM-1");
    expect(second.fields.Milestone?.line).toBe(lineOf(text, "| Milestone | RM-1"));
    expect(second.sections.Purpose?.text).toBe("Purpose of item 2.");
    expect(second.history).toEqual([
      { date: "2026-11-01", field: "Created", from: "-", to: "-", reason: "fixture", line: lineOf(text, "| 2026-11-01 | Created", lineOf(text, "### RM-2")) }
    ]);
  });
});

describe("FR-PARSE-046 AC-1 — item headings and numbering", () => {
  // @req FR-PARSE-046 AC-1
  it("reports a malformed `### RM-` heading as ROADMAP-E001 and ignores headings inside a fence", () => {
    const text = roadmapText(
      { n: 1 },
      { n: 2, heading: "### RM-2 - hyphen instead of em dash" },
      { n: 3, sections: ["```", "### RM-9 — fenced example", "```", ""] }
    );
    const result = found(text);
    expect(result).toContain(`ROADMAP-E001@${lineOf(text, "### RM-2 - hyphen")}`);
    expect(result.filter((entry) => entry.startsWith("ROADMAP-E001"))).toHaveLength(1);
    // The fenced heading is no item, so RM-9 never enters the numbering.
    expect(parseRoadmap(text, sources()).document.items.map((item) => item.id)).toEqual(["RM-1", "RM-3"]);
  });

  // @req FR-PARSE-046 AC-1
  it("reports RM-0 and a leading zero as ROADMAP-E001", () => {
    expect(codes(roadmapText({ n: 1, heading: "### RM-0 — zero" }))).toContain("ROADMAP-E001");
    expect(codes(roadmapText({ n: 1, heading: "### RM-01 — padded" }))).toContain("ROADMAP-E001");
  });

  // @req FR-PARSE-046 AC-1
  it("reports ROADMAP-E002 for a gap and for a duplicate, at the item out of sequence", () => {
    const gap = roadmapText({ n: 1 }, { n: 3 });
    expect(found(gap)).toContain(`ROADMAP-E002@${lineOf(gap, "### RM-3")}`);
    const duplicate = roadmapText({ n: 1 }, { n: 1, title: "Again" });
    expect(found(duplicate)).toContain(`ROADMAP-E002@${lineOf(duplicate, "### RM-1 — Again")}`);
    const ordered = roadmapText({ n: 1 }, { n: 2 }, { n: 3 });
    expect(codes(ordered)).not.toContain("ROADMAP-E002");
  });
});

describe("FR-PARSE-046 AC-2 — metadata rows, sections and enums", () => {
  // @req FR-PARSE-046 AC-2
  it("reports a missing row and an unknown row as ROADMAP-E003", () => {
    const text = roadmapText({ n: 1 }).replace("| Owner | - |\n", "").replace("| Lifecycle | open |", "| Lifecycle | open |\n| Colour | red |");
    const result = found(text);
    expect(result).toContain(`ROADMAP-E003@${lineOf(text, "### RM-1")}`);
    expect(result).toContain(`ROADMAP-E003@${lineOf(text, "| Colour")}`);
    const messages = parseRoadmap(text, sources()).diagnostics.map((item) => item.message).join("\n");
    expect(messages).toContain("Owner");
    expect(messages).toContain("Colour");
  });

  // @req FR-PARSE-046 AC-2
  it("reports a section other than the four as ROADMAP-E003 and accepts the four", () => {
    const text = roadmapText({ n: 1, sections: ["#### Description", "", "Text.", "", "#### Features", "", "- one", "", "#### Notes", "", "x", ""] });
    expect(found(text)).toEqual([`ROADMAP-E003@${lineOf(text, "#### Notes")}`]);
  });

  // @req FR-PARSE-046 AC-2
  it("reports a Kind or Lifecycle outside its set as ROADMAP-E004 and accepts every listed value", () => {
    const text = roadmapText({ n: 1, fields: { Kind: "epic" } }, { n: 2, fields: { Lifecycle: "done" } });
    expect(found(text)).toEqual([`ROADMAP-E004@${lineOf(text, "| Kind | epic")}`, `ROADMAP-E004@${lineOf(text, "| Lifecycle | done")}`]);
    for (const lifecycle of ["open", "paused", "cancelled"]) {
      expect(codes(roadmapText({ n: 1, fields: { Kind: "milestone", Lifecycle: lifecycle } }))).toEqual([]);
    }
  });
});

describe("FR-PARSE-046 AC-3 — date forms", () => {
  // @req FR-PARSE-046 AC-3
  it("accepts day, month and quarter for planned dates and only a day for actual dates", () => {
    for (const value of ["-", "2026-11-04", "2026-11", "2026-Q4"]) {
      expect(codes(roadmapText({ n: 1, fields: { "Planned Start": value } })), value).toEqual([]);
    }
    const month = roadmapText({ n: 1, fields: { "Actual Start": "2026-11" } });
    expect(found(month)).toEqual([`ROADMAP-E005@${lineOf(month, "| Actual Start")}`]);
    const quarter = roadmapText({ n: 1, fields: { "Actual End": "2026-Q4" } });
    expect(found(quarter)).toEqual([`ROADMAP-E005@${lineOf(quarter, "| Actual End")}`]);
  });

  // @req FR-PARSE-046 AC-3
  it("reports any other planned value, including an impossible calendar date, as ROADMAP-E005", () => {
    for (const value of ["next week", "2026-13", "2026-Q5", "2026-02-30", "26-11-04"]) {
      expect(codes(roadmapText({ n: 1, fields: { "Planned End": value } })), value).toEqual(["ROADMAP-E005"]);
    }
  });

  // @req FR-PARSE-046 AC-3
  it("reports an end earlier than its start on the normalized ranges as ROADMAP-E006", () => {
    const early = roadmapText({ n: 1, fields: { "Planned Start": "2026-12", "Planned End": "2026-11-30" } });
    expect(found(early)).toEqual([`ROADMAP-E006@${lineOf(early, "| Planned End")}`]);
    // A quarter ending inside the start month's range is not earlier than it.
    expect(codes(roadmapText({ n: 1, fields: { "Planned Start": "2026-12", "Planned End": "2026-Q4" } }))).toEqual([]);
    const actual = roadmapText({ n: 1, fields: { "Actual Start": "2026-11-05", "Actual End": "2026-11-04" } });
    expect(found(actual)).toEqual([`ROADMAP-E006@${lineOf(actual, "| Actual End")}`]);
  });
});

describe("FR-PARSE-046 AC-4 — item references", () => {
  // @req FR-PARSE-046 AC-4
  it("reports Milestone and Depends On entries naming no item as ROADMAP-E007", () => {
    const text = roadmapText({ n: 1, fields: { Milestone: "RM-7" } }, { n: 2, fields: { "Depends On": "RM-1, RM-8" } });
    expect(found(text)).toEqual([`ROADMAP-E007@${lineOf(text, "| Milestone | RM-7")}`, `ROADMAP-E007@${lineOf(text, "| Depends On | RM-1, RM-8")}`]);
  });

  // @req FR-PARSE-046 AC-4
  it("reports a Milestone naming a feature and a milestone that has a Milestone as ROADMAP-E007", () => {
    const feature = roadmapText({ n: 1 }, { n: 2, fields: { Milestone: "RM-1" } });
    expect(found(feature)).toEqual([`ROADMAP-E007@${lineOf(feature, "| Milestone | RM-1")}`]);
    const nested = roadmapText({ n: 1, fields: { Kind: "milestone" } }, { n: 2, fields: { Kind: "milestone", Milestone: "RM-1" } });
    expect(found(nested)).toEqual([`ROADMAP-E007@${lineOf(nested, "| Milestone | RM-1")}`]);
  });

  // @req FR-PARSE-046 AC-4
  it("reports a Depends On cycle and a feature depending on its own milestone as ROADMAP-E008", () => {
    const cycle = roadmapText({ n: 1, fields: { "Depends On": "RM-2" } }, { n: 2, fields: { "Depends On": "RM-1" } }, { n: 3, fields: { "Depends On": "RM-3" } });
    expect(codes(cycle).filter((code) => code === "ROADMAP-E008")).toHaveLength(2);
    const own = roadmapText({ n: 1, fields: { Kind: "milestone" } }, { n: 2, fields: { Milestone: "RM-1", "Depends On": "RM-1" } });
    expect(found(own)).toEqual([`ROADMAP-E008@${lineOf(own, "| Depends On | RM-1")}`]);
    expect(codes(roadmapText({ n: 1 }, { n: 2, fields: { "Depends On": "RM-1" } }))).toEqual([]);
  });
});

describe("FR-PARSE-046 AC-5 — references into the SRS and the PRD files, and plan warnings", () => {
  // @req FR-PARSE-046 AC-5
  it("warns on an unknown target, an unknown or discarded requirement and an unlisted PRD path", () => {
    const text = roadmapText({ n: 1, fields: { Targets: "1.0.0, 9.9.9", Requirements: "FR-A-001, FR-A-002, FR-Z-999", PRD: "docs/prd/missing.prd.md" } });
    const result = parseRoadmap(text, sources()).diagnostics;
    expect(result.map((item) => `${item.code}@${item.line}`)).toEqual([
      `ROADMAP-W009@${lineOf(text, "| Targets")}`,
      `ROADMAP-W010@${lineOf(text, "| Requirements")}`,
      `ROADMAP-W010@${lineOf(text, "| Requirements")}`,
      `ROADMAP-W011@${lineOf(text, "| PRD")}`
    ]);
    expect(result.every((item) => item.severity === "warning")).toBe(true);
    const messages = result.map((item) => item.message).join("\n");
    for (const name of ["9.9.9", "FR-A-002", "FR-Z-999", "docs/prd/missing.prd.md"]) expect(messages).toContain(name);
    expect(messages).not.toContain("FR-A-001");
  });

  // @req FR-PARSE-046 AC-5
  it("warns with ROADMAP-W012 when an item starts before an item it depends on ends", () => {
    const text = roadmapText({ n: 1, fields: { "Planned End": "2026-11-20" } }, { n: 2, fields: { "Depends On": "RM-1", "Planned Start": "2026-11-10" } });
    expect(found(text)).toEqual([`ROADMAP-W012@${lineOf(text, "| Planned Start | 2026-11-10")}`]);
    expect(codes(roadmapText({ n: 1, fields: { "Planned End": "2026-11-20" } }, { n: 2, fields: { "Depends On": "RM-1", "Planned Start": "2026-11-21" } }))).toEqual([]);
  });

  // @req FR-PARSE-046 AC-5
  it("warns with ROADMAP-W013 when a feature's planned range leaves its milestone's", () => {
    const outside = roadmapText(
      { n: 1, fields: { Kind: "milestone", "Planned Start": "2026-11-01", "Planned End": "2026-11-30" } },
      { n: 2, fields: { Milestone: "RM-1", "Planned End": "2026-12-15" } },
      { n: 3, fields: { Milestone: "RM-1", "Planned Start": "2026-10-20" } }
    );
    expect(found(outside)).toEqual([`ROADMAP-W013@${lineOf(outside, "### RM-2")}`, `ROADMAP-W013@${lineOf(outside, "### RM-3")}`]);
    const inside = roadmapText(
      { n: 1, fields: { Kind: "milestone", "Planned Start": "2026-11-01", "Planned End": "2026-11-30" } },
      { n: 2, fields: { Milestone: "RM-1", "Planned Start": "2026-11-05", "Planned End": "2026-11-29" } }
    );
    expect(codes(inside)).toEqual([]);
  });
});

describe("FR-PARSE-046 AC-6 — Change History rows", () => {
  // @req FR-PARSE-046 AC-6
  it("reports a row without five cells or with a malformed date as ROADMAP-E016", () => {
    const text = roadmapText({
      n: 1,
      history: [
        ["2026-11-01", "Created", "-", "-", "fixture"],
        ["2026-11-02", "Owner", "-", "kim"],
        ["11/03/2026", "Owner", "kim", "lee", "typo"]
      ]
    });
    expect(found(text)).toEqual([`ROADMAP-E016@${lineOf(text, "| 2026-11-02")}`, `ROADMAP-E016@${lineOf(text, "| 11/03/2026")}`]);
  });

  // @req FR-PARSE-046 AC-6
  it("warns with ROADMAP-W016 when a date or Lifecycle value differs from the To of its last history row", () => {
    const text = roadmapText({
      n: 1,
      fields: { "Planned End": "2026-12-01", Lifecycle: "open" },
      history: [
        ["2026-11-01", "Created", "-", "-", "fixture"],
        ["2026-11-02", "Planned End", "-", "2026-11-20", "plan"],
        ["2026-11-03", "Planned End", "2026-11-20", "2026-11-25", "moved"],
        ["2026-11-04", "Lifecycle", "open", "paused", "hold"]
      ]
    });
    expect(found(text)).toEqual([`ROADMAP-W016@${lineOf(text, "| Planned End")}`, `ROADMAP-W016@${lineOf(text, "| Lifecycle")}`]);
    const agreeing = roadmapText({
      n: 1,
      fields: { "Planned End": "2026-11-25", Owner: "kim" },
      history: [
        ["2026-11-01", "Created", "-", "-", "fixture"],
        ["2026-11-02", "Planned End", "-", "2026-11-20", "plan"],
        ["2026-11-03", "Planned End", "2026-11-20", "2026-11-25", "the last row is the one compared"],
        ["2026-11-04", "Owner", "-", "lee", "Owner is not a checked field"]
      ]
    });
    expect(codes(agreeing)).toEqual([]);
  });
});

describe("FR-PARSE-046 AC-7 — no status and no criteria in a roadmap", () => {
  // @req FR-PARSE-046 AC-7
  it("reports a Status row and an acceptance-criterion line anywhere in an item as ROADMAP-E017", () => {
    const text = roadmapText({ n: 1, sections: ["#### Features", "", "- [ ] AC-1 search works", "- [x] AC-2 ranked", ""] }).replace(
      "| Lifecycle | open |",
      "| Lifecycle | open |\n| Status | done |"
    );
    expect(found(text)).toEqual([
      `ROADMAP-E017@${lineOf(text, "| Status | done")}`,
      `ROADMAP-E017@${lineOf(text, "- [ ] AC-1")}`,
      `ROADMAP-E017@${lineOf(text, "- [x] AC-2")}`
    ]);
  });
});

describe("FR-PARSE-046 AC-8 — pure, deterministic and invisible to the requirement readers", () => {
  // @req FR-PARSE-046 AC-8
  it("gives byte-identical diagnostics on repeated runs and on different dates without reading the clock", () => {
    const text = roadmapText({ n: 1, fields: { "Planned End": "2020-01-01", Targets: "9.9.9" } }, { n: 3 });
    const first = JSON.stringify(parseRoadmap(text, sources()));
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2031-06-01T12:00:00Z"));
      expect(JSON.stringify(parseRoadmap(text, sources()))).toBe(first);
    } finally {
      vi.useRealTimers();
    }
    expect(first).toContain("ROADMAP-W009");
  });

  // @req FR-PARSE-046 AC-8
  it("reuses the shared table parser, so a metadata row is read the way every table row is", async () => {
    const source = await readFile(path.join("src", "core", "roadmap", "parse-roadmap.ts"), "utf8");
    expect(source).toContain("parseMarkdownTableResult");
    expect(source).not.toMatch(/from "node:fs/);
    // A row with surrounding spaces and no closing pipe is read by the shared parser like any other.
    const text = roadmapText({ n: 1 }).replace("| Owner | - |", "|   Owner   |   kim");
    expect(parseRoadmap(text, sources()).document.items[0]?.fields.Owner?.value).toBe("kim");
  });

  // @req FR-PARSE-046 AC-8
  it("puts no roadmap item into the requirement records", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");
    await writeFile(path.join(rootPath, "docs", "roadmap.md"), roadmapText(...clean), "utf8");
    const workspace = await parseWorkspace(await resolveProjectRoot(rootPath));
    expect(workspace.records.map((record) => record.id).filter((id) => id.startsWith("RM-"))).toEqual([]);
    expect(workspace.files.map((file) => file.relativePath)).not.toContain("docs/roadmap.md");
    expect(workspace.records.length).toBeGreaterThan(0);
  });
});
