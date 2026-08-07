import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, readdir, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

const MODULE_PATH = pathToFileURL(path.resolve("src/core/workflow/artifact-lock.ts")).href;
const CHILD_MARKER = "SPECKIWI_ARTIFACT_LOCK_CHILD";
const THIS_TEST = path.resolve("test/core/workflow/artifact-lock.fr-node-177.test.ts");
const VITEST_BIN = path.resolve("node_modules/vitest/vitest.mjs");

interface ArtifactLockIdentity {
  canonicalPath: string;
  lockPath: string;
}

interface ArtifactLockCapability extends ArtifactLockIdentity {
  ownerIdentitySha256: string;
  token: string;
}

type AcquireResult =
  | { ok: true; capability: ArtifactLockCapability }
  | { ok: false; reason: "held" | "io_error"; holder?: { ownerIdentitySha256?: string } };

type ReleaseResult =
  | { ok: true; released: true }
  | { ok: true; released: false; reason: "not_found" | "not_owner" }
  | { ok: false; reason: "cleanup_failed"; cleanupDiagnostic: Record<string, unknown> };

interface ArtifactLockModule {
  acquireArtifactLock(input: { artifactPath: string; owner: string }): Promise<AcquireResult>;
  releaseArtifactLock(capability: ArtifactLockCapability): Promise<ReleaseResult>;
  resolveArtifactLockIdentity(artifactPath: string): Promise<ArtifactLockIdentity>;
  retryRetainedArtifactLockCleanup(canonicalPath: string): Promise<ReleaseResult>;
}

interface Worker {
  child: ChildProcessWithoutNullStreams;
  completion: Promise<{ code: number | null; stderr: string; stdout: string }>;
}

async function loadArtifactLock(): Promise<ArtifactLockModule> {
  return import(MODULE_PATH) as Promise<ArtifactLockModule>;
}

async function fixture(): Promise<{ artifactPath: string; root: string }> {
  const root = await mkdtemp(path.join(tmpdir(), "speckiwi-artifact-lock-"));
  const artifactPath = path.join(root, "kiwi", "pipeline.jsonl");
  await mkdir(path.dirname(artifactPath), { recursive: true });
  await writeFile(artifactPath, '{"schema_version":"1.0.0"}\n', "utf8");
  return { artifactPath, root };
}

async function waitForFile(filePath: string, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await access(filePath);
      return;
    } catch {
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
    }
  }
  throw new Error(`Timed out waiting for ${filePath}`);
}

