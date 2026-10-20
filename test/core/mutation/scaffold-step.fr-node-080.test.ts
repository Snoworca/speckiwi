import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { scaffoldStep } from "../../../src/core/mutation/scaffold-step.js";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import { loadStepDesign, loadStepIntent, validateWorkspaceScoped } from "../../../src/core/validator/validate-scoped.js";
import { createMcpServer } from "../../../src/mcp/server.js";
import { toolSpecs, assertZeroDriftToolSurface } from "../../../src/mcp/schemas.js";
import { main } from "../../../src/cli/index.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

// FR-NODE-080 — step scaffold creates the intent stub, and the SDS design stub only on request.
//
// Contract under test (docs/spec/50.nodejs-implementation.srs.md FR-NODE-080, amended in 4.1.0):
//   - AC-1: creates intent.md (with an `## Acceptance` placeholder line); design.md (Status=draft meta
//           + seven SDS headings) only with `sds: true` / `--sds`.
//   - AC-2: existing files are never overwritten (skipped) while siblings are created.
//   - AC-3: dryRun writes nothing.
//   - AC-4: a design.md scaffolded with `sds: true` passes validate_step without SDS-W051; the
//           scaffolded placeholder and the design stub both fail the FR-PARSE-042 predicate.
//   - AC-5: CLI + MCP surfaces registered with parity suites green, including the `sds` input.

const TASK = "feature-scaffold";

function io() {
  return { stdout: new PassThrough(), stderr: new PassThrough() };
}

async function isFile(target: string): Promise<boolean> {
  try {
    return (await stat(target)).isFile();
  } catch {
    return false;
  }
}

function stepDir(root: string, task: string): string {
  return path.join(root, "docs", "spec", "steps", task);
}

async function writeStateMd(root: string, mode: string): Promise<void> {
  const stepsDir = path.join(root, "docs", "spec", "steps");
  await mkdir(stepsDir, { recursive: true });
  const lines = [
    "# Step State",
    "",
    `Mode: ${mode}`,
    "",
    "| Step | Status | DependsOn | TouchesScope | TouchesReq | Created | Updated |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    `| ${TASK} | active | - | ARCH | - | 2026-06-01 | 2026-06-02 |`,
    ""
  ];
  await writeFile(path.join(stepsDir, "state.md"), lines.join("\n"), "utf8");
}

const SDS_HEADINGS = [
  "Context & Scope",
  "Goals / Non-goals",
  "Architecture Decisions",
  "Interfaces",
  "Acceptance Contracts",
  "Test Plan",
  "Open Questions"
];

