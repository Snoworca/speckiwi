import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { createMcpServer } from "../../src/mcp/server.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

// FR-NODE-210 AC-6 — the test-sufficiency check reaches a tdd step before its promotion: `--ids` resolves
// a step requirement that still lives under docs/spec/steps/<task>/, and `--sds` accepts the step's
// full-profile design.md, whose Test Plan table names its files in a `Test file (planned)` column.
// kiwi-tdd runs the check immediately before `promote_step_requirement` (FR-FLOW-186 AC-3), which is
// exactly when both are true.

interface Citation {
  file: string;
  line: number;
}

interface Report {
  requirements: Array<{ requirementId: string; acs: Array<{ acId: string; cited: boolean; citations: Citation[] }> }>;
  sdsContracts: Array<{ sdsAcId: string; cited: boolean; testFiles: Array<{ path: string; exists: boolean }> }>;
  gaps: { requirements: Array<{ requirementId: string; acIds: string[] }>; sdsContracts: Array<{ sdsAcId: string }> };
}

const STEP = "alpha";

const STEP_REQUIREMENT = [
  "# Step SRS: alpha",
  "",
  "## Requirements",
  "",
  "### FR-ARCH-050 — Step requirement awaiting promotion",
  "",
  "| Field | Value |",
  "| --- | --- |",
  "| Type | functional |",
  "| Target | v1.0.0 |",
  "| Status | implemented |",
  "| Priority | medium |",
  "| Tags | - |",
  "| Risk | low |",
  "| Stability | evolving |",
  "| Verification Method | test |",
  "| GitHub Issue | - |",
  "| Related Docs | - |",
  "",
  "#### Requirement",
  "",
  "The step SHALL be checked before it is promoted.",
  "",
  "#### Rationale",
  "",
  "-",
  "",
  "#### Acceptance Criteria",
  "",
  "- [ ] AC-1: The first criterion.",
  "- [ ] AC-2: The second criterion.",
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
  "",
  "#### Research / Analysis",
  "",
  "- -",
  "",
  "#### Implementation Notes",
  "",
  "- -",
  "",
  "#### Change Notes",
  "",
  "| Date | Change | Reason |",
  "| --- | --- | --- |",
  "| 2026-09-27 | Created | fixture |",
  ""
].join("\n");

/** A full-profile step SDS: seven numbered headings, no (REQ AC) references, planned-file column. */
const FULL_PROFILE_DESIGN = [
  "# SDS: alpha",
  "",
  "| Field | Value |",
  "|---|---|",
  "| Document Type | sds |",
  "| Task | alpha |",
  "| Target | v1.0.0 |",
  "| Status | agreed |",
  "| Date | 2026-09-27 |",
  "",
  "## 1. Context & Scope",
  "",
  "-",
  "",
  "## 2. Goals / Non-goals",
  "",
  "- Goal: -",
  "",
  "## 3. Architecture Decisions",
  "",
  "- none",
  "",
  "## 4. Interfaces",
  "",
  "- `check(): void` — checks",
  "",
  "## 5. Acceptance Contracts",
  "",
  "- SDS-AC-1: WHEN the step is checked THE SYSTEM SHALL answer.",
  "- SDS-AC-2: WHEN the step is checked twice THE SYSTEM SHALL answer the same.",
  "",
  "## 6. Test Plan",
  "",
  "| SDS-AC | Test file (planned) | Case summary |",
  "|---|---|---|",
  "| SDS-AC-1 | test/step.test.ts | answers |",
  "| SDS-AC-2 | test/none.test.ts | answers twice |",
  "",
  "## 7. Open Questions",
  "",
  "- (none)",
  ""
].join("\n");

function io() {
  return { stdout: new PassThrough(), stderr: new PassThrough() };
}

function drain(stream: PassThrough): string {
  return stream.read()?.toString() ?? "";
}

async function stepWorkspace(): Promise<string> {
  const root = await copyFixtureWorkspace("valid-basic");
  const stepDir = path.join(root, "docs", "spec", "steps", STEP);
  await mkdir(stepDir, { recursive: true });
  await writeFile(path.join(stepDir, `${STEP}.srs.md`), STEP_REQUIREMENT, "utf8");
  await writeFile(path.join(stepDir, "design.md"), FULL_PROFILE_DESIGN, "utf8");
  await mkdir(path.join(root, "test"), { recursive: true });
  await writeFile(path.join(root, "test", "step.test.ts"), "it('FR-ARCH-050 AC-1 SDS-AC-1', () => {});\n", "utf8");
  return root;
}

async function coverage(root: string, ...args: string[]): Promise<{ code: number; report: Report }> {
  const streams = io();
  const code = await main(["--root", root, "coverage", "--tests", "--json", ...args], streams);
  return { code, report: JSON.parse(drain(streams.stdout)) as Report };
}

