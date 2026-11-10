// The one spelling of a wave a graph node can carry: `wave-<n>`, n from 1, no leading zero. Kept in
// its own module so the ledger and the journal can read it without the declaration parser behind it.

/** The only wave name the journal view parses (`waveNumber`): `wave-<n>`, n from 1, no leading zero. */
export const WAVE_NAME = /^wave-[1-9][0-9]*$/;

/** Whether a value is a wave name a graph node can carry. @req FR-NODE-285, FR-NODE-286 */
export function isWaveName(value: unknown): value is string {
  return typeof value === "string" && WAVE_NAME.test(value);
}
