import { existsSync } from "node:fs";
import path from "node:path";

/**
 * Repo-root paths that only ever appear when a test runs a full `speckiwi init`
 * (default MCP + skill provisioning) or a skill install against the real
 * repository working tree instead of an isolated temp root. None of these are
 * tracked in the SpecKiwi repo, so their presence at the repo root is proof that
 * a test leaked SpecKiwi tooling output into the checkout.
 */
export const REPO_POLLUTION_SENTINELS: readonly string[] = [
  ".mcp.json",
  path.posix.join("docs", "spec", "steps"),
  path.posix.join(".claude", "skills"),
  path.posix.join(".codex", "hooks.json"),
  path.posix.join(".agents", "skills", "kiwi-step"),
  path.posix.join(".agents", "skills", "kiwi-wave-master")
];

/**
 * Returns the subset of {@link REPO_POLLUTION_SENTINELS} (or a caller-supplied
 * list) that currently exist under `repoRoot`. An empty array means the root is
 * hermetically clean; a non-empty array names the leaked artifacts.
 */
export function detectRepoPollution(repoRoot: string, sentinels: readonly string[] = REPO_POLLUTION_SENTINELS): string[] {
  return sentinels.filter((relative) => existsSync(path.join(repoRoot, relative)));
}
