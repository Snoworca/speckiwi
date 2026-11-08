import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import { appendSectionNote } from "../../../src/core/mutation/append-section-note.js";
import { updateRequirementFields } from "../../../src/core/mutation/edit-requirement.js";
import { setTargetGoal } from "../../../src/core/mutation/set-target-goal.js";
import { setSdsStatus } from "../../../src/core/mutation/set-sds-status.js";
import { assertPromotableBlock } from "../../../src/core/mutation/block-prose.js";
import { listSteps } from "../../../src/core/query/list-steps.js";
import { scanRequirementBlocks } from "../../../src/core/parser/block-scanner.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

// FR-NODE-260: a mutation decides where a section, a block or the Target Map starts and ends the way
// the parser does, through the shared document-line classifier. A heading-like line inside a fence or
// indented code is an example the author shows; it neither ends nor starts anything for the parser, so
// it must not for a mutation either. Each case first shows what the parser reads.

const ARCH = path.join("docs", "spec", "10.product-architecture.srs.md");
const INDEX = path.join("docs", "spec", "00.index.md");
const FENCE = "```";

async function fixture(): Promise<{ rootPath: string; root: Awaited<ReturnType<typeof resolveProjectRoot>> }> {
  const rootPath = await copyFixtureWorkspace("mutation-target");
  return { rootPath, root: await resolveProjectRoot(rootPath) };
}

async function rewrite(rootPath: string, rel: string, from: string, to: string): Promise<void> {
  const file = path.join(rootPath, rel);
  const text = await readFile(file, "utf8");
  if (!text.includes(from)) throw new Error(`fixture anchor missing: ${from}`);
  await writeFile(file, text.replace(from, to), "utf8");
}

/**
 * Puts the lines of `block` in the index just before its first `## ` section, in the index's own line
 * ending (the fixture index is CRLF), and returns them as written so a test can find them again.
 */
async function insertBeforeFirstSection(rootPath: string, block: readonly string[]): Promise<string> {
  const index = await readFile(path.join(rootPath, INDEX), "utf8");
  const eol = index.includes("\r\n") ? "\r\n" : "\n";
  const written = block.join(eol) + eol;
  const firstSection = index.indexOf("\n## ");
  await writeFile(path.join(rootPath, INDEX), `${index.slice(0, firstSection + 1)}${written}${index.slice(firstSection + 1)}`, "utf8");
  return written;
}

describe("FR-NODE-260 AC-1 — a fenced `#### ` line is body text of the section", () => {
  // @req FR-NODE-260 AC-1
  it("append_section_note appends after the section's last body line, past the fence", async () => {
    const { rootPath, root } = await fixture();
    await rewrite(
      rootPath,
      ARCH,
      "Mutation tests need a stable target.\n",
      ["Mutation tests need a stable target.", "", `${FENCE}md`, "#### Example heading", FENCE, "", "Tail line after the fence.", ""].join("\n")
    );
    const record = (await parseWorkspace(root)).records.find((r) => r.id === "FR-ARCH-001")!;
    expect(record.rationale).toContain("Tail line after the fence.");

    const result = await appendSectionNote(root, { id: "FR-ARCH-001", section: "rationale", text: "NOTE-260" });
    expect(result.ok).toBe(true);
    const lines = (await readFile(path.join(rootPath, ARCH), "utf8")).split("\n");
    const note = lines.findIndex((l) => l.includes("NOTE-260"));
    const tail = lines.findIndex((l) => l.includes("Tail line after the fence."));
    expect(note).toBeGreaterThan(tail);
    expect(lines.slice(tail + 1, note).every((l) => l.trim() === "")).toBe(true);
    const after = (await parseWorkspace(root)).records.find((r) => r.id === "FR-ARCH-001")!;
    expect(after.rationale).toContain("NOTE-260");
    expect(after.rationale).toContain("#### Example heading");
  });

  // @req FR-NODE-260 AC-1
  it("append_section_note --mode replace replaces the whole body, the fence included", async () => {
    const { rootPath, root } = await fixture();
    await rewrite(
      rootPath,
      ARCH,
      "Mutation tests need a stable target.\n",
      ["Mutation tests need a stable target.", "", FENCE, "#### Example heading", FENCE, "", "OLD-TAIL-RATIONALE", ""].join("\n")
    );
    const result = await appendSectionNote(root, { id: "FR-ARCH-001", section: "rationale", text: "NEW RATIONALE", mode: "replace", confirmReplace: true });
    expect(result.ok).toBe(true);
    const text = await readFile(path.join(rootPath, ARCH), "utf8");
    expect(text).not.toContain("OLD-TAIL-RATIONALE");
    expect(text).not.toContain("#### Example heading");
    const after = (await parseWorkspace(root)).records.find((r) => r.id === "FR-ARCH-001")!;
    expect(after.rationale).toBe("NEW RATIONALE");
  });

  // @req FR-NODE-260 AC-1
  it("edit-requirement --statement replaces the whole Requirement statement, the fence included", async () => {
    const { rootPath, root } = await fixture();
    await rewrite(
      rootPath,
      ARCH,
      "SpecKiwi must mutate this fixture requirement.\n",
      ["SpecKiwi must mutate this fixture requirement.", "", FENCE, "#### Example heading", FENCE, "", "OLD-TAIL-STATEMENT", ""].join("\n")
    );
    expect((await parseWorkspace(root)).records.find((r) => r.id === "FR-ARCH-001")!.requirement).toContain("OLD-TAIL-STATEMENT");

    const result = await updateRequirementFields(root, { id: "FR-ARCH-001", statement: "NEW STATEMENT" });
    expect(result.ok).toBe(true);
    const text = await readFile(path.join(rootPath, ARCH), "utf8");
    expect(text).not.toContain("OLD-TAIL-STATEMENT");
    expect(text).not.toContain(FENCE);
    const after = (await parseWorkspace(root)).records.find((r) => r.id === "FR-ARCH-001")!;
    expect(after.requirement).toBe("NEW STATEMENT");
    expect(after.rationale).toBe("Mutation tests need a stable target.");
  });
});

