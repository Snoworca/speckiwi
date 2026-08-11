import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  auditRepoAgainstBaseline,
  cleanupAddedPaths,
  loadBaseline,
  snapshotSentinels
} from "./repo-hermeticity.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Where the baseline is handed to worker processes. Read by {@link loadBaseline}. */
export const BASELINE_ENV_VAR = "SPECKIWI_HERMETICITY_BASELINE";

/**
 * Captures what the working tree looks like BEFORE any test runs, and hands the snapshot
 * to the workers through the environment. Without this the guard cannot tell a test's leak
 * apart from the developer's own `speckiwi init` output, and deletes both. @req FR-NODE-184
 *
 * Written outside the repository so the guard's own bookkeeping can never be pollution.
 */
export function setup(): void {
  const journal = path.join(tmpdir(), "speckiwi-hermeticity");
  mkdirSync(journal, { recursive: true });
  const file = path.join(journal, `baseline-${process.pid}.json`);
  writeFileSync(file, JSON.stringify(snapshotSentinels(REPO_ROOT)), "utf8");
  process.env[BASELINE_ENV_VAR] = file;
}

/**
 * Backstop for the per-test guard: catches pollution that lands OUTSIDE any test's
 * afterEach window — an unawaited child process that writes after the suite, or a
 * globalSetup/afterAll leak. Runs once in the main process after the whole suite.
 */
export function teardown(): void {
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
