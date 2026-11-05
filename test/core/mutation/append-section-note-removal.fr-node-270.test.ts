import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { appendSectionNote, type AppendSectionNoteInput } from "../../../src/core/mutation/append-section-note.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

// @req FR-NODE-270 — a section replace counts the items it removes, reports them, and refuses to
// remove one unconfirmed. These cases drive the core directly; the CLI and MCP surfaces have their
// own suites (test/cli/append-note-confirm.fr-node-270.test.ts, test/mcp/append-section-note-confirm.fr-node-270.test.ts).

const ARCH_FILE = path.join("docs", "spec", "10.product-architecture.srs.md");

type Heading = "Rationale" | "Research / Analysis" | "Implementation Notes";

async function readArch(rootPath: string): Promise<string> {
  return readFile(path.join(rootPath, ARCH_FILE), "utf8");
}

/**
 * Rewrites the body of one section of FR-ARCH-001 straight on disk, so a case can start from an
 * exact body — placeholders, trailing whitespace, continuation lines — that no mutation writes.
 * The body sits between one blank line under the heading and one blank line above the next heading,
 * as the tool lays it out; an empty `body` leaves the single blank line alone.
 */
async function setBody(rootPath: string, heading: Heading, body: readonly string[]): Promise<void> {
  const file = path.join(rootPath, ARCH_FILE);
  const lines = (await readFile(file, "utf8")).split("\n");
  const start = lines.indexOf(`#### ${heading}`);
  expect(start).toBeGreaterThan(-1);
  const next = lines.findIndex((line, index) => index > start && line.startsWith("#### "));
  expect(next).toBeGreaterThan(start);
  const replacement = body.length === 0 ? [""] : ["", ...body, ""];
  lines.splice(start + 1, next - start - 1, ...replacement);
  await writeFile(file, lines.join("\n"), "utf8");
}

async function workspace(): Promise<{ rootPath: string; root: Awaited<ReturnType<typeof resolveProjectRoot>> }> {
  const rootPath = await copyFixtureWorkspace("mutation-target");
  return { rootPath, root: await resolveProjectRoot(rootPath) };
}

function replace(text: string, extra: Partial<AppendSectionNoteInput> = {}): AppendSectionNoteInput {
  return { id: "FR-ARCH-001", section: "implementation_notes", text, mode: "replace", ...extra };
}

