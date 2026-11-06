import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { AS_OF, cliJson, mcp, roadmapFile, roadmapWorkspace } from "../cli/roadmap-surface-fixture.js";

// verify-v534-r2 — FR-NODE-268 AC-1 after the fence fix. The fix returns fence lines inside Description
// and Features; the shared line classifier has two other non-body kinds (indented code, HTML comment
// block) that the scan still drops.

interface SectionView {
  description: string;
  features: string;
}

describe("verify-v534-r2 FR-NODE-268", () => {
  it("a Description holding an indented code block, written by add_roadmap_item itself, comes back as written", async () => {
    // The write guard refuses a fence and an HTML comment block, but not an indented code block, so the
    // roadmap tools write this value; the view must return it.
    const description = "Run the build first.\n\n    npm run build\n\nThen read the plan.";
    const root = await roadmapWorkspace(null);
    const added = await mcp<{ id: string; written: boolean }>(root, "add_roadmap_item", { kind: "feature", title: "Indented", description, reason: "planned" });
    expect(added.ok, JSON.stringify(added.error)).toBe(true);
    expect(await readFile(roadmapFile(root), "utf8")).toContain("    npm run build");

    const shown = await mcp<{ item: SectionView }>(root, "get_roadmap_item", { item: added.value!.id, asOf: AS_OF });
    expect(shown.ok, JSON.stringify(shown.error)).toBe(true);
    expect(shown.value!.item.description).toBe(description);
    const viaCli = await cliJson<{ item: SectionView }>(root, "show", added.value!.id, "--as-of", AS_OF);
    expect(viaCli.json.item.description).toBe(description);
  }, 60_000);

  it("a Features list whose item carries an indented code block, written by add_roadmap_item, comes back as written", async () => {
    const features = "- Builds the plan:\n\n          npm run build\n\n- Reads the plan";
    const root = await roadmapWorkspace(null);
    const added = await mcp<{ id: string }>(root, "add_roadmap_item", { kind: "feature", title: "Nested", features, reason: "planned" });
    expect(added.ok, JSON.stringify(added.error)).toBe(true);

    const shown = await mcp<{ item: SectionView }>(root, "get_roadmap_item", { item: added.value!.id, asOf: AS_OF });
    expect(shown.value!.item.features).toBe(features);
  }, 60_000);

  it("a hand-written HTML comment block in Description comes back as written", async () => {
    // Hand-made: the write guard refuses an HTML comment block, so only a hand edit puts one there.
    const description = "Before.\n\n<!--\nreviewer note\n-->\n\nAfter.";
    const root = await roadmapWorkspace([{ n: 1, title: "Commented", sections: ["#### Description", "", ...description.split("\n"), ""] }]);

    const shown = await mcp<{ item: SectionView }>(root, "get_roadmap_item", { item: "RM-1", asOf: AS_OF });
    expect(shown.ok, JSON.stringify(shown.error)).toBe(true);
    expect(shown.value!.item.description).toBe(description);
  }, 60_000);

  it("an unclosed fence in RM-1's Description hides RM-2's heading in code, so the view returns it as RM-1's Description text", async () => {
    // Hand-made: a fence opened and never closed. Expectation changed by the 5.3.4 extent rule
    // (FR-NODE-268 AC-4): the fence runs to the end of the document, so RM-2's heading is not an item
    // heading outside code and RM-1's Description runs to the end of the document.
    const root = await roadmapWorkspace([
      { n: 1, title: "Open fence", sections: ["#### Description", "", "Before.", "", "```", "code", ""] },
      { n: 2, title: "Next item", sections: ["#### Description", "", "Second.", ""] }
    ]);

    const shown = await mcp<{ item: SectionView }>(root, "get_roadmap_item", { item: "RM-1", asOf: AS_OF });
    expect(shown.ok, JSON.stringify(shown.error)).toBe(true);
    expect(shown.value!.item.description).toContain("### RM-2 — Next item");
  }, 60_000);

  it("updating RM-1's Description after an unclosed fence is refused, names the fence line and leaves the file byte for byte", async () => {
    // Hand-made, same document as above. Expectation changed by the 5.3.4 rule (FR-NODE-268 AC-4): a
    // document with a fence that never closes is not written.
    const root = await roadmapWorkspace([
      { n: 1, title: "Open fence", sections: ["#### Description", "", "Before.", "", "```", "code", ""] },
      { n: 2, title: "Next item", sections: ["#### Description", "", "Second.", ""] }
    ]);
    const before = await readFile(roadmapFile(root), "utf8");
    const fenceLine = before.split("\n").indexOf("```") + 1;

    const updated = await mcp<{ written: boolean }>(root, "update_roadmap_item", { item: "RM-1", description: "Rewritten." });
    expect(updated.ok).toBe(false);
    expect(updated.error?.message).toContain(`line ${fenceLine} opens a code fence that never closes`);
    expect(await readFile(roadmapFile(root), "utf8")).toBe(before);
  }, 60_000);
});
