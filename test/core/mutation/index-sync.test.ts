import { describe, expect, it } from "vitest";
import { addRequirement } from "../../../src/core/mutation/add-requirement.js";
import { syncIndexRollups } from "../../../src/core/mutation/sync-index.js";
import { updateStatus } from "../../../src/core/mutation/update-status.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import { validateWorkspace } from "../../../src/core/validator/validate-workspace.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

async function validationCodes(root: string): Promise<string[]> {
  const projectRoot = await resolveProjectRoot(root);
  return validateWorkspace(await parseWorkspace(projectRoot)).diagnostics.map((item) => item.code);
}

describe("FR-NODE-018 index summary synchronization for mutations", () => {
  it("keeps Status Summary and Requirement Type Summary clean after addRequirement writes", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    const projectRoot = await resolveProjectRoot(root);

    const result = await addRequirement(projectRoot, {
      type: "reliability",
      scope: "ARCH",
      target: "v1.0.0",
      title: "Rollup-safe requirement",
      statement: "SpecKiwi must synchronize index rollups after requirement creation.",
      acceptanceCriteria: ["Rollups remain valid."],
      stability: "stable"
    });

    expect(result).toMatchObject({
      ok: true,
      value: { written: true },
      indexSync: { written: true, statusSummaryChanged: true, typeSummaryChanged: true }
    });
    expect(await validationCodes(root)).not.toContain("SRS-W019");
    expect(await validationCodes(root)).not.toContain("SRS-W020");
  });

  it("keeps Status Summary clean after updateStatus writes", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    const projectRoot = await resolveProjectRoot(root);

    const result = await updateStatus(projectRoot, { id: "FR-ARCH-001", status: "implemented" });

    expect(result).toMatchObject({
      ok: true,
      value: { written: true },
      indexSync: { written: true, statusSummaryChanged: true }
    });
    expect(await validationCodes(root)).not.toContain("SRS-W019");
  });

  it("provides explicit sync-index dry-run preview and stale guard support", async () => {
    const root = await copyFixtureWorkspace("index-drift-status-summary");
    const projectRoot = await resolveProjectRoot(root);
    const before = await parseWorkspace(projectRoot);
    const indexFile = before.files.find((file) => file.relativePath === "docs/spec/00.index.md");
    expect(indexFile?.snapshot?.sha256).toBeDefined();

    const dryRun = await syncIndexRollups(projectRoot, { dryRun: true });
    expect(dryRun).toMatchObject({
      ok: true,
      value: { written: false, statusSummaryChanged: true },
      mutation: { kind: "sync_index_rollups", dryRun: true, written: false, filePath: "docs/spec/00.index.md" }
    });
    expect((await validationCodes(root)).filter((code) => code === "SRS-W019").length).toBeGreaterThan(0);

    const stale = await syncIndexRollups(projectRoot, { expectedSha256: "wrong" });
    expect(stale).toMatchObject({ ok: false, error: { code: "STALE_PATCH" } });

    const written = await syncIndexRollups(projectRoot, { expectedSha256: indexFile?.snapshot?.sha256 });
    expect(written).toMatchObject({ ok: true, value: { written: true, statusSummaryChanged: true } });
    expect(await validationCodes(root)).not.toContain("SRS-W019");
  });
});
