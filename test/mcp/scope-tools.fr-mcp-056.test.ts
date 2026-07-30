import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createMcpServer } from "../../src/mcp/server.js";
import { findSpecByCliName } from "../../src/mcp/schemas.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

// FR-MCP-056 — an MCP-only agent could not create a scope document.
//
// The injected agent instructions require MCP tools for safe SRS updates when available, but scope
// creation had no tool: the agent's only options were to hand-write the document plus two index rows,
// or stop. Scope creation is the worst place to hand-write, since the document number is allocated and
// two index sections must agree — which is what `scaffold-scope` exists to do.

async function server(root: string) {
  return createMcpServer({ root });
}

async function scopeDocuments(root: string): Promise<string[]> {
  return (await readdir(path.join(root, "docs", "spec"))).filter((name) => name.endsWith(".srs.md")).sort();
}

describe("FR-MCP-056 AC-1 — both tools are registered as workspace mutations", () => {
  it("registers scaffold_scope and register_scopes on an instantiated server", async () => {
    const handle = await server(await copyFixtureWorkspace("valid-basic"));

    for (const name of ["scaffold_scope", "register_scopes"]) {
      expect(Object.keys(handle.tools), name).toContain(name);
      expect(handle.toolKinds[name], name).toBe("workspace");
    }
  });
});

describe("FR-MCP-056 AC-2 — scaffold_scope creates the document over MCP", () => {
  it("allocates the next number and writes the scope document", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    const before = await scopeDocuments(root);
    const handle = await server(root);

    const result = (await handle.callTool("scaffold_scope", { name: "Billing", prefix: "BILL", apply: true })) as {
      ok?: boolean;
    };

    expect(result.ok, JSON.stringify(result)).toBe(true);
    const after = await scopeDocuments(root);
    expect(after.length).toBe(before.length + 1);
    const created = after.find((name) => name.endsWith(".billing.srs.md"));
    expect(created, after.join(", ")).toBeDefined();
    // The existing document is `10.…`, so allocation is one above the highest in use, not a fixed name.
    expect(created).toBe("11.billing.srs.md");
    expect(await readFile(path.join(root, "docs", "spec", created!), "utf8")).toContain("| Scope | BILL |");
  });
});

describe("FR-MCP-056 AC-3 — register_scopes registers rows over MCP", () => {
  it("returns a successful envelope for the index registration pass", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    const handle = await server(root);

    const result = (await handle.callTool("register_scopes", { apply: true })) as { ok?: boolean };

    expect(result.ok, JSON.stringify(result)).toBe(true);
  });
});

describe("FR-MCP-056 AC-4 — dry run writes nothing", () => {
  it("plans the scaffold without creating a document", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    const before = await scopeDocuments(root);
    const handle = await server(root);

    const result = (await handle.callTool("scaffold_scope", { name: "Billing", prefix: "BILL", dryRun: true })) as {
      ok?: boolean;
    };

    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(await scopeDocuments(root)).toEqual(before);
  });
});

describe("FR-MCP-056 AC-5 — the registry declares both names", () => {
  it("carries the MCP name on each spec, so the parity contract covers them", () => {
    expect(findSpecByCliName("scaffold-scope")?.mcpName).toBe("scaffold_scope");
    expect(findSpecByCliName("register-scopes")?.mcpName).toBe("register_scopes");
  });
});
