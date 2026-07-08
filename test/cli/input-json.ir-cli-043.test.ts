import { Readable } from "node:stream";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

// IR-CLI-058 — common --input-json stdin and --help --json for all mutation commands.
//
// Red-phase suite (T-PH004-29): one test case per acceptance criterion (AC-1..AC-5). These cases pin
// the future CLI contract before the green task (T-PH004-30) teaches the CLI a common --input-json
// option and a --help --json renderer, so the whole suite fails today:
//   - `update-status --input-json '<json>'` is rejected because commander does not know the option
//     (usage error, non-zero exit, no mutation value printed).
//   - `update-status --help --json` prints the human help text, not a machine-readable object, so
//     JSON.parse of stdout throws / yields no command-name + kind + parameter-list object.
//
// Contract under test (SRS docs/spec/30.cli-interface.srs.md IR-CLI-058):
//
//   All SpecKiwi mutation commands accept a common --input-json option that reads the full argument
//   object as a JSON string or from stdin, and all commands support --help --json to emit a
//   machine-readable description of the command name, kind, and parameters derived from the ToolSpec
//   registry.
//
//   - AC-1: Every mutation command accepts --input-json <json> and parses the object as its full
//           argument set equivalently to discrete flags.
//   - AC-2: When --input-json is given the value - or omitted with piped input, the command reads the
//           JSON object from stdin.
//   - AC-3: Discrete flags and --input-json for the same command produce identical mutation results
//           for equivalent inputs.
//   - AC-4: speckiwi <command> --help --json prints a machine-readable object containing the command
//           name, its kind, and its parameter list sourced from the ToolSpec registry.
//   - AC-5: An automated test asserts --input-json and equivalent discrete flags yield the same patch
//           for at least one mutation command.
//
// Representative mutation command: `update-status <id> <status>` (ToolSpec registry kind "req-scoped",
// src/mcp/schemas.ts). It takes two positional args (id, status) plus --reason / --dry-run options and
// forwards to core updateStatus, whose --json envelope is { ok, value: { id, status, written }, diagnostics }.
// Fixture (mutation-target): FR-ARCH-001 starts Status=planned, so transitioning to "implemented" is a
// valid non-verified mutation; every case uses --dry-run so the workspace file is never mutated and a
// single fixture copy can be reused across input methods.

const TARGET_ID = "FR-ARCH-001";
const NEXT_STATUS = "implemented";

function io() {
  return { stdout: new PassThrough() as NodeJS.WriteStream, stderr: new PassThrough() as NodeJS.WriteStream };
}

/** Drains everything written to a finished run's stream. */
function drain(stream: NodeJS.WriteStream): string {
  return (stream as unknown as PassThrough).read()?.toString() ?? "";
}

/** Recovers the mutation value object (carrying id + the given keys) from a JSON result envelope. */
function findValue(parsed: unknown, requiredKeys: readonly string[]): Record<string, unknown> | undefined {
  const stack: unknown[] = [parsed];
  const seen = new Set<unknown>();
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node || typeof node !== "object" || seen.has(node)) continue;
    seen.add(node);
    const record = node as Record<string, unknown>;
    if (record.id === TARGET_ID && requiredKeys.every((key) => key in record)) return record;
    for (const value of Object.values(record)) stack.push(value);
  }
  return undefined;
}

const originalStdin = process.stdin;

afterEach(() => {
  Object.defineProperty(process, "stdin", { value: originalStdin, configurable: true });
});

/** Runs `body` with process.stdin replaced by an in-memory readable carrying `text`. */
async function withStdin<T>(text: string, body: () => Promise<T>): Promise<T> {
  const fake = Readable.from([text]) as unknown as NodeJS.ReadStream;
  // Mark it non-TTY so a stdin reader treats it as piped input.
  (fake as unknown as { isTTY: boolean }).isTTY = false;
  Object.defineProperty(process, "stdin", { value: fake, configurable: true });
  try {
    return await body();
  } finally {
    Object.defineProperty(process, "stdin", { value: originalStdin, configurable: true });
  }
}

