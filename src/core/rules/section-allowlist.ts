export const SECTION_ALLOWLIST = {
  rationale: "Rationale",
  research: "Research / Analysis",
  implementation_notes: "Implementation Notes"
} as const;

export type AllowedSection = keyof typeof SECTION_ALLOWLIST;

export const SECTION_DENYLIST = new Set<string>([
  "verification_evidence",
  "verification_evidences",
  "acceptance_criteria",
  "acceptance_criterias"
]);

export function normalizeSectionKey(raw: string): string {
  return raw.trim().toLowerCase().replace(/-/g, "_");
}

export type ResolveSectionResult =
  | { ok: true; heading: string }
  | { ok: false; reason: "denied" | "unknown" };

export function resolveSectionHeading(key: string): ResolveSectionResult {
  const normalized = normalizeSectionKey(key);
  if (SECTION_DENYLIST.has(normalized)) {
    return { ok: false, reason: "denied" };
  }
  if (normalized in SECTION_ALLOWLIST) {
    return { ok: true, heading: SECTION_ALLOWLIST[normalized as AllowedSection] };
  }
  return { ok: false, reason: "unknown" };
}
