import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

// IR-CLI-028 — speckiwi step validate command.
//
// Red-phase suite (T-PH004-01): one test case per acceptance criterion (AC-1..AC-3).
// These cases pin the future CLI contract before src/cli exposes the `step validate`
// subcommand, so the whole suite fails (commander rejects the unknown `step` command
// and/or the diagnostic/exit-code assertions are unmet) until the green task
// (T-PH004-02) wires `speckiwi step validate <name>` to validateWorkspaceScoped.
//
// Contract under test (from the requirement body and AC, SRS
// docs/spec/30.cli-interface.srs.md IR-CLI-028):
//
//   The CLI exposes `speckiwi step validate <name>` which runs validateWorkspaceScoped
//   for the named step and prints its step-local diagnostics with an exit code
//   reflecting step-local errors only.
//
//   - AC-1: `speckiwi step validate <name>` runs step-local validation for the named step.
//   - AC-2: The command prints W044, W045, and STEP_* diagnostics for that step.
//   - AC-3: The command's exit code reflects step-local errors and is not affected by
//           body-scope diagnostics.

function io() {
  return { stdout: new PassThrough() as NodeJS.WriteStream, stderr: new PassThrough() as NodeJS.WriteStream };
}

const SPEC_DIR = path.join("docs", "spec");

/**
 * Renders a minimal requirement block compatible with the SRS parser. Only id/title/status/
 * stability carry meaning for the step-validation advisories; the rest are parseable defaults.
 */
function renderReqBlock(options: { id: string; title: string; status?: string; stability?: string }): string {
  const status = options.status ?? "planned";
  const stability = options.stability ?? "evolving";
  return [
    `### ${options.id} — ${options.title}`,
    "",
    "| Field | Value |",
    "| --- | --- |",
    "| Type | functional |",
    "| Target | v1.0.0 |",
    `| Status | ${status} |`,
    "| Priority | high |",
    "| Tags | fixture |",
    "| Risk | low |",
    `| Stability | ${stability} |`,
    "| Verification Method | test |",
    "| GitHub Issue | - |",
    "| Related Docs | - |",
    "",
    "#### Requirement",
    "",
    `Fixture requirement ${options.id}.`,
    "",
    "#### Rationale",
    "",
    "- -",
    "",
    "#### Acceptance Criteria",
    "",
    "- [ ] AC-1: Fixture criterion.",
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
    "| 2026-06-04 | Created | Fixture |"
  ].join("\n");
}

/**
 * Writes a step-origin scope file under docs/spec/steps/<stepName>/ holding one or more
 * requirement blocks. The workspace parser flattens these into stepRecords (origin=step,
 * stepName=<stepName>) so the step-local validation pass can reason about them.
 */
async function writeStepScopeFile(root: string, stepName: string, blocks: Array<Parameters<typeof renderReqBlock>[0]>): Promise<void> {
  const dir = path.join(root, SPEC_DIR, "steps", stepName);
  await mkdir(dir, { recursive: true });
  // The block-scanner only recognizes requirement blocks inside a `## ...Requirements`
  // section, so wrap the blocks in a minimal one (mirrors a real scope/step file layout).
  const content = ["# Step Scope", "", "## Requirements", "", blocks.map((b) => renderReqBlock(b)).join("\n\n"), ""].join("\n");
  await writeFile(path.join(dir, "step.srs.md"), content, "utf8");
}

/**
 * Seeds docs/spec/steps/state.md so the step is declared in the step state table.
 * A direct-conflict marker lets the STEP_* advisory namespace surface for the step.
 */
async function writeStateMd(root: string, rows: Array<{ step: string; status?: string; dependsOn?: string; touchesScope?: string; touchesReq?: string }>): Promise<void> {
  const stepsDir = path.join(root, SPEC_DIR, "steps");
  await mkdir(stepsDir, { recursive: true });
  const tableRows = rows.map(
    (r) => `| ${r.step} | ${r.status ?? "active"} | ${r.dependsOn ?? "-"} | ${r.touchesScope ?? "ARCH"} | ${r.touchesReq ?? "-"} | 2026-06-01 | 2026-06-02 |`
  );
  const content = [
    "# Step State",
    "",
    "Mode: sdd",
    "",
    "| Step | Status | DependsOn | TouchesScope | TouchesReq | Created | Updated |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...tableRows,
    ""
  ].join("\n");
  await writeFile(path.join(stepsDir, "state.md"), content, "utf8");
}

