import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";
// The green task (T-PH003-24) introduces a new export `updateStepState` in
// src/core/mutation/update-step-state.ts. Importing the not-yet-existing module
// makes the whole suite red until the green task implements it.
import { updateStepState } from "../../../src/core/mutation/update-step-state.js";

// FR-NODE-028 — update_step_state mutation.
//
// Red-phase suite (T-PH003-23): one test case per acceptance criterion
// (AC-1..AC-3). These cases describe the future contract of updateStepState
// before src/core/mutation/update-step-state.ts exports it, so the whole suite
// fails (missing module/export) until the green task (T-PH003-24) implements it.
//
// Contract under test (from the requirement body and AC):
//   updateStepState(root, { step, status?, dependsOn? }) updates an existing
//   docs/spec/steps/state.md step row's Status, DependsOn, and Updated fields:
//     - AC-1: changes the Status field of an existing step row to a value in
//             {active, merging, merged, abandoned}.
//     - AC-2: updates the DependsOn and Updated fields of the targeted step row.
//     - AC-3: targeting a non-existent step returns NOT_FOUND.

const SPEC_DIR = path.join("docs", "spec");
const STATE_MD_REL = path.join(SPEC_DIR, "steps", "state.md");

/**
 * Writes a docs/spec/steps/state.md table seeded with the supplied step rows.
 * Columns match the FR-PARSE-023 layout
 * (Step, Status, DependsOn, TouchesScope, TouchesReq, Created, Updated).
 */
async function writeStateMd(
  root: string,
  rows: Array<{
    step: string;
    status?: string;
    dependsOn?: string;
    touchesScope?: string;
    touchesReq?: string;
    created?: string;
    updated?: string;
  }>
): Promise<void> {
  const stepsDir = path.join(root, SPEC_DIR, "steps");
  await mkdir(stepsDir, { recursive: true });
  const rendered = rows.map(
    (r) =>
      `| ${r.step} | ${r.status ?? "active"} | ${r.dependsOn ?? "-"} | ${
        r.touchesScope ?? "ARCH"
      } | ${r.touchesReq ?? "FR-ARCH-001"} | ${r.created ?? "2026-06-01"} | ${
        r.updated ?? "2026-06-02"
      } |`
  );
  const content = [
    "# Step State",
    "",
    "Mode: sdd",
    "",
    "| Step | Status | DependsOn | TouchesScope | TouchesReq | Created | Updated |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...rendered,
    ""
  ].join("\n");
  await writeFile(path.join(stepsDir, "state.md"), content, "utf8");
}

async function readStateMd(root: string): Promise<string> {
  return readFile(path.join(root, STATE_MD_REL), "utf8");
}

/**
 * Extracts the pipe-delimited cells of the state.md row whose first cell matches
 * the given step name. Returns the trimmed cells between the leading/trailing
 * pipes (Step, Status, DependsOn, TouchesScope, TouchesReq, Created, Updated).
 */
function rowCells(stateMd: string, step: string): string[] | undefined {
  const line = stateMd
    .split("\n")
    .find((l) => l.startsWith("|") && l.split("|")[1]?.trim() === step);
  if (!line) {
    return undefined;
  }
  return line
    .split("|")
    .slice(1, -1)
    .map((cell) => cell.trim());
}

describe("FR-NODE-028 AC-1 — update_step_state changes the Status field of an existing step row to an allowed value", () => {
  it("updates the Status of the targeted step row to a value in {active, merging, merged, abandoned}", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    await writeStateMd(root, [
      { step: "feature-x", status: "active", touchesReq: "FR-ARCH-001" }
    ]);
    const projectRoot = await resolveProjectRoot(root);

    const result = await updateStepState(projectRoot, {
      step: "feature-x",
      status: "merging"
    });

    expect(result.ok).toBe(true);
    const cells = rowCells(await readStateMd(root), "feature-x");
    expect(cells).toBeDefined();
    // Status is the 2nd column (index 1).
    expect(cells?.[1]).toBe("merging");
  });

  it("rejects a Status value outside {active, merging, merged, abandoned} and leaves the row unchanged", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    await writeStateMd(root, [
      { step: "feature-x", status: "active", touchesReq: "FR-ARCH-001" }
    ]);
    const projectRoot = await resolveProjectRoot(root);
    const before = await readStateMd(root);

    const result = await updateStepState(projectRoot, {
      step: "feature-x",
      status: "bogus-status"
    });

    expect(result.ok).toBe(false);
    // The invalid transition writes nothing.
    expect(await readStateMd(root)).toBe(before);
  });
});

describe("FR-NODE-028 AC-2 — update_step_state updates the DependsOn and Updated fields of the targeted step row", () => {
  it("rewrites the DependsOn cell and refreshes the Updated stamp of the targeted row", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    await writeStateMd(root, [
      {
        step: "feature-x",
        status: "active",
        dependsOn: "-",
        touchesReq: "FR-ARCH-001",
        updated: "2026-06-02"
      }
    ]);
    const projectRoot = await resolveProjectRoot(root);

    const result = await updateStepState(projectRoot, {
      step: "feature-x",
      dependsOn: "feature-y"
    });

    expect(result.ok).toBe(true);
    const cells = rowCells(await readStateMd(root), "feature-x");
    expect(cells).toBeDefined();
    // DependsOn is the 3rd column (index 2); Updated is the 7th column (index 6).
    expect(cells?.[2]).toBe("feature-y");
    // The Updated field is refreshed to today's date, not the seeded 2026-06-02.
    expect(cells?.[6]).not.toBe("2026-06-02");
    expect(cells?.[6]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("FR-NODE-028 AC-3 — update_step_state targeting a non-existent step returns NOT_FOUND", () => {
  it("returns NOT_FOUND and writes nothing when the targeted step row does not exist", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    await writeStateMd(root, [
      { step: "feature-x", status: "active", touchesReq: "FR-ARCH-001" }
    ]);
    const projectRoot = await resolveProjectRoot(root);
    const before = await readStateMd(root);

    const result = await updateStepState(projectRoot, {
      step: "ghost-step",
      status: "merged"
    });

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("NOT_FOUND");
    // The missing-target update writes nothing.
    expect(await readStateMd(root)).toBe(before);
  });
});
