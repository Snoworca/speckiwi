import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import type * as FsPromisesModule from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { WorkflowMutationInput } from "../../../src/core/workflow/mutation.js";

type FsPromises = typeof FsPromisesModule;
type AppendFault = "partial-write" | "full-write" | "sync" | "close";

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

const PIPELINE_PATH = "kiwi/pipeline.jsonl";
const RUN_ID = "2026-08-07.wave3.record-reclassification.fault-window";
const MUTATION_MODULE = "../../../src/core/workflow/mutation.js";
const ARTIFACT_LOCK_MODULE = "../../../src/core/workflow/artifact-lock.js";

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function ioError(operation: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`injected ${operation} failure`), { code: "EIO" });
}

async function fixture(): Promise<{
  root: string;
  artifactPath: string;
  identity: TargetIdentity;
}> {
  const root = await mkdtemp(path.join(tmpdir(), "speckiwi-reclassification-fault-"));
  const artifactPath = path.join(root, PIPELINE_PATH);
  const raw = JSON.stringify({
    ts: "2026-08-07T00:00:00.000Z",
    schema_version: "1.0.0",
    skill: "kiwi-wave-master",
    run_id: "wave3-r4-fault-window",
    target: "wave-3",
    status: "CORRECTION",
    summary: "Audit record requiring reclassification",
    next_hint: "kiwi-pm",
    artifacts: { spec_files: [], plan_file: null, sidecar_file: null, analysis_dir: "docs/memory" },
    dry_run: false,
    req_ids: ["FR-NODE-177"],
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
      eventKey: "kiwi-wave-master|wave3-r4-fault-window",
      targetRunId: "wave3-r4-fault-window",
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

async function faultedModules(artifactPath: string, fault: AppendFault) {
  let armed = false;
  let hit = false;
  vi.resetModules();
  vi.doMock("node:fs/promises", async (importOriginal) => {
    const actual = await importOriginal<FsPromises>();
    return {
      ...actual,
      open: async (...args: Parameters<FsPromises["open"]>) => {
        const handle = await actual.open(...args);
        const requestedPath = path.resolve(String(args[0]));
        if (!armed || requestedPath !== path.resolve(artifactPath) || args[1] !== "a") return handle;
        return {
          writeFile: async (...writeArgs: Parameters<typeof handle.writeFile>) => {
            if (!hit && (fault === "partial-write" || fault === "full-write")) {
              hit = true;
              const bytes = Buffer.from(String(writeArgs[0]), "utf8");
              await handle.writeFile(fault === "partial-write" ? bytes.subarray(0, Math.max(1, Math.floor(bytes.length / 2))) : bytes);
              throw ioError(fault);
            }
            return handle.writeFile(...writeArgs);
          },
          sync: async () => {
            if (!hit && fault === "sync") {
              hit = true;
              throw ioError(fault);
            }
            return handle.sync();
          },
          close: async () => {
            await handle.close();
            if (!hit && fault === "close") {
              hit = true;
              throw ioError(fault);
            }
          }
        };
      }
    } as FsPromises;
  });
  const mutation = await import(MUTATION_MODULE);
  const artifactLock = await import(ARTIFACT_LOCK_MODULE);
  return { mutation, artifactLock, arm: () => { armed = true; }, hit: () => hit };
}

afterEach(() => {
  vi.doUnmock("node:fs/promises");
  vi.resetModules();
  vi.restoreAllMocks();
});

// @req FR-NODE-177 AC-6/7
describe("FR-NODE-177 record reclassification append fault windows", () => {
  it.each(["partial-write", "full-write", "sync", "close"] as const)(
    "returns exact confirmation-pending state after an overlay %s fault",
    async (fault) => {
      const { root, artifactPath, identity } = await fixture();
      const modules = await faultedModules(artifactPath, fault);
      const preview = await modules.mutation.applyWorkflowMutation({ root }, input(identity));
      expect(preview).toMatchObject({ ok: true, value: { repairToken: expect.any(String) } });
      const previewValue = preview.value as unknown as Record<string, unknown>;
      const previewRepair = previewValue.pendingRepair as Record<string, unknown>;
      modules.arm();

      const result = await modules.mutation.applyWorkflowMutation(
        { root },
        input(identity, { dryRun: false, repairToken: previewValue.repairToken })
      );
      const durableBytes = await readFile(artifactPath);

      expect(modules.hit(), "the requested append fault must be reached").toBe(true);
      expect(result).toMatchObject({
        ok: false,
        mutation: {
          written: false,
          journalState: "failed",
          completedOperations: [expect.stringMatching(/write/i)],
          pendingOperations: [expect.stringMatching(/confirm/i)],
          pendingRepair: {
            kind: "record_reclassification_confirmation",
            artifact: { relativePath: PIPELINE_PATH, postAppendSha256: sha256(durableBytes) },
            targetRecord: identity,
            overlayEventKey: previewRepair.overlayEventKey,
            retry: { action: "retry_same_record_reclassification", mode: "confirm_only" }
          }
        }
      });
      expect((result.mutation as Record<string, unknown>).pendingRepair).toEqual({
        kind: "record_reclassification_confirmation",
        artifact: { relativePath: PIPELINE_PATH, postAppendSha256: sha256(durableBytes) },
        targetRecord: identity,
        overlayEventKey: previewRepair.overlayEventKey,
        retry: { action: "retry_same_record_reclassification", mode: "confirm_only" }
      });
    }
  );

  it("retains cleanup authority when sync failure and lock release failure occur together", async () => {
    const { root, artifactPath, identity } = await fixture();
    const modules = await faultedModules(artifactPath, "sync");
    const preview = await modules.mutation.applyWorkflowMutation({ root }, input(identity));
    const previewValue = preview.value as unknown as Record<string, unknown>;
    const cleanupDiagnostic = { code: "EACCES", message: "injected simultaneous release failure" };
    const realRelease = modules.artifactLock.releaseArtifactLock;
    let retainedCapability: Parameters<typeof modules.artifactLock.releaseArtifactLock>[0] | undefined;
    const release = vi.spyOn(modules.artifactLock, "releaseArtifactLock").mockImplementationOnce(async (capability) => {
      retainedCapability = capability;
      return { ok: false, reason: "cleanup_failed", cleanupDiagnostic };
    });
    const retry = vi.spyOn(modules.artifactLock, "retryRetainedArtifactLockCleanup").mockImplementation(async () => {
      expect(retainedCapability).toBeDefined();
      const result = await realRelease(retainedCapability!);
      if (result.ok && result.released) retainedCapability = undefined;
      return result;
    });
    modules.arm();

    const failed = await modules.mutation.applyWorkflowMutation(
      { root },
      input(identity, { dryRun: false, repairToken: previewValue.repairToken })
    );
    const durableBytes = await readFile(artifactPath);
    const lockIdentity = await modules.artifactLock.resolveArtifactLockIdentity(artifactPath);
    const relativeLockPath = path.relative(root, lockIdentity.lockPath).replaceAll("\\", "/");

    expect(release).toHaveBeenCalledTimes(1);
    expect(failed).toMatchObject({
      ok: false,
      mutation: {
        written: false,
        completedOperations: [expect.stringMatching(/write/i)],
        pendingOperations: expect.arrayContaining([expect.stringMatching(/confirm/i), expect.stringMatching(/cleanup/i)]),
        pendingRepair: expect.any(Object)
      }
    });
    expect((failed.mutation as Record<string, unknown>).pendingRepair).toEqual({
      kind: "record_reclassification_lock_cleanup",
      artifact: { relativePath: PIPELINE_PATH, postAppendSha256: sha256(durableBytes) },
      lock: {
        relativePath: relativeLockPath,
        ownerIdentitySha256: retainedCapability!.ownerIdentitySha256
      },
      cleanupDiagnostic,
      retry: { action: "retry_same_record_reclassification", mode: "cleanup_then_replay" }
    });

    const replay = await modules.mutation.applyWorkflowMutation(
      { root },
      input(identity, { dryRun: false, repairToken: previewValue.repairToken })
    );
    expect(retry).toHaveBeenCalledTimes(1);
    expect(retainedCapability).toBeUndefined();
    expect(replay).toMatchObject({
      ok: true,
      value: { written: false, journalState: "confirmed", pendingRepair: null },
      mutation: { written: false, operations: [] }
    });
    const overlays = (await readFile(artifactPath, "utf8"))
      .trimEnd()
      .split(/\r?\n/)
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((event) => event.event === "record_reclassification");
    expect(overlays).toHaveLength(1);
    const entries = await readdir(path.dirname(lockIdentity.lockPath));
    const lockName = path.basename(lockIdentity.lockPath);
    expect(entries.filter((entry) => entry === lockName || entry === `${lockName}.acquire` || entry.startsWith(`${lockName}.stale-`))).toEqual([]);
  });
});
