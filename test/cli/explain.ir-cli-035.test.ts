import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { getDiagnosticDefinition } from "../../src/core/diagnostic-registry.js";

// IR-CLI-035 — `speckiwi explain <code>` command and `speckiwi validate --explain <code>`
// option for diagnostic codes.
//
// Red-phase suite (T-PH004-13): one test case per acceptance criterion (AC-1..AC-5).
// These cases pin the future CLI contract before `src/cli/commands/read.ts` /
// `src/cli/index.ts` teach the CLI an `explain` command and a `validate --explain`
// option, so the whole suite fails today — commander rejects the unknown command and
// the unknown option (non-zero usage exit, no diagnostic definition printed) — until
// the green task (T-PH004-14) wires the explain surface against the existing
// DiagnosticDefinition registry (DR-PARSE-001: registry SSOT for title / severity /
// messageTemplate / sourceRule / since / remediation).
//
// Contract under test (SRS docs/spec/30.cli-interface.srs.md IR-CLI-035):
//
//   SpecKiwi provides a `speckiwi explain <code>` command and a
//   `speckiwi validate --explain <code>` option that print the diagnostic definition
//   for the given code including its title, severity, message template, sourceRule,
//   since version, and remediation when present, reject an unknown code with a non-zero
//   exit code, and support --json to emit the definition as a machine-readable object.
//
//   - AC-1: `explain <code>` prints title, severity, messageTemplate, sourceRule, since
//           for a known diagnostic code.
//   - AC-2: `explain <code>` includes remediation text when the definition provides one
//           and omits it cleanly when absent.
//   - AC-3: `validate --explain <code>` prints the same definition fields as explain.
//   - AC-4: `explain` with an unknown code exits non-zero and prints a not-found message
//           instead of throwing an unhandled error.
//   - AC-5: `explain` supports --json and emits the definition as a machine-readable object.
//
// Registry pinning (DR-PARSE-001 SSOT, deterministic — resolved from the live registry
// via getDiagnosticDefinition so the assertions track the registry, not a hand copy):
//   - KNOWN_CODE "SRS-E001" → a real registered error-severity diagnostic that carries a
//     non-empty remediation string. Used for the present-field and present-remediation cases.
//   - UNKNOWN_CODE "SRS-Z999" → not registered; getDiagnosticDefinition throws for it.
//     Used for the unknown-code rejection case (AC-4).

function io() {
  return { stdout: new PassThrough() as NodeJS.WriteStream, stderr: new PassThrough() as NodeJS.WriteStream };
}

/** Drains the human-readable output written to a finished run's stream. */
function drain(stream: NodeJS.WriteStream): string {
  return (stream as unknown as PassThrough).read()?.toString() ?? "";
}

const KNOWN_CODE = "SRS-E001";
const UNKNOWN_CODE = "SRS-Z999";

// Resolve the expected field values from the registry SSOT so the test pins the real
// definition rather than a duplicated literal. SRS-E001 is guaranteed to carry a
// non-empty remediation (DR-PARSE-001 AC-2 enforces non-empty remediation on every code).
const KNOWN = getDiagnosticDefinition(KNOWN_CODE);