describe("FR-NODE-260 AC-2 — the index and design.md are read as the parser reads them", () => {
  // @req FR-NODE-260 AC-2
  it("set-target-goal records the goal for the real Target Map when a fenced copy of the heading precedes it", async () => {
    const { rootPath, root } = await fixture();
    const index = await readFile(path.join(rootPath, INDEX), "utf8");
    const heading = /^## \d+\. Target Map$/m.exec(index)![0];
    const decoy = await insertBeforeFirstSection(rootPath, [FENCE, heading, "", "| Target | Type | Status | Description |", "| --- | --- | --- | --- |", "| decoy | release | planned | example |", FENCE, ""]);
    const parsed = await parseWorkspace(root);
    expect(parsed.index.targets.map((t) => t.target)).toContain("v1.0.0");
    expect(parsed.index.targets.map((t) => t.target)).not.toContain("decoy");

    const result = await setTargetGoal(root, { target: "v1.0.0", goal: "GOAL-260" });
    expect(result.ok, JSON.stringify(result.ok ? "" : result.error)).toBe(true);
    expect(await readFile(path.join(rootPath, INDEX), "utf8")).toContain(decoy);
    expect((await parseWorkspace(root)).index.targetGoals["v1.0.0"]).toBe("GOAL-260");
  });

  // @req FR-NODE-260 AC-2
  it("set-target-goal does not take an indented-code copy of the heading for the Target Map", async () => {
    const { rootPath, root } = await fixture();
    const index = await readFile(path.join(rootPath, INDEX), "utf8");
    const heading = /^## \d+\. Target Map$/m.exec(index)![0];
    const decoy = await insertBeforeFirstSection(rootPath, ["Example of the heading:", "", `    ${heading}`, "", "    | Target | Type | Status | Description |", "    | --- | --- | --- | --- |", "    | decoy | release | planned | example |", ""]);

    const result = await setTargetGoal(root, { target: "v1.0.0", goal: "GOAL-260-INDENT" });
    expect(result.ok, JSON.stringify(result.ok ? "" : result.error)).toBe(true);
    expect(await readFile(path.join(rootPath, INDEX), "utf8")).toContain(decoy);
    expect((await parseWorkspace(root)).index.targetGoals["v1.0.0"]).toBe("GOAL-260-INDENT");
  });

  // @req FR-NODE-260 AC-2
  it("set-target-goal leaves a fenced `### Target:` goal block byte-identical and writes the real one", async () => {
    const { rootPath, root } = await fixture();
    const decoy = await insertBeforeFirstSection(rootPath, [FENCE, "### Target: v1.0.0", "", "**Goal:** DECOY-GOAL", FENCE, ""]);

    const result = await setTargetGoal(root, { target: "v1.0.0", goal: "GOAL-260-BLOCK" });
    expect(result.ok, JSON.stringify(result.ok ? "" : result.error)).toBe(true);
    const after = await readFile(path.join(rootPath, INDEX), "utf8");
    expect(after).toContain(decoy);
    expect(after).toContain("**Goal:** GOAL-260-BLOCK");
    expect((await parseWorkspace(root)).index.targetGoals["v1.0.0"]).toBe("GOAL-260-BLOCK");
  });

  for (const spelling of ["###  Target: v1.1.0", "###\tTarget: v1.1.0"]) {
    // @req FR-NODE-260 AC-2
    it(`set-target-goal records the goal the parser reads when the index holds ${JSON.stringify(spelling)}`, async () => {
      const { rootPath, root } = await fixture();
      const file = path.join(rootPath, INDEX);
      const text = await readFile(file, "utf8");
      const eol = text.includes("\r\n") ? "\r\n" : "\n";
      await writeFile(file, `${text}${eol}${spelling}${eol}`, "utf8");
      // The parser does not read this spelling as a target heading, so it carries no goal for v1.1.0.
      expect((await parseWorkspace(root)).index.targetGoals["v1.1.0"]).toBeUndefined();

      const result = await setTargetGoal(root, { target: "v1.1.0", goal: "GOAL-260-SPELLING" });
      expect(result.ok, JSON.stringify(result.ok ? "" : result.error)).toBe(true);
      expect((await parseWorkspace(root)).index.targetGoals["v1.1.0"]).toBe("GOAL-260-SPELLING");
    });
  }

  // @req FR-NODE-260 AC-2
  it("set-target-goal ends a target's goal block where the parser does, so a later `### Target:` keeps its own goal", async () => {
    const { rootPath, root } = await fixture();
    const file = path.join(rootPath, INDEX);
    const text = await readFile(file, "utf8");
    const eol = text.includes("\r\n") ? "\r\n" : "\n";
    // `####` is no boundary for the parser's goal block; `###\t` is (it is a level-3 heading line).
    await writeFile(file, `${text}${eol}### Target: v1.1.0${eol}${eol}###\tNotes${eol}${eol}**Goal:** NOT-V110${eol}`, "utf8");
    expect((await parseWorkspace(root)).index.targetGoals["v1.1.0"]).toBeUndefined();

    const result = await setTargetGoal(root, { target: "v1.1.0", goal: "GOAL-260-END" });
    expect(result.ok, JSON.stringify(result.ok ? "" : result.error)).toBe(true);
    const after = await readFile(file, "utf8");
    expect(after).toContain("**Goal:** NOT-V110");
    expect((await parseWorkspace(root)).index.targetGoals["v1.1.0"]).toBe("GOAL-260-END");
  });

  /** Appends `block` to the end of the index in its own line ending. */
  async function appendToIndex(rootPath: string, block: readonly string[]): Promise<void> {
    const file = path.join(rootPath, INDEX);
    const text = await readFile(file, "utf8");
    const eol = text.includes("\r\n") ? "\r\n" : "\n";
    await writeFile(file, `${text}${eol}${block.join(eol)}${eol}`, "utf8");
  }

  // @req FR-NODE-260 AC-2
  it("the parser reads no goal from a fenced `### Target:` example after the Target Map, so it returns the goal set-target-goal writes", async () => {
    const { rootPath, root } = await fixture();
    await appendToIndex(rootPath, ["## 9. Goal Format Example", "", `${FENCE}md`, "### Target: v1.1.0", "", "**Goal:** example goal", FENCE]);
    expect((await parseWorkspace(root)).index.targetGoals["v1.1.0"]).toBeUndefined();

    const result = await setTargetGoal(root, { target: "v1.1.0", goal: "GOAL-260-FENCED-EXAMPLE" });
    expect(result.ok, JSON.stringify(result.ok ? "" : result.error)).toBe(true);
    expect((await parseWorkspace(root)).index.targetGoals["v1.1.0"]).toBe("GOAL-260-FENCED-EXAMPLE");
  });

  // @req FR-NODE-260 AC-2
  it("the parser reads no goal from a `### Target:` block inside an HTML comment, so it returns the goal set-target-goal writes", async () => {
    const { rootPath, root } = await fixture();
    await appendToIndex(rootPath, ["<!--", "### Target: v1.1.0", "", "**Goal:** commented goal", "-->"]);
    expect((await parseWorkspace(root)).index.targetGoals["v1.1.0"]).toBeUndefined();

    const result = await setTargetGoal(root, { target: "v1.1.0", goal: "GOAL-260-COMMENT" });
    expect(result.ok, JSON.stringify(result.ok ? "" : result.error)).toBe(true);
    expect((await parseWorkspace(root)).index.targetGoals["v1.1.0"]).toBe("GOAL-260-COMMENT");
  });

  // @req FR-NODE-260 AC-2
  it("a fenced `## ` line inside a goal block ends the block neither for the parser nor for set-target-goal", async () => {
    const { rootPath, root } = await fixture();
    await appendToIndex(rootPath, ["## 9. Target Goals", "", "### Target: v1.1.0", "", `${FENCE}md`, "## shown heading", FENCE, "", "**Goal:** old goal"]);
    expect((await parseWorkspace(root)).index.targetGoals["v1.1.0"]).toBe("old goal");

    const result = await setTargetGoal(root, { target: "v1.1.0", goal: "GOAL-260-FENCED-END" });
    expect(result.ok, JSON.stringify(result.ok ? "" : result.error)).toBe(true);
    const after = await readFile(path.join(rootPath, INDEX), "utf8");
    expect(after).toContain("## shown heading");
    expect((await parseWorkspace(root)).index.targetGoals["v1.1.0"]).toBe("GOAL-260-FENCED-END");
  });

  // @req FR-NODE-260 AC-2
  it("the parser leaves fenced lines after a Goal line out of the goal text", async () => {
    const { rootPath, root } = await fixture();
    await appendToIndex(rootPath, ["### Target: v1.1.0", "", "**Goal:** fenced tail", "", FENCE, "shown code", FENCE]);
    expect((await parseWorkspace(root)).index.targetGoals["v1.1.0"]).toBe("fenced tail");
  });

  // @req FR-NODE-260 AC-2
  it("list_steps reads the Status row set-sds-status wrote below a fenced `## ` line", async () => {
    const { rootPath, root } = await fixture();
    const steps = path.join(rootPath, "docs", "spec", "steps");
    await mkdir(path.join(steps, "t260s"), { recursive: true });
    await writeFile(
      path.join(steps, "state.md"),
      ["# Step State", "", "Mode: tdd", "", "| Step | Status | DependsOn | TouchesScope | TouchesReq | Created | Updated |", "| --- | --- | --- | --- | --- | --- | --- |", "| t260s | active | - | ARCH | - | 2026-11-08 | 2026-11-08 |", ""].join("\n"),
      "utf8"
    );
    const design = ["# Step SDS — t260s", "", FENCE, "## not a heading", "| Status | fenced |", FENCE, "", "| Field | Value |", "| --- | --- |", "| Status | draft |", "", "## Interfaces", "", "| Status | body-table |", ""];
    await writeFile(path.join(steps, "t260s", "design.md"), design.join("\n"), "utf8");
    const status = async () => (await listSteps(root)).steps.find((step) => step.step === "t260s")?.sdsStatus;
    expect(await status()).toBe("draft");

    const result = await setSdsStatus(root, { task: "t260s", status: "agreed" });
    expect(result.ok, JSON.stringify(result.ok ? "" : result.error)).toBe(true);
    expect(await status()).toBe("agreed");
  });

  // @req FR-NODE-260 AC-2
  it("set-sds-status finds the Status row below a fenced `## ` line", async () => {
    const { rootPath, root } = await fixture();
    const dir = path.join(rootPath, "docs", "spec", "steps", "t260");
    await mkdir(dir, { recursive: true });
    const lines = ["# Step SDS — t260", "", FENCE, "## not a heading", FENCE, "", "| Field | Value |", "| --- | --- |", "| Status | draft |", "", "## Interfaces", "", "- x", ""];
    await writeFile(path.join(dir, "design.md"), lines.join("\n"), "utf8");

    const result = await setSdsStatus(root, { task: "t260", status: "agreed" });
    expect(result.ok, JSON.stringify(result.ok ? "" : result.error)).toBe(true);
    expect(await readFile(path.join(dir, "design.md"), "utf8")).toBe(lines.join("\n").replace("| Status | draft |", "| Status | agreed |"));
  });
});

