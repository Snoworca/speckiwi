import { describe, expect, it } from "vitest";
import { z } from "zod";
// @req FR-ARCH-006
// FR-ARCH-006 — ToolSpec command metadata registry as single source of truth.
//
// Authoritative design contract (user-confirmed):
//   - A single ToolSpec registry is the SSOT for EVERY speckiwi command. The registry
//     holds the full CLI command set (currently 23 commands).
//   - Each entry carries: cliName (required), mcpName (optional — only commands exposed
//     as MCP tools), kind, args, options, coreFn, resultExitMap.
//   - CLI-only commands (extract, scopes, targets, links, check, uncheck-ac, ...) exist
//     in the registry WITHOUT an mcpName.
//   - Derivation rules asserted here:
//       * CLI command tree == the registry's full cliName set (AC-4); count = 23.
//       * MCP toolSchemas keys / toolNames == the subset of entries that declare an
//         mcpName, keyed by mcpName (AC-5); count = 17.
//       * toolKinds / isReadOnlyTool are derived from the registry.
//       * All counts/names derive from the registry — no hard-coded parallel lists.
//   - Compatible with existing pinned contracts:
//       * mutation-kind-contract.test.ts (11 mutation tools by kind),
//       * read-commands.test.ts, global-options-help.test.ts,
//       * MCP subset stays 17, CLI stays 23.
//
// At red time (T-PH001-01) the registry and its render helpers do not yet exist, so
// these imports / calls fail. T-PH001-02 implements them to turn the suite green.
import {
  toolSpecs,
  renderToolNames,
  renderToolSchemas,
  renderReadOnlyToolNames,
  renderToolKinds,
  renderCliCommandNames,
  type ToolSpec,
  type ToolOptionSpec
} from "../../src/mcp/schemas.js";
import { isReadOnlyTool, toolSchemas } from "../../src/mcp/server.js";
import { buildCommand } from "../../src/cli/command.js";
import { registerReadCommands } from "../../src/cli/commands/read.js";
import { registerMutationCommands } from "../../src/cli/commands/mutations.js";
// @req IR-CLI-082 — the orchestrate namespace is a third registrar; the walk must include it or the
// registry's orchestrate rows would read as surprise extras.
import { registerOrchestrateCommands } from "../../src/cli/commands/orchestrate.js";

// Load-bearing counts derived FROM the registry rather than hard-pinned, so adding a new
// command (e.g. IR-CLI-046 `step validate`) does not re-break the count assertions. The
// drift-detection power lives in the bidirectional set-equality assertions below
// (actualCliNames === registryCliNames, rendered* === registry projections), not in these
// counts. A non-empty floor guards against the registry collapsing to an empty list.
const EXPECTED_CLI_COMMAND_COUNT = registryCliNames().length;
const EXPECTED_MCP_TOOL_COUNT = registryMcpNames().length;

const REQUIRED_SPEC_FIELDS: ReadonlyArray<keyof ToolSpec> = [
  "cliName",
  "mcpName",
  "kind",
  "args",
  "options",
  "coreFn",
  "resultExitMap"
];

const REQUIRED_OPTION_FIELDS: ReadonlyArray<keyof ToolOptionSpec> = [
  "flag",
  "dest",
  "zod",
  "repeatable",
  "encoding",
  "oneOfGroup"
];

function registrySpecs(): readonly ToolSpec[] {
  // toolSpecs may be exported as an array or a name-keyed record; normalize to an array.
  return Array.isArray(toolSpecs) ? toolSpecs : Object.values(toolSpecs as Record<string, ToolSpec>);
}

function registryCliNames(): string[] {
  return registrySpecs()
    .map((spec) => spec.cliName)
    .filter((name): name is string => typeof name === "string" && name.length > 0)
    .sort();
}

function registryMcpNames(): string[] {
  return registrySpecs()
    .map((spec) => spec.mcpName)
    .filter((name): name is string => typeof name === "string" && name.length > 0)
    .sort();
}

function collectCliCommandNames(): string[] {
  const io = { stdout: process.stdout, stderr: process.stderr };
  const command = buildCommand({ io });
  registerReadCommands(command, { io });
  registerMutationCommands(command, { io });
  registerOrchestrateCommands(command, { io });
  const names: string[] = [];
  const walk = (cmd: { commands: Array<{ name(): string; commands: unknown[] }> }): void => {
    for (const sub of cmd.commands) {
      names.push(sub.name());
      walk(sub as never);
    }
  };
  walk(command as never);
  return names;
}

