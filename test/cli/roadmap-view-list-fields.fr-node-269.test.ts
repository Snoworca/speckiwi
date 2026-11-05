import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { AS_OF, cliJson, mcp, roadmapFile, roadmapWorkspace } from "./roadmap-surface-fixture.js";

// FR-NODE-269 — the roadmap item view carries the item's PRD, Owner and GitHub Issue values.
//
// update replaces the whole PRD list, but the view had no `prd`, so a caller could not read the paths
// already recorded before passing the new list, and recording one more PRD erased the earlier one.

const PRD_A = "docs/prd/2026-11-01.alpha.prd.md";
const PRD_B = "docs/prd/2026-11-02.beta.prd.md";
const ISSUE_A = "https://github.com/example/repo/issues/1";
const ISSUE_B = "https://github.com/example/repo/issues/2";

interface ViewFields {
  id: string;
  prd: unknown;
  owner: unknown;
  githubIssue: unknown;
}

/** RM-1 holds every value; RM-2 holds `-` in all three cells. */
function workspace() {
  return roadmapWorkspace([
    { n: 1, title: "Filled", fields: { PRD: `${PRD_A}, ${PRD_B}`, Owner: "kim", "GitHub Issue": `${ISSUE_A}, ${ISSUE_B}` } },
    { n: 2, title: "Empty" }
  ]);
}

function picked(item: ViewFields) {
  return { prd: item.prd, owner: item.owner, githubIssue: item.githubIssue };
}

const FILLED = { prd: [PRD_A, PRD_B], owner: "kim", githubIssue: [ISSUE_A, ISSUE_B] };
const EMPTY = { prd: [], owner: null, githubIssue: [] };

describe("FR-NODE-269 AC-1 — show and list carry prd, owner and githubIssue", () => {
  // @req FR-NODE-269 AC-1
  it("roadmap show --json returns the lists and the owner, empty or null for `-`", async () => {
    const root = await workspace();
    const filled = await cliJson<{ item: ViewFields }>(root, "show", "RM-1", "--as-of", AS_OF);
    const empty = await cliJson<{ item: ViewFields }>(root, "show", "RM-2", "--as-of", AS_OF);

    expect(filled.code, filled.stdout).toBe(0);
    expect(picked(filled.json.item)).toEqual(FILLED);
    expect(picked(empty.json.item)).toEqual(EMPTY);
  });

  // @req FR-NODE-269 AC-1
  it("roadmap list --json returns them on every item", async () => {
    const root = await workspace();
    const listed = await cliJson<{ items: ViewFields[] }>(root, "list", "--as-of", AS_OF);

    expect(listed.code, listed.stdout).toBe(0);
    expect(listed.json.items.map(picked)).toEqual([FILLED, EMPTY]);
  });

  // @req FR-NODE-269 AC-1
  it("MCP get_roadmap_item and list_roadmap_items return them too", async () => {
    const root = await workspace();
    const shown = await mcp<{ item: ViewFields }>(root, "get_roadmap_item", { item: "RM-1", asOf: AS_OF });
    const listed = await mcp<{ items: ViewFields[] }>(root, "list_roadmap_items", { asOf: AS_OF });

    expect(shown.ok, JSON.stringify(shown.error)).toBe(true);
    expect(picked(shown.value!.item)).toEqual(FILLED);
    expect(listed.value!.items.map(picked)).toEqual([FILLED, EMPTY]);
  });
});

describe("FR-NODE-269 AC-2 — extending the read list keeps every earlier path", () => {
  const NEW_PRD = "docs/prd/2026-11-03.gamma.prd.md";

  // @req FR-NODE-269 AC-2
  it("roadmap update --prd with the view's prd plus one path keeps both earlier paths and records the lists in history", async () => {
    const root = await workspace();
    const { json } = await cliJson<{ item: ViewFields }>(root, "show", "RM-1", "--as-of", AS_OF);
    const extended = [...(json.item.prd as string[]), NEW_PRD];

    const updated = await cliJson<{ value?: { written?: boolean } }>(root, "update", "RM-1", "--prd", extended.join(","));

    expect(updated.code, updated.stdout).toBe(0);
    const text = await readFile(roadmapFile(root), "utf8");
    expect(text).toContain(`| PRD | ${PRD_A}, ${PRD_B}, ${NEW_PRD} |`);
    const after = await cliJson<{ item: ViewFields & { history: Array<{ field: string; from: string; to: string }> } }>(root, "show", "RM-1", "--as-of", AS_OF);
    expect(after.json.item.prd).toEqual([PRD_A, PRD_B, NEW_PRD]);
    expect(after.json.item.history.at(-1)).toMatchObject({ field: "PRD", from: `${PRD_A}, ${PRD_B}`, to: `${PRD_A}, ${PRD_B}, ${NEW_PRD}` });
  });

  // @req FR-NODE-269 AC-2
  it("MCP update_roadmap_item with the view's prd plus one path does the same", async () => {
    const root = await workspace();
    const shown = await mcp<{ item: ViewFields }>(root, "get_roadmap_item", { item: "RM-1", asOf: AS_OF });
    const extended = [...(shown.value!.item.prd as string[]), NEW_PRD];

    const updated = await mcp(root, "update_roadmap_item", { item: "RM-1", prd: extended });

    expect(updated.ok, JSON.stringify(updated.error)).toBe(true);
    expect(await readFile(roadmapFile(root), "utf8")).toContain(`| PRD | ${PRD_A}, ${PRD_B}, ${NEW_PRD} |`);
  });
});
