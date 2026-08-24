// @req FR-PARSE-039 — an acceptance criterion that nails down a string, a path or a version stops
// being true the moment a later requirement changes that value, and nothing notices: the criterion
// stays checked and reads as evidence. Every recorded contradiction of this kind has that shape.
//
// This registry is hand-written on purpose. Deriving it from a scan of the modules would make its
// own completeness test compare a scan against itself, which is green by construction and closes
// nothing.

/** What a shipped export is, as far as a criterion quoting its value is concerned. */
export type SsotRole =
  /** The value in force. A criterion carrying its shape but a different value has gone stale. */
  | "current"
  /** Kept so the tool can recognise what an older version wrote. A criterion must never carry it. */
  | "legacy"
  /** In force, but its value has no shape that separates it from ordinary prose. */
  | "unshaped"
  /** Not something a criterion quotes as a value. */
  | "not-an-ssot";

export interface SsotLiteralEntry {
  /** Export name, as written in the module. */
  readonly name: string;
  /** Module the export lives in, relative to the repository root. */
  readonly module: string;
  readonly role: SsotRole;
  /**
   * A pattern that matches values of this kind, with one capture group for the part that varies.
   * Present only for `current`: it is what lets a stale value be told apart from a current one.
   */
  readonly shape?: RegExp;
  /** The value in force, against which a shape match is compared. */
  readonly value?: string;
  /**
   * How an HTML-comment marker opens. A marker carries no version, so a wrong one differs by whole
   * string rather than by a captured part; matching the opening is what catches a variant of it.
   */
  readonly markerPrefix?: string;
  /** Required for `unshaped` and `not-an-ssot`: why this export is outside the comparison. */
  readonly reason?: string;
}

/** Modules whose string exports must all be classified below. */
export const SSOT_REGISTRY_MODULES = [
  "src/core/bootstrap/templates.ts",
  "src/core/bootstrap/init-project.ts",
  "src/core/types.ts",
  "src/core/diagnostic-registry.ts"
] as const;

