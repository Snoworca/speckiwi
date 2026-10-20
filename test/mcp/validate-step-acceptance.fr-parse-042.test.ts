import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createTestMcpServer } from "../../src/mcp/adapter.js";
import { registerReadTools } from "../../src/mcp/tools/read-tools.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

/**
 * FR-PARSE-042 AC-2 / AC-4 (MCP surface) — `validate_step` judges the acceptance contract the way the
 * CLI does. It has no exit code: the envelope stays `ok: true` and the caller observes
 * `STEP_ACCEPTANCE_MISSING` among `errors` with `diagnosticsSummary.errors` counting it. The passing
 * case is the same call with a real EARS line, so a handler that stopped loading intent.md fails it.
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

async function tddWorkspace(acceptanceLine: string): Promise<string> {
  const root = await copyFixtureWorkspace("valid-basic");
  const stepsDir = path.join(root, "docs", "spec", "steps");
  await mkdir(path.join(stepsDir, STEP), { recursive: true });
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
  await writeFile(
    path.join(stepsDir, STEP, "intent.md"),
    [`# Intent: ${STEP}`, "", "## Acceptance", "", acceptanceLine, ""].join("\n"),
    "utf8"
  );
  return root;
}

async function callValidateStep(root: string): Promise<StepValidationEnvelope> {
  const server = createTestMcpServer({ root });
  registerReadTools(server, { root });
  return (await server.callTool("validate_step", { step: STEP })) as StepValidationEnvelope;
}

describe("FR-PARSE-042 AC-2 / AC-4 — MCP validate_step checks the acceptance contract", () => {
  it("carries STEP_ACCEPTANCE_MISSING among errors for a placeholder acceptance line", async () => {
    const envelope = await callValidateStep(await tddWorkspace("- AC-1: WHEN <condition> THE SYSTEM SHALL <behaviour>"));

    expect(envelope.ok).toBe(true);
    const hit = (envelope.value.errors ?? []).find((item) => item.code === "STEP_ACCEPTANCE_MISSING");
    expect(hit?.severity).toBe("error");
    expect(envelope.diagnosticsSummary?.errors ?? 0).toBeGreaterThanOrEqual(1);
  });

  it("carries no STEP_ACCEPTANCE_MISSING and no error once an EARS line is written", async () => {
    const envelope = await callValidateStep(
      await tddWorkspace("- AC-1: WHEN the helper is renamed THE SYSTEM SHALL keep every caller resolving.")
    );

    expect(envelope.ok).toBe(true);
    expect((envelope.value.errors ?? []).map((item) => item.code)).not.toContain("STEP_ACCEPTANCE_MISSING");
    expect(envelope.diagnosticsSummary?.errors ?? 0).toBe(0);
  });
});