/**
 * Seeds a named step `step-a` engineered to trigger the step-local validators:
 *   - a step requirement reusing the body id FR-ARCH-001 (SRS-W044 step-shadows-body),
 *   - 7 step requirements total reaching the overload threshold (SRS-W045),
 *   - a direct conflict against another step (STEP_* advisory namespace),
 * and returns the step name. The two steps are declared in state.md so the step
 * topology / overlap advisories have something to reason about.
 */
async function seedStepWithStepLocalDiagnostics(root: string): Promise<string> {
  const stepName = "step-a";
  // 7 blocks → overload threshold (>=7). The first shadows the body id FR-ARCH-001.
  const blocks = [
    { id: "FR-ARCH-001", title: "Step copy shadowing body id" },
    { id: "FR-ARCH-201", title: "Step req 2" },
    { id: "FR-ARCH-202", title: "Step req 3" },
    { id: "FR-ARCH-203", title: "Step req 4" },
    { id: "FR-ARCH-204", title: "Step req 5" },
    { id: "FR-ARCH-205", title: "Step req 6" },
    { id: "FR-ARCH-206", title: "Step req 7" }
  ];
  await writeStepScopeFile(root, stepName, blocks);
  await writeStepScopeFile(root, "step-b", [{ id: "FR-ARCH-301", title: "Other step req" }]);
  await writeStateMd(root, [
    { step: stepName, touchesScope: "ARCH", touchesReq: "FR-ARCH-001" },
    { step: "step-b", touchesScope: "ARCH", touchesReq: "FR-ARCH-001" }
  ]);
  return stepName;
}

/**
 * Seeds a step whose scope file carries a step-anchored structural ERROR: a malformed `### ` heading
 * inside the `## Requirements` section raises a parse-time SRS-E001 anchored under
 * docs/spec/steps/<step>/. This is the step-local error path (AC-3 positive branch): the step-validate
 * exit code must reflect it. One well-formed block keeps the step otherwise parseable.
 */
async function seedStepWithStepLocalError(root: string, stepName: string): Promise<void> {
  const dir = path.join(root, SPEC_DIR, "steps", stepName);
  await mkdir(dir, { recursive: true });
  const goodBlock = renderReqBlock({ id: "FR-ARCH-401", title: "Well-formed step req" });
  // A bare `### ` line with no requirement id is a malformed requirement heading => SRS-E001 (error).
  const content = ["# Step Scope", "", "## Requirements", "", goodBlock, "", "### not a valid requirement heading", ""].join("\n");
  await writeFile(path.join(dir, "step.srs.md"), content, "utf8");
  await writeStateMd(root, [{ step: stepName, touchesScope: "ARCH", touchesReq: "FR-ARCH-401" }]);
}

/**
 * Introduces a body-scope structural error by renaming the index Scope Map heading,
 * which drops the table and raises a body-scope SRS-E diagnostic (SRS-E014 Scope Map
 * missing). Used to prove AC-3 isolation: the step-validate exit code must NOT react
 * to this body-scope error.
 */
async function breakBodyScope(root: string): Promise<void> {
  const indexPath = path.join(root, SPEC_DIR, "00.index.md");
  const original = await readFile(indexPath, "utf8");
  await writeFile(indexPath, original.replace("## 4. Scope Map", "## 4. Scope Mapping"), "utf8");
}

function parseJson(stream: NodeJS.WriteStream): { errors: Array<{ code: string }>; warnings: Array<{ code: string }>; diagnosticsSummary: { errors: number; byCode: Record<string, number> } } {
  return JSON.parse((stream as unknown as PassThrough).read()?.toString() ?? "");
}

