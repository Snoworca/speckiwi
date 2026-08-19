import { access, chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { initProject } from "../../../src/core/bootstrap/init-project.js";
import { removeProject } from "../../../src/core/bootstrap/remove-project.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";

// @req FR-NODE-191 — removal undoes each installed entry with the narrowest edit that undoes it.
//
// Three of the files here carry no ownership marker, because init writes them only when absent. So
// "the file exists" is not evidence speckiwi wrote it, and deleting one destroys whatever the operator
// put there. Every case below is the difference between editing an entry and deleting a file.

async function tempHome(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "speckiwi-remove-home-"));
}

async function exists(target: string): Promise<boolean> {
  return access(target).then(() => true).catch(() => false);
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

/**
 * A project as `speckiwi init` leaves it, with the hermetic seams pinned away from the real home.
 *
 * The home is carried alongside the root because every `removeProject` call needs it too: the
 * command resolves global destinations for its collision guard and its leftover probe, and a call
 * without the seam reads `HOME`/`USERPROFILE` and reports on the developer's own `~/.claude/skills`.
 */
async function initialisedProject(): Promise<{ root: string; home: string }> {
  const root = await mkdtemp(path.join(tmpdir(), "speckiwi-remove-"));
  await mkdir(path.join(root, ".git", "hooks"), { recursive: true });
  const base = path.join(root, "skills");
  await writeFixtureSkill(base, "claude", "kiwi-keep");
  await writeFixtureSkill(base, "codex", "kiwi-keep");
  const home = await tempHome();
  const result = await initProject(await resolveProjectRoot(root), {
    installSkills: true,
    registerMcp: true,
    skillSourceBaseDir: base,
    globalHomeDir: home,
    globalCodexHome: path.join(home, ".codex")
  });
  if (!result.ok) throw new Error(result.error.message);
  return { root, home };
}

type RemoveInput = Parameters<typeof removeProject>[1];

/**
 * Runs the removal with the global seams pinned to the fixture's temp home.
 *
 * Passing the home is not optional politeness. Without it these cases reach the real
 * `~/.claude/skills`, and today they stay read-only only because the leftover probe hardcodes a
 * dry run — one literal away from a suite that deletes the developer's global skills. This
 * repository has an isolation-leak incident on record; the seam is the fix, not the literal.
 */
async function runRemove(root: string, home: string, input: Omit<RemoveInput, "globalHomeDir" | "globalCodexHome"> = { apply: true }) {
  const result = await removeProject(await resolveProjectRoot(root), {
    ...input,
    globalHomeDir: home,
    globalCodexHome: path.join(home, ".codex")
  });
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

function keptPaths(value: Awaited<ReturnType<typeof runRemove>>): string[] {
  return value.kept.map((entry) => entry.path);
}

describe("FR-NODE-191 AC-1/AC-2 — the MCP registration is a key, not a file", () => {
  it("removes only the speckiwi server and leaves the rest of the file", async () => {
    const { root, home } = await initialisedProject();
    const configPath = path.join(root, ".mcp.json");
    const config = JSON.parse(await readFile(configPath, "utf8")) as Record<string, unknown>;
    const servers = config.mcpServers as Record<string, unknown>;
    servers.other = { command: "node", args: ["other.js"] };
    config.somethingElse = { keep: true };
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");

    await runRemove(root, home);

    const after = JSON.parse(await readFile(configPath, "utf8")) as Record<string, unknown>;
    expect(Object.keys(after.mcpServers as Record<string, unknown>)).toEqual(["other"]);
    expect(after.somethingElse, "an unrelated top-level key was dropped").toEqual({ keep: true });
    expect(await exists(configPath), "the file was deleted rather than edited").toBe(true);
  });

  it("leaves an unparseable configuration byte-identical and reports the refusal", async () => {
    const { root, home } = await initialisedProject();
    const configPath = path.join(root, ".mcp.json");
    const damaged = "{ this is not json";
    await writeFile(configPath, damaged, "utf8");

    const value = await runRemove(root, home);

    expect(await readFile(configPath, "utf8")).toBe(damaged);
    expect(value.kept.some((entry) => entry.path === configPath)).toBe(true);
  });

  it("keeps the file even when the speckiwi server was its only entry", async () => {
    // An empty `mcpServers` map is a valid configuration an operator may be about to fill. Deleting
    // the file assumes init created it, and init records nothing about whether it did.
    const { root, home } = await initialisedProject();
    const configPath = path.join(root, ".mcp.json");

    await runRemove(root, home);

    expect(await exists(configPath)).toBe(true);
    expect(JSON.parse(await readFile(configPath, "utf8"))).toEqual({ mcpServers: {} });
  });
});

describe("FR-NODE-191 AC-3 — the agent hook configurations are edited entry-wise", () => {
  it("removes only the speckiwi trace hook and keeps the operator's own settings", async () => {
    const { root, home } = await initialisedProject();
    const settingsPath = path.join(root, ".claude", "settings.json");
    const settings = JSON.parse(await readFile(settingsPath, "utf8")) as Record<string, unknown>;
    const hooks = settings.hooks as Record<string, unknown>;
    hooks.Stop = [{ hooks: [{ type: "command", command: "node my-own-stop-hook.js" }] }];
    settings.permissions = { allow: ["Bash(git status)"] };
    await writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");

    await runRemove(root, home);

    const after = JSON.parse(await readFile(settingsPath, "utf8")) as Record<string, unknown>;
    expect(after.permissions, "the operator's permissions block was destroyed").toEqual({ allow: ["Bash(git status)"] });
    expect((after.hooks as Record<string, unknown>).Stop, "the operator's own hook was destroyed").toBeDefined();
    expect(JSON.stringify(after), "the speckiwi trace hook survived").not.toContain("docs/.kiwi/hooks/trace.mjs");
  });

  it("keeps an operator command that shares the matcher group with ours", async () => {
    // The case the previous one does not reach: their hook sits in a DIFFERENT event, so dropping the
    // whole PostToolUse group would still leave it. Mutation testing caught exactly that — removing
    // the inner-list pruning left every other assertion green. Here their command is inside our own
    // matcher group, which is the only shape that distinguishes pruning the entry from pruning the
    // command, and it is the shape init produces the moment an operator adds a formatter.
    const { root, home } = await initialisedProject();
    const settingsPath = path.join(root, ".claude", "settings.json");
    const settings = JSON.parse(await readFile(settingsPath, "utf8")) as {
      hooks: { PostToolUse: Array<{ matcher?: string; hooks: Array<Record<string, unknown>> }> };
    };
    settings.hooks.PostToolUse[0]!.hooks.push({ type: "command", command: "node my-formatter.js" });
    await writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");

    await runRemove(root, home);

    const after = JSON.parse(await readFile(settingsPath, "utf8")) as {
      hooks?: { PostToolUse?: Array<{ matcher?: string; hooks?: Array<{ command?: string }> }> };
    };
    const group = after.hooks?.PostToolUse?.[0];
    expect(group, "the operator's command was dropped with the group it shared with ours").toBeDefined();
    expect(group!.hooks?.map((hook) => hook.command)).toEqual(["node my-formatter.js"]);
    expect(group!.matcher, "the group's matcher was rewritten").toBe("Edit|Write|MultiEdit");
  });

  it("removes the file when the speckiwi entry was all it held", async () => {
    const { root, home } = await initialisedProject();
    const settingsPath = path.join(root, ".claude", "settings.json");

    await runRemove(root, home);

    expect(await exists(settingsPath), "an empty settings file was left behind").toBe(false);
  });

  it("removes the codex trace hook the same way", async () => {
    const { root, home } = await initialisedProject();
    const hooksPath = path.join(root, ".codex", "hooks.json");
    expect(await exists(hooksPath), "the fixture did not install the codex hooks file").toBe(true);

    await runRemove(root, home);

    expect(await exists(hooksPath)).toBe(false);
  });
});

describe("FR-NODE-191 AC-4 — the git hook is removed only when it is byte-identical to what was installed", () => {
  it("removes an untouched managed hook", async () => {
    const { root, home } = await initialisedProject();
    const hookPath = path.join(root, ".git", "hooks", "pre-commit");
    expect(await exists(hookPath), "the fixture did not install the pre-commit hook").toBe(true);

    await runRemove(root, home);

    expect(await exists(hookPath)).toBe(false);
  });

  it("keeps a hook that carries the marker but was edited, and says the edit is why", async () => {
    // init skips an existing hook whenever it merely CONTAINS the runner path, so a marker-bearing
    // hook may be entirely the operator's, with the delegation line added by hand among their own.
    const { root, home } = await initialisedProject();
    const hookPath = path.join(root, ".git", "hooks", "pre-commit");
    const edited = `${await readFile(hookPath, "utf8")}npm run lint\n`;
    await writeFile(hookPath, edited, "utf8");

    const value = await runRemove(root, home);

    expect(await readFile(hookPath, "utf8")).toBe(edited);
    const kept = value.kept.find((entry) => entry.path === hookPath);
    expect(kept, "an edited hook was removed, or kept without being reported").toBeDefined();
    expect(kept!.reason).toBe("locally-modified");
  });
});

describe("FR-NODE-191 AC-5/AC-6 — the managed agent block needs both delimiters", () => {
  it("removes exactly the marked block and leaves authored prose byte-identical", async () => {
    const { root, home } = await initialisedProject();
    const claudePath = path.join(root, "CLAUDE.md");
    const managed = await readFile(claudePath, "utf8");
    const before = "# My own notes\n\nKeep every byte of this.\n";
    const after = "\n## Trailing section\n\nAnd this.\n";
    await writeFile(claudePath, `${before}\n${managed}${after}`, "utf8");

    await runRemove(root, home);

    const result = await readFile(claudePath, "utf8");
    expect(result).toContain("Keep every byte of this.");
    expect(result).toContain("And this.");
    expect(result, "the managed block survived").not.toContain("SpecKiwi SRS workflow");
  });

  it("keeps a legacy block whose end cannot be established, and reports it", async () => {
    // The legacy finder guesses the block's end as "the next top-level heading, or EOF". init replaces
    // that span, so a wrong guess is repaired on the spot; removal would delete to EOF and take the
    // operator's prose with it.
    const { root, home } = await initialisedProject();
    const agentsPath = path.join(root, "AGENTS.md");
    const legacy = "# SpecKiwi SRS workflow\n\nOld unmarked guidance.\n\nAuthored prose after it.\n";
    await writeFile(agentsPath, legacy, "utf8");

    const value = await runRemove(root, home);

    expect(await readFile(agentsPath, "utf8")).toBe(legacy);
    expect(keptPaths(value)).toContain(agentsPath);
  });

  it("removes an agent file that held nothing but the managed block", async () => {
    const { root, home } = await initialisedProject();
    const claudePath = path.join(root, "CLAUDE.md");

    await runRemove(root, home);

    expect(await exists(claudePath), "an empty agent file was left behind").toBe(false);
  });
});

describe("FR-NODE-191 — a failing step does not take the report with it", () => {
  it("still reports what it removed and what it kept when a later step throws", async () => {
    // The destructive steps run before the one that fails. Losing the report loses `kept`, which is
    // the only list telling the operator what still needs doing by hand — measured: a read-only
    // settings file aborted the run once 34 directories and the MCP key were already gone, and the
    // caller received an error envelope with neither list.
    const { root, home } = await initialisedProject();
    const settingsPath = path.join(root, ".claude", "settings.json");
    const settings = JSON.parse(await readFile(settingsPath, "utf8")) as Record<string, unknown>;
    settings.permissions = { allow: [] }; // forces the rewrite branch rather than the delete branch
    await writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
    // Readable but not writable — the shape that actually reaches the write. Putting a directory in
    // the file's place instead fails at the READ, which the code already handles without throwing, so
    // that fixture never exercised the isolation and the case passed for the wrong reason. Mutation
    // testing caught it: removing the isolation left this green.
    await chmod(settingsPath, 0o444);
    const value = await runRemove(root, home).finally(() => chmod(settingsPath, 0o644).catch(() => undefined));

    expect(value.removed.length, "the report lost the removals that had already happened").toBeGreaterThan(0);
    expect(value.kept.some((entry) => entry.path.includes(".claude")), "the failing step is not reported as kept").toBe(true);
    expect(value.complete, "a run with a failed step reported itself complete").toBe(false);
  });
});

describe("FR-NODE-191 AC-3 — an unrecognised hook shape is reported, not claimed as removed", () => {
  it("keeps the file and says so rather than rewriting it and reporting a removal", async () => {
    // `hooks` as an array is a shape the pruning does not understand, so it comes back unchanged.
    // Reporting that as a removal rewrites the file for nothing AND tells the operator the wiring is
    // gone while the hook still fires on every edit.
    const { root, home } = await initialisedProject();
    const settingsPath = path.join(root, ".claude", "settings.json");
    await writeFile(
      settingsPath,
      `${JSON.stringify({ hooks: [{ type: "command", command: "node docs/.kiwi/hooks/trace.mjs" }] }, null, 2)}\n`,
      "utf8"
    );

    const value = await runRemove(root, home);

    expect(await readFile(settingsPath, "utf8"), "the speckiwi hook was reported gone but is still there").toContain(
      "docs/.kiwi/hooks/trace.mjs"
    );
    expect(value.removed.some((entry) => entry.includes("settings.json")), "an unchanged file was reported as removed").toBe(false);
    expect(value.kept.some((entry) => entry.path === settingsPath)).toBe(true);
  });

  it("leaves an empty hook event the operator wrote", async () => {
    const { root, home } = await initialisedProject();
    const settingsPath = path.join(root, ".claude", "settings.json");
    const settings = JSON.parse(await readFile(settingsPath, "utf8")) as { hooks: Record<string, unknown> };
    settings.hooks.Empty = [];
    await writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");

    await runRemove(root, home);

    const after = JSON.parse(await readFile(settingsPath, "utf8")) as { hooks?: Record<string, unknown> };
    expect(after.hooks, "the operator's empty event was tidied away").toHaveProperty("Empty");
  });
});

describe("FR-NODE-191 AC-5 — every managed block goes, not just the first", () => {
  it("removes a duplicated managed block", async () => {
    // A file left holding a second copy still instructs agents to follow the workflow of a tool that
    // has just been removed, while the run reports success.
    const { root, home } = await initialisedProject();
    const claudePath = path.join(root, "CLAUDE.md");
    const managed = await readFile(claudePath, "utf8");
    await writeFile(claudePath, `# Notes\n\nKeep this.\n\n${managed}\n${managed}`, "utf8");

    await runRemove(root, home);

    const after = await readFile(claudePath, "utf8");
    expect(after, "a second managed block survived").not.toContain("SpecKiwi SRS workflow");
    expect(after).toContain("Keep this.");
  });
});

describe("FR-NODE-191 AC-7/AC-8 — requirements, rules, and trace output are never removed", () => {
  it("leaves all three byte-identical and names each as deliberately kept", async () => {
    const { root, home } = await initialisedProject();
    await mkdir(path.join(root, "docs", ".kiwi", "trace"), { recursive: true });
    await writeFile(path.join(root, "docs", ".kiwi", "trace", "run.jsonl"), '{"event":"edit"}\n', "utf8");
    const before = await snapshot(root, ["docs/spec", "docs/rule", "docs/.kiwi/trace"]);

    const value = await runRemove(root, home);

    expect(await snapshot(root, ["docs/spec", "docs/rule", "docs/.kiwi/trace"])).toEqual(before);
    const excludedPaths = value.excluded.map((entry) => entry.path);
    for (const location of ["docs/spec", "docs/rule", "docs/.kiwi/trace"]) {
      expect(excludedPaths.some((entry) => entry.replace(/\\/g, "/").includes(location)), `${location} is not reported as kept`).toBe(true);
    }
    // Naming the path without the policy leaves a reader unable to tell a refusal from an oversight.
    for (const entry of value.excluded) expect(entry.reason, `${entry.path} is reported with no reason`).toBeTruthy();
  });

  it("has no code path that deletes under docs/spec, whatever arguments are passed", async () => {
    // A flag that deletes requirements will eventually be recommended by a document or an agent —
    // which is how `init --force` came to be run against a real project. The exclusion has to be a
    // property of the code, not of the default argument values.
    const source = await readFile(fileURLToPath(new URL("../../../src/core/bootstrap/remove-project.ts", import.meta.url)), "utf8");
    expect(source, "the removal module names a flag that would open the requirements").not.toMatch(
      /includeSpec|removeSpec|deleteSpec|includeRequirements|purge/i
    );
    // Names alone are the weaker half: a module that called `rm` on the requirements directory
    // under no flag at all would satisfy the check above. What AC-8 asks is that no deletion
    // targets that path, so look at the deletions themselves.
    for (const deletion of source.match(/\brm\([^)]*\)/g) ?? []) {
      expect(deletion, "a deletion targets the requirements directory").not.toMatch(/spec/);
    }
  });
});

/** File contents under the given project-relative directories, for byte-comparison across a run. */
async function snapshot(root: string, relativeDirs: readonly string[]): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  for (const relative of relativeDirs) {
    const dir = path.join(root, ...relative.split("/"));
    await walk(dir);
    async function walk(current: string): Promise<void> {
      for (const entry of await readdir(current, { withFileTypes: true }).catch(() => [])) {
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) await walk(full);
        else if (entry.isFile()) files.set(path.relative(root, full).replace(/\\/g, "/"), await readFile(full, "utf8"));
      }
    }
  }
  return files;
}
