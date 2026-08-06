import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import {
  BUNDLED_SDS_RULES_FILENAME,
  BUNDLED_SRS_RULES_FILENAME,
  renderIndexRulesRow
} from "../../src/core/bootstrap/templates.js";
import { diagnoseHealth } from "../../src/core/health/doctor.js";
import { parseWorkspace } from "../../src/core/parser/workspace-parser.js";
import { findSpecByCliName, renderCliCommandNames, toolSpecs } from "../../src/mcp/schemas.js";

// IR-CLI-088 — `speckiwi upgrade` performs the migration; `--dry-run` prints the plan.
//
// This supersedes IR-CLI-076, which inverted the two. An operator ran the bare command on a real
// project, read a plan naming every repair, and took the migration to have happened — nothing had been
// written. `init`, the sibling this command delegates to, already performs by default and previews with
// `--dry-run`, so upgrade was the one member of the pair reading the other way.
//
// `--apply` stays accepted. It now asks for what the command already does, so a script written against
// the old contract keeps working instead of quietly turning into a no-op preview — and giving both
// flags at once is refused rather than settled by a precedence rule nobody can see.
//
// The command is still deliberately CLI-only: `init_project` is exposed over MCP because it touches
// only tool-owned artifacts, and upgrade rewrites author-owned files.

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

function expectUnchanged(before: Map<string, string>, after: Map<string, string>, why: string): void {
  expect([...after.keys()].sort(), why).toEqual([...before.keys()].sort());
  for (const [rel, content] of after) expect(content, `${why}: ${rel}`).toBe(before.get(rel));
}

/** Both gaps the migration exists to close, as they read on disk after a performed run. */
async function expectGapsClosed(root: string): Promise<void> {
  expect(await readFile(path.join(root, "docs", "spec", "00.index.md"), "utf8")).toContain(renderIndexRulesRow());
  expect(await readFile(path.join(root, "CLAUDE.md"), "utf8")).not.toContain(STALE_RULES);
}

/** Runs the CLI with skills/MCP provisioning off, so a case exercises the migration itself. */
async function run(root: string, args: string[]) {
  const streams = io();
  const code = await main(["--root", root, "upgrade", "--no-skills", "--no-mcp", ...args], streams);
  return { code, stdout: drain(streams.stdout), stderr: drain(streams.stderr) };
}

describe("IR-CLI-088 AC-1 — the bare command performs the migration", () => {
  it("exits 0, reports the run as applied, and closes both gaps on disk", async () => {
    const root = await legacyProject();

    const { code, stdout } = await run(root, ["--json"]);

    expect(code, stdout).toBe(0);
    const parsed = JSON.parse(stdout) as { ok: boolean; value?: { applied?: boolean } };
    expect(parsed.ok).toBe(true);
    // `applied` is what an operator reads to know the difference; a plan reports false here.
    expect(parsed.value?.applied, "the bare command only planned").toBe(true);
    await expectGapsClosed(root);
  });
});

describe("IR-CLI-088 AC-2 — --dry-run prints the plan and writes nothing", () => {
  it("exits 0, still reports the planned repairs, and leaves the workspace byte-identical", async () => {
    const root = await legacyProject();
    const before = await snapshot(root);

    const { code, stdout } = await run(root, ["--dry-run", "--json"]);

    expect(code, stdout).toBe(0);
    const parsed = JSON.parse(stdout) as {
      ok: boolean;
      value?: { applied?: boolean; references?: Array<{ filePath?: string }> };
    };
    expect(parsed.ok).toBe(true);
    expect(parsed.value?.applied).toBe(false);
    // Writing nothing is only half of it: a plan that reports nothing is not a plan.
    expect(parsed.value?.references?.some((entry) => entry.filePath === "CLAUDE.md")).toBe(true);

    expectUnchanged(before, await snapshot(root), "the plan wrote to the workspace");
  });

  it("writes nothing with the skills and MCP steps enabled, which is the shipped default path", async () => {
    // Every other case passes --no-skills --no-mcp to stay on the migration itself, which would leave
    // the shipped path unasserted in the one criterion that says "writes nothing".
    const root = await legacyProject();
    const before = await snapshot(root);

    const streams = io();
    const code = await main(["--root", root, "upgrade", "--dry-run", "--json"], streams);

    expect(code, drain(streams.stdout)).toBe(0);
    expectUnchanged(before, await snapshot(root), "the plan wrote to the workspace");
  });
});

