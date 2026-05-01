import { cp, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parse } from "yaml";
import { afterEach, describe, expect, it } from "vitest";
import { createProposal } from "../../src/core/propose-change.js";
import { canonicalJsonHash } from "../../src/write/hash.js";

const root = resolve(import.meta.dirname, "../..");
const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("proposal creation", () => {
  it("writes proposal YAML without mutating source YAML and stores discriminated targets", async () => {
    const workspace = await copyFixture();
    const sourcePath = join(workspace, ".speckiwi", "srs", "core.yaml");
    const before = await readFile(sourcePath, "utf8");

    const result = await createProposal({
      root: workspace,
      operation: "update_requirement",
      target: { kind: "requirement", requirementId: "FR-CORE-0001" },
      changes: [
        {
          op: "replace",
          path: "/requirements/0/statement",
          value: "The system shall validate workspace YAML documents after proposal creation."
        }
      ],
      reason: "Clarify validation behavior."
    });

    expect(result.ok).toBe(true);
    expect(await readFile(sourcePath, "utf8")).toBe(before);

    const proposalPath = result.ok ? result.proposal.path.replace(/^\.speckiwi\//, "") : "";
    const proposal = parse(await readFile(join(workspace, ".speckiwi", proposalPath), "utf8")) as Record<string, unknown>;

    expect(proposal).toMatchObject({
      schemaVersion: "speckiwi/proposal/v1",
      type: "proposal",
      status: "proposed",
      operation: "update_requirement",
      target: {
        kind: "requirement",
        requirementId: "FR-CORE-0001",
        documentId: "srs.core"
      },
      base: {
        documentPath: "srs/core.yaml",
        target: {
          entityType: "requirement",
          id: "FR-CORE-0001",
          jsonPointer: "/requirements/0"
        }
      }
    });
    expect((proposal.target as Record<string, unknown>).path).toBeUndefined();
    expect((proposal.base as { targetHash: string }).targetHash).toBe(
      canonicalJsonHash({
        id: "FR-CORE-0001",
        type: "functional",
        title: "Validate workspace",
        status: "active",
        priority: "high",
        statement: "시스템은 workspace YAML 문서를 deterministic하게 validate해야 한다.",
        rationale: "Apply safety depends on validation.",
        acceptanceCriteria: [{ id: "AC-001", method: "test", description: "Invalid references produce stable diagnostics." }],
        relations: [],
        tags: ["validation"]
      })
    );
  });

  it("rejects duplicate explicit requirement IDs for create proposals", async () => {
    const workspace = await copyFixture();

    const result = await createProposal({
      root: workspace,
      operation: "create_requirement",
      target: { kind: "requirement", scope: "core", requirementId: "FR-CORE-0001" },
      changes: [
        {
          op: "add",
          path: "/requirements/-",
          value: {
            id: "FR-CORE-0001",
            type: "functional",
            title: "Duplicate",
            status: "draft",
            statement: "The system shall reject duplicate requirement IDs."
          }
        }
      ],
      reason: "Exercise duplicate guard."
    });

    expect(result).toMatchObject({ ok: false, error: { code: "DUPLICATE_REQUIREMENT_ID" } });
  });

  it("rejects workspace-external symlink proposal base documents", async () => {
    const workspace = await copyFixture();
    const externalDirectory = await mkdtemp(join(tmpdir(), "speckiwi-proposal-external-"));
    tempRoots.push(externalDirectory);
    const external = join(externalDirectory, "core.yaml");
    await writeFile(external, "schemaVersion: speckiwi/srs/v1\nid: external\n", "utf8");
    await rm(join(workspace, ".speckiwi", "srs", "core.yaml"));
    await symlink(external, join(workspace, ".speckiwi", "srs", "core.yaml"), "file");

    const result = await createProposal({
      root: workspace,
      operation: "create_requirement",
      target: { kind: "requirement", documentId: "srs.core" },
      changes: [
        {
          op: "add",
          path: "/requirements/-",
          value: {
            type: "functional",
            title: "Symlink",
            status: "draft",
            statement: "The system shall reject external symlink proposal bases."
          }
        }
      ],
      reason: "Exercise symlink base guard."
    });

    expect(result).toMatchObject({ ok: false, error: { code: "WORKSPACE_ESCAPE" } });
  });

  it("canonicalizes object key order for target hash snapshots", () => {
    expect(canonicalJsonHash({ b: 2, a: 1 })).toBe(canonicalJsonHash({ a: 1, b: 2 }));
  });
});

async function copyFixture(): Promise<string> {
  const workspace = await mkdtemp(join(tmpdir(), "speckiwi-proposal-"));
  tempRoots.push(workspace);
  await cp(resolve(root, "test/fixtures/workspaces/valid-basic"), workspace, { recursive: true });
  return workspace;
}
