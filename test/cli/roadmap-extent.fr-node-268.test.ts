import { readFile, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { AS_OF, mcp, roadmapFile, roadmapWorkspace } from "./roadmap-surface-fixture.js";

// FR-NODE-268 AC-4 and AC-5 — one extent rule for roadmap writes: an item runs from its heading to the
// next heading of level 1 to 3 outside code, a section from its `####` heading to the next `####`
// heading outside code, known or not; a write changes only the section it names, puts a new section
// before the item's Change History (after the item's last line when it has none) and a new Change
// History after the item's last line; a document with a fence that never closes is not written. The
// section text is kept line for line, with only the blank lines around it removed, and a value is
// refused only for a line the reader would take as structure.

interface ItemView {
  description: string;
  features: string;
  purpose: string;
}

async function document(root: string): Promise<string> {
  return (await readFile(roadmapFile(root), "utf8")).replace(/\r\n/g, "\n");
}

/** A workspace whose only item has no Change History: the document ends with the item's `sections`. */
async function withoutHistory(sections: string[]): Promise<string> {
  const root = await roadmapWorkspace([{ n: 1, title: "No history", sections }]);
  const text = await readFile(roadmapFile(root), "utf8");
  await writeFile(roadmapFile(root), text.slice(0, text.indexOf("#### Change History")), "utf8");
  return root;
}

function historyRowsOf(text: string): string[] {
  return text.split("\n").filter((line) => /^\| \d{4}-\d{2}-\d{2} \|/.test(line));
}

describe("FR-NODE-268 AC-4 — item and section extents by heading lines outside code", () => {
  it("@req FR-NODE-268 AC-4: an update of Description keeps an unknown section that follows it, byte for byte", async () => {
    const root = await roadmapWorkspace([
      { n: 1, title: "Notes", sections: ["#### Description", "", "Old.", "", "#### Notes", "", "keep-me", "", "#### Features", "", "- F", ""] }
    ]);
    const before = await document(root);

    const updated = await mcp<{ written: boolean }>(root, "update_roadmap_item", { item: "RM-1", description: "New." });

    expect(updated.ok, JSON.stringify(updated.error)).toBe(true);
    const after = await document(root);
    const added = historyRowsOf(after).slice(historyRowsOf(before).length);
    expect(added).toHaveLength(1);
    expect(after.replace(`${added[0]}\n`, "")).toBe(before.replace("#### Description\n\nOld.\n", "#### Description\n\nNew.\n"));
  });

  it("@req FR-NODE-268 AC-4: a `####` line inside a fence is not a section boundary, so replacing Description replaces the whole fence", async () => {
    const root = await roadmapWorkspace([
      { n: 1, title: "Fenced", sections: ["#### Description", "", "Before.", "", "```", "#### Inner", "```", "", "#### Features", "", "- F", ""] }
    ]);

    const updated = await mcp(root, "update_roadmap_item", { item: "RM-1", description: "Rewritten." });

    expect(updated.ok, JSON.stringify(updated.error)).toBe(true);
    const after = await document(root);
    expect(after).toContain("#### Description\n\nRewritten.\n\n#### Features\n\n- F\n");
    expect(after).not.toContain("#### Inner");
  });

  it("@req FR-NODE-268 AC-4: a new section goes right before the item's Change History, and every other line stays as it was", async () => {
    const root = await roadmapWorkspace([
      { n: 1, title: "With history", sections: ["#### Notes", "", "    kept code", ""] },
      { n: 2, title: "Next" }
    ]);
    const before = await document(root);

    const updated = await mcp(root, "update_roadmap_item", { item: "RM-1", features: "- F" });

    expect(updated.ok, JSON.stringify(updated.error)).toBe(true);
    const after = await document(root);
    // RM-2's rows follow RM-1's, so the new row is found by its field, not its position.
    const added = historyRowsOf(after).filter((row) => row.includes("| Features |"));
    expect(added).toHaveLength(1);
    const at = before.indexOf("#### Change History\n");
    expect(after.replace(`${added[0]}\n`, "")).toBe(`${before.slice(0, at)}#### Features\n\n- F\n\n${before.slice(at)}`);
  });

  it("@req FR-NODE-268 AC-4: in an item without Change History, the new section and then the new Change History go after its last line, a fence closer included", async () => {
    const root = await withoutHistory(["```", "purpose-code", "```", ""]);
    const before = await document(root);

    const updated = await mcp(root, "update_roadmap_item", { item: "RM-1", description: "Added." });

    expect(updated.ok, JSON.stringify(updated.error)).toBe(true);
    const after = await document(root);
    // Every line the item had stays where it was; what is new starts after the fence closer.
    expect(after.startsWith(`${before.trimEnd()}\n`), after).toBe(true);
    const tail = after.slice(before.trimEnd().length);
    expect(tail).toMatch(/^\n\n#### Description\n\nAdded\.\n\n#### Change History\n/);
    const shown = await mcp<{ item: ItemView }>(root, "get_roadmap_item", { item: "RM-1", asOf: AS_OF });
    expect(shown.value!.item.description).toBe("Added.");
    const check = await mcp<{ passed: boolean }>(root, "check_roadmap", {});
    expect(check.value?.passed, JSON.stringify(check)).toBe(true);
  });

  it("@req FR-NODE-268 AC-4: a new section of an item followed by another item goes after the item's last line and leaves the next item as it was", async () => {
    const root = await roadmapWorkspace([
      { n: 1, title: "Tail", sections: ["#### Features", "", "Text.", "", "    tail code", ""] },
      { n: 2, title: "Next" }
    ]);
    // Hand-made: RM-1 loses its Change History, so it ends with the indented code line.
    const written = await document(root);
    await writeFile(roadmapFile(root), written.slice(0, written.indexOf("#### Change History")) + written.slice(written.indexOf("### RM-2 — ")), "utf8");
    const before = await document(root);
    const historyEnd = before.indexOf("### RM-2 — ");

    const updated = await mcp(root, "update_roadmap_item", { item: "RM-1", description: "Added." });

    expect(updated.ok, JSON.stringify(updated.error)).toBe(true);
    const after = await document(root);
    expect(after.slice(after.indexOf("### RM-2 — "))).toBe(before.slice(historyEnd));
    const item = after.slice(0, after.indexOf("### RM-2 — "));
    expect(item.indexOf("    tail code")).toBeGreaterThan(0);
    expect(item.indexOf("    tail code")).toBeLessThan(item.indexOf("#### Description"));
  });

  it("@req FR-NODE-268 AC-4: filling an empty last section keeps its text under its heading, before what is added after the item", async () => {
    const root = await withoutHistory(["#### Features", ""]);

    const updated = await mcp(root, "update_roadmap_item", { item: "RM-1", features: "- F", description: "Added." });

    expect(updated.ok, JSON.stringify(updated.error)).toBe(true);
    const after = await document(root);
    expect(after).toMatch(/#### Features\n\n- F\n\n#### Description\n\nAdded\.\n\n#### Change History\n/);
    const shown = await mcp<{ item: ItemView }>(root, "get_roadmap_item", { item: "RM-1", asOf: AS_OF });
    expect({ description: shown.value!.item.description, features: shown.value!.item.features }).toEqual({ description: "Added.", features: "- F" });
  });

  it("@req FR-NODE-268 AC-4: add refuses a document whose fence never closes, names the fence line and writes nothing", async () => {
    const root = await roadmapWorkspace([
      { n: 1, title: "Open fence", sections: ["#### Description", "", "Before.", "", "```", "code", ""] },
      { n: 2, title: "Hidden item" }
    ]);
    const before = await document(root);
    const fenceLine = before.split("\n").indexOf("```") + 1;

    const added = await mcp(root, "add_roadmap_item", { kind: "feature", title: "New item", reason: "planned" });

    expect(added.ok).toBe(false);
    expect(added.error?.message).toContain(`docs/roadmap.md line ${fenceLine} opens a code fence that never closes`);
    expect(await document(root)).toBe(before);
  });

  it("@req FR-NODE-268 AC-4: update refuses a fence that opens before the first item, names its line and writes nothing", async () => {
    const root = await roadmapWorkspace([{ n: 1, title: "A" }]);
    await writeFile(roadmapFile(root), (await document(root)).replace("## 1. Items\n", "## 1. Items\n\n```\nnote\n"), "utf8");
    const before = await document(root);
    const fenceLine = before.split("\n").indexOf("```") + 1;

    const updated = await mcp(root, "update_roadmap_item", { item: "RM-1", description: "New." });

    expect(updated.ok).toBe(false);
    expect(updated.error?.message).toContain(`docs/roadmap.md line ${fenceLine} opens a code fence that never closes`);
    expect(await document(root)).toBe(before);
  });
});

describe("FR-NODE-268 AC-5 — section text kept as given, outer blank lines removed", () => {
  it("@req FR-NODE-268 AC-5: add writes Description and Features line for line, indentation kept, only outer blank lines removed", async () => {
    const description = "    npm run build\n\nThen read the plan.  ";
    const features = "  - Indented entry\n- Second";
    const root = await roadmapWorkspace(null);

    const added = await mcp<{ id: string }>(root, "add_roadmap_item", {
      kind: "feature",
      title: "Verbatim",
      description: `\n  \n${description}\n\n`,
      features: `\n${features}\n \n`,
      reason: "planned"
    });

    expect(added.ok, JSON.stringify(added.error)).toBe(true);
    const text = await document(root);
    expect(text).toContain(`#### Description\n\n${description}\n\n#### Features\n\n${features}\n\n#### Change History`);
    const shown = await mcp<{ item: ItemView }>(root, "get_roadmap_item", { item: added.value!.id, asOf: AS_OF });
    expect({ description: shown.value!.item.description, features: shown.value!.item.features }).toEqual({ description, features });
  });

  it("@req FR-NODE-268 AC-5: the view returns a hand-written Description line for line, an indented first line included", async () => {
    const description = "    npm run build\n\nThen read the plan.";
    const root = await roadmapWorkspace([{ n: 1, title: "Indented first", sections: ["#### Description", "", "", ...description.split("\n"), "", ""] }]);

    const shown = await mcp<{ item: ItemView }>(root, "get_roadmap_item", { item: "RM-1", asOf: AS_OF });

    expect(shown.ok, JSON.stringify(shown.error)).toBe(true);
    expect(shown.value!.item.description).toBe(description);
  });

  it("@req FR-NODE-268 AC-5: update writes an indented value as given, and the same value with outer blank lines is a no-op", async () => {
    const description = "    code first\nThen prose.";
    const root = await roadmapWorkspace([{ n: 1, title: "A", sections: ["#### Description", "", "Old.", ""] }]);

    const updated = await mcp(root, "update_roadmap_item", { item: "RM-1", description });
    expect(updated.ok, JSON.stringify(updated.error)).toBe(true);
    const written = await document(root);
    expect(written).toContain(`#### Description\n\n${description}\n`);

    const again = await mcp<{ written: boolean; changes: unknown[] }>(root, "update_roadmap_item", { item: "RM-1", description: `\n\n${description}\n \n` });
    expect(again.ok, JSON.stringify(again.error)).toBe(true);
    expect(again.value).toMatchObject({ written: false, changes: [] });
    expect(await document(root)).toBe(written);
  });
});

describe("FR-NODE-268 AC-5 — a value is refused only for a line the reader takes as structure", () => {
  const ACCEPTED: Array<[string, string]> = [
    ["a table", "Targets by quarter:\n\n| Quarter | Goal |\n|---|---|\n| Q1 | Ship |"],
    ["a `#` line in indented code", "Install:\n\n    # dependencies first\n    npm ci"],
    ["a `####` line in a closed fence", "Example:\n\n```md\n#### Not a section\n```"],
    ["an HTML comment block", "Before.\n\n<!--\nnote\n-->\n\nAfter."]
  ];

  it("@req FR-NODE-268 AC-5: add and update accept a table, indented code, a closed fence and a comment block, and the view returns them", async () => {
    for (const [what, value] of ACCEPTED) {
      const root = await roadmapWorkspace(null);
      const added = await mcp<{ id: string }>(root, "add_roadmap_item", { kind: "feature", title: "Accepted", description: value, reason: "planned" });
      expect(added.ok, `${what}: ${JSON.stringify(added.error)}`).toBe(true);
      const updated = await mcp(root, "update_roadmap_item", { item: added.value!.id, features: value });
      expect(updated.ok, `${what}: ${JSON.stringify(updated.error)}`).toBe(true);
      const shown = await mcp<{ item: ItemView }>(root, "get_roadmap_item", { item: added.value!.id, asOf: AS_OF });
      expect({ description: shown.value!.item.description, features: shown.value!.item.features }, what).toEqual({ description: value, features: value });
      const check = await mcp<{ passed: boolean }>(root, "check_roadmap", {});
      expect(check.value?.passed, `${what}: ${JSON.stringify(check)}`).toBe(true);
    }
  });

  const REFUSED: Array<[string, string, string]> = [
    ["a level-2 heading", "Before.\n\n## Aside\n\nAfter.", "## Aside"],
    ["a `####` heading", "Before.\n\n#### Notes\n\nAfter.", "#### Notes"],
    ["a fence it never closes", "Before.\n\n```\ncode", "```"],
    ["an HTML comment it never closes", "Before.\n\n<!-- draft", "<!-- draft"]
  ];

  it("@req FR-NODE-268 AC-5: add and update refuse a heading line outside code and a fence or comment the value never closes, naming the line, and write nothing", async () => {
    for (const [what, value, line] of REFUSED) {
      const root = await roadmapWorkspace([{ n: 1, title: "A" }]);
      const before = await document(root);
      const added = await mcp(root, "add_roadmap_item", { kind: "feature", title: "Refused", description: value, reason: "planned" });
      const updated = await mcp(root, "update_roadmap_item", { item: "RM-1", features: value });
      for (const answer of [added, updated]) {
        expect(answer.ok, what).toBe(false);
        expect(answer.error?.code, what).toBe("USAGE");
        expect(answer.error?.message, what).toContain(`: ${line}`);
      }
      expect(await document(root), what).toBe(before);
    }
  });
});
