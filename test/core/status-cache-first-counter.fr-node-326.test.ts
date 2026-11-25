import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { addRequirement, type AddRequirementInput } from "../../src/core/mutation/add-requirement.js";
import { resolveProjectRoot } from "../../src/core/project-root.js";
import { allocateRequirementIdFromStatusCache, refreshSrsStatusCache } from "../../src/core/status-cache.js";
import { parseWorkspace } from "../../src/core/parser/workspace-parser.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

// @req FR-NODE-326 AC-1 AC-2 — a fresh cache without a counter for a series means the series is empty,
// the normal state before its first requirement; real cache damage still warns.

const CACHE = path.join("kiwi", ".status.json");

function security(title: string): AddRequirementInput {
  return {
    type: "security",
    scope: "ARCH",
    target: "v1.0.0",
    title,
    statement: "The system SHALL keep secrets out of logs.",
    acceptanceCriteria: ["THE SYSTEM SHALL keep secrets out of logs."],
    stability: "evolving"
  } as AddRequirementInput;
}

async function freshCache(): Promise<{ rootPath: string; cache: Record<string, unknown> }> {
  const rootPath = await copyFixtureWorkspace("mutation-target");
  const refreshed = await refreshSrsStatusCache(await resolveProjectRoot(rootPath));
  if (!refreshed.ok || !refreshed.value) throw new Error("cache refresh failed");
  return { rootPath, cache: refreshed.value as unknown as Record<string, unknown> };
}

const w065 = (diagnostics: Array<{ code: string }> | undefined) => (diagnostics ?? []).filter((entry) => entry.code === "SRS-W065");

describe("FR-NODE-326 AC-1 — the first requirement of a series allocates without a cache warning", () => {
  it("FR-NODE-326 AC-1: the cache allocator takes a missing counter as 0", async () => {
    const { rootPath } = await freshCache();
    const root = await resolveProjectRoot(rootPath);
    const allocated = await allocateRequirementIdFromStatusCache(root, await parseWorkspace(root), "security", "ARCH");
    expect(allocated.id).toBe("SEC-ARCH-001");
    expect(w065(allocated.diagnostics)).toEqual([]);
  });

  it("FR-NODE-326 AC-1: add_requirement files SEC-ARCH-001 with no SRS-W065", async () => {
    const { rootPath } = await freshCache();
    const result = await addRequirement(await resolveProjectRoot(rootPath), security("First secret rule"));
    expect(result.ok, JSON.stringify(result.error)).toBe(true);
    expect(result.value?.requirementId).toBe("SEC-ARCH-001");
    expect(w065(result.diagnostics)).toEqual([]);
  });
});

describe("FR-NODE-326 AC-2 — real cache damage still warns", () => {
  it.each([
    ["a negative counter", { security: { ARCH: -1 } }],
    ["a counter that is not a number", { security: { ARCH: "7" } }]
  ])("FR-NODE-326 AC-2: %s in a fresh cache still reports SRS-W065", async (_label, counters) => {
    const { rootPath, cache } = await freshCache();
    await writeFile(path.join(rootPath, CACHE), `${JSON.stringify({ ...cache, idCounters: { ...(cache.idCounters as object), ...counters } }, null, 2)}\n`, "utf8");
    const root = await resolveProjectRoot(rootPath);
    const allocated = await allocateRequirementIdFromStatusCache(root, await parseWorkspace(root), "security", "ARCH");
    expect(allocated.id).toBeNull();
    // The shape check reads such a cache as malformed before the counter is looked up; either reason is damage.
    expect(w065(allocated.diagnostics)).toHaveLength(1);
    expect(JSON.stringify(w065(allocated.diagnostics))).toMatch(/malformed-cache|incomplete-counter/);
  });

  it("FR-NODE-326 AC-2: a stale cache still reports stale-fingerprint", async () => {
    const { rootPath } = await freshCache();
    const spec = path.join(rootPath, "docs", "spec", "10.product-architecture.srs.md");
    await writeFile(spec, `${await readFile(spec, "utf8")}\n<!-- stale -->\n`, "utf8");
    const root = await resolveProjectRoot(rootPath);
    const allocated = await allocateRequirementIdFromStatusCache(root, await parseWorkspace(root), "security", "ARCH");
    expect(allocated.id).toBeNull();
    expect(JSON.stringify(w065(allocated.diagnostics))).toContain("stale-fingerprint");
  });
});
