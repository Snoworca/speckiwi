import { chmod, copyFile, lstat, mkdir, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";

/**
 * `speckiwi skills mirror --check | --write` — the sanctioned writer for `.agents/skills/**`.
 *
 * @req FR-NODE-105
 *
 * 05 §9.5: CP-05 marks `.agents/skills/**` orchestrator-only, §14 registration 5 requires
 * `waves-event.md` v1.4.0 in all four copies edited in one change, and FR-NODE-129's parity harness
 * asserts set-equality across all four — so four-copy parity was a shipping requirement with no
 * sanctioned writer, and the mirror was maintained out of band.
 *
 * This verb is neither `init` nor `skills install`. `00.charter.md:303-304` forbids running those
 * three against this repository as the target root; nothing here reaches either code path, and the
 * requirement asserts that as a test. `--check` is the CI/gate form.
 */

export const MIRROR_MODES = ["check", "write"] as const;
export type MirrorMode = (typeof MIRROR_MODES)[number];

/** Where the mirror is generated from, and to. Both are fixed by §9.5; neither is configurable. */
export const MIRROR_SOURCE_SEGMENTS = ["skills", "codex"] as const;
export const MIRROR_DESTINATION_SEGMENTS = [".agents", "skills"] as const;

export const MIRROR_EXCLUSIONS_FILE = ".speckiwi-mirror-exclusions.json";

/**
 * Mirror bookkeeping the mirror does not own. `.speckiwi-skill-install.json` is written per skill by
 * `skills install`, and the exclusions manifest is authored by the workspace — treating either as
 * mirror content would make `--check` report a divergence no `--write` could ever settle, and would
 * make `--write` delete a file another tool depends on.
 */
const NON_MIRROR_FILES = new Set([MIRROR_EXCLUSIONS_FILE, ".speckiwi-skill-install.json"]);

const SKILL_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const SHARED_DIRECTORY = "_shared";

export type MirrorDivergenceKind = "content-differs" | "missing-in-mirror" | "extra-in-mirror";

export interface MirrorDivergence {
  /** Mirror-relative, POSIX separators. */
  readonly path: string;
  readonly kind: MirrorDivergenceKind;
}

export interface MirrorSkillsOptions {
  readonly projectRoot: string;
  readonly mode: MirrorMode;
}

export interface MirrorSkillsResult {
  readonly ok: boolean;
  readonly mode: MirrorMode;
  readonly sourceRoot: string;
  readonly mirrorRoot: string;
  /** The skills `.speckiwi-mirror-exclusions.json` names, in the order it names them. */
  readonly excluded: readonly string[];
  readonly divergences: readonly MirrorDivergence[];
  /** Mirror-relative paths written. Always empty under `--check`. */
  readonly written: readonly string[];
  /** Mirror-relative paths removed. Always empty under `--check`. */
  readonly removed: readonly string[];
}

function toPosix(value: string): string {
  return value.split(path.sep).join("/");
}

/**
 * Line endings are normalised before comparison, and only for comparison — `--write` copies the
 * source bytes verbatim.
 *
 * Measured on this repository: `git ls-files --eol` reports `i/lf w/crlf` for
 * `.agents/skills/_shared/kiwi/waves-event.md` and `i/lf w/lf` for the codex copy. Git stores LF for
 * both, so the two agree on content and disagree on checkout bytes. A byte-strict check would report
 * every file divergent on a Windows checkout, and a gate that is red on a clean checkout gets
 * switched off — which costs more than the drift class it would have caught, line endings in a
 * Markdown skill body carrying no contract.
 */
function comparable(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

async function listFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  async function walk(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }
      if (entry.isFile()) files.push(toPosix(path.relative(root, absolutePath)));
    }
  }
  await walk(root);
  return files.sort();
}

/**
 * The skills the mirror covers: immediate directories of `skills/codex` that carry a `SKILL.md`,
 * plus `_shared`. A file at the source root — `MIGRATION_PLAN.md` — is not a skill and is not
 * mirrored.
 */
