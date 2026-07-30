import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { renderIndexRulesRow } from "../../src/core/bootstrap/templates.js";
import { findSpecByCliName, renderCliCommandNames, toolSpecs } from "../../src/mcp/schemas.js";

// IR-CLI-076 — `speckiwi upgrade` performs the migration, printing a plan unless asked to apply.
//
// The command is deliberately CLI-only. `init_project` is exposed over MCP because it touches only
// tool-owned artifacts; upgrade rewrites author-owned files, and that reasoning does not carry over.

const STALE_RULES = "SRS-MD-Rules-v1.0.0.md";

function io() {
  return { stdout: new PassThrough() as NodeJS.WriteStream, stderr: new PassThrough() as NodeJS.WriteStream };
}

function drain(stream: NodeJS.WriteStream): string {
  return (stream as unknown as PassThrough).read()?.toString() ?? "";
}

/** A project an older speckiwi left behind: no index Rules row, agent files pointing at pruned rules. */
async function legacyProject(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "speckiwi-upgrade-cli-"));
  await mkdir(path.join(root, ".git"));
  await mkdir(path.join(root, "docs", "spec"), { recursive: true });
  await mkdir(path.join(root, "docs", "rule"), { recursive: true });
  await writeFile(
    path.join(root, "docs", "spec", "00.index.md"),
    ["# Demo SRS Index", "", "| Field | Value |", "|---|---|", "| Document Type | srs_index |", "| Active Target | v1.0.0 |", ""].join("\n"),
    "utf8"
  );
  await writeFile(path.join(root, "docs", "rule", STALE_RULES), "# Old rules\n", "utf8");
  await writeFile(
    path.join(root, "CLAUDE.md"),
    `# Notes\n\nRead [rules](docs/rule/${STALE_RULES}).\n`,
    "utf8"
  );
  return root;
}

async function snapshot(root: string): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  async function walk(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) files.set(path.relative(root, full).replace(/\\/g, "/"), await readFile(full, "utf8"));
    }
  }
  await walk(root);
  return files;
}

/** Runs the CLI with skills/MCP provisioning off, so a case exercises the migration itself. */
async function run(root: string, args: string[]) {
  const streams = io();
  const code = await main(["--root", root, "upgrade", "--no-skills", "--no-mcp", ...args], streams);
  return { code, stdout: drain(streams.stdout), stderr: drain(streams.stderr) };
}

describe("IR-CLI-076 AC-1 — the bare command prints a plan and writes nothing", () => {
  it("exits 0, reports the planned repairs, and leaves the workspace byte-identical", async () => {
    const root = await legacyProject();
    const before = await snapshot(root);

    const { code, stdout } = await run(root, ["--json"]);

    expect(code).toBe(0);
    const parsed = JSON.parse(stdout) as { ok: boolean; value?: { applied?: boolean } };
    expect(parsed.ok).toBe(true);
    expect(parsed.value?.applied).toBe(false);

    const after = await snapshot(root);
    expect([...after.keys()].sort()).toEqual([...before.keys()].sort());
    for (const [rel, content] of after) expect(content, `plan must not modify ${rel}`).toBe(before.get(rel));
  });
});

describe("IR-CLI-076 AC-1 — the default plan writes nothing with every step enabled", () => {
  it("leaves the tree byte-identical even with the skills and MCP steps on", async () => {
    // Every other case here passes --no-skills --no-mcp to stay on the migration itself, which leaves
    // the shipped default path — both steps enabled — unasserted in the one AC that says "writes
    // nothing". A plan must plan those steps too, not perform them.
    const root = await legacyProject();
    const before = await snapshot(root);

    const streams = io();
    const code = await main(["--root", root, "upgrade", "--json"], streams);

    expect(code, drain(streams.stdout)).toBe(0);
    const after = await snapshot(root);
    expect([...after.keys()].sort()).toEqual([...before.keys()].sort());
    for (const [rel, content] of after) expect(content, `plan must not modify ${rel}`).toBe(before.get(rel));
  });
});

describe("IR-CLI-076 AC-2 — --apply performs the plan", () => {
  it("exits 0 and leaves the two gaps closed on disk", async () => {
    const root = await legacyProject();

    const { code } = await run(root, ["--apply", "--json"]);

    expect(code).toBe(0);
    expect(await readFile(path.join(root, "docs", "spec", "00.index.md"), "utf8")).toContain(renderIndexRulesRow());
    expect(await readFile(path.join(root, "CLAUDE.md"), "utf8")).not.toContain(STALE_RULES);
  });
});

