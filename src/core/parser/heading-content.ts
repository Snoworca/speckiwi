/**
 * @req FR-NODE-266 AC-3 — SRS-E020: a requirement heading title must not hold an inline link, a code
 * span, bold or italic emphasis, or an emoji. The parser reports it and the title writers refuse it
 * through this one predicate, so a title a writer accepts never makes validate report SRS-E020.
 */
export function headingContainsForbiddenMarkdown(title: string): boolean {
  return (
    /\[[^\]]+\]\([^)]+\)/.test(title) ||
    /`[^`]+`/.test(title) ||
    /(^|[\s([{])(?:\*\*[^*\n]+\*\*|\*[^*\n]+\*|__[^_\n]+__|_[^_\n]+_)(?=$|[\s)\]},.:;!?])/.test(title) ||
    /\p{Extended_Pictographic}/u.test(title)
  );
}
