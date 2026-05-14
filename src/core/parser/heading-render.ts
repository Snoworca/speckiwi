/**
 * SRS-MD-Rules v1.1.0 §30.1 / §30.2 — heading line renderer.
 * The inverse of parseRequirementHeading: building blocks must satisfy
 *   parse(render(x)) ≡ x  (semantic round-trip)
 * and
 *   render(parse(line)) ≡ line  (byte-identical round-trip) for every well-formed input fixture.
 *
 * Successor decoration follows §30.1 (discarded → see Y +N) and §30.2 (draft — pending decision[, see Y +N]).
 * Inner content for DRAFT is the canonical "pending decision" string; non-canonical bodies (e.g. "pending user decision")
 * are out of scope for this renderer and should be normalised by upstream callers when they construct headings.
 */

export interface HeadingRenderInput {
  id: string;
  title: string;
  strikethrough?: boolean;
  marker?: "DISCARDED" | "DRAFT";
  successorId?: string;
  successorCount?: number;
}

function renderInnerContent(input: HeadingRenderInput): string | undefined {
  if (input.marker === "DISCARDED") {
    if (!input.successorId) return "DISCARDED";
    const tail = input.successorCount && input.successorCount > 0 ? ` +${input.successorCount}` : "";
    return `DISCARDED → see ${input.successorId}${tail}`;
  }
  if (input.marker === "DRAFT") {
    if (!input.successorId) return "DRAFT — pending decision";
    const tail = input.successorCount && input.successorCount > 0 ? ` +${input.successorCount}` : "";
    return `DRAFT — pending decision, see ${input.successorId}${tail}`;
  }
  return undefined;
}

export function renderHeadingLine(input: HeadingRenderInput): string {
  const body = `${input.id} — ${input.title}`;
  const wrapped = input.strikethrough ? `~~${body}~~` : body;
  const inner = renderInnerContent(input);
  return inner ? `### ${wrapped} [${inner}]` : `### ${wrapped}`;
}
