import type { MutationResult } from "../types.js";
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
 * Copied from `FENCE_RE` in `parser/block-scanner.ts:40` rather than approximated, for the reason
 * the paragraph above gives: the parser decides what a requirement block is, so the guard follows
 * it exactly. Both markers, three or more, up to three leading spaces.
 *
 * A fence is the parser's SECOND record boundary and the one a guard named for headings does not
 * see. `scanRequirementBlocks` enters fence state on this pattern and returns on every line after
 * it, so a single unclosed ``` in a prose field makes each later `### FR-…` start and each `## `
 * boundary stop existing. Measured on a three-requirement workspace: a note of
 * "Implementation detail.\n```" left one record in the parsed model, took `ready` from false to
 * true, and the validator reported NOTHING — no heading was harmed, so nothing looked wrong.
 *
 * A balanced pair is inert to a parity-based scanner and is refused anyway. That is stricter than
 * this parser needs, and deliberately so: no requirement block in `docs/spec/*.srs.md` carries a
 * fence today, so the strictness costs nothing, while matching the parity model would leave the
 * guard correct only until the parser learned to match fence widths. When a requirement genuinely
 * needs fenced prose, both sides have to learn balance in the same change.
 */
const OPENS_FENCE = /^(?: {0,3})(`{3,}|~{3,})/;

/**
 * Refuses caller-supplied prose that would move a boundary of the requirement block it is written
 * into — by opening a section the block does not declare, or by opening a fenced region that
 * swallows the blocks after it.
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
  const fence = lines.find((line) => OPENS_FENCE.test(line));
  if (fence !== undefined) {
    return mutationFail(
      "USAGE",
      `${label} contains a code fence, which ends the requirement block for the parser and hides every block after it: ${fence.trim()}`
    ) as MutationResult<T>;
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
  const fences = lines.filter((line) => OPENS_FENCE.test(line));
  if (fences.length % 2 !== 0) {
    return mutationFail(
      "MUTATION_DENIED",
      `${label} leaves a code fence open, which hides every requirement written after it: ${fences[fences.length - 1]?.trim() ?? ""}`
    ) as MutationResult<T>;
  }
  return undefined;
}
