// @req FR-NODE-153 — the run-root preflight comparison.
//
// The check cannot be performed inside a tool on either surface: the CLI resolves its root from the
// caller's working directory, which makes the comparison vacuous, and the MCP server fixes its
// workspace root to its own process directory, so a comparison issued inside it always matches
// (§10.6). The agent therefore obtains both roots and hands them here; this function performs only
// the judgment-free normalisation. `realpath` is one of the four rules, so the resolver arrives
// injected — that is what lets the function be both realpath-aware and free of filesystem access.

/** The closed set of rules that can decide a run-root comparison, in the order they are applied. */
export const ROOT_NORMALISATION_RULES = ["separators", "trailing-separator", "windows-case", "realpath"] as const;

export type RootNormalisationRule = (typeof ROOT_NORMALISATION_RULES)[number];

/** An injected realpath resolver. The caller owns the filesystem access; this module never does. */
export type RealpathProbe = (path: string) => string;

export interface RootComparison {
  match: boolean;
  normalisedA: string;
  normalisedB: string;
  rule: RootNormalisationRule;
}

function applySeparators(value: string): string {
  return value.replace(/\\/g, "/");
}

function applyTrailingSeparator(value: string): string {
  return value.length > 1 ? value.replace(/\/+$/, "") : value;
}

function applyWindowsCase(value: string): string {
  return value.toLowerCase();
}

/**
 * Compare two run roots under the four normalisation rules and report which one decided it.
 *
 * The rules are cumulative and ordered: each is applied on top of its predecessors, and the returned
 * rule is the first at which the two forms became equal. Two byte-identical roots are decided by
 * `separators`, applied vacuously — the rule vocabulary is closed, so there is no fifth value for
 * "no normalisation was needed". A comparison that never becomes equal reports `match: false` under
 * `realpath`, the last rule attempted, with both roots fully normalised.
 * @req FR-NODE-153
 */
export function normaliseRoot(a: string, b: string, probe: RealpathProbe): RootComparison {
  let left = applySeparators(a);
  let right = applySeparators(b);
  if (left === right) return { match: true, normalisedA: left, normalisedB: right, rule: "separators" };

  left = applyTrailingSeparator(left);
  right = applyTrailingSeparator(right);
  if (left === right) return { match: true, normalisedA: left, normalisedB: right, rule: "trailing-separator" };

  left = applyWindowsCase(left);
  right = applyWindowsCase(right);
  if (left === right) return { match: true, normalisedA: left, normalisedB: right, rule: "windows-case" };

  // Only now is the probe consulted, so a comparison an earlier rule settles costs no resolution.
  left = applyWindowsCase(applyTrailingSeparator(applySeparators(probe(a))));
  right = applyWindowsCase(applyTrailingSeparator(applySeparators(probe(b))));
  return { match: left === right, normalisedA: left, normalisedB: right, rule: "realpath" };
}