describe("IR-CLI-076 AC-3 — the report locates every repaired reference", () => {
  it("names each repair as file:line in both the JSON envelope and the human form", async () => {
    const root = await legacyProject();

    const asJson = await run(root, ["--json"]);
    const envelope = JSON.parse(asJson.stdout) as {
      ok: boolean;
      diagnosticsSummary?: unknown;
      value?: { references?: Array<{ location?: string; filePath?: string; line?: number }> };
    };
    // The standard mutation envelope, not a bespoke shape.
    expect(envelope.ok).toBe(true);
    expect(envelope.diagnosticsSummary).toBeDefined();

    const reference = envelope.value?.references?.find((entry) => entry.filePath === "CLAUDE.md");
    expect(reference, "the dangling CLAUDE.md reference must be reported").toBeDefined();
    // Pinned to the seeded source line, not to `location === \`CLAUDE.md:${reference.line}\``, which
    // holds for whatever line the implementation happens to report and so pins nothing.
    expect(reference!.line).toBe(3);
    expect(reference!.location).toBe("CLAUDE.md:3");

    // A reader running the command without --json must still see where each repair lands.
    const human = await run(await legacyProject(), []);
    expect(human.code).toBe(0);
    expect(human.stdout).toContain("CLAUDE.md:3");
  });
});

describe("IR-CLI-076 AC-4 — the report states what the command will not do", () => {
  it("names the three boundaries, so a reader never assumes more than the command performs", async () => {
    const root = await legacyProject();

    const { stdout } = await run(root, []);

    // Renumbering a scope document, editing a requirement body, and overwriting a hook are all
    // outside this command; saying so is part of the contract, not decoration.
    //
    // Each phrase must be distinctive enough that deleting its boundary sentence breaks the
    // assertion. `/hook/i` was not: the payload independently carries a `hooks` array, three hook
    // paths and init's "runs project hooks only after you trust the repository" warning, so it
    // matched eight lines with the whole boundary list stripped out.
    expect(stdout).toMatch(/never renumbered/);
    expect(stdout).toMatch(/governance mutation/);
    expect(stdout).toMatch(/never overwritten/);
  });
});

describe("IR-CLI-076 AC-5 — upgrade is a registry entry and carries no MCP tool", () => {
  it("appears in the catalog through the registry and declares no mcpName", async () => {
    const spec = findSpecByCliName("upgrade");
    expect(spec, "upgrade must be a ToolSpec registry entry").toBeDefined();
    expect(spec!.mcpName, "upgrade rewrites author files; no MCP tool may drive it").toBeUndefined();
    expect(renderCliCommandNames()).toContain("upgrade");
    expect(toolSpecs.filter((candidate) => candidate.cliName === "upgrade")).toHaveLength(1);

    const root = await legacyProject();
    const streams = io();
    expect(await main(["--root", root, "commands", "--json"], streams)).toBe(0);
    expect(drain(streams.stdout)).toContain("upgrade");
  });
});

describe("IR-CLI-076 AC-7 — the project is found by discovery, not assumed to be the cwd", () => {
  it("upgrades the enclosing project when run from a subdirectory with no --root", async () => {
    const root = await legacyProject();
    const nested = path.join(root, "src", "deep");
    await mkdir(nested, { recursive: true });
    const cwd = process.cwd();

    try {
      process.chdir(nested);
      const streams = io();
      const code = await main(["upgrade", "--apply", "--no-skills", "--no-mcp", "--json"], streams);
      expect(code, drain(streams.stdout)).toBe(0);
    } finally {
      process.chdir(cwd);
    }

    // An explicit root skips discovery entirely, so passing cwd as the root would treat this
    // subdirectory as the project and scaffold a second one inside it.
    expect(await snapshot(nested).then((files) => [...files.keys()])).toEqual([]);
    expect(await readFile(path.join(root, "CLAUDE.md"), "utf8")).not.toContain(STALE_RULES);
    expect(await readFile(path.join(root, "docs", "spec", "00.index.md"), "utf8")).toContain(renderIndexRulesRow());
  });
});

describe("IR-CLI-076 AC-6 — a failed upgrade exits 5", () => {
  it("reports the held SRS mutation lock rather than proceeding", async () => {
    const root = await legacyProject();
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
      })}\n`,
      "utf8"
    );

    const { code, stdout } = await run(root, ["--apply", "--json"]);

    expect(code).toBe(5);
    expect(stdout).toContain("SRS_LOCKED");
    // The migration is atomic in the only sense that matters here: a refused run changes nothing.
    expect(await readFile(path.join(root, "CLAUDE.md"), "utf8")).toContain(STALE_RULES);
  });
});
