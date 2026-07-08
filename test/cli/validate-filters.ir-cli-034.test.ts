import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

// IR-CLI-051 — validate severity / only / ignore display filters with an
// exit-code-from-unfiltered contract.
//
// Red-phase suite (T-PH004-11): one test case per acceptance criterion (AC-1..AC-5).
// These cases pin the future CLI contract before `src/cli/commands/read.ts` teaches the
// `validate` command the `--severity`, `--only`, and `--ignore` options, so the whole
// suite fails today — commander rejects the unknown options (non-zero usage exit, no
// filtered display) — until the green task (T-PH004-12) wires the filters and the
// exit-code-from-unfiltered-error-set contract.
//
// Contract under test (SRS docs/spec/30.cli-interface.srs.md IR-CLI-051):
//
//   The speckiwi validate command supports a --severity filter and repeatable --only and
//   --ignore code filters that affect which diagnostics are DISPLAYED, while the process
//   exit code is computed from the UNFILTERED error set so that an --ignore filter that
//   hides an error diagnostic cannot turn a failing validation into a zero exit code.
//
//   - AC-1: `validate --severity error` displays only error-severity diagnostics (human output).
//   - AC-2: `--only <code>` restricts displayed diagnostics to the listed codes; `--ignore <code>`
//           removes the listed codes from display.
//   - AC-3: When an error diagnostic exists but is hidden by --ignore or --severity, exit is still 1.
//   - AC-4: When only warnings exist and --fail-on-warning is not set, exit is 0 regardless of filters.
//   - AC-5: A test asserts that hiding an error via --ignore does not change the exit code from 1 to 0.
//
// Fixture pinning (captured from the live validator, deterministic):
//   - "index-drift-unregistered-srs" → one error code SRS-E015 + one warning code SRS-W018, exit 1.
//     Used wherever a mixed error+warning workspace is required.
//   - "index-drift-status-summary"   → one warning code SRS-W019 only, exit 0.
//     Used for AC-4 (warnings-only, must stay exit 0 under display filters).

function io() {
  return { stdout: new PassThrough() as NodeJS.WriteStream, stderr: new PassThrough() as NodeJS.WriteStream };
}

/** Drains the human (text) validate output from a finished run's stdout. */
function humanText(stream: NodeJS.WriteStream): string {
  return (stream as unknown as PassThrough).read()?.toString() ?? "";
}

/** Drains and parses the JSON validate envelope from a finished run's stdout. */
function parseJson(stream: NodeJS.WriteStream): {
  errors: Array<{ code: string }>;
  warnings: Array<{ code: string }>;
  diagnosticsSummary?: { errors: number; warnings: number; byCode: Record<string, number> };
} {
  return JSON.parse(humanText(stream) || "{}");
}

const ERROR_CODE = "SRS-E015";
const WARNING_CODE = "SRS-W018";