describe("FR-NODE-080 — step scaffold creates the intent stub and, on request, the SDS design stub", () => {
  it("FR-NODE-080 AC-1: scaffold creates intent.md with an Acceptance section and no design.md by default", async () => {
    const root = await copyFixtureWorkspace("valid-basic");

    const result = await scaffoldStep({ root }, { task: TASK });

    expect(result.ok).toBe(true);
    const intent = await readFile(path.join(stepDir(root, TASK), "intent.md"), "utf8");
    expect(intent).toMatch(/^## Acceptance$/m);
    expect(intent).toContain("AC-1: WHEN <condition> THE SYSTEM SHALL <behaviour>");
    expect(await isFile(path.join(stepDir(root, TASK), "design.md"))).toBe(false);
    if (result.ok) {
      expect(result.value?.created.some((entry: string) => entry.includes("intent.md"))).toBe(true);
      expect(result.value?.created.some((entry: string) => entry.includes("design.md"))).toBe(false);
    }
  });

  it("FR-NODE-080 AC-1: with sds: true scaffold also creates design.md (Status=draft + seven headings)", async () => {
    const root = await copyFixtureWorkspace("valid-basic");

    const result = await scaffoldStep({ root }, { task: TASK, sds: true });

    expect(result.ok).toBe(true);
    const design = await readFile(path.join(stepDir(root, TASK), "design.md"), "utf8");
    expect(design).toContain("| Document Type | sds |");
    expect(design).toContain("| Status | draft |");
    expect(design).toContain(`| Task | ${TASK} |`);
    for (const heading of SDS_HEADINGS) {
      expect(design, `design.md must carry the '${heading}' heading`).toContain(heading);
    }
    expect(await isFile(path.join(stepDir(root, TASK), "intent.md"))).toBe(true);
    if (result.ok) {
      expect(result.value?.created.some((entry: string) => entry.includes("design.md"))).toBe(true);
      expect(result.value?.created.some((entry: string) => entry.includes("intent.md"))).toBe(true);
    }
  });

  it("FR-NODE-080 AC-2: existing files are never overwritten while missing siblings are created", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    await mkdir(stepDir(root, TASK), { recursive: true });
    await writeFile(path.join(stepDir(root, TASK), "design.md"), "# my handwritten design\n", "utf8");

    const result = await scaffoldStep({ root }, { task: TASK, sds: true });

    expect(result.ok).toBe(true);
    expect(await readFile(path.join(stepDir(root, TASK), "design.md"), "utf8")).toBe("# my handwritten design\n");
    expect(await isFile(path.join(stepDir(root, TASK), "intent.md"))).toBe(true);
    if (result.ok) {
      expect(result.value?.skipped.some((entry: string) => entry.includes("design.md"))).toBe(true);
      expect(result.value?.created.some((entry: string) => entry.includes("intent.md"))).toBe(true);
    }
  });

  it("FR-NODE-080 AC-3: dryRun writes nothing", async () => {
    const root = await copyFixtureWorkspace("valid-basic");

    const result = await scaffoldStep({ root }, { task: TASK, sds: true, dryRun: true });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value?.written).toBe(false);
      expect(result.value?.created.some((entry: string) => entry.includes("design.md"))).toBe(true);
    }
    expect(await isFile(path.join(stepDir(root, TASK), "design.md"))).toBe(false);
    expect(await isFile(path.join(stepDir(root, TASK), "intent.md"))).toBe(false);
  });

  it("FR-NODE-080 AC-4: a design.md scaffolded with sds: true passes validate_step without SDS-W051 advisories", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    await writeStateMd(root, "tdd");
    expect((await scaffoldStep({ root }, { task: TASK, sds: true })).ok).toBe(true);

    const workspace = await parseWorkspace({ root });
    const design = await loadStepDesign({ root }, TASK);
    const result = validateWorkspaceScoped(workspace, { step: TASK, design });

    const sdsCodes = result.diagnostics.filter((d) => d.code.startsWith("SDS-W")).map((d) => d.code);
    expect(sdsCodes).not.toContain("SDS-W051");
    expect(sdsCodes).not.toContain("SDS-W053");
  });

  for (const sds of [false, true]) {
    it(`FR-NODE-080 AC-4: the scaffolded placeholder${sds ? " and design.md stub" : ""} fail the FR-PARSE-042 predicate`, async () => {
      const root = await copyFixtureWorkspace("valid-basic");
      await writeStateMd(root, "tdd");
      expect((await scaffoldStep({ root }, { task: TASK, sds })).ok).toBe(true);

      const workspace = await parseWorkspace({ root });
      const result = validateWorkspaceScoped(workspace, {
        step: TASK,
        design: await loadStepDesign({ root }, TASK),
        intent: await loadStepIntent({ root }, TASK)
      });

      expect(result.errors.map((d) => d.code)).toContain("STEP_ACCEPTANCE_MISSING");
    });
  }

  it("FR-NODE-080 AC-5: CLI and MCP surfaces are registered with parity green, including the sds input", async () => {
    // Registry declaration.
    const spec = toolSpecs.find((candidate) => candidate.cliName === "scaffold");
    expect(spec, "registry must declare the `scaffold` CLI leaf").toBeDefined();
    expect(spec?.mcpName).toBe("scaffold_step");
    expect(spec?.options.map((option) => option.flag)).toContain("--sds");
    expect(() => assertZeroDriftToolSurface()).not.toThrow();

    // CLI surface reaches the core mutation, with and without --sds.
    const cliRoot = await copyFixtureWorkspace("valid-basic");
    expect(await main(["--root", cliRoot, "step", "scaffold", TASK, "--sds", "--json"], io())).toBe(0);
    expect(await isFile(path.join(stepDir(cliRoot, TASK), "design.md"))).toBe(true);
    const plainRoot = await copyFixtureWorkspace("valid-basic");
    expect(await main(["--root", plainRoot, "step", "scaffold", TASK, "--json"], io())).toBe(0);
    expect(await isFile(path.join(stepDir(plainRoot, TASK), "intent.md"))).toBe(true);
    expect(await isFile(path.join(stepDir(plainRoot, TASK), "design.md"))).toBe(false);

    // MCP surface reaches the core mutation.
    const mcpRoot = await copyFixtureWorkspace("valid-basic");
    const server = createMcpServer({ root: mcpRoot });
    const result = await server.callTool("scaffold_step", { task: TASK, sds: true });
    expect(result).toMatchObject({ ok: true });
    expect(await isFile(path.join(stepDir(mcpRoot, TASK), "design.md"))).toBe(true);

    // Appendix documentation (tool-signature parity input).
    const appendix = await readFile(path.join(process.cwd(), "docs", "spec", "90.appendix.md"), "utf8");
    expect(appendix).toContain("`scaffold_step`");
  });
});
