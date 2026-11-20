import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PassThrough } from "node:stream";
import { main } from "../../../src/cli/index.js";
import { createMcpServer } from "../../../src/mcp/server.js";
import { initProject } from "../../../src/core/bootstrap/init-project.js";
import { removeProject } from "../../../src/core/bootstrap/remove-project.js";
import { upgradeProject } from "../../../src/core/bootstrap/upgrade-project.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";

// @req FR-NODE-314 — speckiwi init left kiwi/.status.json, a derived cache every mutation rewrites,
// untracked in a consumer's repository, so `git add -A` staged it (reproduced 2026-11-17 with 5.5.1).

const ENTRY = "kiwi/.status.json";
const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function git(cwd: string, ...args: string[]): string {
  const env = { ...process.env };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  delete env.GIT_INDEX_FILE;
  return execFileSync("git", args, { cwd, encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] }).trim();
}

/** A fresh git repository whose root git resolves to the directory itself, holding `gitignore` when given. */
async function repository(gitignore?: string): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "speckiwi-gitignore-"));
  git(root, "init", "-q");
  expect(path.resolve(git(root, "rev-parse", "--show-toplevel"))).toBe(path.resolve(root));
  if (gitignore !== undefined) await writeFile(path.join(root, ".gitignore"), gitignore, "utf8");
  return root;
}

async function init(root: string, dryRun = false) {
  const result = await initProject(await resolveProjectRoot(root, root), { installSkills: false, registerMcp: false, dryRun });
  expect(result.ok, JSON.stringify(result.error)).toBe(true);
  return result.value!;
}

async function remove(root: string, apply: boolean) {
  const home = await mkdtemp(path.join(tmpdir(), "speckiwi-gitignore-home-"));
  const result = await removeProject(await resolveProjectRoot(root, root), { apply, globalHomeDir: home, globalCodexHome: path.join(home, ".codex") });
  expect(result.ok, JSON.stringify(result.error)).toBe(true);
  return result.value!;
}

const gitignoreOf = (root: string) => readFile(path.join(root, ".gitignore"), "utf8");
const reported = (output: { created: string[]; updated: string[] }) => [...output.created, ...output.updated].map((item) => path.basename(item));

