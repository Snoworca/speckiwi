import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "./kiwi-orchestrator-variants.js";

// @req FR-FLOW-143 AC-3 — the reused validator is proved to decide, by running it.
//
// The other cases assert that the validator's rule names appear in its source, which shows a string
// is present and nothing more. FR-FLOW-143 rests on the claim that this script already decides the
// req-mapping rule, so that claim has to be executed: feed it a plan that violates each rule and
// require it to say so, and feed it a clean one and require it not to.

const VALIDATOR = path.join(REPO_ROOT, "skills/claude/kiwi-planner/validator.mjs");

/** One requirement with two criteria — the inventory the validator checks references against. */
const INVENTORY = [{ id: "FR-KP-TEST-001", ac_ids: ["AC-1", "AC-2"] }];

function sidecar(testCase: Record<string, unknown>): unknown {
  return {
    schema_version: "1.1.0",
    run_id: "2026-08-17.fixture.req-mapping",
    tasks: [
      {
        id: "T-PH001-01",
        type: "code",
        req_ids: ["FR-KP-TEST-001"],
        files: [],
        action: "fixture",
        dod: ["fixture"],
        tdd: { applicable: true, phase: "red", test_cases: [testCase] }
      }
    ]
  };
}

const PLAN = [
  "---",
  "run_id: 2026-08-17.fixture.req-mapping",
  "target: fixture",
  "plan_version: 1",
  "plan_contract: 1.2.0",
  "generated_at: 2026-08-17T00:00:00Z",
  "tool_versions: {}",
  "sidecar_path: ./sidecar.json",
  "---",
  "",
  "# fixture plan",
  ""
].join("\n");

/**
 * Runs the shipped validator over a fixture and returns its verdicts by rule id.
 *
 * The fixture is deliberately minimal, so several unrelated checks fail on it — that is fine and
 * expected. Only C23 and R04 are read, because only those two are the rule this requirement claims
 * the validator already decides. A fixture elaborate enough to satisfy every other check would test
 * the fixture builder rather than the rule.
 */
function runValidator(testCase: Record<string, unknown>): Map<string, { status: string; detail?: unknown }> {
  const dir = mkdtempSync(path.join(tmpdir(), "speckiwi-validator-"));
  const planPath = path.join(dir, "plan.md");
  const sidecarPath = path.join(dir, "sidecar.json");
  const inventoryPath = path.join(dir, "inventory.json");
  writeFileSync(planPath, PLAN, "utf8");
  writeFileSync(sidecarPath, JSON.stringify(sidecar(testCase)), "utf8");
  writeFileSync(inventoryPath, JSON.stringify(INVENTORY), "utf8");

  // Exit status is non-zero whenever any check fails, which every one of these fixtures triggers,
  // so the report on stdout is what is read rather than the exit code.
  let stdout = "";
  try {
    stdout = execFileSync(
      process.execPath,
      [VALIDATOR, planPath, sidecarPath, "--target", "fixture", "--inventory-file", inventoryPath],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
    );
  } catch (error) {
    stdout = String((error as { stdout?: string }).stdout ?? "");
  }
  const report = JSON.parse(stdout) as { results?: Array<{ id: string; status: string; detail?: unknown }> };
  const results = report.results ?? [];
  expect(results.length, "the validator reported no checks at all").toBeGreaterThan(0);
  return new Map(results.map((check) => [check.id, { status: check.status, detail: check.detail }]));
}

const CLEAN = { id: "TC-REQ-FR-KP-TEST-001-AC1-01", req_id: "FR-KP-TEST-001", ac_refs: ["AC-1"] };

describe("FR-FLOW-143 AC-3 — the validator decides the req-mapping rule when run", () => {
  it("passes a plan whose test case maps correctly", () => {
    const checks = runValidator(CLEAN);
    expect(checks.get("C23")?.status, `C23 rejected a clean fixture: ${JSON.stringify(checks.get("C23")?.detail)}`).toBe("pass");
    expect(checks.get("R04")?.status, `R04 rejected a clean fixture: ${JSON.stringify(checks.get("R04")?.detail)}`).toBe("pass");
  });

  it("reports a requirement id outside the task's set", () => {
    const checks = runValidator({ ...CLEAN, id: "TC-REQ-FR-OTHER-999-AC1-01", req_id: "FR-OTHER-999" });
    expect(checks.get("C23")?.status, "the validator accepted a requirement id outside the task").toBe("error");
  });

  it("reports a criterion reference outside the requirement", () => {
    const checks = runValidator({ ...CLEAN, ac_refs: ["AC-9"] });
    expect(checks.get("C23")?.status, "the validator accepted a criterion the requirement does not have").toBe("error");
  });

  it("reports a malformed test-case identifier", () => {
    const checks = runValidator({ ...CLEAN, id: "not-a-test-case-id" });
    expect(checks.get("R04")?.status, "the validator accepted a malformed identifier").toBe("error");
  });
});
