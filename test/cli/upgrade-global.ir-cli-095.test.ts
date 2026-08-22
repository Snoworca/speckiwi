import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { findSpecByCliName, toolSpecs } from "../../src/mcp/schemas.js";

// @req IR-CLI-095 — `speckiwi upgrade -g/--global` refreshes the installed agents' global skills.
//
// Every case that can reach a global destination runs inside `withHome`, which repoints
// HOME/USERPROFILE/CODEX_HOME at a temp directory. Without it this suite would install skills into the
// developer's real ~/.claude — the CLI has no injection seam, so the environment is the only seam.

function io() {
  return { stdout: new PassThrough() as NodeJS.WriteStream, stderr: new PassThrough() as NodeJS.WriteStream };
}

function drain(stream: NodeJS.WriteStream): string {
  return (stream as unknown as PassThrough).read()?.toString() ?? "";
}

async function tempHome(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "speckiwi-upgrade-g-home-"));
}

async function exists(target: string): Promise<boolean> {
  return access(target).then(() => true).catch(() => false);
}

/** A project an older speckiwi left behind: an index with no `| Rules |` row. */
async function legacyProject(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "speckiwi-upgrade-g-"));
  await mkdir(path.join(root, ".git"));
  await mkdir(path.join(root, "docs", "spec"), { recursive: true });
  await mkdir(path.join(root, "docs", "rule"), { recursive: true });
  await writeFile(
    path.join(root, "docs", "spec", "00.index.md"),
    ["# Demo SRS Index", "", "| Field | Value |", "|---|---|", "| Document Type | srs_index |", "| Active Target | v1.0.0 |", ""].join("\n"),
    "utf8"
  );
  return root;
}

/** Repoint the home env vars at a hermetic temp home for the duration of fn, then restore. */
async function withHome<T>(home: string, fn: () => Promise<T>): Promise<T> {
  const prev = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, CODEX_HOME: process.env.CODEX_HOME };
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  delete process.env.CODEX_HOME;
  try {
    return await fn();
  } finally {
    for (const key of ["HOME", "USERPROFILE", "CODEX_HOME"] as const) {
      if (prev[key] === undefined) delete process.env[key];
      else process.env[key] = prev[key];
    }
  }
}

type Envelope = {
  ok: boolean;
  value?: { applied?: boolean; init?: { created: string[]; updated: string[]; skipped: string[]; removed: string[]; warnings?: string[] } };
};

async function runUpgrade(root: string, home: string, args: string[]) {
  const streams = io();
  const code = await withHome(home, () => main(["--root", root, "upgrade", "--no-mcp", ...args], streams));
  const stdout = drain(streams.stdout);
  return { code, stdout, stderr: drain(streams.stderr) };
}

function parse(stdout: string): Envelope {
  return JSON.parse(stdout) as Envelope;
}

/** Every path the report mentions, across all four result arrays. */
function reportedPaths(envelope: Envelope): string[] {
  const init = envelope.value?.init;
  return init ? [...init.created, ...init.updated, ...init.skipped, ...init.removed] : [];
}

async function homeWithBothAgents(): Promise<string> {
  const home = await tempHome();
  await mkdir(path.join(home, ".claude"));
  await mkdir(path.join(home, ".codex"));
  return home;
}

describe("IR-CLI-095 AC-1 — the flag is declared and both spellings parse", () => {
  it("lists -g, --global in the command help", async () => {
    const streams = io();
    // Commander throws its help-display exit through main's own handler; capture the text instead.
    await main(["upgrade", "--help"], streams);
    const help = `${drain(streams.stdout)}${drain(streams.stderr)}`;
    expect(help).toMatch(/-g,\s*--global/);
    expect(help, "the help text does not say what the flag refreshes").toMatch(/global/i);
    expect(help, "the description must name skills, or it says nothing a reader can act on").toMatch(/skill/i);
  });

  it.each([["--global"], ["-g"]])("accepts %s without a usage error", async (flag) => {
    const home = await homeWithBothAgents();
    const { code, stdout } = await runUpgrade(await legacyProject(), home, [flag, "--dry-run", "--json"]);
    expect(code, stdout).toBe(0);
    expect(parse(stdout).ok).toBe(true);
  }, 60000);
});

