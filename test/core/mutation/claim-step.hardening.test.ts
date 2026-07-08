import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";
import { claimStep } from "../../../src/core/mutation/claim-step.js";

// FR-NODE-042 — hardening tests for claim_step.
//
// FND-003 (input sanitize): step / touchesScope / TouchesReq tokens are written
//   verbatim into a pipe-delimited state.md row. A `|` would split the row into
//   extra columns and a newline / CR / control char would inject rows or
//   markdown. claimStep MUST reject such inputs with USAGE and write nothing.
// FND-006 (dryRun): claimStep MUST honour an optional dryRun flag so a dry-run
//   request never writes to state.md.

const SPEC_DIR = path.join("docs", "spec");
const STATE_MD_REL = path.join(SPEC_DIR, "steps", "state.md");

async function writeEmptyStateMd(root: string): Promise<void> {
  const stepsDir = path.join(root, SPEC_DIR, "steps");
  await mkdir(stepsDir, { recursive: true });
  const content = [
    "# Step State",
    "",
    "Mode: sdd",
    "",
    "| Step | Status | DependsOn | TouchesScope | TouchesReq | Created | Updated |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ""
  ].join("\n");
  await writeFile(path.join(stepsDir, "state.md"), content, "utf8");
}

async function readStateMd(root: string): Promise<string> {
  return readFile(path.join(root, STATE_MD_REL), "utf8");
}

describe("FR-NODE-042 FND-003 — claim_step rejects unsafe state.md cell inputs and writes nothing", () => {
  const cases: Array<{ label: string; input: { step: string; touchesScope: string; touchesReq: string[] } }> = [
    { label: "pipe in step", input: { step: "feat|x", touchesScope: "ARCH", touchesReq: ["FR-ARCH-010"] } },
    { label: "newline in step", input: { step: "feat\nx", touchesScope: "ARCH", touchesReq: ["FR-ARCH-010"] } },
    { label: "pipe in touchesScope", input: { step: "feat-x", touchesScope: "AR|CH", touchesReq: ["FR-ARCH-010"] } },
    { label: "newline in touchesScope", input: { step: "feat-x", touchesScope: "AR\nCH", touchesReq: ["FR-ARCH-010"] } },
    { label: "pipe in touchesReq token", input: { step: "feat-x", touchesScope: "ARCH", touchesReq: ["FR-ARCH|010"] } },
    { label: "newline in touchesReq token", input: { step: "feat-x", touchesScope: "ARCH", touchesReq: ["FR-ARCH\n010"] } },
    { label: "carriage return in step", input: { step: "feat\rx", touchesScope: "ARCH", touchesReq: ["FR-ARCH-010"] } }
  ];

  for (const { label, input } of cases) {
    it(`rejects ${label} with USAGE and leaves state.md byte-for-byte unchanged`, async () => {
      const root = await copyFixtureWorkspace("valid-basic");
      await writeEmptyStateMd(root);
      const before = await readStateMd(root);

      const result = await claimStep(await resolveProjectRoot(root), input);

      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe("USAGE");
      expect(await readStateMd(root)).toBe(before);
    });
  }
});

describe("FR-NODE-042 FND-006 — claim_step honours dryRun", () => {
  it("writes nothing and reports written:false when dryRun is true", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    await writeEmptyStateMd(root);
    const before = await readStateMd(root);

    const result = await claimStep(await resolveProjectRoot(root), {
      step: "feature-x",
      touchesScope: "ARCH",
      touchesReq: ["FR-ARCH-010"],
      dryRun: true
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.written).toBe(false);
    }
    expect(await readStateMd(root)).toBe(before);
  });
});
