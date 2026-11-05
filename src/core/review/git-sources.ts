import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { environmentWithoutRepositoryLocation, git } from "../root-facts.js";
import type { ReviewRoundSources } from "./review-round.js";

// @req FR-NODE-274 AC-2 AC-5 AC-6 — the review-round check's reads of a workspace: the state file, and
// git's read verbs (`cat-file -t`, `cat-file blob`, `diff --name-only`) under `--no-optional-locks`, so
// neither the index nor the object store nor a ref is touched. The repository is the one `-C` finds
// (FR-NODE-227).

export function workspaceReviewRoundSources(root: string): ReviewRoundSources {
  const env = environmentWithoutRepositoryLocation();
  return {
    readState: async (relativePath) => {
      const file = path.join(root, relativePath);
      return existsSync(file) ? readFile(file, "utf8") : undefined;
    },
    isTree: async (sha) => {
      const answer = await git(root, ["--no-optional-locks", "cat-file", "-t", sha], env);
      return answer.code === 0 && answer.stdout.trim() === "tree";
    },
    changedPaths: async (fromTree, toTree) => {
      const answer = await git(root, ["--no-optional-locks", "diff", "--name-only", "-z", "--no-renames", "--no-ext-diff", "--no-relative", fromTree, toTree, "--"], env);
      return answer.code === 0 ? answer.stdout.split("\0").filter((entry) => entry !== "") : undefined;
    },
    firstLine: async (tree, posixPath) => {
      const answer = await git(root, ["--no-optional-locks", "cat-file", "blob", `${tree}:${posixPath}`], env);
      return answer.code === 0 ? answer.stdout.split(/\r?\n/, 1)[0] : undefined;
    }
  };
}
