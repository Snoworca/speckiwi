import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { createMcpServer } from "../../src/mcp/server.js";
import { findSpecByCliName } from "../../src/mcp/schemas.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

function io() {
  return { stdout: new PassThrough() as NodeJS.WriteStream, stderr: new PassThrough() as NodeJS.WriteStream };
}

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

/**
 * An unregistered scope document, which is what register_scopes exists to add a Scope Map row for.
 *
 * It has to carry a requirement: the prefix is inferred from the requirement ids the document holds,
 * so an empty document is correctly skipped with `cannot-infer-prefix` and would make this fixture
 * prove nothing.
 */
async function writeUnregisteredScope(root: string, fileName: string, name: string, prefix: string): Promise<void> {
  await writeFile(
    path.join(root, "docs", "spec", fileName),
    [
      `# ${name}`,
      "",
      "| Field | Value |",
      "|---|---|",
      "| Document Type | scope_srs |",
      `| Scope | ${prefix} |`,
      `| Scope Name | ${name} |`,
      "",
      "## 1. Scope Overview",
      "",
      "Describe the scope.",
      "",
      "## 4. Requirements",
      "",
      `### FR-${prefix}-001 — Fixture requirement`,
      "",
      "| Field | Value |",
      "| --- | --- |",
      "| Type | functional |",
      "| Target | v1.0.0 |",
      "| Status | planned |",
      "| Priority | high |",
      "| Tags | fixture |",
      "| Risk | low |",
      "| Stability | evolving |",
      "| Verification Method | test |",
      "| GitHub Issue | - |",
      "| Related Docs | - |",
      "",
      "#### Requirement",
      "",
      "The document must hold a requirement so its prefix can be inferred.",
      "",
      "#### Rationale",
      "",
      "The fixture needs a well-formed requirement block.",
      "",
      "#### Acceptance Criteria",
      "",
      "- [ ] AC-1: The prefix is inferred.",
      "",
      "#### Verification Evidence",
      "",
      "| Evidence ID | Type | Reference | Covers | Notes |",
      "| --- | --- | --- | --- | --- |",
      "",
      "#### Trace Links",
      "",
      "| Type | Reference | Relation | Notes |",
      "| --- | --- | --- | --- |",
      "",
      "#### Change Notes",
      "",
      "| Date | Change | Reason |",
      "| --- | --- | --- |",
      "| 2026-07-30 | Created | Fixture |",
      ""
    ].join("\n"),
    "utf8"
  );
}

async function indexText(root: string): Promise<string> {
  return readFile(path.join(root, "docs", "spec", "00.index.md"), "utf8");
}

describe("FR-MCP-056 AC-3 — register_scopes registers rows over MCP", () => {
  it("inserts the Scope Map row for an unregistered document", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    await writeUnregisteredScope(root, "11.billing.srs.md", "Billing", "BILL");
    expect(await indexText(root)).not.toContain("BILL");
    const handle = await server(root);

    const result = (await handle.callTool("register_scopes", { apply: true })) as { ok?: boolean };

    expect(result.ok, JSON.stringify(result)).toBe(true);
    // The envelope alone proves nothing: the row is the observable outcome the AC names.
    const after = await indexText(root);
    expect(after).toContain("11.billing.srs.md");
    // The Scope cell carries the inferred prefix, not the document's Scope Name, and the Document cell
    // is a bare path rather than a Markdown link. That is `register_scopes`' existing shape — it infers
    // only from requirement ids — and it differs from what `scaffold-scope` writes for the same
    // document. Asserted as it is rather than as it arguably should be.
    expect(after).toMatch(/\|\s*BILL\s*\|\s*\.\/11\.billing\.srs\.md\s*\|\s*BILL\s*\|/);
  });

  it("produces the same index as the CLI for the same input", async () => {
    const viaMcp = await copyFixtureWorkspace("valid-basic");
    const viaCli = await copyFixtureWorkspace("valid-basic");
    for (const root of [viaMcp, viaCli]) {
      await writeUnregisteredScope(root, "11.billing.srs.md", "Billing", "BILL");
    }

    expect(((await (await server(viaMcp)).callTool("register_scopes", { apply: true })) as { ok?: boolean }).ok).toBe(true);
    expect(await main(["--root", viaCli, "register-scopes", "--apply", "--json"], io())).toBe(0);

    expect(await indexText(viaMcp)).toBe(await indexText(viaCli));
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

  it("writes nothing for scaffold_scope when dryRun accompanies apply", async () => {
    // The distinguishing case. With `dryRun` alone the tool would write nothing anyway, because apply
    // was never requested — so that test cannot tell a honoured dry-run from an unrequested apply. The
    // wrapper's `apply: input.apply === true && input.dryRun !== true` is the only production code
    // implementing dry-run here: the core takes no dryRun field, it derives it from `apply !== true`.
    const root = await copyFixtureWorkspace("valid-basic");
    const before = await scopeDocuments(root);
    const handle = await server(root);

    const result = (await handle.callTool("scaffold_scope", {
      name: "Billing",
      prefix: "BILL",
      apply: true,
      dryRun: true
    })) as { ok?: boolean };

    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(await scopeDocuments(root)).toEqual(before);
  });

  it("writes nothing for register_scopes when dryRun accompanies apply", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    await writeUnregisteredScope(root, "11.billing.srs.md", "Billing", "BILL");
    const before = await indexText(root);
    const handle = await server(root);

    const result = (await handle.callTool("register_scopes", { apply: true, dryRun: true })) as { ok?: boolean };

    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(await indexText(root)).toBe(before);
  });
});

describe("FR-MCP-056 AC-5 — the registry declares both names", () => {
  it("carries the MCP name on each spec, so the parity contract covers them", () => {
    expect(findSpecByCliName("scaffold-scope")?.mcpName).toBe("scaffold_scope");
    expect(findSpecByCliName("register-scopes")?.mcpName).toBe("register_scopes");
  });
});
