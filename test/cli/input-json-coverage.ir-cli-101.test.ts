import { PassThrough, Readable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { buildCommand } from "../../src/cli/command.js";
import { registerMutationCommands } from "../../src/cli/commands/mutations.js";
import { main } from "../../src/cli/index.js";
import { tryRenderHelpJson } from "../../src/cli/input-json.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

// @req IR-CLI-101
// IR-CLI-101 — the set of commands reaching the --input-json / --help --json channel is derived
// from what is actually registered, not transcribed into a second list.
//
// Why this suite exists rather than an extra row in input-json.parametrized.ir-cli-043.test.ts:
// that suite pins one representative per POSITIONAL SHAPE, so it is silent about a command that
// was never wired to the channel at all. FND-002 recorded in its header is exactly that miss —
// supersede and restore were absent from MUTATION_COMMAND_NAMES — and it was repaired by adding
// two names, leaving the transcription in place. Measured 2026-09-20, ten more had fallen out.
// The denominator here is therefore the registration itself, so a command added later is covered
// without anyone editing this file.
//
// The probe is `<command> --help --json`, which tryRenderHelpJson gates through the same
// findMutationCommand the value channel uses, and which writes nothing: a command inside the gate
// renders a registry-derived JSON description, one outside it falls through to commander's plain
// text help. That keeps the sweep from running a mutation per command, including `remove`.

function io() {
  return { stdout: new PassThrough() as NodeJS.WriteStream, stderr: new PassThrough() as NodeJS.WriteStream };
}

function drain(stream: NodeJS.WriteStream): string {
  return (stream as unknown as PassThrough).read()?.toString() ?? "";
}

const originalStdin = process.stdin;

afterEach(() => {
  Object.defineProperty(process, "stdin", { value: originalStdin, configurable: true });
});

async function withStdin<T>(text: string, body: () => Promise<T>): Promise<T> {
  const fake = Readable.from([text]) as unknown as NodeJS.ReadStream;
  (fake as unknown as { isTTY: boolean }).isTTY = false;
  Object.defineProperty(process, "stdin", { value: fake, configurable: true });
  try {
    return await body();
  } finally {
    Object.defineProperty(process, "stdin", { value: originalStdin, configurable: true });
  }
}

/**
 * The command names `registerMutationCommands` actually registers, taken by diffing the tree around
 * the call rather than by reading a list. This is the denominator AC-1 requires: it follows the
 * registrar, including the names it produces inside a loop (check-ac and uncheck-ac).
 */
function registeredMutationCommandNames(): string[] {
  const probe = buildCommand({ io: io() });
  const before = new Set(probe.commands.map((command) => command.name()));
  registerMutationCommands(probe, { io: io() });
  return probe.commands.map((command) => command.name()).filter((name) => !before.has(name));
}

/**
 * The ten commands measured as missing on 2026-09-20, named so a later change that drops one from
 * the channel reddens here even if the derived denominator above shrinks with it. AC-4.
 */
const PREVIOUSLY_MISSING: readonly string[] = [
  "upgrade",
  "remove",
  "sync-index",
  "edit-requirement",
  "replace-acceptance-criteria",
  "edit-requirement-table-rows",
  "set-target-status",
  "set-supersede",
  "scaffold-scope",
  "register-scopes"
];

/**
 * A sample of the commands that already had the channel before this change, named for the same
 * reason: the derived denominator cannot notice its own shrinkage. AC-5.
 */
const PREVIOUSLY_PRESENT: readonly string[] = [
  "init",
  "update-status",
  "update-stability",
  "append-note",
  "add-requirement",
  "check-ac",
  "uncheck-ac",
  "supersede",
  "restore"
];

/**
 * Replaces every occurrence of the per-run temp workspace path with a placeholder, so two runs
 * against separate fixture copies compare equal on path-bearing fields.
 */
function normalizeRoot(value: unknown, root: string): unknown {
  if (typeof value === "string") return value.split(root).join("<ROOT>");
  if (Array.isArray(value)) return value.map((item) => normalizeRoot(item, root));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalizeRoot(item, root)]));
  }
  return value;
}

/** Runs one command against a fresh fixture copy and returns its exit code and parsed JSON stdout. */
async function run(args: string[]): Promise<{ code: number; parsed: unknown }> {
  const root = await copyFixtureWorkspace("mutation-target");
  const streams = io();
  const code = await main(["--root", root, ...args, "--json"], streams);
  const raw = drain(streams.stdout).trim();
  return { code, parsed: raw ? normalizeRoot(JSON.parse(raw), root) : undefined };
}

/** The same, with `payload` presented on stdin for `--input-json -`. */
async function runWithStdin(args: string[], payload: string): Promise<{ code: number; parsed: unknown }> {
  return withStdin(payload, () => run(args));
}

/** True when `<name> --help --json` rendered the registry-derived description, i.e. the gate admits it. */
async function reachesChannel(name: string): Promise<boolean> {
  const streams = io();
  await main([name, "--help", "--json"], streams);
  const raw = drain(streams.stdout).trim();
  if (!raw.startsWith("{")) return false;
  const parsed = JSON.parse(raw) as { name?: string; parameters?: unknown };
  return parsed.name === name && Array.isArray(parsed.parameters);
}

