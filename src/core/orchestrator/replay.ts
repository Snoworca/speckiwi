// @req FR-NODE-182 — the host-root replay planner for a lane's deferred SRS mutations (05 §P2 5.9).
//
// Charter C1 keeps SRS mutation out of every lane, but `kiwi-coder §0.12` makes four MCP mutations
// mandatory per Task. `--defer-srs-mutation` (FR-FLOW-121) resolves that by recording them instead
// of calling them; this plans their replay at the host root, once, after `collect()` has harvested
// the queue. Planning is separated from calling because 05 §1.1's boundary rule puts the decision in
// the tool and the effect in the caller — and because a plan is what `orchestrate replay plan`
// prints for review before anything is applied.

import { createHash } from "node:crypto";
import { canonicalJson } from "./canonical-json.js";

/** The closed vocabulary of what a plan may say about one recorded call. */
export const REPLAY_ACTIONS = ["apply", "skip-duplicate"] as const;

export type ReplayAction = (typeof REPLAY_ACTIONS)[number];

/**
 * One harvested `deferred-mutations.jsonl` entry, as far as the planner is concerned.
 *
 * The file's entries are `kiwi-coder`'s existing `mcp_call_log[]` shape —
 * `{tool, args, args_hash, ok, response_hash, dry_run, called_at}` (`kiwi-coder SKILL.md:569`) — and
 * the four members not declared here are read by nothing, deliberately:
 *
 * - `args_hash` is **recomputed** rather than trusted, so the key the plan dedupes on is always the
 *   key of the args it will actually send. A recorded hash that disagreed with its own args would
 *   otherwise make the plan skip or apply against a body it never hashed.
 * - `ok`, `response_hash` and `called_at` describe a call that did not happen. There is nothing for
 *   them to be true of in a deferred entry.
 * - `dry_run` has no replay semantics because it cannot occur: FR-FLOW-121 AC-7 refuses
 *   `--defer-srs-mutation` together with `--dry-run` at the producer, for precisely the reason that
 *   replaying such an entry is undefined.
 */
export interface DeferredMutation {
  tool: string;
  args: unknown;
}

/**
 * Applied `argsHash` values by tool name — the shape persisted at
 * `kiwi/orchestrator/{run_id}/replay-index.json` (05 RW-48), without which
 * `replay-deferred-mutations`'s `idempotent-by-key` recovery class has nothing to key against once
 * the session that applied the calls has been compacted away.
 */
export type ReplayIndex = Record<string, string[]>;

export interface ReplayCall {
  tool: string;
  args: unknown;
  argsHash: string;
  action: ReplayAction;
}

export interface ReplayPlan {
  calls: ReplayCall[];
  indexAfter: ReplayIndex;
}

/**
 * `sha1(canonicalJson(args))` — the tool name is **not** part of the hashed input.
 *
 * This is not a free choice. `kiwi-coder` already writes exactly this key into the queue, so a
 * planner that folded the tool name in would compute a different value for every recorded entry and
 * every lookup would miss — turning an `idempotent-by-key` verb into one that re-applies each lane's
 * evidence and completed-work rows on every resume.
 */
function argsHashOf(args: unknown): string {
  return createHash("sha1").update(canonicalJson(args), "utf8").digest("hex");
}

/**
 * @req FR-NODE-182 — plan the replay of a harvested queue against an index of what already ran.
 *
 * The dedupe key is the PAIR `(tool, argsHash)` even though the tool is outside the hash, because
 * the hash alone is not tool-unique: `update_status` and `add_completed_work` share an `{id, target}`
 * args shape, so keying on the hash alone would let whichever ran first silently swallow the other.
 *
 * Every entry produces a call — a skip is recorded, not dropped — so the plan is a complete account
 * of the queue and its length can be compared against the harvested line count.
 */
export function replayDeferredMutations(queue: readonly DeferredMutation[], dedupeIndex: ReplayIndex): ReplayPlan {
  // A copy per tool: the caller persists `indexAfter` while it may still hold `dedupeIndex`, so the
  // two must not share arrays, and the argument must come back unchanged.
  const applied = new Map<string, Set<string>>();
  for (const [tool, hashes] of Object.entries(dedupeIndex)) applied.set(tool, new Set(hashes));

  const calls: ReplayCall[] = [];
  for (const entry of queue) {
    const argsHash = argsHashOf(entry.args);
    const hashes = applied.get(entry.tool) ?? new Set<string>();
    const action: ReplayAction = hashes.has(argsHash) ? "skip-duplicate" : "apply";
    if (action === "apply") {
      // Recording it now is what dedupes the queue against ITSELF: a second copy of the same pair
      // later in the same queue is a duplicate exactly as a copy carried in from a prior run is.
      hashes.add(argsHash);
      applied.set(entry.tool, hashes);
    }
    calls.push({ tool: entry.tool, args: entry.args, argsHash, action });
  }

  // Sorted per tool so a resumed run's index does not depend on the order the calls happened to
  // arrive in. Tool keys keep the order they came in, which is already a function of the input.
  //
  // A NULL-PROTOTYPE object, not `{}`: assigning to the key `__proto__` on an ordinary object sets
  // the prototype and creates no own property, so that tool's hash would vanish from the index while
  // its call was still reported `apply` — the plan would claim an application the index does not
  // remember, and the next run would redo it. `JSON.stringify` serialises a null-prototype object
  // normally, so nothing downstream has to know. A tool name is a string from a harvested file, so
  // it is not this module's place to assume which strings it will be.
  const indexAfter = Object.create(null) as ReplayIndex;
  for (const [tool, hashes] of applied) indexAfter[tool] = [...hashes].sort();

  return { calls, indexAfter };
}
