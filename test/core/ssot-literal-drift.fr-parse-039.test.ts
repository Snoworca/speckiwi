import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { collectSsotLiteralDrift } from "../../src/core/validator/ssot-literal-drift.js";
import { collectSsotSpans } from "../../src/core/validator/rules.js";
import { SSOT_LITERAL_REGISTRY, SSOT_REGISTRY_MODULES } from "../../src/core/ssot-literal-registry.js";
import { parseWorkspace } from "../../src/core/parser/workspace-parser.js";
import { resolveProjectRoot } from "../../src/core/project-root.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";
import { validateWorkspace } from "../../src/core/validator/validate-workspace.js";

// @req FR-PARSE-039 — a criterion that quotes a stale value of a shipped constant is reported.
//
// The expectations here are stated independently of the registry wherever a mistake in the registry
// would otherwise agree with them. The completeness case in particular reads the modules, not the
// registry, because a registry that supplied its own denominator would pass whatever it contained.

const DIAGNOSTIC_CODE = "SRS-W073";
const REPO = new URL("../../", import.meta.url);

// The repository root, from this file's own location. A hardcoded absolute path in the suite
// for a requirement about hardcoded values would be its own joke, and would fail on CI.
const REPO_PATH = fileURLToPath(new URL("../../", import.meta.url)).replace(/[\\/]$/, "");

async function workspace() {
  return parseWorkspace(await resolveProjectRoot(REPO_PATH, REPO_PATH));
}

/** Every string-valued `export const` in a module, read from the source rather than imported. */
async function stringExportsOf(module: string): Promise<string[]> {
  const text = await readFile(new URL(module, REPO), "utf8");
  const names: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const match = /^export const (\w+)\s*(?::[^=]+)?=\s*(.)/.exec(line);
    if (!match) continue;
    const opener = match[2] as string;
    // A string, a template literal, an array of strings or a record of them: anything whose value
    // a criterion could quote. A function or a plain number could not.
    if (opener === '"' || opener === "'" || opener === "`" || opener === "[" || opener === "{") {
      names.push(match[1] as string);
    }
  }
  return names;
}

