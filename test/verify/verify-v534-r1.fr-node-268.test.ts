import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { AS_OF, mcp, roadmapFile, roadmapWorkspace } from "../cli/roadmap-surface-fixture.js";

// verify-v534-r1 — FR-NODE-268 edge inputs. Both cases below are hand-made inputs: a value with CRLF
// line breaks over MCP, and a hand-written Description holding a fenced code block (the tools refuse
// to write a fence, so only a hand edit puts one there).

describe("verify-v534-r1 FR-NODE-268", () => {
  // declared limit, 5.3.4 lead decision
  it.fails("update_roadmap_item with the same Description text in CRLF line breaks is a no-op", async () => {
    const root = await roadmapWorkspace([{ n: 1, title: "A", sections: ["#### Description", "", "Line one.", "Line two.", ""] }]);
    const before = await readFile(roadmapFile(root), "utf8");

    const updated = await mcp<{ written: boolean; changes: unknown[] }>(root, "update_roadmap_item", { item: "RM-1", description: "Line one.\r\nLine two." });

    expect(updated.ok, JSON.stringify(updated.error)).toBe(true);
    // Measured: written true, one Description change from "Line one.\nLine two." to "Line one.\r\nLine two.",
    // and a Change History row "(text) → (text)" for a text that did not change.
    expect(updated.value).toMatchObject({ written: false, changes: [] });
    expect(await readFile(roadmapFile(root), "utf8")).toBe(before);
  }, 60_000);

  it("get_roadmap_item returns the whole Description text, including a fenced code block written in it by hand", async () => {
    const root = await roadmapWorkspace([{ n: 1, title: "A", sections: ["#### Description", "", "Before.", "", "```", "code", "```", "", "After.", ""] }]);

    const shown = await mcp<{ item: { description: string } }>(root, "get_roadmap_item", { item: "RM-1", asOf: AS_OF });

    expect(shown.ok, JSON.stringify(shown.error)).toBe(true);
    // Measured: "Before.\n\n\nAfter." — the fence and its content are dropped from the view.
    expect(shown.value!.item.description).toContain("code");
  }, 60_000);
});
