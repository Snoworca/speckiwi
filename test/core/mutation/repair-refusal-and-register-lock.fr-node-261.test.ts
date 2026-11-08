import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../../src/cli/index.js";
import { createMcpServer } from "../../../src/mcp/server.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { applyRequirementIdCollisionRepair, diagnoseRequirementIdCollisions } from "../../../src/core/mutation/repair-requirement-id.js";
import { registerScopes } from "../../../src/core/mutation/register-scopes.js";
import { withSrsMutationLock } from "../../../src/core/mutation/srs-lock.js";
import type { MutationResult } from "../../../src/core/types.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

// FR-NODE-261: repair requirement-id-collisions decides every refusal before its first write, and
// register-scopes writes under the SRS mutation lock and says whether it wrote.

const ARCH = path.join("docs", "spec", "10.product-architecture.srs.md");

async function snapshot(rootPath: string): Promise<Record<string, string>> {
  const dir = path.join(rootPath, "docs", "spec");
  const out: Record<string, string> = {};
  for (const name of await readdir(dir)) if (name.endsWith(".md")) out[name] = await readFile(path.join(dir, name), "utf8");
  return out;
}

const THIRD_BLOCK = [
  "",
  "### FR-ARCH-007 — Third",
  "",
  "| Field | Value |",
  "| --- | --- |",
  "| Type | functional |",
  "| Target | v1.0.0 |",
  "| Status | planned |",
  "",
  "#### Requirement",
  "Third.",
  "#### Acceptance Criteria",
  "- [ ] AC-1: third",
  ""
].join("\n");

async function duplicateWithThirdBlock() {
  const rootPath = await copyFixtureWorkspace("duplicate-id");
  await writeFile(path.join(rootPath, ARCH), (await readFile(path.join(rootPath, ARCH), "utf8")) + THIRD_BLOCK, "utf8");
  const root = await resolveProjectRoot(rootPath);
  const group = (await diagnoseRequirementIdCollisions(root)).value.groups.find((g) => g.duplicateId === "FR-ARCH-001")!;
  return { rootPath, root, keep: group.occurrences[0]!, rename: group.occurrences[1]! };
}

describe("FR-NODE-261 AC-1 — a replacement collision is refused before any document is written", () => {
  // @req FR-NODE-261 AC-1
  it("refuses a replacement ID that already exists in the workspace and writes nothing", async () => {
    const { rootPath, root, keep, rename } = await duplicateWithThirdBlock();
    const before = await snapshot(rootPath);
    const result = await applyRequirementIdCollisionRepair(root, { duplicateId: "FR-ARCH-001", keep, rename, replacementId: "FR-ARCH-007" });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("GENERATED_ID_COLLISION");
    expect(await snapshot(rootPath)).toEqual(before);
  });

  // @req FR-NODE-261 AC-1
  it("refuses, writing nothing, when the repair's own reference edit would make another heading carry the replacement ID", async () => {
    const { rootPath, root, keep, rename } = await duplicateWithThirdBlock();
    const thirdHeading = (await readFile(path.join(rootPath, ARCH), "utf8")).split(/\r?\n/).findIndex((l) => l.startsWith("### FR-ARCH-007")) + 1;
    const before = await snapshot(rootPath);
    const result = await applyRequirementIdCollisionRepair(root, {
      duplicateId: "FR-ARCH-001",
      keep,
      rename,
      replacementId: "FR-ARCH-005",
      referenceEdits: [{ filePath: "docs/spec/10.product-architecture.srs.md", line: thirdHeading, from: "FR-ARCH-007", to: "FR-ARCH-005" }]
    });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("GENERATED_ID_COLLISION");
    expect(await snapshot(rootPath)).toEqual(before);
  });

  // @req FR-NODE-261 AC-1
  it("refuses the same reference-edit collision on a dry run", async () => {
    const { rootPath, root, keep, rename } = await duplicateWithThirdBlock();
    const thirdHeading = (await readFile(path.join(rootPath, ARCH), "utf8")).split(/\r?\n/).findIndex((l) => l.startsWith("### FR-ARCH-007")) + 1;
    const result = await applyRequirementIdCollisionRepair(root, {
      duplicateId: "FR-ARCH-001",
      keep,
      rename,
      replacementId: "FR-ARCH-005",
      dryRun: true,
      referenceEdits: [{ filePath: "docs/spec/10.product-architecture.srs.md", line: thirdHeading, from: "FR-ARCH-007", to: "FR-ARCH-005" }]
    });
    expect(result.error?.code).toBe("GENERATED_ID_COLLISION");
  });

  // @req FR-NODE-261 AC-1
  it("control: the same repair without that edit writes", async () => {
    const { root, keep, rename } = await duplicateWithThirdBlock();
    const result = await applyRequirementIdCollisionRepair(root, { duplicateId: "FR-ARCH-001", keep, rename, replacementId: "FR-ARCH-005" });
    expect(result.ok, JSON.stringify(result.error)).toBe(true);
    expect(result.value?.written).toBe(true);
  });
});