describe("IR-CLI-028 — speckiwi step validate command", () => {
  // AC-1: `speckiwi step validate <name>` runs step-local validation for the named step.
  it("IR-CLI-028 AC-1: runs step-local validation for the named step and returns a JSON envelope", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    const stepName = await seedStepWithStepLocalDiagnostics(root);

    const streams = io();
    const code = await main(["--root", root, "step", "validate", stepName, "--json"], streams);

    // The command is recognized and completes (step-local advisory diagnostics are warnings,
    // so a workspace with no step-local *errors* exits 0).
    expect(code).toBe(0);
    const output = parseJson(streams.stdout);
    expect(Array.isArray(output.errors)).toBe(true);
    expect(Array.isArray(output.warnings)).toBe(true);
    expect(output.diagnosticsSummary).toBeDefined();
  });

  // AC-2: The command prints W044, W045, and STEP_* diagnostics for that step.
  it("IR-CLI-028 AC-2: prints W044, W045, and a STEP_* diagnostic for that step", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    const stepName = await seedStepWithStepLocalDiagnostics(root);

    const streams = io();
    const code = await main(["--root", root, "step", "validate", stepName, "--json"], streams);
    expect(code).toBe(0);

    const output = parseJson(streams.stdout);
    const codes = [...output.errors, ...output.warnings].map((diagnostic) => diagnostic.code);
    // The step-shadows-body and step-overload warnings are surfaced for this step.
    expect(codes).toContain("SRS-W044");
    expect(codes).toContain("SRS-W045");
    // At least one advisory from the STEP_* namespace is printed for the step.
    expect(codes.some((code) => code.startsWith("STEP_"))).toBe(true);
  });

  // AC-3: The command's exit code reflects step-local errors and is not affected by
  // body-scope diagnostics.
  it("IR-CLI-028 AC-3: exit code reflects step-local errors only, ignoring body-scope errors", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    const stepName = await seedStepWithStepLocalDiagnostics(root);
    // A genuine body-scope error must NOT influence the step-validate exit code.
    await breakBodyScope(root);

    // Sanity: a full body validation does see the body-scope error (non-zero exit).
    const bodyStreams = io();
    const bodyCode = await main(["--root", root, "validate", "--json"], bodyStreams);
    expect(bodyCode).toBe(1);
    const bodyOutput = parseJson(bodyStreams.stdout);
    expect(bodyOutput.errors.length).toBeGreaterThan(0);

    // The step-local pass has no step-local errors (its diagnostics are advisory warnings),
    // so the command exits 0 despite the body-scope error.
    const stepStreams = io();
    const stepCode = await main(["--root", root, "step", "validate", stepName, "--json"], stepStreams);
    expect(stepCode).toBe(0);
    const stepOutput = parseJson(stepStreams.stdout);
    const stepCodes = [...stepOutput.errors, ...stepOutput.warnings].map((diagnostic) => diagnostic.code);
    // The body-scope error is absent from the step-local diagnostics.
    expect(stepCodes).not.toContain("SRS-E014");
  });

  // AC-3 positive branch: a step-anchored ERROR (parse-time SRS-E001 from a malformed step heading)
  // must drive the step-validate exit code to 1, and a co-existing body-only error must NOT (isolation
  // is bidirectional — body errors don't leak into the step exit, step errors do count).
  it("IR-CLI-028 AC-3: a step-local error exits 1 while a body-only error does not affect the step exit", async () => {
    const stepName = "step-err";

    // (a) Step-local error alone → exit 1, and the error is anchored under the step tree.
    const root = await copyFixtureWorkspace("valid-basic");
    await seedStepWithStepLocalError(root, stepName);

    const stepStreams = io();
    const stepCode = await main(["--root", root, "step", "validate", stepName, "--json"], stepStreams);
    expect(stepCode).toBe(1);
    const stepOutput = parseJson(stepStreams.stdout);
    expect(stepOutput.errors.map((diagnostic) => diagnostic.code)).toContain("SRS-E001");

    // (b) Body-only error in isolation (no step error) → the step pass for an UNRELATED clean step
    // still exits 0, proving a body-scope error does not flip the step-validate exit code.
    const bodyRoot = await copyFixtureWorkspace("valid-basic");
    const cleanStep = await seedStepWithStepLocalDiagnostics(bodyRoot);
    await breakBodyScope(bodyRoot);

    // Sanity: full body validation sees the body-scope error (non-zero exit).
    const bodyStreams = io();
    expect(await main(["--root", bodyRoot, "validate", "--json"], bodyStreams)).toBe(1);

    const cleanStepStreams = io();
    const cleanStepCode = await main(["--root", bodyRoot, "step", "validate", cleanStep, "--json"], cleanStepStreams);
    expect(cleanStepCode).toBe(0);
    const cleanStepOutput = parseJson(cleanStepStreams.stdout);
    expect(cleanStepOutput.errors.length).toBe(0);
  });
});
