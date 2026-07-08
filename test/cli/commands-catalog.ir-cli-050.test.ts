import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import {
  findSpecByCliName,
  renderCliCommandNames,
  renderReadOnlyToolNames,
  toolSpecs,
  type ToolSpec
} from "../../src/mcp/schemas.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

// IR-CLI-064 — `speckiwi commands` catalog manifest.
//
// Red-phase suite (T-PH004-43): one test case per acceptance criterion (AC-1..AC-4). These cases pin
// the future CLI contract before the green task (T-PH004-44) teaches the CLI a `commands` command, so
// the whole suite fails today — commander rejects the unknown `commands` command (non-zero usage exit,
// no catalog payload printed) — until the green task renders the catalog from the ToolSpec registry
// (FR-ARCH-006, src/mcp/schemas.ts). The `commands` command is itself a read-only ToolSpec entry, so
// (per the FR-ARCH-006 zero-drift contract) the green task must also register it in the registry — and
// the catalog, being registry-derived, then lists itself.
//
// Contract under test (SRS docs/spec/30.cli-interface.srs.md IR-CLI-064):
//
//   The speckiwi commands command renders the full command catalog with name, kind, args, options,
//   read-only flag, and result exit mapping from the ToolSpec registry in a single call, supports json,
//   and never writes a file.
//
//   - AC-1: speckiwi commands --json emits every registered command with name, kind, args, options, and
//           read-only flag.
//   - AC-2: The catalog is derived from the ToolSpec registry and does not hardcode an expected command list.
//   - AC-3: speckiwi commands writes no file.
//   - AC-4: Adding a ToolSpec entry makes that command appear in the catalog without a separate edit.

function io() {
  return { stdout: new PassThrough() as NodeJS.WriteStream, stderr: new PassThrough() as NodeJS.WriteStream };
}

/** Drains everything written to a finished run's stream. */
function drain(stream: NodeJS.WriteStream): string {
  return (stream as unknown as PassThrough).read()?.toString() ?? "";
}

/**
 * Walks parsed JSON for the first array of objects that each carry a string `name` and a string `kind`
 * — the command-catalog entry shape. Lets the green task choose the envelope wrapper (e.g. { ok, value })
 * without coupling the red test to a specific key path.
 */
function findCatalogArray(parsed: unknown): Array<Record<string, unknown>> | undefined {
  const seen = new Set<unknown>();
  const stack: unknown[] = [parsed];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node || typeof node !== "object" || seen.has(node)) continue;
    seen.add(node);
    if (Array.isArray(node)) {
      if (
        node.length > 0 &&
        node.every(
          (item) =>
            item &&
            typeof item === "object" &&
            typeof (item as Record<string, unknown>).name === "string" &&
            typeof (item as Record<string, unknown>).kind === "string"
        )
      ) {
        return node as Array<Record<string, unknown>>;
      }
      for (const item of node) stack.push(item);
      continue;
    }
    for (const value of Object.values(node as Record<string, unknown>)) stack.push(value);
  }
  return undefined;
}

/** Parses `commands --json` stdout into the array of catalog entries (fails the test if absent). */
function catalogEntries(out: string): Array<Record<string, unknown>> {
  const rows = findCatalogArray(JSON.parse(out));
  expect(rows, "commands --json must expose an array of catalog entries carrying name + kind").toBeDefined();
  return rows as Array<Record<string, unknown>>;
}

/** The single catalog entry whose `name` matches, or undefined. */
function entryByName(entries: Array<Record<string, unknown>>, name: string): Record<string, unknown> | undefined {
  return entries.find((entry) => entry.name === name);
}

/** Recursively snapshots every file's path → contents under a directory (for no-write assertions). */
async function snapshotTree(root: string): Promise<Map<string, string>> {
  const snapshot = new Map<string, string>();
  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) snapshot.set(path.relative(root, full), await readFile(full, "utf8"));
    }
  }
  await walk(root);
  return snapshot;
}

// A concrete, stable registry entry to pin the per-command projection against: `validate` is a read-only
// "read" command (src/mcp/schemas.ts) carrying both declared args (strict, failOnWarning) and options
// (--severity / --only / --ignore / --explain), with exit map { ok: 0, fail: 1 }.
const VALIDATE_SPEC = findSpecByCliName("validate") as ToolSpec;
const READ_ONLY_MCP_NAMES = new Set(renderReadOnlyToolNames());

