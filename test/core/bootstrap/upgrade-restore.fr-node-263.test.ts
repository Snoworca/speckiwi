// @req FR-NODE-263
//
// A failed `speckiwi upgrade --apply` puts back every file the run wrote, created or removed. The
// failures are real filesystem errors, no mock: AGENTS.md made a directory fails init's managed-block
// read after upgrade has already repaired CLAUDE.md and inserted the index Rules row (the 5.3.7 triage
// reproduction), and `.claude` made a regular file fails the hook step's mkdir after the refresh has
// created the rules documents, the scaffolds and the git hook and pruned a stale rules document
// (research note v539 §3.1). Only AC-3 injects a fault, into the restore itself.
import { existsSync, symlinkSync } from "node:fs";
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import type * as FsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { main } from "../../../src/cli/index.js";
import { initProject } from "../../../src/core/bootstrap/init-project.js";
import { renderAgentInstructionSnippet } from "../../../src/core/bootstrap/templates.js";
import { upgradeProject } from "../../../src/core/bootstrap/upgrade-project.js";
import { PlansRestoreError } from "../../../src/core/patch/file-transaction.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";

/** Paths whose direct writeFile fails: the transaction's restore writes a file in place, a normal write goes through a temporary file. */
const fault = vi.hoisted(() => ({ failWriteOf: new Set<string>() }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>();
  return {
    ...actual,
    writeFile: async (...args: Parameters<typeof actual.writeFile>) => {
      if (typeof args[0] === "string" && fault.failWriteOf.has(path.resolve(args[0]))) {
        throw Object.assign(new Error(`injected restore failure: ${args[0]}`), { code: "EIO", syscall: "write" });
      }
      return actual.writeFile(...args);
    }
  };
});

const STALE_RULES = "SRS-MD-Rules-v2.5.0.md";
const roots: string[] = [];

