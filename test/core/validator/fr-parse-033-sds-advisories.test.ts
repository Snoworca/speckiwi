import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { loadStepDesign, loadStepIntent, validateWorkspaceScoped } from "../../../src/core/validator/validate-scoped.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

// FR-PARSE-033 — step-local validation covers the SDS design.md. RED suite (one
// case per AC). The suite fails on the missing loadStepDesign export (and the
// absent SDS-W05x advisories) until the step-local pass gains the tdd-mode SDS
// checks.
//
// Contract under test (docs/spec/20.parser-validation.srs.md FR-PARSE-033, amended in 4.1.0):
//   - AC-1: tdd + absent design.md → no SDS diagnostic (SDS-W050 and SDS-E054 are retired), with or
//           without an `## SDS Skip` section; the acceptance check is FR-PARSE-042.
//   - AC-2: tdd + missing required heading → SDS-W051 naming the heading.
//   - AC-3: tdd + unmapped SDS-AC → SDS-W052; > 200 lines → SDS-W053.
//   - AC-4: non-tdd skips the SDS advisories; advisories are warnings only.

const STEP = "tdd-step-x";

async function writeStateMd(rootPath: string, mode: string, activeTask?: string): Promise<void> {
  const stepsDir = path.join(rootPath, "docs", "spec", "steps");
  await mkdir(stepsDir, { recursive: true });
  const lines = [
    "# Step State",
    "",
    `Mode: ${mode}`,
    ...(activeTask !== undefined ? [`Active Task: ${activeTask}`] : []),
    "",
    "| Step | Status | DependsOn | TouchesScope | TouchesReq | Created | Updated |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    `| ${STEP} | active | - | ARCH | - | 2026-07-16 | 2026-07-16 |`,
    ""
  ];
  await writeFile(path.join(stepsDir, "state.md"), lines.join("\n"), "utf8");
}

const FULL_SDS = [
  "# SDS: sample",
  "",
  "| Field | Value |",
  "|---|---|",
  "| Document Type | sds |",
  "",
  "## 1. Context & Scope",
  "",
  "## 2. Goals / Non-goals",
  "",
  "## 3. Architecture Decisions",
  "",
  "## 4. Interfaces",
  "",
  "## 5. Acceptance Contracts",
  "",
  "- SDS-AC-1: WHEN X THE SYSTEM SHALL Y.",
  "- SDS-AC-2: WHEN A THE SYSTEM SHALL B.",
  "",
  "## 6. Test Plan",
  "",
  "| SDS-AC | Test file (planned) | Case summary |",
  "|---|---|---|",
  "| SDS-AC-1 | test/x.test.ts | y |",
  "",
  "## 7. Open Questions",
  "",
  "- (none)"
].join("\n");

async function writeDesign(rootPath: string, content: string): Promise<void> {
  const stepDir = path.join(rootPath, "docs", "spec", "steps", STEP);
  await mkdir(stepDir, { recursive: true });
  await writeFile(path.join(stepDir, "design.md"), content, "utf8");
}

async function scopedDiagnostics(rootPath: string) {
  const root = await resolveProjectRoot(rootPath);
  const workspace = await parseWorkspace(root);
  const design = await loadStepDesign(root, STEP);
  const intent = await loadStepIntent(root, STEP);
  return validateWorkspaceScoped(workspace, { step: STEP, design, intent });
}

/** A 4.0.0 SDS Skip record, which AC-1 says no longer changes the outcome. */
async function writeSkipRecord(rootPath: string): Promise<void> {
  const stepDir = path.join(rootPath, "docs", "spec", "steps", STEP);
  await mkdir(stepDir, { recursive: true });
  await writeFile(
    path.join(stepDir, "intent.md"),
    [
      `# Intent: ${STEP}`,
      "",
      "## SDS Skip",
      "",
      "| Field | Value |",
      "| --- | --- |",
      "| Decision | skipped |",
      "| Reason | Renames one private helper; no interface and no behaviour changes. |",
      "",
      "- SDS-AC-1: WHEN the helper is renamed THE SYSTEM SHALL keep every caller resolving.",
      ""
    ].join("\n"),
    "utf8"
  );
}

describe("FR-PARSE-033 step-local validation covers the SDS design.md", () => {
  for (const record of [false, true]) {
    it(`FR-PARSE-033 AC-1: tdd mode with an absent design.md emits no SDS diagnostic (${record ? "with" : "without"} an SDS Skip section)`, async () => {
      const rootPath = await copyFixtureWorkspace("valid-basic");
      await writeStateMd(rootPath, "tdd", STEP);
      if (record) await writeSkipRecord(rootPath);

      const result = await scopedDiagnostics(rootPath);
      expect(result.diagnostics.filter((item) => item.code.startsWith("SDS-"))).toEqual([]);
    });
  }

  it("FR-PARSE-033 AC-2: tdd mode with a missing required heading emits SDS-W051 naming it", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");
    await writeStateMd(rootPath, "tdd", STEP);
    // Drop the Interfaces heading from an otherwise complete SDS.
    await writeDesign(rootPath, FULL_SDS.replace("## 4. Interfaces", "## 4. Surfaces"));

    const result = await scopedDiagnostics(rootPath);
    const hits = result.warnings.filter((item) => item.code === "SDS-W051");
    expect(hits).toHaveLength(1);
    expect(hits[0]?.message).toContain("Interfaces");
  });

  it("FR-PARSE-033 AC-3: tdd mode emits SDS-W052 for an unmapped SDS-AC and SDS-W053 over the cap", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");
    await writeStateMd(rootPath, "tdd", STEP);
    // SDS-AC-2 has no Test Plan row, and the doc is padded past 200 lines.
    await writeDesign(rootPath, `${FULL_SDS}\n${Array.from({ length: 200 }, (_, i) => `- filler ${i}`).join("\n")}\n`);

    const result = await scopedDiagnostics(rootPath);
    const unmapped = result.warnings.find((item) => item.code === "SDS-W052");
    expect(unmapped).toBeDefined();
    expect(unmapped?.message).toContain("SDS-AC-2");
    expect(result.warnings.some((item) => item.code === "SDS-W053")).toBe(true);
  });

  it("FR-PARSE-033 AC-4: non-tdd modes skip the SDS advisories entirely", async () => {
    for (const mode of ["sdd", "vibe", "wait"] as const) {
      const rootPath = await copyFixtureWorkspace("valid-basic");
      await writeStateMd(rootPath, mode, mode === "vibe" ? STEP : undefined);

      const result = await scopedDiagnostics(rootPath);
      expect(result.warnings.filter((item) => item.code.startsWith("SDS-W"))).toHaveLength(0);
    }

    // A complete SDS in tdd mode emits none of the SDS advisories either.
    const cleanRoot = await copyFixtureWorkspace("valid-basic");
    await writeStateMd(cleanRoot, "tdd", STEP);
    await writeDesign(cleanRoot, FULL_SDS.replace("| SDS-AC-1 | test/x.test.ts | y |", "| SDS-AC-1 | test/x.test.ts | y |\n| SDS-AC-2 | test/x.test.ts | z |"));
    const clean = await scopedDiagnostics(cleanRoot);
    expect(clean.warnings.filter((item) => item.code.startsWith("SDS-W"))).toHaveLength(0);
  });
});
