// @req FR-NODE-248 — a Verification Evidence `Covers` cell names `all` or acceptance criteria one by
// one. Every coverage reader splits the cell into tokens, so `AC-1..AC-11` reads as two criteria and
// silently under-reports the nine between; the writer refuses that form and the validator reports it.

/** `AC-<n>`, then `..`, `-`, `~`, an en dash or an em dash, then another `AC-<m>`. */
const COVERS_RANGE = /AC-\d+\s*(?:\.\.|-|~|–|—)\s*AC-\d+/i;

/** The forms a `Covers` cell may take, as a refusal or a warning names them. */
export const COVERS_ACCEPTED_FORMS = "`all` or a comma-separated list of `AC-<n>`";

/** The first range a `Covers` cell holds, or `null` when it names criteria one by one. */
export function coversRangeIn(covers: string): string | null {
  return COVERS_RANGE.exec(covers)?.[0] ?? null;
}
