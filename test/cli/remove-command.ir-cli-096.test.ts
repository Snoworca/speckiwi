import { access, mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { initProject } from "../../src/core/bootstrap/init-project.js";
import { resolveProjectRoot } from "../../src/core/project-root.js";
import { findSpecByCliName, toolSpecs } from "../../src/mcp/schemas.js";

// @req IR-CLI-096 — `speckiwi remove` undoes what init wired in, and cannot be reached by accident.
//
// Two shipped precedents point opposite ways. `upgrade` performs by default because its worst
// misreading was that nothing happened. `skills mirror` refuses a bare invocation because its
// destructive branch would otherwise be reachable by a dropped flag. Removal is the second kind, and
// every case below that could touch a global destination runs inside `withHome`.

function io() {
  return { stdout: new PassThrough() as NodeJS.WriteStream, stderr: new PassThrough() as NodeJS.WriteStream };
}

function drain(stream: NodeJS.WriteStream): string {
  return (stream as unknown as PassThrough).read()?.toString() ?? "";
}

async function exists(target: string): Promise<boolean> {
  return access(target).then(() => true).catch(() => false);
}

async function withHome<T>(home: string, fn: () => Promise<T>): Promise<T> {
  const prev = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, CODEX_HOME: process.env.CODEX_HOME };
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  process.env.CODEX_HOME = path.join(home, ".codex");
  try {
    return await fn();
  } finally {
    for (const key of ["HOME", "USERPROFILE", "CODEX_HOME"] as const) {
      if (prev[key] === undefined) delete process.env[key];
      else process.env[key] = prev[key];
    }
  }
}

async function writeFixtureSkill(base: string, subdir: "claude" | "codex", name: string): Promise<void> {
  const dir = path.join(base, subdir, name);
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, "SKILL.md"),
    ["---", `name: ${name}`, "description: test skill", "---", "", `# ${name}`, "", "Normal operation requires speckiwi mcp."].join("\n"),
    "utf8"
  );
}

/** An initialised project plus a temp home holding both agents' global skills. */
async function initialised(): Promise<{ root: string; home: string }> {
  const root = await mkdtemp(path.join(tmpdir(), "speckiwi-remove-cli-"));
  await mkdir(path.join(root, ".git", "hooks"), { recursive: true });
  const base = path.join(root, "skills");
  await writeFixtureSkill(base, "claude", "kiwi-keep");
  await writeFixtureSkill(base, "codex", "kiwi-keep");
  const home = await mkdtemp(path.join(tmpdir(), "speckiwi-remove-cli-home-"));
  await mkdir(path.join(home, ".claude"));
  await mkdir(path.join(home, ".codex"));
  const result = await initProject(await resolveProjectRoot(root), {
    installSkills: true,
    installSkillsGlobal: true,
    registerMcp: true,
    skillSourceBaseDir: base,
    globalHomeDir: home,
    globalCodexHome: path.join(home, ".codex")
  });
  if (!result.ok) throw new Error(result.error.message);
  return { root, home };
}

async function run(root: string, home: string, args: string[]) {
  const streams = io();
  const code = await withHome(home, () => main(["--root", root, "remove", ...args], streams));
  return { code, stdout: drain(streams.stdout), stderr: drain(streams.stderr) };
}

/**
 * Every file under the project. `kiwi/` is excluded: the mutation lock rewrites a status file carrying
 * a fresh timestamp on every guarded run, which would report a difference for any run at all.
 */
async function snapshot(root: string): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  async function walk(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const full = path.join(dir, entry.name);
      const relative = path.relative(root, full).split(path.sep).join("/");
      if (relative === "kiwi") continue;
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) files.set(relative, await readFile(full, "utf8"));
    }
  }
  await walk(root);
  return files;
}