describe("IR-CLI-035 — explain command and validate --explain for diagnostic codes", () => {
  // AC-1: `explain <code>` prints the title, severity, messageTemplate, sourceRule, and
  //       since fields for a known diagnostic code.
  it("IR-CLI-035 AC-1: explain <code> prints title, severity, messageTemplate, sourceRule, and since", async () => {
    const streams = io();
    const code = await main(["explain", KNOWN_CODE], streams);
    const text = drain(streams.stdout);

    // A known code is a successful lookup, not a usage error.
    expect(code).toBe(0);
    // Every spec-listed core field is surfaced with its registry value.
    expect(text).toContain(KNOWN_CODE);
    expect(text).toContain(KNOWN.title);
    expect(text).toContain(KNOWN.severity);
    expect(text).toContain(KNOWN.messageTemplate);
    expect(text).toContain(KNOWN.sourceRule);
    expect(text).toContain(KNOWN.since);
    // The lookup must resolve a real definition, not render an undefined placeholder.
    expect(text).not.toContain("undefined");
  });

  // AC-2: `explain <code>` includes the remediation text when the diagnostic definition
  //       provides one and omits it cleanly when absent.
  it("IR-CLI-035 AC-2: explain includes remediation when present and renders no empty/undefined remediation", async () => {
    // SRS-E001 carries a remediation: it must be present verbatim in the output.
    expect(typeof KNOWN.remediation).toBe("string");
    expect((KNOWN.remediation ?? "").trim()).not.toBe("");

    const streams = io();
    const code = await main(["explain", KNOWN_CODE], streams);
    const text = drain(streams.stdout);

    expect(code).toBe(0);
    expect(text).toContain(KNOWN.remediation as string);
    // "omits it cleanly when absent" — even on the present path the renderer must not
    // leak an undefined/empty remediation artifact, proving conditional rendering rather
    // than a hard-coded always-on label printing `undefined`.
    expect(text).not.toContain("remediation: undefined");
    expect(text).not.toContain("undefined");
  });

  // AC-3: `validate --explain <code>` prints the same diagnostic definition fields as the
  //       explain command.
  it("IR-CLI-035 AC-3: validate --explain <code> prints the same definition fields as explain", async () => {
    const streams = io();
    const code = await main(["validate", "--explain", KNOWN_CODE], streams);
    const text = drain(streams.stdout);

    // --explain short-circuits to a definition print: it is a successful lookup, not a
    // workspace validation run, so it exits 0 for a known code.
    expect(code).toBe(0);
    expect(text).toContain(KNOWN_CODE);
    expect(text).toContain(KNOWN.title);
    expect(text).toContain(KNOWN.severity);
    expect(text).toContain(KNOWN.messageTemplate);
    expect(text).toContain(KNOWN.sourceRule);
    expect(text).toContain(KNOWN.since);
    expect(text).toContain(KNOWN.remediation as string);
  });

  // AC-4: `explain` with an unknown code exits with a non-zero exit code and prints a
  //       not-found message instead of throwing an unhandled error.
  it("IR-CLI-035 AC-4: explain with an unknown code exits non-zero with a not-found message", async () => {
    const streams = io();
    const code = await main(["explain", UNKNOWN_CODE], streams);
    const out = drain(streams.stdout);
    const err = drain(streams.stderr);
    const combined = `${out}${err}`;

    // Unknown code must fail with a non-zero exit code.
    expect(code).not.toBe(0);
    expect(code).toBeGreaterThan(0);
    // The unknown code is surfaced in a not-found style message, not as a raw thrown stack.
    expect(combined).toContain(UNKNOWN_CODE);
    expect(combined.toLowerCase()).toMatch(/not found|unknown/);
    // It must be a handled message, not an unhandled-rejection style stack trace.
    expect(combined).not.toContain("at Object.<anonymous>");
  });

  // AC-5: `explain` supports --json and emits the diagnostic definition as a
  //       machine-readable object.
  it("IR-CLI-035 AC-5: explain --json emits the definition as a machine-readable object", async () => {
    const streams = io();
    const code = await main(["explain", KNOWN_CODE, "--json"], streams);
    const raw = drain(streams.stdout);

    expect(code).toBe(0);

    // Output must be a single parseable JSON document.
    const parsed = JSON.parse(raw) as unknown;
    expect(parsed).not.toBeNull();
    expect(typeof parsed).toBe("object");

    // The diagnostic definition fields must be recoverable from the JSON, whether the
    // definition is at the top level or nested under a `definition`/`data` key. Flatten
    // a small set of candidate carriers and assert the registry field values are present.
    const root = parsed as Record<string, unknown>;
    const candidates: Array<Record<string, unknown>> = [root];
    for (const key of ["definition", "data", "value", "diagnostic"]) {
      const nested = root[key];
      if (nested && typeof nested === "object") candidates.push(nested as Record<string, unknown>);
    }
    const definition = candidates.find((candidate) => candidate.code === KNOWN_CODE);
    expect(definition, `expected a JSON object exposing diagnostic ${KNOWN_CODE}`).toBeDefined();

    const view = definition as Record<string, unknown>;
    expect(view.code).toBe(KNOWN.code);
    expect(view.title).toBe(KNOWN.title);
    expect(view.severity).toBe(KNOWN.severity);
    expect(view.messageTemplate).toBe(KNOWN.messageTemplate);
    expect(view.sourceRule).toBe(KNOWN.sourceRule);
    expect(view.since).toBe(KNOWN.since);
    expect(view.remediation).toBe(KNOWN.remediation);
  });
});