/** mutation-target plus an unregistered NODE scope document, which register-scopes adds a row for. */
async function unregisteredScopeFixture(): Promise<string> {
  const rootPath = await copyFixtureWorkspace("mutation-target");
  const arch = await readFile(path.join(rootPath, ARCH), "utf8");
  const block = arch.slice(arch.indexOf("### FR-ARCH-001")).replace("### FR-ARCH-001 — Mutable requirement", "### FR-NODE-001 — Node requirement");
  await writeFile(
    path.join(rootPath, "docs", "spec", "20.node.srs.md"),
    `# Node\n\n| Field | Value |\n|---|---|\n| Document Type | scope_srs |\n| Scope | NODE |\n| Scope Name | Node |\n\n## 4. Requirements\n\n${block}`,
    "utf8"
  );
  return rootPath;
}

const HOLDER_RESULT = { ok: true, value: { written: false }, diagnostics: [], diagnosticsSummary: { errors: 0, warnings: 0, byCode: {} } } as MutationResult<{ written: boolean }>;

describe("FR-NODE-261 AC-3 — register-scopes holds the SRS lock and reports `written`", () => {
  // @req FR-NODE-261 AC-3
  it("refuses --apply while another mutation holds the SRS lock and leaves the index unchanged", async () => {
    const rootPath = await unregisteredScopeFixture();
    const root = await resolveProjectRoot(rootPath);
    const indexPath = path.join(rootPath, "docs", "spec", "00.index.md");
    const before = await readFile(indexPath, "utf8");
    let inner: MutationResult | undefined;
    await withSrsMutationLock(root, { operation: "fr-node-261-holder" }, async () => {
      inner = await registerScopes(root, { apply: true });
      return HOLDER_RESULT;
    });
    expect(inner?.ok).toBe(false);
    expect(await readFile(indexPath, "utf8")).toBe(before);
  });

  // @req FR-NODE-261 AC-3
  it("writes past a held lock with ignoreLock, warning that the lock was bypassed", async () => {
    const rootPath = await unregisteredScopeFixture();
    const root = await resolveProjectRoot(rootPath);
    let inner: MutationResult<{ written?: boolean }> | undefined;
    await withSrsMutationLock(root, { operation: "fr-node-261-holder" }, async () => {
      inner = await registerScopes(root, { apply: true, ignoreLock: true });
      return HOLDER_RESULT;
    });
    expect(inner?.ok).toBe(true);
    expect(inner?.value?.written).toBe(true);
    expect(inner?.diagnostics.map((d) => d.code)).toContain("SRS-W067");
    expect(await readFile(path.join(rootPath, "docs", "spec", "00.index.md"), "utf8")).toContain("./20.node.srs.md");
  });

  // @req FR-NODE-261 AC-3
  it("carries written: true exactly when 00.index.md changed", async () => {
    const rootPath = await unregisteredScopeFixture();
    const root = await resolveProjectRoot(rootPath);
    const indexPath = path.join(rootPath, "docs", "spec", "00.index.md");

    const preview = await registerScopes(root, {});
    expect(preview.value).toHaveProperty("written", false);

    const before = await readFile(indexPath, "utf8");
    const applied = await registerScopes(root, { apply: true });
    expect(applied.value).toHaveProperty("written", true);
    expect(await readFile(indexPath, "utf8")).not.toBe(before);

    const again = await registerScopes(root, { apply: true });
    const after = await readFile(indexPath, "utf8");
    expect(again.value).toHaveProperty("written", false);
    expect(await readFile(indexPath, "utf8")).toBe(after);
  });
});

describe("FR-NODE-261 AC-3 — the CLI and MCP surfaces pass the lock bypass through", () => {
  async function heldWhile<T>(rootPath: string, run: () => Promise<T>): Promise<T> {
    const root = await resolveProjectRoot(rootPath);
    let inner: T | undefined;
    await withSrsMutationLock(root, { operation: "fr-node-261-holder" }, async () => {
      inner = await run();
      return HOLDER_RESULT;
    });
    return inner as T;
  }

  // @req FR-NODE-261 AC-3
  it("speckiwi register-scopes --apply --ignore-lock writes while the lock is held; without it, it is refused", async () => {
    const rootPath = await unregisteredScopeFixture();
    const indexPath = path.join(rootPath, "docs", "spec", "00.index.md");
    const before = await readFile(indexPath, "utf8");
    const io = () => ({ stdout: new PassThrough(), stderr: new PassThrough() });

    expect(await heldWhile(rootPath, () => main(["--root", rootPath, "register-scopes", "--apply", "--json"], io()))).not.toBe(0);
    expect(await readFile(indexPath, "utf8")).toBe(before);

    const streams = io();
    let stdout = "";
    streams.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    expect(await heldWhile(rootPath, () => main(["--root", rootPath, "register-scopes", "--apply", "--ignore-lock", "--json"], streams))).toBe(0);
    expect(JSON.parse(stdout).value.written).toBe(true);
    expect(await readFile(indexPath, "utf8")).toContain("./20.node.srs.md");
  });

  // @req FR-NODE-261 AC-3
  it("MCP register_scopes passes ignoreLock through", async () => {
    const rootPath = await unregisteredScopeFixture();
    const handle = await createMcpServer({ root: rootPath });
    const refused = (await heldWhile(rootPath, () => handle.callTool("register_scopes", { apply: true }))) as { ok?: boolean };
    expect(refused.ok).toBe(false);
    const bypassed = (await heldWhile(rootPath, () => handle.callTool("register_scopes", { apply: true, ignoreLock: true }))) as { ok?: boolean; value?: { written?: boolean } };
    expect(bypassed.ok, JSON.stringify(bypassed)).toBe(true);
    expect(bypassed.value?.written).toBe(true);
  });
});
