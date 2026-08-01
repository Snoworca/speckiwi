import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, describe, expect, it } from "vitest";

// @req FR-NODE-106 — the two repository registrations: `.gitignore` covers the orchestrator's
// machine state, and `vitest.config.ts`'s coverage `include` covers the orchestrator tree under the
// threshold the workflow tree already carries.
//
// 05 §4.8: `kiwi/waves.jsonl` and `kiwi/orchestrator/` are neither tracked nor ignored today.
// `git clean -fd` — this repository's own documented recovery after a hermeticity leak — deletes the
// journal and every resume card, and a `git add -A` at a dispatch-base commit stages the LIVE
// journal, so a later restore truncates it back to the commit snapshot. The tracked `.gitignore` is
// what makes the policy hold on a fresh clone or a CI runner rather than only on a checkout that
// happens to carry a local exclude — which is why the fixture below copies the TRACKED file into a
// fresh repository and measures git's real behaviour there.

const execFileAsync = promisify(execFile);
const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const roots: string[] = [];

afterAll(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
});

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd, encoding: "utf8", windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
  return stdout;
}

/**
 * A fresh repository carrying this repository's tracked `.gitignore` and both orchestrator paths on
 * disk. Nothing runs against the real working tree: `git add -A` here can never touch it.
 */
async function repoWithTrackedGitignore(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "speckiwi-gitignore-"));
  roots.push(root);
  await git(root, "init", "--initial-branch", "main");
  await git(root, "config", "user.name", "Registration Fixture");
  await git(root, "config", "user.email", "registration@example.invalid");
  await git(root, "config", "commit.gpgsign", "false");
  await copyFile(path.join(REPO_ROOT, ".gitignore"), path.join(root, ".gitignore"));
  await mkdir(path.join(root, "kiwi", "orchestrator", "2026-08-02.run"), { recursive: true });
  await writeFile(path.join(root, "kiwi", "waves.jsonl"), '{"ts":"2026-08-02T09:00:00.000Z"}\n', "utf8");
  await writeFile(path.join(root, "kiwi", "orchestrator", "2026-08-02.run", "resume-card.md"), "# card\n", "utf8");
  return root;
}

const GITIGNORE = readFileSync(path.join(REPO_ROOT, ".gitignore"), "utf8");
const VITEST_CONFIG = readFileSync(path.join(REPO_ROOT, "vitest.config.ts"), "utf8");

/** The tracked file with the two orchestrator entries removed — the probe every control below uses. */
function gitignoreWithoutOrchestratorEntries(): string {
  const stripped = GITIGNORE.split(/\r?\n/)
    .filter((line) => line.trim() !== "kiwi/waves.jsonl" && line.trim() !== "kiwi/orchestrator/")
    .join("\n");
  if (stripped === GITIGNORE) throw new Error("the probe removed no bytes; the control would prove nothing");
  return stripped;
}

describe("FR-NODE-106 AC-1 — the tracked .gitignore carries both entries", () => {
  it("is tracked, not a local exclude", async () => {
    const tracked = await git(REPO_ROOT, "ls-files", "--", ".gitignore");
    expect(tracked.trim()).toBe(".gitignore");
  });

  it("contains an entry covering kiwi/waves.jsonl", () => {
    const entries = GITIGNORE.split(/\r?\n/).map((line) => line.trim());
    expect(entries).toContain("kiwi/waves.jsonl");
  });

  it("contains an entry covering kiwi/orchestrator/", () => {
    const entries = GITIGNORE.split(/\r?\n/).map((line) => line.trim());
    expect(entries).toContain("kiwi/orchestrator/");
  });

  it("does not ignore kiwi/pipeline.jsonl, which is tracked", async () => {
    const root = await repoWithTrackedGitignore();
    await writeFile(path.join(root, "kiwi", "pipeline.jsonl"), "{}\n", "utf8");
    const status = await git(root, "status", "--porcelain", "--untracked-files=all");
    expect(status, "the entries must be path-scoped, not a blanket kiwi/ ignore").toContain("kiwi/pipeline.jsonl");
  });
});

