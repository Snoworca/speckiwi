import { execFile } from "node:child_process";
import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { resolveGitCommonDir } from "../core/orchestrator/run-lock.js";

const execFileAsync = promisify(execFile);

/**
 * The one refusal vocabulary for a per-call `workspaceRoot`. Every refusal — whether the tool does
 * not take the argument at all, the path fails a gate, or the destination is SRS — names its case
 * here, so a caller reads one kebab-case reason rather than a per-family style. @req REL-MCP-005
 */
export const WORKSPACE_ROOT_REASONS = [
  "workspace-root-unsupported-for-tool",
  "workspace-root-not-absolute",
  "workspace-root-not-a-directory",
  "workspace-root-not-a-git-toplevel",
  "workspace-root-foreign-repository",
  "workspace-root-forbidden-for-srs",
  "workspace-root-forbidden-for-replay-apply"
] as const;

export type WorkspaceRootReason = (typeof WORKSPACE_ROOT_REASONS)[number];

export interface WorkspaceRootRefused {
  readonly ok: false;
  readonly reason: WorkspaceRootReason;
  readonly message: string;
  readonly details: Record<string, unknown>;
}

export type WorkspaceRootDecision = { readonly ok: true; readonly root: string } | WorkspaceRootRefused;

function refuse(reason: WorkspaceRootReason, message: string, details: Record<string, unknown> = {}): WorkspaceRootRefused {
  return { ok: false, reason, message, details };
}

/** Windows reports the same directory under different casing; a case-sensitive compare false-rejects. */
function samePath(a: string, b: string): boolean {
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function contains(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  if (relative === "") return true;
  if (path.isAbsolute(relative)) return false;
  if (!relative.startsWith("..")) return true;
  return false;
}

async function gitTopLevel(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "--path-format=absolute", "--show-toplevel"], {
      cwd,
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: 1024 * 1024
    });
    const reported = stdout.trim();
    if (reported.length === 0) return null;
    return await realpath(path.resolve(reported));
  } catch {
    return null;
  }
}

/**
 * Whether a supplied `workspaceRoot` may answer this call. Every check runs here, before any tool
 * handler: `resolveInsideRoot` creates its root as its first statement, so a validation performed
 * any later would turn a typo'd absolute path into a new directory and report success.
 * @req REL-MCP-005 AC-5
 */
export async function decideWorkspaceRoot(requested: unknown, startupRoot: string): Promise<WorkspaceRootDecision> {
  if (typeof requested !== "string" || requested.trim().length === 0 || !path.isAbsolute(requested)) {
    return refuse(
      "workspace-root-not-absolute",
      "workspaceRoot must be an absolute path to a git top level.",
      { workspaceRoot: requested }
    );
  }
  const stats = await stat(requested).catch(() => null);
  if (!stats?.isDirectory()) {
    return refuse(
      "workspace-root-not-a-directory",
      "workspaceRoot must name an existing directory; it is never created.",
      { workspaceRoot: requested }
    );
  }
  const resolved = await realpath(requested).catch(() => path.resolve(requested));
  const topLevel = await gitTopLevel(resolved);
  if (topLevel === null || !samePath(topLevel, resolved)) {
    return refuse(
      "workspace-root-not-a-git-toplevel",
      "workspaceRoot must be a git top level, not a subdirectory of one.",
      { workspaceRoot: resolved, gitTopLevel: topLevel }
    );
  }
  const startupCommonDir = await resolveGitCommonDir(startupRoot).catch(() => null);
  const candidateCommonDir = await resolveGitCommonDir(resolved).catch(() => null);
  if (startupCommonDir === null || candidateCommonDir === null || !samePath(startupCommonDir, candidateCommonDir)) {
    return refuse(
      "workspace-root-foreign-repository",
      "workspaceRoot must be a worktree of the startup root's repository.",
      { workspaceRoot: resolved, gitCommonDir: candidateCommonDir, startupGitCommonDir: startupCommonDir }
    );
  }
  return { ok: true, root: resolved };
}

function stringsOf(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  return [];
}

/**
 * The first caller-supplied path that lands under `docs/spec` of any protected root, or `null`.
 *
 * Containment was written to stop traversal, never to draw a root boundary: `docs/spec` is an
 * ordinary subdirectory of any accepted root and an SRS file carries the same `- [ ] ` shape a plan
 * does, so a checkbox mutation aimed at one would pass every check the tool itself performs.
 * @req REL-MCP-005 AC-6
 */
export function srsDestination(input: Record<string, unknown>, roots: readonly string[]): string | null {
  const specDirs = roots.map((root) => path.resolve(root, "docs", "spec"));
  for (const [key, value] of Object.entries(input)) {
    if (key === "workspaceRoot" || key === "root") continue;
    for (const candidate of stringsOf(value)) {
      for (let index = 0; index < roots.length; index += 1) {
        const base = roots[index] as string;
        const specDir = specDirs[index] as string;
        const resolved = path.isAbsolute(candidate) ? path.resolve(candidate) : path.resolve(base, candidate);
        if (contains(specDir, resolved)) return candidate;
      }
    }
  }
  return null;
}
