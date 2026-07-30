import { appendFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
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
  const where = task?.file?.name ?? task?.file?.filepath ?? "unknown file";
  const detail = `Repo working-tree pollution after test "${task?.name}" in ${where}: created ${hits.join(", ")}.`;

  // The throw below names the offender, but a truncated console tail can lose it — which is exactly
  // what happened on 2026-07-30 and again in an earlier session, leaving two occurrences with no name
  // and no artifact to inspect, because this guard deletes what it finds. The journal is the copy that
  // survives: it records the offender and the artifacts even when the report is cut off. It is written
  // outside the repository so the guard cannot become a source of pollution itself.
  try {
    const journal = path.join(tmpdir(), "speckiwi-hermeticity");
    mkdirSync(journal, { recursive: true });
    appendFileSync(path.join(journal, "pollution.log"), `${new Date().toISOString()} ${detail}\n`, "utf8");
  } catch {
    /* best effort — the thrown error below is the signal that matters */
  }

  throw new Error(
    `${detail} This test wrote SpecKiwi init/skill output into the repository root — ` +
      "operate on an isolated temp root (mkdtemp) or pass --root/an explicit projectRoot instead. " +
      `A copy of this line is appended to ${path.join(tmpdir(), "speckiwi-hermeticity", "pollution.log")}.`
  );
});
