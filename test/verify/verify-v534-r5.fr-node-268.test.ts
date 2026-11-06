import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { AS_OF, cliJson, mcp, roadmapFile, roadmapWorkspace } from "../cli/roadmap-surface-fixture.js";

// verify-v534-r5 — FR-NODE-268 AC-5: which Description and Features values add and update refuse, and
// whether an accepted value comes back as given with roadmap check passing. Each case states how its
// input is made.

interface ItemView {
  description: string;
  features: string;
}

async function shown(root: string, id: string): Promise<ItemView> {
  const answer = await mcp<{ item: ItemView }>(root, "get_roadmap_item", { item: id, asOf: AS_OF });
  expect(answer.ok, JSON.stringify(answer.error)).toBe(true);
  return answer.value!.item;
}

async function passes(root: string): Promise<void> {
  const check = await mcp<{ passed: boolean }>(root, "check_roadmap", {});
  expect(check.value?.passed, JSON.stringify(check)).toBe(true);
}

/** Adds an item with the value, then expects it accepted, returned as given, and roadmap check passing. */
async function acceptsOnAdd(description: string, features = "- F") {
  const root = await roadmapWorkspace([{ n: 1, title: "A" }]);
  const added = await mcp<{ id: string }>(root, "add_roadmap_item", { kind: "feature", title: "New", description, features, reason: "planned" });
  expect(added.ok, JSON.stringify(added.error)).toBe(true);
  const view = await shown(root, added.value!.id);
  expect(view.description).toBe(description);
  expect(view.features).toBe(features);
  await passes(root);
}

