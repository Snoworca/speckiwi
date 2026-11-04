import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createTestMcpServer } from "../../src/mcp/adapter.js";
import { isReadOnlyTool, toolSchemas } from "../../src/mcp/server.js";
import { registerPrdTools } from "../../src/mcp/tools/prd-tools.js";
import { buildPrd, DEFAULT_ITEMS } from "../core/prd/prd-fixture.js";
import { cliJson, mcp, PRD_PATH, prdWorkspace, writePrd } from "./prd-surface-fixture.js";

// FR-NODE-241 — the verdict cursor on both surfaces: `speckiwi prd cursor <action> <file> --run-id`
// and the MCP tool prd_cursor. Both write the same ledger, so a run started on one surface resumes on
// the other.

interface Position {
  index: number;
  total: number;
  round: number;
  prd: string;
  item?: { id: string; quote: string };
  verdict?: string;
  done?: true;
  summary?: Record<string, number>;
  invalidated?: { previous: string; current: string; judged: number };
}

interface Refusal {
  error: { code: string };
}

const RUN = "run-1";

function pointer(text: string): string {
  return `${PRD_PATH}@sha256:${createHash("sha256").update(text).digest("hex")}`;
}

function cursor(root: string, action: string, ...rest: string[]) {
  return cliJson<Position & Refusal>(root, "cursor", action, PRD_PATH, "--run-id", RUN, ...rest);
}

describe("FR-NODE-241 AC-1 — count, current, next, seek, reset", () => {
  // @req FR-NODE-241 AC-1
  it("count returns the total and the PRD pointer only", async () => {
    const root = await prdWorkspace();
    const { code, json } = await cursor(root, "count");
    expect(code).toBe(0);
    expect(json).toEqual({ total: 4, prd: pointer(buildPrd()) });
    expect((await mcp(root, "prd_cursor", { action: "count", path: PRD_PATH, runId: RUN })).value).toEqual(json);
  });

  // @req FR-NODE-241 AC-1
  it("current, next, seek and reset carry index, total, the item ID, its quote and the PRD pointer, across surfaces", async () => {
    const root = await prdWorkspace();
    const first = await cursor(root, "current");
    expect(first.code).toBe(0);
    expect(first.json).toMatchObject({ index: 1, total: 4, prd: pointer(buildPrd()), item: { id: "PRD-1", quote: DEFAULT_ITEMS[0]!.quote } });

    const moved = await cursor(root, "next", "--verdict", "accepted", "--ref", "FR-ARCH-001");
    expect(moved.json).toMatchObject({ index: 2, total: 4, item: { id: "PRD-2" } });

    // The MCP tool reads the ledger the CLI wrote, and its answer is the CLI's JSON.
    const viaMcp = await mcp<Position>(root, "prd_cursor", { action: "current", path: PRD_PATH, runId: RUN });
    expect(viaMcp.value).toEqual((await cursor(root, "current")).json);
    const nextViaMcp = await mcp<Position>(root, "prd_cursor", { action: "next", path: PRD_PATH, runId: RUN, verdict: "fail", note: "no AC" });
    expect(nextViaMcp.value).toMatchObject({ index: 3, item: { id: "PRD-3" } });

    const seek = await cursor(root, "seek", "--index", "1");
    expect(seek.json).toMatchObject({ index: 1, item: { id: "PRD-1" }, verdict: "accepted" });
    expect((await cursor(root, "current")).json.index).toBe(3);
    expect((await mcp<Position>(root, "prd_cursor", { action: "seek", path: PRD_PATH, runId: RUN, index: 2 })).value).toMatchObject({ index: 2, verdict: "fail" });

    const reset = await cursor(root, "reset");
    expect(reset.json).toMatchObject({ index: 1, round: 2, item: { id: "PRD-1" } });
  });

  // @req FR-NODE-241 AC-1
  it("reports done with a verdict summary once every item is judged", async () => {
    const root = await prdWorkspace();
    for (let n = 0; n < 4; n += 1) await cursor(root, "next", "--verdict", "accepted");
    const done = await cursor(root, "current");
    expect(done.json).toMatchObject({ index: 4, total: 4, done: true, summary: { accepted: 4 } });
    const refused = await cursor(root, "next", "--verdict", "accepted");
    expect(refused.code).not.toBe(0);
    expect(refused.json.error.code).toBe("PRD_CURSOR_DONE");
  });

  // @req FR-NODE-241 AC-1
  it("refuses an unknown action and a seek without a valid index as usage errors", async () => {
    const root = await prdWorkspace();
    const unknown = await cursor(root, "rewind");
    expect(unknown.code).toBe(2);
    expect(unknown.json.error.code).toBe("USAGE");
    expect((await mcp(root, "prd_cursor", { action: "rewind", path: PRD_PATH, runId: RUN })).ok).toBe(false);
    const noIndex = await cursor(root, "seek");
    expect(noIndex.code).toBe(2);
    expect(noIndex.json.error.code).toBe("USAGE");
    const outOfRange = await cursor(root, "seek", "--index", "9");
    expect(outOfRange.json.error.code).toBe("PRD_CURSOR_INDEX_OUT_OF_RANGE");
  });
});

