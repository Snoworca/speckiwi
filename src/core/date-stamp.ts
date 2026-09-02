/**
 * FR-NODE-205 — the one producer of the `YYYY-MM-DD` stamp that mutations write into SRS, SDS and
 * step-state documents.
 *
 * The stamp follows the WRITER'S LOCAL calendar date, not UTC. Twelve modules previously carried
 * their own UTC day sliced off `toISOString()`, which stamped the UTC day; in KST (UTC+9) that
 * dated everything written between 00:00 and 09:00 local to the previous day, so a note and the
 * Change Note of the same session disagreed by one day inside one requirement block.
 *
 * `toDateStamp` takes the instant so tests can pin it without reaching for the system clock.
 */

/** The local calendar date of `instant`, as `YYYY-MM-DD`. */
export function toDateStamp(instant: Date): string {
  const year = String(instant.getFullYear()).padStart(4, "0");
  const month = String(instant.getMonth() + 1).padStart(2, "0");
  const day = String(instant.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** The local calendar date of now, as `YYYY-MM-DD`. */
export function todayStamp(): string {
  return toDateStamp(new Date());
}
