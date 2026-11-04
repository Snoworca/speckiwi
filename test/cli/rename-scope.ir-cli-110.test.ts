import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { createMcpServer } from "../../src/mcp/server.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

// IR-CLI-110 / IR-MCP-006 — the `rename-scope` CLI command and the `rename_scope` MCP tool over the
// renameScope mutation (FR-NODE-232). Fixture valid-basic: 10.product-architecture.srs.md, prefix
// ARCH, registered in both index sections.

const FROM = "10.product-architecture";
const TO = "10.platform-architecture";

function io() {
  return { stdout: new PassThrough(), stderr: new PassThrough() };
}

function drain(stream: PassThrough): string {
  return stream.read()?.toString() ?? "";
}

async function cli(root: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const streams = io();
  const code = await main(["--root", root, ...args], streams);
  return { code, stdout: drain(streams.stdout), stderr: drain(streams.stderr) };
}

async function exists(filePath: string): Promise<boolean> {
  return access(filePath).then(
    () => true,
    () => false
  );
}

/** Every file under docs/spec with its bytes, so "nothing written" is checked over the whole tree. */
async function specTree(root: string): Promise<Record<string, string>> {
  const dir = path.join(root, "docs", "spec");
  const out: Record<string, string> = {};
  for (const name of (await readdir(dir)).sort()) {
    if (name.endsWith(".md")) out[name] = await readFile(path.join(dir, name), "utf8");
  }
  return out;
}

/** Writes an unexpired lock owned by another session (same shape as the IR-CLI-078 suite). */
async function holdLock(root: string): Promise<void> {
  await mkdir(path.join(root, "kiwi"), { recursive: true });
  await writeFile(
    path.join(root, "kiwi", ".srs.lock"),
    `${JSON.stringify({
      schemaVersion: "1.0.0",
      owner: "another-session",
      operation: "add_requirement",
      requestId: "held",
      acquiredAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 600_000).toISOString()
    })}
`,
    "utf8"
  );
}

/** Replaces the per-run temp root so two runs on separate copies compare equal. */
function normalize(value: unknown, root: string): unknown {
  return JSON.parse(JSON.stringify(value).split(JSON.stringify(root).slice(1, -1)).join("<ROOT>"));
}

describe("IR-CLI-110 — rename-scope CLI command", () => {
  // @req IR-CLI-110 AC-1
  it("AC-1: --from/--to with --apply moves the document and reports the rewritten rows and links", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    const run = await cli(root, ["rename-scope", "--from", FROM, "--to", TO, "--apply", "--json"]);

    expect(run.code, run.stdout + run.stderr).toBe(0);
    const parsed = JSON.parse(run.stdout) as { ok: boolean; value: { dryRun: boolean; from: string; to: string; rewrittenRows: unknown[]; rewrittenLinks: unknown[] } };
    expect(parsed.ok).toBe(true);
    expect(parsed.value.dryRun).toBe(false);
    expect(parsed.value.from).toBe(`docs/spec/${FROM}.srs.md`);
    expect(parsed.value.to).toBe(`docs/spec/${TO}.srs.md`);
    // Both index sections register the document, so both rows are reported.
    expect(parsed.value.rewrittenRows.length).toBe(2);
    expect(Array.isArray(parsed.value.rewrittenLinks)).toBe(true);
    expect(await exists(path.join(root, "docs", "spec", `${TO}.srs.md`))).toBe(true);
    expect(await exists(path.join(root, "docs", "spec", `${FROM}.srs.md`))).toBe(false);
    expect(await readFile(path.join(root, "docs", "spec", "00.index.md"), "utf8")).toContain(`${TO}.srs.md`);
  });

  // @req IR-CLI-110 AC-1
  it("AC-1: without --apply, and with --dry-run, the command previews and writes nothing", async () => {
    for (const flags of [[], ["--dry-run"]]) {
      const root = await copyFixtureWorkspace("valid-basic");
      const before = await specTree(root);
      const run = await cli(root, ["rename-scope", "--from", FROM, "--to", TO, ...flags, "--json"]);

      expect(run.code, run.stdout + run.stderr).toBe(0);
      const parsed = JSON.parse(run.stdout) as { value: { dryRun: boolean; rewrittenRows: unknown[] } };
      expect(parsed.value.dryRun, flags.join(" ")).toBe(true);
      expect(parsed.value.rewrittenRows.length).toBe(2);
      expect(await specTree(root)).toEqual(before);
    }
  });

  // @req IR-CLI-110 AC-1
  it("AC-1: --apply together with --dry-run is refused as a usage error before anything runs", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    const before = await specTree(root);
    const run = await cli(root, ["rename-scope", "--from", FROM, "--to", TO, "--apply", "--dry-run"]);

    expect(run.code).toBe(2);
    expect(run.stdout + run.stderr).toMatch(/dry-run/);
    expect(await specTree(root)).toEqual(before);
  });

  // @req IR-CLI-110 AC-2
  it("AC-2: a refusal exits non-zero, prints the refusal code and reason, and writes nothing", async () => {
    const cases: Array<[string, string, string]> = [
      [FROM, "Platform", "SCOPE_RENAME_INVALID_NAME"],
      ["20.missing", "20.other", "SCOPE_RENAME_SOURCE_NOT_FOUND"],
      [FROM, FROM, "SCOPE_RENAME_NO_CHANGE"],
      [FROM, "15.product-architecture", "SCOPE_RENAME_NUMBER_NOT_SHARED"]
    ];
    for (const [from, to, code] of cases) {
      const root = await copyFixtureWorkspace("valid-basic");
      const before = await specTree(root);
      const json = await cli(root, ["rename-scope", "--from", from, "--to", to, "--apply", "--json"]);
      expect(json.code, code).toBe(5);
      const parsed = JSON.parse(json.stdout) as { ok: boolean; error: { code: string; message: string } };
      expect(parsed.ok).toBe(false);
      expect(parsed.error.code).toBe(code);
      expect(parsed.error.message.length).toBeGreaterThan(0);

      const human = await cli(root, ["rename-scope", "--from", from, "--to", to, "--apply"]);
      expect(human.code, code).toBe(5);
      expect(human.stdout + human.stderr).toContain(code);
      expect(await specTree(root), code).toEqual(before);
    }
  });
});

