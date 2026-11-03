/**
 * The conservative token estimate FR-FLOW-204 AC-8, FR-FLOW-204 AC-9 and FR-FLOW-205 AC-7 fix:
 * one token per non-ASCII character plus one token per three ASCII characters, rounded up.
 *
 * Claude Code re-attaches the first 5,000 tokens of each invoked skill after a compaction, so a rule
 * that must survive a compaction has to end inside that budget. The three conditions share this one
 * function so they cannot drift apart. (`src/core/workflow/work-order.ts` has an `approxTokens`, but it
 * counts bytes / 4 — a different, less conservative estimate — so it is not reused here.)
 */
export const COMPACTION_TOKEN_BUDGET = 5000;

export function estimateTokens(text: string): number {
  let nonAscii = 0;
  let ascii = 0;
  for (const ch of text) {
    if ((ch.codePointAt(0) ?? 0) > 0x7f) nonAscii += 1;
    else ascii += 1;
  }
  return nonAscii + Math.ceil(ascii / 3);
}

/** The estimated tokens from the start of `text` up to and including the first occurrence of `needle`; -1 when absent. */
export function tokensThrough(text: string, needle: string): number {
  const at = text.indexOf(needle);
  return at < 0 ? -1 : estimateTokens(text.slice(0, at + needle.length));
}
