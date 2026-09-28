import { readdir } from "node:fs/promises";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { WORKFLOW_ARTIFACT_KINDS, resolveWorkflowArtifacts } from "../../../src/core/workflow/artifacts.js";

// @req FR-NODE-211 AC-2 — the resolver drops the plan, sidecar and validator kinds and gains an `sds` kind
// for docs/sds/*.sds.md, while the historical plan files stay in the repository.

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const REQ_MARKER = ["@", "req"].join("");

async function tempRoot(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "speckiwi-sds-artifacts-"));
}

async function write(root: string, relativePath: string, text: string): Promise<void> {
  const absolutePath = path.join(root, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, text, "utf8");
}

function liteSds(target: string, status = "draft"): string {
  return [
    "# SDS: demo",
    "",
    "| Field | Value |",
    "|---|---|",
    "| Document Type | sds |",
    "| Profile | lite |",
    `| Target | ${target} |`,
    `| Status | ${status} |`,
    "| Date | 2026-09-27 |",
    "",
    "## Interfaces",
    "",
    "### Files",
    "",
    // The marker is assembled so the repository's @req scanner does not read this fixture id as a citation.
    `- \`src/demo.ts\` — demo ${REQ_MARKER} FR-DEMO-001`,
    "",
    "## Acceptance Contracts",
    "",
    "- SDS-AC-1 (FR-DEMO-001 AC-1): WHEN called THE SYSTEM SHALL answer",
    "",
    "## Test Plan",
    "",
    "| SDS-AC | Test file | Case summary |",
    "|---|---|---|",
    "| SDS-AC-1 | test/demo.test.ts | answers |",
    ""
  ].join("\n");
}

describe("FR-NODE-211 AC-2 — the artifact kinds are sds instead of plan, sidecar and validator", () => {
  it("FR-NODE-211 AC-2: the closed kind vocabulary carries sds and none of plan, sidecar or validator", () => {
    expect(WORKFLOW_ARTIFACT_KINDS as readonly string[]).toContain("sds");
    for (const kind of ["plan", "sidecar", "validator"]) expect(WORKFLOW_ARTIFACT_KINDS as readonly string[]).not.toContain(kind);
  });

  it("FR-NODE-211 AC-2: a docs/sds/<sds-id>.sds.md file resolves as sds, with its sds-id as run id and its metadata target", async () => {
    const root = await tempRoot();
    await write(root, "docs/sds/run-7-wave-1.sds.md", liteSds("4.0.0"));

    const resolution = await resolveWorkflowArtifacts({ root }, { kind: "sds", target: "4.0.0" });

    expect(resolution.diagnosticsSummary.errors).toBe(0);
    expect(resolution.selected).toMatchObject({
      relativePath: "docs/sds/run-7-wave-1.sds.md",
      kind: "sds",
      legacy: false,
      runId: "run-7-wave-1",
      target: "4.0.0"
    });
  });

  it("FR-NODE-211 AC-2: only files directly in docs/sds count, and a plan file in docs/plans is no artifact at all", async () => {
    const root = await tempRoot();
    await write(root, "docs/sds/nested/inner.sds.md", liteSds("4.0.0"));
    await write(root, "docs/sds/notes.md", "# notes\n");
    await write(root, "docs/plans/old.plan.md", "---\nrun_id: old\ntarget: 4.0.0\n---\n# Plan\n");
    await write(root, "docs/plans/old.sidecar.json", JSON.stringify({ run_id: "old", target: "4.0.0" }));
    await write(root, "docs/plans/old.validator.json", JSON.stringify({ ok: true }));

    const all = await resolveWorkflowArtifacts({ root }, {});
    expect(all.candidates.map((candidate) => candidate.relativePath)).toEqual([]);

    const explicitPlan = await resolveWorkflowArtifacts({ root }, { explicitPath: "docs/plans/old.plan.md" });
    expect(explicitPlan.selected?.kind).toBe("unknown");
    const explicitNested = await resolveWorkflowArtifacts({ root }, { explicitPath: "docs/sds/nested/inner.sds.md" });
    expect(explicitNested.selected?.kind).toBe("unknown");
  });

  it("FR-NODE-211 AC-2: a legacy docs/plan plan resolves as the legacy kind only, never as a plan", async () => {
    const root = await tempRoot();
    await write(root, "docs/plan/legacy.plan.md", "---\nrun_id: legacy\ntarget: 4.0.0\n---\n# Plan\n");

    const resolution = await resolveWorkflowArtifacts({ root }, {});

    expect(resolution.candidates.map((candidate) => [candidate.relativePath, candidate.kind, candidate.legacy])).toEqual([["docs/plan/legacy.plan.md", "legacy", true]]);
  });

  it("FR-NODE-211 AC-2: the historical plan files under docs/plans stay in the repository", async () => {
    const names = await readdir(path.join(REPO_ROOT, "docs", "plans"));

    expect(names.some((name) => name.endsWith(".plan.md"))).toBe(true);
    expect(names.some((name) => name.endsWith(".sidecar.json"))).toBe(true);
  });
});