describe("FR-NODE-106 AC-2 — git's measured behaviour under that .gitignore", () => {
  // `--untracked-files=all` is not a convenience: the default collapses a wholly untracked directory
  // to `?? kiwi/`, so a substring assertion over the default output can never match a path inside it
  // and would pass whether or not the entry existed.
  it("reports neither path as untracked in git status --porcelain -uall", async () => {
    const root = await repoWithTrackedGitignore();
    const status = await git(root, "status", "--porcelain", "--untracked-files=all");
    expect(status).not.toContain("kiwi/waves.jsonl");
    expect(status).not.toContain("kiwi/orchestrator");
  });

  it("would report both without the entries, which is what makes the assertion above load-bearing", async () => {
    const root = await repoWithTrackedGitignore();
    await writeFile(path.join(root, ".gitignore"), gitignoreWithoutOrchestratorEntries(), "utf8");
    const status = await git(root, "status", "--porcelain", "--untracked-files=all");
    expect(status).toContain("kiwi/waves.jsonl");
    expect(status).toContain("kiwi/orchestrator/2026-08-02.run/resume-card.md");
  });

  it("stages neither under git add -A", async () => {
    const root = await repoWithTrackedGitignore();
    await git(root, "add", "-A");
    const staged = (await git(root, "diff", "--cached", "--name-only")).split(/\r?\n/).filter((line) => line.length > 0);

    expect(staged, "the fixture must stage something, or this assertion is vacuous").toContain(".gitignore");
    expect(staged).not.toContain("kiwi/waves.jsonl");
    expect(staged.some((file) => file.startsWith("kiwi/orchestrator/"))).toBe(false);
  });

  it("would stage both without the entries, which is what makes the assertion above load-bearing", async () => {
    const root = await repoWithTrackedGitignore();
    await writeFile(path.join(root, ".gitignore"), gitignoreWithoutOrchestratorEntries(), "utf8");

    await git(root, "add", "-A");
    const staged = (await git(root, "diff", "--cached", "--name-only")).split(/\r?\n/).filter((line) => line.length > 0);
    expect(staged).toContain("kiwi/waves.jsonl");
    expect(staged.some((file) => file.startsWith("kiwi/orchestrator/"))).toBe(true);
  });
});

describe("FR-NODE-106 AC-3/AC-4 — the coverage registration", () => {
  it("AC-3: the coverage include covers src/core/orchestrator/**/*.ts", () => {
    const include = /include:\s*\[([\s\S]*?)\]/.exec(VITEST_CONFIG)?.[1] ?? "";
    expect(include.length, "the include block must be found, or the assertion is vacuous").toBeGreaterThan(0);
    expect(include).toContain('"src/core/orchestrator/**/*.ts"');
  });

  it("AC-4: keys it to the same parserWorkflowThreshold object the parser and workflow trees use", () => {
    const thresholds = /thresholds:\s*\{([\s\S]*?)\n {6}\}/.exec(VITEST_CONFIG)?.[1] ?? "";
    expect(thresholds.length).toBeGreaterThan(0);
    expect(thresholds).toMatch(/"src\/core\/orchestrator\/\*\*\/\*\.ts":\s*parserWorkflowThreshold/);
    expect(thresholds).toMatch(/"src\/core\/parser\/\*\*\/\*\.ts":\s*parserWorkflowThreshold/);
    expect(thresholds).toMatch(/"src\/core\/workflow\/\*\*\/\*\.ts":\s*parserWorkflowThreshold/);
  });

  it("AC-4: declares no separate threshold object for the orchestrator tree", () => {
    // A second literal would drift from the workflow one silently. Exactly one declaration site.
    const declarations = VITEST_CONFIG.match(/const\s+\w*[Tt]hreshold\s*=/g) ?? [];
    expect(declarations).toHaveLength(3);
    expect(VITEST_CONFIG).not.toMatch(/orchestratorThreshold/);
    expect(VITEST_CONFIG).not.toMatch(/"src\/core\/orchestrator\/\*\*\/\*\.ts":\s*\{/);
  });

  it("loads as a real config, so the assertions above are about a file vitest actually reads", async () => {
    const config = (await import(path.join(REPO_ROOT, "vitest.config.ts").split(path.sep).join("/"))) as {
      default: { test?: { coverage?: { include?: string[]; thresholds?: Record<string, unknown> } } };
    };
    const coverage = config.default.test?.coverage;
    expect(coverage?.include).toContain("src/core/orchestrator/**/*.ts");
    // The two keys resolve to the same object identity, not merely to equal values: that is what
    // "keyed to the same threshold object" means, and a copied literal would fail it.
    const thresholds = coverage?.thresholds as Record<string, unknown>;
    expect(thresholds["src/core/orchestrator/**/*.ts"]).toBe(thresholds["src/core/workflow/**/*.ts"]);
    expect(thresholds["src/core/orchestrator/**/*.ts"]).toBe(thresholds["src/core/parser/**/*.ts"]);
  });
});
