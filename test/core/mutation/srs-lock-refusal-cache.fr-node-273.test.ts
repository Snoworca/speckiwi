import { describe, expect, it } from "vitest";
import { addTraceLink } from "../../../src/core/mutation/add-trace.js";
import { withSrsMutationLock } from "../../../src/core/mutation/srs-lock.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { readSrsStatusCache } from "../../../src/core/status-cache.js";
import type { ProjectRoot } from "../../../src/core/types.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

// A refusal decided inside the SRS mutation lock (here: a Requirement trace target that does not
// exist, which add_trace_link checks only after taking the lock) writes no SRS file.

async function refuseInsideLock(root: ProjectRoot) {
  const refused = await addTraceLink(root, { id: "FR-ARCH-001", type: "Requirement", reference: "FR-ARCH-999", relation: "depends_on" });
  expect(refused).toMatchObject({ ok: false, error: { message: "Trace target not found: FR-ARCH-999" } });
}

describe("FR-NODE-273 a mutation refused inside the SRS lock leaves the status cache unlocked", () => {
  it("@req FR-NODE-273 AC-1: kiwi/.status.json records no held lock after the refused call returns", async () => {
    const root = await resolveProjectRoot(await copyFixtureWorkspace("valid-basic"));

    await refuseInsideLock(root);

    const cache = await readSrsStatusCache(root);
    expect(cache.ok).toBe(true);
    expect(cache.ok && cache.value.lock).toEqual({ active: false, metadata: null });
  }, 30_000);

  it("@req FR-NODE-273 AC-2: the next mutation, reading the cache before the lock TTL, does not see the earlier lock held", async () => {
    const root = await resolveProjectRoot(await copyFixtureWorkspace("valid-basic"));

    await refuseInsideLock(root);

    // A dry run takes the lock without rewriting the cache, so it reads what the refusal left.
    let seen: unknown;
    const next = await withSrsMutationLock(root, { operation: "fr-node-273-next", dryRun: true }, async () => {
      const cache = await readSrsStatusCache(root);
      seen = cache.ok ? cache.value.lock : cache.diagnostics;
      return { ok: true, value: { written: false }, diagnostics: [], diagnosticsSummary: { errors: 0, warnings: 0, byCode: {} } };
    });
    expect(next.ok).toBe(true);
    expect(seen).toEqual({ active: false, metadata: null });
  }, 30_000);
});