describe("FR-PARSE-039 — a criterion quoting a stale constant is reported", () => {
  // AC-5: the denominator comes from the modules, not from the registry.
  it("AC-5: every string export of every registry module is classified", async () => {
    const registered = new Map(SSOT_LITERAL_REGISTRY.map((entry) => [`${entry.module}::${entry.name}`, entry]));
    const unclassified: string[] = [];

    for (const module of SSOT_REGISTRY_MODULES) {
      const names = await stringExportsOf(module);
      expect(names.length, `${module} should have string exports to classify`).toBeGreaterThan(0);
      for (const name of names) {
        if (!registered.has(`${module}::${name}`)) unclassified.push(`${module}::${name}`);
      }
    }
    expect(unclassified, "classify these, with a reason when they are outside the comparison").toEqual([]);
  });

  // AC-5: the two roles that opt out must say why.
  it("AC-5: every opted-out entry states a reason", () => {
    for (const entry of SSOT_LITERAL_REGISTRY) {
      if (entry.role !== "unshaped" && entry.role !== "not-an-ssot") continue;
      expect(entry.reason?.trim(), `${entry.name} must say why it is outside the comparison`).toBeTruthy();
    }
  });

  // HIGH: the registry records each constant's current value by hand, and nothing had ever
  // compared those copies to the exports themselves. A drift checker whose own copy of the
  // value can drift reports current text as stale and stale text as current — it is exposed to
  // exactly what it exists to catch. Resolve the real values and compare.
  it("AC-1: every recorded value matches the export it claims to copy", async () => {
    const templates = await import("../../src/core/bootstrap/templates.js");
    const modules: Record<string, Record<string, unknown>> = {
      "src/core/bootstrap/templates.ts": templates as unknown as Record<string, unknown>
    };

    // Entries whose recorded value is a part of the export rather than the whole of it: the
    // shape carries the varying part, so the value is what that part currently reads.
    const VERSION_OF: Record<string, string> = {
      AGENT_INSTRUCTION_HEADING_PREFIX: "AGENT_INSTRUCTION_VERSION",
      BUNDLED_SRS_RULES_FILENAME: "BUNDLED_RULES_VERSION",
      BUNDLED_SDS_RULES_FILENAME: "BUNDLED_SDS_RULES_VERSION"
    };

    let compared = 0;
    for (const entry of SSOT_LITERAL_REGISTRY) {
      if (entry.value === undefined) continue;
      const module = modules[entry.module];
      if (module === undefined) continue;

      const versionExport = VERSION_OF[entry.name];
      const expected = versionExport === undefined ? module[entry.name] : module[versionExport];
      expect(typeof expected, `${entry.name} should resolve to a string`).toBe("string");
      expect(entry.value, `${entry.name}: the registry's copy has drifted from the export`).toBe(expected);
      compared += 1;
    }
    expect(compared, "the comparison must actually reach entries").toBeGreaterThan(3);
  });
  // AC-6: a compatibility-only export must never be treated as the value in force. That is the
  // trap this contract exists for: a check that scans a module's string exports picks up the Korean
  // heading kept for recognising older files, calls it current, and lets the criteria quoting it
  // through. Opting one out with a reason is fine; calling it current is not.
  it("AC-6: no LEGACY_ export is classified as the value in force", () => {
    const named = SSOT_LITERAL_REGISTRY.filter((entry) => entry.name.startsWith("LEGACY_"));
    expect(named.length, "some export should carry that name").toBeGreaterThan(0);
    for (const entry of named) {
      expect(entry.role, `${entry.name} is kept for compatibility`).not.toBe("current");
    }
    // And at least one is actually compared as compatibility-only, so the role is not decorative.
    expect(named.some((entry) => entry.role === "legacy")).toBe(true);
  });

  // AC-7: every entry in force proves it reports a stale value of its own constant. The two kinds
  // are compared differently — a versioned value by its shape, a marker by how it opens — so the
  // stale string is built from whichever the entry carries.
  const inForce = SSOT_LITERAL_REGISTRY.filter((entry) => entry.role === "current");
  it.each(inForce)("AC-7: a stale $name is reported", (entry) => {
    let stale: string;
    if (entry.shape !== undefined) {
      stale = entry.shape.source
        .replace(/\(\\d\+\(\?:\\\.\\d\+\)\*\)/, "0.0.1")
        .replace(/\\\./g, ".")
        .replace(/\\/g, "");
    } else if (entry.markerPrefix !== undefined) {
      stale = `${entry.markerPrefix} v0.0.1 -->`;
    } else {
      throw new Error(`${entry.name} is in force but carries neither a shape nor a marker prefix`);
    }

    const findings = collectSsotLiteralDrift([
      { requirementId: "FR-TEST-001", filePath: "docs/spec/test.md", line: 1, section: "acceptanceCriteria", text: `the file ${stale} is installed` }
    ]);
    expect(findings.map((finding) => finding.constantName)).toContain(entry.name);
  });

  // AC-2: a compatibility-only value is reported wherever it appears in a live section.
  it("AC-2: a compatibility-only value is reported", () => {
    const legacy = SSOT_LITERAL_REGISTRY.find((entry) => entry.role === "legacy");
    expect(legacy).toBeDefined();
    const findings = collectSsotLiteralDrift([
      { requirementId: "FR-TEST-002", filePath: "docs/spec/test.md", line: 2, section: "acceptanceCriteria", text: `the heading reads ${legacy!.value}1.1` }
    ]);
    expect(findings.map((finding) => finding.constantName)).toContain(legacy!.name);
  });

  // AC-1: a current value is not reported.
  it("AC-1: a current value is left alone", () => {
    const findings = collectSsotLiteralDrift([
      { requirementId: "FR-TEST-003", filePath: "docs/spec/test.md", line: 3, section: "acceptanceCriteria", text: "installs SRS-MD-Rules-v2.5.0.md and SDS-MD-Rules-v2.5.0.md" }
    ]);
    expect(findings).toEqual([]);
  });

  // AC-4: the sections that describe the past are not reported; those that describe now are.
  it("AC-4: change notes and implementation notes are exempt", () => {
    const staleText = "the heading read # SpecKiwi SRS workflow v1.4";
    for (const section of ["changeNotes", "implementationNotes"] as const) {
      const findings = collectSsotLiteralDrift([
        { requirementId: "FR-TEST-004", filePath: "docs/spec/test.md", line: 4, section, text: staleText }
      ]);
      expect(findings, `${section} describes what was true then`).toEqual([]);
    }
    for (const section of ["acceptanceCriteria", "requirement", "sample", "traceLinks"] as const) {
      const findings = collectSsotLiteralDrift([
        { requirementId: "FR-TEST-004", filePath: "docs/spec/test.md", line: 4, section, text: staleText }
      ]);
      expect(findings.length, `${section} says what is true now`).toBeGreaterThan(0);
    }
  });

  // AC-3, the wiring itself. Asserting zero findings against a clean repository says nothing
  // about whether the pass carries the diagnostic: cut the wiring and the count is still zero.
  // Plant one into a copied workspace and require the shared pass to report it.
  it("AC-3: the shared pass reports a planted value in a real workspace", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    const indexPath = path.join(root, "docs", "spec", "00.index.md");
    const before = await readFile(indexPath, "utf8");
    await writeFile(indexPath, `${before}\n\nThe rules live in SRS-MD-Rules-v0.0.1.md.\n`, "utf8");

    const parsed = await parseWorkspace(await resolveProjectRoot(root, root));
    const ours = validateWorkspace(parsed).diagnostics.filter((item) => item.code === DIAGNOSTIC_CODE);

    expect(ours.length, "the shared pass must carry this diagnostic").toBeGreaterThan(0);
    expect(ours[0]!.severity, "info would leave validate --fail-on-warning at zero").toBe("warning");
    expect(typeof ours[0]!.line, "every finding carries a line").toBe("number");
    expect(ours[0]!.message).toContain("BUNDLED_SRS_RULES_FILENAME");
  });

  // And the line is the planted one, not the first line of the file: a finding that cannot be
  // located is a finding an agent has to go looking for.
  it("AC-1: a planted value is reported at its own line", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    const indexPath = path.join(root, "docs", "spec", "00.index.md");
    const before = await readFile(indexPath, "utf8");
    const lines = before.split(/\r?\n/);
    lines.push("", "The rules live in SDS-MD-Rules-v0.0.1.md.");
    await writeFile(indexPath, lines.join("\n"), "utf8");

    const parsed = await parseWorkspace(await resolveProjectRoot(root, root));
    const ours = validateWorkspace(parsed).diagnostics.filter((item) => item.code === DIAGNOSTIC_CODE);

    expect(ours).toHaveLength(1);
    expect(ours[0]!.line).toBe(lines.length);
  });
  // AC-3: registered at warning or higher, and emitted from the shared pass.
  it("AC-3: the diagnostic is emitted by the shared validation pass", async () => {
    const parsed = await workspace();
    const result = validateWorkspace(parsed);
    const ours = result.diagnostics.filter((diagnostic) => diagnostic.code === DIAGNOSTIC_CODE);
    // Phase 1 repaired every occurrence, so the repository is clean and this must stay at zero:
    // the pass carrying the diagnostic is proved by the planted cases above, and by the mutation
    // that cuts the wiring. A finding here means a criterion spelled a value out again.
    expect(ours.map((d) => d.message), "no criterion should name a stale value").toEqual([]);
    for (const diagnostic of ours) {
      expect(["error", "warning"]).toContain(diagnostic.severity);
      expect(typeof diagnostic.line, "every finding must carry a line").toBe("number");
    }
  });

  // AC-3, continued: the code is registered, and at a severity the exit path can see.
  it("AC-3: the code is registered at warning or higher", async () => {
    const { getDiagnosticDefinition } = await import("../../src/core/diagnostic-registry.js");
    const definition = getDiagnosticDefinition(DIAGNOSTIC_CODE);
    expect(["error", "warning"]).toContain(definition.severity);
  });

  // AC-1 and AC-2 over the repository itself, as an exact set rather than a count. The baseline
  // was produced by enumerating what the check reports, not by listing what someone expected it
  // to report: a hand-counted inventory is short, and a short inventory becomes the pass mark.
  it("AC-1/AC-2: the reported occurrences are exactly the frozen set", async () => {
    const baseline = JSON.parse(await readFile(new URL("../fixtures/ssot-literal-drift-baseline.json", import.meta.url), "utf8")) as {
      code: string;
      occurrences: Array<{ requirementId: string | null; filePath: string; line: number; message: string }>;
    };
    expect(baseline.code).toBe(DIAGNOSTIC_CODE);

    const parsed = await workspace();
    const actual = validateWorkspace(parsed)
      .diagnostics.filter((diagnostic) => diagnostic.code === DIAGNOSTIC_CODE)
      .map((diagnostic) => ({
        requirementId: diagnostic.requirementId ?? null,
        filePath: diagnostic.filePath as string,
        line: diagnostic.line as number,
        message: diagnostic.message
      }));

    const key = (row: { filePath: string; line: number; message: string }) =>
      `${row.filePath}:${String(row.line).padStart(6, "0")}:${row.message}`;
    expect(actual.map(key).sort()).toEqual(baseline.occurrences.map(key).sort());

    // The frozen set is empty now. It was 29 before Phase 1, and the shape of the file is what
    // keeps the comparison exact rather than a count that a partial repair could satisfy.
    expect(baseline.occurrences).toEqual([]);
  });
  // The repository is clean now, which means the cases above stopped exercising two things: that
  // a reference sample outside any requirement block is collected at all, and that a requirement
  // body is reported at the line the text sits on rather than at the block heading. Turning either
  // off changed nothing observable. Plant them instead.
  it("AC-4: a reference sample outside a requirement block is collected and reported", () => {
    const spans = collectSsotSpans({
      root: {} as never,
      index: {} as never,
      records: [],
      diagnostics: [],
      files: [
        {
          path: "docs/spec/90.appendix.md",
          relativePath: "docs/spec/90.appendix.md",
          text: "",
          lines: ["## 9. Sample", "", "SRS-MD-Rules-v0.0.1.md is installed"],
          newline: "\n"
        } as never
      ]
    } as never);

    const sample = spans.filter((span) => span.section === "sample");
    expect(sample.length, "a document with no requirement block still states things").toBeGreaterThan(0);

    const findings = collectSsotLiteralDrift(sample);
    expect(findings.map((finding) => finding.constantName)).toContain("BUNDLED_SRS_RULES_FILENAME");
    expect(findings[0]!.line, "reported at the line the sample sits on").toBe(3);
  });

  it("AC-1: a requirement body is reported at the offending line, not at its heading", () => {
    const spans = collectSsotSpans({
      root: {} as never,
      index: {} as never,
      diagnostics: [],
      records: [
        {
          id: "FR-TEST-900",
          filePath: "docs/spec/test.md",
          headingLine: 1,
          blockStartLine: 1,
          blockEndLine: 6,
          acceptanceCriteria: [],
          requirement: "The tool installs SRS-MD-Rules-v0.0.1.md."
        } as never
      ],
      files: [
        {
          path: "docs/spec/test.md",
          relativePath: "docs/spec/test.md",
          text: "",
          lines: [
            "### FR-TEST-900 — x",
            "",
            "#### Requirement",
            "",
            "The tool installs SRS-MD-Rules-v0.0.1.md.",
            ""
          ],
          newline: "\n"
        } as never
      ]
    } as never);

    const body = spans.filter((span) => span.section === "requirement");
    expect(body).toHaveLength(1);
    expect(body[0]!.line, "the heading is line 1; the text sits on line 5").toBe(5);

    const findings = collectSsotLiteralDrift(body);
    expect(findings.map((finding) => finding.line)).toEqual([5]);
  });
  // AC-3: a step requirement is carried by the same pass. The step-scoped pass is confined to a
  // step's own files by design, so covering step requirements has to happen here.
  it("AC-3: a step requirement is collected by the shared pass", () => {
    const spans = collectSsotSpans({
      root: {} as never,
      index: {} as never,
      diagnostics: [],
      records: [],
      files: [],
      stepRecords: [
        {
          id: "FR-STEP-900",
          filePath: "docs/spec/steps/x/srs.md",
          headingLine: 1,
          acceptanceCriteria: [{ id: "AC-1", text: "installs SRS-MD-Rules-v0.0.1.md", checked: false, line: 4 }],
          traceLinks: []
        } as never
      ]
    } as never);

    const findings = collectSsotLiteralDrift(spans);
    expect(findings.map((finding) => finding.requirementId)).toContain("FR-STEP-900");
  });

  // AC-4: a trace reference states what carries the requirement now. One of them named a rules
  // document that had moved, and the link checker walked past it: a bare path in a table cell is
  // not a Markdown link, so it reported nothing broken.
  it("AC-4: a trace reference naming a moved path is reported", () => {
    const spans = collectSsotSpans({
      root: {} as never,
      index: {} as never,
      diagnostics: [],
      files: [],
      records: [
        {
          id: "FR-TEST-901",
          filePath: "docs/spec/test.md",
          headingLine: 1,
          acceptanceCriteria: [],
          traceLinks: [{ type: "doc", reference: "docs/rule/SDS-MD-Rules-v0.0.1.md", relation: "implements", line: 9 }]
        } as never
      ]
    } as never);

    const trace = spans.filter((span) => span.section === "traceLinks");
    expect(trace).toHaveLength(1);
    const findings = collectSsotLiteralDrift(trace);
    expect(findings.map((finding) => finding.constantName)).toContain("BUNDLED_SDS_RULES_FILENAME");
    expect(findings[0]!.line).toBe(9);
  });
  // AC-4, the section boundary. A planting round put stale values in eight places; four of them
  // sat in sections nothing read. Two of those are pointers and are read now; the other two are
  // retrospective by definition and stay out, which this case fixes in both directions.
  it("AC-4: pointer sections are read and retrospective ones are not", () => {
    const stale = "SRS-MD-Rules-v0.0.1.md";
    const live = ["evidenceReference", "relatedDocs", "traceLinks", "sample"] as const;
    const retrospective = ["rationale", "research", "changeNotes", "implementationNotes", "evidenceNotes"] as const;

    for (const section of live) {
      const findings = collectSsotLiteralDrift([
        { requirementId: "FR-TEST-910", filePath: "docs/spec/test.md", line: 1, section, text: stale }
      ]);
      expect(findings.length, `${section} names a file that has to exist`).toBeGreaterThan(0);
    }

    for (const section of retrospective) {
      const findings = collectSsotLiteralDrift([
        { requirementId: "FR-TEST-910", filePath: "docs/spec/test.md", line: 1, section, text: stale }
      ]);
      expect(findings, `${section} describes what was true then`).toEqual([]);
    }
  });

  // AC-1: a marker has no version to compare, so whole-string equality only ever caught an exact
  // copy of the retired one. A planting round wrote a marker that opened correctly and closed
  // wrongly, in a section that was being read, and nothing saw it.
  it("AC-1: a marker that opens right and closes wrong is reported", () => {
    const variants = [
      "<!-- /SpecKiwi SRS workflow v1.6 -->",
      "<!-- /SpecKiwi SRS workflow block -->",
      "<!-- /SpecKiwi SRS 워크플로 v1.3 -->"
    ];
    for (const variant of variants) {
      const findings = collectSsotLiteralDrift([
        { requirementId: "FR-TEST-911", filePath: "docs/spec/test.md", line: 2, section: "acceptanceCriteria", text: `the block ends with ${variant}` }
      ]);
      expect(findings.length, `${variant} should be reported`).toBeGreaterThan(0);
    }

    // And the marker in force is not reported.
    const current = collectSsotLiteralDrift([
      { requirementId: "FR-TEST-911", filePath: "docs/spec/test.md", line: 2, section: "acceptanceCriteria", text: "the block ends with <!-- /SpecKiwi SRS workflow -->" }
    ]);
    expect(current).toEqual([]);
  });
  // Sanity: the module list is not empty and every entry names one of those modules.
  it("AC-5: every entry names a module the registry draws from", () => {
    for (const entry of SSOT_LITERAL_REGISTRY) {
      expect(SSOT_REGISTRY_MODULES as readonly string[]).toContain(entry.module);
    }
  });
});

