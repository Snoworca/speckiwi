import { rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { detectRepoPollution } from "./repo-hermeticity.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

// Backstop for the per-test guard: catches repo pollution that lands OUTSIDE any
// test's afterEach window — e.g. an unawaited spawned child process that writes to
// the repo root after the suite, or a globalSetup/afterAll leak. Runs once in the
// main process after the whole suite; fails the run (and cleans up) if the repo
// working tree carries leaked SpecKiwi init/skill artifacts.
export function teardown(): void {
  const hits = detectRepoPollution(REPO_ROOT);
  if (hits.length === 0) return;
  for (const relative of hits) {
    try {
      rmSync(path.join(REPO_ROOT, relative), { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
  throw new Error(
    `Test suite left SpecKiwi init/skill artifacts in the repo working tree: ${hits.join(", ")}. ` +
      "A test wrote init/skill output to the repository root instead of an isolated temp dir. " +
      "(the artifacts were removed; fix the offending test's isolation)"
  );
}
