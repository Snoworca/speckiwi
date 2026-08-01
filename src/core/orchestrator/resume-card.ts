// @req FR-NODE-151 — the resume card: read, validated on write, and serialised.
//
// The card is the only mandatory read on resume, so an uncapped or unvalidated card degenerates into
// a second journal and a drifting one silently changes what a resumed session believes.
//
// The journal view is a PARAMETER rather than something this module reads: profile immutability is a
// rule against the journal, and a function cannot check an input it is not given. Nothing here
// touches the filesystem — `writeCard` returns the bytes and the path, and the CLI performs the write,
// so a card that fails validation has no serialisation for anything to write.
import { createHash } from "node:crypto";
import {
  CARD_PRECONDITIONS,
  PROOF_KINDS,
  RESUME_CARD_MAX_BYTES,
  isVerb,
  type CardPrecondition,
  type Engine,
  type ProofKind,
  type VerbName
} from "./journal-schema.js";
import type { WavesJournalView } from "./waves-journal.js";

export interface CardProof {
  kind: ProofKind;
  ref: string;
}

export interface CardDoneEntry {
  key: string;
  proof: CardProof;
  /** Mandatory, and never of kind `journal`, when `proof.kind` is `journal` (05 §4.1 property 2). */
  witness?: CardProof;
}

export interface CardOpenEntry {
  key: string;
  state: string;
  base_sha: string;
  head_sha: string;
  journal_line: number;
}

export interface FrozenBlock {
  engine: Engine;
  work_root: string;
  journal: string;
  run_root: { git_toplevel: string; mcp_workspace_root: string };
  isolation_profile: string;
  base_branch: string;
  integration_branch: string;
  /** Only the CURRENT wave's entry is retained; a completed wave's lock is reachable from its proof. */
  lane_lock: Record<string, string>;
  [key: string]: unknown;
}

export interface ResumeCard {
  schema_version: string;
  run_id: string;
  run_contract: string;
  position: { wave: number; stage: number; phase: string };
  next_action: { verb: VerbName; args: Record<string, unknown>; preconditions: CardPrecondition[] };
  frozen: FrozenBlock;
  done: CardDoneEntry[];
  open: CardOpenEntry[];
  blocked_on: string | null;
  invariant_digest: string;
  written_at: string;
}

export type CardViolation =
  | "malformed-card"
  | "resume-card-too-large"
  | "unknown-verb"
  | "unknown-precondition"
  | "unknown-proof-kind"
  | "journal-proof-without-witness"
  | "invariant-digest-mismatch"
  | "isolation-profile-changed"
  | "lane-lock-not-rolled-up"
  | "lane-entry-not-rolled-up";

export interface CardValidation {
  ok: boolean;
  violations: CardViolation[];
}

export type ReadCardResult = { ok: true; card: ResumeCard } | { ok: false; violations: CardViolation[] };
export type WriteCardResult = { ok: true; text: string; relativePath: string } | { ok: false; violations: CardViolation[] };

/** Key-sorted, whitespace-free JSON, so the digest depends on the values and never on key order. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const entries = Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/**
 * The digest over the whole `frozen` block. The isolation profile, the integration branch, the base
 * branch, the engine, the work root and the run root all live inside that block precisely so the
 * digest covers them — in the first revision the first six were siblings outside it, and §5.4's claim
 * that the profile is immutable for the run had no enforcement anywhere.
 */
export function computeInvariantDigest(frozen: FrozenBlock): string {
  return `sha256:${createHash("sha256").update(canonicalJson(frozen)).digest("hex")}`;
}

/** The run-scoped path the card is written to (05 §4.1). */
export function resumeCardPath(runId: string): string {
  return `kiwi/orchestrator/${runId}/resume-card.json`;
}

/** `wave-{n}/s{m}/lane-{k}` -> n. Any other key shape -> null. */
function laneEntryWave(key: string): number | null {
  const match = /^wave-(\d+)\/s\d+\/lane-[^/]+$/.exec(key);
  return match ? Number.parseInt(match[1] as string, 10) : null;
}