function startHolder(root: string, artifactPath: string): Worker {
  const child = spawn(process.execPath, [VITEST_BIN, "run", THIS_TEST, "--no-file-parallelism", "--testTimeout", "30000", "-t", "artifact lock child holder"], {
    cwd: process.cwd(),
    env: { ...process.env, [CHILD_MARKER]: "1", SPECKIWI_LOCK_ARTIFACT: artifactPath, SPECKIWI_LOCK_ROOT: root },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => { stdout += chunk; });
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
  return {
    child,
    completion: new Promise((resolve) => child.once("close", (code) => resolve({ code, stderr, stdout })))
  };
}

async function expectNoResidue(identity: ArtifactLockIdentity): Promise<void> {
  const directory = path.dirname(identity.lockPath);
  const prefix = path.basename(identity.lockPath);
  const entries = await readdir(directory);
  expect(entries.filter((entry) => entry === prefix || entry === `${prefix}.acquire` || entry.startsWith(`${prefix}.stale-`))).toEqual([]);
}

if (process.env[CHILD_MARKER] === "1") {
  it("artifact lock child holder", async () => {
    const module = await loadArtifactLock();
    const artifactPath = process.env.SPECKIWI_LOCK_ARTIFACT!;
    const root = process.env.SPECKIWI_LOCK_ROOT!;
    const acquired = await module.acquireArtifactLock({ artifactPath, owner: "child-holder" });
    expect(acquired).toMatchObject({ ok: true });
    await writeFile(path.join(root, "holder.ready"), "ready\n", "utf8");
    await waitForFile(path.join(root, "holder.release"));
  });
} else {
  // @req FR-NODE-177 AC-4/6/7/11
  describe("FR-NODE-177 canonical workflow artifact lock", () => {
    it("resolves normalized aliases to one canonical non-public lock identity", async () => {
      const module = await loadArtifactLock();
      const { artifactPath } = await fixture();
      const alias = path.join(path.dirname(artifactPath), ".", path.basename(artifactPath));
      const first = await module.resolveArtifactLockIdentity(artifactPath);
      const second = await module.resolveArtifactLockIdentity(alias);

      expect(second).toEqual(first);
      expect(first.canonicalPath).toBe(path.resolve(artifactPath));
      expect(first.lockPath).toEqual(expect.any(String));
      const packageJson = JSON.parse(await readFile(path.resolve("package.json"), "utf8")) as { exports?: Record<string, unknown> };
      expect(packageJson.exports).not.toHaveProperty("./core/workflow/artifact-lock");
    });

    it("uses owner capabilities for discriminated release and cannot delete a successor", async () => {
      const module = await loadArtifactLock();
      const { artifactPath } = await fixture();
      const first = await module.acquireArtifactLock({ artifactPath, owner: "first-owner" });
      expect(first).toMatchObject({ ok: true, capability: { ownerIdentitySha256: expect.any(String), token: expect.any(String) } });
      if (!first.ok) return;
      await expect(module.acquireArtifactLock({ artifactPath, owner: "contender" })).resolves.toMatchObject({ ok: false, reason: "held" });
      await expect(module.releaseArtifactLock(first.capability)).resolves.toEqual({ ok: true, released: true });

      const successor = await module.acquireArtifactLock({ artifactPath, owner: "successor" });
      expect(successor).toMatchObject({ ok: true });
      if (!successor.ok) return;
      await expect(module.releaseArtifactLock(first.capability)).resolves.toEqual({ ok: true, released: false, reason: "not_owner" });
      await expect(module.acquireArtifactLock({ artifactPath, owner: "after-old-release" })).resolves.toMatchObject({ ok: false, reason: "held" });
      await expect(module.releaseArtifactLock(successor.capability)).resolves.toEqual({ ok: true, released: true });
      await expectNoResidue(successor.capability);
    });

    it("does not steal a live holder based only on sentinel age and recovers it after process death", async () => {
      const module = await loadArtifactLock();
      const { artifactPath, root } = await fixture();
      const worker = startHolder(root, artifactPath);
      try {
        await waitForFile(path.join(root, "holder.ready"));
        const identity = await module.resolveArtifactLockIdentity(artifactPath);
        const old = new Date("2000-01-01T00:00:00.000Z");
        await utimes(identity.lockPath, old, old);
        await expect(module.acquireArtifactLock({ artifactPath, owner: "live-contender" })).resolves.toMatchObject({ ok: false, reason: "held" });

        worker.child.kill();
        await worker.completion;
        const recovered = await module.acquireArtifactLock({ artifactPath, owner: "dead-owner-successor" });
        expect(recovered).toMatchObject({ ok: true });
        if (!recovered.ok) return;
        await expect(module.releaseArtifactLock(recovered.capability)).resolves.toEqual({ ok: true, released: true });
        await expectNoResidue(recovered.capability);
      } finally {
        if (worker.child.exitCode === null) worker.child.kill();
      }
    });

    it("serializes guarded recovery of an old torn sentinel and leaves no residue", async () => {
      const module = await loadArtifactLock();
      const { artifactPath } = await fixture();
      const identity = await module.resolveArtifactLockIdentity(artifactPath);
      await writeFile(identity.lockPath, '{"version":1,"token":"torn', "utf8");
      const old = new Date("2000-01-01T00:00:00.000Z");
      await utimes(identity.lockPath, old, old);

      const attempts = await Promise.all([
        module.acquireArtifactLock({ artifactPath, owner: "recovery-a" }),
        module.acquireArtifactLock({ artifactPath, owner: "recovery-b" })
      ]);
      const winners = attempts.filter((attempt): attempt is Extract<AcquireResult, { ok: true }> => attempt.ok);
      expect(winners).toHaveLength(1);
      expect(attempts.filter((attempt) => !attempt.ok)).toEqual([expect.objectContaining({ ok: false, reason: "held" })]);
      await expect(module.releaseArtifactLock(winners[0]!.capability)).resolves.toEqual({ ok: true, released: true });
      await expectNoResidue(identity);
    });

    it("recovers one winner from an old torn acquisition guard and removes the guard", async () => {
      const module = await loadArtifactLock();
      const { artifactPath } = await fixture();
      const identity = await module.resolveArtifactLockIdentity(artifactPath);
      const guardPath = `${identity.lockPath}.acquire`;
      await writeFile(guardPath, "{\"torn-acquire-guard\"", "utf8");
      const old = new Date("2000-01-01T00:00:00.000Z");
      await utimes(guardPath, old, old);

      const attempts = await Promise.all([
        module.acquireArtifactLock({ artifactPath, owner: "guard-recovery-a" }),
        module.acquireArtifactLock({ artifactPath, owner: "guard-recovery-b" })
      ]);
      const winners = attempts.filter((attempt): attempt is Extract<AcquireResult, { ok: true }> => attempt.ok);
      expect(winners).toHaveLength(1);
      expect(attempts.filter((attempt) => !attempt.ok)).toEqual([
        expect.objectContaining({ ok: false, reason: "held" })
      ]);
      await expect(module.releaseArtifactLock(winners[0]!.capability)).resolves.toEqual({ ok: true, released: true });
      await expectNoResidue(identity);
    });

    it("cleans an old orphan quarantine through the canonical artifact-lock lifecycle", async () => {
      const module = await loadArtifactLock();
      const { artifactPath } = await fixture();
      const identity = await module.resolveArtifactLockIdentity(artifactPath);
      const quarantinePath = `${identity.lockPath}.stale-orphan-fixture`;
      await writeFile(quarantinePath, "orphan quarantine\n", "utf8");
      const old = new Date("2000-01-01T00:00:00.000Z");
      await utimes(quarantinePath, old, old);

      const acquired = await module.acquireArtifactLock({ artifactPath, owner: "quarantine-recovery" });
      expect(acquired).toMatchObject({ ok: true });
      if (!acquired.ok) return;
      await expect(module.releaseArtifactLock(acquired.capability)).resolves.toEqual({ ok: true, released: true });
      await expectNoResidue(identity);
    });

    it("exposes a same-process retained-cleanup retry without treating a digest as authority", async () => {
      const module = await loadArtifactLock();
      const { artifactPath } = await fixture();
      const identity = await module.resolveArtifactLockIdentity(artifactPath);
      expect(typeof module.retryRetainedArtifactLockCleanup).toBe("function");
      await expect(module.retryRetainedArtifactLockCleanup(identity.canonicalPath)).resolves.toEqual({ ok: true, released: false, reason: "not_found" });
    });
  });
}
