import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createSpecKiwiCore } from "../../src/core/api.js";
import { applyChange } from "../../src/core/apply-change.js";
import { getReadModelMemoStats, resetReadModelMemoStats, clearReadModelMemo } from "../../src/core/read-model.js";
import { createProposal } from "../../src/core/propose-change.js";

const root = resolve(import.meta.dirname, "../..");
const tempRoots: string[] = [];

afterEach(async () => {
  clearReadModelMemo();
  resetReadModelMemoStats();
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
    await rm(join(workspace, ".speckiwi", "cache"), { recursive: true, force: true });
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
    expect(await fileExists(join(workspace, ".speckiwi", "cache"))).toBe(false);
  });

  it("clears memoized requirement lists after apply so repeated reads do not stay stale", async () => {
    const workspace = await copyFixture("speckiwi-apply-memo-");
    const core = createSpecKiwiCore({ root: workspace });

    resetReadModelMemoStats();
    const before = await core.listRequirements();
    const warm = await core.listRequirements();
    expect(before).toMatchObject({ ok: true, requirements: [{ id: "FR-CORE-0001" }] });
    expect(warm).toMatchObject({ ok: true, requirements: [{ id: "FR-CORE-0001" }] });
    expect(getReadModelMemoStats()).toMatchObject({ misses: 1, hits: 1 });

    await applyChange({
      root: workspace,
      confirm: true,
      change: updateStatementChange(workspace, "The system shall invalidate read-model memoized lists after apply.")
    });

    const after = await core.listRequirements();
    expect(after).toMatchObject({
      ok: true,
      requirements: [{ id: "FR-CORE-0001", statement: "The system shall invalidate read-model memoized lists after apply." }]
    });
    expect(getReadModelMemoStats().misses).toBeGreaterThanOrEqual(2);
  });

  it("rejects missing confirm, stale proposals, validation errors, and allowApply=false", async () => {
    const confirmWorkspace = await copyFixture("speckiwi-apply-confirm-");
    const confirmMissing = await applyChange({ root: confirmWorkspace, change: updateStatementChange(confirmWorkspace, "x") } as never);
    expect(confirmMissing).toMatchObject({
      ok: false,
      error: { code: "APPLY_REJECTED_CONFIRM_REQUIRED" },
      diagnostics: { errors: [{ details: { recovery: expect.any(String) } }] }
    });

    const staleWorkspace = await copyFixture("speckiwi-apply-stale-");
    const proposal = await createProposal(updateStatementChange(staleWorkspace, "The system shall apply the first valid update."));
    expect(proposal.ok).toBe(true);
    const proposalPath = proposal.ok ? proposal.proposal.path : "";
    await applyChange({ root: staleWorkspace, confirm: true, proposalPath });
    const stale = await applyChange({ root: staleWorkspace, confirm: true, proposalPath });
    expect(stale).toMatchObject({
      ok: false,
      error: { code: "APPLY_REJECTED_STALE_PROPOSAL" }
    });
    expect(stale.diagnostics.errors.some((diagnostic) => typeof diagnostic.details?.recovery === "string")).toBe(true);

    const invalidWorkspace = await copyFixture("speckiwi-apply-invalid-");
    const before = await readFile(join(invalidWorkspace, ".speckiwi", "srs", "core.yaml"), "utf8");
    const invalid = await applyChange({ root: invalidWorkspace, confirm: true, change: updateStatementChange(invalidWorkspace, "") });
    expect(invalid).toMatchObject({
      ok: false,
      error: { code: "APPLY_REJECTED_VALIDATION_ERROR" },
      diagnostics: { errors: [{ details: { recovery: expect.any(String) } }] }
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
    const disabled = await applyChange({
      root: disabledWorkspace,
      confirm: true,
      change: updateStatementChange(disabledWorkspace, "The system shall not apply when disabled.")
    });
    expect(disabled).toMatchObject({
      ok: false,
      error: { code: "APPLY_REJECTED_ALLOW_APPLY_FALSE" },
      diagnostics: { errors: [{ details: { recovery: expect.any(String) } }] }
    });
  });

  it("rejects malformed stored proposal patch paths before modifying source YAML", async () => {
    const workspace = await copyFixture("speckiwi-apply-malformed-proposal-");
    const sourcePath = join(workspace, ".speckiwi", "srs", "core.yaml");
    const before = await readFile(sourcePath, "utf8");
    const proposal = await createProposal(updateStatementChange(workspace, "The system shall not apply malformed proposal paths."));
    expect(proposal.ok).toBe(true);
    if (!proposal.ok) {
      return;
    }
    const proposalFile = join(workspace, proposal.proposal.path.replace(/^\.speckiwi\//, ".speckiwi/"));
    await writeFile(
      proposalFile,
      (await readFile(proposalFile, "utf8")).replace("path: /requirements/0/statement", "path: requirements/0/statement"),
      "utf8"
    );

    const missingSlash = await applyChange({ root: workspace, confirm: true, proposalPath: proposal.proposal.path });

    expect(missingSlash).toMatchObject({
      ok: false,
      error: { code: "PROPOSAL_SCHEMA_INVALID" },
      diagnostics: { errors: [{ details: { recovery: expect.any(String) } }] }
    });
    expect(await readFile(sourcePath, "utf8")).toBe(before);

    await writeFile(
      proposalFile,
      (await readFile(proposalFile, "utf8")).replace("path: requirements/0/statement", "path: \"#/requirements/0/statement\""),
      "utf8"
    );

    const fragment = await applyChange({ root: workspace, confirm: true, proposalPath: proposal.proposal.path });

    expect(fragment).toMatchObject({
      ok: false,
      error: { code: "PROPOSAL_SCHEMA_INVALID" },
      diagnostics: { errors: [{ details: { recovery: expect.any(String) } }] }
    });
    expect(await readFile(sourcePath, "utf8")).toBe(before);

    const malformedById = await applyChange({ root: workspace, confirm: true, proposalId: proposal.proposal.id });
    expect(malformedById).toMatchObject({
      ok: false,
      error: { code: "PROPOSAL_SCHEMA_INVALID" },
      diagnostics: { errors: [{ details: { recovery: expect.any(String) } }] }
    });
    expect(await readFile(sourcePath, "utf8")).toBe(before);

    const missingById = await applyChange({ root: workspace, confirm: true, proposalId: "proposal.missing" });
    expect(missingById).toMatchObject({
      ok: false,
      error: { code: "APPLY_REJECTED_PROPOSAL_NOT_FOUND" }
    });
  });

  it("preserves inline proposal and patch error codes with recovery guidance", async () => {
    const workspace = await copyFixture("speckiwi-apply-inline-errors-");

    const invalidPath = await applyChange({
      root: workspace,
      confirm: true,
      change: {
        ...updateStatementChange(workspace, "The system shall reject malformed inline patch paths."),
        changes: [{ op: "replace", path: "requirements/0/statement", value: "Malformed inline path." }]
      }
    });
    expect(invalidPath).toMatchObject({
      ok: false,
      error: { code: "INVALID_PATCH_PATH" },
      diagnostics: { errors: [{ details: { recovery: expect.any(String) } }] }
    });

    const missingReason = await applyChange({
      root: workspace,
      confirm: true,
      change: {
        ...updateStatementChange(workspace, "The system shall reject missing inline proposal reasons."),
        reason: ""
      }
    });
    expect(missingReason).toMatchObject({
      ok: false,
      error: { code: "PROPOSAL_REASON_REQUIRED" }
    });
  });

  it("keeps proposal YAML as a managed review artifact when applying from proposal mode", async () => {
    const workspace = await copyFixture("speckiwi-apply-proposal-artifact-");
    const proposal = await createProposal(updateStatementChange(workspace, "The system shall keep proposal YAML as managed review evidence."));
    expect(proposal).toMatchObject({
      ok: true,
      applied: false,
      proposal: { path: expect.stringMatching(/^\.speckiwi\/proposals\/.+\.yaml$/) }
    });
    if (!proposal.ok) {
      return;
    }

    const proposalEntries = await readdir(join(workspace, ".speckiwi", "proposals"));
    expect(proposalEntries).toEqual([proposal.proposal.path.replace(/^\.speckiwi\/proposals\//, "")]);
    await expect(readFile(join(workspace, proposal.proposal.path), "utf8")).resolves.toContain("schemaVersion: speckiwi/proposal/v1");

    await expect(applyChange({ root: workspace, confirm: true, proposalPath: proposal.proposal.path })).resolves.toMatchObject({
      ok: true,
      applied: true,
      modifiedFiles: [".speckiwi/srs/core.yaml"]
    });
    await expect(readFile(join(workspace, proposal.proposal.path), "utf8")).resolves.toContain("type: proposal");
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
