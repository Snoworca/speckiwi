export const SECTION_ALLOWLIST = {
  rationale: "Rationale",
  research: "Research / Analysis",
  implementation_notes: "Implementation Notes"
} as const;

export type AllowedSection = keyof typeof SECTION_ALLOWLIST;

/** The get_requirement field that carries each narrative section. @req FR-MCP-018 AC-2 */
const ALLOWED_FIELD_NAMES: Record<AllowedSection, string> = {
  rationale: "rationale",
  research: "research",
  implementation_notes: "implementationNotes"
};

/**
 * @req FR-MCP-018 AC-3 — the structured tables free text cannot reach, each with its get_requirement
 * field and a tool that does write it, so a refusal can send the caller to one.
 */
const STRUCTURED_SECTIONS = [
  { key: "acceptance_criteria", heading: "Acceptance Criteria", field: "acceptanceCriteria", tools: ["append_acceptance_criterion", "edit_acceptance_criterion", "check_acceptance_criteria"] },
  { key: "verification_evidence", heading: "Verification Evidence", field: "verificationEvidence", tools: ["add_verification_evidence"] },
  { key: "trace_links", heading: "Trace Links", field: "traceLinks", tools: ["add_trace_link"] },
  { key: "change_notes", heading: "Change Notes", field: "changeNotes", tools: ["add_change_note"] }
] as const;

type StructuredSection = (typeof STRUCTURED_SECTIONS)[number];

/** The two plural spellings the old denylist carried, kept so they stay refused rather than unknown. */
const OLD_PLURAL_ALIASES: Record<string, string> = {
  acceptance_criterias: "acceptance_criteria",
  verification_evidences: "verification_evidence"
};

export function normalizeSectionKey(raw: string): string {
  return raw.trim().toLowerCase().replace(/-/g, "_");
}

/** The parser's own heading comparison: trimmed, inner whitespace collapsed, case ignored. */
function normalizeHeading(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").toLowerCase();
}

export type ResolveSectionResult =
  | { ok: true; key: AllowedSection; heading: string }
  | { ok: false; reason: "denied"; heading: string; tools: readonly string[] }
  | { ok: false; reason: "unknown" };

/** The structured table `raw` names by key (or one of the old plural aliases), heading or field name. */
function structuredSection(raw: string): StructuredSection | undefined {
  const normalized = normalizeSectionKey(raw);
  const key = OLD_PLURAL_ALIASES[normalized] ?? normalized;
  const heading = normalizeHeading(raw);
  const field = raw.trim();
  return STRUCTURED_SECTIONS.find(
    (section) => key === section.key || heading === normalizeHeading(section.heading) || field === section.field
  );
}

/**
 * @req FR-MCP-018 AC-2 AC-3 — the one resolver of the `section` argument; the CLI and MCP reach it
 * through the same mutation. It takes a key (any case, `-` for `_`), the section heading as the parser
 * reads one, or the get_requirement field name, each matched exactly; a partial word is unknown.
 */
export function resolveSectionHeading(raw: string): ResolveSectionResult {
  const structured = structuredSection(raw);
  if (structured) return { ok: false, reason: "denied", heading: structured.heading, tools: structured.tools };
  const keys = Object.keys(SECTION_ALLOWLIST) as AllowedSection[];
  const key = keys.find(
    (candidate) =>
      normalizeSectionKey(raw) === candidate || normalizeHeading(raw) === normalizeHeading(SECTION_ALLOWLIST[candidate]) || raw.trim() === ALLOWED_FIELD_NAMES[candidate]
  );
  return key === undefined ? { ok: false, reason: "unknown" } : { ok: true, key, heading: SECTION_ALLOWLIST[key] };
}

/** What `section` takes, from the same tables the resolver reads. @req FR-MCP-018 AC-1 AC-2 */
export function acceptedSectionsText(): string {
  const keys = Object.keys(SECTION_ALLOWLIST) as AllowedSection[];
  return `one of ${keys.join(", ")}; the section headings ${keys.map((key) => SECTION_ALLOWLIST[key]).join(", ")} and the get_requirement fields ${keys.map((key) => ALLOWED_FIELD_NAMES[key]).join(", ")} name the same sections`;
}
