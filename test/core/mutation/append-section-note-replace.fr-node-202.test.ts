import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { appendSectionNote } from "../../../src/core/mutation/append-section-note.js";
import { sdkToolInputSchema } from "../../../src/mcp/server.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

const ARCH_FILE = path.join("docs", "spec", "10.product-architecture.srs.md");

async function readArch(rootPath: string): Promise<string> {
  return readFile(path.join(rootPath, ARCH_FILE), "utf8");
}

/**
 * Every line strictly between one `#### ` heading and the next block boundary, blank lines
 * included. AC-3 is about the lines a rewrite LEAVES BEHIND, so a helper that trimmed blanks
 * would hide exactly the defect the case exists to catch.
 */
function sectionBlock(file: string, heading: string): string[] {
  const lines = file.split(/\r?\n/);
  const start = lines.findIndex((line) => line === `#### ${heading}`);
  expect(start).toBeGreaterThan(-1);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith("#### ") || line.startsWith("### "));
  return end === -1 ? rest : rest.slice(0, end);
}

describe("FR-NODE-202 — a section rewrite is bounded by nothing smaller than the section it replaces", () => {
  it("AC-2 core: replace accepts text longer than the 500-unit append cap and lands it verbatim", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const root = await resolveProjectRoot(rootPath);
    const long = `REWRITE ${"y".repeat(1_200)} END`;

    const result = await appendSectionNote(root, {
      id: "FR-ARCH-001",
      section: "implementation_notes",
      text: long,
      mode: "replace"
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.written).toBe(true);
    expect(sectionBlock(await readArch(rootPath), "Implementation Notes")).toEqual(["", long, ""]);
  });

  it("AC-2 MCP: the tool's own input schema no longer caps text below what a section can hold", () => {
    const schema = sdkToolInputSchema("append_section_note");

    const replaceLong = schema.safeParse({
      id: "FR-ARCH-001",
      section: "implementation_notes",
      text: "z".repeat(700),
      mode: "replace"
    });

    expect(replaceLong.success).toBe(true);
  });

  it("AC-6 append keeps its 500-unit cap, which bounds one new note and is not the defect", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const root = await resolveProjectRoot(rootPath);

    const atLimit = await appendSectionNote(root, { id: "FR-ARCH-001", section: "rationale", text: "x".repeat(500) });
    expect(atLimit.ok).toBe(true);

    const overLimit = await appendSectionNote(root, { id: "FR-ARCH-001", section: "rationale", text: "x".repeat(501) });
    expect(overLimit.ok).toBe(false);
    if (!overLimit.ok) expect(overLimit.error.code).toBe("USAGE");
  });
});

describe("FR-NODE-202 — rewriting a section to fewer lines removes the surplus lines", () => {
  async function fiveNoteSection(): Promise<{ rootPath: string; root: Awaited<ReturnType<typeof resolveProjectRoot>> }> {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const root = await resolveProjectRoot(rootPath);
    for (const text of ["second note", "third note", "fourth note", "fifth note"]) {
      const appended = await appendSectionNote(root, { id: "FR-ARCH-001", section: "implementation_notes", text });
      expect(appended.ok).toBe(true);
    }
    expect(sectionBlock(await readArch(rootPath), "Implementation Notes").filter((line) => line !== "")).toHaveLength(5);
    return { rootPath, root };
  }

  it("AC-3 a five-line section rewritten to one line leaves one line, not one line and four blanks", async () => {
    const { rootPath, root } = await fiveNoteSection();

    const result = await appendSectionNote(root, {
      id: "FR-ARCH-001",
      section: "implementation_notes",
      text: "- the only surviving note",
      mode: "replace"
    });
    expect(result.ok).toBe(true);

    // Asserted as the whole block, not as the first line: a check that read the first line alone
    // would pass on the defect, which leaves that line right and four blank ones under it.
    expect(sectionBlock(await readArch(rootPath), "Implementation Notes")).toEqual(["", "- the only surviving note", ""]);
  });

  it("AC-3 the envelope reports the shrink as one range operation, so the lines it drops are countable", async () => {
    const { root } = await fiveNoteSection();

    const result = await appendSectionNote(root, {
      id: "FR-ARCH-001",
      section: "implementation_notes",
      text: "- the only surviving note",
      mode: "replace",
      dryRun: true
    });

    expect(result.ok).toBe(true);
    const operations = result.mutation?.operations ?? [];
    expect(operations).toHaveLength(1);
    const [operation] = operations;
    expect(operation?.type).toBe("replaceRange");
    expect(operation?.lineCount).toBe(1);
    expect((operation?.endLine ?? 0) - (operation?.startLine ?? 0) + 1).toBe(5);
  });

  it("AC-3 a multi-line rewrite lands one document line per text line", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const root = await resolveProjectRoot(rootPath);

    const result = await appendSectionNote(root, {
      id: "FR-ARCH-001",
      section: "implementation_notes",
      text: "- alpha\n- beta\n- gamma",
      mode: "replace"
    });

    expect(result.ok).toBe(true);
    expect(sectionBlock(await readArch(rootPath), "Implementation Notes")).toEqual(["", "- alpha", "- beta", "- gamma", ""]);
  });
});

describe("FR-NODE-202 — an unrecognised mode is refused rather than treated as the destructive one", () => {
  it("AC-7 a misspelt mode is refused with USAGE and the section is left byte-identical", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const root = await resolveProjectRoot(rootPath);
    const before = await readArch(rootPath);

    const result = await appendSectionNote(root, {
      id: "FR-ARCH-001",
      section: "implementation_notes",
      text: "should never be written",
      mode: "bogus" as never
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("USAGE");
    expect(await readArch(rootPath)).toBe(before);
  });

  it("AC-7 mode matching is exact, so a differently-cased 'Replace' does not reach the replace branch", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const root = await resolveProjectRoot(rootPath);
    const before = await readArch(rootPath);

    const result = await appendSectionNote(root, {
      id: "FR-ARCH-001",
      section: "implementation_notes",
      text: "should never be written",
      mode: "Replace" as never
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("USAGE");
    expect(await readArch(rootPath)).toBe(before);
  });
});
