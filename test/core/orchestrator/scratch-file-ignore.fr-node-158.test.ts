import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// @req FR-NODE-158 — the atomic-write scratch files are ignored by *filename pattern*, not by one
// directory.
//
// `src/core/patch/apply-patch.ts:58` writes `.speckiwi-<uuid>.tmp` beside the file it patches, so the
// directory is wherever the patched document lives — `docs/spec/` for a scope SRS, but
// `docs/spec/steps/<task>/` for a step SRS, and the repository root for the merge journal
// (`merge-journal.ts:73`, `:143`). A rule keyed to one directory therefore leaves the others staged
// by `git add -A`, which is exactly how two of these files were committed on 2026-08-01.

const REPO_ROOT = path.resolve(__dirname, "../../..");

/** `git check-ignore` exits 0 when the path is ignored and 1 when it is not; both are normal. */
function isIgnored(relativePath: string): boolean {
  try {
    execFileSync("git", ["check-ignore", "-q", "--no-index", relativePath], { cwd: REPO_ROOT, stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

function git(args: string[]): string {
  return execFileSync("git", args, { cwd: REPO_ROOT, stdio: "pipe" }).toString();
}

describe("FR-NODE-158 — scratch files are ignored wherever a patch can write one", () => {
  // AC-1: every directory a patch can write a scratch file into.
  const PATCH_SITES = [
    ".speckiwi-11111111-2222-3333-4444-555555555555.tmp",
    "docs/spec/.speckiwi-11111111-2222-3333-4444-555555555555.tmp",
    "docs/spec/steps/some-task/.speckiwi-11111111-2222-3333-4444-555555555555.tmp",
    "src/core/orchestrator/.speckiwi-11111111-2222-3333-4444-555555555555.tmp"
  ] as const;

  it.each(PATCH_SITES)("AC-1: ignores %s", (relativePath) => {
    expect(isIgnored(relativePath), `${relativePath} must be ignored`).toBe(true);
  });

  it("AC-2: ignores the merge-journal scratch shape at the repository root", () => {
    expect(isIgnored(".speckiwi-merge-journal.json.11111111-2222-3333-4444-555555555555.tmp")).toBe(true);
  });

  // AC-3 is the one that reproduces the original incident: `check-ignore` answers about a rule, but
  // what committed the two files was `git add -A` over a real working tree. Real files, then.
  it("AC-3: real scratch files on disk are invisible to git status and to git add -A", () => {
    const token = "11111111-2222-3333-4444-555555555555";
    const sites = [
      path.join(REPO_ROOT, `.speckiwi-${token}.tmp`),
      path.join(REPO_ROOT, "docs/spec", `.speckiwi-${token}.tmp`),
      path.join(REPO_ROOT, "docs/spec/steps", `.speckiwi-${token}.tmp`),
      path.join(REPO_ROOT, `.speckiwi-merge-journal.json.${token}.tmp`)
    ];
    // `docs/spec/steps/` is a real patch site — a step SRS lives there — but this repository has no
    // steps yet, so the directory has to be made and taken away again rather than assumed.
    const stepsDir = path.join(REPO_ROOT, "docs/spec/steps");
    const stepsDirExisted = existsSync(stepsDir);
    try {
      if (!stepsDirExisted) mkdirSync(stepsDir, { recursive: true });
      for (const site of sites) writeFileSync(site, "scratch", "utf8");
      const status = git(["status", "--porcelain"]);
      const staged = git(["add", "-A", "--dry-run"]);
      for (const site of sites) {
        const relative = path.relative(REPO_ROOT, site).replace(/\\/g, "/");
        expect(status.includes(relative), `git status reported ${relative}`).toBe(false);
        expect(staged.includes(relative), `git add -A would stage ${relative}`).toBe(false);
      }
      // Not vacuous: this session's own edits must still be visible, or the check proves nothing.
      expect(status.trim().length, "a wholly empty status would make the assertions above vacuous").toBeGreaterThan(0);
    } finally {
      for (const site of sites) rmSync(site, { force: true });
      if (!stepsDirExisted) rmSync(stepsDir, { force: true, recursive: true });
    }
  });

  // AC-4 guards the widening: an ignore rule broad enough to catch every scratch site could also
  // hide a file the repository tracks, and that failure is silent — the file simply stops appearing.
  it("AC-4: the rule matches no tracked path", () => {
    // One `check-ignore` over the whole list on stdin. The obvious per-file loop spawns a git process
    // for every tracked file — about 1,500 here — and fails by timeout, which is not evidence of the
    // property either way.
    const tracked = git(["ls-files"]);
    let shadowed: string[] = [];
    try {
      shadowed = execFileSync("git", ["check-ignore", "--no-index", "--stdin"], { cwd: REPO_ROOT, input: tracked, stdio: "pipe" })
        .toString()
        .split(/\r?\n/)
        .filter(Boolean);
    } catch {
      // exit 1 means nothing on stdin was ignored, which is the passing case.
      shadowed = [];
    }
    expect(shadowed, "these tracked files would be shadowed by an ignore rule").toEqual([]);
  });

  it("AC-4: the check is not vacuous — the repository tracks files to shadow", () => {
    expect(git(["ls-files"]).split(/\r?\n/).filter(Boolean).length).toBeGreaterThan(100);
  });
});
