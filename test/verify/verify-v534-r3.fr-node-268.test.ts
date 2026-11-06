import { readFile, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { ROADMAP_FIELDS } from "../../src/core/roadmap/roadmap-grammar.js";
import { roadmapText } from "../core/roadmap/roadmap-fixture.js";
import { AS_OF, mcp, roadmapFile, roadmapWorkspace } from "../cli/roadmap-surface-fixture.js";

// verify-v534-r3 — FR-NODE-268 after the unclosed-fence refusal. Each case states how its input is made.

interface ItemView {
  description: string;
  features: string;
  purpose: string;
}

const HEAD_AND_ITEM = (n: number, title: string, body: string[]): string[] => [
  `### RM-${n} — ${title}`,
  "",
  "| Field | Value |",
  "|---|---|",
  ...ROADMAP_FIELDS.map((field) => `| ${field} | ${field === "Kind" ? "feature" : field === "Lifecycle" ? "open" : "-"} |`),
  "",
  ...body
];

describe("verify-v534-r3 FR-NODE-268", () => {
  it("add_roadmap_item after an item whose fence never closes does not write a new item the reader cannot see", async () => {
    // Hand-made: RM-1's Description opens a fence and never closes it, so RM-2 is hidden inside it.
    // The update refuses this document; add appends behind the open fence.
    const root = await roadmapWorkspace([
      { n: 1, title: "Open fence", sections: ["#### Description", "", "Before.", "", "```", "code", ""] },
      { n: 2, title: "Hidden item" }
    ]);

    const added = await mcp<{ id: string; written: boolean }>(root, "add_roadmap_item", { kind: "feature", title: "New item", reason: "planned" });
    const after = await readFile(roadmapFile(root), "utf8");
    const headingsRm2 = after.split("\n").filter((line) => line.startsWith("### RM-2 "));

    if (added.ok) {
      // A write that went through must leave an item the tools can read, under an id no other heading holds.
      expect(headingsRm2.length, `headings for RM-2 after add (id given: ${added.value!.id})`).toBeLessThanOrEqual(1);
      const shown = await mcp(root, "get_roadmap_item", { item: added.value!.id, asOf: AS_OF });
      expect(shown.ok, JSON.stringify(shown.error)).toBe(true);
    }
  }, 60_000);

  it("update_roadmap_item refuses an unclosed fence that opens before the first item by naming its line", async () => {
    // Hand-made: the fence opens in the document head, so every item is hidden behind it.
    const root = await roadmapWorkspace([{ n: 1, title: "A" }]);
    const text = await readFile(roadmapFile(root), "utf8");
    await writeFile(roadmapFile(root), text.replace("## 1. Items\n", "## 1. Items\n\n```\nnote\n"), "utf8");

    const updated = await mcp(root, "update_roadmap_item", { item: "RM-1", description: "New." });
    expect(updated.ok).toBe(false);
    expect(updated.error?.message ?? "").toMatch(/line \d+/);
  }, 60_000);

  it("adding a Description to a hand-written item without Change History keeps Purpose's code block in Purpose", async () => {
    // Hand-made: an item with no Change History (the tools always write one), whose Purpose ends in a
    // closed fence. The new section is placed after the item's last body line, which is before the fence.
    const root = await roadmapWorkspace([]);
    const lines = [
      ...roadmapText().split("\n"),
      ...HEAD_AND_ITEM(1, "No history", ["#### Purpose", "", "Why.", "", "```", "purpose-code", "```", ""])
    ];
    await writeFile(roadmapFile(root), lines.join("\n"), "utf8");
    const updated = await mcp(root, "update_roadmap_item", { item: "RM-1", description: "Added." });
    expect(updated.ok, JSON.stringify(updated.error)).toBe(true);

    // Purpose's fenced lines must stay above the new Description heading, inside Purpose.
    const after = (await readFile(roadmapFile(root), "utf8")).split("\n");
    expect(after.indexOf("purpose-code"), after.join("\n")).toBeLessThan(after.indexOf("#### Description"));
    expect(after.indexOf("purpose-code"), after.join("\n")).toBeLessThan(after.indexOf("#### Change History"));
  }, 60_000);

  it("updating Description does not delete an unknown section that sits between Description and Features", async () => {
    // Hand-made: a `#### Notes` section, which roadmap check reports as ROADMAP-E003 before the update.
    const root = await roadmapWorkspace([
      { n: 1, title: "Notes", sections: ["#### Description", "", "Old.", "", "#### Notes", "", "keep-me", "", "#### Features", "", "- F", ""] }
    ]);

    const updated = await mcp(root, "update_roadmap_item", { item: "RM-1", description: "New." });
    const after = await readFile(roadmapFile(root), "utf8");
    if (updated.ok) {
      expect(after).toContain("#### Notes");
      expect(after).toContain("keep-me");
    }
  }, 60_000);

  it("filling an empty Description whose heading is directly followed by Features keeps Features", async () => {
    // Hand-made: no blank line between the two headings.
    const root = await roadmapWorkspace([{ n: 1, title: "Adjacent", sections: ["#### Description", "#### Features", "", "- F", ""] }]);

    const updated = await mcp(root, "update_roadmap_item", { item: "RM-1", description: "Filled." });
    expect(updated.ok, JSON.stringify(updated.error)).toBe(true);
    const shown = await mcp<{ item: ItemView }>(root, "get_roadmap_item", { item: "RM-1", asOf: AS_OF });
    expect(shown.ok, JSON.stringify(shown.error)).toBe(true);
    expect(shown.value!.item.description).toBe("Filled.");
    expect(shown.value!.item.features).toBe("- F");
  }, 60_000);

  it("a hand-written Description that begins with an indented code block comes back with its indentation", async () => {
    // Hand-made: the Description's first line is indented code.
    const description = "    npm run build\n\nThen read the plan.";
    const root = await roadmapWorkspace([{ n: 1, title: "Indented first", sections: ["#### Description", "", ...description.split("\n"), ""] }]);

    const shown = await mcp<{ item: ItemView }>(root, "get_roadmap_item", { item: "RM-1", asOf: AS_OF });
    expect(shown.ok, JSON.stringify(shown.error)).toBe(true);
    expect(shown.value!.item.description).toBe(description);
  }, 60_000);

  it("add_roadmap_item writes a Description that begins with an indented code block as given", async () => {
    // Input given to the tool: a Description whose first line is indented code.
    const description = "    npm run build\n\nThen read the plan.";
    const root = await roadmapWorkspace(null);
    const added = await mcp<{ id: string }>(root, "add_roadmap_item", { kind: "feature", title: "Indented first", description, reason: "planned" });
    expect(added.ok, JSON.stringify(added.error)).toBe(true);
    expect(await readFile(roadmapFile(root), "utf8")).toContain("    npm run build");
  }, 60_000);
});
