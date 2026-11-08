import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { initProject } from "../../src/core/bootstrap/init-project.js";
import { renderAgentInstructionSnippet } from "../../src/core/bootstrap/templates.js";
import { resolveProjectRoot } from "../../src/core/project-root.js";

// FR-NODE-263 is deferred to 5.3.8 (5.3.7 triage, 2026-11-08): these are the triage reproductions, red by design
// until the requirement is taken up. They are skipped in the default suite and run with SPECKIWI_DEFERRED=1,
// as the stress suites run with SPECKIWI_STRESS. When the requirement is implemented, turn them into its
// failing tests and delete this gate.
const DEFERRED = process.env.SPECKIWI_DEFERRED === "1";

// Triage repro for FR-NODE-263 (5.3.7). The init refresh is made to fail with a real filesystem
// error: AGENTS.md is a directory, so init's managed-block write gets EISDIR after upgrade has
// already repaired CLAUDE.md and inserted the index Rules row.

async function projectNeedingRepairs(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "v537-upgrade-rollback-"));
  await mkdir(path.join(root, ".git"), { recursive: true });
  expect((await initProject(await resolveProjectRoot(root), { installSkills: false, registerMcp: false })).ok).toBe(true);
  const indexPath = path.join(root, "docs", "spec", "00.index.md");
  const index = await readFile(indexPath, "utf8");
  await writeFile(indexPath, index.split("\n").filter((line) => !line.startsWith("| Rules |")).join("\n"), "utf8");
  const stale = "SRS-MD-Rules-v2.5.0.md";
  await writeFile(path.join(root, "CLAUDE.md"), `# Notes\n\n${renderAgentInstructionSnippet().replace(/SRS-MD-Rules-v\d+\.\d+\.\d+\.md/g, stale)}\n`, "utf8");
  return root;
}

async function snapshot(root: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  async function walk(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const relative = path.relative(root, full).replace(/\\/g, "/");
      if (relative === "kiwi" || relative === ".git" || relative === "AGENTS.md") continue;
      if (entry.isDirectory()) await walk(full);
      else files[relative] = await readFile(full, "utf8");
    }
  }
  await walk(root);
  return files;
}

function changedPaths(before: Record<string, string>, after: Record<string, string>): { changed: string[]; created: string[]; removed: string[] } {
  return {
    changed: Object.keys(after).filter((k) => k in before && before[k] !== after[k]).sort(),
    created: Object.keys(after).filter((k) => !(k in before)).sort(),
    removed: Object.keys(before).filter((k) => !(k in after)).sort()
  };
}

async function runUpgrade(root: string): Promise<{ code: number; out: string; err: string }> {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const code = await main(["--root", root, "upgrade", "--apply", "--no-skills", "--no-mcp", "--json"], { stdout, stderr });
  return { code, out: stdout.read()?.toString() ?? "", err: stderr.read()?.toString() ?? "" };
}

describe.skipIf(!DEFERRED)("FR-NODE-263 — a failed upgrade apply restores what it wrote", () => {
  it("AC-1: init refresh fails after upgrade rewrote CLAUDE.md and inserted the Rules row", async () => {
    const root = await projectNeedingRepairs();
    await rm(path.join(root, "AGENTS.md"), { force: true });
    await mkdir(path.join(root, "AGENTS.md"));
    const before = await snapshot(root);
    const run = await runUpgrade(root);
    const diff = changedPaths(before, await snapshot(root));
    // Recorded for the triage report.
    console.log("AC-1 run", JSON.stringify({ code: run.code, out: run.out.slice(0, 400), err: run.err.slice(0, 400), diff }));
    expect(run.code).not.toBe(0);
    expect(diff).toEqual({ changed: [], created: [], removed: [] });
  });

  it("AC-2: files the refresh created before failing are removed", async () => {
    const root = await projectNeedingRepairs();
    // Scaffolds and rules documents init recreates when missing.
    await rm(path.join(root, "docs", "spec", "90.appendix.md"), { force: true });
    await rm(path.join(root, "docs", "spec", "steps", "state.md"), { force: true });
    await rm(path.join(root, "docs", "rule"), { recursive: true, force: true });
    await rm(path.join(root, "AGENTS.md"), { force: true });
    await mkdir(path.join(root, "AGENTS.md"));
    const before = await snapshot(root);
    const run = await runUpgrade(root);
    const diff = changedPaths(before, await snapshot(root));
    console.log("AC-2 run", JSON.stringify({ code: run.code, diff }));
    expect(run.code).not.toBe(0);
    expect(diff.created).toEqual([]);
  });
});
