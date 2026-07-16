import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

// FR-PARSE-033 (CLI surface) — `speckiwi step validate` carries the tdd SDS
// advisories. One end-to-end case: an absent design.md in tdd mode surfaces
// SDS-W050 through the CLI JSON envelope without flipping the exit code
// (warning severity, non-gate-failing).

function io() {
  return { stdout: new PassThrough() as NodeJS.WriteStream, stderr: new PassThrough() as NodeJS.WriteStream };
}

function drain(stream: NodeJS.WriteStream): string {
  return (stream as unknown as PassThrough).read()?.toString() ?? "";
}

describe("FR-PARSE-033 — step validate surfaces the SDS advisories", () => {
  it("emits SDS-W050 for an absent design.md in tdd mode with exit 0", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    const stepsDir = path.join(root, "docs", "spec", "steps");
    await mkdir(stepsDir, { recursive: true });
    await writeFile(
      path.join(stepsDir, "state.md"),
      [
        "# Step State",
        "",
        "Mode: tdd",
        "Active Task: tdd-step-x",
        "",
        "| Step | Status | DependsOn | TouchesScope | TouchesReq | Created | Updated |",
        "| --- | --- | --- | --- | --- | --- | --- |",
        "| tdd-step-x | active | - | ARCH | - | 2026-07-16 | 2026-07-16 |",
        ""
      ].join("\n"),
      "utf8"
    );

    const streams = io();
    const code = await main(["--root", root, "step", "validate", "tdd-step-x", "--json"], streams);

    // Warning severity never flips the step gate on its own.
    expect(code).toBe(0);
    const output = JSON.parse(drain(streams.stdout));
    const warnings: { code: string }[] = output.warnings ?? [];
    expect(warnings.some((item) => item.code === "SDS-W050")).toBe(true);
  });
});
