import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import vitestConfig from "../../../vitest.config.js";

// @req FR-NODE-106 — the two repository registrations that break silently:
//   * the tracked `.gitignore` covers `kiwi/waves.jsonl` and `kiwi/orchestrator/`, so orchestrator
//     machine state is state `git clean -fd` may remove and `git add -A` can never stage;
//   * `vitest.config.ts`'s coverage `include` covers `src/core/orchestrator/**/*.ts` under the same
//     `parserWorkflowThreshold` object the workflow tree already carries.
//
// Both are "easy to forget, break silently": an uncovered orchestrator tree reports no threshold
// failure at all, and an unignored run directory is staged by the first `git add -A` a user runs.

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

/** Non-comment, non-blank entries of the tracked `.gitignore`, in file order. */
async function gitignoreEntries(): Promise<string[]> {
  const text = await readFile(path.join(REPO_ROOT, ".gitignore"), "utf8");
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

describe("FR-NODE-106 — orchestrator repository registrations", () => {
  // AC-1: the entries exist, and as their own entries rather than as text inside a comment.
  it("tracks gitignore entries for the journal and the run directory", async () => {
    const entries = await gitignoreEntries();
    expect(entries, ".gitignore must ignore the wave journal").toContain("kiwi/waves.jsonl");
    expect(entries, ".gitignore must ignore the orchestrator run directory").toContain(
      "kiwi/orchestrator/"
    );
  });

  // AC-2: the behaviour, not the text. Exercised in a throwaway repository seeded with THIS
  // repository's tracked `.gitignore`, for two reasons: creating `kiwi/orchestrator/` in the real
  // working tree would trip the suite's own hermeticity guard, and a check run here would also be
  // satisfied by `.git/info/exclude` — a local unshared file — which is exactly the failure mode
  // ("broken on a fresh clone or a CI runner") that a TRACKED entry exists to close.
  it("leaves both paths untracked and unstageable in a fresh clone", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "speckiwi-gitignore-"));
    const git = (...args: string[]): string =>
      execFileSync("git", ["-C", root, ...args], {
        encoding: "utf8",
        // stderr piped rather than inherited: git's init hints stay out of the suite output, and a
        // real failure still carries its message on the thrown error.
        stdio: ["ignore", "pipe", "pipe"]
      });

    git("init", "--quiet");
    // The tracked file itself, byte for byte. Nothing else from this repository is copied, so a
    // local exclude here cannot stand in for the tracked entry.
    await writeFile(
      path.join(root, ".gitignore"),
      await readFile(path.join(REPO_ROOT, ".gitignore"), "utf8"),
      "utf8"
    );

    // `kiwi/` must hold a tracked file, exactly as it does in this repository (`kiwi/pipeline.jsonl`).
    // Without one, git COLLAPSES a wholly-untracked directory to a single `?? kiwi/` line — so an
    // unignored `kiwi/waves.jsonl` would never appear by name and the status assertions below would
    // pass with the entry missing.
    await mkdir(path.join(root, "kiwi"), { recursive: true });
    await writeFile(path.join(root, "kiwi", "pipeline.jsonl"), "{}\n", "utf8");
    git("add", "kiwi/pipeline.jsonl", ".gitignore");
    git(
      "-c",
      "user.email=test@example.invalid",
      "-c",
      "user.name=test",
      "commit",
      "--quiet",
      "-m",
      "seed"
    );

    await mkdir(path.join(root, "kiwi", "orchestrator", "2026-08-01.speckiwi.demo"), {
      recursive: true
    });
    await writeFile(path.join(root, "kiwi", "waves.jsonl"), "{\"wave\":\"wave-1\"}\n", "utf8");
    await writeFile(
      path.join(root, "kiwi", "orchestrator", "2026-08-01.speckiwi.demo", "resume-card.json"),
      "{}\n",
      "utf8"
    );
    // A control file that IS expected to show up. Without it, a `.gitignore` that ignored the whole
    // tree would satisfy every assertion below while ignoring the user's source as well.
    await writeFile(path.join(root, "README.md"), "control\n", "utf8");

    const status = git("status", "--porcelain");
    expect(status, "the control file must be reported, or the check proves nothing").toMatch(
      /README\.md/
    );
    expect(status, "the wave journal must not be reported as untracked").not.toMatch(/waves\.jsonl/);
    expect(status, "the orchestrator run directory must not be reported as untracked").not.toMatch(
      /kiwi\/orchestrator/
    );
    // Belt and braces against the collapse the seed commit above defeats: no `kiwi/` entry of any
    // shape may appear, so a future fixture change that loses the tracked file cannot hide a miss.
    expect(status, "nothing under kiwi/ may be reported as untracked").not.toMatch(/^\?\?\s+kiwi\//m);

    git("add", "-A");
    const staged = git("diff", "--cached", "--name-only");
    expect(staged, "the control file must stage, or the check proves nothing").toMatch(/README\.md/);
    expect(staged, "git add -A must never stage the wave journal").not.toMatch(/waves\.jsonl/);
    expect(staged, "git add -A must never stage the orchestrator run directory").not.toMatch(
      /kiwi\/orchestrator/
    );
  });

  // AC-3: the coverage include, read off the parsed config rather than the file text — a glob
  // appearing only inside a comment would satisfy a text search.
  it("includes the orchestrator tree in the coverage surface", () => {
    const include = vitestConfig.test?.coverage?.include;
    expect(include, "the coverage config must declare an include list").toBeDefined();
    expect(include, "the orchestrator tree must be in the coverage include").toContain(
      "src/core/orchestrator/**/*.ts"
    );
    // The tree it is modelled on must still be there; replacing rather than adding would trade one
    // uncovered surface for another.
    expect(include, "the workflow tree must stay in the coverage include").toContain(
      "src/core/workflow/**/*.ts"
    );
  });

  // AC-4: the SAME threshold object, not an equal one. A copied literal would satisfy `toEqual`
  // while letting the two drift the next time one of them is raised.
  it("keys the orchestrator tree to the shared parserWorkflowThreshold object", () => {
    const thresholds = vitestConfig.test?.coverage?.thresholds as
      | Record<string, unknown>
      | undefined;
    expect(thresholds, "the coverage config must declare per-glob thresholds").toBeDefined();

    const orchestrator = thresholds?.["src/core/orchestrator/**/*.ts"];
    const workflow = thresholds?.["src/core/workflow/**/*.ts"];
    const parser = thresholds?.["src/core/parser/**/*.ts"];

    expect(orchestrator, "the orchestrator tree must carry a threshold").toBeDefined();
    expect(
      orchestrator,
      "the orchestrator threshold must be the same object the workflow tree uses, not a copy"
    ).toBe(workflow);
    expect(
      orchestrator,
      "the orchestrator threshold must be the same object the parser tree uses, not a copy"
    ).toBe(parser);
    // And that shared object must still be the 90% one, so pointing all three at a laxer shared
    // object cannot pass by identity alone.
    expect(orchestrator).toEqual({ lines: 90, statements: 90 });
  });
});