afterEach(async () => {
  fault.failWriteOf.clear();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

/** Symbolic links need a privilege Windows grants only to administrators or developer mode, so AC-4 probes for it. */
const canSymlink = (() => {
  const probe = path.join(os.tmpdir(), `speckiwi-symlink-probe-${process.pid}-${Date.now()}`);
  try {
    symlinkSync("target.md", probe);
    return true;
  } catch {
    return false;
  } finally {
    void rm(probe, { force: true });
  }
})();

/** An initialised project whose CLAUDE.md cites a pruned rules document and whose index has no Rules row. */
async function projectNeedingRepairs(): Promise<string> {
  const created = await mkdtemp(path.join(os.tmpdir(), "speckiwi-fr-node-263-"));
  roots.push(created);
  // `.git` first: without it the root search climbs past the temporary directory to whatever ancestor
  // holds a `.git` or an index, and every write below would land there.
  await mkdir(path.join(created, ".git"), { recursive: true });
  const root = (await resolveProjectRoot(created)).root;
  expect(path.basename(root)).toBe(path.basename(created));
  expect((await initProject(await resolveProjectRoot(root), { installSkills: false, registerMcp: false })).ok).toBe(true);
  const indexPath = path.join(root, "docs", "spec", "00.index.md");
  const index = await readFile(indexPath, "utf8");
  await writeFile(indexPath, index.split("\n").filter((line) => !line.startsWith("| Rules |")).join("\n"), "utf8");
  await writeFile(path.join(root, "CLAUDE.md"), staleAgentText(), "utf8");
  return root;
}

function staleAgentText(): string {
  return `# Notes\n\n${renderAgentInstructionSnippet().replace(/SRS-MD-Rules-v\d+\.\d+\.\d+\.md/g, STALE_RULES)}\n`;
}

/**
 * Every file under the root as bytes, except git's own directory and `kiwi/`: the SRS lock and the status
 * cache rebuilt from the documents on every locked call (FR-NODE-273, FR-NODE-280) are the lock's
 * bookkeeping, not files the upgrade writes. Hooks under `.git` are checked by name.
 */
async function snapshot(root: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  async function walk(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const relative = path.relative(root, full).replace(/\\/g, "/");
      if (relative === ".git" || relative === "kiwi") continue;
      if (entry.isDirectory()) await walk(full);
      else files[relative] = (await readFile(full)).toString("base64");
    }
  }
  await walk(root);
  return files;
}

function diff(before: Record<string, string>, after: Record<string, string>): { changed: string[]; created: string[]; removed: string[] } {
  return {
    changed: Object.keys(after).filter((key) => key in before && before[key] !== after[key]).sort(),
    created: Object.keys(after).filter((key) => !(key in before)).sort(),
    removed: Object.keys(before).filter((key) => !(key in after)).sort()
  };
}

async function runUpgrade(root: string): Promise<number> {
  return main(["--root", root, "upgrade", "--apply", "--no-skills", "--no-mcp", "--json"], { stdout: new PassThrough(), stderr: new PassThrough() });
}

/** Makes AGENTS.md a directory: init's managed-block read fails with EISDIR after upgrade's own writes. */
async function failAtAgentsFile(root: string): Promise<void> {
  await rm(path.join(root, "AGENTS.md"), { force: true });
  await mkdir(path.join(root, "AGENTS.md"));
}

/** Makes `.claude` a regular file: the hook step's mkdir fails after the refresh has written everything before it. */
async function failAtClaudeSettings(root: string): Promise<void> {
  await rm(path.join(root, ".claude"), { recursive: true, force: true });
  await writeFile(path.join(root, ".claude"), "not a directory\n", "utf8");
}

describe("FR-NODE-263 — a failed upgrade apply restores what it wrote", () => {
  // @req FR-NODE-263 AC-1
  it("AC-1: leaves the repaired agent file and the index byte-identical when the refresh fails, and exits non-zero", async () => {
    const root = await projectNeedingRepairs();
    // The run does write both files before it fails: the plan reports those writes.
    const plan = await upgradeProject(await resolveProjectRoot(root), { installSkills: false, registerMcp: false });
    expect(plan.value?.references.filter((finding) => finding.action === "repair").map((finding) => finding.filePath)).toContain("CLAUDE.md");
    expect(plan.value?.rulesRowInsertion).toBeDefined();
    await failAtAgentsFile(root);

    const before = await snapshot(root);
    const code = await runUpgrade(root);

    expect(code).not.toBe(0);
    expect(diff(before, await snapshot(root))).toEqual({ changed: [], created: [], removed: [] });
  });

  // @req FR-NODE-263 AC-2
  it("AC-2: removes the files the refresh created and writes back the stale rules document it pruned", async () => {
    const root = await projectNeedingRepairs();
    await rm(path.join(root, "docs", "spec", "90.appendix.md"), { force: true });
    await rm(path.join(root, "docs", "spec", "steps", "state.md"), { force: true });
    await rm(path.join(root, "docs", "rule"), { recursive: true, force: true });
    await mkdir(path.join(root, "docs", "rule"), { recursive: true });
    await writeFile(path.join(root, "docs", "rule", STALE_RULES), "# stale rules\n", "utf8");
    await rm(path.join(root, ".git", "hooks"), { recursive: true, force: true });
    await failAtClaudeSettings(root);
    const hookPath = path.join(root, ".git", "hooks", "pre-commit");

    const before = await snapshot(root);
    const code = await runUpgrade(root);

    expect(code).not.toBe(0);
    expect(diff(before, await snapshot(root))).toEqual({ changed: [], created: [], removed: [] });
    expect(existsSync(hookPath)).toBe(false);
    expect(await readFile(path.join(root, "docs", "rule", STALE_RULES), "utf8")).toBe("# stale rules\n");
    // Without the failure the same run creates the hook, so its absence above is the restore's doing.
    await rm(path.join(root, ".claude"), { force: true });
    expect(await runUpgrade(root)).toBe(0);
    expect(existsSync(hookPath)).toBe(true);
  });

  // @req FR-NODE-263 AC-3
  it("AC-3: lists every path whose restore failed in a PlansRestoreError", async () => {
    const root = await projectNeedingRepairs();
    await failAtAgentsFile(root);
    const claudePath = path.join(root, "CLAUDE.md");
    const indexPath = path.join(root, "docs", "spec", "00.index.md");
    fault.failWriteOf.add(path.resolve(claudePath));
    fault.failWriteOf.add(path.resolve(indexPath));

    const outcome = upgradeProject(await resolveProjectRoot(root), { apply: true, installSkills: false, registerMcp: false });

    const error = await outcome.then(
      () => undefined,
      (rejection: unknown) => rejection
    );
    expect(error).toBeInstanceOf(PlansRestoreError);
    const unrestored = (error as PlansRestoreError).unrestored.map((filePath) => path.relative(root, filePath).replace(/\\/g, "/")).sort();
    expect(unrestored).toEqual(["CLAUDE.md", "docs/spec/00.index.md"]);
  });

  // @req FR-NODE-263 AC-4
  // Both directions: the managed files are written AGENTS.md first, and the agent-file scan reads one
  // file per real path, so with CLAUDE.md -> AGENTS.md only the pointed-at file is ever named; with
  // AGENTS.md -> CLAUDE.md the link itself is the path written.
  it.skipIf(!canSymlink).each([
    { link: "CLAUDE.md", target: "AGENTS.md" },
    { link: "AGENTS.md", target: "CLAUDE.md" }
  ])("AC-4: writes through $link -> $target and keeps the link, after a failed run and after a successful one", async ({ link, target }) => {
    const root = await projectNeedingRepairs();
    const linkPath = path.join(root, link);
    const targetPath = path.join(root, target);
    await writeFile(targetPath, staleAgentText(), "utf8");
    await rm(linkPath, { force: true });
    symlinkSync(target, linkPath);

    await failAtClaudeSettings(root);
    const original = await readFile(targetPath);
    expect(await runUpgrade(root)).not.toBe(0);
    expect((await lstat(linkPath)).isSymbolicLink()).toBe(true);
    expect((await readFile(targetPath)).equals(original)).toBe(true);

    await rm(path.join(root, ".claude"), { force: true });
    expect(await runUpgrade(root)).toBe(0);
    expect((await lstat(linkPath)).isSymbolicLink()).toBe(true);
    const refreshed = await readFile(targetPath, "utf8");
    expect(refreshed).not.toContain(STALE_RULES);
    expect(refreshed).toContain(renderAgentInstructionSnippet().trimEnd());
  });
});
