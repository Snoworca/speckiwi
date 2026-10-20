import { createHash } from "node:crypto";
import { canonicalJson } from "./canonical-json.js";
import type { WaveDependencies } from "./conflict.js";
import type { LanePlan, LanePlanInput } from "./lane-plan.js";

/**
 * Lock generation — 05 §3.3a's freeze targets (five since 4.0.0), their common envelope and their per-kind bodies.
 *
 * @req FR-NODE-138
 *
 * Scope, per §10.5 step 1′: this module is `freeze`'s **lock-generation half** only. The H1 pinning
 * primitive — the real `git_blob_oid`, the size caps and the substitution re-proof — already lives in
 * `pinning.ts` and is not re-implemented here; the caller pins, then passes the resulting oid in.
 * Everything else this module needs arrives injected too, which is what makes §10.3's byte-determinism
 * property a Layer-1 unit test rather than one that reads disk.
 */

/**
 * 05 §3.3a. Revision 2 stated three different sets of five; the set was six and this is the census.
 * @req FR-NODE-138 AC-1 — five since 4.0.0: `handoff` left with the English handoff documents.
 */
export const FREEZE_LOCK_KINDS = ["design", "waves", "lanes", "issues", "postmortem"] as const;
export type FreezeLockKind = (typeof FREEZE_LOCK_KINDS)[number];

export const LOCK_SCHEMA_VERSION = "1.0.0";

/**
 * The `lanes.lock.json` fields that record an input as a digest: SDS digests for each wave scheduled
 * with SDS files, and - for a lock planned from a wave declaration file (`--waves`) - one
 * declaration-entry digest per wave. @req FR-NODE-138 AC-5, FR-NODE-213 AC-2, FR-NODE-216 AC-7
 */
export const LANES_LOCK_DIGEST_FIELDS = ["sds_digests", "declaration_digests"] as const;

/**
 * The fields `lanes.lock.json` records: the digests plus `depends` and `lane_cap`, which are
 * recorded as literal values because a digest of a short map or of a number buys nothing a §4.7
 * digest-3 recomputation could use.
 */
export const LANES_LOCK_RECORDED_INPUT_FIELDS = [...LANES_LOCK_DIGEST_FIELDS, "depends", "lane_cap"] as const;
export type LanesLockRecordedField = (typeof LANES_LOCK_RECORDED_INPUT_FIELDS)[number];

/**
 * Which recorded fields pin each of `computeLanePlan`'s declared inputs.
 *
 * @req FR-NODE-138 AC-6 - the map is keyed on `keyof LanePlanInput`, so an input added to the kernel
 * without a recorded field to pin it fails to compile here rather than making §4.7 digest 3 silently
 * recompute against an input the lock never named. The waves' write sets come from SDS files or from
 * declaration entries, so `waves` is pinned by both digest fields (FR-NODE-216 AC-7).
 */
export const LANE_PLAN_INPUT_PINS: Record<keyof LanePlanInput, readonly LanesLockRecordedField[]> = {
  waves: ["sds_digests", "declaration_digests"],
  dependencies: ["depends"],
  laneCap: ["lane_cap"]
};

/**
 * What the lock records for one wave's SDS: the sha256 of its file, or — for a wave scheduled from
 * several SDS files (`--sds <waveId>=<file>,<file>`) — one sha256 per file, keyed by path, so the
 * §4.7 digest-3 check sees each file rather than a combination that hides which one moved.
 * @req FR-NODE-213 AC-2
 */
export type WaveSdsDigest = string | Readonly<Record<string, string>>;

export interface LanesLockSource {
  readonly plan: LanePlan;
  /** The dependencies as declared — a wave with no key depends on every earlier wave. */
  readonly dependencies: WaveDependencies;
  readonly laneCap: number;
  /** Each SDS-scheduled wave's SDS digest, keyed by wave id. */
  readonly sdsDigests: Readonly<Record<string, WaveSdsDigest>>;
  /** Each SDS-scheduled wave's SDS path, or its SDS files in order, keyed by wave id. */
  readonly sdsPaths: Readonly<Record<string, string | readonly string[]>>;
  /** Present only for a plan read from a wave declaration file (`--waves`). @req FR-NODE-216 AC-7 */
  readonly declaration?: {
    /** The declaration file, as the caller named it. */
    readonly path: string;
    /** One entry digest per planned wave, keyed by wave id. */
    readonly digests: Readonly<Record<string, string>>;
  };
}

function sortedKeys<T>(record: Readonly<Record<string, T>>, map: (value: T) => T): Record<string, T> {
  return Object.fromEntries(Object.keys(record).sort().map((key) => [key, map(record[key] as T)]));
}

function sortedDigest(digest: WaveSdsDigest): WaveSdsDigest {
  return typeof digest === "string" ? digest : sortedKeys(digest, (fileDigest) => fileDigest);
}

function sdsPathOf(sds: string | readonly string[] | undefined): string | string[] | null {
  if (sds === undefined) return null;
  return typeof sds === "string" ? sds : [...sds];
}

