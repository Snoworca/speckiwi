import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { applyChange } from "../../src/core/apply-change.js";
import { createProposal } from "../../src/core/propose-change.js";

const root = resolve(import.meta.dirname, "../..");
const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("apply engine", () => {
  it("applies validated changes atomically, creates a backup, and marks cache stale", async () => {
    const workspace = await copyFixture("speckiwi-apply-ok-");
    const result = await applyChange({
      root: workspace,
      confirm: true,
      change: updateStatementChange(workspace, "The system shall validate workspace YAML documents through apply.")
    });

    expect(result).toMatchObject({
      ok: true,
      applied: true,
      modifiedFiles: [".speckiwi/srs/core.yaml"],
      cacheStale: true
    });
    expect(await readFile(join(workspace, ".speckiwi", "srs", "core.yaml"), "utf8")).toContain(
      "The system shall validate workspace YAML documents through apply."
    );
    expect(await readFile(join(workspace, ".speckiwi", "cache", "stale.json"), "utf8")).toContain(".speckiwi/srs/core.yaml");
    expect(await fileExists(join(workspace, ".speckiwi", "cache", "backups"))).toBe(true);
  });

  it("applies in bypass mode without marking cache stale", async () => {
    const workspace = await copyFixture("speckiwi-apply-bypass-");
    const result = await applyChange({
      root: workspace,
      cacheMode: "bypass",
      confirm: true,
      change: updateStatementChange(workspace, "The system shall apply source YAML while bypassing cache writes.")
    });

    expect(result).toMatchObject({
      ok: true,
      applied: true,
      modifiedFiles: [".speckiwi/srs/core.yaml"],
      cacheStale: false
    });
    expect(await readFile(join(workspace, ".speckiwi", "srs", "core.yaml"), "utf8")).toContain("bypassing cache writes");
    expect(await fileExists(join(workspace, ".speckiwi", "cache", "stale.json"))).toBe(false);
  });

  it("rejects missing confirm, stale proposals, validation errors, and allowApply=false", async () => {
    const confirmWorkspace = await copyFixture("speckiwi-apply-confirm-");
    await expect(applyChange({ root: confirmWorkspace, change: updateStatementChange(confirmWorkspace, "x") } as never)).resolves.toMatchObject({
      ok: false,
      error: { code: "APPLY_REJECTED_CONFIRM_REQUIRED" }
    });

    const staleWorkspace = await copyFixture("speckiwi-apply-stale-");
    const proposal = await createProposal(updateStatementChange(staleWorkspace, "The system shall apply the first valid update."));
    expect(proposal.ok).toBe(true);
    const proposalPath = proposal.ok ? proposal.proposal.path : "";
    await applyChange({ root: staleWorkspace, confirm: true, proposalPath });
    await expect(applyChange({ root: staleWorkspace, confirm: true, proposalPath })).resolves.toMatchObject({
      ok: false,
      error: { code: "APPLY_REJECTED_STALE_PROPOSAL" }
    });

    const invalidWorkspace = await copyFixture("speckiwi-apply-invalid-");
    const before = await readFile(join(invalidWorkspace, ".speckiwi", "srs", "core.yaml"), "utf8");
    await expect(applyChange({ root: invalidWorkspace, confirm: true, change: updateStatementChange(invalidWorkspace, "") })).resolves.toMatchObject({
      ok: false,
      error: { code: "APPLY_REJECTED_VALIDATION_ERROR" }
    });
    expect(await readFile(join(invalidWorkspace, ".speckiwi", "srs", "core.yaml"), "utf8")).toBe(before);

    const disabledWorkspace = await copyFixture("speckiwi-apply-disabled-");
    await writeFile(
      join(disabledWorkspace, ".speckiwi", "index.yaml"),
      (await readFile(join(disabledWorkspace, ".speckiwi", "index.yaml"), "utf8")).replace(
        "documents:\n",
        "settings:\n  agent:\n    allowApply: false\ndocuments:\n"
      ),
      "utf8"
    );
    await expect(
      applyChange({
        root: disabledWorkspace,
        confirm: true,
        change: updateStatementChange(disabledWorkspace, "The system shall not apply when disabled.")
      })
    ).resolves.toMatchObject({ ok: false, error: { code: "APPLY_REJECTED_ALLOW_APPLY_FALSE" } });
  });

  it("rejects workspace-external symlink apply targets without modifying external content", async () => {
    const workspace = await copyFixture("speckiwi-apply-symlink-");
    const proposal = await createProposal(updateStatementChange(workspace, "The system shall reject external symlink apply targets."));
    expect(proposal.ok).toBe(true);

    const external = join(await mkdtemp(join(tmpdir(), "speckiwi-apply-external-")), "core.yaml");
    tempRoots.push(resolve(external, ".."));
    const externalBefore = "schemaVersion: speckiwi/srs/v1\nid: external\n";
    await writeFile(external, externalBefore, "utf8");
    await rm(join(workspace, ".speckiwi", "srs", "core.yaml"));
    await symlink(external, join(workspace, ".speckiwi", "srs", "core.yaml"), "file");

    await expect(applyChange({ root: workspace, confirm: true, proposalPath: proposal.ok ? proposal.proposal.path : "" })).resolves.toMatchObject({
      ok: false,
      error: { code: "APPLY_REJECTED_TARGET_INVALID" }
    });
    expect(await readFile(external, "utf8")).toBe(externalBefore);
  });

  it("rejects workspace-external symlink apply policy files", async () => {
    const workspace = await copyFixture("speckiwi-apply-policy-symlink-");
    const external = join(await mkdtemp(join(tmpdir(), "speckiwi-apply-index-external-")), "index.yaml");
    tempRoots.push(resolve(external, ".."));
    await writeFile(external, "schemaVersion: speckiwi/index/v1\nproject:\n  id: external\ndocuments: []\n", "utf8");
    await rm(join(workspace, ".speckiwi", "index.yaml"));
    await symlink(external, join(workspace, ".speckiwi", "index.yaml"), "file");

    await expect(
      applyChange({
        root: workspace,
        confirm: true,
        change: updateStatementChange(workspace, "The system shall reject external symlink policy files.")
      })
    ).resolves.toMatchObject({ ok: false, error: { code: "APPLY_REJECTED_TARGET_INVALID" } });
  });

  it("rejects workspace-external symlink lock directories", async () => {
    const workspace = await copyFixture("speckiwi-apply-lock-symlink-");
    const externalLocks = await mkdtemp(join(tmpdir(), "speckiwi-apply-locks-external-"));
    tempRoots.push(externalLocks);
    await rm(join(workspace, ".speckiwi", ".locks"), { recursive: true, force: true });
    await symlink(externalLocks, join(workspace, ".speckiwi", ".locks"), "dir");

    await expect(
      applyChange({
        root: workspace,
        confirm: true,
        change: updateStatementChange(workspace, "The system shall reject external symlink lock directories.")
      })
    ).resolves.toMatchObject({ ok: false, error: { code: "APPLY_REJECTED_TARGET_INVALID" } });
    expect(await readdir(externalLocks)).toEqual([]);
  });

  it("rejects workspace-external symlink stale lock cleanup directories", async () => {
    const workspace = await copyFixture("speckiwi-apply-cleanup-symlink-");
    const externalCleanup = await mkdtemp(join(tmpdir(), "speckiwi-apply-cleanup-external-"));
    tempRoots.push(externalCleanup);
    const target = "srs/core.yaml";
    const lockHash = createHash("sha256").update(target).digest("hex");
    const locksDirectory = join(workspace, ".speckiwi", ".locks");
    await mkdir(locksDirectory, { recursive: true });
    await writeFile(
      join(locksDirectory, `${lockHash}.json`),
      `${JSON.stringify({
        version: 1,
        target,
        token: "stale",
        pid: 0,
        hostname: "test",
        createdAt: "2000-01-01T00:00:00.000Z",
        expiresAt: "2000-01-01T00:00:00.000Z"
      })}\n`,
      "utf8"
    );
    await writeFile(join(externalCleanup, "outside.txt"), "keep\n", "utf8");
    await symlink(externalCleanup, join(locksDirectory, `${lockHash}.json.cleanup`), "dir");

    await expect(
      applyChange({
        root: workspace,
        confirm: true,
        change: updateStatementChange(workspace, "The system shall reject external symlink cleanup locks.")
      })
    ).resolves.toMatchObject({ ok: false, error: { code: "APPLY_REJECTED_TARGET_INVALID" } });
    expect((await readdir(externalCleanup)).sort()).toEqual(["outside.txt"]);
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

async function copyFixture(prefix: string): Promise<string> {
  const workspace = await mkdtemp(join(tmpdir(), prefix));
  tempRoots.push(workspace);
  await cp(resolve(root, "test/fixtures/workspaces/valid-basic"), workspace, { recursive: true });
  return workspace;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