describe("FR-NODE-260 AC-3 — promotion does not count a fenced heading", () => {
  for (const fenced of ["### FR-ARCH-999 — example", "## Example section"]) {
    // @req FR-NODE-260 AC-3
    it(`accepts a block whose only heading outside code is the requirement heading (fenced: ${fenced})`, () => {
      const block = ["### FR-STEP-001 — Step requirement", "", "#### Requirement", "", "Text.", "", FENCE, fenced, FENCE, ""].join("\n");
      expect(assertPromotableBlock("block", block)).toBeUndefined();
    });
  }

  // @req FR-NODE-260 AC-3
  it("still refuses a second requirement heading or a top-level section outside code", () => {
    const head = ["### FR-STEP-001 — Step requirement", "", "#### Requirement", "", "Text.", ""];
    expect(assertPromotableBlock("block", [...head, "### FR-STEP-002 — Second", ""].join("\n"))?.error?.code).toBe("MUTATION_DENIED");
    expect(assertPromotableBlock("block", [...head, "## Next section", ""].join("\n"))?.error?.code).toBe("MUTATION_DENIED");
  });

  const promotionHead = ["### FR-STEP-001 — Step requirement", "", "#### Requirement", "", "Text.", ""];
  for (const heading of ["# Title", "## Section", "### Another heading", "  # Indented title"]) {
    // @req FR-NODE-260 AC-3
    it(`refuses a block holding ${JSON.stringify(heading)} outside code, a second heading of level one to three`, () => {
      expect(assertPromotableBlock("block", [...promotionHead, heading, ""].join("\n"))?.error?.code).toBe("MUTATION_DENIED");
    });
  }

  // @req FR-NODE-260 AC-3 — control: the same `# ` heading inside a fence is text, and `####` sections are the block's own.
  it("accepts a block whose `# ` heading is shown in a fence", () => {
    expect(assertPromotableBlock("block", [...promotionHead, FENCE, "# Title", FENCE, "", "#### Notes", "", "More.", ""].join("\n"))).toBeUndefined();
  });

  // @req FR-NODE-260 AC-3
  it("refuses a top-level section the scanner reads past leading blanks, and counts headings as the scanner does", () => {
    const head = ["### FR-STEP-001 — Step requirement", "", "#### Requirement", "", "Text.", ""];
    // The scanner reads `  ## Next section` as a section heading (it trims the line), so it ends the block.
    const indented = [...head, "  ## Next section", ""].join("\n");
    const scanned = scanRequirementBlocks(["## Requirements", "", ...indented.split("\n"), "### FR-STEP-002 — After", ""]);
    expect(scanned.blocks.map((block) => block.heading.id)).toEqual(["FR-STEP-001"]);
    expect(assertPromotableBlock("block", indented)?.error?.code).toBe("MUTATION_DENIED");
    // `###\t` is no requirement heading for the scanner, so the block has no heading to begin with.
    expect(assertPromotableBlock("block", ["###\tFR-STEP-001 — Step requirement", "", "Text.", ""].join("\n"))?.error?.code).toBe("MUTATION_DENIED");
  });
});

describe("FR-NODE-260 AC-4 — no raw heading test in the named mutation files", () => {
  // @req FR-NODE-260 AC-4
  it("tests no line prefix or pattern for a heading, except the caller-prose guard OPENS_SECTION", async () => {
    const files = ["internal.ts", "edit-requirement.ts", "repair-requirement-id.ts", "set-sds-status.ts", "set-target-goal.ts", "block-prose.ts"];
    // A `#` at the start of a string prefix test or right after a regex `^` (optionally past blanks).
    const raw = /startsWith\(\s*["'`]#|\/\^(?:\\s[*+?]|\\s\{[\d,]+\}| [*+?]| \{[\d,]+\})?(?:#|\\#)/;
    const hits: string[] = [];
    for (const name of files) {
      const lines = (await readFile(path.join("src", "core", "mutation", name), "utf8")).split("\n");
      lines.forEach((line, i) => {
        if (name === "block-prose.ts" && /^const OPENS_SECTION = /.test(line)) return;
        if (raw.test(line)) hits.push(`${name}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(hits).toEqual([]);
  });
});