describe("IR-CLI-095 AC-2 — the flag decides whether a global destination is touched at all", () => {
  it("reports the global destinations when the flag is passed", async () => {
    const home = await homeWithBothAgents();
    const { code, stdout } = await runUpgrade(await legacyProject(), home, ["--global", "--json"]);
    expect(code, stdout).toBe(0);
    const reported = reportedPaths(parse(stdout));
    expect(reported.some((entry) => entry.startsWith(path.join(home, ".claude", "skills")))).toBe(true);
    expect(reported.some((entry) => entry.startsWith(path.join(home, ".codex", "skills")))).toBe(true);
    expect(await exists(path.join(home, ".claude", "skills"))).toBe(true);
  }, 60000);

  it("touches and reports nothing under the home when the flag is absent", async () => {
    // The same fixture as the case above, so the only difference is the flag. Asserting the
    // filesystem alone would miss a report that claims global work it never did — and a caller
    // reading `created` is exactly who would then believe the global skills are current.
    const home = await homeWithBothAgents();
    const { code, stdout } = await runUpgrade(await legacyProject(), home, ["--json"]);
    expect(code, stdout).toBe(0);
    expect(reportedPaths(parse(stdout)).filter((entry) => entry.startsWith(home))).toEqual([]);
    expect(await exists(path.join(home, ".claude", "skills"))).toBe(false);
    expect(await exists(path.join(home, ".codex", "skills"))).toBe(false);
  }, 60000);
});

describe("IR-CLI-095 AC-3 — --global composes with --dry-run", () => {
  it("names the global destinations in the plan and creates none of them", async () => {
    const home = await homeWithBothAgents();
    const { code, stdout } = await runUpgrade(await legacyProject(), home, ["--global", "--dry-run", "--json"]);
    expect(code, stdout).toBe(0);
    const envelope = parse(stdout);
    expect(envelope.value?.applied).toBe(false);
    expect(reportedPaths(envelope).some((entry) => entry.startsWith(path.join(home, ".claude", "skills")))).toBe(true);
    expect(await exists(path.join(home, ".claude", "skills"))).toBe(false);
    expect(await exists(path.join(home, ".codex", "skills"))).toBe(false);
  }, 60000);
});

describe("IR-CLI-095 AC-4 — the existing verdicts are unchanged", () => {
  it("still refuses --dry-run with --apply, and writes nothing when it does", async () => {
    const home = await homeWithBothAgents();
    const root = await legacyProject();
    const { code, stdout, stderr } = await runUpgrade(root, home, ["--global", "--apply", "--dry-run", "--json"]);
    expect(code, "a contradictory request was resolved instead of refused").not.toBe(0);
    expect(`${stdout}${stderr}`).toContain("USAGE");
    // A refusal that had already provisioned the global skills is not a refusal.
    expect(await exists(path.join(home, ".claude", "skills"))).toBe(false);
    expect(await readFile(path.join(root, "docs", "spec", "00.index.md"), "utf8")).not.toMatch(/\|\s*Rules\s*\|/);
  }, 60000);

  it("still performs the project migration when --dry-run is absent", async () => {
    const home = await homeWithBothAgents();
    const root = await legacyProject();
    const { code, stdout } = await runUpgrade(root, home, ["--global", "--json"]);
    expect(code, stdout).toBe(0);
    expect(parse(stdout).value?.applied).toBe(true);
    expect(await readFile(path.join(root, "docs", "spec", "00.index.md"), "utf8")).toMatch(/\|\s*Rules\s*\|/);
  }, 60000);
});

describe("IR-CLI-095 AC-5/AC-6 — registry parity and continued MCP absence", () => {
  it("declares the flag in the registry so the catalogue reports it", async () => {
    const spec = findSpecByCliName("upgrade");
    expect(spec, "upgrade must be a ToolSpec registry entry").toBeDefined();
    // The registry is the parity SSOT: a flag the command ships and the registry omits is a catalogue
    // that lies about the surface, which is how `--type` on supersede stayed dead (FR-NODE-176).
    expect(spec!.options.map((option) => option.flag)).toContain("-g, --global");
    expect(toolSpecs.filter((candidate) => candidate.cliName === "upgrade")).toHaveLength(1);

    const streams = io();
    expect(await main(["--root", await legacyProject(), "commands", "--json"], streams)).toBe(0);
    const catalogue = drain(streams.stdout);
    const upgradeEntry = (JSON.parse(catalogue) as { commands?: Array<{ name?: string; options?: Array<{ flag?: string }> }> }).commands?.find(
      (entry) => entry.name === "upgrade"
    );
    expect(upgradeEntry, "upgrade is missing from the generated catalogue").toBeDefined();
    expect(upgradeEntry!.options?.map((option) => option.flag)).toContain("-g, --global");
  }, 60000);

  it("keeps upgrade off the MCP tool surface", () => {
    // The flag widens what the command writes — now into a shared home — so the reason upgrade was
    // kept CLI-only gets stronger, not weaker.
    expect(findSpecByCliName("upgrade")!.mcpName, "no MCP tool may drive a command that rewrites author files").toBeUndefined();
  });
});
