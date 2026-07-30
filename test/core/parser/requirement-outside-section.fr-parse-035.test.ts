import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getDiagnosticDefinition } from "../../../src/core/diagnostic-registry.js";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

// FR-PARSE-035 — a Requirement Block outside a Requirements section is invisible, and was silent.
//
// The scanner reads third-level headings only inside a section whose title matches `requirements?`.
// A well-formed block anywhere else cannot be listed, shown or mutated, and `validate` stayed clean —
// so an author discovers the problem by filing work against an id the tool does not have.

const SPEC_FILE = path.join("docs", "spec", "10.product-architecture.srs.md");

/** Appends a section holding a well-formed requirement heading outside the Requirements section. */
async function withHeadingOutsideRequirements(heading: string): Promise<string> {
  const rootPath = await copyFixtureWorkspace("valid-basic");
  const specPath = path.join(rootPath, SPEC_FILE);
  await writeFile(
    specPath,
    `${await readFile(specPath, "utf8")}\n## 5. Appendix\n\n${heading}\n\nSome prose.\n`,
    "utf8"
  );
  return rootPath;
}

async function diagnosticsFor(rootPath: string) {
  return (await parseWorkspace(await resolveProjectRoot(rootPath))).diagnostics;
}

describe("FR-PARSE-035 AC-1 — the invisible block is reported", () => {
  it("emits SRS-W071 naming the file, line and requirement id", async () => {
    const rootPath = await withHeadingOutsideRequirements("### FR-ARCH-900 — Stranded requirement");

    const diagnostics = await diagnosticsFor(rootPath);

    const warning = diagnostics.find((entry) => entry.code === "SRS-W071");
    expect(warning, "a requirement heading outside a Requirements section must be reported").toBeDefined();
    expect(warning!.severity).toBe("warning");
    expect(warning!.filePath?.replace(/\\/g, "/")).toBe("docs/spec/10.product-architecture.srs.md");
    expect(warning!.line).toBeGreaterThan(1);
    expect(JSON.stringify(warning)).toContain("FR-ARCH-900");
  });
});

describe("FR-PARSE-035 AC-2 — the diagnostic reports, it does not change parsing", () => {
  it("still leaves the block out of the parsed records", async () => {
    const rootPath = await withHeadingOutsideRequirements("### FR-ARCH-900 — Stranded requirement");

    const workspace = await parseWorkspace(await resolveProjectRoot(rootPath));

    expect(workspace.records.map((record) => record.id)).toEqual(["FR-ARCH-001"]);
  });
});

describe("FR-PARSE-035 AC-3 — an ordinary third-level heading is not a requirement", () => {
  it("stays silent for headings that are not requirement-shaped", async () => {
    const rootPath = await withHeadingOutsideRequirements("### Notes and further reading");

    const diagnostics = await diagnosticsFor(rootPath);

    expect(diagnostics.filter((entry) => entry.code === "SRS-W071")).toEqual([]);
    // The fixture's own `### In Scope` / `### Out of Scope` headings live outside the Requirements
    // section too, and they must never trigger this.
    expect(await readFile(path.join(rootPath, SPEC_FILE), "utf8")).toContain("### In Scope");
  });
});

describe("FR-PARSE-035 AC-4 — a requirement in its proper section is not reported", () => {
  it("stays silent for the fixture's own requirement", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");

    const diagnostics = await diagnosticsFor(rootPath);

    expect(diagnostics.filter((entry) => entry.code === "SRS-W071")).toEqual([]);
  });
});

describe("FR-PARSE-035 AC-5 — the code is registered with an actionable remediation", () => {
  it("names both ways out", () => {
    const definition = getDiagnosticDefinition("SRS-W071");

    expect(definition.severity).toBe("warning");
    expect(definition.sourceRule).toBe("FR-PARSE-035");
    expect(definition.remediation).toMatch(/Requirements section/);
    expect(definition.remediation).toMatch(/rename/i);
  });
});
