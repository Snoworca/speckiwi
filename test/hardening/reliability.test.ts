import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { applyChange } from "../../src/core/apply-change.js";
import { rebuildCache } from "../../src/core/cache.js";
import { searchWorkspace } from "../../src/core/search.js";
import { validateWorkspace } from "../../src/core/validate.js";

const repoRoot = resolve(import.meta.dirname, "../..");
const validFixtureRoot = resolve(repoRoot, "test/fixtures/workspaces/valid-basic");
const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("reliability hardening", () => {
  it("returns diagnostics instead of crashing when YAML cannot be parsed", async () => {
    const workspace = await copyFixture("speckiwi-reliability-yaml-");
    await writeFile(join(workspace, ".speckiwi", "srs", "broken.yaml"), "schemaVersion: [unterminated\n", "utf8");
    await writeFile(
      join(workspace, ".speckiwi", "index.yaml"),
      `${await readFile(join(workspace, ".speckiwi", "index.yaml"), "utf8")}  - id: srs.broken\n    type: srs\n    path: srs/broken.yaml\n    scope: core\n`,
      "utf8"
    );

    const result = await validateWorkspace({ root: workspace });

    expect(result.ok).toBe(false);
    expect(result.diagnostics.summary.errorCount).toBeGreaterThan(0);
    expect(result.diagnostics.errors.some((diagnostic) => diagnostic.path === ".speckiwi/srs/broken.yaml")).toBe(true);
  });

  it("reports duplicate requirement IDs deterministically across runs", async () => {
    const workspace = await copyFixture("speckiwi-reliability-duplicate-");
    await writeFile(
      join(workspace, ".speckiwi", "srs", "core.yaml"),
      `${await readFile(join(workspace, ".speckiwi", "srs", "core.yaml"), "utf8")}  - id: FR-CORE-0001
    type: functional
    title: Duplicate requirement
    status: active
    statement: The system shall report duplicate IDs deterministically.
    acceptanceCriteria:
      - id: AC-001
        method: test
        description: Duplicate ID is reported.
    relations: []
`,
      "utf8"
    );

    const first = await validateWorkspace({ root: workspace });
    const second = await validateWorkspace({ root: workspace });

    expect(first.ok).toBe(false);
    expect(stableErrors(first)).toEqual(stableErrors(second));
    expect(stableErrors(first).some((entry) => entry.code === "DUPLICATE_REQUIREMENT_ID")).toBe(true);
  });

  it("falls back to YAML source data when generated cache files are corrupt", async () => {
    const workspace = await copyFixture("speckiwi-reliability-cache-");
    await expect(rebuildCache({ root: workspace })).resolves.toMatchObject({ ok: true });
    await writeFile(join(workspace, ".speckiwi", "cache", "search-index.json"), "{not-json", "utf8");
    await writeFile(
      join(workspace, ".speckiwi", "cache", "manifest.json"),
      JSON.stringify({ speckiwiVersion: "0.1.0", schemaVersions: [], sections: { graph: {}, search: {}, diagnostics: {}, export: {} } }),
      "utf8"
    );

    const result = await searchWorkspace({ root: workspace, query: "validation", mode: "bm25" });

    expect(result.ok).toBe(true);
    expect(result.ok && result.results.some((item) => item.id === "FR-CORE-0001")).toBe(true);
  });

  it("rejects active apply locks even when cache writes are bypassed", async () => {
    const workspace = await copyFixture("speckiwi-reliability-active-lock-");
    await writeApplyLock(workspace, "srs/core.yaml", new Date(Date.now() + 60_000).toISOString());

    const result = await applyChange({
      root: workspace,
      cacheMode: "bypass",
      confirm: true,
      change: updateStatementChange(workspace, "The system shall reject active cross-process apply locks.")
    });

    expect(result).toMatchObject({ ok: false, error: { code: "APPLY_REJECTED_LOCK_CONFLICT" } });
  });

  it("recovers stale apply locks and cleans up after a successful apply", async () => {
    const workspace = await copyFixture("speckiwi-reliability-stale-lock-");
    await writeApplyLock(workspace, "srs/core.yaml", new Date(Date.now() - 60_000).toISOString());

    const result = await applyChange({
      root: workspace,
      confirm: true,
      change: updateStatementChange(workspace, "The system shall recover stale apply locks.")
    });

    expect(result).toMatchObject({ ok: true, applied: true });
    await expect(readFile(applyLockPath(workspace, "srs/core.yaml"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("recovers malformed apply locks as stale state", async () => {
    const workspace = await copyFixture("speckiwi-reliability-malformed-lock-");
    await mkdir(join(workspace, ".speckiwi", ".locks"), { recursive: true });
    await writeFile(applyLockPath(workspace, "srs/core.yaml"), "{not-json", "utf8");

    const result = await applyChange({
      root: workspace,
      confirm: true,
      change: updateStatementChange(workspace, "The system shall recover malformed apply locks.")
    });

    expect(result).toMatchObject({ ok: true, applied: true });
    await expect(readFile(applyLockPath(workspace, "srs/core.yaml"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });
});

function stableErrors(result: Awaited<ReturnType<typeof validateWorkspace>>): Array<{ code: string; path: string; message: string }> {
  return result.diagnostics.errors
    .map((diagnostic) => ({
      code: diagnostic.code,
      path: diagnostic.path ?? "",
      message: diagnostic.message
    }))
    .sort((left, right) => left.code.localeCompare(right.code) || left.path.localeCompare(right.path) || left.message.localeCompare(right.message));
}

async function copyFixture(prefix: string): Promise<string> {
  const workspace = await mkdtemp(join(tmpdir(), prefix));
  tempRoots.push(workspace);
  await cp(validFixtureRoot, workspace, { recursive: true });
  return workspace;
}

function updateStatementChange(workspace: string, statement: string) {
  return {
    root: workspace,
    operation: "update_requirement" as const,
    target: { kind: "requirement" as const, requirementId: "FR-CORE-0001" },
    changes: [{ op: "replace" as const, path: "/requirements/0/statement", value: statement }],
    reason: "Update statement."
  };
}

async function writeApplyLock(workspace: string, target: string, expiresAt: string): Promise<void> {
  await mkdir(join(workspace, ".speckiwi", ".locks"), { recursive: true });
  await writeFile(
    applyLockPath(workspace, target),
    `${JSON.stringify({
      version: 1,
      target,
      token: "test-lock",
      pid: process.pid,
      hostname: "test",
      createdAt: new Date().toISOString(),
      expiresAt
    })}\n`,
    "utf8"
  );
}

function applyLockPath(workspace: string, target: string): string {
  return join(workspace, ".speckiwi", ".locks", `${createHash("sha256").update(target).digest("hex")}.json`);
}
