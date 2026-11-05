import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The lane-branch preparation rules live in one place, `_shared/kiwi/worktree-lane.md` §2 (lead decision, final round 4):
// every other step cites it. The verification tests read the commands from there and run them as the section orders —
// the ancestor test first, then attach or create/recreate.

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export type LaneCase = "host" | "runtime";

export interface LaneProcedure {
  readonly probe: string;
  readonly attach: string;
  readonly recreate: string;
}

/** The §2 case's three commands (test, attach, create or recreate), in the rendering under `root`. */
export function laneProcedure(root: string, which: LaneCase): LaneProcedure {
  const text = readFileSync(path.join(REPO, root, "_shared/kiwi/worktree-lane.md"), "utf8").replace(/\r\n/g, "\n");
  const start = text.indexOf("\n## 2.");
  const section = text.slice(start, text.indexOf("\n## 3.", start));
  const lines = section.split("\n");
  const head = lines.findIndex((line) => line.startsWith(which === "host" ? "1. **" : "2. **"));
  const bullets = lines.slice(head + 1, head + 4).map((line) => /`(git [^`]+)`/.exec(line)?.[1] ?? "");
  const [probe = "", attach = "", recreate = ""] = bullets;
  return { probe, attach, recreate };
}

/** Fills `<lane-root>`, `<branch>` and `<base_sha>` and splits into git's argv (the leading `git` dropped). */
function argvOf(command: string, fill: { laneRoot: string; branch: string; base: string }): string[] {
  return command
    .replaceAll("<lane-root>", fill.laneRoot)
    .replaceAll("<branch>", fill.branch)
    .replaceAll("<base_sha>", fill.base)
    .split(/\s+/)
    .slice(1);
}

/**
 * Runs the §2 procedure from `cwd` (the host repository, or the lane worktree for the runtime case): the ancestor test,
 * then attach when it exits 0, else create or recreate. Returns the command run; throws when it fails.
 */
export function runLaneProcedure(
  procedure: LaneProcedure,
  cwd: string,
  fill: { laneRoot: string; branch: string; base: string },
  env: NodeJS.ProcessEnv
): string {
  const attachable = spawnSync("git", argvOf(procedure.probe, fill), { cwd, env }).status === 0;
  const chosen = attachable ? procedure.attach : procedure.recreate;
  const run = spawnSync("git", argvOf(chosen, fill), { cwd, env, encoding: "utf8" });
  if (run.status !== 0) throw new Error(`${chosen}: ${run.stderr}`);
  return chosen;
}
