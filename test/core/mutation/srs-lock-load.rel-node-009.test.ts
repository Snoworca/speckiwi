import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { bundleSrsLock, WORKER_SOURCE } from "../../support/srs-lock-load.js";

/**
 * REL-NODE-009 AC-11 — load test in the R38 E6 shape: 10 processes x 100 successful empty mutations,
 * ttlMs 3000, so a skipped release shows as a gap of at least the TTL. Pass rule: across N runs no gap
 * reaches the TTL and no exception escapes.
 *
 * N was fixed before the fix, from the pre-fix code: with N = 1 the unchanged test went red in 10 of
 * 10 attempts on 2026-10-21 (9 by exceptions escaping withSrsMutationLock, 1 by a 10.2 s gap), so
 * RUNS is 1. Stress-tagged: run with SPECKIWI_STRESS=1 (SPECKIWI_LOAD_RUNS overrides N).
 */

const PROCESSES = 10;
const SUCCESSES = 100;
const TTL_MS = 3_000;
const RUNS = Number(process.env.SPECKIWI_LOAD_RUNS ?? 1);

interface WorkerStats {
  pid: number;
  ok: number;
  refused: number;
  threw: number;
  maxWaitMs: number;
  errors: Record<string, number>;
}

async function oneRun(bundle: string, worker: string): Promise<WorkerStats[]> {
  // An empty root, as in R38 E6: the lock is under test, not the workspace parse.
  const root = await mkdtemp(path.join(tmpdir(), "speckiwi-srs-lock-load-root-"));
  try {
    return await Promise.all(
      Array.from(
        { length: PROCESSES },
        () =>
          new Promise<WorkerStats>((resolve, reject) => {
            const child = spawn(process.execPath, [worker, bundle, root, String(SUCCESSES), String(TTL_MS)], { stdio: ["ignore", "pipe", "inherit"] });
            let out = "";
            child.stdout.on("data", (chunk) => (out += chunk));
            child.on("error", reject);
            child.on("exit", () => resolve(JSON.parse(out.trim()) as WorkerStats));
          })
      )
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe.skipIf(!process.env.SPECKIWI_STRESS)("REL-NODE-009 AC-11 — multi-process load [stress]", () => {
  it(`REL-NODE-009 AC-11: ${PROCESSES} processes x ${SUCCESSES} mutations, ${RUNS} run(s): no gap reaches the TTL and nothing throws`, async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "speckiwi-srs-lock-load-"));
    try {
      const bundle = await bundleSrsLock(dir);
      const worker = path.join(dir, "worker.mjs");
      await writeFile(worker, WORKER_SOURCE, "utf8");
      const runs: Array<{ maxWaitMs: number; threw: number; ok: number }> = [];
      for (let run = 0; run < RUNS; run += 1) {
        const stats = await oneRun(bundle, worker);
        runs.push({
          maxWaitMs: Math.max(...stats.map((item) => item.maxWaitMs)),
          threw: stats.reduce((sum, item) => sum + item.threw, 0),
          ok: stats.reduce((sum, item) => sum + item.ok, 0)
        });
      }
      for (const [index, run] of runs.entries()) {
        expect(run.threw, `run ${index + 1}: exceptions escaped`).toBe(0);
        expect(run.maxWaitMs, `run ${index + 1}: a gap reached the ${TTL_MS} ms TTL`).toBeLessThan(TTL_MS);
        expect(run.ok).toBe(PROCESSES * SUCCESSES);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 1_800_000);
});
