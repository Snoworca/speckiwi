import { realpath } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

// @req FR-NODE-228 AC-9 — the native realpath returns the spelling on disk on every case-insensitive file
// system (macOS included), where the JS implementation may hand back the case it was given.
const realpathNative = promisify(realpath.native);

/**
 * A path reduced to the form two spellings of the same location share.
 *
 * `path.resolve` alone is not enough, and the asymmetry is silent: a project root arrives already
 * realpath'd (`resolveProjectRoot` calls it), while a home directory or `CODEX_HOME` does not — it is
 * the raw environment or seam value. A location reached through a junction, a symlink, or a redirected
 * folder therefore produces two different strings for one directory. Measured on a junction fixture:
 * the managed global skills were deleted by a project-scope removal (FR-NODE-192), and a Codex install
 * deleted the copies it had just written (FR-NODE-228).
 *
 * A path that does not exist yet cannot be realpath'd, so this resolves the nearest ancestor that does
 * and reattaches the rest — the links are always in the ancestors.
 */
export async function canonicalPath(target: string): Promise<string> {
  let current = path.resolve(target);
  const trailing: string[] = [];
  for (;;) {
    const resolved = await realpathNative(current).catch(() => undefined);
    if (resolved !== undefined) return path.join(resolved, ...trailing.reverse());
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(target);
    trailing.push(path.basename(current));
    current = parent;
  }
}

/** Whether two paths name one directory: canonicalised, and case-insensitive where the filesystem is (win32). */
export async function isSameDirectory(left: string, right: string): Promise<boolean> {
  const [a, b] = [await canonicalPath(left), await canonicalPath(right)];
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}