/**
 * The `lanes.lock.json` document `orchestrate schedule waves` writes, which is also a valid `lanes`
 * freeze body. Every map is written in sorted key order and every dependency list sorted, so equal
 * inputs produce equal bytes however the caller ordered its `--depends` object.
 * @req FR-NODE-213 AC-1, AC-2
 */
export function buildLanesLockBody(source: LanesLockSource): Record<string, unknown> {
  return {
    lane_cap: source.laneCap,
    depends: sortedKeys(source.dependencies, (list) => [...new Set(list)].sort()),
    ...(source.declaration === undefined
      ? {}
      : { declaration: source.declaration.path, declaration_digests: sortedKeys(source.declaration.digests, (digest) => digest) }),
    sds_digests: sortedKeys(source.sdsDigests, sortedDigest),
    lane_count: source.plan.laneCount,
    stage_count: source.plan.stageCount,
    lanes: source.plan.lanes.map((lane) => ({
      laneId: lane.laneId,
      stage: lane.stage,
      wave: lane.wave,
      sds: sdsPathOf(source.sdsPaths[lane.wave]),
      writeSet: lane.writeSet
    })),
    stages: source.plan.stages,
    conflicts: source.plan.conflicts
  };
}

export interface LanePlanInputPin {
  readonly recordedFields: readonly LanesLockRecordedField[];
  /** Each pinned field's recorded value, `undefined` when the lock does not carry it. */
  readonly recordedValues: Readonly<Partial<Record<LanesLockRecordedField, unknown>>>;
}

/**
 * The declared `computeLanePlan` inputs, each resolved to the value the lock **itself** recorded.
 *
 * @req FR-NODE-138 AC-6 — §4.7 digest 3 recomputes the inputs the lock itself records, not the inputs
 * available today, and this is the function that reads them back.
 */
export function reconstructLanePlanInputPins(lanesBody: Record<string, unknown>): Record<keyof LanePlanInput, LanePlanInputPin> {
  const entries = Object.entries(LANE_PLAN_INPUT_PINS) as Array<[keyof LanePlanInput, readonly LanesLockRecordedField[]]>;
  return Object.fromEntries(
    entries.map(([input, recordedFields]) => [
      input,
      { recordedFields, recordedValues: Object.fromEntries(recordedFields.map((field) => [field, lanesBody[field]])) }
    ])
  ) as Record<keyof LanePlanInput, LanePlanInputPin>;
}

// ---------------------------------------------------------------------------------------------
// The envelope
// ---------------------------------------------------------------------------------------------

/** 05 §3.3a's common envelope, in the order the design states it. */
export interface Lock {
  readonly schema_version: string;
  readonly run_id: string;
  readonly kind: FreezeLockKind;
  readonly inputs_digest: string;
  readonly git_blob_oid: string;
  readonly sha256: string;
  readonly written_at: string;
  readonly body: Record<string, unknown>;
}

/**
 * Everything `freezeLock` would otherwise have had to read.
 *
 * `declaredInputs` is separated from the three envelope facts deliberately: `inputs_digest` covers
 * "the exact inputs the lock was computed from" and §4.7 digest 2 re-digests those inputs later to
 * compare. Folding `writtenAt` into that digest would make the comparison unsatisfiable by
 * construction, so the timestamp is an envelope fact and not a declared input.
 */
export interface FreezeInputs {
  readonly runId: string;
  /** From `pinning.ts`. This module performs no git call of its own. */
  readonly gitBlobOid: string;
  readonly writtenAt: string;
  readonly declaredInputs: Record<string, unknown>;
}

export type FreezeRefusalCode = "unknown-lock-kind" | "lock-body-invalid";

export type FreezeResult = { readonly ok: true; readonly lock: Lock } | { readonly ok: false; readonly code: FreezeRefusalCode; readonly detail: string };

// ---------------------------------------------------------------------------------------------
// The five per-kind body schemas — 05 §3.3a
// ---------------------------------------------------------------------------------------------

/**
 * A body's required keys. Presence, not deep shape: the deep shapes are produced by kernels that
 * already type them (`computeLanePlan` for `lanes`), and re-validating them here would be a second,
 * drift-prone declaration of the same contract. The one lanes-kind exception is the digest-per-wave
 * pairing, which no kernel produces.
 * The check is key presence rather than a truthiness test, so a field recorded as `null` is present.
 */
const REQUIRED_BODY_FIELDS: Record<FreezeLockKind, readonly string[]> = {
  design: ["design_items", "integration_items", "out_of_scope"],
  waves: ["waves", "wave_count"],
  // `declaration_digests` is required only of a lock planned from a declaration; `lanesDigestMismatch` says so.
  lanes: ["sds_digests", "depends", "lane_cap", "lane_count", "stage_count", "lanes", "conflicts"],
  issues: ["wave", "issues", "counts"],
  postmortem: ["waves"]
};

