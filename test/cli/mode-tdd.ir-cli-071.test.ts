import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

// IR-CLI-071 — speckiwi mode accepts tdd.
//
// Red-phase suite: one test case per acceptance criterion (AC-1..AC-4). The
// suite fails while `tdd` is outside the command's validModes set (INVALID_MODE
// exit 2) until the set, the error message, and the argument help are extended.
//
// Contract under test (docs/spec/30.cli-interface.srs.md IR-CLI-071):
//   - AC-1: `speckiwi mode tdd` persists `Mode: tdd` and exits 0.
//   - AC-2: a subsequent `speckiwi mode` read reports tdd.
//   - AC-3: an out-of-enum value fails INVALID_MODE exit 2 and the
//           expected-values message includes tdd.
//   - AC-4: the argument help lists tdd as a switch target.

function io() {
  return { stdout: new PassThrough() as NodeJS.WriteStream, stderr: new PassThrough() as NodeJS.WriteStream };
}

function drain(stream: NodeJS.WriteStream): string {
  return (stream as unknown as PassThrough).read()?.toString() ?? "";
}

async function writeStateMd(root: string, mode: string): Promise<void> {
  const stepsDir = path.join(root, "docs", "spec", "steps");
  await mkdir(stepsDir, { recursive: true });
  const lines = [
    "# Step State",
    "",
    `Mode: ${mode}`,
    "",
    "| Step | Status | DependsOn | TouchesScope | TouchesReq | Created | Updated |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    "| step-a | active | - | ARCH | - | 2026-06-01 | 2026-06-02 |",
    ""
  ];
  await writeFile(path.join(stepsDir, "state.md"), lines.join("\n"), "utf8");
}

describe("IR-CLI-071 — speckiwi mode accepts tdd", () => {
  it("IR-CLI-071 AC-1: `speckiwi mode tdd` persists Mode: tdd and exits 0", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    await writeStateMd(root, "sdd");

    const streams = io();
    const code = await main(["--root", root, "mode", "tdd", "--json"], streams);

    expect(code).toBe(0);
    const output = JSON.parse(drain(streams.stdout));
    expect(output.ok).toBe(true);
    expect(output.value.mode).toBe("tdd");

    const persisted = await readFile(path.join(root, "docs", "spec", "steps", "state.md"), "utf8");
    expect(persisted).toMatch(/^\s*Mode:\s*tdd\s*$/m);
  });

  it("IR-CLI-071 AC-2: a subsequent read reports mode tdd", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    await writeStateMd(root, "sdd");

    const setStreams = io();
    expect(await main(["--root", root, "mode", "tdd", "--json"], setStreams)).toBe(0);

    const readStreams = io();
    const code = await main(["--root", root, "mode", "--json"], readStreams);
    expect(code).toBe(0);
    const output = JSON.parse(drain(readStreams.stdout));
    expect(output.ok).toBe(true);
    expect(output.value.mode).toBe("tdd");
  });

  it("IR-CLI-071 AC-3: an out-of-enum value fails INVALID_MODE exit 2 listing tdd", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    await writeStateMd(root, "sdd");

    const streams = io();
    const code = await main(["--root", root, "mode", "tddx", "--json"], streams);

    expect(code).toBe(2);
    const output = JSON.parse(drain(streams.stdout));
    expect(output.ok).toBe(false);
    expect(output.error.code).toBe("INVALID_MODE");
    // The expected-values message must include tdd among the valid switch targets.
    expect(output.error.message).toContain("tdd");
  });

  it("IR-CLI-071 AC-4: the argument help lists tdd as a switch target", async () => {
    const streams = io();
    const code = await main(["mode", "--help"], streams);

    expect(code).toBe(0);
    const help = drain(streams.stdout);
    expect(help).toContain("tdd");
  });
});