describe("FR-NODE-270 AC-1 — the removal count reads the body as items, never a placeholder or a blank", () => {
  // @req FR-NODE-270 AC-1
  it("a bullet starts an item, a column-zero line after a bullet belongs to it, a line after a blank starts one", async () => {
    const { rootPath, root } = await workspace();
    await setBody(rootPath, "Implementation Notes", [
      "- -",
      "- note a",
      "second line of a",
      "- note b",
      "",
      "a paragraph"
    ]);

    const result = await appendSectionNote(root, replace("fresh", { dryRun: true }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value?.removedItems).toBe(3);
    // The placeholder and the blank line sit inside the replaced range but are not item lines.
    expect(result.value?.removedLines).toEqual(["- note a", "second line of a", "- note b", "a paragraph"]);
  });

  // @req FR-NODE-270 AC-1
  it("a non-blank line at the very start of the body starts an item", async () => {
    const { rootPath, root } = await workspace();
    await setBody(rootPath, "Implementation Notes", ["plain prose", "more prose"]);

    const result = await appendSectionNote(root, replace("fresh", { dryRun: true }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value?.removedItems).toBe(1);
    expect(result.value?.removedLines).toEqual(["plain prose", "more prose"]);
  });

  // @req FR-NODE-270 AC-1
  it("both placeholders, `-` and `- -`, are compared after trimming trailing whitespace and are not items", async () => {
    const { rootPath, root } = await workspace();
    await setBody(rootPath, "Implementation Notes", ["-   ", "", "- -\t"]);

    const result = await appendSectionNote(root, replace("fresh", { dryRun: true }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value?.removedItems).toBe(0);
    expect(result.value?.removedLines).toEqual([]);
  });
});

describe("FR-NODE-270 AC-2 — an old item that reappears in the new text is not removed", () => {
  // @req FR-NODE-270 AC-2
  it("kept items are matched line by line after trimming trailing whitespace; the rest count as removed", async () => {
    const { rootPath, root } = await workspace();
    await setBody(rootPath, "Implementation Notes", ["- note a", "- note b", "- note c"]);

    const result = await appendSectionNote(root, replace("- note b   \n- brand new", { dryRun: true }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value?.removedItems).toBe(2);
    expect(result.value?.removedLines).toEqual(["- note a", "- note c"]);
  });

  // @req FR-NODE-270 AC-2
  it("one new item matches at most one old item", async () => {
    const { rootPath, root } = await workspace();
    await setBody(rootPath, "Implementation Notes", ["- dup", "- dup"]);

    const result = await appendSectionNote(root, replace("- dup", { dryRun: true }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value?.removedItems).toBe(1);
    expect(result.value?.removedLines).toEqual(["- dup"]);
  });

  // @req FR-NODE-270 AC-2
  it("an item matches only when every one of its lines matches", async () => {
    const { rootPath, root } = await workspace();
    await setBody(rootPath, "Implementation Notes", ["- note a", "its second line"]);

    const result = await appendSectionNote(root, replace("- note a", { dryRun: true }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value?.removedItems).toBe(1);
    expect(result.value?.removedLines).toEqual(["- note a", "its second line"]);
  });
});

describe("FR-NODE-270 AC-4 / AC-5 — removing an item needs the confirmation flag", () => {
  // @req FR-NODE-270 AC-4
  it("a replace that removes an item, written without confirmReplace, is refused with USAGE naming the flag and the count", async () => {
    const { rootPath, root } = await workspace();
    await setBody(rootPath, "Implementation Notes", ["- -", "- note a", "- note b"]);
    const before = await readArch(rootPath);

    const result = await appendSectionNote(root, replace("only one"));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error?.code).toBe("USAGE");
    expect(result.error?.message).toContain("--confirm-replace");
    expect(result.error?.message).toMatch(/\b2 items?\b/);
    expect(await readArch(rootPath)).toBe(before);
  });

  // @req FR-NODE-270 AC-5
  it("with confirmReplace the replace writes and reports what the dry run reported", async () => {
    const { rootPath, root } = await workspace();
    await setBody(rootPath, "Implementation Notes", ["- -", "- note a", "- note b"]);

    const dry = await appendSectionNote(root, replace("only one", { dryRun: true }));
    const written = await appendSectionNote(root, replace("only one", { confirmReplace: true }));

    expect(dry.ok && written.ok).toBe(true);
    if (!dry.ok || !written.ok) return;
    expect(written.value?.written).toBe(true);
    expect(written.value?.removedItems).toBe(dry.value?.removedItems);
    expect(written.value?.removedLines).toEqual(dry.value?.removedLines);
    expect(written.value?.removedItems).toBe(2);
    expect(await readArch(rootPath)).toContain("#### Implementation Notes\n\nonly one\n\n#### Change Notes");
  });
});

describe("FR-NODE-270 AC-6 — a replace that removes no item writes without the flag", () => {
  // @req FR-NODE-270 AC-6
  it("when the section heading is absent", async () => {
    const { rootPath, root } = await workspace();
    const file = path.join(rootPath, ARCH_FILE);
    const original = await readFile(file, "utf8");
    const withoutHeading = original.replace("#### Implementation Notes\n\n- src/core/mutation\n\n", "");
    expect(withoutHeading).not.toBe(original);
    await writeFile(file, withoutHeading, "utf8");

    const result = await appendSectionNote(root, replace("created body"));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value?.written).toBe(true);
    expect(result.value?.removedItems).toBe(0);
    expect(result.value?.removedLines).toEqual([]);
    expect(await readArch(rootPath)).toContain("#### Implementation Notes\n\ncreated body\n");
  });

  // @req FR-NODE-270 AC-6
  it("when the body holds only placeholder lines and blank lines", async () => {
    const { rootPath, root } = await workspace();
    await setBody(rootPath, "Rationale", ["-"]);

    const result = await appendSectionNote(root, { id: "FR-ARCH-001", section: "rationale", text: "new rationale", mode: "replace" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value?.written).toBe(true);
    expect(result.value?.removedItems).toBe(0);
    expect(result.value?.removedLines).toEqual([]);
  });

  // @req FR-NODE-270 AC-6
  it("when every old item reappears in the new text", async () => {
    const { root } = await workspace();

    const result = await appendSectionNote(root, replace("- src/core/mutation\n- an added note"));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value?.written).toBe(true);
    expect(result.value?.removedItems).toBe(0);
    expect(result.value?.removedLines).toEqual([]);
  });
});

describe("FR-NODE-270 AC-7 — an append removes nothing and refuses the confirmation flag", () => {
  // @req FR-NODE-270 AC-7
  it("an append reports removedItems 0 and an empty removedLines", async () => {
    const { root } = await workspace();

    const result = await appendSectionNote(root, { id: "FR-ARCH-001", section: "implementation_notes", text: "a note" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value?.removedItems).toBe(0);
    expect(result.value?.removedLines).toEqual([]);
  });

  // @req FR-NODE-270 AC-7
  it("an append with confirmReplace is refused with USAGE and writes nothing", async () => {
    const { rootPath, root } = await workspace();
    const before = await readArch(rootPath);

    const result = await appendSectionNote(root, {
      id: "FR-ARCH-001",
      section: "implementation_notes",
      text: "a note",
      confirmReplace: true
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error?.code).toBe("USAGE");
    expect(await readArch(rootPath)).toBe(before);
  });
});

describe("FR-NODE-270 AC-11 — replacing an empty section leaves the next heading in place", () => {
  // @req FR-NODE-270 AC-11
  it("a body of one blank line: the new text lands under the heading and every other line is byte-identical", async () => {
    const { rootPath, root } = await workspace();
    await setBody(rootPath, "Implementation Notes", []);
    const before = await readArch(rootPath);
    expect(before).toContain("#### Implementation Notes\n\n#### Change Notes");

    const result = await appendSectionNote(root, replace("new body"));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value?.written).toBe(true);
    expect(result.value?.removedItems).toBe(0);
    expect(result.value?.removedLines).toEqual([]);
    expect(await readArch(rootPath)).toBe(
      before.replace("#### Implementation Notes\n\n#### Change Notes", "#### Implementation Notes\n\nnew body\n\n#### Change Notes")
    );
  });

  // @req FR-NODE-270 AC-11
  it("a heading directly followed by the next heading keeps that next heading too", async () => {
    const { rootPath, root } = await workspace();
    const file = path.join(rootPath, ARCH_FILE);
    const original = await readFile(file, "utf8");
    const squeezed = original.replace("#### Implementation Notes\n\n- src/core/mutation\n\n#### Change Notes", "#### Implementation Notes\n#### Change Notes");
    expect(squeezed).not.toBe(original);
    await writeFile(file, squeezed, "utf8");

    const result = await appendSectionNote(root, replace("new body"));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value?.removedItems).toBe(0);
    const after = await readArch(rootPath);
    expect(after).toContain("#### Implementation Notes\n\nnew body\n\n#### Change Notes");
    // Every original line survives in order: dropping the inserted lines gives the original back.
    expect(after.replace("#### Implementation Notes\n\nnew body\n\n", "#### Implementation Notes\n")).toBe(squeezed);
  });
});
