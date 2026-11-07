// @req FR-NODE-186 — what relation a candidate git root bears to the MCP workspace root, and which
// of those relations each declared role may hold.
//
// The FR-NODE-178 gate compares two roots for equality. That is right for a run that never leaves the
// host, and it is exactly wrong for a run that creates its own lane workspaces: a worktree the run
// planned and a session that wandered into an unrelated checkout are the same observation to an
// equality test. Worktree isolation is unreachable while that is true, so this module supplies the
// discriminator the equality test lacks.
//
// The discriminator is the git common directory. Every linked worktree of one repository resolves to
// the same `--git-common-dir` while reporting a different `--show-toplevel`, and neither value comes
// from the caller — which is the property FR-NODE-178 required of any corroboration. Registration in
// that common directory's worktree list is the second half: it separates a real linked worktree from
// a directory carrying a hand-written `.git` file.
//
// The role is DECLARED, not inferred. Inferring it would defeat the gate: "these two roots differ but
// share a common directory, so this must be a lane" is satisfied by any worktree of the repository,
// including one the run never planned.

import { normaliseRoot, type RealpathProbe } from "./preflight.js";

/** The closed set of relations a candidate git root can bear to the MCP workspace root. */
export const ROOT_TOPOLOGIES = [
  "same-root",
  "linked-worktree",
  "unregistered-worktree",
  "foreign-repo",
  "not-a-repo"
] as const;

export type RootTopology = (typeof ROOT_TOPOLOGIES)[number];

/** An injected resolver for `git rev-parse --git-common-dir`; `undefined` outside a repository. */
export type GitCommonDirProbe = (path: string) => string | undefined;

/** An injected resolver for the worktrees a common directory registers (`git worktree list`). */
export type RegisteredWorktreesProbe = (commonDir: string) => readonly string[];

export interface WorktreeProbes {
  realpath: RealpathProbe;
  gitToplevel: (path: string) => string | undefined;
  gitCommonDir: GitCommonDirProbe;
  registeredWorktrees: RegisteredWorktreesProbe;
}

function sameRoot(a: string, b: string, realpath: RealpathProbe): boolean {
  return normaliseRoot(a, b, realpath).match;
}

/**
 * @req FR-NODE-186 — classify `gitRoot` relative to `mcpRoot`.
 *
 * `same-root` is decided first and without the probes, so a run that never left the host costs no
 * subprocess and cannot be reclassified by a probe that answers oddly.
 */
export function classifyRoot(mcpRoot: string, gitRoot: string, probes: WorktreeProbes): RootTopology {
  if (sameRoot(mcpRoot, gitRoot, probes.realpath)) return "same-root";
  if (probes.gitToplevel(gitRoot) === undefined) return "not-a-repo";

  const hostCommon = probes.gitCommonDir(mcpRoot);
  const candidateCommon = probes.gitCommonDir(gitRoot);
  if (hostCommon === undefined || candidateCommon === undefined) return "not-a-repo";
  if (!sameRoot(hostCommon, candidateCommon, probes.realpath)) return "foreign-repo";

  const registered = probes.registeredWorktrees(candidateCommon);
  const known = registered.some((entry) => sameRoot(entry, gitRoot, probes.realpath));
  return known ? "linked-worktree" : "unregistered-worktree";
}

export const RUN_ROOT_ROLES = ["host", "lane"] as const;

export type RunRootRole = (typeof RUN_ROOT_ROLES)[number];

/**
 * Why a role-declared run root was refused. Each non-lane classification gets its own reason so the
 * operator is sent at the actual repair rather than at a generic mismatch.
 */
export const ROLE_REFUSAL_REASONS = [
  "host-roots-differ",
  "lane-root-is-host-root",
  "lane-root-unregistered",
  "lane-root-foreign-repo",
  "lane-root-not-a-repo",
  "lane-id-not-in-plan",
  "lane-write-set-touches-srs"
] as const;

export type RoleRefusalReason = (typeof ROLE_REFUSAL_REASONS)[number];

export interface FrozenLaneEntry {
  writeSet: readonly string[];
}

/**
 * The frozen lane membership the gate consults, keyed by lane id. Deliberately NOT named `LanePlan`:
 * `lane-plan.ts` in this same directory already owns that name for a different shape, and two types
 * with one name in one directory is how a caller ends up passing the wrong one. @req FR-NODE-186
 */
export type FrozenLanePlan = Readonly<Record<string, FrozenLaneEntry>>;

export type RunRootRequest =
  | { role: "host"; mcpRoot: string; gitRoot: string }
  | { role: "lane"; mcpRoot: string; gitRoot: string; laneId: string; lanePlan: FrozenLanePlan };

export interface RoleRootVerdict {
  ok: boolean;
  /** `null` exactly when `ok`. */
  reason: RoleRefusalReason | null;
  topology: RootTopology;
}

/** The classification-to-reason map for a lane, so no non-lane topology falls through unnamed. */
const LANE_REFUSAL_BY_TOPOLOGY: Record<Exclude<RootTopology, "linked-worktree">, RoleRefusalReason> = {
  "same-root": "lane-root-is-host-root",
  "unregistered-worktree": "lane-root-unregistered",
  "foreign-repo": "lane-root-foreign-repo",
  "not-a-repo": "lane-root-not-a-repo"
};

const SRS_PREFIX = "docs/spec/";

function touchesSrs(writeSet: readonly string[]): boolean {
  return writeSet.some((entry) => entry.replace(/\\/g, "/").startsWith(SRS_PREFIX));
}

/**
 * @req FR-NODE-186 — accept a run root only in the relation its declared role is allowed to hold.
 *
 * A host passes exactly when its root equals the MCP root, whether that root is the repository's main
 * worktree or a linked worktree of it: the SRS sits at the git top level of whichever checkout the
 * host session runs from (FR-NODE-186 AC-8, FR-FLOW-230 AC-1).
 *
 * A lane must be a registered worktree AND appear in the run's frozen lane plan. Registration alone
 * would admit any worktree of the repository, which puts the gate back to trusting its caller; plan
 * membership is the part the caller did not choose.
 */
export function preflightRunRootForRole(request: RunRootRequest, probes: WorktreeProbes): RoleRootVerdict {
  const topology = classifyRoot(request.mcpRoot, request.gitRoot, probes);

  if (request.role === "host") {
    if (topology !== "same-root") return { ok: false, reason: "host-roots-differ", topology };
    return { ok: true, reason: null, topology };
  }

  if (topology !== "linked-worktree") {
    return { ok: false, reason: LANE_REFUSAL_BY_TOPOLOGY[topology], topology };
  }
  const entry = Object.prototype.hasOwnProperty.call(request.lanePlan, request.laneId)
    ? request.lanePlan[request.laneId]
    : undefined;
  if (entry === undefined) return { ok: false, reason: "lane-id-not-in-plan", topology };
  if (touchesSrs(entry.writeSet)) return { ok: false, reason: "lane-write-set-touches-srs", topology };
  return { ok: true, reason: null, topology };
}