describe("IR-CLI-096 AC-1 — a bare invocation is refused", () => {
  it("exits with a usage error naming both modes and writes nothing", async () => {
    const { root, home } = await initialised();
    const before = await snapshot(root);

    const { code, stdout, stderr } = await run(root, home, ["--json"]);

    expect(code, "the bare command was allowed to do something").not.toBe(0);
    const payload = `${stdout}${stderr}`;
    expect(payload).toContain("--dry-run");
    expect(payload).toContain("--apply");
    expect(await snapshot(root), "the refused command still wrote").toEqual(before);
  });
});

describe("IR-CLI-096 AC-2 — both modes at once is refused", () => {
  it("exits non-zero and writes nothing", async () => {
    const { root, home } = await initialised();
    const before = await snapshot(root);

    const { code, stdout, stderr } = await run(root, home, ["--apply", "--dry-run", "--json"]);

    expect(code).not.toBe(0);
    expect(`${stdout}${stderr}`).toContain("USAGE");
    expect(await snapshot(root), "the refused command still wrote").toEqual(before);
  });
});

describe("IR-CLI-096 AC-3 — --apply performs, --dry-run plans", () => {
  it("removes the project wiring under --apply", async () => {
    const { root, home } = await initialised();

    const { code, stdout } = await run(root, home, ["--apply", "--json"]);

    expect(code, stdout).toBe(0);
    expect(await exists(path.join(root, ".claude", "skills", "kiwi-keep"))).toBe(false);
    expect(await exists(path.join(root, ".agents", "skills", "kiwi-keep"))).toBe(false);
    expect(JSON.parse(await readFile(path.join(root, ".mcp.json"), "utf8"))).toEqual({ mcpServers: {} });
    expect(await exists(path.join(root, ".git", "hooks", "pre-commit"))).toBe(false);
  });

  it("names the same paths under --dry-run and leaves the workspace byte-identical", async () => {
    const planned = await initialised();
    const performed = await initialised();
    const before = await snapshot(planned.root);

    const plan = await run(planned.root, planned.home, ["--dry-run", "--json"]);
    const real = await run(performed.root, performed.home, ["--apply", "--json"]);

    expect(plan.code, plan.stdout).toBe(0);
    const relative = (value: string, root: string): string[] =>
      ((JSON.parse(value) as { value?: { removed?: string[] } }).value?.removed ?? [])
        .map((entry) => path.relative(root, entry).split(path.sep).join("/"))
        .sort();
    expect(relative(plan.stdout, planned.root)).toEqual(relative(real.stdout, performed.root));
    expect(await snapshot(planned.root), "the plan wrote to the workspace").toEqual(before);
  });
});

describe("IR-CLI-096 AC-4/AC-5 — -g selects the global scope instead of the project", () => {
  it("removes the global skills and leaves every project artifact in place", async () => {
    const { root, home } = await initialised();
    expect(await exists(path.join(home, ".claude", "skills", "kiwi-keep")), "the fixture installed no global skills").toBe(true);

    const { code, stdout } = await run(root, home, ["--global", "--apply", "--json"]);

    expect(code, stdout).toBe(0);
    expect(await exists(path.join(home, ".claude", "skills", "kiwi-keep"))).toBe(false);
    expect(await exists(path.join(home, ".codex", "skills", "kiwi-keep")), "only one agent's global skills were removed").toBe(false);
    // If `-g` were additive, every assertion below would fail — which is the whole point of the flag
    // reading the other way on a destructive command.
    expect(await exists(path.join(root, ".claude", "skills", "kiwi-keep")), "the project skills were removed too").toBe(true);
    expect(await exists(path.join(root, ".git", "hooks", "pre-commit"))).toBe(true);
    expect(JSON.parse(await readFile(path.join(root, ".mcp.json"), "utf8")).mcpServers).toHaveProperty("speckiwi");
    expect(await readFile(path.join(root, "CLAUDE.md"), "utf8")).toContain("SpecKiwi SRS workflow");
  });

  it("says in the help that -g means instead of, not in addition to", async () => {
    const streams = io();
    await main(["remove", "--help"], streams);
    const help = `${drain(streams.stdout)}${drain(streams.stderr)}`;
    expect(help).toMatch(/-g,\s*--global/);
    // The word that distinguishes it from `init -g`. Without it a reader carries init's reading over.
    expect(help, "the help does not distinguish this -g from init's additive one").toMatch(/instead of/i);
  });
});