/** The isolation profile the journal's `probe-isolation` result recorded, if any. */
function probedIsolationProfile(journal: WavesJournalView): string | null {
  for (const event of journal.lines) {
    if (event.verb !== "probe-isolation") continue;
    if (event.event !== "result") continue;
    const isolation = event.isolation;
    if (typeof isolation !== "object" || isolation === null) continue;
    const profile = (isolation as { profile?: unknown }).profile;
    if (typeof profile === "string") return profile;
  }
  return null;
}

export function validateCard(card: ResumeCard, journal: WavesJournalView): CardValidation {
  const violations: CardViolation[] = [];

  const serialised = JSON.stringify(card);
  if (Buffer.byteLength(serialised, "utf8") > RESUME_CARD_MAX_BYTES) violations.push("resume-card-too-large");

  if (!isVerb(card.next_action?.verb ?? "")) violations.push("unknown-verb");
  const preconditions = card.next_action?.preconditions ?? [];
  if (preconditions.some((value) => !(CARD_PRECONDITIONS as readonly string[]).includes(value))) {
    violations.push("unknown-precondition");
  }

  for (const entry of card.done ?? []) {
    const kinds: unknown[] = [entry.proof?.kind, entry.witness?.kind].filter((kind) => kind !== undefined);
    if (kinds.some((kind) => !(PROOF_KINDS as readonly unknown[]).includes(kind))) {
      if (!violations.includes("unknown-proof-kind")) violations.push("unknown-proof-kind");
    }
    // A wave-completion entry proves its verdict by journal line; the witness is what keeps the entry
    // recomputable once the journal is truncated, which is the event the card exists to survive.
    if (entry.proof?.kind === "journal") {
      const witnessKind = entry.witness?.kind;
      if ((witnessKind === undefined || witnessKind === "journal") && !violations.includes("journal-proof-without-witness")) {
        violations.push("journal-proof-without-witness");
      }
    }
  }

  if (card.invariant_digest !== computeInvariantDigest(card.frozen)) violations.push("invariant-digest-mismatch");

  const probed = probedIsolationProfile(journal);
  if (probed !== null && probed !== card.frozen?.isolation_profile) violations.push("isolation-profile-changed");

  const currentWave = card.position?.wave;
  const laneLockKeys = Object.keys(card.frozen?.lane_lock ?? {});
  if (laneLockKeys.some((key) => key !== `wave-${currentWave}`)) violations.push("lane-lock-not-rolled-up");

  const rolledUpWaves = new Set((card.done ?? []).map((entry) => entry.key));
  const unrolled = (card.done ?? []).some((entry) => {
    const wave = laneEntryWave(entry.key);
    if (wave === null) return false;
    // A lane entry survives only for the wave still in progress; once the wave's own entry exists the
    // lane entries are collapsed into it, and a lane entry for an earlier wave is stale by definition.
    return wave !== currentWave || rolledUpWaves.has(`wave-${wave}`);
  });
  if (unrolled) violations.push("lane-entry-not-rolled-up");

  return { ok: violations.length === 0, violations };
}

export function readCard(text: string): ReadCardResult {
  let parsed: unknown;
  try {
    // JSON.parse is the one boundary with no non-throwing form in Node; the throw is converted here
    // rather than becoming control flow anywhere above.
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, violations: ["malformed-card"] };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false, violations: ["malformed-card"] };
  }
  return { ok: true, card: parsed as ResumeCard };
}

/**
 * Validates and serialises. A card failing validation produces no `text`, so nothing downstream has
 * bytes to write — the cap and the enums are enforced by the writer, not by convention.
 */
export function writeCard(card: ResumeCard, journal: WavesJournalView): WriteCardResult {
  const validation = validateCard(card, journal);
  if (!validation.ok) return { ok: false, violations: validation.violations };
  return { ok: true, text: `${JSON.stringify(card, null, 2)}\n`, relativePath: resumeCardPath(card.run_id) };
}
