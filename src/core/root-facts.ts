import { execFile } from "node:child_process";
import { realpathSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

// Facts about a root that only the filesystem can answer, kept in one place so the pure comparison
// modules stay free of I/O and so the two callers that need them cannot drift apart.
//
// @req FR-NODE-178, FR-NODE-179, FR-NODE-180

const execFileAsync = promisify(execFile);

/** How long git is given to answer before the question is abandoned. */
const GIT_TIMEOUT_MS = 10_000;

/**
 * git could not be consulted — absent, refusing, or failing for a reason other than the path naming
 * no repository. Distinguished from `undefined` because the two demand opposite reports: one says
 * the argument is wrong, the other says the tool could not look.
 */
export class GitUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "GitUnavailableError";
  }
}

export interface GitAnswer {
  /** The exit status; `null` when git could not be started or was killed. */
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Runs one git command in `root`. A non-zero exit is an answer, not a failure — `merge-base
 * --is-ancestor` reports its verdict that way — so nothing here throws. `env` replaces the inherited
 * environment for this one call; callers that pass none get the process environment, as always.
 */
export function git(root: string, args: readonly string[], env?: NodeJS.ProcessEnv): Promise<GitAnswer> {
  return new Promise((resolve) => {
    execFile(
      "git",
      ["-C", root, ...args],
      { encoding: "utf8", windowsHide: true, maxBuffer: 64 * 1024 * 1024, timeout: GIT_TIMEOUT_MS, ...(env ? { env } : {}) },
      (error, stdout, stderr) => {
        const code = error === null ? 0 : typeof error.code === "number" ? error.code : null;
        resolve({ code, stdout, stderr });
      }
    );
  });
}

/**
 * The variables by which an environment points git at a repository other than the one `-C` finds.
 * Git exports GIT_DIR while running hooks, and these outrank discovery. @req FR-NODE-227
 */
const REPOSITORY_LOCATING_VARIABLES = ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR", "GIT_OBJECT_DIRECTORY"] as const;

function environmentWithoutRepositoryLocation(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const name of REPOSITORY_LOCATING_VARIABLES) delete env[name];
  return env;
}

/**
 * The files git tracks at or under `paths` (absolute, inside `root`), relative to `root`. Empty when
 * `root` is in no repository, since nothing is tracked there. @req FR-NODE-224 AC-5
 *
 * @req FR-NODE-227 — the question is about `root`'s repository, so an inherited GIT_DIR must not answer it.
 */
export async function gitTrackedPaths(root: string, paths: readonly string[]): Promise<string[]> {
  if (paths.length === 0) return [];
  const answer = await git(root, ["ls-files", "-z", "--", ...paths.map((entry) => path.relative(root, entry))], environmentWithoutRepositoryLocation());
  if (answer.code !== 0) return [];
  return answer.stdout.split("\0").filter((entry) => entry.length > 0);
}

/**
 * The realpath resolver the run-root comparison takes injected. A path that cannot be resolved is
 * returned unchanged, so the two roots are then compared as written — which is what the caller meant.
 */
export function realpathProbe(target: string): string {
  try {
    return realpathSync(target);
  } catch {
    return target;
  }
}

/**
 * The top level of the repository containing `target`, or `undefined` when it contains none.
 *
 * `-C target` rather than a working directory, because the question is about the path the caller
 * named: answering it from wherever the process happens to run is the substitution the run-root
 * gates exist to prevent. `GIT_DIR` and its relatives are cleared for the same reason — they would
 * let an ambient environment variable answer a question asked about a path.
 *
 * Only "no repository contains this path" yields `undefined`. Every other failure — git absent, a
 * dangling gitdir pointer, dubious ownership, a directory that is not there, a permission refusal, a
 * bare repository with no work tree — throws {@link GitUnavailableError}, because reporting those as
 * "this path names no repository" tells the caller their argument is wrong when the truth is that
 * nothing could be determined.
 */
