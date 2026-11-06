import { readFile, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { AS_OF, cli, cliJson, mcp, roadmapFile, roadmapWorkspace } from "./roadmap-surface-fixture.js";

// FR-NODE-268 — the roadmap item view carries Description and Features, and add and update take them,
// so an agent reads and records an item's Features through the roadmap tools alone.

const DESCRIPTION = "Lets a reviewer read the plan.\nSecond paragraph line.";
const FEATURES = "- Reads the plan\n- Writes the plan";

interface SectionView {
  description: unknown;
  features: unknown;
}

function picked(item: SectionView) {
  return { description: item.description, features: item.features };
}

/** RM-1 holds both sections; RM-2 holds `-` in both; RM-3 has neither. */
function workspace() {
  return roadmapWorkspace([
    { n: 1, title: "Filled", sections: ["#### Description", "", ...DESCRIPTION.split("\n"), "", "#### Features", "", ...FEATURES.split("\n"), ""] },
    { n: 2, title: "Dashes", sections: ["#### Description", "", "-", "", "#### Features", "", "-", ""] },
    { n: 3, title: "Absent" }
  ]);
}

async function document(root: string): Promise<string> {
  return (await readFile(roadmapFile(root), "utf8")).replace(/\r\n/g, "\n");
}

function historyRows(text: string, id: string): string[] {
  const start = text.indexOf(`### ${id} — `);
  const next = text.indexOf("\n### RM-", start + 1);
  return text
    .slice(start, next < 0 ? undefined : next)
    .split("\n")
    .filter((line) => /^\| \d{4}-\d{2}-\d{2} \|/.test(line));
}

describe("FR-NODE-268 AC-1 — the item view carries description and features", () => {
  it("@req FR-NODE-268 AC-1: roadmap show --json returns the section text, empty for `-` and for an absent section", async () => {
    const root = await workspace();
    const views = await Promise.all(["RM-1", "RM-2", "RM-3"].map((id) => cliJson<{ item: SectionView }>(root, "show", id, "--as-of", AS_OF)));

    expect(views.map((view) => view.code)).toEqual([0, 0, 0]);
    expect(views.map((view) => picked(view.json.item))).toEqual([
      { description: DESCRIPTION, features: FEATURES },
      { description: "", features: "" },
      { description: "", features: "" }
    ]);
  });

  it("@req FR-NODE-268 AC-1: a fenced code block written in the sections by hand comes back as written", async () => {
    // The tools refuse a fence in a value, so only a hand edit puts one there; the view still returns the
    // section's whole text, fence lines included, and a `####` line inside a fence is not a section.
    const description = "Before.\n\n```\ncode\n```\n\nAfter.";
    const features = "- One\n\n```text\n#### Not a section\n```";
    const root = await roadmapWorkspace([
      { n: 1, title: "Fenced", sections: ["#### Description", "", ...description.split("\n"), "", "#### Features", "", ...features.split("\n"), ""] }
    ]);

    const shown = await mcp<{ item: SectionView }>(root, "get_roadmap_item", { item: "RM-1", asOf: AS_OF });
    expect(shown.ok, JSON.stringify(shown.error)).toBe(true);
    expect(picked(shown.value!.item)).toEqual({ description, features });
    const viaCli = await cliJson<{ item: SectionView }>(root, "show", "RM-1", "--as-of", AS_OF);
    expect(picked(viaCli.json.item)).toEqual({ description, features });

    // Updating the other section leaves the fenced one, and its history, as it was.
    const before = await document(root);
    const updated = await mcp<{ written: boolean; changes: { field: string }[] }>(root, "update_roadmap_item", { item: "RM-1", features: "- Two" });
    expect(updated.ok, JSON.stringify(updated.error)).toBe(true);
    expect(updated.value!.changes.map((change) => change.field)).toEqual(["Features"]);
    const after = await document(root);
    expect(after).toContain(`#### Description\n\n${description}\n\n#### Features\n\n- Two\n`);
    expect(historyRows(after, "RM-1").slice(historyRows(before, "RM-1").length).map((row) => row.split("|")[2]!.trim())).toEqual(["Features"]);
  });

  it("@req FR-NODE-268 AC-1: replacing a fenced last section removes its fence lines with it", async () => {
    // A hand-written item without Change History whose last section ends in a fence.
    const root = await roadmapWorkspace([{ n: 1, title: "Fenced", sections: ["#### Description", "", "Before.", "", "```", "code", "```", ""] }]);
    const text = await readFile(roadmapFile(root), "utf8");
    await writeFile(roadmapFile(root), text.slice(0, text.indexOf("#### Change History")), "utf8");

    const updated = await mcp<{ written: boolean }>(root, "update_roadmap_item", { item: "RM-1", description: "Rewritten." });
    expect(updated.ok, JSON.stringify(updated.error)).toBe(true);
    const after = await document(root);
    expect(after.slice(after.indexOf("#### Description"))).toMatch(/^#### Description\n\nRewritten\.\n/);
    expect(after).not.toContain("```");
    const shown = await mcp<{ item: SectionView }>(root, "get_roadmap_item", { item: "RM-1", asOf: AS_OF });
    expect(shown.value!.item.description).toBe("Rewritten.");
  });

  it("@req FR-NODE-268 AC-1: indented code that add_roadmap_item wrote comes back as written", async () => {
    const description = "Run the build first.\n\n    npm run build\n\nThen read the plan.";
    const features = "- Builds the plan:\n\n          npm run build\n\n- Reads the plan";
    const root = await roadmapWorkspace(null);
    const added = await mcp<{ id: string }>(root, "add_roadmap_item", { kind: "feature", title: "Indented", description, features, reason: "planned" });
    expect(added.ok, JSON.stringify(added.error)).toBe(true);

    const shown = await mcp<{ item: SectionView }>(root, "get_roadmap_item", { item: added.value!.id, asOf: AS_OF });
    expect(picked(shown.value!.item)).toEqual({ description, features });
  });

  it("@req FR-NODE-268 AC-1: an HTML comment block written in a section by hand comes back as written", async () => {
    const description = "Before.\n\n<!--\nreviewer note\n-->\n\nAfter.";
    const root = await roadmapWorkspace([{ n: 1, title: "Commented", sections: ["#### Description", "", ...description.split("\n"), ""] }]);

    const shown = await mcp<{ item: SectionView }>(root, "get_roadmap_item", { item: "RM-1", asOf: AS_OF });
    expect(shown.value!.item.description).toBe(description);
  });

  it("@req FR-NODE-268 AC-1: replacing a last section that ends in indented code or a comment block leaves none of its old lines", async () => {
    for (const tail of [["    old code"], ["<!--", "old note", "-->"]]) {
      const root = await roadmapWorkspace([{ n: 1, title: "Tail", sections: ["#### Description", "", "Before.", "", ...tail, ""] }]);
      const text = await readFile(roadmapFile(root), "utf8");
      await writeFile(roadmapFile(root), text.slice(0, text.indexOf("#### Change History")), "utf8");

      const updated = await mcp<{ written: boolean }>(root, "update_roadmap_item", { item: "RM-1", description: "Rewritten." });
      expect(updated.ok, JSON.stringify(updated.error)).toBe(true);
      const after = await document(root);
      expect(after.slice(after.indexOf("#### Description")), tail.join("|")).toMatch(/^#### Description\n\nRewritten\.\n/);
      expect(after, tail.join("|")).not.toMatch(/old code|old note/);
    }
  });

  it("@req FR-NODE-268 AC-3: an update to an item holding a fence that never closes writes nothing and names the fence line", async () => {
    // Hand-made: the fence hides the rest of the document, RM-2's heading included, so where RM-1 ends
    // is unknown; a write would have to guess, and a wrong guess deletes the hidden items.
    const root = await roadmapWorkspace([
      { n: 1, title: "Open fence", sections: ["#### Description", "", "Before.", "", "```", "code", ""] },
      { n: 2, title: "Next item", sections: ["#### Description", "", "Second.", ""] }
    ]);
    const before = await document(root);
    const fenceLine = before.split("\n").indexOf("```") + 1;

    const updated = await mcp<{ written: boolean }>(root, "update_roadmap_item", { item: "RM-1", description: "Rewritten." });
    expect(updated.ok).toBe(false);
    expect(updated.error?.message).toContain(`docs/roadmap.md line ${fenceLine} opens a code fence that never closes`);
    expect(await document(root)).toBe(before);
  });

  it("@req FR-NODE-268 AC-1: MCP get_roadmap_item returns them too", async () => {
    const root = await workspace();
    const shown = await mcp<{ item: SectionView }>(root, "get_roadmap_item", { item: "RM-1", asOf: AS_OF });

    expect(shown.ok, JSON.stringify(shown.error)).toBe(true);
    expect(picked(shown.value!.item)).toEqual({ description: DESCRIPTION, features: FEATURES });
  });
});

describe("FR-NODE-268 AC-2 — add writes Description and Features", () => {
  it("@req FR-NODE-268 AC-2: roadmap add --description --features writes both sections and roadmap check passes", async () => {
    const root = await roadmapWorkspace(null);
    const added = await cliJson<{ ok: boolean; value?: { id: string; written: boolean } }>(
      root,
      "add",
      "--kind",
      "feature",
      "--title",
      "New feature",
      "--description",
      DESCRIPTION,
      "--features",
      FEATURES,
      "--reason",
      "planned"
    );

    expect(added.code, added.stdout).toBe(0);
    expect(added.json.value).toMatchObject({ id: "RM-1", written: true });
    const text = await document(root);
    expect(text).toContain(`#### Description\n\n${DESCRIPTION}\n`);
    expect(text).toContain(`#### Features\n\n${FEATURES}\n`);
    const shown = await cliJson<{ item: SectionView }>(root, "show", "RM-1", "--as-of", AS_OF);
    expect(picked(shown.json.item)).toEqual({ description: DESCRIPTION, features: FEATURES });
    const check = await cli(root, "check", "--json");
    expect(check.code, check.stdout).toBe(0);
    expect(JSON.parse(check.stdout)).toMatchObject({ passed: true, diagnostics: [] });
  });

  it("@req FR-NODE-268 AC-2: MCP add_roadmap_item takes description and features", async () => {
    const root = await workspace();
    const added = await mcp<{ id: string; written: boolean }>(root, "add_roadmap_item", {
      kind: "feature",
      title: "From MCP",
      description: DESCRIPTION,
      features: FEATURES,
      reason: "planned"
    });

    expect(added.ok, JSON.stringify(added.error)).toBe(true);
    expect(added.value).toMatchObject({ id: "RM-4", written: true });
    const shown = await mcp<{ item: SectionView }>(root, "get_roadmap_item", { item: "RM-4", asOf: AS_OF });
    expect(picked(shown.value!.item)).toEqual({ description: DESCRIPTION, features: FEATURES });
    const check = await mcp<{ passed: boolean }>(root, "check_roadmap", {});
    expect(check.value?.passed).toBe(true);
  });
});

describe("FR-NODE-268 AC-3 — update replaces only that section's text and records it", () => {
  it("@req FR-NODE-268 AC-3: roadmap update --description replaces only the Description text and appends one history row naming it", async () => {
    const root = await workspace();
    const before = await document(root);
    const rowsBefore = historyRows(before, "RM-1");

    const updated = await cliJson<{ ok: boolean; value?: { written: boolean } }>(root, "update", "RM-1", "--description", "Rewritten.");

    expect(updated.code, updated.stdout).toBe(0);
    expect(updated.json.value?.written).toBe(true);
    const after = await document(root);
    const rowsAfter = historyRows(after, "RM-1");
    expect(rowsAfter.slice(0, rowsBefore.length)).toEqual(rowsBefore);
    expect(rowsAfter).toHaveLength(rowsBefore.length + 1);
    expect(rowsAfter.at(-1)).toMatch(/^\| \d{4}-\d{2}-\d{2} \| Description \|/);
    // Everything but the Description text and the new row is byte-for-byte what it was.
    expect(after.replace(`${rowsAfter.at(-1)}\n`, "")).toBe(before.replace(`#### Description\n\n${DESCRIPTION}\n`, "#### Description\n\nRewritten.\n"));
  });

  it("@req FR-NODE-268 AC-3: MCP update_roadmap_item changes both sections with one history row each", async () => {
    const root = await workspace();
    const before = await document(root);

    const updated = await mcp<{ written: boolean }>(root, "update_roadmap_item", { item: "RM-2", description: "Now described.", features: "- One feature" });

    expect(updated.ok, JSON.stringify(updated.error)).toBe(true);
    const after = await document(root);
    const added = historyRows(after, "RM-2").slice(historyRows(before, "RM-2").length);
    expect(added.map((row) => row.split("|")[2]!.trim())).toEqual(["Description", "Features"]);
    const shown = await mcp<{ item: SectionView }>(root, "get_roadmap_item", { item: "RM-2", asOf: AS_OF });
    expect(picked(shown.value!.item)).toEqual({ description: "Now described.", features: "- One feature" });
    // RM-1 and RM-3 are untouched.
    expect(after.slice(0, after.indexOf("### RM-2 — "))).toBe(before.slice(0, before.indexOf("### RM-2 — ")));
    expect(after.slice(after.indexOf("### RM-3 — "))).toBe(before.slice(before.indexOf("### RM-3 — ")));
  });

  it("@req FR-NODE-268 AC-3: an item without the section gets it, before Change History, and roadmap check still passes", async () => {
    const root = await workspace();

    const updated = await cliJson<{ ok: boolean }>(root, "update", "RM-3", "--features", FEATURES, "--description", DESCRIPTION);

    expect(updated.code, updated.stdout).toBe(0);
    const after = await document(root);
    const block = after.slice(after.indexOf("### RM-3 — "));
    expect(block).toContain(`#### Purpose\n\nPurpose of item 3.\n\n#### Description\n\n${DESCRIPTION}\n\n#### Features\n\n${FEATURES}\n\n#### Change History\n`);
    expect(historyRows(after, "RM-3").map((row) => row.split("|")[2]!.trim())).toEqual(["Created", "Description", "Features"]);
    const check = await cli(root, "check", "--json");
    expect(check.code, check.stdout).toBe(0);
  });

  it("@req FR-NODE-268 AC-3: an unchanged section value is a no-op", async () => {
    const root = await workspace();
    const before = await document(root);
    const updated = await cliJson<{ ok: boolean; value?: { written: boolean; changes: unknown[] } }>(root, "update", "RM-1", "--features", FEATURES);
    expect(updated.json.value).toMatchObject({ written: false, changes: [] });
    expect(await document(root)).toBe(before);
  });
});