describe("FR-NODE-241 AC-2 — next needs a verdict; skipping needs deferred with a reason", () => {
  // @req FR-NODE-241 AC-2
  it("refuses next without a verdict and deferred without a note, and accepts deferred with a note", async () => {
    const root = await prdWorkspace();
    const bare = await cursor(root, "next");
    expect(bare.code).not.toBe(0);
    expect(bare.json.error.code).toBe("PRD_CURSOR_VERDICT_REQUIRED");
    expect((await mcp(root, "prd_cursor", { action: "next", path: PRD_PATH, runId: RUN })).error?.code).toBe("PRD_CURSOR_VERDICT_REQUIRED");
    const deferredBare = await cursor(root, "next", "--verdict", "deferred");
    expect(deferredBare.json.error.code).toBe("PRD_CURSOR_DEFER_REASON_REQUIRED");
    expect((await cursor(root, "current")).json.index).toBe(1);
    const deferred = await cursor(root, "next", "--verdict", "deferred", "--note", "waits for the auth wave");
    expect(deferred.json).toMatchObject({ index: 2 });
  });
});

describe("FR-NODE-241 AC-3 — the ledger kiwi/prd/<run_id>.jsonl", () => {
  // @req FR-NODE-241 AC-3
  it("appends one verdict per line under kiwi/prd/<run_id>.jsonl and keeps two run IDs apart", async () => {
    const root = await prdWorkspace();
    await cursor(root, "next", "--verdict", "accepted", "--ref", "FR-ARCH-001", "--ref", "FR-ARCH-002");
    await mcp(root, "prd_cursor", { action: "next", path: PRD_PATH, runId: RUN, verdict: "respected", refs: ["FR-ARCH-003"], note: "kept" });
    const lines = (await readFile(path.join(root, "kiwi", "prd", `${RUN}.jsonl`), "utf8")).trim().split("\n");
    const parsed = lines.map((line) => JSON.parse(line) as { item: string; verdict: string; refs: string[]; note: string });
    expect(parsed.map((line) => [line.item, line.verdict, line.refs, line.note])).toEqual([
      ["PRD-1", "accepted", ["FR-ARCH-001", "FR-ARCH-002"], ""],
      ["PRD-2", "respected", ["FR-ARCH-003"], "kept"]
    ]);
    const other = await cliJson<Position>(root, "cursor", "current", PRD_PATH, "--run-id", "run-2");
    expect(other.json.index).toBe(1);
    expect((await cursor(root, "current")).json.index).toBe(3);
  });

  // @req FR-NODE-241 AC-3
  it("refuses a run ID that is not lower case or that names a path, on both surfaces", async () => {
    const root = await prdWorkspace();
    for (const runId of ["Run-1", "../escape", "a/b"]) {
      const counted = await cliJson<Refusal>(root, "cursor", "count", PRD_PATH, "--run-id", runId);
      expect(counted.json.error?.code, runId).toBe("PRD_CURSOR_RUN_ID_INVALID");
      const refused = await cliJson<Refusal>(root, "cursor", "current", PRD_PATH, "--run-id", runId);
      expect(refused.code, runId).not.toBe(0);
      expect(refused.json.error.code, runId).toBe("PRD_CURSOR_RUN_ID_INVALID");
      expect((await mcp(root, "prd_cursor", { action: "current", path: PRD_PATH, runId })).error?.code, runId).toBe("PRD_CURSOR_RUN_ID_INVALID");
    }
  });
});

