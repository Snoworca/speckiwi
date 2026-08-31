import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

/**
 * FR-PARSE-040 AC-4 (CLI surface) — the exit code is the whole point of this item.
 *
 * The core pass can classify perfectly and still change nothing if the surface never loads the
 * record or never lets an SDS finding reach the exit code. Both were true before this item:
 * `speckiwi step validate` loaded design.md alone, and every SDS code was warning severity while
 * `read.ts` flips the exit only on errors. So the failing exit asserted here was red, and it is red
 * for a reason no core-level assertion can reach.
 *
 * The two cases are the same command over the same step, differing only in whether intent.md
 * carries the record. Observing only the failure would prove the exemption was removed rather than
 * turned into a comparison.
 */

const STEP = "tdd-step-x";

function io() {
  return { stdout: new PassThrough() as NodeJS.WriteStream, stderr: new PassThrough() as NodeJS.WriteStream };
}

function drain(stream: NodeJS.WriteStream): string {
  return (stream as unknown as PassThrough).read()?.toString() ?? "";
}

async function tddWorkspace(): Promise<string> {
  const root = await copyFixtureWorkspace("valid-basic");
  const stepsDir = path.join(root, "docs", "spec", "steps");
  await mkdir(stepsDir, { recursive: true });
  await writeFile(
    path.join(stepsDir, "state.md"),
    [
      "# Step State",
      "",
      "Mode: tdd",
      `Active Task: ${STEP}`,
      "",
      "| Step | Status | DependsOn | TouchesScope | TouchesReq | Created | Updated |",
      "| --- | --- | --- | --- | --- | --- | --- |",
      `| ${STEP} | active | - | ARCH | - | 2026-09-01 | 2026-09-01 |`,
      ""
    ].join("\n"),
    "utf8"
  );
  return root;
}

async function writeRecord(root: string): Promise<void> {
  const stepDir = path.join(root, "docs", "spec", "steps", STEP);
  await mkdir(stepDir, { recursive: true });
  await writeFile(
    path.join(stepDir, "intent.md"),
    [
      `# Intent: ${STEP}`,
      "",
      "## SDS Skip",
      "",
      "| Field | Value |",
      "| --- | --- |",
      "| Decision | skipped |",
      "| Reason | Renames one private helper; no interface and no behaviour changes. |",
      "",
      "- SDS-AC-1: WHEN the helper is renamed THE SYSTEM SHALL keep every caller resolving.",
      ""
    ].join("\n"),
    "utf8"
  );
}

describe("FR-PARSE-040 AC-4 — speckiwi step validate decides the skip", () => {
  it("exits 1 and reports SDS-E054 when the SDS is skipped without a record", async () => {
    const root = await tddWorkspace();
    const streams = io();

    const code = await main(["--root", root, "step", "validate", STEP, "--json"], streams);

    expect(code).toBe(1);
    const output = JSON.parse(drain(streams.stdout));
    const errors: { code: string }[] = output.errors ?? [];
    expect(errors.map((item) => item.code)).toContain("SDS-E054");
  });

  it("exits 0 and keeps SDS-W050 a warning once the record is written", async () => {
    const root = await tddWorkspace();
    await writeRecord(root);
    const streams = io();

    const code = await main(["--root", root, "step", "validate", STEP, "--json"], streams);

    expect(code).toBe(0);
    const output = JSON.parse(drain(streams.stdout));
    const warnings: { code: string }[] = output.warnings ?? [];
    const errors: { code: string }[] = output.errors ?? [];
    expect(warnings.map((item) => item.code)).toContain("SDS-W050");
    expect(errors.map((item) => item.code)).not.toContain("SDS-E054");
  });
});