/** Whether a registry spec is read-only: a "read"-kind command whose MCP name is in the read-only set. */
function specIsReadOnly(spec: ToolSpec): boolean {
  return spec.kind === "read" && typeof spec.mcpName === "string" && READ_ONLY_MCP_NAMES.has(spec.mcpName);
}

describe("IR-CLI-064 — commands catalog manifest", () => {
  // AC-1: commands --json emits every registered command with name, kind, args, options, and read-only flag.
  it("IR-CLI-064 AC-1: commands --json emits name, kind, args, options, and read-only flag for every command", async () => {
    const root = await copyFixtureWorkspace("valid-basic");

    const streams = io();
    const code = await main(["--root", root, "commands", "--json"], streams);
    const out = drain(streams.stdout);

    expect(code).toBe(0);
    const entries = catalogEntries(out);

    // Every entry advertises the five required metadata facets, with the right shapes: a string name, a
    // string kind, an args descriptor (object/array), an options descriptor (object/array), and a boolean
    // read-only flag.
    for (const entry of entries) {
      expect(typeof entry.name, `entry ${JSON.stringify(entry.name)} must carry a string name`).toBe("string");
      expect(typeof entry.kind, `entry ${String(entry.name)} must carry a string kind`).toBe("string");
      expect(entry.args, `entry ${String(entry.name)} must carry an args descriptor`).toBeDefined();
      expect(typeof entry.args, `entry ${String(entry.name)} args must be an object/array`).toBe("object");
      expect(entry.options, `entry ${String(entry.name)} must carry an options descriptor`).toBeDefined();
      expect(typeof entry.options, `entry ${String(entry.name)} options must be an object/array`).toBe("object");
      expect(
        typeof entry.readOnly,
        `entry ${String(entry.name)} must carry a boolean read-only flag`
      ).toBe("boolean");
    }

    // Pin the projection against a concrete registry entry rather than asserting only generic shapes:
    // `validate` is kind="read", read-only=true, and its declared args + option flags must surface so the
    // catalog is a faithful render of the ToolSpec, not a stub.
    const validate = entryByName(entries, "validate");
    expect(validate, "catalog must include the read-only `validate` command").toBeDefined();
    expect((validate as Record<string, unknown>).kind).toBe("read");
    expect((validate as Record<string, unknown>).readOnly).toBe(true);

    // The serialized args must name every declared registry arg of `validate` (strict, failOnWarning).
    const argsBlob = JSON.stringify((validate as Record<string, unknown>).args);
    for (const argName of Object.keys(VALIDATE_SPEC.args)) {
      expect(argsBlob, `validate catalog args must mention declared arg ${argName}`).toContain(argName);
    }

    // The serialized options must surface every declared registry option flag of `validate`.
    const optionsBlob = JSON.stringify((validate as Record<string, unknown>).options);
    for (const option of VALIDATE_SPEC.options) {
      expect(optionsBlob, `validate catalog options must mention flag ${option.flag}`).toContain(option.flag);
    }

    // The result exit mapping (SRS body: "result exit mapping") must surface validate's { ok: 0, fail: 1 }.
    const exitBlob = JSON.stringify(validate);
    for (const [outcome, exitCode] of Object.entries(VALIDATE_SPEC.resultExitMap)) {
      expect(exitBlob, `validate catalog must encode exit outcome ${outcome}`).toContain(outcome);
      expect(exitBlob, `validate catalog must encode exit code ${exitCode} for ${outcome}`).toContain(String(exitCode));
    }
  });

  // AC-2: the catalog is derived from the ToolSpec registry and does not hardcode an expected command list.
  it("IR-CLI-064 AC-2: the catalog command set equals the registry-derived command set (no hardcoded list)", async () => {
    const root = await copyFixtureWorkspace("valid-basic");

    const streams = io();
    const code = await main(["--root", root, "commands", "--json"], streams);
    const out = drain(streams.stdout);

    expect(code).toBe(0);
    const entries = catalogEntries(out);
    const catalogNames = entries.map((entry) => String(entry.name)).sort();

    // The registry (renderCliCommandNames === every toolSpecs[].cliName) is the single authority. The
    // catalog's command-name *multiset* must equal it EXACTLY — neither a curated subset nor a superset,
    // and counting duplicate cliNames (e.g. the top-level `validate` plus the IR-CLI-046 `step validate`
    // subcommand, which share cliName="validate"). A hardcoded list inside the command would drift from
    // the registry and fail this equality. (Sorted arrays compare multisets, so repeated names must match
    // in count, not just in set membership.)
    const registryNames = renderCliCommandNames().slice().sort();
    expect(catalogNames).toEqual(registryNames);

    // Per-entry: the catalog is the order-preserving 1:1 projection of `toolSpecs` (renderCommandCatalog
    // is `toolSpecs.map(...)`), so spec_i ↔ entry_i by index — NOT by name. Name-keyed lookup would be
    // ambiguous for duplicate cliNames (the two `validate` specs differ in read-only: the read-only
    // `validate_spec` reader vs. the CLI-only `step validate` with no MCP surface) and would silently
    // compare both specs against the first matching entry. Zipping by index proves each spec's name +
    // kind + read-only flag is rendered faithfully from its own ToolSpec, including both `validate` rows.
    expect(entries.length, "catalog must render one entry per registry ToolSpec (1:1, totals match)").toBe(
      toolSpecs.length
    );
    toolSpecs.forEach((spec, index) => {
      const entry = entries[index] as Record<string, unknown>;
      expect(entry, `catalog must include registry command #${index} (${spec.cliName})`).toBeDefined();
      expect(entry.name, `name mismatch at index ${index}`).toBe(spec.cliName);
      expect(entry.kind, `kind mismatch for ${spec.cliName} at index ${index}`).toBe(spec.kind);
      expect(entry.readOnly, `read-only mismatch for ${spec.cliName} at index ${index}`).toBe(
        specIsReadOnly(spec)
      );
    });

    // Strengthen the duplicate-cliName guard explicitly: the two `validate` specs disagree on read-only,
    // and the catalog must surface BOTH distinct read-only values for that name (not collapse them). This
    // pins the very case the old name-keyed loop could not express.
    const validateReadOnlyFromRegistry = new Set(
      toolSpecs.filter((spec) => spec.cliName === "validate").map((spec) => specIsReadOnly(spec))
    );
    const validateReadOnlyFromCatalog = new Set(
      entries.filter((entry) => entry.name === "validate").map((entry) => entry.readOnly)
    );
    expect(validateReadOnlyFromCatalog, "catalog must preserve both read-only values for duplicate `validate`").toEqual(
      validateReadOnlyFromRegistry
    );
  });

  // AC-3: speckiwi commands writes no file.
  it("IR-CLI-064 AC-3: commands writes no file", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    const before = await snapshotTree(root);

    const streams = io();
    expect(await main(["--root", root, "commands", "--json"], streams)).toBe(0);

    // The workspace tree is byte-identical before and after the run — no file added, removed, or modified.
    const after = await snapshotTree(root);
    expect([...after.keys()].sort()).toEqual([...before.keys()].sort());
    for (const [rel, content] of after) {
      expect(content, `commands must not modify ${rel}`).toBe(before.get(rel));
    }
  });

  // AC-4: adding a ToolSpec entry makes that command appear in the catalog without a separate edit.
  it("IR-CLI-064 AC-4: every ToolSpec registry entry surfaces in the catalog with no per-command catalog edit", async () => {
    const root = await copyFixtureWorkspace("valid-basic");

    const streams = io();
    const code = await main(["--root", root, "commands", "--json"], streams);
    const out = drain(streams.stdout);

    expect(code).toBe(0);
    const entries = catalogEntries(out);
    const catalogNames = new Set(entries.map((entry) => String(entry.name)));

    // The property that makes AC-4 hold: the catalog is a total render of the registry. EVERY current
    // ToolSpec entry — including the most recently added ones (e.g. `supersede`) and the `commands`
    // command itself once registered — appears with no dedicated catalog edit. Because the rendering is
    // driven by `toolSpecs`, a future registry insertion would automatically extend this set; this test
    // pins that totality for the present registry so any hardcoded gap fails.
    for (const spec of toolSpecs) {
      expect(catalogNames.has(spec.cliName), `adding/keeping ToolSpec ${spec.cliName} must surface it in the catalog`).toBe(
        true
      );
    }

    // The catalog introduces no command that is absent from the registry (no orphan hardcoded entry),
    // closing the loop: catalog membership ⇔ registry membership.
    const registryNames = new Set(toolSpecs.map((spec) => spec.cliName));
    for (const name of catalogNames) {
      expect(registryNames.has(name), `catalog command ${name} must originate from the ToolSpec registry`).toBe(true);
    }
  });
});