/** A link to the document from inside another docs/spec file — here the document itself. */
async function withSelfLink(root: string): Promise<string> {
  const file = path.join(root, "docs", "spec", `${FROM}.srs.md`);
  await writeFile(file, `${await readFile(file, "utf8")}
Self: [here](./${FROM}.srs.md#top)
`, "utf8");
  return root;
}

describe("IR-CLI-110 / IR-MCP-006 — links in other docs/spec files are reported (FR-NODE-232 AC-6)", () => {
  const after = `Self: [here](./${TO}.srs.md#top)`;

  // @req IR-CLI-110 AC-1
  it("AC-1: the CLI reports otherFileLinks in JSON and in human output", async () => {
    const root = await withSelfLink(await copyFixtureWorkspace("valid-basic"));
    const json = await cli(root, ["rename-scope", "--from", FROM, "--to", TO, "--json"]);
    const parsed = JSON.parse(json.stdout) as { value: { otherFileLinks: Array<{ file: string; after: string }> } };
    expect(parsed.value.otherFileLinks).toEqual([expect.objectContaining({ file: `docs/spec/${TO}.srs.md`, after })]);

    const human = await cli(root, ["rename-scope", "--from", FROM, "--to", TO]);
    expect(human.code).toBe(0);
    expect(human.stdout).toContain("otherFileLinks");
    expect(human.stdout).toContain(after);
  });

  // @req IR-MCP-006 AC-1
  it("AC-1: the MCP tool reports otherFileLinks, equal to the CLI's", async () => {
    const cliRoot = await withSelfLink(await copyFixtureWorkspace("valid-basic"));
    const mcpRoot = await withSelfLink(await copyFixtureWorkspace("valid-basic"));
    const run = await cli(cliRoot, ["rename-scope", "--from", FROM, "--to", TO, "--apply", "--json"]);
    const viaMcp = (await createMcpServer({ root: mcpRoot }).callTool("rename_scope", { from: FROM, to: TO, apply: true })) as {
      value: { otherFileLinks: Array<{ after: string }> };
    };
    expect(viaMcp.value.otherFileLinks.map((entry) => entry.after)).toEqual([after]);
    expect(viaMcp.value.otherFileLinks).toEqual((JSON.parse(run.stdout) as { value: { otherFileLinks: unknown } }).value.otherFileLinks);
  });
});

