import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// @req FR-NODE-183 — every file the runtime resolves from inside its own installed package must
// actually be in the published package.
//
// The failure this guards is silent by construction. `init-project.ts` reads a bundled hook runner
// and falls back to `bundled ?? "#!/usr/bin/env node\nprocess.exit(0);\n"` when the read fails, so a
// missing asset does not throw, does not warn, and produces a file that LOOKS installed. Measured
// 2026-08-10: `docs/.kiwi/hooks/{pre-commit,trace}.mjs` were untracked and absent from the tarball,
// so every `speckiwi init` on a consumer machine installed a no-op governance hook.
//
// The asset list is DERIVED from the source rather than written here. A hard-coded list would have
// to be remembered by whoever adds the next bundled asset, which is the same class of omission.

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** `new URL("../../../<path>", import.meta.url)` — the package-relative asset idiom. */
const ASSET_URL = /new URL\(\s*[`"']((?:\.\.\/)+)([^`"'$]*)/g;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (entry.name.endsWith(".ts")) out.push(full);
  }
  return out;
}

/**
 * Every package-relative asset directory the runtime reads, as a repo-relative path.
 *
 * A source file at `src/a/b/c.ts` compiles to `dist/a/b/c.js`, so `../../../x` from it resolves to
 * `<package>/x`. Only reads that escape `dist/` need a `files` entry — a sibling import inside
 * `dist` ships with the compiled output. The interpolated tail (`${name}`) is cut off, leaving the
 * directory, which is what a `files` entry covers.
 */
function bundledAssetDirs(): { dir: string; from: string }[] {
  const found = new Map<string, string>();
  for (const file of sourceFiles(path.join(REPO_ROOT, "src"))) {
    const text = readFileSync(file, "utf8");
    // `src/` and `dist/` have the same depth, so `..` counts apply unchanged to the emitted layout.
    const depthFromPackageRoot = path.relative(REPO_ROOT, file).split(path.sep).length - 1;
    for (const match of text.matchAll(ASSET_URL)) {
      const ups = (match[1] as string).length / 3;
      // Fewer `..` than the file's own depth means the target stays inside dist/.
      if (ups < depthFromPackageRoot) continue;
      // The capture already stops at `$`, so an interpolated filename leaves a trailing slash
      // (`docs/rule/`) while a literal directory does not (`skills/codex`). Trimming the slash is
      // the whole normalisation — stripping a path segment unconditionally would turn
      // `skills/codex` into `skills`, which is a different, wider claim than the code makes.
      const dir = (match[2] as string).replace(/^\/+|\/+$/g, "");
      if (dir === "") continue;
      if (!found.has(dir)) found.set(dir, path.relative(REPO_ROOT, file).replace(/\\/g, "/"));
    }
  }
  return [...found.entries()].map(([dir, from]) => ({ dir, from })).sort((a, b) => (a.dir < b.dir ? -1 : 1));
}

/** Every file under a directory, recursively. */
function sourceTree(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceTree(full));
    else out.push(full);
  }
  return out;
}

function packageFilesEntries(): string[] {
  return (JSON.parse(readFileSync(path.join(REPO_ROOT, "package.json"), "utf8")) as { files?: string[] }).files ?? [];
}