function isFreezeLockKind(value: string): value is FreezeLockKind {
  return (FREEZE_LOCK_KINDS as readonly string[]).includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** `field` must name exactly `waves`: a wave without a digest is one digest 3 can never find drifted. */
function keysMismatch(field: string, digests: Record<string, unknown>, waves: readonly unknown[]): string | null {
  const keys = new Set(Object.keys(digests));
  const undigested = waves.filter((wave) => typeof wave !== "string" || !keys.has(wave));
  const orphaned = [...keys].filter((key) => !waves.includes(key));
  if (undigested.length === 0 && orphaned.length === 0) return null;
  return `lanes lock ${field} must name exactly the waves its lanes carry: without a digest [${undigested.map(String).join(", ")}], digest without a lane [${orphaned.join(", ")}]`;
}

/**
 * @req FR-NODE-138 AC-2, AC-5 - the digests a lanes lock must carry for the plan it records. A lock
 * planned from SDS files carries one SDS digest per wave; a lock planned from a declaration file
 * (marked by `declaration`) carries one declaration-entry digest per wave and SDS digests for exactly
 * the waves whose lane names SDS files. Key presence alone establishes neither pairing.
 */
function lanesDigestMismatch(body: Record<string, unknown>): string | null {
  const lanes = body.lanes;
  if (!isRecord(body.sds_digests) || !Array.isArray(lanes)) {
    return "lanes lock body needs sds_digests as an object keyed by wave and lanes as an array";
  }
  const laneOf = (lane: unknown): { wave?: unknown; sds?: unknown } => (isRecord(lane) ? lane : {});
  const waves = lanes.map((lane) => laneOf(lane).wave);
  if (!Object.prototype.hasOwnProperty.call(body, "declaration")) return keysMismatch("sds_digests", body.sds_digests, waves);
  if (!isRecord(body.declaration_digests)) {
    return "lanes lock planned from a declaration needs declaration_digests as an object keyed by wave";
  }
  const sdsWaves = lanes.filter((lane) => laneOf(lane).sds !== null && laneOf(lane).sds !== undefined).map((lane) => laneOf(lane).wave);
  return keysMismatch("declaration_digests", body.declaration_digests, waves) ?? keysMismatch("sds_digests", body.sds_digests, sdsWaves);
}

function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * Freezes one lock.
 *
 * @req FR-NODE-138 — five kinds, per-kind body validation, and byte-identical output for the same
 * `(kind, body, inputs)` triple. A body that fails its schema is **refused**, not frozen: the five
 * gates that read these locks would otherwise read a lock missing the field they key on.
 *
 * The refusal is a returned result rather than a thrown error because an agent-authored body failing
 * its schema is an ordinary, expected branch of `orchestrate freeze` — the caller renders it as a
 * gate refusal — not an exceptional condition.
 */
export function freezeLock(kind: FreezeLockKind, body: Record<string, unknown>, inputs: FreezeInputs): FreezeResult {
  if (typeof kind !== "string" || !isFreezeLockKind(kind)) {
    return { ok: false, code: "unknown-lock-kind", detail: `lock kind ${String(kind)} is not one of: ${FREEZE_LOCK_KINDS.join(", ")}` };
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, code: "lock-body-invalid", detail: `${kind} lock body must be an object` };
  }

  const missing = REQUIRED_BODY_FIELDS[kind].filter((field) => !Object.prototype.hasOwnProperty.call(body, field));
  if (missing.length > 0) {
    return { ok: false, code: "lock-body-invalid", detail: `${kind} lock body is missing required field(s): ${missing.join(", ")}` };
  }
  if (kind === "lanes") {
    const mismatch = lanesDigestMismatch(body);
    if (mismatch !== null) return { ok: false, code: "lock-body-invalid", detail: mismatch };
  }

  const inputsDigest = sha256Hex(canonicalJson(inputs.declaredInputs));
  const unsealed = {
    schema_version: LOCK_SCHEMA_VERSION,
    run_id: inputs.runId,
    kind,
    inputs_digest: inputsDigest,
    git_blob_oid: inputs.gitBlobOid,
    written_at: inputs.writtenAt,
    // The body is canonicalised into the lock rather than digested and handed back as authored, so
    // two callers that build the same body in different key orders hold the same object as well as
    // the same digest — §4.7 digest 3 compares locks byte-for-byte, not digest-to-digest.
    body: JSON.parse(canonicalJson(body)) as Record<string, unknown>
  };
  // `sha256` covers every other field of the lock — envelope and body alike, `written_at` included
  // (AC-4). Stated as "everything except itself" rather than as a field list, so a field added to the
  // envelope later cannot fall outside the seal by omission.
  return { ok: true, lock: { ...unsealed, sha256: sha256Hex(canonicalJson(unsealed)) } };
}

/**
 * The bytes a `*.lock.json` file carries. One entry point, so no caller invents its own serialization
 * and lands a lock §4.7 digest 3 then reports as drifted on key order alone.
 */
export function serializeLock(lock: Lock): string {
  return canonicalJson(lock);
}