describe("FR-NODE-210 AC-6 — a tdd step is checkable before its promotion", () => {
  it("FR-NODE-210 AC-6: --ids resolves a step requirement from docs/spec/steps and reports its ACs", async () => {
    const root = await stepWorkspace();
    const { code, report } = await coverage(root, "--ids", "FR-ARCH-050");
    expect(code).toBe(0);
    expect(report.requirements.map((item) => [item.requirementId, item.acs.map((ac) => [ac.acId, ac.cited])])).toEqual([
      ["FR-ARCH-050", [["AC-1", true], ["AC-2", false]]]
    ]);
    expect(report.gaps.requirements).toEqual([{ requirementId: "FR-ARCH-050", acIds: ["AC-2"] }]);
  });

  it("FR-NODE-210 AC-6: an id both the body and a step carry is reported once, as the body states it", async () => {
    const root = await stepWorkspace();
    // The step now carries FR-ARCH-001 with one criterion; the body's FR-ARCH-001 has two.
    await writeFile(
      path.join(root, "docs", "spec", "steps", STEP, `${STEP}.srs.md`),
      STEP_REQUIREMENT.replace("FR-ARCH-050", "FR-ARCH-001").replace("- [ ] AC-2: The second criterion.\n", ""),
      "utf8"
    );
    const { report } = await coverage(root, "--ids", "FR-ARCH-001");
    expect(report.requirements.map((item) => [item.requirementId, item.acs.map((ac) => ac.acId)])).toEqual([["FR-ARCH-001", ["AC-1", "AC-2"]]]);
  });

  it("FR-NODE-210 AC-6: --ids takes body and step requirements together", async () => {
    const root = await stepWorkspace();
    const { report } = await coverage(root, "--ids", "FR-ARCH-001,FR-ARCH-050");
    expect(report.requirements.map((item) => item.requirementId)).toEqual(["FR-ARCH-001", "FR-ARCH-050"]);
  });

  it("FR-NODE-210 AC-6: --sds accepts the full-profile step design.md and checks its planned test files", async () => {
    const root = await stepWorkspace();
    const { code, report } = await coverage(root, "--ids", "FR-ARCH-050", "--sds", `docs/spec/steps/${STEP}/design.md`);
    expect(code).toBe(0);
    expect(report.sdsContracts.map((item) => [item.sdsAcId, item.cited, item.testFiles])).toEqual([
      ["SDS-AC-1", true, [{ path: "test/step.test.ts", exists: true, citations: [{ file: "test/step.test.ts", line: 1 }] }]],
      ["SDS-AC-2", false, [{ path: "test/none.test.ts", exists: false, citations: [] }]]
    ]);
    expect(report.gaps.sdsContracts.map((gap) => gap.sdsAcId)).toEqual(["SDS-AC-2"]);
  });

  it("FR-NODE-210 AC-6: checks every SDS-AC of a full-profile design, including contracts written as plain §3 lines", async () => {
    for (const contract of [
      "SDS-AC-1: WHEN the step is checked THE SYSTEM SHALL answer.",
      "- **SDS-AC-1**: WHEN the step is checked THE SYSTEM SHALL answer.",
      "- SDS-AC-1 — WHEN the step is checked THE SYSTEM SHALL answer."
    ]) {
      const root = await stepWorkspace();
      await writeFile(
        path.join(root, "docs", "spec", "steps", STEP, "design.md"),
        FULL_PROFILE_DESIGN.replace("- SDS-AC-1: WHEN the step is checked THE SYSTEM SHALL answer.", contract).replace("| SDS-AC-1 | test/step.test.ts | answers |", "| SDS-AC-1 | test/gone.test.ts | answers |"),
        "utf8"
      );
      const { code, report } = await coverage(root, "--ids", "FR-ARCH-050", "--sds", `docs/spec/steps/${STEP}/design.md`, "--fail-on-gap");
      expect(report.gaps.sdsContracts.map((gap) => gap.sdsAcId), contract).toEqual(["SDS-AC-1", "SDS-AC-2"]);
      expect(code, contract).toBe(1);
    }
  });

  it("FR-NODE-210 AC-6: check_test_sufficiency answers the same for the step scope", async () => {
    const root = await stepWorkspace();
    const { report } = await coverage(root, "--ids", "FR-ARCH-050", "--sds", `docs/spec/steps/${STEP}/design.md`);
    const answer = (await createMcpServer({ root }).callTool("check_test_sufficiency", {
      ids: ["FR-ARCH-050"],
      sds: `docs/spec/steps/${STEP}/design.md`
    })) as { ok: boolean; value: unknown };
    expect(answer.ok).toBe(true);
    expect(answer.value).toEqual(report);
  });

  it("FR-NODE-210 AC-6: a --target scope stays the body requirements of that target", async () => {
    const root = await stepWorkspace();
    const { report } = await coverage(root, "--target", "v1.0.0");
    expect(report.requirements.map((item) => item.requirementId)).toEqual(["FR-ARCH-001"]);
  });
});
