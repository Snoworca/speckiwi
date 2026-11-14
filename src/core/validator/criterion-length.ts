/**
 * @req FR-NODE-307 AC-5 — the one declaration of the long-criterion warning threshold (SRS-W083),
 * in UTF-16 code units. A warning, never a write refusal: every acceptance-criterion write route
 * takes text of any length. 4,000 sits above the longest criterion this repository carries
 * (2,708 characters) and below the design prose OG packed into single criteria.
 */
export const LONG_CRITERION_THRESHOLD = 4000;
