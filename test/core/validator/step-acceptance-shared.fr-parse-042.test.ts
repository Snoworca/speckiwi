import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { evaluateVibeGate } from "../../../src/core/query/vibe-gate.js";
import { loadStepDesign, loadStepIntent, validateWorkspaceScoped } from "../../../src/core/validator/validate-scoped.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";
import type * as StepAcceptanceModule from "../../../src/core/validator/step-acceptance.js";

/**
 * FR-PARSE-042 AC-5 — one predicate decides the step validation and the vibe gate's tdd branch.
 *
 * The predicate module is replaced by a mutant that fails every step. A step whose contract is fine
 * then has to fail on both surfaces; a surface carrying its own copy of the check would stay green.
 */

vi.mock("../../../src/core/validator/step-acceptance.js", async (importOriginal) => {
  const actual = await importOriginal<typeof StepAcceptanceModule>();
  return { ...actual, stepAcceptanceFailure: () => "mutant predicate" };
});

const STEP = "tdd-step-x";

async function tddStepWithContract(): Promise<string> {
  const rootPath = await copyFixtureWorkspace("valid-basic");
  const stepDir = path.join(rootPath, "docs", "spec", "steps", STEP);
  await mkdir(stepDir, { recursive: true });
  await writeFile(
    path.join(rootPath, "docs", "spec", "steps", "state.md"),
    ["# Step State", "", "Mode: tdd", `Active Task: ${STEP}`, ""].join("\n"),
    "utf8"
  );
  await writeFile(
    path.join(stepDir, "intent.md"),
    ["# Intent", "", "## Acceptance", "", "- AC-1: WHEN x happens THE SYSTEM SHALL do y.", ""].join("\n"),
    "utf8"
  );
  return rootPath;
}

describe("FR-PARSE-042 AC-5 — both surfaces call the one exported predicate", () => {
  it("a mutated predicate turns step validation and the vibe gate red together", async () => {
    const rootPath = await tddStepWithContract();
    const root = await resolveProjectRoot(rootPath);

    const result = validateWorkspaceScoped(await parseWorkspace(root), {
      step: STEP,
      design: await loadStepDesign(root, STEP),
      intent: await loadStepIntent(root, STEP)
    });
    const gate = await evaluateVibeGate(root);

    expect(result.errors.find((item) => item.code === "STEP_ACCEPTANCE_MISSING")?.message).toContain("mutant predicate");
    expect(gate.blocked).toBe(true);
    expect(gate.blockedReason).toContain("mutant predicate");
  });
});
