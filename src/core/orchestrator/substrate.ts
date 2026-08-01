// @req FR-NODE-136 — the cross-lane coupling check that runs at Phase 3.f″.
//
// What is NOT here is as load-bearing as what is. The `shared-substrate` conflict edge and its
// revision-2 replacement, the shared-substrate hoist, are both **withdrawn** as unsatisfiable
// (escalation X-04): §6.2 layer 4 rejects the handoff that would trigger the hoist one step earlier,
// and any file two lanes each declare creating is already forced same-lane by `write-set-overlap`.
// What survives is the coupling half — a path one lane writes and another reads — which uses only
// fields that exist once handoffs are authored and is covered by no conflict edge. It is therefore
// not a `conflict_reason`, it emits no `hoist`, and it takes no `existing_paths` argument.
import type { ParsedHandoff } from "./handoff.js";
import { compareStrings, normalizeDeclaredPath } from "./task-catalog.js";

// A parsed lane handoff (§6.1). `write_set` and `read_set` are lane-level front-matter arrays. The
// type is declared beside its producer, `readHandoff` in `handoff.ts`, and re-exported here so the
// existing consumers of this module keep their import.
export type { ParsedHandoff } from "./handoff.js";

/**
 * One cross-lane coupling. Exactly the three fields `ParsedHandoff[]` determines: `read_set` is a
 * lane-level field and `task_ids[]` is flat, so nothing task-keyed is derivable here. The caller,
 * `orchestrate coupling check`, loads the sidecar catalogue and resolves the postmortem row's
 * `from_task`; a 3.f″-sourced row records `to_task: null`, there being no per-task read surface at
 * all (X-04, R37). @req FR-NODE-136
 */
export interface StageCoupling {
  path: string;
  fromLane: string;
  toLane: string;
}

function pathSet(handoff: ParsedHandoff, field: "write_set" | "read_set"): string[] {
  const value = handoff.frontMatter[field];
  if (!Array.isArray(value)) return [];
  const paths = value
    .filter((item): item is string => typeof item === "string" && item.length > 0)
    .map(normalizeDeclaredPath);
  return [...new Set(paths)];
}

/**
 * One stage's cross-lane couplings: a path in one lane's `write_set` and another lane's `read_set`.
 * Lane A changes it; lane B compiles against it — the signature §7.5 calls "both lanes green in
 * isolation, red merged", which `write-set-overlap` cannot see because that rule is write ∩ write.
 *
 * A lane that both writes and reads one path is not coupled to itself. Output is sorted by path,
 * then writing lane, then reading lane, so two calls over the same handoffs are byte-identical
 * however the handoffs were ordered. @req FR-NODE-136
 */
export function planStageCoupling(handoffs: ParsedHandoff[]): { couplings: StageCoupling[] } {
  const couplings: StageCoupling[] = [];
  for (const writer of handoffs) {
    const written = new Set(pathSet(writer, "write_set"));
    if (written.size === 0) continue;
    for (const reader of handoffs) {
      if (reader.lane === writer.lane) continue;
      for (const path of pathSet(reader, "read_set")) {
        if (written.has(path)) couplings.push({ path, fromLane: writer.lane, toLane: reader.lane });
      }
    }
  }
  couplings.sort(
    (left, right) =>
      compareStrings(left.path, right.path) ||
      compareStrings(left.fromLane, right.fromLane) ||
      compareStrings(left.toLane, right.toLane)
  );
  return { couplings };
}
