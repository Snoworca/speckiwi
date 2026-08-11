// @req IR-CLI-092 — apply a reviewed replay plan at the host root, one accountable line at a time.
//
// `replay.ts` plans and `replay-admission.ts` decides; this is the half that was missing, and its
// absence is why the deferred-mutation contract lost what it accounted for: a lane recorded its four
// mandatory mutations into a queue, the planner marked them `apply`, and nothing consumed them.
//
// It takes the PLAN and not the queue. Re-planning at apply time would let the applied set differ
// from the reviewed one, and review is the only place a human sees what a lane asked the host to do.

import { appendFile, readFile } from "node:fs/promises";
import {
  type RefusedCall,
  type ReplayAttempt,
  admitReplayCalls,
  reduceReplayOutcomes
} from "./replay-admission.js";
import type { ReplayPlan } from "./replay.js";

/** The gate a failed replay raises; named so the orchestrator can halt on it rather than continue. */
export const REPLAY_FAILURE_GATE = "srs-mutation-replay-failed";

export type ReplayDispatchResult = { ok: true } | { ok: false; error: string };

/**
 * Performs one mutation at the host root. Injected rather than imported so this module holds no
 * opinion about which surface applies it, and so a test can assert what ran without an SRS on disk.
 */
export type ReplayDispatch = (tool: string, args: unknown) => Promise<ReplayDispatchResult>;

export interface ApplyReplayOptions {
  /** Append-only record of attempts; the file that makes an interrupted run resumable. */
  appliedPath: string;
  frozenTarget: string | null;
  dispatch: ReplayDispatch;
  dryRun?: boolean;
}

export interface ApplyReplayResult {
  ok: boolean;
  applied: number;
  /** Set only under `dryRun`, where nothing is applied and nothing is written. */
  wouldApply?: number;
  refused: RefusedCall[];
  /** Set only when a dispatch failed. */
  gate?: typeof REPLAY_FAILURE_GATE;
  failure?: { tool: string; argsHash: string; error: string };
}

/** Missing means nothing has been attempted yet, which is a first run's true state. */
async function readAttempts(file: string): Promise<ReplayAttempt[]> {
  const text = await readFile(file, "utf8").catch(() => null);
  if (text === null) return [];
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as ReplayAttempt);
}

/**
 * @req IR-CLI-092 — apply what the plan admits and the record does not already carry.
 *
 * Each attempt's line is appended BEFORE the next call is dispatched. Writing the batch at the end
 * would lose the account of exactly the run that needs it — the one that died midway — and the two
 * appending mutations (`add_completed_work`, `add_verification_evidence`) would then duplicate their
 * rows on resume.
 *
 * A failure stops the run rather than continuing past it. Continuing would keep applying calls that
 * may depend on the one that failed, and the record would then describe a state no single run
 * produced.
 */
export async function applyReplayPlan(plan: ReplayPlan, options: ApplyReplayOptions): Promise<ApplyReplayResult> {
  const admission = admitReplayCalls(plan, options.frozenTarget);
  const reduction = reduceReplayOutcomes(admission, await readAttempts(options.appliedPath));

  if (options.dryRun === true) {
    return { ok: true, applied: 0, wouldApply: reduction.remaining.length, refused: admission.refused };
  }

  let applied = 0;
  for (const entry of reduction.remaining) {
    const { tool, args, argsHash } = entry.call;
    const outcome = await options.dispatch(tool, args);
    const attempt: ReplayAttempt = { tool, argsHash, outcome: outcome.ok ? "applied" : "failed" };
    await appendFile(options.appliedPath, `${JSON.stringify(attempt)}\n`, "utf8");
    if (!outcome.ok) {
      return {
        ok: false,
        applied,
        refused: admission.refused,
        gate: REPLAY_FAILURE_GATE,
        failure: { tool, argsHash, error: outcome.error }
      };
    }
    applied += 1;
  }

  return { ok: true, applied, refused: admission.refused };
}