describe("IR-CLI-088 AC-3 — --apply still performs the same run", () => {
  it("keeps a caller written against the previous contract working", async () => {
    const root = await legacyProject();

    const { code, stdout } = await run(root, ["--apply", "--json"]);

    expect(code, stdout).toBe(0);
    expect((JSON.parse(stdout) as { value?: { applied?: boolean } }).value?.applied).toBe(true);
    await expectGapsClosed(root);
  });
});

describe("IR-CLI-088 AC-4 — --apply with --dry-run is refused", () => {
  it("exits non-zero and writes nothing rather than letting one flag win", async () => {
    const root = await legacyProject();
    const before = await snapshot(root);

    const { code, stdout, stderr } = await run(root, ["--apply", "--dry-run", "--json"]);

    expect(code, "a contradictory request was resolved instead of refused").not.toBe(0);
    const payload = `${stdout}${stderr}`;
    expect(payload).toContain("USAGE");
    // The refusal is worth nothing if the run had already half-performed the migration.
    expectUnchanged(before, await snapshot(root), "the refused run still wrote");
  });
});

describe("IR-CLI-088 AC-5 — the report locates every repaired reference", () => {
  it("names each repair as file:line in both the JSON envelope and the human form", async () => {
    const root = await legacyProject();

    const asJson = await run(root, ["--dry-run", "--json"]);
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

    // The default run is the one an operator sees most, so it must locate its repairs too.
    const human = await run(await legacyProject(), []);
    expect(human.code).toBe(0);
    expect(human.stdout).toContain("CLAUDE.md:3");
  });
});

describe("IR-CLI-088 AC-6 — the report states what the command will not do", () => {
  it("names the three boundaries on the performed run and on the plan alike", async () => {
    // Renumbering a scope document, editing a requirement body, and overwriting a hook are all
    // outside this command; saying so is part of the contract, not decoration.
    //
    // Each phrase must be distinctive enough that deleting its boundary sentence breaks the
    // assertion. `/hook/i` was not: the payload independently carries a `hooks` array, three hook
    // paths and init's "runs project hooks only after you trust the repository" warning, so it
    // matched eight lines with the whole boundary list stripped out.
    for (const args of [[], ["--dry-run"]]) {
      const { stdout } = await run(await legacyProject(), args);
      const where = args.length === 0 ? "the performed run" : "the plan";
      expect(stdout, where).toMatch(/never renumbered/);
      expect(stdout, where).toMatch(/governance mutation/);
      expect(stdout, where).toMatch(/never overwritten/);
    }
  });
});

describe("IR-CLI-088 AC-7 — upgrade is a registry entry declaring --dry-run and no MCP tool", () => {
  it("appears in the catalog through the registry, declares --dry-run, and carries no mcpName", async () => {
    const spec = findSpecByCliName("upgrade");
    expect(spec, "upgrade must be a ToolSpec registry entry").toBeDefined();
    expect(spec!.mcpName, "upgrade rewrites author files; no MCP tool may drive it").toBeUndefined();
    // The registry is the parity SSOT: a flag the command ships and the registry omits is a catalog
    // that lies about the surface, which is how `--type` on supersede stayed dead (FR-NODE-176).
    expect(
      spec!.options.map((option) => option.flag),
      "the registry must declare the flag that now selects the plan"
    ).toContain("--dry-run");
    expect(renderCliCommandNames()).toContain("upgrade");
    expect(toolSpecs.filter((candidate) => candidate.cliName === "upgrade")).toHaveLength(1);

    const root = await legacyProject();
    const streams = io();
    expect(await main(["--root", root, "commands", "--json"], streams)).toBe(0);
    expect(drain(streams.stdout)).toContain("upgrade");
  });
});

