import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Repo-root paths that a full `speckiwi init` (default MCP + skill provisioning) or a
 * skill install writes. A test that operates on the real repository working tree instead
 * of an isolated temp root leaves its output here.
 *
 * Presence alone is NOT evidence of a leak. This repository dogfoods its own product, so
 * in a developer checkout every one of these is legitimate, permanent init output — and
 * none of it is tracked, so deleting it destroys the only copy. Classification therefore
 * runs against a baseline captured before the suite starts. @req FR-NODE-184
 */
export const REPO_POLLUTION_SENTINELS: readonly string[] = [
  ".mcp.json",
  path.posix.join("docs", "spec", "steps"),
  path.posix.join(".claude", "skills"),
  path.posix.join(".codex", "hooks.json"),
  path.posix.join(".agents", "skills", "kiwi-step"),
  path.posix.join(".agents", "skills", "kiwi-wave-master")
];

export type SentinelSnapshot =
  | { readonly kind: "absent" }
  | { readonly kind: "file"; readonly digest: string }
  /** Files below the directory, keyed by their path within it, so a leak into a
   *  directory the baseline already held is still visible. */
  | { readonly kind: "dir"; readonly entries: Readonly<Record<string, string>> };

export type SentinelBaseline = Readonly<Record<string, SentinelSnapshot>>;

export interface RepoAudit {
  /** Paths that did not exist at baseline. Only these may be deleted. */
  readonly added: string[];
  /** Paths the baseline held whose content or shape changed. Reported, never deleted. */
  readonly modified: string[];
}

function digestFile(absolute: string): string {
  return createHash("sha256").update(readFileSync(absolute)).digest("hex");
}

function collectFiles(directory: string, prefix: string, into: Record<string, string>): void {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      collectFiles(absolute, relative, into);
    } else {
      into[relative] = digestFile(absolute);
    }
  }
}

/** Captures what each sentinel looks like right now. Call once before the suite runs. */
export function snapshotSentinels(
  repoRoot: string,
  sentinels: readonly string[] = REPO_POLLUTION_SENTINELS
): SentinelBaseline {
  // Null-prototype: a sentinel or directory entry literally named `__proto__` would
  // otherwise assign the prototype and create no own property.
  const baseline = Object.create(null) as Record<string, SentinelSnapshot>;
  for (const relative of sentinels) {
    const absolute = path.join(repoRoot, relative);
    if (!existsSync(absolute)) {
      baseline[relative] = { kind: "absent" };
    } else if (statSync(absolute).isDirectory()) {
      const entries = Object.create(null) as Record<string, string>;
      collectFiles(absolute, "", entries);
      baseline[relative] = { kind: "dir", entries };
    } else {
      baseline[relative] = { kind: "file", digest: digestFile(absolute) };
    }
  }
  return baseline;
}

const ABSENT: SentinelSnapshot = { kind: "absent" };

/**
 * Classifies the current working tree against `baseline`. A `null` baseline means the
 * snapshot could not be taken: everything present is reported so the leak is still named,
 * but {@link cleanupAddedPaths} will refuse to delete under that uncertainty.
 */
export function auditRepoAgainstBaseline(
  repoRoot: string,
  baseline: SentinelBaseline | null,
  sentinels: readonly string[] = REPO_POLLUTION_SENTINELS
): RepoAudit {
  const current = snapshotSentinels(repoRoot, sentinels);
  const added: string[] = [];
  const modified: string[] = [];

  for (const relative of sentinels) {
    const now = current[relative] ?? ABSENT;
    if (now.kind === "absent") continue;
    const was = baseline ? baseline[relative] ?? ABSENT : ABSENT;

    if (was.kind === "absent") {
      if (now.kind === "dir") {
        const inner = Object.keys(now.entries).sort();
        // An empty leaked directory has no files to name, so name the directory itself.
        if (inner.length === 0) added.push(relative);
        else added.push(...inner.map((entry) => path.posix.join(relative, entry)));
      } else {
        added.push(relative);
      }
      continue;
    }

    if (was.kind !== now.kind) {
      // file became directory or the reverse: a shape change over content we cannot restore.
      modified.push(relative);
      continue;
    }

    if (now.kind === "file" && was.kind === "file") {
      if (now.digest !== was.digest) modified.push(relative);
      continue;
    }

    if (now.kind === "dir" && was.kind === "dir") {
      for (const entry of Object.keys(now.entries).sort()) {
        const inside = path.posix.join(relative, entry);
        const before = was.entries[entry];
        if (before === undefined) added.push(inside);
        else if (before !== now.entries[entry]) modified.push(inside);
      }
    }
  }

  return { added, modified };
}

/**
 * Reads the baseline the global setup captured, or returns `null` when it is unavailable
 * (env var unset, file missing, unreadable JSON). `null` is a safe answer, not a failure:
 * every caller then reports without deleting.
 *
 * Prototypes are rebuilt as null so a path literally named `__proto__` resolves to a real
 * own property instead of `Object.prototype`, which JSON.parse would otherwise hand back.
 */
export function loadBaseline(envVar = "SPECKIWI_HERMETICITY_BASELINE"): SentinelBaseline | null {
  const file = process.env[envVar];
  if (!file) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;

  const baseline = Object.create(null) as Record<string, SentinelSnapshot>;
  for (const [relative, snapshot] of Object.entries(parsed as Record<string, SentinelSnapshot>)) {
    if (snapshot.kind === "dir") {
      const entries = Object.create(null) as Record<string, string>;
      for (const [inner, digest] of Object.entries(snapshot.entries)) entries[inner] = digest;
      baseline[relative] = { kind: "dir", entries };
    } else {
      baseline[relative] = snapshot;
    }
  }
  return baseline;
}

/**
 * Removes the paths `audit` classified as added and returns those actually removed.
 * Deletes nothing when the baseline is unavailable — without it, "added" is a guess, and
 * the guard holds no copy of what it would destroy. @req FR-NODE-184
 */
export function cleanupAddedPaths(
  repoRoot: string,
  audit: RepoAudit,
  baseline: SentinelBaseline | null
): string[] {
  if (baseline === null) return [];
  const removed: string[] = [];
  for (const relative of audit.added) {
    try {
      rmSync(path.join(repoRoot, relative), { recursive: true, force: true });
      removed.push(relative);
    } catch {
      /* best effort — the caller's report is the signal that matters */
    }
  }
  return removed;
}
