import { appendFileSync } from "node:fs";

/**
 * @req FR-NODE-104 AC-2 — the HV-1..HV-3 suites must run from at least three distinct process
 * working directories and produce the same result in each.
 *
 * A spawned run can only *claim* it ran from a given cwd; the claim is worth nothing unless the
 * suite under test records what it actually observed. Each harvest suite calls this at module
 * scope, and `harvest.fr-node-104.test.ts` asserts the three recorded values are distinct and are
 * the three it intended — so a vitest that silently chdir'd to its root would fail the assertion
 * rather than pass a vacuous one.
 */
export function recordHarvestCwd(suite: "HV-1" | "HV-2" | "HV-3"): void {
  const target = process.env.SPECKIWI_HARVEST_CWD_RECORD;
  if (!target) return;
  appendFileSync(target, `${JSON.stringify({ suite, cwd: process.cwd() })}\n`, "utf8");
}