describe("IR-CLI-058 — common --input-json stdin and --help --json", () => {
  // AC-1: Every mutation command accepts --input-json <json> and parses the object as its full
  //       argument set equivalently to discrete flags.
  it("IR-CLI-058 AC-1: a mutation command accepts --input-json carrying its full argument object", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    const json = JSON.stringify({ id: TARGET_ID, status: NEXT_STATUS, dryRun: true });
    const run = io();
    // The JSON object alone supplies id + status — no discrete positional args are passed.
    const code = await main(["--root", root, "update-status", "--input-json", json, "--json"], run);
    expect(code).toBe(0);
    const parsed = JSON.parse(drain(run.stdout)) as unknown;
    const value = findValue(parsed, ["status", "written"]);
    expect(value, "--input-json must drive update-status to a mutation value with id/status/written").toBeDefined();
    expect(value?.id).toBe(TARGET_ID);
    expect(value?.status).toBe(NEXT_STATUS);
    expect(value?.written).toBe(false);
  });

  // AC-2: When --input-json is given the value - or omitted with piped input, the command reads the
  //       JSON object from stdin.
  it("IR-CLI-058 AC-2: --input-json - reads the JSON argument object from stdin", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    const json = JSON.stringify({ id: TARGET_ID, status: NEXT_STATUS, dryRun: true });
    const run = io();
    const code = await withStdin(json, () =>
      main(["--root", root, "update-status", "--input-json", "-", "--json"], run)
    );
    expect(code).toBe(0);
    const parsed = JSON.parse(drain(run.stdout)) as unknown;
    const value = findValue(parsed, ["status", "written"]);
    expect(value, "--input-json - must read the JSON argument object from stdin").toBeDefined();
    expect(value?.id).toBe(TARGET_ID);
    expect(value?.status).toBe(NEXT_STATUS);
    expect(value?.written).toBe(false);
  });

  // AC-3: Discrete flags and --input-json for the same command produce identical mutation results for
  //       equivalent inputs.
  it("IR-CLI-058 AC-3: discrete args and --input-json yield identical mutation results", async () => {
    const flagsRoot = await copyFixtureWorkspace("mutation-target");
    const flagsRun = io();
    const flagsCode = await main(
      ["--root", flagsRoot, "update-status", TARGET_ID, NEXT_STATUS, "--dry-run", "--json"],
      flagsRun
    );
    expect(flagsCode).toBe(0);
    const flagsValue = findValue(JSON.parse(drain(flagsRun.stdout)) as unknown, ["status", "written"]);
    expect(flagsValue).toBeDefined();

    const jsonRoot = await copyFixtureWorkspace("mutation-target");
    const jsonRun = io();
    const json = JSON.stringify({ id: TARGET_ID, status: NEXT_STATUS, dryRun: true });
    const jsonCode = await main(["--root", jsonRoot, "update-status", "--input-json", json, "--json"], jsonRun);
    expect(jsonCode).toBe(0);
    const jsonValue = findValue(JSON.parse(drain(jsonRun.stdout)) as unknown, ["status", "written"]);
    expect(jsonValue).toBeDefined();

    // Equivalent inputs via the two channels produce the same mutation result object.
    expect(jsonValue).toEqual(flagsValue);
  });

  // AC-4: speckiwi <command> --help --json prints a machine-readable object containing the command
  //       name, its kind, and its parameter list sourced from the ToolSpec registry.
  it("IR-CLI-058 AC-4: --help --json prints a registry-sourced command/kind/parameter object", async () => {
    const run = io();
    const code = await main(["update-status", "--help", "--json"], run);
    expect(code).toBe(0);
    const raw = drain(run.stdout).trim();
    let parsed: unknown;
    expect(() => {
      parsed = JSON.parse(raw);
    }, "update-status --help --json must print a single machine-readable JSON object").not.toThrow();
    expect(parsed).toBeTypeOf("object");
    expect(parsed).not.toBeNull();

    // The object names the command and its registry kind ("req-scoped" for update-status, per the
    // ToolSpec registry in src/mcp/schemas.ts), and enumerates its parameters.
    const blob = JSON.stringify(parsed);
    expect(blob).toContain("update-status");
    expect(blob).toContain("req-scoped");
    // The parameter list is sourced from the registry: the two positionals plus the declared options
    // and the common --input-json option must all be described somewhere in the object.
    expect(blob).toContain("id");
    expect(blob).toContain("status");
    expect(blob).toContain("reason");
    expect(blob).toMatch(/dry-?run/i);
    expect(blob).toMatch(/input-?json/i);
  });

  // AC-5: An automated test asserts --input-json and equivalent discrete flags yield the same patch
  //       for at least one mutation command.
  it("IR-CLI-058 AC-5: --input-json and discrete flags yield the same patch for update-status", async () => {
    // Discrete-flag dry run.
    const flagsRoot = await copyFixtureWorkspace("mutation-target");
    const flagsRun = io();
    const flagsCode = await main(
      ["--root", flagsRoot, "update-status", TARGET_ID, NEXT_STATUS, "--reason", "ir-cli-043", "--dry-run", "--json"],
      flagsRun
    );
    expect(flagsCode).toBe(0);
    const flagsEnvelope = JSON.parse(drain(flagsRun.stdout)) as Record<string, unknown>;
    const flagsValue = findValue(flagsEnvelope, ["status", "written"]);
    expect(flagsValue, "discrete-flag dry run must print a mutation value").toBeDefined();

    // --input-json dry run with the equivalent object.
    const jsonRoot = await copyFixtureWorkspace("mutation-target");
    const jsonRun = io();
    const json = JSON.stringify({ id: TARGET_ID, status: NEXT_STATUS, reason: "ir-cli-043", dryRun: true });
    const jsonCode = await main(["--root", jsonRoot, "update-status", "--input-json", json, "--json"], jsonRun);
    expect(jsonCode).toBe(0);
    const jsonEnvelope = JSON.parse(drain(jsonRun.stdout)) as Record<string, unknown>;
    const jsonValue = findValue(jsonEnvelope, ["status", "written"]);
    expect(jsonValue, "--input-json dry run must print a mutation value").toBeDefined();

    // The patch outcome (the mutation value the dry run reports) is identical across both channels.
    expect(jsonValue).toEqual(flagsValue);
    // written stays false under --dry-run for both channels: no file was patched.
    expect(flagsValue?.written).toBe(false);
    expect(jsonValue?.written).toBe(false);
  });
});
