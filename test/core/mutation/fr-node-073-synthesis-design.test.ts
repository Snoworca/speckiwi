import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { synthesizeStepSrs } from "../../../src/core/mutation/synthesis.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";

// FR-NODE-073 — step SRS synthesis merges design.md. RED suite (one case per AC).
//
// The synthesis engine currently merges intent.md, trace shards, step comments,
// and the diff (FR-NODE-056); this suite pins the additional `## Design` section
// sourced from docs/spec/steps/<task>/design.md (the tdd-mode SDS), placed
// between Intent and Trace with the same secret redaction, and the unchanged
// output shape when design.md is absent.
//
// Every test exercises the real filesystem (no mocks); a throwaway workspace is
// created under os.tmpdir() and removed afterwards.

const TASK_NAME = "AddTddDesignMerge";

async function makeWorkspace(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "speckiwi-fr-node-073-"));
  await mkdir(path.join(root, ".git"), { recursive: true });
  await mkdir(path.join(root, "docs", "spec"), { recursive: true });
  await writeFile(
    path.join(root, "docs", "spec", "00.index.md"),
    "# Index\n\n| Field | Value |\n|---|---|\n| Document Type | index |\n",
    "utf8"
  );
  return root;
}

async function seedStepInputs(root: string, task: string, opts: { design?: string } = {}): Promise<void> {
  const stepDir = path.join(root, "docs", "spec", "steps", task);
  await mkdir(path.join(stepDir, "trace"), { recursive: true });
  await writeFile(path.join(stepDir, "intent.md"), `# ${task}\n\nIntent body.\n`, "utf8");
  if (opts.design !== undefined) {
    await writeFile(path.join(stepDir, "design.md"), opts.design, "utf8");
  }
}

const stepSrsPath = (root: string, task: string): string =>
  path.join(root, "docs", "spec", "steps", task, `${task}.srs.md`);

describe("FR-NODE-073 step SRS synthesis merges design.md", () => {
  let root: string;

  beforeEach(async () => {
    root = await makeWorkspace();
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("FR-NODE-073 AC-1: merges design.md as a `## Design` section between Intent and Trace", async () => {
    await seedStepInputs(root, TASK_NAME, {
      design: "# SDS: sample\n\nSDS-AC-1: WHEN X THE SYSTEM SHALL Y.\n"
    });

    const result = await synthesizeStepSrs(await resolveProjectRoot(root), { task: TASK_NAME });
    expect(result.ok).toBe(true);

    const srs = await readFile(stepSrsPath(root, TASK_NAME), "utf8");
    expect(srs).toContain("## Design");
    expect(srs).toContain("SDS-AC-1: WHEN X THE SYSTEM SHALL Y.");
    const intentIdx = srs.indexOf("## Intent");
    const designIdx = srs.indexOf("## Design");
    const traceIdx = srs.indexOf("## Trace");
    expect(intentIdx).toBeGreaterThanOrEqual(0);
    expect(designIdx).toBeGreaterThan(intentIdx);
    expect(traceIdx).toBeGreaterThan(designIdx);
  });

  it("FR-NODE-073 AC-2: redacts recognized secrets in design.md and counts them", async () => {
    await seedStepInputs(root, TASK_NAME, {
      design: "# SDS\n\nUse header token=abc123SECRET9 for the call.\n"
    });

    const result = await synthesizeStepSrs(await resolveProjectRoot(root), { task: TASK_NAME });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.redactions).toBeGreaterThanOrEqual(1);
    }

    const srs = await readFile(stepSrsPath(root, TASK_NAME), "utf8");
    expect(srs).toContain("[REDACTED]");
    expect(srs).not.toContain("abc123SECRET9");
  });

  it("FR-NODE-073 AC-3: without design.md the output has no Design section (regression)", async () => {
    await seedStepInputs(root, TASK_NAME);

    const result = await synthesizeStepSrs(await resolveProjectRoot(root), { task: TASK_NAME });
    expect(result.ok).toBe(true);

    const srs = await readFile(stepSrsPath(root, TASK_NAME), "utf8");
    expect(srs).not.toContain("## Design");
    expect(srs).toContain("## Intent");
    expect(srs).toContain("## Trace");
  });

  it("FR-NODE-073 AC-4: synthesis stays an idempotent no-op when the step SRS exists (regression)", async () => {
    await seedStepInputs(root, TASK_NAME, { design: "# SDS v1\n" });
    const projectRoot = await resolveProjectRoot(root);

    const first = await synthesizeStepSrs(projectRoot, { task: TASK_NAME });
    expect(first.ok).toBe(true);
    if (first.ok) expect(first.value.written).toBe(true);

    // A changed design.md must not be re-merged: the second run is a no-op.
    await writeFile(path.join(root, "docs", "spec", "steps", TASK_NAME, "design.md"), "# SDS v2\n", "utf8");
    const second = await synthesizeStepSrs(projectRoot, { task: TASK_NAME });
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.value.skipped).toBe(true);
      expect(second.value.written).toBe(false);
    }

    const srs = await readFile(stepSrsPath(root, TASK_NAME), "utf8");
    expect(srs).toContain("# SDS v1");
    expect(srs).not.toContain("# SDS v2");
  });
});
