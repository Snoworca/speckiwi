/**
 * @req FR-NODE-290 AC-4 — the path a filesystem error carries but its message does not name, or
 * `undefined` when it carries none or the message already names it. Node's error for reading a
 * directory names no file ("EISDIR: illegal operation on a directory, read"); readUtf8File attaches the
 * path (FR-NODE-091). The CLI and upgrade's SRS read both ask this, so they agree on when to add it.
 */
export function pathMissingFromMessage(error: { message?: string; path?: unknown }): string | undefined {
  if (typeof error.path !== "string" || error.path === "") return undefined;
  return (error.message ?? "").includes(error.path) ? undefined : error.path;
}
