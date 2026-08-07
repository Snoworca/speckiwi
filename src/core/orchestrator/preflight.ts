// @req FR-NODE-153 — the run-root preflight comparison.
//
// The check cannot be performed inside a tool on either surface: the CLI resolves its root from the
// caller's working directory, which makes the comparison vacuous, and the MCP server fixes its
// workspace root to its own process directory, so a comparison issued inside it always matches
// (§10.6). The agent therefore obtains both roots and hands them here; this function performs only
// the judgment-free normalisation. `realpath` is one of the four rules, so the resolver arrives
// injected — that is what lets the function be both realpath-aware and free of filesystem access.
//
// @req FR-NODE-178 — the module also decides the whole preflight verdict, because comparing two
// strings from one caller is forgeable: passing one value twice satisfies it. `preflightRunRoot`
// corroborates the git root against the repository that path names before the comparison counts.
// Both answers still arrive through injected probes, so the no-filesystem-access property holds for
// the module as a whole and not merely for `normaliseRoot`.

/** The closed set of rules that can decide a run-root comparison, in the order they are applied. */
export const ROOT_NORMALISATION_RULES = ["separators", "trailing-separator", "windows-case", "realpath"] as const;

export type RootNormalisationRule = (typeof ROOT_NORMALISATION_RULES)[number];

/** An injected realpath resolver. The caller owns the filesystem access; this module never does. */
export type RealpathProbe = (path: string) => string;

/**
 * An injected resolver for the top level of the repository containing a path, `undefined` when the
 * path lies in no repository. Injected for the same reason `RealpathProbe` is: the answer needs a
 * subprocess, and this module holds no facility to run one.
 * @req FR-NODE-178
 */
export type GitToplevelProbe = (path: string) => string | undefined;

/**
 * Why a run-root preflight refused, in the order the conditions are evaluated.
 *
 * `git-root-not-toplevel` precedes `roots-differ` deliberately. When both hold, telling the operator
 * to reconcile two roots sends them at the wrong repair: the fix is to name the repository rather
 * than a module, after which the two roots may well agree on their own.
 * @req FR-NODE-178, IR-CLI-090
 */
export const RUN_ROOT_REFUSAL_REASONS = ["git-root-not-a-repository", "git-root-not-toplevel", "roots-differ"] as const;

export type RunRootRefusalReason = (typeof RUN_ROOT_REFUSAL_REASONS)[number];

export interface RunRootVerdict {
  ok: boolean;
  /** `null` exactly when `ok`. */
  reason: RunRootRefusalReason | null;
  /** The two-root comparison, reported whatever decided the verdict. */
  comparison: RootComparison;
  /** The top level the probe named for the passed git root; `null` when it named none. */
  gitToplevel: string | null;
}

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

/**
 * The run-root preflight: corroborate the passed git root, then compare the two roots.
 *
 * `normaliseRoot` compares two strings that reach it from one caller, so a caller who needs the gate
 * to pass can pass one value twice — and the surface test pinned that as a success. A layout the gate
 * refuses permanently makes that the cheapest way through, and the run then carries a passed gate as
 * a false attestation, which is worse than the split-brain the gate exists to prevent.
 *
 * The repair is to corroborate one side against something the caller does not choose: the repository
 * the passed path itself names. The two sides still originate independently, so the comparison stays
 * meaningful — the property that forbids the tool from defaulting either root in the first place.
 * @req FR-NODE-178
 */
export function preflightRunRoot(
  mcpRoot: string,
  gitRoot: string,
  probes: { realpath: RealpathProbe; gitToplevel: GitToplevelProbe }
): RunRootVerdict {
  const comparison = normaliseRoot(mcpRoot, gitRoot, probes.realpath);

  const toplevel = probes.gitToplevel(gitRoot);
  if (toplevel === undefined) {
    return { ok: false, reason: "git-root-not-a-repository", comparison, gitToplevel: null };
  }
  // Compared under the same four rules, so a corroboration is not refused over a separator or a
  // drive-letter case that the two-root comparison would have forgiven.
  if (!normaliseRoot(toplevel, gitRoot, probes.realpath).match) {
    return { ok: false, reason: "git-root-not-toplevel", comparison, gitToplevel: toplevel };
  }

  if (!comparison.match) return { ok: false, reason: "roots-differ", comparison, gitToplevel: toplevel };
  return { ok: true, reason: null, comparison, gitToplevel: toplevel };
}
