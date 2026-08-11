import { appendFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach } from "vitest";
import {
  type RepoAudit,
  type SentinelBaseline,
  auditRepoAgainstBaseline,
  cleanupAddedPaths,
  loadBaseline
} from "./repo-hermeticity.js";

// Repo root resolved from this file's own location so a leaked process.chdir() in some
// earlier test cannot move the guard's notion of "the repo".
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

// Read once per worker. `null` means the pre-suite snapshot is unavailable, and the audit
// then reports without deleting — see cleanupAddedPaths. @req FR-NODE-184
const BASELINE: SentinelBaseline | null = loadBaseline();

/**
 * Audits the repo working tree after one test and removes only what that test added.
 * Exported so the contract can be driven directly rather than asserted by reading this
 * file's source — a source scan cannot show that the cleanup actually spares the baseline.
 */
export function auditRepoAfterTest(
  repoRoot: string,
  baseline: SentinelBaseline | null,
  label: string,
  sentinels?: readonly string[]
): { audit: RepoAudit; removed: string[]; detail: string } | null {
  const audit = auditRepoAgainstBaseline(repoRoot, baseline, sentinels);
  if (audit.added.length === 0 && audit.modified.length === 0) return null;
  const removed = cleanupAddedPaths(repoRoot, audit, baseline);

  const parts: string[] = [];
  if (audit.added.length > 0) parts.push(`created ${audit.added.join(", ")}`);
  if (audit.modified.length > 0) parts.push(`modified ${audit.modified.join(", ")}`);
  return { audit, removed, detail: `Repo working-tree pollution after ${label}: ${parts.join("; ")}.` };
}

// Suite-wide hermeticity guard: after every test, fail loudly (and name the offending test)
// if it left SpecKiwi init/skill artifacts in the repo working tree. Artifacts the test
// created are removed so only the first offender fails rather than cascading onto innocent
// later tests. Artifacts that predate the suite are reported but never touched — they are
// the developer's own untracked install, and git cannot restore them.
afterEach((context) => {
  const task = (context as { task?: { name?: string; file?: { name?: string; filepath?: string } } }).task;
  const where = task?.file?.name ?? task?.file?.filepath ?? "unknown file";
  const result = auditRepoAfterTest(REPO_ROOT, BASELINE, `test "${task?.name}" in ${where}`);
  if (result === null) return;

  // The throw below names the offender, but a truncated console tail can lose it — which is
  // exactly what happened on 2026-07-30 and again in an earlier session, leaving occurrences
  // with no name and no artifact to inspect, because this guard deletes what it created.
  // The journal is the copy that survives. It is written outside the repository so the guard
  // cannot become a source of pollution itself.
  try {
    const journal = path.join(tmpdir(), "speckiwi-hermeticity");
    mkdirSync(journal, { recursive: true });
    appendFileSync(path.join(journal, "pollution.log"), `${new Date().toISOString()} ${result.detail}\n`, "utf8");
  } catch {
    /* best effort — the thrown error below is the signal that matters */
  }

  throw new Error(
    `${result.detail} This test wrote SpecKiwi init/skill output into the repository root — ` +
      "operate on an isolated temp root (mkdtemp) or pass --root/an explicit projectRoot instead. " +
      `(removed: ${result.removed.length === 0 ? "nothing" : result.removed.join(", ")}) ` +
      `A copy of this line is appended to ${path.join(tmpdir(), "speckiwi-hermeticity", "pollution.log")}.`
  );
});
