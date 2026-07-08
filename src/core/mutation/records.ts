import { createHash } from "node:crypto";
import type { RequirementRecord, Stability } from "../types.js";

// FR-NODE-036 — content-hash utilities for requirement records.

/**
 * Frozen-protocol version tag for the semantic hash. The hash input is bound to
 * this prefix so the algorithm can evolve under a new version without silently
 * changing previously documented hashes.
 */
const FPV1 = "fpv=1";

/** Metadata keys excluded from the semantic hash (DENY set). */
const METADATA_DENY = new Set(["Status", "Stability"]);

/**
 * Normalizes text for hashing: CRLF to LF, per-line trailing-whitespace strip,
 * whitespace runs collapsed to a single space, and outer trim.
 * @req FR-NODE-036
 */
function normalize(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""))
    .join("\n")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Computes the semantic content hash of a requirement under the fpv=1 contract.
 *
 * Pure function: the hash is sha1 (40-char lowercase hex) over the fpv1 tag
 * joined with the normalized requirement text, AC text (id + text, excluding
 * checked state), the canonical Scope, and metadata excluding the
 * Status/Stability keys. Scope is taken from the top-level `record.scope`
 * derived field rather than from a metadata key, because the parser stores
 * scope only at the top level (no "Scope" metadata key is emitted), so this is
 * the only way Scope contributes to the hash for real parsed records. Trace
 * Links, Verification Evidence, Change Notes, and the record-level
 * status/stability fields do not contribute.
 * @req FR-NODE-036
 */
export function computeSemanticSha(record: RequirementRecord): string {
  const acceptance = record.acceptanceCriteria
    .map((ac) => `${ac.id} ${normalize(ac.text)}`)
    .join("");

  const metadata = Object.entries(record.metadata)
    .filter(([key]) => !METADATA_DENY.has(key))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key} ${normalize(value)}`)
    .join("");

  const scope = `Scope ${normalize(record.scope ?? "")}`;

  const input = [FPV1, normalize(record.requirement ?? ""), acceptance, scope, metadata].join("");

  return createHash("sha1").update(input, "utf8").digest("hex");
}

// FR-NODE-037 — REQ-ID raw-byte ordering and depends_on blast-radius closure.

/**
 * Orders two REQ-IDs by raw byte (code-unit) comparison, selecting the min-side
 * block for single-row normalization. Returns a negative number when `a` sorts
 * before `b`, a positive number when after, and zero when equal. The ordering
 * is antisymmetric and locale-independent: `<`/`>` on JavaScript strings compare
 * by UTF-16 code unit, so uppercase letters sort before lowercase ones.
 * @req FR-NODE-037
 */
export function compareReqId(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** Stability values whose outgoing depends_on edges are not traversed. */
const BLAST_RADIUS_CUT_STABILITY = new Set<Stability>(["frozen", "stable"]);

/** Maximum hop distance from the seed set included in a blast radius. */
const BLAST_RADIUS_MAX_HOPS = 2;

/**
 * Computes the transitive depends_on closure reachable within at most two hops
 * from the seed set. The seeds themselves are part of the closure. Traversal
 * stops at requirements whose stability is frozen or stable: such a node is
 * still included (it is the edge we stop at), but its outgoing depends_on edges
 * are not followed.
 *
 * Pure function: it neither mutates the input records (nor their trace links)
 * nor performs I/O, and returns an equal closure for equal inputs.
 * @req FR-NODE-037
 */
export function computeBlastRadius(seeds: readonly string[], records: readonly RequirementRecord[]): Set<string> {
  const byId = new Map<string, RequirementRecord>();
  for (const record of records) byId.set(record.id, record);

  const closure = new Set<string>();
  // Each frontier entry pairs a REQ-ID with the hop distance at which it was
  // first reached, so the 2-hop bound can be enforced during traversal.
  let frontier: Array<{ id: string; hop: number }> = seeds.map((id) => ({ id, hop: 0 }));

  while (frontier.length > 0) {
    const next: Array<{ id: string; hop: number }> = [];
    for (const { id, hop } of frontier) {
      if (closure.has(id)) continue;
      closure.add(id);

      if (hop >= BLAST_RADIUS_MAX_HOPS) continue;
      const record = byId.get(id);
      if (!record) continue;
      if (record.stability && BLAST_RADIUS_CUT_STABILITY.has(record.stability)) continue;

      for (const link of record.traceLinks) {
        if (link.relation !== "depends_on") continue;
        if (!closure.has(link.reference)) next.push({ id: link.reference, hop: hop + 1 });
      }
    }
    frontier = next;
  }

  return closure;
}
