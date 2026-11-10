// @req FR-NODE-285 — the shape of one issue-ledger row, and the two spellings of a wave number.
//
// The ledger keeps `wave` as an integer while the skill, the journal and the graph spell a wave
// `wave-<n>`. Both spellings are read here, once, so `issue open` stores the integer and
// `wave close` judges a row whichever way it was written.

import type { IssueRow } from "./issue-ledger.js";
import { isWaveName } from "./wave-name.js";

const WAVE_NUMBER = /^[1-9][0-9]*$/;

const OPTIONAL_TEXT_FIELDS = ["class", "source", "resolutionKind", "resolutionRef", "userDecisionRef", "designLockDigest", "deferralReason"] as const;

/** A row's `wave`: a positive integer or `wave-<n>`; anything else reads as no wave. */
export function issueRowWave(value: unknown): number | null {
  if (typeof value === "number") return Number.isSafeInteger(value) && value > 0 ? value : null;
  return isWaveName(value) ? Number(value.slice("wave-".length)) : null;
}

/** A `--wave` option: `n` or `wave-<n>`; anything else reads as no wave. */
export function waveOption(value: unknown): number | null {
  if (typeof value !== "string") return null;
  if (WAVE_NUMBER.test(value)) return Number(value);
  return issueRowWave(value);
}

export type IssueRowReading = { readonly ok: true; readonly row: IssueRow } | { readonly ok: false; readonly problems: readonly string[] };

/** Reads one row as `issue open` receives it: every field problem is named, and a valid row comes back normalised. */
export function readIssueRow(payload: Record<string, unknown>): IssueRowReading {
  const problems: string[] = [];
  if (typeof payload.issueId !== "string" || payload.issueId.length === 0) problems.push("issueId must be a non-empty string");
  const wave = issueRowWave(payload.wave);
  if (wave === null) problems.push(`wave must be a positive integer or wave-<n>, not ${JSON.stringify(payload.wave) ?? "(missing)"}`);
  for (const field of OPTIONAL_TEXT_FIELDS) {
    const value = payload[field];
    if (value !== undefined && value !== null && typeof value !== "string") problems.push(`${field} must be a string or null`);
  }
  if (problems.length > 0 || wave === null) return { ok: false, problems };
  const text = (field: (typeof OPTIONAL_TEXT_FIELDS)[number]): string | null => (payload[field] as string | null | undefined) ?? null;
  return {
    ok: true,
    row: {
      ...payload,
      issueId: payload.issueId as string,
      wave,
      class: text("class"),
      source: text("source") as string,
      resolutionKind: text("resolutionKind"),
      resolutionRef: text("resolutionRef"),
      userDecisionRef: text("userDecisionRef"),
      designLockDigest: text("designLockDigest"),
      deferralReason: text("deferralReason")
    }
  };
}
