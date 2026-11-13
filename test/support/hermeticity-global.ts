import { type Dirent, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  auditRepoAgainstBaseline,
  cleanupAddedPaths,
  GUARD_JOURNAL_DIR_NAME,
  loadBaseline,
  snapshotSentinels
} from "./repo-hermeticity.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Where the baseline is handed to worker processes. Read by {@link loadBaseline}. */
export const BASELINE_ENV_VAR = "SPECKIWI_HERMETICITY_BASELINE";

/** Where the run's temporary root is handed to workers and to nested runs. @req REL-NODE-012 */
export const RUN_TEMP_ROOT_ENV = "SPECKIWI_TEST_RUN_ROOT";

/** The run's temporary root, and whether this run made it and so removes it. */
export interface RunTempRoot {
  readonly root: string;
  readonly owned: boolean;
}

export interface CloseRunTempRootOptions {
  readonly remove?: (target: string, options: { recursive: true; force: true; maxRetries: number; retryDelay: number }) => void;
  readonly warn?: (message: string) => void;
}

function isInside(child: string, parent: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/**
 * Gives the run one temporary root and points TEMP, TMP and TMPDIR at it, so every worker, every
 * helper and every process a worker starts creates its temporary directories under it without any
 * of them changing. @req REL-NODE-012 AC-3
 *
 * A nested run (a test that starts vitest) whose temporary directory already lies inside an outer
 * run's root uses that root: the outer run removes it, and the nested run's residue stays visible to
 * the test that started it.
 */
export function openRunTempRoot(): RunTempRoot {
  const inherited = process.env[RUN_TEMP_ROOT_ENV];
  if (inherited !== undefined && inherited !== "" && isInside(tmpdir(), inherited)) return { root: inherited, owned: false };
  const root = mkdtempSync(path.join(tmpdir(), "speckiwi-test-run-"));
  process.env.TEMP = root;
  process.env.TMP = root;
  process.env.TMPDIR = root;
  process.env[RUN_TEMP_ROOT_ENV] = root;
  return { root, owned: true };
}

/** What a failed removal left: entries it could list, and directories it could not. */
function countLeft(root: string): { entries: number; unreadable: number } {
  let entries = 0;
  let unreadable = 0;
  const pending = [root];
  for (let directory = pending.pop(); directory !== undefined; directory = pending.pop()) {
    let children: Dirent[];
    try {
      children = readdirSync(directory, { withFileTypes: true });
    } catch {
      unreadable += 1;
      continue;
    }
    for (const child of children) {
      entries += 1;
      if (child.isDirectory()) pending.push(path.join(directory, child.name));
    }
  }
  return { entries, unreadable };
}

/**
 * Removes the run's root and nothing outside it. A removal that still fails after the retries (a
 * handle a straggling child holds open) is a warning with the path and what is left, never a failed
 * run: the tests have already passed or failed on their own. @req REL-NODE-012 AC-4
 */
export function closeRunTempRoot(run: RunTempRoot, options: CloseRunTempRootOptions = {}): void {
  if (!run.owned) return;
  const remove = options.remove ?? rmSync;
  const warn = options.warn ?? ((message: string) => console.warn(message));
  try {
    remove(run.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  } catch (error) {
    const left = countLeft(run.root);
    const code = (error as NodeJS.ErrnoException).code ?? String(error);
    const unreadable = left.unreadable > 0 ? `, ${left.unreadable} not readable` : "";
    warn(`Could not remove the test run's temporary root ${run.root}: ${left.entries} entries left${unreadable} (${code}).`);
  }
}

let run: RunTempRoot | undefined;
let baselineFile: string | undefined;

/**
 * Captures what the working tree looks like BEFORE any test runs, and hands the snapshot
 * to the workers through the environment. Without this the guard cannot tell a test's leak
 * apart from the developer's own `speckiwi init` output, and deletes both. @req FR-NODE-184
 *
 * Written outside the repository so the guard's own bookkeeping can never be pollution.
 */
export function setup(): void {
  // The journal stays directly under the OS temporary directory (FR-NODE-208 AC-3), so its path is
  // read before the run root moves TEMP.
  const journal = path.join(tmpdir(), GUARD_JOURNAL_DIR_NAME);
  mkdirSync(journal, { recursive: true });
  const file = path.join(journal, `baseline-${process.pid}.json`);
  writeFileSync(file, JSON.stringify(snapshotSentinels(REPO_ROOT)), "utf8");
  process.env[BASELINE_ENV_VAR] = file;
  baselineFile = file;
  run = openRunTempRoot();
}

/**
 * Backstop for the per-test guard: catches pollution that lands OUTSIDE any test's
 * afterEach window — an unawaited child process that writes after the suite, or a
 * globalSetup/afterAll leak. Runs once in the main process after the whole suite.
 */
export function teardown(): void {
  try {
    auditRepository();
  } finally {
    // Independent steps: neither one's failure skips the other.
    try {
      if (baselineFile !== undefined) rmSync(baselineFile, { force: true, maxRetries: 10, retryDelay: 100 });
    } finally {
      if (run !== undefined) closeRunTempRoot(run);
    }
  }
}

function auditRepository(): void {
  const baseline = loadBaseline();
  const audit = auditRepoAgainstBaseline(REPO_ROOT, baseline);
  if (audit.added.length === 0 && audit.modified.length === 0) return;
  const removed = cleanupAddedPaths(REPO_ROOT, audit, baseline);

  const parts: string[] = [];
  if (audit.added.length > 0) parts.push(`created ${audit.added.join(", ")}`);
  if (audit.modified.length > 0) parts.push(`modified ${audit.modified.join(", ")}`);
  throw new Error(
    `Test suite left SpecKiwi init/skill artifacts in the repo working tree: ${parts.join("; ")}. ` +
      "A test wrote init/skill output to the repository root instead of an isolated temp dir. " +
      `(removed: ${removed.length === 0 ? "nothing" : removed.join(", ")}; ` +
      "modified paths are never removed because no copy exists to restore)"
  );
}
