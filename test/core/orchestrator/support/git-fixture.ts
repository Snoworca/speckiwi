import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const roots: string[] = [];

/**
 * Every fixture git call passes an explicit `cwd`, for the same reason the harvested code must:
 * `06` §5.1 Defect B reproduced a guard whose verdict depended only on the calling process's
 * working directory.
 */
export async function rawGit(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024
  });
  return stdout.trim();
}

export async function rawGitStdin(cwd: string, args: readonly string[], input: string): Promise<string> {
  const child = execFileAsync("git", [...args], { cwd, encoding: "utf8", windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  child.child.stdin?.end(input, "utf8");
  const { stdout } = await child;
  return stdout.trim();
}

/** A temp directory registered for `cleanupFixtures()`. Never inside the repository working tree. */
export async function tempDir(prefix: string): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), `speckiwi-${prefix}-`));
  roots.push(root);
  return root;
}

/**
 * A committed one-commit repository. `core.autocrlf` is deliberately *not* pinned locally: under
 * FR-NODE-104 the suite runs beneath a global gitconfig that sets `core.autocrlf=true`, and a local
 * override would make that run prove nothing.
 */
export async function initRepo(prefix: string): Promise<string> {
  const root = await tempDir(prefix);
  await rawGit(root, "init", "--initial-branch", "main");
  await rawGit(root, "config", "user.name", "Harvest Fixture");
  await rawGit(root, "config", "user.email", "harvest@example.invalid");
  await rawGit(root, "config", "commit.gpgsign", "false");
  return root;
}

export async function commitAll(root: string, message: string): Promise<string> {
  await rawGit(root, "add", "--", ".");
  await rawGit(root, "commit", "-m", message);
  return rawGit(root, "rev-parse", "HEAD");
}

export async function cleanupFixtures(): Promise<void> {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 5 })));
}