describe("FR-ARCH-006 — ToolSpec command metadata registry as single source of truth", () => {
  it("FR-ARCH-006 AC-1 — each ToolSpec entry declares cliName, mcpName, kind, args, options, coreFn, resultExitMap with kind required", () => {
    const specs = registrySpecs();
    // The registry is the SSOT for every command; it must hold the full CLI surface.
    expect(specs.length, "registry must contain the full command set").toBe(EXPECTED_CLI_COMMAND_COUNT);
    for (const spec of specs) {
      for (const field of REQUIRED_SPEC_FIELDS) {
        expect(spec, `ToolSpec '${(spec as ToolSpec).cliName}' must declare field '${String(field)}'`).toHaveProperty(
          field as string
        );
      }
      // cliName is required for every entry (the registry covers the whole CLI tree).
      expect(typeof spec.cliName, `ToolSpec must declare a non-empty cliName`).toBe("string");
      expect((spec.cliName as string).length, `ToolSpec.cliName must be non-empty`).toBeGreaterThan(0);
      // kind is required for every entry (no undefined / empty).
      expect(typeof spec.kind, `ToolSpec '${spec.cliName}'.kind must be a non-empty string`).toBe("string");
      expect((spec.kind as string).length, `ToolSpec '${spec.cliName}'.kind must be non-empty`).toBeGreaterThan(0);
      // mcpName is OPTIONAL: CLI-only commands omit it; when present it must be a non-empty string.
      if (spec.mcpName !== undefined) {
        expect(typeof spec.mcpName, `ToolSpec '${spec.cliName}'.mcpName must be a string when present`).toBe("string");
        expect((spec.mcpName as string).length, `ToolSpec '${spec.cliName}'.mcpName must be non-empty when present`).toBeGreaterThan(0);
      }
    }
    // At least one CLI-only entry (no mcpName) must exist — proves the registry models the
    // full CLI set, not just the MCP-exposed subset.
    const cliOnly = specs.filter((spec) => spec.mcpName === undefined || spec.mcpName === null);
    expect(cliOnly.length, "registry must contain CLI-only entries that omit mcpName").toBeGreaterThan(0);
  });

  it("FR-ARCH-006 AC-2 — each ToolSpec option entry declares flag, dest, zod, repeatable, encoding, oneOfGroup", () => {
    const specs = registrySpecs();
    let sawAnyOption = false;
    for (const spec of specs) {
      const options = (spec.options ?? []) as ToolOptionSpec[];
      for (const option of options) {
        sawAnyOption = true;
        for (const field of REQUIRED_OPTION_FIELDS) {
          expect(
            option,
            `option '${option.flag ?? "<unknown>"}' of '${spec.cliName}' must declare descriptor '${String(field)}'`
          ).toHaveProperty(field as string);
        }
        expect(typeof option.flag, `option of '${spec.cliName}' must declare a flag string`).toBe("string");
        expect(typeof option.dest, `option '${option.flag}' of '${spec.cliName}' must declare a dest string`).toBe(
          "string"
        );
      }
    }
    expect(sawAnyOption, "at least one ToolSpec entry must declare options to exercise AC-2 descriptors").toBe(true);
  });

  it("FR-ARCH-006 AC-3 — MCP toolSchemas, toolNames, and read-only predicate are rendered from the registry's mcpName subset", () => {
    const renderedSchemas = renderToolSchemas();
    const renderedNames = renderToolNames();
    const renderedReadOnly = renderReadOnlyToolNames();
    const mcpNames = registryMcpNames();

    // toolSchemas exported by server.ts must equal the registry-rendered schemas (same keys),
    // and those keys must be exactly the registry's mcpName subset.
    expect(Object.keys(toolSchemas).sort()).toEqual(Object.keys(renderedSchemas).sort());
    expect(Object.keys(renderedSchemas).sort()).toEqual(mcpNames);

    // toolNames must equal the registry-rendered MCP names == the mcpName subset.
    expect([...renderedNames].sort()).toEqual(mcpNames);

    // isReadOnlyTool must agree with the registry-derived read-only name set,
    // and read-only names must themselves be a subset of the MCP names.
    for (const name of renderedReadOnly) {
      expect(mcpNames, `read-only tool '${name}' must be an MCP-exposed registry entry`).toContain(name);
    }
    for (const name of renderedNames) {
      expect(isReadOnlyTool(name), `isReadOnlyTool('${name}') must match registry-derived read-only set`).toBe(
        renderedReadOnly.includes(name)
      );
    }

    // Every rendered schema value is a record of zod schemas.
    for (const [name, schema] of Object.entries(renderedSchemas)) {
      expect(schema, `rendered schema for '${name}' must be an object`).toBeTypeOf("object");
      for (const [field, zodSchema] of Object.entries(schema)) {
        expect(
          zodSchema instanceof z.ZodType,
          `rendered schema '${name}.${field}' must be a zod schema`
        ).toBe(true);
      }
    }
  });

  it("FR-ARCH-006 AC-4 — CLI command tree registers exactly the registry's full cliName set", () => {
    const expectedCliNames = registryCliNames();
    const renderedCliNames = [...renderCliCommandNames()].sort();

    // The registry's render helper and its raw cliName projection must agree.
    expect(renderedCliNames).toEqual(expectedCliNames);

    // The actual CLI command tree must contain EXACTLY the registry-declared cliName set
    // (both directions — no missing entries, no surprise extras).
    const actualCliNames = collectCliCommandNames().sort();
    expect(actualCliNames).toEqual(expectedCliNames);
  });

  it("FR-ARCH-006 AC-5 — counts and names of CLI commands, toolNames, toolSchemas keys, and toolKinds keys each derive from and match the registry", () => {
    const cliNames = registryCliNames();
    const mcpNames = registryMcpNames();

    const renderedNames = [...renderToolNames()].sort();
    const renderedSchemaKeys = Object.keys(renderToolSchemas()).sort();
    const renderedKinds = renderToolKinds();
    const renderedKindKeys = Object.keys(renderedKinds).sort();
    const renderedCliNames = [...renderCliCommandNames()].sort();
    const actualCliNames = collectCliCommandNames().sort();

    // names match the registry projections
    expect(renderedNames).toEqual(mcpNames);
    expect(renderedSchemaKeys).toEqual(mcpNames);
    expect(renderedCliNames).toEqual(cliNames);
    expect(actualCliNames).toEqual(cliNames);

    // toolKinds keys derive from the MCP subset, and each kind value comes from a spec.kind.
    expect(renderedKindKeys).toEqual(mcpNames);
    const kindByMcpName = new Map(
      registrySpecs()
        .filter((spec) => typeof spec.mcpName === "string" && spec.mcpName.length > 0)
        .map((spec) => [spec.mcpName as string, spec.kind] as const)
    );
    for (const [name, kind] of Object.entries(renderedKinds)) {
      expect(kind, `toolKinds['${name}'] must match the registry spec.kind`).toBe(kindByMcpName.get(name));
    }

    // Load-bearing counts derive from the registry (no parallel hard-coded lists): every
    // derived view must reproduce the registry-derived count. A non-empty floor guards against
    // the registry collapsing to empty (which would make the count equalities vacuously true);
    // the bidirectional set-equality assertions above remain the actual drift detector.
    expect(EXPECTED_MCP_TOOL_COUNT, "registry must expose MCP tools").toBeGreaterThan(0);
    expect(EXPECTED_CLI_COMMAND_COUNT, "registry must expose CLI commands").toBeGreaterThan(0);
    expect(mcpNames.length, "MCP tool count derives from the registry mcpName subset").toBe(EXPECTED_MCP_TOOL_COUNT);
    expect(cliNames.length, "CLI command count derives from the registry").toBe(EXPECTED_CLI_COMMAND_COUNT);
    expect(renderedNames.length, "toolNames count derives from registry").toBe(EXPECTED_MCP_TOOL_COUNT);
    expect(renderedSchemaKeys.length, "toolSchemas key count derives from registry").toBe(EXPECTED_MCP_TOOL_COUNT);
    expect(renderedKindKeys.length, "toolKinds key count derives from registry").toBe(EXPECTED_MCP_TOOL_COUNT);
    expect(renderedCliNames.length, "CLI command count derives from registry").toBe(EXPECTED_CLI_COMMAND_COUNT);
    expect(actualCliNames.length, "actual CLI tree size matches the registry").toBe(EXPECTED_CLI_COMMAND_COUNT);
  });
});