describe("FR-NODE-314 AC-1 — init and upgrade add the entry", () => {
  // @req FR-NODE-314 AC-1
  it("init writes a marked entry, reports the file, and git then leaves the cache out", async () => {
    const root = await repository();
    const output = await init(root);
    const lines = (await gitignoreOf(root)).split("\n");
    expect(lines.at(-1)).toBe("");
    expect(lines.at(-2)).toBe(ENTRY);
    expect(lines.at(-3)).toMatch(/^#.*SpecKiwi/);
    expect(lines.length).toBe(3);
    expect(reported(output)).toContain(".gitignore");
    await mkdir(path.join(root, "kiwi"), { recursive: true });
    await writeFile(path.join(root, ENTRY), "{}", "utf8");
    expect(git(root, "status", "--porcelain", "--untracked-files=all")).not.toContain(ENTRY);
  });

  // @req FR-NODE-314 AC-1
  it("upgrade adds the entry to a project initialised before this requirement", async () => {
    const root = await repository("dist/\n");
    await init(root);
    await writeFile(path.join(root, ".gitignore"), "dist/\n", "utf8");
    const result = await upgradeProject(await resolveProjectRoot(root, root), { apply: true, installSkills: false, registerMcp: false });
    expect(result.ok, JSON.stringify(result.error)).toBe(true);
    expect((await gitignoreOf(root)).split("\n").slice(-2)).toEqual([ENTRY, ""]);
    expect((await gitignoreOf(root)).startsWith("dist/\n#")).toBe(true);
  });
});

describe("FR-NODE-314 AC-1 — the CLI and MCP surfaces", () => {
  // @req FR-NODE-314 AC-1
  it("speckiwi init and MCP init_project write the same entry", async () => {
    const viaCli = await repository("dist/\n");
    const streams = { stdout: new PassThrough(), stderr: new PassThrough() };
    expect(await main(["--root", viaCli, "init", "--target", "v0.1.0", "--scope", "App:APP", "--no-mcp", "--no-skills", "--json"], streams)).toBe(0);
    const viaMcp = await repository("dist/\n");
    const result = (await createMcpServer({ root: viaMcp }).callTool("init_project", { target: "v0.1.0", scope: "App:APP" })) as { ok: boolean };
    expect(result.ok).toBe(true);
    expect(await gitignoreOf(viaCli)).toBe(await gitignoreOf(viaMcp));
    expect((await gitignoreOf(viaCli)).split("\n").slice(-2)).toEqual([ENTRY, ""]);
  });
});

describe("FR-NODE-314 AC-2 AC-7 — a rule that already decides is left alone", () => {
  for (const existing of ["kiwi/\n", "*.json\n", `${ENTRY}\n`, "/kiwi/.status.json\n"]) {
    // @req FR-NODE-314 AC-2
    it(`leaves a .gitignore holding ${JSON.stringify(existing)} byte-identical`, async () => {
      const root = await repository(existing);
      const output = await init(root);
      expect(await gitignoreOf(root)).toBe(existing);
      expect(reported(output)).not.toContain(".gitignore");
    });
  }

  // @req FR-NODE-314 AC-2
  it("a second run leaves the file byte-identical", async () => {
    const root = await repository("dist/\n");
    await init(root);
    const once = await gitignoreOf(root);
    const output = await init(root);
    expect(await gitignoreOf(root)).toBe(once);
    expect(reported(output)).not.toContain(".gitignore");
  });

  // @req FR-NODE-314 AC-2
  it("respects a negation that re-includes the cache and says so", async () => {
    const existing = "kiwi/*\n!kiwi/.status.json\n";
    const root = await repository(existing);
    const output = await init(root);
    expect(await gitignoreOf(root)).toBe(existing);
    expect((output.warnings ?? []).join("\n")).toMatch(/!kiwi\/\.status\.json/);
  });

  // @req FR-NODE-314 AC-7
  it("SpecKiwi's own .gitignore is left byte-identical", async () => {
    const own = await readFile(path.join(REPOSITORY_ROOT, ".gitignore"), "utf8");
    const root = await repository(own);
    await init(root);
    expect(await gitignoreOf(root)).toBe(own);
  });
});

describe("FR-NODE-314 review round 1 — what the entry and the warnings say", () => {
  // @req FR-NODE-314 AC-6
  it("the marker names the command that takes the entry back", async () => {
    const root = await repository();
    await init(root);
    const marker = (await gitignoreOf(root)).split("\n")[0] ?? "";
    expect(marker).toContain("speckiwi remove ");
    expect(marker).not.toContain("remove-project");
  });

  // @req FR-NODE-314 AC-1 AC-2
  it("a rule only in .git/info/exclude is personal, so the shared .gitignore still gets the entry", async () => {
    const root = await repository("dist/\n");
    await writeFile(path.join(root, ".git", "info", "exclude"), "kiwi/\n", "utf8");
    await init(root);
    expect((await gitignoreOf(root)).split("\n").slice(-2)).toEqual([ENTRY, ""]);
  });

  // @req FR-NODE-314 AC-2
  it("a negation outside the project's .gitignore is named by its own file", async () => {
    const root = await repository("dist/\n");
    const excludes = path.join(root, ".git", "personal-excludes");
    await writeFile(excludes, "!kiwi/.status.json\n", "utf8");
    git(root, "config", "core.excludesFile", excludes.replace(/\\/g, "/"));
    const output = await init(root);
    const warning = (output.warnings ?? []).find((item) => item.includes("!kiwi/.status.json")) ?? "";
    expect(warning).toContain("personal-excludes");
    expect(warning).not.toContain("project's rule");
  });

  // @req FR-NODE-314 AC-5
  it("says git could not be run, not that the directory is no git working tree", async () => {
    const root = await repository("dist/\n");
    const saved = process.env.PATH;
    process.env.PATH = "";
    let output;
    try {
      output = await init(root);
    } finally {
      process.env.PATH = saved;
    }
    const warning = (output.warnings ?? []).find((item) => item.includes(".gitignore")) ?? "";
    expect(warning).toMatch(/git could not be run/);
    expect(warning).not.toContain("not a git working tree");
    expect(await gitignoreOf(root)).toBe("dist/\n");
  });
});

describe("FR-NODE-314 AC-3 — existing lines, line endings and the dry run", () => {
  // @req FR-NODE-314 AC-3
  it("keeps CRLF line endings", async () => {
    const root = await repository("node_modules/\r\ndist/\r\n");
    await init(root);
    const text = await gitignoreOf(root);
    expect(text.startsWith("node_modules/\r\ndist/\r\n#")).toBe(true);
    expect(text.endsWith(`\r\n${ENTRY}\r\n`)).toBe(true);
    expect(text.replace(/\r\n/g, "")).not.toContain("\n");
  });

  // @req FR-NODE-314 AC-3
  it("ends a last line that has no newline before appending", async () => {
    const root = await repository("node_modules/");
    await init(root);
    const lines = (await gitignoreOf(root)).split("\n");
    expect(lines[0]).toBe("node_modules/");
    expect(lines[1]).toMatch(/^#.*SpecKiwi/);
    expect(lines.slice(2)).toEqual([ENTRY, ""]);
  });

  // @req FR-NODE-314 AC-3
  it("a dry run reports the change and writes nothing", async () => {
    const root = await repository("dist/\n");
    const output = await init(root, true);
    expect(reported(output)).toContain(".gitignore");
    expect(await gitignoreOf(root)).toBe("dist/\n");
  });
});

describe("FR-NODE-314 AC-4 AC-5 — tracked cache and no git", () => {
  // @req FR-NODE-314 AC-4
  it("warns with the git rm --cached hint and leaves the index alone", async () => {
    const root = await repository();
    await mkdir(path.join(root, "kiwi"), { recursive: true });
    await writeFile(path.join(root, ENTRY), "{}", "utf8");
    git(root, "add", ENTRY);
    const output = await init(root);
    expect((output.warnings ?? []).join("\n")).toContain(`git rm --cached ${ENTRY}`);
    expect(git(root, "ls-files", "--", ENTRY)).toBe(ENTRY);
  });

  // @req FR-NODE-314 AC-5
  it("outside a git working tree, writes no .gitignore and says why", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "speckiwi-gitignore-nogit-"));
    expect(() => git(root, "rev-parse", "--show-toplevel")).toThrow();
    const output = await init(root);
    expect(existsSync(path.join(root, ".gitignore"))).toBe(false);
    expect((output.warnings ?? []).join("\n")).toMatch(/\.gitignore.*not a git|not a git.*\.gitignore/i);
  });
});

