// The one reader of fenced code block delimiters in the parser layer (CommonMark §4.5).

export interface Fence {
  marker: "`" | "~";
  length: number;
}

/** Indent a fence may carry, counted from the start of its container's content. */
const MAX_INDENT = 3;

const DELIMITER = /^( *)(`{3,}|~{3,})(.*)$/;

function delimiterAt(line: string): { fence: Fence; rest: string } | undefined {
  const match = DELIMITER.exec(line);
  if (!match || (match[1] ?? "").length > MAX_INDENT) return undefined;
  const run = match[2] ?? "";
  return { fence: { marker: run[0] as Fence["marker"], length: run.length }, rest: match[3] ?? "" };
}

/**
 * A fence delimiter at the start of the line, with or without an info string after it. A backtick
 * run whose info string holds a backtick is an inline code span, not a fence.
 */
export function fenceAt(line: string): Fence | undefined {
  const found = delimiterAt(line);
  if (!found || (found.fence.marker === "`" && found.rest.includes("`"))) return undefined;
  return found.fence;
}

/**
 * What may follow a closing delimiter. CommonMark allows spaces or tabs. The SRS section and AC
 * parsers have always allowed spaces only, and FR-PARSE-012's parser test pins that (a "```\t" line
 * there does not close the fence), so they ask for "spaces" explicitly.
 */
export type ClosingFenceTrail = "spaces-or-tabs" | "spaces";

const CLOSING_TRAIL: Record<ClosingFenceTrail, RegExp> = {
  "spaces-or-tabs": /^[ \t]*$/,
  spaces: /^ *$/
};

/** A delimiter that can close a fence: the run followed by nothing but blanks. */
export function closingFenceAt(line: string, trail: ClosingFenceTrail = "spaces-or-tabs"): Fence | undefined {
  const found = delimiterAt(line);
  return found && CLOSING_TRAIL[trail].test(found.rest) ? found.fence : undefined;
}

/** A fence is closed by a delimiter of the same marker at least as long as the one that opened it. */
export function closesFence(open: Fence, candidate: Fence | undefined): boolean {
  return candidate !== undefined && candidate.marker === open.marker && candidate.length >= open.length;
}