export const SSOT_LITERAL_REGISTRY: readonly SsotLiteralEntry[] = [
  // ── src/core/bootstrap/templates.ts ────────────────────────────────────────────────────────
  {
    name: "AGENT_INSTRUCTION_HEADING_PREFIX",
    module: "src/core/bootstrap/templates.ts",
    role: "current",
    // The heading always carries a version suffix, which is what makes an older one recognisable.
    shape: /# SpecKiwi SRS workflow v(\d+(?:\.\d+)*)/g,
    value: "1.9"
  },
  {
    name: "BUNDLED_SRS_RULES_FILENAME",
    module: "src/core/bootstrap/templates.ts",
    role: "current",
    shape: /SRS-MD-Rules-v(\d+(?:\.\d+)*)\.md/g,
    value: "2.5.0"
  },
  {
    name: "BUNDLED_SDS_RULES_FILENAME",
    module: "src/core/bootstrap/templates.ts",
    role: "current",
    shape: /SDS-MD-Rules-v(\d+(?:\.\d+)*)\.md/g,
    value: "2.5.0"
  },
  {
    name: "LEGACY_KOREAN_AGENT_HEADING_PREFIX",
    module: "src/core/bootstrap/templates.ts",
    role: "legacy",
    value: "# SpecKiwi SRS 워크플로 v"
  },
  {
    name: "LEGACY_KOREAN_AGENT_END_MARKER",
    module: "src/core/bootstrap/templates.ts",
    role: "legacy",
    value: "<!-- /SpecKiwi SRS 워크플로 -->",
    markerPrefix: "<!-- /SpecKiwi SRS 워크플로"
  },
  {
    name: "AGENT_INSTRUCTION_END_MARKER",
    module: "src/core/bootstrap/templates.ts",
    role: "current",
    value: "<!-- /SpecKiwi SRS workflow -->",
    markerPrefix: "<!-- /SpecKiwi SRS workflow"
  },
  {
    name: "AGENT_INSTRUCTION_VERSION",
    module: "src/core/bootstrap/templates.ts",
    role: "unshaped",
    reason:
      "A bare version number matches too much prose to be told apart on its own. It is covered through the heading prefix, whose shape carries it."
  },
  {
    name: "BUNDLED_RULES_VERSION",
    module: "src/core/bootstrap/templates.ts",
    role: "unshaped",
    reason: "Covered through the SRS rules filename, whose shape carries it."
  },
  {
    name: "BUNDLED_SDS_RULES_VERSION",
    module: "src/core/bootstrap/templates.ts",
    role: "unshaped",
    reason: "Covered through the SDS rules filename, whose shape carries it."
  },
  {
    name: "CODEX_APPLY_PATCH_HOOK_FLOOR",
    module: "src/core/bootstrap/templates.ts",
    role: "unshaped",
    reason: "A bare version floor, with the same problem as AGENT_INSTRUCTION_VERSION and no heading to carry it."
  },
  {
    name: "RULES_DOCUMENT_FILENAME_PATTERN",
    module: "src/core/bootstrap/templates.ts",
    role: "not-an-ssot",
    reason:
      "A pattern, not a value. It matches the current filenames as readily as the stale ones, so comparing against it would report every mention of a rules document."
  },
  {
    name: "RESERVED_SPEC_SIDECARS",
    module: "src/core/bootstrap/templates.ts",
    role: "not-an-ssot",
    reason: "A list of reserved names. A criterion naming one is naming it, not quoting a value that can go stale."
  },

  // ── src/core/bootstrap/init-project.ts ─────────────────────────────────────────────────────
  {
    name: "SKILL_PROVISION_AGENTS",
    module: "src/core/bootstrap/init-project.ts",
    role: "not-an-ssot",
    reason:
      "Its members are the words claude and codex, which appear in criteria as ordinary nouns far more often than as this constant's value. Comparing against them would report a hundred criteria that are not stale."
  },
  {
    name: "GIT_PRE_COMMIT_RUNNER",
    module: "src/core/bootstrap/init-project.ts",
    role: "unshaped",
    reason: "A fixed filename with no version in it; a renamed runner is a different string, not a stale value of this shape."
  },
  {
    name: "TRACE_HOOK_RUNNER",
    module: "src/core/bootstrap/init-project.ts",
    role: "unshaped",
    reason: "Same as GIT_PRE_COMMIT_RUNNER."
  },

  // ── src/core/types.ts ──────────────────────────────────────────────────────────────────────
  {
    name: "REQUIREMENT_STATUSES",
    module: "src/core/types.ts",
    role: "not-an-ssot",
    reason:
      "Its members are words criteria use as ordinary vocabulary — verified, blocked, implemented. FR-PARSE-038 covers the one place the tool states this set back to a reader."
  },
  {
    name: "REQUIREMENT_TYPES",
    module: "src/core/types.ts",
    role: "not-an-ssot",
    reason: "Same as REQUIREMENT_STATUSES."
  },
  {
    name: "PRIORITY_LEVELS",
    module: "src/core/types.ts",
    role: "not-an-ssot",
    reason: "Same as REQUIREMENT_STATUSES."
  },
  {
    name: "RISK_LEVELS",
    module: "src/core/types.ts",
    role: "not-an-ssot",
    reason: "Same as REQUIREMENT_STATUSES."
  },
  {
    name: "STABILITY_LEVELS",
    module: "src/core/types.ts",
    role: "not-an-ssot",
    reason: "Same as REQUIREMENT_STATUSES."
  },
  {
    name: "LEGACY_STABILITY_LEVELS",
    module: "src/core/types.ts",
    role: "not-an-ssot",
    reason:
      "Kept for backward compatibility, but its member is the single word volatile, which reads as ordinary prose. FR-PARSE-038 keeps it out of the one place the tool offers these values as a fix."
  },
  {
    name: "TYPE_PREFIX",
    module: "src/core/types.ts",
    role: "not-an-ssot",
    reason: "A mapping, not a value."
  },
  {
    name: "PREFIX_TYPE",
    module: "src/core/types.ts",
    role: "not-an-ssot",
    reason: "A mapping, not a value."
  },

  // ── src/core/diagnostic-registry.ts ────────────────────────────────────────────────────────
  {
    name: "DIAGNOSTIC_DEFINITIONS",
    module: "src/core/diagnostic-registry.ts",
    role: "not-an-ssot",
    reason:
      "Diagnostic codes are added and removed rather than changed, so a criterion naming one is either right or naming something that does not exist. That is a different check from this one, and it is not built."
  },
  {
    name: "ENUM_REMEDIATION_LEVELS",
    module: "src/core/diagnostic-registry.ts",
    role: "not-an-ssot",
    reason: "A mapping from diagnostic code to the constant that defines a field's values; not a value itself."
  }
];
