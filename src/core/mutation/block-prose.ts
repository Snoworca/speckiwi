import type { MutationResult } from "../types.js";
import { classifyDocumentLines, openStructureAfter, SRS_RECORD_LINES, type ClassifyOptions, type DocumentLineKind } from "../parser/document-lines.js";
import { headingContainsForbiddenMarkdown } from "../parser/heading-content.js";
import { mutationFail } from "./guards.js";

/**
 * @req FR-NODE-174 AC-9 — free prose a caller supplies is written into a requirement block verbatim.
 * A Markdown heading inside it does not decorate the text: the parser starts a NEW record there, so a
 * payload can carry a whole `### FR-… ` block reading `| Status | verified |` past a mutation that
 * validates only the record it thinks it is touching. Measured on three routes at once —
 * `edit_requirement_fields` via `statement`, `append_section_note`, and `replace_acceptance_criteria`
 * via an item's text — each landing a verified row whose evidence pointed outside the checkout.
 *
 * Sibling of `assertSafeMarkdownTableCell`, which closes the same class for values written into a
 * table cell. Cells forbid newline outright; prose fields must permit it, so the bound is the heading.
 */
/**
 * Deliberately looser than CommonMark, and the looseness is the point. CommonMark stops treating a
 * `#` as a heading once it is indented four spaces — that is an indented code block — but
 * `parseTopLevelSectionTitle` in `parser/block-scanner.ts` matches against `line.trim()`, so the
 * scanner sees a section wherever the `#` sits. A guard written to the stricter rule left the gap
 * between them open: measured, a `reason` of `"…\n    ## Notes\n"` passed a `\s{0,3}` guard, deleted
 * two requirements from the parsed model, and turned `ready: false` into `ready: true` with zero
 * validation errors. The guard follows the parser, because the parser is what decides what a
 * requirement block is.
 */
const OPENS_SECTION = /^\s*#{1,6}\s/;

/**
 * The other boundary movers are the structures that hide the lines after them from every reader: a
 * code fence (at the top level, after a list marker, inside a block quote) and an HTML comment block.
 * Which lines open one is the shared classifier's to say, not a pattern copied here, so when the
 * classifier learns a new structure this guard refuses it without a change of its own.
 *
 * The prose is classified on its own, with every opener taken as open even if nothing in the prose
 * closes it: a closer may be anywhere later in the document, and an opener that meets one swallows
 * everything between. A balanced pair is refused too. It is inert to the parsers, so that is stricter
 * than they need; it is kept because no requirement block carries such a structure today, so the rule
 * costs nothing, while an author who genuinely needs one in a block can relax this in the same change
 * as the parsers are taught where such a block may live.
 */
const PROSE_LINES: ClassifyOptions = { ...SRS_RECORD_LINES, unclosedOpens: true };

const MOVER_REASONS: Partial<Record<DocumentLineKind, string>> = {
  fence: "a code fence, which ends the requirement block for the parser and hides every block after it",
  comment: "an HTML comment block, which hides every block after it until a later `-->`"
};

/**
 * Refuses caller-supplied prose that would move a boundary of the requirement block it is written
 * into — by opening a section the block does not declare, or by opening a fenced or commented region
 * that swallows the blocks after it.
 */
export function assertOpensNoBlockBoundary<T = void>(label: string, value: string | undefined): MutationResult<T> | undefined {
  if (typeof value !== "string") return undefined;
  const lines = value.split(/\r?\n/);
  const heading = lines.find((line) => OPENS_SECTION.test(line));
  if (heading !== undefined) {
    return mutationFail(
      "USAGE",
      `${label} contains a Markdown heading and would open a section the requirement block does not declare: ${heading.trim()}`
    ) as MutationResult<T>;
  }
  const classified = classifyDocumentLines(lines, PROSE_LINES);
  const mover = classified.findIndex((line) => MOVER_REASONS[line.kind] !== undefined);
  if (mover >= 0) {
    const reason = MOVER_REASONS[classified[mover]!.kind];
    return mutationFail("USAGE", `${label} contains ${reason}: ${(lines[mover] ?? "").trim()}`) as MutationResult<T>;
  }
  return undefined;
}

/**
 * A value that is written into a single rendered line — a heading's title, a scope name. One
 * newline in it puts everything after it at column zero, where the parser reads it as document
 * structure. `edit_requirement_fields` has refused this since it was written; the create routes
 * did not, and a `title` carrying a forged `| Status | verified |` block was measured landing a
 * body row no granular edit can repair, because `assertEditable` refuses `verified`.
 */
export function assertSingleLine<T = void>(label: string, value: string | undefined): MutationResult<T> | undefined {
  if (typeof value !== "string") return undefined;
  if (!/[\r\n]/.test(value)) return undefined;
  return mutationFail("USAGE", `${label} cannot contain newline characters`) as MutationResult<T>;
}

/**
 * @req FR-NODE-266 AC-1 AC-2 AC-3 — a requirement heading title: one line, and nothing the parser
 * reports as SRS-E020. The rule is the parser's own predicate, so the two cannot drift apart.
 */
export function assertRequirementTitle<T = void>(label: string, value: string | undefined): MutationResult<T> | undefined {
  const oneLine = assertSingleLine<T>(label, value);
  if (oneLine || typeof value !== "string") return oneLine;
  if (!headingContainsForbiddenMarkdown(value.trim())) return undefined;
  return mutationFail(
    "USAGE",
    `${label} cannot contain an inline link, a code span, bold or italic emphasis, or an emoji (SRS-E020)`
  ) as MutationResult<T>;
}

/**
 * A whole requirement block being copied from one document into another — `promote_step_requirement`
 * takes the step record's markdown verbatim. `assertOpensNoBlockBoundary` cannot be used here: this
 * value is SUPPOSED to open a section, exactly one, at its first line.
 *
 * What it must not do is open a second one, or leave a fence hanging. Measured: a step block ending
 * in an unclosed fence promoted cleanly, deleted two requirements from the body document's parsed
 * model, and turned `ready` false into true with no validation error and no advisory. The step file
 * parses it as one record because the scanner simply runs the block to end of file there — so the
 * defect is invisible until the block is somewhere that has content after it.
 */
export function assertPromotableBlock<T = void>(label: string, markdown: string): MutationResult<T> | undefined {
  const lines = markdown.split(/\r?\n/);
  const headings = lines.filter((line) => /^###\s/.test(line));
  if (headings.length !== 1 || !/^###\s/.test(lines[0] ?? "")) {
    return mutationFail(
      "MUTATION_DENIED",
      `${label} must be exactly one requirement block beginning with its heading; found ${headings.length} requirement headings`
    ) as MutationResult<T>;
  }
  const topLevel = lines.find((line) => /^#{1,2}\s/.test(line));
  if (topLevel !== undefined) {
    return mutationFail(
      "MUTATION_DENIED",
      `${label} opens a top-level section, which would end the Requirements section it is promoted into: ${topLevel.trim()}`
    ) as MutationResult<T>;
  }
  const open = openStructureAfter(lines, PROSE_LINES);
  if (open !== undefined) {
    const what = open === "comment" ? "an HTML comment block" : "a code fence";
    return mutationFail("MUTATION_DENIED", `${label} leaves ${what} open, which hides every requirement written after it`) as MutationResult<T>;
  }
  return undefined;
}