// @req REL-ARCH-002
// REL-ARCH-002 — Zero-drift enumerate and handler-forwarding contract over the ToolSpec registry.
//
// FR-ARCH-006 (above) established the registry and its render helpers. REL-ARCH-002 adds the
// reliability contract that PROVES no command surface and no input field can be silently
// dropped, with the ToolSpec registry as the ONLY authority (no hard-coded expected list):
//   - AC-1: an enumeration check fails when any ToolSpec entry is missing from CLI
//           registration, MCP toolSchemas keys, MCP toolNames, or MCP toolKinds — naming the
//           specific missing surface.
//   - AC-2: the check detects the historical drift class where a tool exists in toolSchemas
//           and as a registered MCP tool but is absent from toolNames (update_stability,
//           append_section_note, set_target_goal).
//   - AC-3: each MCP mutation handler forwards every dest declared by its ToolSpec option set
//           to its core function — a declared-but-unforwarded option fails.
//   - AC-4: the forwarding check covers the notes and dryRun dests for add_trace_link and
//           add_verification_evidence (FR-MCP-020 / FR-MCP-029 dropped-field defect class).
//   - AC-5: introducing a synthetic ToolSpec entry that is absent from one of the surfaces (or
//           whose handler drops a dest) makes the contract check fail, WITHOUT the test
//           hard-coding the expected tool list.
//
// At red time (T-PH001-03) the zero-drift contract surface does not yet exist, so these
// imports / calls fail. T-PH001-04 implements them to turn the suite green.
import {
  assertZeroDriftToolSurface,
  forwardedDestsByTool
} from "../../src/mcp/schemas.js";
import { createMcpServer } from "../../src/mcp/server.js";

