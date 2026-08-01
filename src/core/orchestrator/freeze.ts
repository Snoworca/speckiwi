import { createHash } from "node:crypto";
import type { LanePlanInput } from "./lane-plan.js";

/**
 * Lock generation — 05 §3.3a's six freeze targets, their common envelope and their per-kind bodies.
 *
 * @req FR-NODE-138
 *
 * Scope, per §10.5 step 1′: this module is `freeze`'s **lock-generation half** only. The H1 pinning
 * primitive — the real `git_blob_oid`, the size caps and the substitution re-proof — already lives in
 * `pinning.ts` and is not re-implemented here; the caller pins, then passes the resulting oid in.
 * Everything else this module needs arrives injected too, which is what makes §10.3's byte-determinism
 * property a Layer-1 unit test rather than one that reads disk.
 */

/** 05 §3.3a. Revision 2 stated three different sets of five; the set is six and this is the census. */
export const FREEZE_LOCK_KINDS = ["design", "waves", "lanes", "handoff", "issues", "postmortem"] as const;
export type FreezeLockKind = (typeof FREEZE_LOCK_KINDS)[number];

export const LOCK_SCHEMA_VERSION = "1.0.0";

/**
 * The five `lanes.lock.json` fields that record an input as a digest.
 *
 * @req FR-NODE-138 AC-5 — five, not six: §22 C-27 corrected the gloss in place.
 */
export const LANES_LOCK_DIGEST_FIELDS = [
  "sidecar_digest",
  "registry_digest",
  "existing_paths_digest",
  "design_item_map_digest",
  "prior_postmortem_digests"
] as const;

/**
 * The eight fields `lanes.lock.json` records: the five digests above plus `lane_cap`, `code_roots`
 * and `test_roots`, which are recorded as literal values because a digest of a number or of a short
 * array buys nothing a §4.7 digest-3 recomputation could use (§22 AA-01, Z8).
 *
 * Eight recorded fields, nine pinned inputs — `sidecar_digest` covers two. The two counts are not in
 * conflict; see `LANE_PLAN_INPUT_PINS`.
 */
export const LANES_LOCK_RECORDED_INPUT_FIELDS = [
  ...LANES_LOCK_DIGEST_FIELDS,
  "lane_cap",
  "code_roots",
  "test_roots"
] as const;
export type LanesLockRecordedField = (typeof LANES_LOCK_RECORDED_INPUT_FIELDS)[number];

/**
 * Which recorded field pins each of `computeLanePlan`'s nine declared inputs.
 *
 * @req FR-NODE-138 AC-6 — the map is keyed on `keyof LanePlanInput`, so an input added to the kernel
 * without a recorded field to pin it fails to compile here rather than making §4.7 digest 3 silently
 * recompute against an input the lock never named.
 */
export const LANE_PLAN_INPUT_PINS: Record<keyof LanePlanInput, LanesLockRecordedField> = {
  // `existing_modules` is derived from the sidecar, so one digest covers both (§4.7 digest 3).
  catalog: "sidecar_digest",
  existingModules: "sidecar_digest",
  registry: "registry_digest",
  existingPaths: "existing_paths_digest",
  designItemMap: "design_item_map_digest",
  priorPostmortems: "prior_postmortem_digests",
  laneCap: "lane_cap",
  codeRoots: "code_roots",
  testRoots: "test_roots"
};

export interface LanePlanInputPin {
  readonly recordedField: LanesLockRecordedField;
  readonly recordedValue: unknown;
}

/**
 * The nine declared `computeLanePlan` inputs, each resolved to the value the lock **itself** recorded.
 *
 * @req FR-NODE-138 AC-6 — §4.7 digest 3 recomputes "the nine inputs the lock itself records, not the
 * nine inputs available today", and this is the function that reads them back.
 */
export function reconstructLanePlanInputPins(lanesBody: Record<string, unknown>): Record<keyof LanePlanInput, LanePlanInputPin> {
  const entries = Object.entries(LANE_PLAN_INPUT_PINS) as Array<[keyof LanePlanInput, LanesLockRecordedField]>;
  return Object.fromEntries(
    entries.map(([input, recordedField]) => [input, { recordedField, recordedValue: lanesBody[recordedField] }])
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
// The six per-kind body schemas — 05 §3.3a
// ---------------------------------------------------------------------------------------------

/**
 * A body's required keys. Presence, not deep shape: the deep shapes are produced by kernels that
 * already type them (`computeLanePlan` for `lanes`, `planStageCoupling` for `postmortem`), and
 * re-validating them here would be a second, drift-prone declaration of the same contract.
 * `null` is an admissible value — `stage` is marked `null` for an `epilogue` handoff (§22 AC-07) —
 * so the check is key presence rather than a truthiness test.
 */
const REQUIRED_BODY_FIELDS: Record<FreezeLockKind, readonly string[]> = {
  design: ["design_items", "integration_items", "out_of_scope"],
  waves: ["waves", "wave_count"],
  lanes: [
    "plan_run_id",
    "sidecar_path",
    ...LANES_LOCK_RECORDED_INPUT_FIELDS,
    "lane_count",
    "stage_count",
    "lanes",
    "serial_epilogue",
    "unassigned",
    "serialized",
    "conflicts"
  ],
  // One schema serves all three `handoff_kind` values (§3.3a); the carve-outs are on the *values*
  // (`task_field_count: 0` for `remediation`, `stage: null` for `epilogue`), never on the key set.
  handoff: [
    "handoff_kind",
    "lane_id",
    "stage",
    "handoff_path",
    "handoff_git_blob_oid",
    "handoff_sha256",
    "front_matter_digest",
    "body_heading_digests",
    "task_field_count",
    "acceptance_row_count",
    "untested_row_count"
  ],
  issues: ["wave", "issues", "counts"],
  postmortem: ["waves"]
};

function isFreezeLockKind(value: string): value is FreezeLockKind {
  return (FREEZE_LOCK_KINDS as readonly string[]).includes(value);
}

/**
 * Deterministic JSON: object keys sorted, arrays in order, no whitespace. Two callers that build the
 * same body with different key insertion orders must digest to the same bytes, because a lock is
 * compared byte-for-byte by §4.7 digest 3.
 */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const members = Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
    return `{${members.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * Freezes one lock.
 *
 * @req FR-NODE-138 — six kinds, per-kind body validation, and byte-identical output for the same
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
