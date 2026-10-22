import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { findAgentInstructionBlock, upsertAgentInstruction } from "../../../src/core/bootstrap/init-project.js";
import { AGENT_INSTRUCTION_END_MARKER, renderAgentInstructionSnippet } from "../../../src/core/bootstrap/templates.js";
import { removeProject } from "../../../src/core/bootstrap/remove-project.js";
import { diagnoseHealth } from "../../../src/core/health/doctor.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

// @req FR-NODE-226 — an editor that saves with a byte order mark puts U+FEFF before the block heading.

const BOM = String.fromCharCode(0xfeff);

function countBlocks(text: string): number {
  return text.split(AGENT_INSTRUCTION_END_MARKER).length - 1;
}

function outdated(): string {
  const current = renderAgentInstructionSnippet();
  const firstBodyLine = current.split("\n").find((line, index) => index > 2 && line.trim() !== "");
  if (!firstBodyLine) throw new Error("snippet has no body line");
  return current.replace(firstBodyLine, `${firstBodyLine} (an older wording)`);
}

function output() {
  return { created: [] as string[], skipped: [] as string[], updated: [] as string[], removed: [] as string[], warnings: [] as string[] };
}

describe("FR-NODE-226 the managed block in a file that starts with a UTF-8 BOM", () => {
  let root: string;
  beforeEach(async () => {
    root = await copyFixtureWorkspace("valid-basic");
  });

  it("FR-NODE-226 AC-1: the finder returns the block, starting after the byte order mark", () => {
    const content = `${BOM}${renderAgentInstructionSnippet()}\n\n# Project notes\n`;
    const block = findAgentInstructionBlock(content);
    expect(block).toBeDefined();
    expect(block?.start).toBe(1);
    expect(block?.hasEndMarker).toBe(true);
  });

  it("FR-NODE-226 AC-2: the upsert replaces an outdated block in place, one block remains and the BOM stays", async () => {
    const filePath = path.join(root, "CLAUDE.md");
    await writeFile(filePath, `${BOM}${outdated()}\n\n# Project notes\n\nkeep me\n`, "utf8");

    await upsertAgentInstruction(root, "CLAUDE.md", output());

    const after = await readFile(filePath, "utf8");
    expect(after.startsWith(`${BOM}${renderAgentInstructionSnippet().split("\n")[0]}`)).toBe(true);
    expect(countBlocks(after)).toBe(1);
    expect(after).not.toContain("(an older wording)");
    expect(after).toContain("keep me");
  });

  it("FR-NODE-226 AC-3: doctor reports a current block in a BOM file as current, and the upsert leaves the file byte-identical", async () => {
    const current = `${BOM}${renderAgentInstructionSnippet()}\n`;
    for (const file of ["AGENTS.md", "CLAUDE.md"]) await writeFile(path.join(root, file), current, "utf8");

    const report = await diagnoseHealth(await parseWorkspace({ root }));
    expect(report.checks.find((check) => check.topic === "agent workflow block version currency")?.state).toBe("ok");

    const result = output();
    await upsertAgentInstruction(root, "CLAUDE.md", result);
    expect(await readFile(path.join(root, "CLAUDE.md"), "utf8")).toBe(current);
    expect(result.skipped).toEqual([path.join(root, "CLAUDE.md")]);
  });

  it("FR-NODE-226 AC-4: remove keeps the BOM and leaves no blank line where the block was", async () => {
    const filePath = path.join(root, "CLAUDE.md");
    await writeFile(filePath, `${BOM}${renderAgentInstructionSnippet()}\n\n# Project notes\n\nkeep me\n`, "utf8");
    const home = await mkdtemp(path.join(tmpdir(), "speckiwi-fr-node-226-home-"));

    const removed = await removeProject(await resolveProjectRoot(root), { apply: true, globalHomeDir: home, globalCodexHome: path.join(home, ".codex") });

    expect(removed.ok).toBe(true);
    expect(await readFile(filePath, "utf8")).toBe(`${BOM}# Project notes\n\nkeep me\n`);
  });

  it("FR-NODE-226 AC-5: a BOM file with the unversioned legacy heading has that block found and replaced in place", async () => {
    const filePath = path.join(root, "CLAUDE.md");
    await writeFile(filePath, `${BOM}# SpecKiwi SRS workflow\n\nold legacy body\n\n# Project notes\n\nkeep me\n`, "utf8");
    expect(findAgentInstructionBlock(await readFile(filePath, "utf8"))?.start).toBe(1);

    await upsertAgentInstruction(root, "CLAUDE.md", output());

    const after = await readFile(filePath, "utf8");
    expect(after.startsWith(`${BOM}${renderAgentInstructionSnippet().split("\n")[0]}`)).toBe(true);
    expect(countBlocks(after)).toBe(1);
    expect(after).not.toContain("old legacy body");
    expect(after).toContain("keep me");
  });
});
