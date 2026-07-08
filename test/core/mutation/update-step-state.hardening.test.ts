import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";
import { updateStepState } from "../../../src/core/mutation/update-step-state.js";

// FR-NODE-028 — hardening tests for update_step_state.
//
// FND-003 (input sanitize): the dependsOn cell is written verbatim into a
//   pipe-delimited state.md row, so a `|` / newline / control char would corrupt
//   the row. updateStepState MUST reject such inputs with USAGE and write nothing.
// FND-006 (dryRun): updateStepState MUST honour an optional dryRun flag.
// FND-008 (correctness): the target row MUST be identified by the Step column
//   (column-name based), skipping the header and separator rows so they can never
//   be mistaken for a step row.

const SPEC_DIR = path.join("docs", "spec");
const STATE_MD_REL = path.join(SPEC_DIR, "steps", "state.md");

async function writeStateMd(
  root: string,
  rows: Array<{ step: string; status?: string; dependsOn?: string; updated?: string }>
): Promise<void> {
  const stepsDir = path.join(root, SPEC_DIR, "steps");
  await mkdir(stepsDir, { recursive: true });
  const rendered = rows.map(
    (r) =>
      `| ${r.step} | ${r.status ?? "active"} | ${r.dependsOn ?? "-"} | ARCH | FR-ARCH-001 | 2026-06-01 | ${
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

describe("FR-NODE-028 FND-003 — update_step_state rejects unsafe dependsOn inputs and writes nothing", () => {
  const cases: Array<{ label: string; dependsOn: string }> = [
    { label: "pipe", dependsOn: "feature-y | extra-col" },
    { label: "newline", dependsOn: "feature-y\ninjected" },
    { label: "carriage return", dependsOn: "feature-y\rinjected" }
  ];

  for (const { label, dependsOn } of cases) {
    it(`rejects a dependsOn containing a ${label} with USAGE and leaves state.md unchanged`, async () => {
      const root = await copyFixtureWorkspace("valid-basic");
      await writeStateMd(root, [{ step: "feature-x" }]);
      const before = await readStateMd(root);

      const result = await updateStepState(await resolveProjectRoot(root), {
        step: "feature-x",
        dependsOn
      });

      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe("USAGE");
      expect(await readStateMd(root)).toBe(before);
    });
  }
});

describe("FR-NODE-028 FND-006 — update_step_state honours dryRun", () => {
  it("writes nothing and reports written:false when dryRun is true", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    await writeStateMd(root, [{ step: "feature-x", status: "active" }]);
    const before = await readStateMd(root);

    const result = await updateStepState(await resolveProjectRoot(root), {
      step: "feature-x",
      status: "merging",
      dryRun: true
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.written).toBe(false);
    }
    expect(await readStateMd(root)).toBe(before);
  });
});

describe("FR-NODE-028 FND-008 — update_step_state identifies the target row by the Step column", () => {
  it("does not mistake the table header row for a step named 'Step'", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    await writeStateMd(root, [{ step: "feature-x" }]);
    const before = await readStateMd(root);

    // The header row's first cell is literally "Step"; targeting it must NOT match.
    const result = await updateStepState(await resolveProjectRoot(root), {
      step: "Step",
      status: "merged"
    });

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("NOT_FOUND");
    expect(await readStateMd(root)).toBe(before);
  });
});
