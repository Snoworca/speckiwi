import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { computeInvariantDigest, type ResumeCard } from "../../../src/core/orchestrator/resume-card.js";

/**
 * Makes `root` a git repository and re-pins `card`'s run root to it.
 *
 * @req FR-NODE-180 — `orchestrate resume` now compares the card's `frozen.run_root.git_toplevel`
 * against the repository it is resuming in, so a fixture that pins a fictional root (`C:/repo`) while
 * running from a temp directory refuses before reaching whatever it was written to assert. Re-pinning
 * keeps each of those cases about its own subject; it does not soften the new rule, which is asserted
 * on its own in `test/cli/resume-run-root-pin.fr-node-180.test.ts`.
 *
 * The digest is recomputed only when the fixture's own digest was honest, so a case that deliberately
 * corrupts `invariant_digest` to drive the drift gate keeps its corruption.
 */
export async function pinResumeRunRoot<T extends ResumeCard>(card: T, root: string): Promise<T> {
  await promisify(execFile)("git", ["init", "--quiet"], { cwd: root });
  const wasHonest = card.invariant_digest === computeInvariantDigest(card.frozen);
  const frozen = { ...card.frozen, run_root: { git_toplevel: root, mcp_workspace_root: root } } as ResumeCard["frozen"];
  return {
    ...card,
    frozen,
    invariant_digest: wasHonest ? computeInvariantDigest(frozen) : card.invariant_digest
  };
}
