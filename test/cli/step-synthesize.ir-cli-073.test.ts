import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { toolSpecs, assertZeroDriftToolSurface } from "../../src/mcp/schemas.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

// IR-CLI-073 — step synthesize CLI command exposes the step SRS synthesis engine.
//
// Red-phase suite: one test case per acceptance criterion (AC-1..AC-4). The suite
// fails while `speckiwi step synthesize` does not exist (commander rejects the
// unknown subcommand) until the green step wires the command to the core
// synthesizeStepSrs engine (FR-NODE-041/FR-NODE-073).
//
// Contract under test (docs/spec/30.cli-interface.srs.md IR-CLI-073):
//   - AC-1: `step synthesize <task> --json` writes docs/spec/steps/<task>/<task>.srs.md,
//           reports written=true, exit 0.
//   - AC-2: an existing step SRS is an idempotent no-op (skipped=true, written=false, exit 0).
//   - AC-3: --dry-run writes nothing and reports written=false.
//   - AC-4: the new `synthesize` CLI leaf is declared in the tool registry.

function io() {
  return { stdout: new PassThrough() as NodeJS.WriteStream, stderr: new PassThrough() as NodeJS.WriteStream };
}

function drain(stream: NodeJS.WriteStream): string {
  return (stream as unknown as PassThrough).read()?.toString() ?? "";
}

async function isFile(target: string): Promise<boolean> {
  try {
    return (await stat(target)).isFile();
  } catch {
    return false;
  }
}

const TASK = "feature-synth";

async function writeStepArtifacts(root: string, task: string): Promise<void> {
  const stepDir = path.join(root, "docs", "spec", "steps", task);
  await mkdir(stepDir, { recursive: true });
  await writeFile(path.join(stepDir, "intent.md"), "# Intent\n\nSynthesize fixture intent.\n", "utf8");
}

function stepSrsPath(root: string, task: string): string {
  return path.join(root, "docs", "spec", "steps", task, `${task}.srs.md`);
}

describe("IR-CLI-073 — step synthesize CLI command", () => {
  it("IR-CLI-073 AC-1: step synthesize writes the step SRS and reports written=true with exit 0", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    await writeStepArtifacts(root, TASK);

    const streams = io();
    const code = await main(["--root", root, "step", "synthesize", TASK, "--json"], streams);

    expect(code).toBe(0);
    const output = JSON.parse(drain(streams.stdout));
    expect(output.ok).toBe(true);
    expect(output.value.written).toBe(true);
    expect(await isFile(stepSrsPath(root, TASK))).toBe(true);
    const srs = await readFile(stepSrsPath(root, TASK), "utf8");
    expect(srs.length).toBeGreaterThan(0);
  });

  it("IR-CLI-073 AC-2: an existing step SRS is an idempotent no-op with exit 0", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    await writeStepArtifacts(root, TASK);

    const first = io();
    expect(await main(["--root", root, "step", "synthesize", TASK, "--json"], first)).toBe(0);
    const before = await readFile(stepSrsPath(root, TASK), "utf8");

    const second = io();
    const code = await main(["--root", root, "step", "synthesize", TASK, "--json"], second);

    expect(code).toBe(0);
    const output = JSON.parse(drain(second.stdout));
    expect(output.ok).toBe(true);
    expect(output.value.skipped).toBe(true);
    expect(output.value.written).toBe(false);
    expect(await readFile(stepSrsPath(root, TASK), "utf8")).toBe(before);
  });

  it("IR-CLI-073 AC-3: --dry-run writes nothing and reports written=false", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    await writeStepArtifacts(root, TASK);

    const streams = io();
    const code = await main(["--root", root, "step", "synthesize", TASK, "--dry-run", "--json"], streams);

    expect(code).toBe(0);
    const output = JSON.parse(drain(streams.stdout));
    expect(output.ok).toBe(true);
    expect(output.value.written).toBe(false);
    expect(await isFile(stepSrsPath(root, TASK))).toBe(false);
  });

  it("IR-CLI-073 AC-4: the synthesize CLI leaf is declared in the tool registry", () => {
    const spec = toolSpecs.find((candidate) => candidate.cliName === "synthesize");
    expect(spec, "registry must declare the `synthesize` CLI leaf").toBeDefined();
    expect(spec?.mcpName).toBe("synthesize_step_srs");
    expect(spec?.coreFn).toBe("synthesizeStepSrs");
    expect(() => assertZeroDriftToolSurface()).not.toThrow();
  });
});