describe("IR-CLI-051 — validate severity / only / ignore display filters", () => {
  // AC-1: `validate --severity error` displays only error-severity diagnostics in human output.
  it("IR-CLI-051 AC-1: --severity error shows only error-severity diagnostics in human output", async () => {
    const root = await copyFixtureWorkspace("index-drift-unregistered-srs");

    const streams = io();
    const code = await main(["--root", root, "validate", "--severity", "error"], streams);
    const text = humanText(streams.stdout);

    // The unfiltered error keeps the failing exit code.
    expect(code).toBe(1);
    // The error-severity diagnostic is displayed; the warning-severity diagnostic is filtered out.
    expect(text).toContain(ERROR_CODE);
    expect(text).not.toContain(WARNING_CODE);
  });

  // AC-2: `--only <code>` restricts displayed diagnostics to the listed codes and
  //       `--ignore <code>` removes the listed codes from display.
  it("IR-CLI-051 AC-2: --only restricts display to listed codes and --ignore removes listed codes", async () => {
    // --only WARNING_CODE → only the warning code is displayed, the error code is hidden.
    const onlyRoot = await copyFixtureWorkspace("index-drift-unregistered-srs");
    const onlyStreams = io();
    await main(["--root", onlyRoot, "validate", "--only", WARNING_CODE], onlyStreams);
    const onlyText = humanText(onlyStreams.stdout);
    expect(onlyText).toContain(WARNING_CODE);
    expect(onlyText).not.toContain(ERROR_CODE);

    // --ignore WARNING_CODE → the warning code is removed from display, the error code remains.
    const ignoreRoot = await copyFixtureWorkspace("index-drift-unregistered-srs");
    const ignoreStreams = io();
    await main(["--root", ignoreRoot, "validate", "--ignore", WARNING_CODE], ignoreStreams);
    const ignoreText = humanText(ignoreStreams.stdout);
    expect(ignoreText).toContain(ERROR_CODE);
    expect(ignoreText).not.toContain(WARNING_CODE);
  });

  // AC-3: When an error diagnostic exists but is hidden by --ignore or --severity, exit is still 1.
  it("IR-CLI-051 AC-3: a hidden error (via --ignore or --severity) still exits 1", async () => {
    // Hidden via --ignore <error code>: display drops the error but exit stays 1 (unfiltered set).
    const ignoreRoot = await copyFixtureWorkspace("index-drift-unregistered-srs");
    const ignoreStreams = io();
    const ignoreCode = await main(["--root", ignoreRoot, "validate", "--ignore", ERROR_CODE], ignoreStreams);
    const ignoreText = humanText(ignoreStreams.stdout);
    expect(ignoreCode).toBe(1);
    expect(ignoreText).not.toContain(ERROR_CODE);

    // Hidden via --severity warning (error severity excluded from display): exit still 1.
    const sevRoot = await copyFixtureWorkspace("index-drift-unregistered-srs");
    const sevStreams = io();
    const sevCode = await main(["--root", sevRoot, "validate", "--severity", "warning"], sevStreams);
    const sevText = humanText(sevStreams.stdout);
    expect(sevCode).toBe(1);
    expect(sevText).not.toContain(ERROR_CODE);
  });

  // AC-4: When only warnings exist and --fail-on-warning is not set, exit is 0 regardless of filters.
  it("IR-CLI-051 AC-4: warnings-only workspace exits 0 regardless of display filters", async () => {
    // Baseline: warnings-only fixture exits 0 without filters.
    const baseRoot = await copyFixtureWorkspace("index-drift-status-summary");
    const baseStreams = io();
    const baseCode = await main(["--root", baseRoot, "validate", "--json"], baseStreams);
    expect(baseCode).toBe(0);
    const baseOut = parseJson(baseStreams.stdout);
    expect(baseOut.errors.length).toBe(0);
    expect(baseOut.warnings.length).toBeGreaterThan(0);

    // A display filter (here --only on the present warning code) must not change the 0 exit.
    const onlyRoot = await copyFixtureWorkspace("index-drift-status-summary");
    const onlyStreams = io();
    const onlyCode = await main(["--root", onlyRoot, "validate", "--only", "SRS-W019"], onlyStreams);
    expect(onlyCode).toBe(0);

    // Ignoring the only warning also keeps exit 0 (no error in the unfiltered set, --fail-on-warning unset).
    const ignoreRoot = await copyFixtureWorkspace("index-drift-status-summary");
    const ignoreStreams = io();
    const ignoreCode = await main(["--root", ignoreRoot, "validate", "--ignore", "SRS-W019"], ignoreStreams);
    expect(ignoreCode).toBe(0);
  });

  // AC-5: Hiding an error via --ignore does not change the exit code from 1 to 0.
  it("IR-CLI-051 AC-5: hiding an error via --ignore does not flip the exit code from 1 to 0", async () => {
    // Without filters the workspace fails (exit 1) because the error is in the unfiltered set.
    const baselineRoot = await copyFixtureWorkspace("index-drift-unregistered-srs");
    const baselineStreams = io();
    const baselineCode = await main(["--root", baselineRoot, "validate", "--json"], baselineStreams);
    expect(baselineCode).toBe(1);
    const baselineOut = parseJson(baselineStreams.stdout);
    expect(baselineOut.errors.map((d) => d.code)).toContain(ERROR_CODE);

    // Hiding that exact error via --ignore must NOT turn the failing validation into a zero exit.
    const ignoreRoot = await copyFixtureWorkspace("index-drift-unregistered-srs");
    const ignoreStreams = io();
    const ignoreCode = await main(["--root", ignoreRoot, "validate", "--ignore", ERROR_CODE], ignoreStreams);
    expect(ignoreCode).toBe(1);
    expect(ignoreCode).not.toBe(0);
  });
});
