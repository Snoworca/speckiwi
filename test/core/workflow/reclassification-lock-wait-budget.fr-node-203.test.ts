import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import type * as FsPromisesModule from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { WorkflowMutationInput } from "../../../src/core/workflow/mutation.js";

type FsPromises = typeof FsPromisesModule;

const PIPELINE_PATH = "kiwi/pipeline.jsonl";
const RUN_ID = "2026-08-31.fr-node-203.lock-wait-budget";
const MUTATION_MODULE = "../../../src/core/workflow/mutation.js";
const ARTIFACT_LOCK_MODULE = "../../../src/core/workflow/artifact-lock.js";

interface TargetIdentity {
  path: string;
  recordType: "pipeline";
  line: number;
  byteOffset: number;
  rawSha256: string;
  eventKey: string;
  targetRunId: string;
  preimagePrefixSha256: string;
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

/** The code Windows returns for an open of a delete-pending sentinel. @req FR-NODE-203 */
function transientLockError(): NodeJS.ErrnoException {
  return Object.assign(new Error("EPERM: operation not permitted, open 'artifact.speckiwi.lock'"), { code: "EPERM" });
}

async function fixture(): Promise<{ root: string; artifactPath: string; identity: TargetIdentity }> {
  const root = await mkdtemp(path.join(tmpdir(), "speckiwi-fr-node-203-budget-"));
  const artifactPath = path.join(root, PIPELINE_PATH);
  const raw = JSON.stringify({
    ts: "2026-08-31T00:00:00.000Z",
    schema_version: "1.0.0",
    skill: "kiwi-wave-master",
    run_id: "budget-target",
    target: "wave-3",
    status: "CORRECTION",
    summary: "Audit record requiring reclassification",
    next_hint: "kiwi-pm",
    artifacts: { spec_files: [], plan_file: null, sidecar_file: null, analysis_dir: "docs/memory" },
    dry_run: false,
    req_ids: ["FR-NODE-203"],
    notes: "Audit metadata"
  });
  const before = `${raw}\n`;
  await mkdir(path.dirname(artifactPath), { recursive: true });
  await writeFile(artifactPath, before, "utf8");
  return {
    root,
    artifactPath,
    identity: {
      path: PIPELINE_PATH,
      recordType: "pipeline",
      line: 1,
      byteOffset: 0,
      rawSha256: sha256(raw),
      eventKey: "kiwi-wave-master|budget-target",
      targetRunId: "budget-target",
      preimagePrefixSha256: sha256(before)
    }
  };
}

function input(identity: TargetIdentity, overrides: Record<string, unknown> = {}): WorkflowMutationInput {
  return {
    kind: "workflow_record_reclassification",
    owner: "codex",
    reason: "Retain the target as audit metadata",
    runId: RUN_ID,
    expectedSha256: String(identity.preimagePrefixSha256),
    dryRun: true,
    jsonlPath: PIPELINE_PATH,
    ...identity,
    ...overrides
  } as unknown as WorkflowMutationInput;
}

/**
 * Arms a fault on the `wx` create that publishes the sentinel. This is the path the narrow
 * `readHolderAt` absorption does NOT reach: a waiter that wins the kernel fence while the previous
 * holder's sentinel is still delete-pending is refused by `open`, and `publishExclusive` rethrows
 * anything that is not EEXIST. It is the measurement that decided the wait loop had to absorb a
 * raised fault too. @req FR-NODE-203 AC-3
 */
async function modulesWithPublishFault(lockPath: string, faults: number) {
  const evidence = { armed: false, hits: 0 };
  vi.resetModules();
  vi.doMock("node:fs/promises", async (importOriginal) => {
    const actual = await importOriginal<FsPromises>();
    return {
      ...actual,
      open: (async (...args: Parameters<typeof actual.open>) => {
        const requested = path.resolve(String(args[0]));
        if (evidence.armed && requested === path.resolve(lockPath) && args[1] === "wx" && evidence.hits < faults) {
          evidence.hits += 1;
          throw transientLockError();
        }
        return actual.open(...args);
      }) as typeof actual.open
    };
  });
  const mutation = await import(MUTATION_MODULE);
  return { mutation, evidence, arm: () => { evidence.armed = true; } };
}

afterEach(() => {
  vi.doUnmock("node:fs/promises");
  vi.resetModules();
  vi.restoreAllMocks();
});

// @req FR-NODE-203 AC-3
describe("FR-NODE-203 the reclassification lock wait budget survives a transient acquisition fault", () => {
  it("retries inside the budget and succeeds instead of refusing on the first transient fault", async () => {
    const { root, identity } = await fixture();
    try {
      const mutation = await import(MUTATION_MODULE);
      const artifactLock = await import(ARTIFACT_LOCK_MODULE);

      const preview = await mutation.applyWorkflowMutation({ root }, input(identity));
      expect(preview).toMatchObject({ ok: true, value: { repairToken: expect.any(String) } });
      const repairToken = (preview.value as Record<string, unknown>).repairToken;

      const transientFaults = 4;
      let attempts = 0;
      const real = artifactLock.acquireArtifactLock;
      vi.spyOn(artifactLock, "acquireArtifactLock").mockImplementation(async (request) => {
        attempts += 1;
        if (attempts <= transientFaults) throw transientLockError();
        return real(request);
      });

      const applied = await mutation.applyWorkflowMutation({ root }, input(identity, { dryRun: false, repairToken }));

      expect(attempts, "a transient fault must re-enter the wait loop rather than exit the function")
        .toBe(transientFaults + 1);
      expect(applied).toMatchObject({ ok: true, mutation: { written: true } });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("waits out a fault raised where the sentinel is created, which the holder-read absorption never sees", async () => {
    const { root, artifactPath, identity } = await fixture();
    try {
      const artifactLock = await import(ARTIFACT_LOCK_MODULE);
      const lockIdentity = await artifactLock.resolveArtifactLockIdentity(artifactPath);

      const publishFaults = 3;
      const modules = await modulesWithPublishFault(lockIdentity.lockPath, publishFaults);
      const preview = await modules.mutation.applyWorkflowMutation({ root }, input(identity));
      const repairToken = (preview.value as Record<string, unknown>).repairToken;
      modules.arm();

      const applied = await modules.mutation.applyWorkflowMutation({ root }, input(identity, { dryRun: false, repairToken }));

      expect(modules.evidence.hits, "the sentinel create fault must be reached").toBe(publishFaults);
      expect(applied).toMatchObject({ ok: true, mutation: { written: true } });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("refuses only after the budget is spent, and names the fault that spent it", async () => {
    const { root, identity } = await fixture();
    try {
      const mutation = await import(MUTATION_MODULE);
      const artifactLock = await import(ARTIFACT_LOCK_MODULE);

      const preview = await mutation.applyWorkflowMutation({ root }, input(identity));
      const repairToken = (preview.value as Record<string, unknown>).repairToken;

      let attempts = 0;
      vi.spyOn(artifactLock, "acquireArtifactLock").mockImplementation(async () => {
        attempts += 1;
        throw transientLockError();
      });

      // The loop measures its budget with `process.hrtime.bigint`, so the clock is advanced rather
      // than waited out: a real 30-second wait would be a 30-second test.
      const budgetNanoseconds = 30_000_000_000n;
      let clock = 0n;
      let armed = false;
      const realBigint = process.hrtime.bigint;
      vi.spyOn(process.hrtime, "bigint").mockImplementation(() => {
        if (!armed) return realBigint.call(process.hrtime);
        clock += budgetNanoseconds / 5n;
        return clock;
      });
      armed = true;

      const refused = await mutation.applyWorkflowMutation({ root }, input(identity, { dryRun: false, repairToken }));
      armed = false;

      expect(attempts, "the refusal must arrive after repeated attempts, not after the first")
        .toBeGreaterThan(1);
      expect(refused).toMatchObject({
        ok: false,
        mutation: { written: false, journalState: "failed" },
        diagnostics: [expect.objectContaining({
          code: "SRS-E075",
          details: expect.objectContaining({ operation: "acquire", code: "EPERM" })
        })]
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
