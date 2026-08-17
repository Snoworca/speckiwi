import { cp, realpath } from "node:fs/promises";
import path from "node:path";
import { commitAll, initRepo, rawGit, tempDir } from "../../core/orchestrator/support/git-fixture.js";

const WORKSPACE_FIXTURES = path.resolve("test", "fixtures", "workspaces");

/** A committed git repository whose working tree is a real SpecKiwi workspace. */
export async function gitWorkspaceRepo(prefix: string, fixture = "valid-basic"): Promise<string> {
  const root = await initRepo(prefix);
  await cp(path.join(WORKSPACE_FIXTURES, fixture), root, { recursive: true });
  await commitAll(root, "test: seed the workspace");
  return realpath(root);
}

/** A linked worktree of `hostRoot`: a different top level sharing one git common dir. */
export async function linkedWorktree(hostRoot: string, prefix: string, branch: string): Promise<string> {
  const parent = await tempDir(prefix);
  const target = path.join(parent, "worktree");
  await rawGit(hostRoot, "worktree", "add", "-b", branch, target, "HEAD");
  return realpath(target);
}

export { cleanupFixtures, initRepo, rawGit, tempDir } from "../../core/orchestrator/support/git-fixture.js";