describe("IR-CLI-101 AC-1 — every registered mutation command reaches the channel", () => {
  const names = registeredMutationCommandNames();

  it("finds a non-trivial number of mutation commands to check", () => {
    // An empty denominator would satisfy the loop below vacuously, which is the failure mode this
    // repository has recorded before: a check that checks nothing still reports zero breakage.
    expect(names.length).toBeGreaterThanOrEqual(25);
  });

  it.each(names)("%s accepts --input-json and --help --json", async (name) => {
    expect(await reachesChannel(name)).toBe(true);
  });
});

describe("IR-CLI-101 AC-1 — the named floor, so the derived denominator cannot shrink quietly", () => {
  it("covers the ten that were missing and the ones that already worked", () => {
    const covered = new Set([...registeredMutationCommandNames(), "mode"]);
    for (const name of [...PREVIOUSLY_MISSING, ...PREVIOUSLY_PRESENT]) {
      expect(covered.has(name), `${name} left the mutation command set`).toBe(true);
    }
  });
});

describe("IR-CLI-101 AC-2 — the channel belongs to the program that declared it", () => {
  it("a program that never registered mutation commands does not admit one", () => {
    // Without this, the gate could answer from state some other program left behind, and the sweep
    // above would stay green even if src/cli/index.ts stopped registering mutation commands
    // altogether — a check that reports on wiring while not reading it.
    const bare = buildCommand({ io: io() });
    const streams = io();
    const rendered = tryRenderHelpJson(["update-status", "--help", "--json"], streams, bare);
    expect(rendered).toBe(false);
    expect(drain(streams.stdout).trim()).toBe("");
  });

  it("a program that did register admits it", () => {
    const wired = buildCommand({ io: io() });
    registerMutationCommands(wired, { io: io() });
    const streams = io();
    expect(tryRenderHelpJson(["update-status", "--help", "--json"], streams, wired)).toBe(true);
  });
});

describe("IR-CLI-101 AC-2 — the assertion discriminates", () => {
  it("does not admit a command that is not a mutation command", async () => {
    // Without this, a probe that returned true for everything would pass the sweep above while
    // measuring nothing. `list` is a read command and must fall through to commander's help.
    expect(await reachesChannel("list")).toBe(false);
  });

  it("does not admit a name that is not a command at all", async () => {
    expect(await reachesChannel("no-such-command")).toBe(false);
  });
});

describe("IR-CLI-101 AC-3 — mode keeps the channel", () => {
  it("mode reaches the channel although it is registered outside registerMutationCommands", async () => {
    // `mode` is declared in src/cli/commands/read.ts, so the diff above does not see it. It writes
    // docs/spec/steps/state.md, so it is a mutation command and must keep the channel.
    expect(registeredMutationCommandNames()).not.toContain("mode");
    expect(await reachesChannel("mode")).toBe(true);
  });
});

describe("IR-CLI-101 AC-4 — a newly admitted command works through the channel, not just past its gate", () => {
  // Reaching the gate is not the same as being carried by it. Both options declared with
  // encoding json in the ToolSpec registry — replace-acceptance-criteria's --items and
  // edit-requirement-table-rows' --operations — belong to commands that had no channel before
  // this change, so the expansion had never had to serialise one. A value that arrives as
  // "[object Object]" satisfies "the command is admitted" while carrying nothing.
  it("replace-acceptance-criteria --input-json - equals the discrete --items call", async () => {
    const items = [
      { text: "first criterion", checked: false },
      { text: "second criterion", checked: true }
    ];
    const viaFlag = await run(["replace-acceptance-criteria", "FR-ARCH-001", "--items", JSON.stringify(items), "--dry-run"]);
    const viaJson = await runWithStdin(
      ["replace-acceptance-criteria", "--input-json", "-"],
      JSON.stringify({ id: "FR-ARCH-001", items, dryRun: true })
    );

    expect(viaFlag.parsed).toBeDefined();
    expect((viaFlag.parsed as { ok?: boolean }).ok).toBe(true);
    expect(viaJson.parsed).toEqual(viaFlag.parsed);
  });
});

describe("IR-CLI-101 AC-4 — a multi-line value survives the channel", () => {
  it("edit-requirement --input-json - carries a multi-line statement whole", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    const statement = "First paragraph.\n\nSecond paragraph that a truncated command line would lose.\n\n- a bullet";
    const payload = JSON.stringify({ id: "FR-ARCH-001", statement, dryRun: true });
    const streams = io();
    const code = await withStdin(payload, () =>
      main(["--root", root, "edit-requirement", "--input-json", "-", "--json"], streams)
    );
    const parsed = JSON.parse(drain(streams.stdout).trim()) as {
      ok: boolean;
      mutation?: { operations?: Array<{ type: string; lines?: string[] }> };
    };

    expect(code).toBe(0);
    expect(parsed.ok).toBe(true);
    const replaced = parsed.mutation?.operations?.find((operation) => operation.type === "replaceRange");
    // The value must arrive whole: every line of the statement, in order, not just the first.
    expect(replaced?.lines).toEqual(["", ...statement.split("\n"), ""]);
  });
});
