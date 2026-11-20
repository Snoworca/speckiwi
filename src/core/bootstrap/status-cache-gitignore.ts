import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FileTransaction } from "../patch/file-transaction.js";
import { environmentWithoutRepositoryLocation, git, type GitAnswer } from "../root-facts.js";

/**
 * @req FR-NODE-314 — kiwi/.status.json is a derived cache every mutation rewrites (CON-ARCH-003 AC-2),
 * so init and upgrade keep it out of the project's commits with one marked .gitignore entry, and
 * remove-project takes back exactly that entry and nothing the project wrote itself.
 */
export const STATUS_CACHE_ENTRY = "kiwi/.status.json";

/** The line that marks the entry as SpecKiwi's; remove-project removes an entry only under it. */
export const STATUS_CACHE_MARKER = "# SpecKiwi: derived status cache, rewritten on every change; never commit it (speckiwi remove takes this entry back)";

/** The part of a git answer a warning can quote: the first line it wrote to standard error, or how it ended. */
function reasonOf(answer: GitAnswer): string {
  const line = answer.stderr.split(/\r?\n/).find((text) => text.trim() !== "")?.trim();
  if (line) return line;
  return answer.code === null ? `git ${answer.failure ?? "unavailable"}` : `git exited ${answer.code}`;
}

/**
 * The rule git applies to the cache path and the file it comes from: `null` when no rule mentions it.
 * The pattern starts with `!` when it re-includes the path. check-ignore -v -n prints
 * `source:line:pattern` for a match, a negation included, and `::` when nothing matches.
 */
function decidingRule(stdout: string): { source: string; pattern: string } | null {
  const line = stdout.split(/\r?\n/)[0] ?? "";
  const match = /^(.*?):(\d+):(.*)\t/.exec(line);
  return match ? { source: match[1] ?? "", pattern: match[3] ?? "" } : null;
}

/**
 * Whether a rule reaches every clone: a .gitignore in the work tree does; .git/info/exclude and
 * core.excludesFile are one person's, so a cache ignored only there is still staged by a collaborator.
 */
function isSharedSource(source: string): boolean {
  return !path.isAbsolute(source) && path.basename(source) === ".gitignore";
}

/**
 * @req FR-NODE-314 AC-1 AC-2 AC-3 AC-4 AC-5 AC-7 — adds the marked entry to `<root>/.gitignore` when
 * no rule git honors decides about the cache yet, leaves the file alone when one does (a negation is
 * the project's own choice and only warned about), warns about a cache already tracked without
 * touching the index, and outside a git working tree touches nothing and says why.
 */
export async function ensureStatusCacheIgnored(
  root: string,
  output: { created: string[]; updated: string[] },
  warnings: string[],
  transaction: FileTransaction,
  dryRun: boolean
): Promise<void> {
  const env = environmentWithoutRepositoryLocation();
  const inside = await git(root, ["rev-parse", "--is-inside-work-tree"], env);
  if (inside.code === null) {
    warnings.push(`.gitignore: git could not be run (${reasonOf(inside)}), so no entry for ${STATUS_CACHE_ENTRY} was added.`);
    return;
  }
  if (inside.code !== 0 || inside.stdout.trim() !== "true") {
    warnings.push(`.gitignore: ${root} is not a git working tree (${reasonOf(inside)}), so no entry for ${STATUS_CACHE_ENTRY} was added.`);
    return;
  }
  const tracked = await git(root, ["ls-files", "--error-unmatch", "--", STATUS_CACHE_ENTRY], env);
  if (tracked.code === 0) {
    warnings.push(
      `${STATUS_CACHE_ENTRY} is tracked by git, so every change commits a rewritten cache; run \`git rm --cached ${STATUS_CACHE_ENTRY}\` to stop tracking it (speckiwi does not change the index).`
    );
  }
  // --no-index: a tracked cache is judged by the rules too, so its entry is still added.
  const answer = await git(root, ["check-ignore", "-v", "-n", "--no-index", "--", STATUS_CACHE_ENTRY], env);
  // check-ignore exits 1 when the path is not ignored: an answer, not a failure.
  if (answer.code !== 0 && answer.code !== 1) {
    warnings.push(`.gitignore: git could not say whether ${STATUS_CACHE_ENTRY} is ignored (${reasonOf(answer)}), so no entry was added.`);
    return;
  }
  const rule = decidingRule(answer.stdout);
  if (rule !== null && rule.pattern.startsWith("!")) {
    warnings.push(`.gitignore: the rule ${rule.pattern} in ${rule.source} re-includes ${STATUS_CACHE_ENTRY}, so speckiwi added no entry; git add -A will stage the cache.`);
    return;
  }
  if (rule !== null && isSharedSource(rule.source)) return;
  const filePath = path.join(root, ".gitignore");
  const existing = await readFile(filePath, "utf8").catch(() => undefined);
  const eol = existing?.includes("\r\n") ? "\r\n" : "\n";
  const base = existing === undefined || existing === "" || existing.endsWith("\n") ? (existing ?? "") : `${existing}${eol}`;
  if (!dryRun) await transaction.write(filePath, `${base}${STATUS_CACHE_MARKER}${eol}${STATUS_CACHE_ENTRY}${eol}`);
  (existing === undefined ? output.created : output.updated).push(filePath);
}

/**
 * @req FR-NODE-314 AC-6 — removes each marker line and the entry line under it, nothing else; a
 * .gitignore left empty is removed, as an agent file that held only the managed block is.
 */
export async function removeStatusCacheIgnore(root: string, apply: boolean, removed: string[]): Promise<void> {
  const filePath = path.join(root, ".gitignore");
  const existing = await readFile(filePath, "utf8").catch(() => undefined);
  if (existing === undefined) return;
  const lines = existing.split("\n");
  const bare = (index: number) => lines[index]?.replace(/\r$/, "");
  const kept = lines.filter((_, index) => !(bare(index) === STATUS_CACHE_MARKER && bare(index + 1) === STATUS_CACHE_ENTRY) && !(bare(index - 1) === STATUS_CACHE_MARKER && bare(index) === STATUS_CACHE_ENTRY));
  if (kept.length === lines.length) return;
  const next = kept.join("\n");
  if (next.trim() === "") {
    if (apply) await rm(filePath, { force: true });
    removed.push(filePath);
    return;
  }
  if (apply) await writeFile(filePath, next, "utf8");
  removed.push(`${filePath}#speckiwi-status-cache-entry`);
}