describe("IR-CLI-088 AC-8 — a failed upgrade exits 5", () => {
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

    const { code, stdout } = await run(root, ["--json"]);

    expect(code).toBe(5);
    expect(stdout).toContain("SRS_LOCKED");
    // The migration is atomic in the only sense that matters here: a refused run changes nothing.
    expect(await readFile(path.join(root, "CLAUDE.md"), "utf8")).toContain(STALE_RULES);
  });
});

describe("IR-CLI-088 AC-10 — no shipped guidance calls the bare command a preview", () => {
  it("the doctor remediation names --dry-run for the step that reads the plan", async () => {
    // Found by an independent audit of this very change: `doctor` told the operator to "Run
    // `speckiwi upgrade` to see the planned repairs, then `speckiwi upgrade --apply` to rewrite".
    // After the default flipped, step one performs the migration — the tool instructing a write
    // while calling it a preview, which is the exact hazard this requirement exists to remove.
    //
    // IR-CLI-077 AC-2 is still satisfied (the remediation names `speckiwi upgrade`); its case
    // matches `/speckiwi upgrade/`, which is why the stale sentence survived. This pins the flag.
    const root = await legacyProject();
    // The fixture ships the stale document, so the reference to it resolves and the check reads ok.
    // Removing it is what makes the reference dangle — the state whose remediation is under test.
    await rm(path.join(root, "docs", "rule", STALE_RULES));
    await writeFile(path.join(root, "docs", "rule", BUNDLED_SRS_RULES_FILENAME), "# Rules\n", "utf8");
    await writeFile(path.join(root, "docs", "rule", BUNDLED_SDS_RULES_FILENAME), "# SDS rules\n", "utf8");

    const workspace = await parseWorkspace({ root });
    const report = await diagnoseHealth(workspace);
    const check = report.checks.find((entry) => /reference/i.test(entry.topic) && /rules/i.test(entry.topic));

    expect(check, "the rules reference check must run on this fixture").toBeDefined();
    expect(check!.state, "the seeded dangling reference must warn, or this asserts nothing").toBe("warn");
    const remediation = check!.remediation ?? "";
    expect(remediation, "the remediation stopped naming the command at all").toContain("speckiwi upgrade");
    expect(remediation, "the preview step must name the flag that previews").toContain("speckiwi upgrade --dry-run");
    // The failure mode is a sentence that offers the bare command as the reading step. Pinning the
    // presence of --dry-run alone would still pass with that sentence left in beside it.
    expect(remediation, "the bare command is still offered as a way to read the plan").not.toMatch(
      /`speckiwi upgrade` to (?:see|read|review|preview)/
    );
  });
});

describe("IR-CLI-088 AC-9 — the project is found by discovery, not assumed to be the cwd", () => {
  it("upgrades the enclosing project when run from a subdirectory with no --root", async () => {
    const root = await legacyProject();
    const nested = path.join(root, "src", "deep");
    await mkdir(nested, { recursive: true });
    const cwd = process.cwd();

    try {
      process.chdir(nested);
      const streams = io();
      const code = await main(["upgrade", "--no-skills", "--no-mcp", "--json"], streams);
      expect(code, drain(streams.stdout)).toBe(0);
    } finally {
      process.chdir(cwd);
    }

    // An explicit root skips discovery entirely, so passing cwd as the root would treat this
    // subdirectory as the project and scaffold a second one inside it.
    expect(await snapshot(nested).then((files) => [...files.keys()])).toEqual([]);
    await expectGapsClosed(root);
  });
});