describe("FR-NODE-241 AC-4 — a changed PRD voids the round", () => {
  // @req FR-NODE-241 AC-4
  it("returns invalidated with the previous and current hash and restarts at index 1", async () => {
    const root = await prdWorkspace();
    await cursor(root, "next", "--verdict", "accepted");
    const before = createHash("sha256").update(buildPrd()).digest("hex");
    const changed = buildPrd({ approval: "수정 후 진행해 주세요." });
    await writePrd(root, PRD_PATH, changed);
    const { json } = await cursor(root, "current");
    expect(json).toMatchObject({ index: 1, invalidated: { previous: before, current: createHash("sha256").update(changed).digest("hex") } });
  });
});

describe("FR-NODE-241 — the SRS direction", () => {
  // @req FR-NODE-241 AC-1
  it("iterates the target's requirements and criteria under --direction srs-to-prd", async () => {
    const root = await prdWorkspace();
    const counted = await cliJson<{ total: number }>(root, "cursor", "count", PRD_PATH, "--run-id", RUN, "--direction", "srs-to-prd", "--target", "v1.0.0");
    expect(counted.json.total).toBe(3);
    const current = await cliJson<Position>(root, "cursor", "current", PRD_PATH, "--run-id", RUN, "--direction", "srs-to-prd", "--target", "v1.0.0");
    expect(current.json.item?.id).toBe("FR-ARCH-001");
    const moved = await mcp<Position>(root, "prd_cursor", { action: "next", path: PRD_PATH, runId: RUN, direction: "srs-to-prd", target: "v1.0.0", verdict: "grounded" });
    expect(moved.value?.item?.id).toBe("FR-ARCH-001#AC-1");
    // The PRD direction of the same run is untouched.
    expect((await cursor(root, "current")).json.index).toBe(1);
  });

  // @req FR-NODE-241 AC-1
  it("refuses the SRS direction without a target, with an unknown target, and an unknown direction", async () => {
    const root = await prdWorkspace();
    const noTarget = await cliJson<Refusal>(root, "cursor", "count", PRD_PATH, "--run-id", RUN, "--direction", "srs-to-prd");
    expect(noTarget.code).toBe(2);
    expect(noTarget.json.error.code).toBe("USAGE");
    const unknown = await cliJson<Refusal>(root, "cursor", "count", PRD_PATH, "--run-id", RUN, "--direction", "srs-to-prd", "--target", "v9.9.9");
    expect(unknown.code).toBe(5);
    expect(unknown.json.error.code).toBe("TARGET_NOT_FOUND");
    expect((await mcp(root, "prd_cursor", { action: "count", path: PRD_PATH, runId: RUN, direction: "srs-to-prd", target: "v9.9.9" })).error?.code).toBe("TARGET_NOT_FOUND");
    const sideways = await cliJson<Refusal>(root, "cursor", "count", PRD_PATH, "--run-id", RUN, "--direction", "sideways");
    expect(sideways.json.error.code).toBe("USAGE");
  });
});

describe("FR-NODE-241 — MCP classification", () => {
  // @req FR-NODE-241 AC-3
  it("declares prd_cursor a workspace-kind writer, not read-only, without a per-call workspace root", () => {
    expect(isReadOnlyTool("prd_cursor")).toBe(false);
    const server = createTestMcpServer({});
    registerPrdTools(server, {});
    expect(server.toolKinds.prd_cursor).toBe("workspace");
    expect(toolSchemas.prd_cursor).toBeDefined();
    expect(Object.keys(toolSchemas.prd_cursor ?? {})).not.toContain("workspaceRoot");
  });
});