describe("verify-v534-r5 FR-NODE-268 AC-5", () => {
  // ---- refusals AC-5 requires ----
  it.each([
    ["item heading", "Text.\n### RM-9 — Smuggled"],
    ["level 2 heading", "Text.\n## Notes"],
    ["level 1 heading", "# Title\nText."],
    ["section heading", "Text.\n#### Notes"],
    ["heading after an unclosed comment opener", "<!-- note\n### RM-9 — x"],
    ["unclosed fence", "Text.\n```\ncode"],
    ["stray closing fence only", "Text.\n```"],
    ["fence closed only by a tab-trailed fence", "```\ncode\n```\t"]
  ])("R refuses a value holding a %s and writes nothing", async (_label, value) => {
    const root = await roadmapWorkspace([{ n: 1, title: "A" }]);
    const before = await readFile(roadmapFile(root), "utf8");
    const updated = await mcp(root, "update_roadmap_item", { item: "RM-1", description: value });
    expect(updated.ok).toBe(false);
    expect(await readFile(roadmapFile(root), "utf8")).toBe(before);
  }, 60_000);

  // ---- plain values AC-5 accepts ----
  it.each([
    ["a table", "Intro.\n\n| A | B |\n|---|---|\n| 1 | 2 |"],
    ["indented code holding a heading", "Intro.\n\n    ### RM-9 — not a heading\n    #### also code"],
    ["a closed fence holding headings", "Intro.\n\n```md\n# Title\n### RM-9 — x\n#### Sub\n```\n\nAfter."],
    ["a closed comment holding a heading", "Intro.\n\n<!--\n### RM-9 — hidden\n-->\n\nAfter."],
    ["a block-quoted heading", "> ## Note\n> quoted"],
    ["a list item heading", "- ### step one\n- two"],
    ["a fence in a list item", "- step\n\n  ```sh\n  npm test\n  ```\n- next"],
    ["a setext heading", "Title\n=====\n\nBody."],
    ["a hard line break (trailing spaces)", "line one  \nline two"],
    ["tab-indented code", "Intro.\n\n\tcode();"],
    ["a mermaid fence with arrows", "```mermaid\ngraph TD\n  A --> B\n```"]
  ])("A add accepts %s and returns it as given with roadmap check passing", async (_label, value) => {
    await acceptsOnAdd(value);
  }, 60_000);

  it("A2 CLI roadmap update --features with a closed fence: show --json returns it as given", async () => {
    const root = await roadmapWorkspace([{ n: 1, title: "A" }]);
    const features = "- one\n\n```\n#### not a section\n```";
    const updated = await cliJson<{ ok?: boolean }>(root, "update", "RM-1", "--features", features);
    expect(updated.code, updated.stdout).toBe(0);
    const view = await cliJson<{ item: ItemView }>(root, "show", "RM-1", "--as-of", AS_OF);
    expect(view.json.item.features).toBe(features);
    await passes(root);
  }, 60_000);

  // ---- an accepted comment opener that the document closes later ----
  it("C1 an unclosed `<!--` accepted in RM-1's Description is closed by an arrow `-->` in RM-2's mermaid fence: RM-2 must stay visible", async () => {
    // Made by two ordinary tool writes: RM-2 Features holds a closed mermaid fence (`A --> B`), then
    // RM-1's Description is set to a draft note that opens a comment (`<!-- TODO: ...`). AC-5 lets both through.
    const root = await roadmapWorkspace([{ n: 1, title: "A" }, { n: 2, title: "B" }]);
    const mermaid = "```mermaid\ngraph TD\n  A --> B\n```";
    const first = await mcp(root, "update_roadmap_item", { item: "RM-2", features: mermaid });
    expect(first.ok, JSON.stringify(first.error)).toBe(true);
    const second = await mcp(root, "update_roadmap_item", { item: "RM-1", description: "<!-- TODO: expand this" });
    // Either refuse it, or keep the document readable: RM-1 and RM-2 both come back as written.
    if (!second.ok) return;
    const rm2 = await mcp(root, "get_roadmap_item", { item: "RM-2", asOf: AS_OF });
    expect(rm2.ok, JSON.stringify(rm2.error)).toBe(true);
    expect((await shown(root, "RM-1")).description).toBe("<!-- TODO: expand this");
    expect((await shown(root, "RM-2")).features).toBe(mermaid);
    await passes(root);
  }, 60_000);

  it("C2 one update giving Description `<!-- draft` and Features `done -->`: both values come back as given", async () => {
    // Hand-made pair: each value alone passes AC-5; together the comment spans the Features heading.
    const root = await roadmapWorkspace([{ n: 1, title: "A" }]);
    const updated = await mcp(root, "update_roadmap_item", { item: "RM-1", description: "<!-- draft", features: "done -->" });
    if (!updated.ok) return;
    const view = await shown(root, "RM-1");
    expect(view).toMatchObject({ description: "<!-- draft", features: "done -->" });
    await passes(root);
  }, 60_000);

  // ---- a value accepted by AC-5 that roadmap check then rejects ----
  it("D1 add refuses a Features checklist whose items read `- [ ] AC-1 ...` with ROADMAP-E017 and writes nothing", async () => {
    // Plain Markdown task list. Expectation changed by the 5.3.4 AC-5 wording: a value that roadmap check
    // rejects on its own rules (ROADMAP-E017, criteria belong to requirements) stays refused.
    const root = await roadmapWorkspace([{ n: 1, title: "A" }]);
    const before = await readFile(roadmapFile(root), "utf8");
    const added = await mcp(root, "add_roadmap_item", { kind: "feature", title: "New", description: "Desc.", features: "- [ ] AC-1 export works\n- [ ] AC-2 import works", reason: "planned" });
    expect(added.ok).toBe(false);
    expect(added.error?.message).toContain("ROADMAP-E017");
    expect(await readFile(roadmapFile(root), "utf8")).toBe(before);
  }, 60_000);

  // ---- update of a value that was written with CRLF input ----
  // declared limit, 5.3.4 lead decision
  it.fails("E1 repeating an update with the same CRLF value is a no-op", async () => {
    // Hand-made: a caller passing Windows line endings in the value.
    const root = await roadmapWorkspace([{ n: 1, title: "A" }]);
    const first = await mcp(root, "update_roadmap_item", { item: "RM-1", description: "one\r\ntwo" });
    expect(first.ok, JSON.stringify(first.error)).toBe(true);
    const second = await mcp<{ changes: unknown[] }>(root, "update_roadmap_item", { item: "RM-1", description: "one\r\ntwo" });
    expect(second.ok, JSON.stringify(second.error)).toBe(true);
    const rows = (await readFile(roadmapFile(root), "utf8")).split(/\r?\n/).filter((line) => line.includes("| Description |"));
    expect(rows, rows.join("\n")).toHaveLength(1);
    expect(second.value!.changes).toEqual([]);
  }, 60_000);
});