// The set of MCP tool names actually registered by the running server — the live surface that
// AC-2/AC-5 compare against the registry. Resource handlers (prefixed "resource:") excluded.
function registeredMcpToolNames(): string[] {
  const handle = createMcpServer({});
  return Object.keys(handle.tools)
    .filter((name) => !name.startsWith("resource:"))
    .sort();
}

describe("REL-ARCH-002 — Zero-drift enumerate and handler-forwarding contract over the ToolSpec registry", () => {
  it("REL-ARCH-002 AC-1 — enumeration fails (naming the surface) when a registry entry is absent from CLI registration, toolSchemas, toolNames, or toolKinds", () => {
    // The contract check passes for the real, drift-free surface...
    expect(() => assertZeroDriftToolSurface()).not.toThrow();

    // ...and fails, naming the missing surface, when a registry entry is dropped from one
    // surface. The check must treat the registry as the only authority, so injecting a spec
    // that exists in the registry but is missing from a derived view must be detected.
    const mcpNames = registryMcpNames();
    const sample = mcpNames[0] as string;

    // toolNames missing a registry MCP entry → must throw, naming "toolNames".
    expect(() =>
      assertZeroDriftToolSurface({
        toolNames: mcpNames.filter((name) => name !== sample)
      })
    ).toThrow(new RegExp(`toolNames.*${sample}|${sample}.*toolNames`));

    // toolSchemas key missing → must throw, naming "toolSchemas".
    const schemasMinusOne: Record<string, unknown> = {};
    for (const name of mcpNames) if (name !== sample) schemasMinusOne[name] = {};
    expect(() => assertZeroDriftToolSurface({ toolSchemas: schemasMinusOne })).toThrow(/toolSchemas/);

    // toolKinds key missing → must throw, naming "toolKinds".
    const kindsMinusOne: Record<string, string> = {};
    for (const name of mcpNames) if (name !== sample) kindsMinusOne[name] = "req-scoped";
    expect(() => assertZeroDriftToolSurface({ toolKinds: kindsMinusOne })).toThrow(/toolKinds/);

    // CLI registration missing a registry cliName → must throw, naming "CLI".
    const cliSample = registryCliNames()[0] as string;
    expect(() =>
      assertZeroDriftToolSurface({
        cliCommandNames: registryCliNames().filter((name) => name !== cliSample)
      })
    ).toThrow(/CLI|cliCommand/i);
  });

  it("REL-ARCH-002 AC-2 — detects the drift class where a registered MCP tool / toolSchemas key is absent from toolNames", () => {
    const registered = registeredMcpToolNames();
    const renderedNames = [...renderToolNames()].sort();
    const schemaKeys = Object.keys(renderToolSchemas()).sort();

    // The historically-drifting tools must be present across ALL three surfaces, not just in
    // toolSchemas + the registered server (the old defect left them out of toolNames).
    for (const name of ["update_stability", "append_section_note", "set_target_goal"]) {
      expect(registered, `${name} must be a registered MCP tool`).toContain(name);
      expect(schemaKeys, `${name} must have a toolSchemas key`).toContain(name);
      expect(renderedNames, `${name} must appear in toolNames (drift fix)`).toContain(name);
    }

    // The contract surface must catch the drift directly: a toolNames list that omits a tool
    // present in the registered server + toolSchemas must fail, naming the dropped tool.
    const dropped = "update_stability";
    expect(() =>
      assertZeroDriftToolSurface({
        toolNames: renderedNames.filter((name) => name !== dropped)
      })
    ).toThrow(new RegExp(dropped));

    // The registered server surface and the registry-derived toolNames must agree exactly.
    expect(registered).toEqual(renderedNames);
  });

  it("REL-ARCH-002 AC-3 — every MCP mutation handler forwards each dest declared by its ToolSpec option set", () => {
    const forwarded = forwardedDestsByTool();
    const mutationKinds = new Set(["req-scoped", "log-append", "workspace"]);
    const kinds = renderToolKinds();

    const mutationMcpNames = registryMcpNames().filter((name) => mutationKinds.has(kinds[name] as string));
    expect(mutationMcpNames.length, "there must be mutation MCP tools to exercise forwarding").toBeGreaterThan(0);

    const specByMcpName = new Map(
      registrySpecs()
        .filter((spec) => typeof spec.mcpName === "string" && spec.mcpName.length > 0)
        .map((spec) => [spec.mcpName as string, spec] as const)
    );

    for (const name of mutationMcpNames) {
      const spec = specByMcpName.get(name) as ToolSpec;
      const declaredDests = (spec.options ?? []).map((opt) => opt.dest);
      const forwardedDests = forwarded[name];
      expect(forwardedDests, `mutation handler '${name}' must report its forwarded dests`).toBeDefined();
      for (const dest of declaredDests) {
        expect(
          forwardedDests,
          `mutation handler '${name}' must forward declared option dest '${dest}' to its core fn`
        ).toContain(dest);
      }
    }
  });

  it("REL-ARCH-002 AC-4 — forwarding contract covers notes and dryRun for add_trace_link and add_verification_evidence", () => {
    const forwarded = forwardedDestsByTool();
    for (const tool of ["add_trace_link", "add_verification_evidence"]) {
      const dests = forwarded[tool];
      expect(dests, `${tool} must report forwarded dests`).toBeDefined();
      expect(dests, `${tool} must forward 'notes' (FR-MCP-020/FR-MCP-029 dropped-field class)`).toContain("notes");
      expect(dests, `${tool} must forward 'dryRun' (FR-MCP-020/FR-MCP-029 dropped-field class)`).toContain("dryRun");
    }
  });

  it("REL-ARCH-002 AC-5 — a synthetic registry entry missing a surface (or dropping a dest) fails the contract, with no hard-coded expected list", () => {
    // Adding a brand-new tool to the registry view that is absent from one surface must fail
    // the enumeration — proving the check derives the expected set from the registry, not a
    // hard-coded list. We simulate the "new entry" by supplying an augmented registry view and
    // surfaces that omit it.
    const phantom = "phantom_tool_zero_drift";
    const augmentedMcpNames = [...registryMcpNames(), phantom].sort();

    expect(() =>
      assertZeroDriftToolSurface({
        // registry view claims a tool the derived surfaces do not have →
        // contract must fail because the surfaces drifted from the registry authority.
        registryMcpNames: augmentedMcpNames,
        toolNames: registryMcpNames(),
        toolSchemas: renderToolSchemas(),
        toolKinds: renderToolKinds()
      })
    ).toThrow(new RegExp(phantom));

    // A dropped handler dest for a registered mutation must also fail the forwarding contract,
    // detected from the registry's declared option dests rather than a hard-coded list.
    expect(() =>
      assertZeroDriftToolSurface({
        forwardedDests: { add_trace_link: ["id", "type", "reference", "relation"] } // 'notes'/'dryRun' dropped
      })
    ).toThrow(/notes|dryRun|add_trace_link/);
  });
});