describe("IR-CLI-110 — rename-scope and the SRS mutation lock", () => {
  // @req IR-CLI-110 AC-2
  it("AC-2: a held lock refuses the rename, and --ignore-lock gets it through", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    await holdLock(root);
    const blocked = await cli(root, ["rename-scope", "--from", FROM, "--to", TO, "--apply", "--json"]);
    expect(blocked.code, blocked.stdout).toBe(5);
    expect(await exists(path.join(root, "docs", "spec", `${FROM}.srs.md`))).toBe(true);

    const bypassed = await cli(root, ["rename-scope", "--from", FROM, "--to", TO, "--apply", "--ignore-lock", "--json"]);
    expect(bypassed.code, bypassed.stdout + bypassed.stderr).toBe(0);
    expect(await exists(path.join(root, "docs", "spec", `${TO}.srs.md`))).toBe(true);

    const viaMcp = await copyFixtureWorkspace("valid-basic");
    await holdLock(viaMcp);
    const handle = createMcpServer({ root: viaMcp });
    expect(((await handle.callTool("rename_scope", { from: FROM, to: TO, apply: true })) as { ok: boolean }).ok).toBe(false);
    expect(((await handle.callTool("rename_scope", { from: FROM, to: TO, apply: true, ignoreLock: true })) as { ok: boolean }).ok).toBe(true);
  });
});

describe("IR-MCP-006 — rename_scope MCP tool", () => {
  // @req IR-MCP-006 AC-1
  it("AC-1: rename_scope with the source and NN.slug invokes renameScope and returns its envelope", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    const handle = createMcpServer({ root });
    expect(handle.toolKinds.rename_scope).toBe("workspace");

    const result = (await handle.callTool("rename_scope", { from: FROM, to: TO, apply: true })) as {
      ok: boolean;
      value: { dryRun: boolean; to: string; rewrittenRows: unknown[] };
    };
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(result.value.dryRun).toBe(false);
    expect(result.value.to).toBe(`docs/spec/${TO}.srs.md`);
    expect(result.value.rewrittenRows.length).toBe(2);
    expect(await exists(path.join(root, "docs", "spec", `${TO}.srs.md`))).toBe(true);
  });

  // @req IR-MCP-006 AC-1
  it("AC-1: without apply the tool previews and writes nothing", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    const before = await specTree(root);
    const result = (await createMcpServer({ root }).callTool("rename_scope", { from: FROM, to: TO })) as { ok: boolean; value: { dryRun: boolean } };
    expect(result.ok).toBe(true);
    expect(result.value.dryRun).toBe(true);
    expect(await specTree(root)).toEqual(before);
  });

  // @req IR-MCP-006 AC-1
  it("AC-1: the tool and the CLI return the same value for the same input", async () => {
    const cliRoot = await copyFixtureWorkspace("valid-basic");
    const mcpRoot = await copyFixtureWorkspace("valid-basic");
    const run = await cli(cliRoot, ["rename-scope", "--from", FROM, "--to", TO, "--apply", "--json"]);
    const viaMcp = (await createMcpServer({ root: mcpRoot }).callTool("rename_scope", { from: FROM, to: TO, apply: true })) as { value: unknown };
    expect(normalize(viaMcp.value, mcpRoot)).toEqual(normalize((JSON.parse(run.stdout) as { value: unknown }).value, cliRoot));
    expect(await specTree(mcpRoot)).toEqual(await specTree(cliRoot));
  });

  // @req IR-MCP-006 AC-2
  it("AC-2: a refusal returns a failure envelope with the reason and writes nothing", async () => {
    for (const [from, to, code] of [
      [FROM, "Platform", "SCOPE_RENAME_INVALID_NAME"],
      ["20.missing", "20.other", "SCOPE_RENAME_SOURCE_NOT_FOUND"],
      [FROM, "15.product-architecture", "SCOPE_RENAME_NUMBER_NOT_SHARED"]
    ] as const) {
      const root = await copyFixtureWorkspace("valid-basic");
      const before = await specTree(root);
      const result = (await createMcpServer({ root }).callTool("rename_scope", { from, to, apply: true })) as {
        ok: boolean;
        error: { code: string; message: string };
      };
      expect(result.ok, code).toBe(false);
      expect(result.error.code).toBe(code);
      expect(result.error.message.length).toBeGreaterThan(0);
      expect(await specTree(root), code).toEqual(before);
    }
  });

  // @req IR-MCP-006 AC-2
  it("AC-2: apply together with dryRun is refused as the CLI refuses it, writing nothing", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    const before = await specTree(root);
    const result = (await createMcpServer({ root }).callTool("rename_scope", { from: FROM, to: TO, apply: true, dryRun: true })) as {
      ok: boolean;
      error: { code: string };
    };
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("USAGE");
    expect(await specTree(root)).toEqual(before);
  });
});
