import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import type { Stats } from "node:fs";
import { cp, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { applyChange } from "../../src/core/apply-change.js";
import { createProposal } from "../../src/core/propose-change.js";

const root = resolve(import.meta.dirname, "../..");
const tempRoots: string[] = [];
const execFileAsync = promisify(execFile);

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("concurrent apply", () => {
  it("allows only one same-target proposal to win", async () => {
    const workspace = await copyFixture();
    const first = await createProposal(updateStatementChange(workspace, "The system shall apply one concurrent update."));
    const second = await createProposal(updateStatementChange(workspace, "The system shall reject the competing concurrent update."));

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);

    const results = await Promise.all([
      applyChange({ root: workspace, confirm: true, proposalPath: first.ok ? first.proposal.path : "" }),
      applyChange({ root: workspace, confirm: true, proposalPath: second.ok ? second.proposal.path : "" })
    ]);

    expect(results.filter((result) => result.ok).length).toBe(1);
    expect(results.filter((result) => !result.ok).map((result) => (!result.ok ? result.error.code : ""))).toEqual([
      expect.stringMatching(/^APPLY_REJECTED_(LOCK_CONFLICT|STALE_PROPOSAL)$/)
    ]);
  });

  it("rejects a same-target write lock held by another node process", async () => {
    const workspace = await copyFixture();
    const holder = runLockProcess(workspace, 750);

    await waitForFile(applyLockPath(workspace, "srs/core.yaml"));
    const contender = await runLockProcess(workspace, 0);
    const holderResult = await holder;

    expect(JSON.parse(holderResult.stdout)).toMatchObject({ ok: true });
    expect(JSON.parse(contender.stdout)).toMatchObject({ ok: false, code: "APPLY_REJECTED_LOCK_CONFLICT" });
    await expect(fileStat(applyLockPath(workspace, "srs/core.yaml"))).resolves.toBeUndefined();
  });

  it("allows only one same-target CLI apply process to win", async () => {
    const workspace = await copyFixture();
    await writeFile(join(workspace, ".speckiwi", "cache", "apply-race-pad.txt"), "x".repeat(8 * 1024 * 1024), "utf8");

    const results = await Promise.all([
      runCliApplyProcess(workspace, "The system shall apply the first cross-process CLI update."),
      runCliApplyProcess(workspace, "The system shall reject the competing cross-process CLI update.")
    ]);
    const payloads = results.map((result) => JSON.parse(result.stdout) as { ok: boolean; error?: { code?: string } });

    expect(payloads.filter((payload) => payload.ok).length).toBe(1);
    expect(payloads.filter((payload) => !payload.ok).map((payload) => payload.error?.code)).toEqual([
      expect.stringMatching(/^APPLY_REJECTED_(LOCK_CONFLICT|STALE_PROPOSAL)$/)
    ]);
    expect(results.filter((result) => result.status === 0).length).toBe(1);
    expect(results.filter((result) => result.status === 5).length).toBe(1);
  });
});

function updateStatementChange(workspace: string, statement: string) {
  return {
    root: workspace,
    operation: "update_requirement" as const,
    target: { kind: "requirement" as const, requirementId: "FR-CORE-0001" },
    changes: [{ op: "replace" as const, path: "/requirements/0/statement", value: statement }],
    reason: "Update statement."
  };
}

async function copyFixture(): Promise<string> {
  const workspace = await mkdtemp(join(tmpdir(), "speckiwi-apply-race-"));
  tempRoots.push(workspace);
  await cp(resolve(root, "test/fixtures/workspaces/valid-basic"), workspace, { recursive: true });
  return workspace;
}

function runLockProcess(workspace: string, holdMs: number) {
  const lockModuleUrl = pathToFileURL(resolve(root, "dist/write/lock.js")).href;
  const workspaceModuleUrl = pathToFileURL(resolve(root, "dist/io/workspace.js")).href;
  const script = `
    import { withTargetWriteLock } from ${JSON.stringify(lockModuleUrl)};
    import { workspaceRootFromPath } from ${JSON.stringify(workspaceModuleUrl)};
    const workspace = workspaceRootFromPath(process.argv[1]);
    const holdMs = Number(process.argv[2]);
    try {
      await withTargetWriteLock(workspace, "srs/core.yaml", async () => {
        await new Promise((resolve) => setTimeout(resolve, holdMs));
      });
      console.log(JSON.stringify({ ok: true }));
    } catch (error) {
      console.log(JSON.stringify({
        ok: false,
        code: typeof error === "object" && error !== null && "code" in error ? error.code : "UNKNOWN",
        message: error instanceof Error ? error.message : String(error)
      }));
    }
  `;
  return execFileAsync(process.execPath, ["--input-type=module", "-e", script, workspace, String(holdMs)], { cwd: root });
}

function runCliApplyProcess(workspace: string, statement: string): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return runNodeProcess([
    "bin/speckiwi",
    "req",
    "update",
    "FR-CORE-0001",
    "--statement",
    statement,
    "--apply",
    "--root",
    workspace,
    "--json"
  ]);
}

function runNodeProcess(args: string[]): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: root });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (status) => {
      resolve({ status, stdout, stderr });
    });
  });
}

async function waitForFile(path: string): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    if ((await fileStat(path)) !== undefined) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${path}.`);
}

async function fileStat(path: string): Promise<void | Stats> {
  try {
    return await stat(path);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

function applyLockPath(workspace: string, target: string): string {
  return join(workspace, ".speckiwi", ".locks", `${createHash("sha256").update(target).digest("hex")}.json`);
}