/** A `files` entry covers a path when it is that path or one of its ancestors. */
function coveredByFiles(target: string, entries: string[]): boolean {
  const normalised = target.replace(/\\/g, "/").replace(/^\.\//, "");
  return entries.some((raw) => {
    const entry = raw.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
    return normalised === entry || normalised.startsWith(`${entry}/`);
  });
}

function isTracked(relative: string): boolean {
  try {
    execFileSync("git", ["ls-files", "--error-unmatch", relative], { cwd: REPO_ROOT, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------------------------

describe("FR-NODE-183 AC-1 — the asset list is derived from the source, not hard-coded", () => {
  it("finds the package-relative asset reads by scanning src", () => {
    const dirs = bundledAssetDirs().map((entry) => entry.dir);
    // A floor, so a regex that silently stopped matching cannot leave the suite vacuously green.
    expect(dirs.length, "no package-relative asset reads were found; the scan is broken").toBeGreaterThanOrEqual(3);
    // The three that were already correct before this requirement, as a self-check on the scanner.
    expect(dirs).toContain("docs/rule");
    expect(dirs).toContain("skills/codex");
    expect(dirs).toContain("skills/claude");
  });
});

describe("FR-NODE-183 AC-2 — each derived asset exists, is tracked, and is packaged", () => {
  it("covers every one of them", () => {
    const entries = packageFilesEntries();
    expect(entries.length, "package.json declares no files list").toBeGreaterThan(0);

    // EVERY file under the directory must be covered, not merely the directory itself: `files` may
    // name a directory (`skills/codex`) or its members one by one (`docs/rule/SRS-…md`), and both
    // are legitimate. Requiring per-file coverage accepts both spellings and still catches a
    // directory that ships only some of its members.
    const problems: string[] = [];
    for (const { dir, from } of bundledAssetDirs()) {
      const absolute = path.join(REPO_ROOT, dir);
      if (!existsSync(absolute)) {
        problems.push(`${dir} does not exist (read from ${from})`);
        continue;
      }
      for (const file of sourceTree(absolute)) {
        const relative = path.relative(REPO_ROOT, file).replace(/\\/g, "/");
        if (!coveredByFiles(relative, entries)) problems.push(`${relative} is not covered by package.json files (read from ${from})`);
      }
    }
    expect(problems, "a runtime-resolved asset would be missing on a consumer machine").toEqual([]);
  });
});

describe("FR-NODE-183 AC-3 — the two hook runners specifically", () => {
  const RUNNERS = ["docs/.kiwi/hooks/pre-commit.mjs", "docs/.kiwi/hooks/trace.mjs"];

  it("ships both runners: present, tracked, and packaged", () => {
    const entries = packageFilesEntries();
    for (const runner of RUNNERS) {
      expect(existsSync(path.join(REPO_ROOT, runner)), `${runner} must exist`).toBe(true);
      expect(isTracked(runner), `${runner} must be tracked by git, or it cannot be published`).toBe(true);
      expect(coveredByFiles(runner, entries), `${runner} must be covered by package.json files`).toBe(true);
    }
  });

  it("does not ignore the hooks directory, so a NEW runner can still be added", () => {
    // Tracking and ignoring are independent: once a file is tracked, `.gitignore` no longer affects
    // it, so reverting the ignore rule would leave the two existing runners tracked and every other
    // assertion green. Measured — that mutation was green until this case existed. What it would
    // break is the NEXT runner, which `git add` would silently skip. `--no-index` asks about the
    // rule itself rather than the index, which is the only way to observe it.
    let ignored = "";
    try {
      ignored = execFileSync("git", ["check-ignore", "-v", "--no-index", "docs/.kiwi/hooks/a-future-runner.mjs"], {
        cwd: REPO_ROOT,
        encoding: "utf8"
      });
    } catch {
      ignored = "";
    }
    expect(ignored.trim(), "docs/.kiwi/hooks/ must not be ignored, or a new runner cannot be added").toBe("");
  });

  it("still ignores the runtime .kiwi session directory", () => {
    // Narrowing the ignore rule must not stop ignoring what it was written for: `.kiwi/` at a
    // project root is per-run session state and must never be committed.
    let ignored = "";
    try {
      ignored = execFileSync("git", ["check-ignore", "-v", "--no-index", ".kiwi/sessions/x/state.json"], {
        cwd: REPO_ROOT,
        encoding: "utf8"
      });
    } catch {
      ignored = "";
    }
    expect(ignored.trim(), "the runtime .kiwi/ session directory must still be ignored").not.toBe("");
  });

  it("does not let the stub fallback stand in for a shipped runner", () => {
    // The fallback exists and is reasonable as a last resort; what is not acceptable is it being
    // the ONLY thing a consumer ever gets. Asserting the real runner has content distinguishes the
    // two: a stub is two lines, the real gate reads work-mode state.
    for (const runner of RUNNERS) {
      const text = readFileSync(path.join(REPO_ROOT, runner), "utf8");
      expect(text.length, `${runner} looks like the stub, not the real runner`).toBeGreaterThan(200);
      expect(text).toMatch(/state\.md|Mode:|work mode/i);
    }
  });
});
