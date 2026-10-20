import path from "node:path";

/**
 * @req REL-NODE-009 AC-6 AC-11 — the multi-process harness: a bundle of the source lock module (so the
 * workers run the code under test, not a stale build) and the worker each process runs.
 */

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");

/** Bundles `src/core/mutation/srs-lock.ts` into `<dir>/srs-lock.mjs` and returns its path. */
export async function bundleSrsLock(dir: string): Promise<string> {
  const { build } = await import("rolldown");
  const file = path.join(dir, "srs-lock.mjs");
  await build({
    input: path.join(REPO_ROOT, "src", "core", "mutation", "srs-lock.ts"),
    platform: "node",
    output: { file, format: "esm" },
    write: true,
    logLevel: "silent"
  });
  return file;
}

/**
 * One contender: calls withSrsMutationLock with an empty mutation until `want` successes, 5-15 ms
 * apart (R38 E6). Reports successes, refusals, thrown errors, the longest gap between successes, and
 * — when a marker path is given — how often it found another process inside the mutation.
 * argv: bundle root want ttlMs [marker]
 */
export const WORKER_SOURCE = `
import { open, rm } from "node:fs/promises";
import { pathToFileURL } from "node:url";
const [bundle, root, want, ttlMs, marker] = process.argv.slice(2);
const { withSrsMutationLock } = await import(pathToFileURL(bundle).href);
const okResult = { ok: true, value: {}, diagnostics: [], diagnosticsSummary: { errors: 0, warnings: 0, byCode: {} } };
const stats = { pid: process.pid, ok: 0, refused: 0, threw: 0, overlaps: 0, maxWaitMs: 0, errors: {} };
const t0 = Date.now();
let lastOk = Date.now();
while (stats.ok < Number(want) && Date.now() - t0 < 300000) {
  try {
    const result = await withSrsMutationLock({ root }, { operation: "load-" + process.pid, ttlMs: Number(ttlMs) }, async () => {
      if (marker) {
        try { const handle = await open(marker, "wx"); await handle.close(); } catch { stats.overlaps++; }
        await new Promise((resolve) => setTimeout(resolve, 1));
        await rm(marker, { force: true });
      }
      return okResult;
    });
    if (result.ok) {
      stats.ok++;
      stats.maxWaitMs = Math.max(stats.maxWaitMs, Date.now() - lastOk);
      lastOk = Date.now();
    } else {
      stats.refused++;
    }
  } catch (error) {
    stats.threw++;
    stats.errors[error.code ?? error.message] = (stats.errors[error.code ?? error.message] ?? 0) + 1;
  }
  await new Promise((resolve) => setTimeout(resolve, 5 + Math.random() * 10));
}
console.log(JSON.stringify(stats));
`;
