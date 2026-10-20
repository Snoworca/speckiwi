import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createMcpServer } from "../../../src/mcp/server.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

/**
 * REL-NODE-005 AC-2 / AC-7 — what the SRS mutation lock covers, and what a bypass leaves in force.
 * Driven through the registered MCP tools so the lock is reached the way an agent reaches it.
 */

async function lockedWorkspace(): Promise<{ root: string; spec: string }> {
  const root = await copyFixtureWorkspace("mutation-target");
  await mkdir(path.join(root, "kiwi"), { recursive: true });
  const now = Date.now();
  await writeFile(
    path.join(root, "kiwi", ".srs.lock"),
    JSON.stringify({ schemaVersion: "1.0.0", owner: "other:1", operation: "other", requestId: "r", acquiredAt: new Date(now).toISOString(), expiresAt: new Date(now + 60_000).toISOString() }),
    "utf8"
  );
  return { root, spec: path.join(root, "docs", "spec", "10.product-architecture.srs.md") };
}

describe("REL-NODE-005 AC-2 — the lock applies to SRS mutations only", () => {
  it("REL-NODE-005 AC-2: under an active lock an SRS mutation is refused while a workflow journal append still writes", async () => {
    const { root, spec } = await lockedWorkspace();
    const server = createMcpServer({ root });
    const before = await readFile(spec, "utf8");

    expect(await server.callTool("update_status", { id: "FR-ARCH-001", status: "blocked" })).toMatchObject({ ok: false, error: { code: "SRS_LOCKED" } });
    expect(await readFile(spec, "utf8")).toBe(before);

    const emitted = await server.callTool("workflow_pipeline_emit", {
      runId: "rel-node-005-ac2",
      owner: "kiwi-pm",
      event: { schema_version: "1.0.0", skill: "kiwi-pm", run_id: "rel-node-005-ac2", status: "TASK_DONE", summary: "not an SRS write" }
    });
    expect(emitted).toMatchObject({ ok: true });
    expect(await readFile(path.join(root, "kiwi", "pipeline.jsonl"), "utf8")).toContain("rel-node-005-ac2");
  });
});

describe("REL-NODE-005 AC-7 — a lock bypass records a diagnostic and disables nothing else", () => {
  it("REL-NODE-005 AC-7: with ignoreLock, table-cell safety, inside-root checks and trace validation still refuse, and the bypass is recorded", async () => {
    const { root, spec } = await lockedWorkspace();
    const server = createMcpServer({ root });
    const before = await readFile(spec, "utf8");

    expect(await server.callTool("add_verification_evidence", { id: "FR-ARCH-001", type: "test", reference: "bad|cell", ignoreLock: true })).toMatchObject({
      ok: false,
      error: { code: "MUTATION_DENIED" }
    });
    expect(await server.callTool("add_completed_work", { date: "2026-10-21", summary: "x", reportPaths: ["../escape.md"], ignoreLock: true })).toMatchObject({
      ok: false
    });
    const trace = await server.callTool("add_trace_link", { id: "FR-ARCH-001", type: "Requirement", reference: "FR-NOPE-999", relation: "depends_on", ignoreLock: true });
    expect(trace).toMatchObject({ ok: false });
    expect(await readFile(spec, "utf8")).toBe(before);

    const bypassed = await server.callTool("update_status", { id: "FR-ARCH-001", status: "blocked", ignoreLock: true });
    expect(bypassed).toMatchObject({ ok: true, diagnostics: expect.arrayContaining([expect.objectContaining({ code: "SRS-W067" })]) });
  });
});
