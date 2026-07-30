import { describe, expect, it } from "vitest";
import { createMcpServer } from "../../src/mcp/server.js";
import { toolSpecs } from "../../src/mcp/schemas.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

// REL-ARCH-003 — the MCP surface contract must be checked against the server, not the registry.
//
// `toolSchemas` is itself rendered from the registry, so every existing parity test compared the
// registry with a projection of the registry. A CLI-only entry temporarily declaring
// `mcpName: "upgrade_project"` — a tool no server registers — left them all green. The only thing that
// caught it was a hand-written assertion inside one requirement's own suite.
//
// So this suite instantiates a server and enumerates what it actually registered.

/** Tool names an instantiated server registers, excluding the resource handlers. */
async function serverToolNames(): Promise<string[]> {
  const root = await copyFixtureWorkspace("valid-basic");
  const server = createMcpServer({ root });
  return Object.keys(server.tools)
    .filter((name) => !name.startsWith("resource:"))
    .sort();
}

function registryMcpNames(specs: readonly { mcpName?: string | undefined }[] = toolSpecs): string[] {
  return specs
    .map((spec) => spec.mcpName)
    .filter((name): name is string => typeof name === "string" && name.length > 0)
    .sort();
}

/**
 * The contract itself, as a pure comparison so the synthetic case below can exercise the same code the
 * real assertion uses. Returns the two asymmetries; both empty means the surfaces agree.
 */
function surfaceDrift(
  declared: readonly string[],
  registered: readonly string[]
): { declaredButNotRegistered: string[]; registeredButNotDeclared: string[] } {
  const registeredSet = new Set(registered);
  const declaredSet = new Set(declared);
  return {
    declaredButNotRegistered: declared.filter((name) => !registeredSet.has(name)).sort(),
    registeredButNotDeclared: registered.filter((name) => !declaredSet.has(name)).sort()
  };
}

describe("REL-ARCH-003 AC-1 / AC-4 — every declared MCP name exists on the instantiated server", () => {
  it("finds no registry name the server does not register", async () => {
    const drift = surfaceDrift(registryMcpNames(), await serverToolNames());
    expect(drift.declaredButNotRegistered).toEqual([]);
  });
});

describe("REL-ARCH-003 AC-2 — every server tool is declared exactly once", () => {
  it("finds no server tool missing from the registry, and no duplicate declaration", async () => {
    const registered = await serverToolNames();
    const declared = registryMcpNames();
    expect(surfaceDrift(declared, registered).registeredButNotDeclared).toEqual([]);

    const counts = new Map<string, number>();
    for (const name of declared) counts.set(name, (counts.get(name) ?? 0) + 1);
    expect([...counts.entries()].filter(([, count]) => count > 1)).toEqual([]);
  });
});

describe("REL-ARCH-003 AC-3 — a fabricated MCP name fails the contract", () => {
  it("reports the drift for a registry entry naming a tool no server registers", async () => {
    const registered = await serverToolNames();
    // The exact state that slipped through: a CLI-only command declaring a tool name that exists
    // nowhere on the server. Building it here proves the comparison can fail, rather than trusting
    // that it would.
    const fabricated = [...registryMcpNames(), "upgrade_project"];

    const drift = surfaceDrift(fabricated, registered);

    expect(drift.declaredButNotRegistered).toEqual(["upgrade_project"]);
  });

  it("reports the drift for a server tool the registry omits", async () => {
    const registered = await serverToolNames();
    const declared = registryMcpNames().filter((name) => name !== registered[0]);

    const drift = surfaceDrift(declared, registered);

    expect(drift.registeredButNotDeclared).toEqual([registered[0]]);
  });
});
