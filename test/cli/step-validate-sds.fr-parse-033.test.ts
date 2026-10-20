import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

// FR-PARSE-033 (CLI surface) — `speckiwi step validate` carries the tdd SDS
// advisories. One end-to-end case: a present design.md missing a required heading
// surfaces SDS-W051 through the CLI JSON envelope without flipping the exit code
// (warning severity, non-gate-failing); an absent design.md gets no SDS diagnostic.

function io() {
  return { stdout: new PassThrough(), stderr: new PassThrough() };
}

function drain(stream: PassThrough): string {
  return stream.read()?.toString() ?? "";
}

describe("FR-PARSE-033 — step validate surfaces the SDS advisories", () => {
  it("FR-PARSE-033 AC-1 / AC-2: emits SDS-W051 for an incomplete design.md and nothing SDS- for an absent one, exit 0", async () => {
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
    await mkdir(path.join(stepsDir, "tdd-step-x"), { recursive: true });

    // An absent design.md: no SDS diagnostic at all (FR-PARSE-033 AC-1 as amended). The step carries
    // an acceptance line so FR-PARSE-042 does not fail the exit code on its own.
    await writeFile(
      path.join(stepsDir, "tdd-step-x", "intent.md"),
      ["# Intent: tdd-step-x", "", "## Acceptance", "", "- AC-1: WHEN the helper is renamed THE SYSTEM SHALL keep every caller resolving.", ""].join("\n"),
      "utf8"
    );
    const absentStreams = io();
    expect(await main(["--root", root, "step", "validate", "tdd-step-x", "--json"], absentStreams)).toBe(0);
    const absent = JSON.parse(drain(absentStreams.stdout));
    expect([...(absent.errors ?? []), ...(absent.warnings ?? [])].filter((item: { code: string }) => item.code.startsWith("SDS-"))).toEqual([]);

    // A design.md missing the Interfaces heading (but with an authored SDS-AC line).
    await writeFile(
      path.join(stepsDir, "tdd-step-x", "design.md"),
      ["# SDS", "", "## Context & Scope", "", "## Goals / Non-goals", "", "## Architecture Decisions", "", "## Acceptance Contracts", "", "- SDS-AC-1: WHEN X THE SYSTEM SHALL Y.", "", "## Test Plan", "", "| SDS-AC-1 | test/x.test.ts | y |", "", "## Open Questions", ""].join("\n"),
      "utf8"
    );
    const streams = io();
    const code = await main(["--root", root, "step", "validate", "tdd-step-x", "--json"], streams);

    // Warning severity never flips the step gate on its own.
    expect(code).toBe(0);
    const output = JSON.parse(drain(streams.stdout));
    const warnings: { code: string }[] = output.warnings ?? [];
    expect(warnings.some((item) => item.code === "SDS-W051")).toBe(true);
  });
});
