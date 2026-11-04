// @req FR-NODE-240 — the PRD's own grammar (skills/claude/kiwi-prd/SKILL.md §3). A PRD is an input
// record, not a requirements source: none of these types are requirement records, and nothing here
// is read by the SRS parser.

export const PRD_KINDS = ["intent", "user", "goal", "in-scope", "exclusion", "proposal"] as const;
export const PRD_STATES = ["confirmed", "proposed", "rejected"] as const;
export const PRD_EXCLUSION_CLASSES = ["already-implemented", "superseded", "external-ownership", "user-excluded", "non-normative"] as const;
export const PRD_EFFECTS = ["in-scope", "exclusion"] as const;

export const PRD_SECTIONS = {
  userRequest: "## 1. User Request",
  items: "## 2. Items",
  approval: "## 3. Approval"
} as const;

export interface PrdUserBlock {
  /** `U-<n>` */
  id: string;
  /** 1-based line of the `### U-<n>` heading. */
  line: number;
  /**
   * The user's words a quote may come from: the block's `>` lines, minus the agent's question in an
   * answer block (from a `질문:` line up to the next `답:` line) — except in `U-1`, the request itself.
   */
  quotable: string;
}

export interface PrdItem {
  /** `PRD-<n>`, as written in the heading. */
  id: string;
  /** The heading number; NaN when the heading carries none. */
  number: number;
  title: string;
  /** 1-based line of the `### PRD-<n>` heading. */
  line: number;
  kind: string;
  state: string;
  source: string[];
  quote: string;
  body: string;
  exclusionClass?: string;
  reason?: string;
  effect?: string;
  /** 1-based lines of the block's metadata rows by field name, for diagnostics. */
  fieldLines: Record<string, number>;
  /** 1-based lines of the block's `>` quote lines. */
  quoteLines: number[];
}

export interface PrdDocument {
  /** Workspace-relative POSIX path, e.g. `docs/prd/2026-11-04.reset.prd.md`. */
  path: string;
  /** `<path>@sha256:<hex>` over the file as read. */
  pointer: string;
  status: string;
  approved: string;
  requestSha256Cell: string;
  requestSha256Line: number;
  /** sha256 of the LF-normalised `## 1. User Request` section; undefined when the section is missing or last. */
  requestSha256?: string;
  userBlocks: PrdUserBlock[];
  items: PrdItem[];
  /** LF-normalised lines of the file. */
  lines: string[];
}
