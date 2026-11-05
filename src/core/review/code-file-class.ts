import path from "node:path";

// @req FR-NODE-274 AC-2 — the code-file class filter of kiwi-review-fix-loop §11 (FR-FLOW-152) as a
// closed list: source files, test files and named configuration files are code; prose, run journals
// and locks, and anything unlisted (binaries, assets) are not. A test file is code because it carries
// a source extension, and a comment inside a code file never reaches this filter. The §11 order holds:
// the refused run artifacts first, then the class table by name, then — for a file with no extension
// only — its first line, where `#!` makes it a source script; what is left is unclassified. The
// refused artifacts (`*.jsonl`, `*.lock`, `*.lock.json`, `resume-card.json` and the run contracts) all
// carry an extension no rule below admits, so step 1 needs no rule of its own here.

/** Source extensions, test files included. */
const SOURCE_EXTENSIONS: ReadonlySet<string> = new Set([
  ".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".java", ".kt", ".kts", ".go", ".rs", ".c", ".h", ".cc", ".cpp", ".hpp", ".cs",
  ".rb", ".php", ".swift", ".scala", ".sh", ".bash", ".ps1", ".sql", ".vue", ".svelte"
]);

/** Configuration files named by their file name. */
const NAMED_CONFIG_FILES: ReadonlySet<string> = new Set(["package.json", "tsconfig.json", "jsconfig.json", "Dockerfile", "Makefile"]);

/** Configuration files named by a file-name pattern: tsconfig variants and tool configs. */
const NAMED_CONFIG_PATTERNS: readonly RegExp[] = [
  /^tsconfig\.[^/]+\.json$/,
  /^(?:vitest|vite|jest|eslint|prettier|rollup|webpack)\.config\.[cm]?[jt]s$/,
  /^\.eslintrc(?:\.[a-z]+)?$/
];

/** CI workflow YAML. */
const CI_WORKFLOW = /^\.github\/workflows\/[^/]+\.ya?ml$/;

/**
 * Whether a repository-relative POSIX path is a review target of the code-file class filter.
 * `readFirstLine` is consulted only for a file with no extension that no name rule classifies, and
 * answers undefined for a file that has no content to read.
 */
export async function isReviewCodeFile(posixPath: string, readFirstLine: () => Promise<string | undefined>): Promise<boolean> {
  const name = path.posix.basename(posixPath);
  if (NAMED_CONFIG_FILES.has(name) || NAMED_CONFIG_PATTERNS.some((pattern) => pattern.test(name)) || CI_WORKFLOW.test(posixPath)) return true;
  const extension = path.posix.extname(name);
  if (extension !== "") return SOURCE_EXTENSIONS.has(extension.toLowerCase());
  return (await readFirstLine())?.startsWith("#!") ?? false;
}