export async function gitToplevelOf(target: string): Promise<string | undefined> {
  const env = scrubbedEnvironment();

  let stdout: string;
  try {
    ({ stdout } = await execFileAsync("git", ["-C", target, "rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: 1024 * 1024,
      timeout: GIT_TIMEOUT_MS,
      env
    }));
  } catch (error) {
    const failure = classify(target, error);
    // `undefined` is the one verdict a failure can carry that is not a failure: no repository here.
    if (failure === undefined) return undefined;
    throw failure;
  }
  const reported = stdout.trim();
  if (reported.length > 0) return reported;
  // git exited 0 and named nothing. No release is known to do this; treating it as "could not
  // determine" keeps the two honest answers apart rather than inventing a third meaning for silence.
  throw new GitUnavailableError(`git reported no top level for ${target} and gave no reason`);
}

/**
 * The git common directory `target` resolves to, or `undefined` when it names no repository.
 *
 * This is the discriminator the topology gate rests on: every linked worktree of one repository
 * reports the SAME common directory while reporting a different top level, and neither value comes
 * from the caller being checked. `--path-format=absolute` because a relative answer would be relative
 * to a working directory the comparison does not share. @req IR-CLI-093
 */
export async function gitCommonDirOf(target: string): Promise<string | undefined> {
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync(
      "git",
      ["-C", target, "rev-parse", "--path-format=absolute", "--git-common-dir"],
      { encoding: "utf8", windowsHide: true, maxBuffer: 1024 * 1024, timeout: GIT_TIMEOUT_MS, env: scrubbedEnvironment() }
    ));
  } catch (error) {
    const failure = classify(target, error);
    if (failure === undefined) return undefined;
    throw failure;
  }
  const reported = stdout.trim();
  return reported.length > 0 ? reported : undefined;
}

/**
 * The worktrees `commonDir` registers, main checkout first, as `git worktree list --porcelain` gives
 * them. Registration is what separates a real linked worktree from a directory carrying a
 * hand-written `.git` file. @req IR-CLI-093
 */
export async function registeredWorktreesOf(commonDir: string): Promise<string[]> {
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync("git", ["--git-dir", commonDir, "worktree", "list", "--porcelain"], {
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
      timeout: GIT_TIMEOUT_MS,
      env: scrubbedEnvironment()
    }));
  } catch (error) {
    const failure = classify(commonDir, error);
    if (failure === undefined) return [];
    throw failure;
  }
  return stdout
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length).trim())
    .filter((entry) => entry.length > 0);
}

/**
 * `process.env` with every root-steering variable removed and the locale pinned.
 *
 * Removed case-insensitively: Windows matches environment names without regard to case for the child
 * process, while a copy of `process.env` keeps whatever spelling they were set with. Deleting only
 * `GIT_WORK_TREE` therefore leaves a `git_work_tree` in place, and an ambient variable then answers a
 * question that was asked about a path — which is the whole forgery these gates exist to refuse.
 *
 * `LC_ALL` is pinned because the verdict below is decided by matching git's own sentence: under a
 * translated message catalogue that match stops working and every no-repository path starts throwing.
 */
function scrubbedEnvironment(): NodeJS.ProcessEnv {
  const steering = new Set(["git_dir", "git_work_tree", "git_common_dir", "git_ceiling_directories"]);
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!steering.has(key.toLowerCase())) env[key] = value;
  }
  return { ...env, LC_ALL: "C", LANG: "C" };
}

/**
 * Reads a git failure as either "nothing here is a repository" or "git could not look".
 *
 * Anchored on the parenthetical, because git says `not a git repository (or any of the parent
 * directories): .git` for the first and `not a git repository: <path>` for a `.git` file pointing at
 * a gitdir that is not there — a stale worktree checkout. The second is a broken repository, not the
 * absence of one, and reading them as the same answer reports a broken checkout as a clean layout.
 */
function classify(target: string, error: unknown): GitUnavailableError | undefined {
  const failure = error as { stderr?: string; killed?: boolean; signal?: string; message?: string };
  const detail = `${failure.stderr ?? ""}`.trim() || `${failure.message ?? ""}`.trim();
  if (failure.killed === true || typeof failure.signal === "string") {
    return new GitUnavailableError(
      `git did not answer for ${target} within ${GIT_TIMEOUT_MS}ms (signal ${failure.signal ?? "none"})`,
      { cause: error }
    );
  }
  if (/not a git repository \(or any of the parent directories\)/i.test(detail)) return undefined;
  return new GitUnavailableError(`git could not report a top level for ${target}: ${detail}`, { cause: error });
}
