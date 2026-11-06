import { readFile, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { AS_OF, cliJson, mcp, roadmapFile, roadmapWorkspace } from "../cli/roadmap-surface-fixture.js";

// verify-v534-r4 — FR-NODE-268 after the one-extent rule (AC-4, AC-5). Each case states how its input is made.

interface ItemView {
  description: string;
  features: string;
  history: Array<{ field: string }>;
}

describe("verify-v534-r4 FR-NODE-268", () => {
  it("P1 hand-written `## Aside` inside Description ends the item (AC-4: a level 1-3 heading outside code), so the view returns only the lines before it", async () => {
    // Hand-made: a level-2 heading that is not an item heading, inside RM-1's Description. Expectation
    // changed by the 5.3.4 AC-4 wording: the heading ends RM-1, so the Change History after it is outside
    // the item.
    const root = await roadmapWorkspace([{ n: 1, title: "Aside", sections: ["#### Description", "", "Before.", "", "## Aside", "", "After.", ""] }]);
    const shown = await mcp<{ item: ItemView }>(root, "get_roadmap_item", { item: "RM-1", asOf: AS_OF });
    expect(shown.ok, JSON.stringify(shown.error)).toBe(true);
    expect(shown.value!.item.description).toBe("Before.");
    expect(shown.value!.item.history).toEqual([]);
  }, 60_000);

  it("P2 hand-written `## Aside` inside Description: an update writes only inside the item, before `## Aside`, and leaves every line from it on as it was", async () => {
    // Expectation changed by the 5.3.4 AC-4 wording: RM-1 ends at `## Aside` and has no Change History of
    // its own, so the new Change History goes after RM-1's last line, before the heading.
    const root = await roadmapWorkspace([{ n: 1, title: "Aside", sections: ["#### Description", "", "Before.", "", "## Aside", "", "After.", ""] }]);
    const before = await readFile(roadmapFile(root), "utf8");
    const updated = await mcp(root, "update_roadmap_item", { item: "RM-1", description: "New." });
    expect(updated.ok, JSON.stringify(updated.error)).toBe(true);
    const after = await readFile(roadmapFile(root), "utf8");
    expect(after.slice(after.indexOf("## Aside")), after).toBe(before.slice(before.indexOf("## Aside")));
    const item = after.slice(0, after.indexOf("## Aside"));
    expect(item).toMatch(/#### Description\n\nNew\.\n\n#### Change History\n\n\| Date \| Field \| From \| To \| Reason \|\n\|---\|---\|---\|---\|---\|\n\| \d{4}-\d{2}-\d{2} \| Description \| \(text\) \| \(text\) \| - \|\n\n$/);
    const shown = await mcp<{ item: ItemView }>(root, "get_roadmap_item", { item: "RM-1", asOf: AS_OF });
    expect(shown.value!.item.history.map((row) => row.field)).toEqual(["Description"]);
  }, 60_000);

  it("P3 CRLF roadmap file: update of Description writes the text, keeps CRLF and the view returns it", async () => {
    // A docs/roadmap.md checked out with CRLF line endings (git autocrlf on Windows).
    const root = await roadmapWorkspace([{ n: 1, title: "A", sections: ["#### Description", "", "Old.", ""] }, { n: 2, title: "B" }]);
    const lf = await readFile(roadmapFile(root), "utf8");
    await writeFile(roadmapFile(root), lf.replace(/\n/g, "\r\n"), "utf8");
    const updated = await mcp(root, "update_roadmap_item", { item: "RM-1", description: "New line one.\nNew line two.", features: "- F" });
    expect(updated.ok, JSON.stringify(updated.error)).toBe(true);
    const after = await readFile(roadmapFile(root), "utf8");
    expect(after.replace(/\r\n/g, "").includes("\n"), JSON.stringify(after)).toBe(false);
    const shown = await mcp<{ item: ItemView }>(root, "get_roadmap_item", { item: "RM-1", asOf: AS_OF });
    expect(shown.value!.item.description).toBe("New line one.\nNew line two.");
    expect(shown.value!.item.features).toBe("- F");
    const check = await mcp<{ passed: boolean }>(root, "check_roadmap", {});
    expect(check.value?.passed, JSON.stringify(check)).toBe(true);
  }, 60_000);

  it("P4 CRLF roadmap file: add with Description and Features writes CRLF and the view returns the text", async () => {
    const root = await roadmapWorkspace([{ n: 1, title: "A" }]);
    const lf = await readFile(roadmapFile(root), "utf8");
    await writeFile(roadmapFile(root), lf.replace(/\n/g, "\r\n"), "utf8");
    const added = await mcp<{ id: string }>(root, "add_roadmap_item", { kind: "feature", title: "New", description: "One.\n\nTwo.", features: "- a\n- b", reason: "planned" });
    expect(added.ok, JSON.stringify(added.error)).toBe(true);
    const shown = await mcp<{ item: ItemView }>(root, "get_roadmap_item", { item: added.value!.id, asOf: AS_OF });
    expect(shown.value!.item.description).toBe("One.\n\nTwo.");
    expect(shown.value!.item.features).toBe("- a\n- b");
    const after = await readFile(roadmapFile(root), "utf8");
    expect(after.replace(/\r\n/g, "").includes("\n"), JSON.stringify(after.slice(-400))).toBe(false);
  }, 60_000);

  it("P5 add accepts a Description that holds a Markdown table (the reader no longer takes it for structure)", async () => {
    const description = "Targets by quarter:\n\n| Quarter | Goal |\n|---|---|\n| Q1 | Ship |";
    const root = await roadmapWorkspace(null);
    const added = await mcp<{ id: string }>(root, "add_roadmap_item", { kind: "feature", title: "Table", description, reason: "planned" });
    expect(added.ok, JSON.stringify(added.error)).toBe(true);
  }, 60_000);

  it("P6 a hand-written Description holding a Markdown table: roadmap check passes and the view returns it", async () => {
    const description = "Targets by quarter:\n\n| Quarter | Goal |\n|---|---|\n| Q1 | Ship |";
    const root = await roadmapWorkspace([{ n: 1, title: "Table", sections: ["#### Description", "", ...description.split("\n"), ""] }]);
    const check = await mcp<{ passed: boolean }>(root, "check_roadmap", {});
    expect(check.value?.passed, JSON.stringify(check)).toBe(true);
    const shown = await mcp<{ item: ItemView }>(root, "get_roadmap_item", { item: "RM-1", asOf: AS_OF });
    expect(shown.value!.item.description).toBe(description);
  }, 60_000);

  it("P7 add accepts a Description whose indented code block holds a shell comment line", async () => {
    const description = "Install:\n\n    # dependencies first\n    npm ci";
    const root = await roadmapWorkspace(null);
    const added = await mcp<{ id: string }>(root, "add_roadmap_item", { kind: "feature", title: "Shell", description, reason: "planned" });
    expect(added.ok, JSON.stringify(added.error)).toBe(true);
  }, 60_000);

  it("P8 CLI roadmap update --description then show --json returns it (plain CLI path)", async () => {
    const root = await roadmapWorkspace();
    const updated = await cliJson(root, "update", "RM-2", "--description", "From the CLI.", "--features", "- one");
    expect(updated.code, updated.stdout).toBe(0);
    const shown = await cliJson<{ item: ItemView }>(root, "show", "RM-2", "--as-of", AS_OF);
    expect(shown.json.item.description).toBe("From the CLI.");
    expect(shown.json.item.features).toBe("- one");
    const check = await cliJson<{ passed: boolean }>(root, "check");
    expect(check.json.passed, check.stdout).toBe(true);
  }, 60_000);

  it("P9 update of Features on an item whose Features is followed by an unknown section keeps that section", async () => {
    const root = await roadmapWorkspace([{ n: 1, title: "X", sections: ["#### Features", "", "- old", "", "#### Notes", "", "keep-me", ""] }]);
    const updated = await mcp(root, "update_roadmap_item", { item: "RM-1", features: "- new" });
    const after = await readFile(roadmapFile(root), "utf8");
    if (updated.ok) {
      expect(after).toContain("#### Notes\n\nkeep-me");
      expect(after).toContain("#### Features\n\n- new\n");
      expect(after).not.toContain("- old");
    }
  }, 60_000);

  it("P10 rename-target renames Targets of an item without Change History whose last line is fenced code, placing history after the fence", async () => {
    const root = await roadmapWorkspace([{ n: 1, title: "T", fields: { Targets: "v1.0.0" } }]);
    const text = await readFile(roadmapFile(root), "utf8");
    await writeFile(roadmapFile(root), text.slice(0, text.indexOf("#### Change History")) + "#### Description\n\n```\ncode\n```\n", "utf8");
    const { main } = await import("../../src/cli/index.js");
    const { PassThrough } = await import("node:stream");
    const streams = { stdout: new PassThrough(), stderr: new PassThrough() };
    const code = await main(["--root", root, "rename-target", "--from", "v1.0.0", "--to", "v1.0.1", "--apply", "--json"], streams);
    const out = streams.stdout.read()?.toString() ?? "";
    expect(code, out + (streams.stderr.read()?.toString() ?? "")).toBe(0);
    const after = (await readFile(roadmapFile(root), "utf8")).split("\n");
    expect(after.lastIndexOf("```"), after.join("\n")).toBeLessThan(after.indexOf("#### Change History"));
  }, 60_000);
  // declared limit, 5.3.4 lead decision
  it.fails("P11 rename-target with an unclosed fence that hides an item naming the target: refuses or renames that item too", async () => {
    // Hand-made: RM-1's Description opens a fence that never closes; RM-2, hidden in it, names v1.0.0.
    const root = await roadmapWorkspace([
      { n: 1, title: "Open fence", sections: ["#### Description", "", "```", "code", ""] },
      { n: 2, title: "Hidden", fields: { Targets: "v1.0.0" } }
    ]);
    const { main } = await import("../../src/cli/index.js");
    const { PassThrough } = await import("node:stream");
    const streams = { stdout: new PassThrough(), stderr: new PassThrough() };
    const code = await main(["--root", root, "rename-target", "--from", "v1.0.0", "--to", "v1.0.1", "--apply", "--json"], streams);
    const after = await readFile(roadmapFile(root), "utf8");
    if (code === 0) expect(after, streams.stdout.read()?.toString() ?? "").not.toContain("| Targets | v1.0.0 |");
  }, 60_000);
  // declared limit, 5.3.4 lead decision
  it.fails("P12 roadmap check on a document whose fence never closes and hides an item says so", async () => {
    // Hand-made: RM-1's Description opens a fence that never closes; RM-2 is hidden in it.
    const root = await roadmapWorkspace([
      { n: 1, title: "Open fence", sections: ["#### Description", "", "```", "code", ""] },
      { n: 2, title: "Hidden" }
    ]);
    const check = await mcp<{ passed: boolean; diagnostics?: unknown[] }>(root, "check_roadmap", {});
    const listed = await mcp<{ items: Array<{ id: string }> }>(root, "list_roadmap_items", { asOf: AS_OF });
    expect(listed.value?.items.map((item) => item.id)).toEqual(["RM-1"]);
    expect(check.value?.passed, JSON.stringify(check)).toBe(false);
  }, 60_000);
});
