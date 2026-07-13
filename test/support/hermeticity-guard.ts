import { rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach } from "vitest";
import { detectRepoPollution } from "./repo-hermeticity.js";

// Repo root resolved from this file's own location so a leaked process.chdir()
// in some earlier test cannot move the guard's notion of "the repo".
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

// Suite-wide hermeticity guard: after every test, fail loudly (and name the
// offending test) if it left SpecKiwi init/skill artifacts in the repo working
// tree instead of writing to an isolated temp root. The artifacts are removed so
// only the first offender fails rather than cascading onto innocent later tests.
afterEach((context) => {
  const hits = detectRepoPollution(REPO_ROOT);
  if (hits.length === 0) return;
  for (const relative of hits) {
    try {
      rmSync(path.join(REPO_ROOT, relative), { recursive: true, force: true });
    } catch {
      /* best effort — the thrown error below is the signal that matters */
    }
  }
  const task = (context as { task?: { name?: string; file?: { name?: string; filepath?: string } } }).task;
  throw new Error(
    `Repo working-tree pollution after test "${task?.name}" in ${task?.file?.name ?? task?.file?.filepath ?? "unknown file"}: ` +
      `created ${hits.join(", ")}. This test wrote SpecKiwi init/skill output into the repository root — ` +
      "operate on an isolated temp root (mkdtemp) or pass --root/an explicit projectRoot instead."
  );
});