async function mirroredTopLevelDirectories(sourceRoot: string, excluded: ReadonlySet<string>): Promise<string[]> {
  const entries = await readdir(sourceRoot, { withFileTypes: true }).catch(() => []);
  const names: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === SHARED_DIRECTORY) {
      names.push(entry.name);
      continue;
    }
    if (!SKILL_NAME_PATTERN.test(entry.name) || excluded.has(entry.name)) continue;
    const skillFile = await lstat(path.join(sourceRoot, entry.name, "SKILL.md")).catch(() => undefined);
    if (skillFile?.isFile()) names.push(entry.name);
  }
  return names.sort();
}

/**
 * @req FR-NODE-105 AC-3 — an absent or unparseable manifest excludes nothing, so a workspace that
 * never excluded anything mirrors exactly as it would without the file.
 */
async function readExclusions(mirrorRoot: string): Promise<string[]> {
  const raw = await readFile(path.join(mirrorRoot, MIRROR_EXCLUSIONS_FILE), "utf8").catch(() => undefined);
  if (raw === undefined) return [];
  try {
    const parsed = JSON.parse(raw) as { excluded?: unknown };
    if (!Array.isArray(parsed.excluded)) return [];
    return parsed.excluded.filter((name): name is string => typeof name === "string");
  } catch {
    return [];
  }
}

function ownedBy(relativePath: string, directories: readonly string[]): boolean {
  return directories.some((directory) => relativePath === directory || relativePath.startsWith(`${directory}/`));
}

function isNonMirrorFile(relativePath: string): boolean {
  return NON_MIRROR_FILES.has(path.posix.basename(relativePath));
}

/**
 * Compares, and — under `--write` only — regenerates.
 *
 * The two modes share one traversal on purpose: a check that computed the desired tree differently
 * from the write would eventually disagree with it, and the disagreement would surface as a gate
 * that passes on a mirror the writer would change.
 */
export async function mirrorSkills(options: MirrorSkillsOptions): Promise<MirrorSkillsResult> {
  const sourceRoot = path.join(options.projectRoot, ...MIRROR_SOURCE_SEGMENTS);
  const mirrorRoot = path.join(options.projectRoot, ...MIRROR_DESTINATION_SEGMENTS);

  const excluded = await readExclusions(mirrorRoot);
  const excludedSet = new Set(excluded);
  const owned = await mirroredTopLevelDirectories(sourceRoot, excludedSet);

  const sourceFiles = (await listFiles(sourceRoot)).filter((file) => ownedBy(file, owned) && !isNonMirrorFile(file));
  const mirrorFiles = (await listFiles(mirrorRoot)).filter((file) => ownedBy(file, owned) && !isNonMirrorFile(file));
  const mirrorSet = new Set(mirrorFiles);

  const divergences: MirrorDivergence[] = [];
  const written: string[] = [];
  const removed: string[] = [];

  for (const relativePath of sourceFiles) {
    const source = path.join(sourceRoot, relativePath);
    const target = path.join(mirrorRoot, relativePath);
    const existing = mirrorSet.has(relativePath) ? await readFile(target, "utf8").catch(() => undefined) : undefined;
    const sourceText = await readFile(source, "utf8");

    if (existing === undefined) divergences.push({ path: relativePath, kind: "missing-in-mirror" });
    else if (comparable(existing) !== comparable(sourceText)) divergences.push({ path: relativePath, kind: "content-differs" });
    else continue;

    if (options.mode !== "write") continue;
    await mkdir(path.dirname(target), { recursive: true });
    const sourceStat = await lstat(source);
    await copyFile(source, target);
    await chmod(target, sourceStat.mode & 0o777).catch(() => undefined);
    written.push(relativePath);
  }

  const sourceSet = new Set(sourceFiles);
  for (const relativePath of mirrorFiles) {
    if (sourceSet.has(relativePath)) continue;
    divergences.push({ path: relativePath, kind: "extra-in-mirror" });
    if (options.mode !== "write") continue;
    await rm(path.join(mirrorRoot, relativePath), { force: true });
    removed.push(relativePath);
  }

  divergences.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));

  return {
    // Under `--write` the divergences are what the run repaired, so the result is ok; under `--check`
    // any divergence is the finding.
    ok: options.mode === "write" ? true : divergences.length === 0,
    mode: options.mode,
    sourceRoot,
    mirrorRoot,
    excluded,
    divergences,
    written,
    removed
  };
}
