import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

// IR-CLI-048 — speckiwi mode command.
//
// Red-phase suite (T-PH004-05): one test case per acceptance criterion (AC-1..AC-3).
// These cases pin the future CLI contract before src/cli exposes the `mode` subcommand,
// so the whole suite fails (commander rejects the unknown `mode` command, and/or the
// output / mode-switch / exit-code assertions are unmet) until the green task
// (T-PH004-06) wires `speckiwi mode [sdd|vibe|wait]` to getWorkMode / setWorkMode
// (FR-NODE-050, src/core/mutation/work-mode.ts).
//
// Contract under test (from the requirement body and AC, SRS
// docs/spec/30.cli-interface.srs.md IR-CLI-048):
//
//   The CLI exposes `speckiwi mode` with an optional sdd, vibe, or wait argument to
//   read or switch the work mode, printing the current Mode and Active Task and
//   rejecting an invalid mode value with a non-zero exit code.
//
//   - AC-1: `speckiwi mode` with no argument prints the current Mode and Active Task.
//   - AC-2: `speckiwi mode <value>` switches Mode to a value in sdd, vibe, wait.
//   - AC-3: `speckiwi mode` rejects an invalid mode value with a non-zero exit code.

function io() {
  return { stdout: new PassThrough() as NodeJS.WriteStream, stderr: new PassThrough() as NodeJS.WriteStream };
}

const SPEC_DIR = path.join("docs", "spec");

/** Reads everything a stream has buffered (the CLI writes synchronously before main resolves). */
function drain(stream: NodeJS.WriteStream): string {
  return (stream as unknown as PassThrough).read()?.toString() ?? "";
}

/**
 * Seeds docs/spec/steps/state.md with a top-of-file work-mode metadata block (the Mode
 * and, for vibe, the Active Task lines above the step-state table). parseStepState reads
 * these back, so this is what `speckiwi mode` (no argument) must surface and what
 * `speckiwi mode <value>` must rewrite.
 */
async function writeStateMd(root: string, options: { mode: string; activeTask?: string }): Promise<void> {
  const stepsDir = path.join(root, SPEC_DIR, "steps");
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

async function readStateMd(root: string): Promise<string> {
  return readFile(path.join(root, SPEC_DIR, "steps", "state.md"), "utf8");
}

describe("IR-CLI-048 — speckiwi mode command", () => {
  // AC-1: `speckiwi mode` with no argument prints the current Mode and Active Task.
  it("IR-CLI-048 AC-1: with no argument prints the current Mode and Active Task", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    // A vibe mode with a named Active Task: both fields must be surfaced.
    await writeStateMd(root, { mode: "vibe", activeTask: "T-PH004-05" });

    const streams = io();
    const code = await main(["--root", root, "mode", "--json"], streams);

    // Reading the current mode is not an error.
    expect(code).toBe(0);
    const output = JSON.parse(drain(streams.stdout));
    // The JSON envelope must report both the current Mode and the Active Task.
    expect(output.ok).toBe(true);
    expect(output.value.mode).toBe("vibe");
    expect(output.value.activeTask).toBe("T-PH004-05");
  });

  // AC-1 (human-readable): the non-JSON output also names the current Mode and Active Task.
  it("IR-CLI-048 AC-1: human output names both the current Mode and the Active Task", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    await writeStateMd(root, { mode: "vibe", activeTask: "T-PH004-05" });

    const streams = io();
    const code = await main(["--root", root, "mode"], streams);

    expect(code).toBe(0);
    const text = drain(streams.stdout);
    expect(text).toContain("vibe");
    expect(text).toContain("T-PH004-05");
  });

  // AC-2: `speckiwi mode <value>` switches Mode to a value in sdd, vibe, wait.
  it("IR-CLI-048 AC-2: with a value switches Mode and persists it to state.md", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    // Start in sdd, then switch to wait via the CLI.
    await writeStateMd(root, { mode: "sdd" });

    const setStreams = io();
    const setCode = await main(["--root", root, "mode", "wait", "--json"], setStreams);
    expect(setCode).toBe(0);
    const setOutput = JSON.parse(drain(setStreams.stdout));
    expect(setOutput.ok).toBe(true);
    expect(setOutput.value.mode).toBe("wait");

    // The switch is persisted: the state.md metadata block now records the new Mode.
    const persisted = await readStateMd(root);
    expect(persisted).toMatch(/^\s*Mode:\s*wait\s*$/m);

    // A subsequent read reflects the switched mode.
    const readStreams = io();
    const readCode = await main(["--root", root, "mode", "--json"], readStreams);
    expect(readCode).toBe(0);
    const readOutput = JSON.parse(drain(readStreams.stdout));
    expect(readOutput.value.mode).toBe("wait");
  });

  // AC-2 (each accepted enum value): sdd, vibe, and wait are all accepted switch targets.
  it("IR-CLI-048 AC-2: accepts each of sdd, vibe, wait as a switch target", async () => {
    for (const mode of ["sdd", "vibe", "wait"] as const) {
      const root = await copyFixtureWorkspace("valid-basic");
      await writeStateMd(root, { mode: "sdd" });

      const streams = io();
      const code = await main(["--root", root, "mode", mode, "--json"], streams);
      expect(code).toBe(0);
      const output = JSON.parse(drain(streams.stdout));
      expect(output.ok).toBe(true);
      expect(output.value.mode).toBe(mode);
    }
  });

  // AC-3: `speckiwi mode` rejects an invalid mode value with a non-zero exit code.
  it("IR-CLI-048 AC-3: rejects an invalid mode value with a non-zero exit code", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    await writeStateMd(root, { mode: "sdd" });

    // Control: the command itself is recognized and a *valid* value is accepted with
    // exit 0. This distinguishes "rejects an invalid mode value" (the AC) from
    // "rejects everything because the subcommand is unknown".
    const validStreams = io();
    const validCode = await main(["--root", root, "mode", "wait", "--json"], validStreams);
    expect(validCode).toBe(0);

    const streams = io();
    const code = await main(["--root", root, "mode", "bogus", "--json"], streams);

    // An invalid mode value must be rejected with a non-zero exit code.
    expect(code).not.toBe(0);
    // The rejection surfaces a structured JSON error envelope (not silent success).
    const output = JSON.parse(drain(streams.stdout));
    expect(output.ok).toBe(false);

    // The invalid value must not have corrupted the persisted state (still the
    // last valid switch target, wait).
    const persisted = await readStateMd(root);
    expect(persisted).not.toMatch(/^\s*Mode:\s*bogus\s*$/m);
    expect(persisted).toMatch(/^\s*Mode:\s*wait\s*$/m);
  });
});
