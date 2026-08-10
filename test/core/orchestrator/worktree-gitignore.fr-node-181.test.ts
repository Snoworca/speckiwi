import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

// @req FR-NODE-181 — the third tracked `.gitignore` entry, deferred from FR-NODE-106 because phase 1
// creates no worktree to ignore. A Profile A lane runs inside `.claude/worktrees/<id>/`, which the
// agent runtime creates in the working tree; without a tracked entry the first `git add -A` a user
// runs stages a whole second checkout.
//
// The requirement's whole differentia is TRACKED versus local-and-unshared, so every check below is
// built to fail if the coverage came from anywhere else: the seeded repository gets the tracked file
// and nothing else, its `.git/info/exclude` is asserted empty of any worktree rule, and its
// `core.excludesFile` is pinned to nothing so a global ignore on the running machine cannot stand in.

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const roots: string[] = [];

afterAll(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

function git(root: string, ...args: string[]): string {
  return execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    // stderr piped rather than inherited: git's init hints stay out of the suite output, and a real
    // failure still carries its message on the thrown error.
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
}

/** The tracked `.gitignore`, read once. */
async function trackedGitignore(): Promise<string> {
  return readFile(path.join(REPO_ROOT, ".gitignore"), "utf8");
}

/** The tracked file with this requirement's entry removed — the probe AC-4's control uses. */
function withoutWorktreeEntry(text: string): string {
  const stripped = text
    .split(/\r?\n/)
    .filter((line) => !line.trim().endsWith(".claude/worktrees/") || line.trim().startsWith("#"))
    .join("\n");
  if (stripped === text) {
    throw new Error("the probe removed no bytes; the control would prove nothing");
  }
  return stripped;
}

/**
 * A repository carrying `gitignoreText` and one tracked seed file, and carrying no exclusion of its
 * own. Then: a lane checkout at the root, a lane checkout nested one level down, and a control file.
 */
async function seedRepo(gitignoreText: string): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "speckiwi-wt-ignore-"));
  roots.push(root);
  git(root, "init", "--quiet");
  // No global ignore may stand in for the tracked entry. Local config wins over --global and
  // --system, so this holds whatever the running machine or CI image is configured with.
  git(root, "config", "core.excludesFile", "");
  git(root, "config", "commit.gpgsign", "false");

  await writeFile(path.join(root, ".gitignore"), gitignoreText, "utf8");
  await writeFile(path.join(root, "seed.md"), "seed\n", "utf8");
  git(root, "add", ".gitignore", "seed.md");
  git(root, "-c", "user.email=test@example.invalid", "-c", "user.name=test", "commit", "--quiet", "-m", "seed");

  for (const prefix of ["", "sub"]) {
    const dir = path.join(root, prefix, ".claude", "worktrees", "agent-abc123");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "checkout.txt"), "lane\n", "utf8");
  }
  // A control file that IS expected to show up. Without it, a `.gitignore` that ignored the whole
  // tree would satisfy every assertion below while ignoring the user's source as well.
  await writeFile(path.join(root, "control.md"), "control\n", "utf8");
  return root;
}

describe("FR-NODE-181 — tracked gitignore coverage of the agent-runtime worktree directory", () => {
  // AC-1, first half: the file the entry lives in must be tracked. This is the requirement's entire
  // differentia, so it is asserted rather than assumed.
  it("keeps the coverage in a tracked file", () => {
    expect(git(REPO_ROOT, "ls-files", "--", ".gitignore").trim()).toBe(".gitignore");
  });

  // AC-1, second half: an entry of its own, not text that happens to sit inside a comment.
  it("carries the worktree entry as its own line", async () => {
    const entries = (await trackedGitignore())
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"));
    expect(entries, ".gitignore must ignore the agent-runtime worktree directory").toContain(
      "**/.claude/worktrees/"
    );
  });

  // AC-2 + AC-3: the behaviour, in a repository seeded with the tracked file and nothing else.
  it("leaves lane checkouts untracked and unstageable at any depth", async () => {
    const root = await seedRepo(await trackedGitignore());

    // AC-3's precondition, asserted rather than assumed: `git init` writes a comment-only exclude and
    // nothing here adds to it, so the coverage below cannot be coming from a local unshared rule.
    const exclude = await readFile(path.join(root, ".git", "info", "exclude"), "utf8").catch(() => "");
    expect(exclude, "the seeded repository must carry no worktree exclusion of its own").not.toMatch(
      /worktrees/
    );

    // `--untracked-files=all` descends into untracked directories, so an unignored checkout is
    // reported by full path rather than collapsed to one directory line.
    const status = git(root, "status", "--porcelain", "--untracked-files=all");
    expect(status, "the control file must be reported, or the check proves nothing").toMatch(
      /control\.md/
    );
    expect(status, "no lane checkout may be reported as untracked").not.toMatch(/worktrees/);

    git(root, "add", "-A");
    const staged = git(root, "diff", "--cached", "--name-only");
    expect(staged, "the control file must stage, or the check proves nothing").toMatch(/control\.md/);
    expect(staged, "git add -A must never stage a lane checkout").not.toMatch(/worktrees/);
  });

  // AC-4: the negative control that makes the case above load-bearing. Without it the assertions
  // would keep passing if a future fixture change stopped creating the checkouts at all.
  it("would report and stage those checkouts without the entry", async () => {
    const root = await seedRepo(withoutWorktreeEntry(await trackedGitignore()));

    const status = git(root, "status", "--porcelain", "--untracked-files=all");
    expect(status, "the root lane checkout must be reported without the entry").toMatch(
      /\.claude\/worktrees\/agent-abc123\/checkout\.txt/
    );
    expect(status, "the nested lane checkout must be reported without the entry").toMatch(
      /sub\/\.claude\/worktrees\/agent-abc123\/checkout\.txt/
    );

    git(root, "add", "-A");
    const staged = git(root, "diff", "--cached", "--name-only");
    expect(staged, "git add -A must stage the root lane checkout without the entry").toMatch(
      /\.claude\/worktrees\/agent-abc123\/checkout\.txt/
    );
    expect(staged, "git add -A must stage the nested lane checkout without the entry").toMatch(
      /sub\/\.claude\/worktrees\/agent-abc123\/checkout\.txt/
    );
  });
});