describe("IR-CLI-096 AC-6 — a requirement id is refused, with the right command named", () => {
  it("refuses a positional argument and points at supersede", async () => {
    // Every neighbouring top-level command takes a requirement id — `update-status`, `supersede`,
    // `retarget`, `restore`. Someone will type `speckiwi remove FR-CLI-001`.
    const { root, home } = await initialised();
    const before = await snapshot(root);

    const { code, stdout, stderr } = await run(root, home, ["FR-CLI-001", "--apply", "--json"]);

    expect(code, "a requirement id was accepted by a command that uninstalls the tool").not.toBe(0);
    expect(`${stdout}${stderr}`).toContain("supersede");
    expect(await snapshot(root), "the refused command still wrote").toEqual(before);
  });
});

describe("IR-CLI-096 AC-7 — the exit status distinguishes kept from removed", () => {
  it("exits non-zero and names the kept path when something was kept", async () => {
    const { root, home } = await initialised();
    await mkdir(path.join(root, ".claude", "skills", "kiwi-mine"), { recursive: true });
    await writeFile(path.join(root, ".claude", "skills", "kiwi-mine", "SKILL.md"), "mine\n", "utf8");

    const { code, stdout } = await run(root, home, ["--apply", "--json"]);

    expect(code, "a partial removal reported success").not.toBe(0);
    expect(stdout).toContain("kiwi-mine");
  });

  it("exits zero when nothing was kept, including when there was nothing to remove", async () => {
    const { root, home } = await initialised();
    const first = await run(root, home, ["--apply", "--json"]);
    expect(first.code, first.stdout).toBe(0);

    const second = await run(root, home, ["--apply", "--json"]);

    expect(second.code, "an already-clean project reported failure").toBe(0);
  });
});

describe("IR-CLI-096 AC-8 — a project-scope run reports global leftovers", () => {
  it("names the global destination and the command that clears it", async () => {
    const { root, home } = await initialised();

    const { stdout } = await run(root, home, ["--apply", "--json"]);

    // Parsed, not string-matched: a Windows path is backslash-escaped inside JSON, so comparing the
    // raw path against the serialised payload fails on a report that is entirely correct.
    const notes = ((JSON.parse(stdout) as { value?: { notes?: string[] } }).value?.notes ?? []).join("\n");
    // Without this the operator removes 2 of 4 roots, sees an unchanged skill list because the agent
    // still loads the global copies, and concludes the command did nothing.
    expect(notes, "the global leftovers are not reported").toContain(path.join(home, ".claude", "skills"));
    expect(notes, "the command that removes them is not named").toMatch(/remove\s+--global/);
  });
});

describe("IR-CLI-096 AC-9 — registry entry, no MCP tool", () => {
  it("is in the registry and the catalogue, and exposes no MCP tool", async () => {
    const spec = findSpecByCliName("remove");
    expect(spec, "remove must be a ToolSpec registry entry").toBeDefined();
    expect(spec!.mcpName, "no MCP tool may drive a command that deletes the tool's own wiring").toBeUndefined();
    expect(toolSpecs.filter((candidate) => candidate.cliName === "remove")).toHaveLength(1);
    for (const flag of ["--dry-run", "--apply", "-g, --global"]) {
      expect(spec!.options.map((option) => option.flag), `the registry omits ${flag}`).toContain(flag);
    }

    const { root, home } = await initialised();
    const streams = io();
    expect(await withHome(home, () => main(["--root", root, "commands", "--json"], streams))).toBe(0);
    const catalogue = drain(streams.stdout);
    const entry = (JSON.parse(catalogue) as { commands?: Array<{ name?: string; options?: Array<{ flag?: string }> }> }).commands?.find(
      (candidate) => candidate.name === "remove"
    );
    expect(entry, "remove is missing from the generated catalogue").toBeDefined();
    expect(entry!.options?.map((option) => option.flag)).toContain("-g, --global");
  });
});