describe("FR-NODE-314 AC-6 — remove-project takes back only the marked entry", () => {
  // @req FR-NODE-314 AC-6
  it("restores the file byte for byte", async () => {
    for (const before of ["dist/\n", "dist/\r\n", "dist/"]) {
      const root = await repository(before);
      await init(root);
      expect(await gitignoreOf(root)).not.toBe(before);
      await remove(root, true);
      expect(await gitignoreOf(root), JSON.stringify(before)).toBe(before.endsWith("/") ? `${before}\n` : before);
    }
  });

  // @req FR-NODE-314 AC-6
  it("removes a .gitignore that held nothing else, and a plan writes nothing", async () => {
    const root = await repository();
    await init(root);
    const planned = await gitignoreOf(root);
    const plan = await remove(root, false);
    expect(plan.removed.map((item) => path.basename(item.split("#")[0] ?? ""))).toContain(".gitignore");
    expect(await gitignoreOf(root)).toBe(planned);
    await remove(root, true);
    expect(existsSync(path.join(root, ".gitignore"))).toBe(false);
  });

  // @req FR-NODE-314 AC-6
  it("a plan on a file with other lines reports the entry and writes nothing", async () => {
    const root = await repository("dist/\n");
    await init(root);
    const planned = await gitignoreOf(root);
    const plan = await remove(root, false);
    expect(plan.removed.some((item) => item.endsWith(".gitignore#speckiwi-status-cache-entry"))).toBe(true);
    expect(await gitignoreOf(root)).toBe(planned);
  });

  // @req FR-NODE-314 AC-6
  it("keeps an entry the project wrote itself", async () => {
    const root = await repository(`dist/\n${ENTRY}\n`);
    await init(root);
    await remove(root, true);
    expect(await gitignoreOf(root)).toBe(`dist/\n${ENTRY}\n`);
  });
});
