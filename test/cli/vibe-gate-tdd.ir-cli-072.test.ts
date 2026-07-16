import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

// IR-CLI-072 — vibe-gate check enforces the tdd active task.
//
// Red-phase suite: one test case per acceptance criterion (AC-1..AC-4). AC-1
// and AC-2 fail while the gate only fires for mode === "vibe" (read.ts) —
// a tdd active task currently passes with synthesized=true by default — until
// the gate is extended to mode ∈ {vibe, tdd} plus the tdd design.md check.
//
// Contract under test (docs/spec/30.cli-interface.srs.md IR-CLI-072):
//   - AC-1: tdd + Active Task without a step directory → exit 1, blocked.
//   - AC-2: tdd + synthesized step directory without design.md → exit 1,
//           the failure message names design.md.
//   - AC-3: tdd + synthesized step directory with design.md → exit 0.
//   - AC-4: sdd/wait stay pass-through; vibe behavior unchanged.

function io() {
  return { stdout: new PassThrough() as NodeJS.WriteStream, stderr: new PassThrough() as NodeJS.WriteStream };
}

function drain(stream: NodeJS.WriteStream): string {
  return (stream as unknown as PassThrough).read()?.toString() ?? "";
}

async function writeStateMd(root: string, options: { mode: string; activeTask?: string }): Promise<void> {
  const stepsDir = path.join(root, "docs", "spec", "steps");
  await mkdir(stepsDir, { recursive: true });
  const lines = [
    "# Step State",
    "",
    `Mode: ${options.mode}`,
    ...(options.activeTask !== undefined ? [`Active Task: ${options.activeTask}`] : []),
    "",
    "| Step | Status | DependsOn | TouchesScope | TouchesReq | Created | Updated |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    "| step-a | active | - | ARCH | - | 2026-06-01 | 2026-06-02 |",
    ""
  ];
  await writeFile(path.join(stepsDir, "state.md"), lines.join("\n"), "utf8");
}

async function synthesizeStepDir(root: string, task: string, options: { design?: boolean } = {}): Promise<void> {
  const stepDir = path.join(root, "docs", "spec", "steps", task);
  await mkdir(stepDir, { recursive: true });
  await writeFile(path.join(stepDir, "intent.md"), "# Intent\n", "utf8");
  if (options.design) {
    await writeFile(path.join(stepDir, "design.md"), "# SDS: sample\n", "utf8");
  }
}

describe("IR-CLI-072 — vibe-gate check enforces the tdd active task", () => {
  it("IR-CLI-072 AC-1: tdd active task without a step directory blocks with exit 1", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    await writeStateMd(root, { mode: "tdd", activeTask: "T-TDD-01" });

    const streams = io();
    const code = await main(["--root", root, "vibe-gate", "check", "--json"], streams);

    expect(code).toBe(1);
    const output = JSON.parse(drain(streams.stdout));
    expect(output.ok).toBe(false);
  });

  it("IR-CLI-072 AC-2: tdd synthesized step directory without design.md blocks naming design.md", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    await writeStateMd(root, { mode: "tdd", activeTask: "T-TDD-01" });
    await synthesizeStepDir(root, "T-TDD-01", { design: false });

    const streams = io();
    const code = await main(["--root", root, "vibe-gate", "check", "--json"], streams);

    expect(code).toBe(1);
    const output = JSON.parse(drain(streams.stdout));
    expect(output.ok).toBe(false);
    expect(output.error.message).toContain("design.md");
  });

  it("IR-CLI-072 AC-3: tdd synthesized step directory with design.md passes", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    await writeStateMd(root, { mode: "tdd", activeTask: "T-TDD-01" });
    await synthesizeStepDir(root, "T-TDD-01", { design: true });

    const streams = io();
    const code = await main(["--root", root, "vibe-gate", "check", "--json"], streams);

    expect(code).toBe(0);
    const output = JSON.parse(drain(streams.stdout));
    expect(output.ok).toBe(true);
    expect(output.value.blocked).toBe(false);
  });

  it("IR-CLI-072 AC-4: sdd/wait stay pass-through and vibe keeps its synthesis-only check", async () => {
    // sdd and wait: pass-through regardless of step directories.
    for (const mode of ["sdd", "wait"] as const) {
      const root = await copyFixtureWorkspace("valid-basic");
      await writeStateMd(root, { mode });
      const streams = io();
      expect(await main(["--root", root, "vibe-gate", "check", "--json"], streams)).toBe(0);
    }

    // vibe regression: a synthesized step directory passes even without design.md
    // (the design.md requirement is tdd-only).
    const vibeRoot = await copyFixtureWorkspace("valid-basic");
    await writeStateMd(vibeRoot, { mode: "vibe", activeTask: "T-VIBE-01" });
    await synthesizeStepDir(vibeRoot, "T-VIBE-01", { design: false });
    const vibeStreams = io();
    expect(await main(["--root", vibeRoot, "vibe-gate", "check", "--json"], vibeStreams)).toBe(0);

    // vibe regression: an unsynthesized active vibe task still blocks.
    const blockedRoot = await copyFixtureWorkspace("valid-basic");
    await writeStateMd(blockedRoot, { mode: "vibe", activeTask: "T-VIBE-02" });
    const blockedStreams = io();
    expect(await main(["--root", blockedRoot, "vibe-gate", "check", "--json"], blockedStreams)).toBe(1);
  });
});
