import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { createTestMcpServer } from "../../src/mcp/adapter.js";
import { registerReadTools } from "../../src/mcp/tools/read-tools.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

/**
 * FR-PARSE-042 AC-2 / AC-4 (CLI surface) — `speckiwi step validate` exits 1 on a tdd step without a
 * written acceptance contract and 0 once intent.md carries one. The two cases are the same command
 * over the same step, differing only in the acceptance line, so a surface that stopped loading
 * intent.md fails the passing case rather than merely losing a negative assertion.
 */

const STEP = "tdd-step-x";

function io() {
  return { stdout: new PassThrough(), stderr: new PassThrough() };
}

function drain(stream: PassThrough): string {
  return stream.read()?.toString() ?? "";
}

async function tddWorkspace(): Promise<string> {
  const root = await copyFixtureWorkspace("valid-basic");
  const stepsDir = path.join(root, "docs", "spec", "steps");
  await mkdir(stepsDir, { recursive: true });
  await writeFile(
    path.join(stepsDir, "state.md"),
    [
      "# Step State",
      "",
      "Mode: tdd",
      `Active Task: ${STEP}`,
      "",
      "| Step | Status | DependsOn | TouchesScope | TouchesReq | Created | Updated |",
      "| --- | --- | --- | --- | --- | --- | --- |",
      `| ${STEP} | active | - | ARCH | - | 2026-10-20 | 2026-10-20 |`,
      ""
    ].join("\n"),
    "utf8"
  );
  return root;
}

async function writeIntent(root: string, acceptanceLine: string): Promise<void> {
  const stepDir = path.join(root, "docs", "spec", "steps", STEP);
  await mkdir(stepDir, { recursive: true });
  await writeFile(
    path.join(stepDir, "intent.md"),
    [`# Intent: ${STEP}`, "", "Rename the private slug helper.", "", "## Acceptance", "", acceptanceLine, ""].join("\n"),
    "utf8"
  );
}

describe("FR-PARSE-042 AC-2 / AC-4 — speckiwi step validate checks the acceptance contract", () => {
  it("exits 1 and reports STEP_ACCEPTANCE_MISSING for the scaffold placeholder line", async () => {
    const root = await tddWorkspace();
    await writeIntent(root, "- AC-1: WHEN <condition> THE SYSTEM SHALL <behaviour>");
    const streams = io();

    const code = await main(["--root", root, "step", "validate", STEP, "--json"], streams);

    expect(code).toBe(1);
    const output = JSON.parse(drain(streams.stdout));
    const errors: { code: string }[] = output.errors ?? [];
    expect(errors.map((item) => item.code)).toContain("STEP_ACCEPTANCE_MISSING");
    expect(output.diagnosticsSummary.errors).toBeGreaterThanOrEqual(1);
  });

  it("FR-PARSE-042 AC-2: exits 1 when intent.md is absent", async () => {
    const root = await tddWorkspace();
    const streams = io();
    expect(await main(["--root", root, "step", "validate", STEP, "--json"], streams)).toBe(1);
    expect((JSON.parse(drain(streams.stdout)).errors ?? []).map((item: { code: string }) => item.code)).toContain("STEP_ACCEPTANCE_MISSING");
  });

  it("FR-PARSE-042 AC-4: the CLI and MCP judge one step the same way, on one fixture", async () => {
    for (const line of ["- AC-1: WHEN <condition> THE SYSTEM SHALL <behaviour>", "- AC-1: WHEN the helper is renamed THE SYSTEM SHALL keep every caller resolving."]) {
      const root = await tddWorkspace();
      await writeIntent(root, line);
      const streams = io();
      await main(["--root", root, "step", "validate", STEP, "--json"], streams);
      const cli = JSON.parse(drain(streams.stdout));
      const server = createTestMcpServer({ root });
      registerReadTools(server, { root });
      const mcp = (await server.callTool("validate_step", { step: STEP })) as { value: { errors?: { code: string }[] } };
      const codesOf = (items: { code: string }[] | undefined) => (items ?? []).map((item) => item.code).sort();
      expect(codesOf(mcp.value.errors), line).toEqual(codesOf(cli.errors));
    }
  });

  it("exits 0 with no STEP_ACCEPTANCE_MISSING once an EARS acceptance line is written", async () => {
    const root = await tddWorkspace();
    await writeIntent(root, "- AC-1: WHEN the helper is renamed THE SYSTEM SHALL keep every caller resolving.");
    const streams = io();

    const code = await main(["--root", root, "step", "validate", STEP, "--json"], streams);

    expect(code).toBe(0);
    const output = JSON.parse(drain(streams.stdout));
    const all: { code: string }[] = [...(output.errors ?? []), ...(output.warnings ?? [])];
    expect(all.map((item) => item.code)).not.toContain("STEP_ACCEPTANCE_MISSING");
  });
});
