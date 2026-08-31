import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createTestMcpServer } from "../../src/mcp/adapter.js";
import { registerReadTools } from "../../src/mcp/tools/read-tools.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

/**
 * FR-PARSE-040 — the MCP surface decides the skip the same way the CLI surface does.
 *
 * The CLI suite pins the exit code, which is the CLI's own observable. `validate_step` has no exit
 * code: its handler always returns `mcpSuccess(...)`, so `ok` is `true` on a step whose SDS skip is
 * unrecorded. What the MCP caller can observe is the diagnostic itself — `SDS-E054` among `errors`
 * with `diagnosticsSummary.errors` counting it — and that is what this file measures.
 *
 * It exists because removing the `intent` argument from the `validate_step` handler left every
 * other suite green, measured over `test/core/validator`, `test/cli`, `test/mcp` and the two
 * FR-PARSE-033 suites: the wiring of the second surface was carried by nothing. The two cases below
 * are the same call over the same step, differing only in whether intent.md carries the record, so
 * a handler that stopped loading intent.md fails the recorded case rather than merely losing a
 * negative assertion.
 *
 * `ok: true` is asserted on purpose in both cases. It is the contract this surface actually has,
 * and the requirement body states it in those terms rather than as a non-zero exit.
 */

const STEP = "tdd-step-mcp";

interface Diagnostic {
  code: string;
  severity?: string;
}

interface StepValidationEnvelope {
  ok: boolean;
  value: { errors?: Diagnostic[]; warnings?: Diagnostic[] };
  diagnosticsSummary?: { errors?: number; warnings?: number };
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
      `| ${STEP} | active | - | ARCH | - | 2026-09-01 | 2026-09-01 |`,
      ""
    ].join("\n"),
    "utf8"
  );
  return root;
}

async function writeRecord(root: string): Promise<void> {
  const stepDir = path.join(root, "docs", "spec", "steps", STEP);
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

async function callValidateStep(root: string): Promise<StepValidationEnvelope> {
  const server = createTestMcpServer({ root });
  registerReadTools(server, { root });
  return (await server.callTool("validate_step", { step: STEP })) as StepValidationEnvelope;
}

describe("FR-PARSE-040 AC-2 — MCP validate_step decides the skip on the same record", () => {
  it("carries SDS-E054 among errors when the SDS is skipped without a record", async () => {
    const root = await tddWorkspace();

    const envelope = await callValidateStep(root);

    // The envelope stays ok:true — this surface has no exit code, and the requirement says so.
    expect(envelope.ok).toBe(true);
    expect((envelope.value.errors ?? []).map((item) => item.code)).toContain("SDS-E054");
    expect(envelope.diagnosticsSummary?.errors ?? 0).toBeGreaterThanOrEqual(1);
    expect((envelope.value.warnings ?? []).map((item) => item.code)).not.toContain("SDS-W050");
  });

  it("carries SDS-W050 as a warning and no error once the record is written", async () => {
    const root = await tddWorkspace();
    await writeRecord(root);

    const envelope = await callValidateStep(root);

    expect(envelope.ok).toBe(true);
    expect((envelope.value.warnings ?? []).map((item) => item.code)).toContain("SDS-W050");
    expect((envelope.value.errors ?? []).map((item) => item.code)).not.toContain("SDS-E054");
    expect(envelope.diagnosticsSummary?.errors ?? 0).toBe(0);
  });
});
