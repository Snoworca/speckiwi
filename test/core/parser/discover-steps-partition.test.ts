import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { discoverSrsFiles } from "../../../src/core/parser/discover.js";
import { parseStepState } from "../../../src/core/parser/index-parser.js";
import { parseMarkdownTable } from "../../../src/core/parser/table.js";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

const posix = (p: string) => p.replace(/\\/g, "/");

// A well-formed docs/spec/steps/state.md sample table for FR-PARSE-023.
// Columns (all seven): Step, Status, DependsOn, TouchesScope, TouchesReq, Created, Updated.
const STATE_MD = [
  "# Step State",
  "",
  "| Step | Status | DependsOn | TouchesScope | TouchesReq | Created | Updated |",
  "| --- | --- | --- | --- | --- | --- | --- |",
  "| alpha | active | - | PARSE | FR-PARSE-023 | 2026-06-01 | 2026-06-02 |",
  "| beta | merging | alpha | NODE | FR-NODE-017 | 2026-06-03 | 2026-06-04 |",
  ""
].join("\n");

async function writeStateMd(root: string, content = STATE_MD): Promise<void> {
  const stepsDir = path.join(root, "docs", "spec", "steps");
  await mkdir(stepsDir, { recursive: true });
  await writeFile(path.join(stepsDir, "state.md"), content, "utf8");
}

// FR-PARSE-019: discoverSrsFiles partitions discovered .srs.md files into body scope
// files and origin-isolated step files (docs/spec/steps/<name>/*.srs.md). Body files
// exclude /docs/rule/ and /docs/spec/steps/; step files are exposed via SrsFileSet.stepFiles[]
// and never appear in scopeFiles. stepFiles is always present (possibly empty).
describe("FR-PARSE-019 discoverSrsFiles steps partition", () => {
  // AC-1: Files under docs/spec/steps/<name>/ ending in .srs.md appear in
  // SrsFileSet.stepFiles[] and never in SrsFileSet.scopeFiles.
  it("FR-PARSE-019 AC-1: routes step files to stepFiles[] and never into scopeFiles", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    const stepDir = path.join(root, "docs", "spec", "steps", "my-step");
    await mkdir(stepDir, { recursive: true });
    await writeFile(path.join(stepDir, "20.parser-validation.srs.md"), "# step scope\n", "utf8");

    const files = await discoverSrsFiles(await resolveProjectRoot(root));

    const stepRel = files.stepFiles.map((f) => posix(f.relativePath));
    expect(stepRel).toContain("docs/spec/steps/my-step/20.parser-validation.srs.md");

    const scopeRel = files.scopeFiles.map((f) => posix(f.relativePath));
    expect(scopeRel.some((p) => p.includes("/docs/spec/steps/"))).toBe(false);
  });

  // FND-008 regression: isStepFile (discover) and stepNameFromPath (workspace-parser) must agree
  // on the step layout. A .srs.md file directly under docs/spec/steps/ (NO <name> subdirectory)
  // cannot yield a stepName, so it must NOT be classified as a step file; it falls back to scopeFiles.
  it("FND-008: a .srs.md directly under steps/ (no <name> dir) is not a step file", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    const stepsDir = path.join(root, "docs", "spec", "steps");
    await mkdir(stepsDir, { recursive: true });
    await writeFile(path.join(stepsDir, "foo.srs.md"), "# loose step file\n", "utf8");

    const files = await discoverSrsFiles(await resolveProjectRoot(root));

    const stepRel = files.stepFiles.map((f) => posix(f.relativePath));
    expect(stepRel).not.toContain("docs/spec/steps/foo.srs.md");

    const scopeRel = files.scopeFiles.map((f) => posix(f.relativePath));
    expect(scopeRel).toContain("docs/spec/steps/foo.srs.md");
  });

  // AC-2: Files under docs/rule/ are excluded from both scopeFiles and stepFiles.
  it("FR-PARSE-019 AC-2: excludes docs/rule/ .srs.md from both scopeFiles and stepFiles", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    const ruleDir = path.join(root, "docs", "rule");
    await mkdir(ruleDir, { recursive: true });
    await writeFile(path.join(ruleDir, "99.rule.srs.md"), "# rule doc\n", "utf8");

    const files = await discoverSrsFiles(await resolveProjectRoot(root));

    const scopeRel = files.scopeFiles.map((f) => posix(f.relativePath));
    const stepRel = files.stepFiles.map((f) => posix(f.relativePath));
    expect(scopeRel.some((p) => p.includes("/docs/rule/"))).toBe(false);
    expect(stepRel.some((p) => p.includes("/docs/rule/"))).toBe(false);
  });

  // AC-3: A body scope file outside steps/ continues to appear in scopeFiles unchanged.
  it("FR-PARSE-019 AC-3: keeps a body scope file outside steps/ in scopeFiles", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    const files = await discoverSrsFiles(await resolveProjectRoot(root));

    const scopeRel = files.scopeFiles.map((f) => posix(f.relativePath));
    expect(scopeRel).toContain("docs/spec/10.product-architecture.srs.md");
    expect(files.scopeFiles.length).toBeGreaterThan(0);
  });

  // AC-4: SrsFileSet.stepFiles is present (possibly empty array) on all returned file sets.
  it("FR-PARSE-019 AC-4: always exposes stepFiles as an array (empty when no steps dir)", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    const files = await discoverSrsFiles(await resolveProjectRoot(root));

    expect(Array.isArray(files.stepFiles)).toBe(true);
    expect(files.stepFiles).toEqual([]);
  });
});

// FR-PARSE-023: discover loads docs/spec/steps/state.md via the appendix access-then-read
// pattern into ParsedWorkspace.stateFile, and parseStepState parses its table (columns
// Step, Status, DependsOn, TouchesScope, TouchesReq, Created, Updated; Status enum
// active|merging|merged|abandoned) by reusing parseMarkdownTable.
describe("FR-PARSE-023 state.md loader and parseStepState parser", () => {
  // AC-1: When docs/spec/steps/state.md exists it is loaded and exposed as ParsedWorkspace.stateFile.
  it("FR-PARSE-023 AC-1: loads docs/spec/steps/state.md into ParsedWorkspace.stateFile", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    await writeStateMd(root);

    const workspace = await parseWorkspace(await resolveProjectRoot(root));

    expect(workspace.stateFile).toBeTruthy();
    expect(posix(workspace.stateFile?.relativePath ?? "")).toBe("docs/spec/steps/state.md");
    expect(workspace.stateFile?.text).toContain("| Step | Status |");
  });

  // AC-2: parseStepState returns one entry per state.md row with all seven columns populated.
  it("FR-PARSE-023 AC-2: returns one entry per row with all seven columns populated", () => {
    const entries = parseStepState(STATE_MD.split("\n"));

    expect(entries).toHaveLength(2);
    const first = entries[0];
    expect(first?.step).toBe("alpha");
    expect(first?.status).toBe("active");
    expect(first?.dependsOn).toBe("-");
    expect(first?.touchesScope).toBe("PARSE");
    expect(first?.touchesReq).toBe("FR-PARSE-023");
    expect(first?.created).toBe("2026-06-01");
    expect(first?.updated).toBe("2026-06-02");
  });

  // AC-3: parseStepState flags a Status value outside active, merging, merged, abandoned.
  it("FR-PARSE-023 AC-3: flags a Status value outside the active/merging/merged/abandoned enum", () => {
    const badStatus = [
      "| Step | Status | DependsOn | TouchesScope | TouchesReq | Created | Updated |",
      "| --- | --- | --- | --- | --- | --- | --- |",
      "| gamma | bogus | - | PARSE | FR-PARSE-023 | 2026-06-05 | 2026-06-06 |"
    ];
    const entries = parseStepState(badStatus);

    expect(entries.some((e) => e.status === "bogus" && e.invalidStatus === true)).toBe(true);
  });

  // AC-4: parseStepState reuses parseMarkdownTable rather than a new table parser.
  it("FR-PARSE-023 AC-4: row decomposition matches parseMarkdownTable (reuse, not a new parser)", () => {
    const lines = STATE_MD.split("\n");
    // parseStepState opts into skipNonTableLeading to walk past the state.md heading; the reuse
    // baseline must use the same option to compare the extracted rows (FND-002).
    const table = parseMarkdownTable(lines, 0, { skipNonTableLeading: true });
    const entries = parseStepState(lines);

    // Reuse contract: parseStepState yields exactly the rows parseMarkdownTable extracts,
    // in the same order, with Step cells preserved verbatim.
    expect(entries).toHaveLength(table?.rows.length ?? -1);
    expect(entries.map((e) => e.step)).toEqual(table?.rows.map((row) => row.Step));
  });

  // AC-5: Absence of state.md yields an undefined stateFile without error.
  // Discriminating control: the same loader that yields a populated stateFile when the
  // file is present must yield a falsy stateFile (no throw) when it is absent. This drives
  // the access-then-read loader rather than the current static `stateFile: null` placeholder.
  it("FR-PARSE-023 AC-5: absence yields a falsy stateFile while presence loads it, both without error", async () => {
    const present = await copyFixtureWorkspace("valid-basic");
    await writeStateMd(present);
    const loaded = await discoverSrsFiles(await resolveProjectRoot(present));
    expect(loaded.stateFile).toBeTruthy();
    expect(posix(loaded.stateFile?.relativePath ?? "")).toBe("docs/spec/steps/state.md");

    const absent = await copyFixtureWorkspace("valid-basic");
    await rm(path.join(absent, "docs", "spec", "steps", "state.md"), { force: true });
    const missing = await discoverSrsFiles(await resolveProjectRoot(absent));
    expect(missing.stateFile == null).toBe(true);
  });
});

// FR-PARSE-028: parseStepState is extended to read, in the same single parse pass, the
// top-of-file state.md metadata keys Mode (one of sdd, vibe, wait) and Active Task (present
// only when Mode is vibe). The work-mode metadata is exposed on the parseStepState result as
// .mode / .activeTask / .modeInvalid alongside the existing StepStateEntry[] rows (the array
// contract from FR-PARSE-023 is preserved). When state.md is absent, unparseable, or the Mode
// line is malformed, the parser fails open to Mode=wait instead of throwing.
//
// A state.md document with a top-of-file work-mode metadata block followed by the
// FR-PARSE-023 step-state table. `mode`/`activeTask` are the metadata values under test.
const stateMdWithMode = (options: { mode?: string; activeTask?: string } = {}): string => {
  const metaLines: string[] = ["# Step State", ""];
  if (options.mode !== undefined) metaLines.push(`Mode: ${options.mode}`);
  if (options.activeTask !== undefined) metaLines.push(`Active Task: ${options.activeTask}`);
  metaLines.push("");
  return [
    ...metaLines,
    "| Step | Status | DependsOn | TouchesScope | TouchesReq | Created | Updated |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    "| alpha | active | - | PARSE | FR-PARSE-028 | 2026-06-10 | 2026-06-11 |",
    ""
  ].join("\n");
};

describe("FR-PARSE-028 parseStepState work-mode metadata (Mode, Active Task) with fail-open", () => {
  // AC-1: parseStepState returns Mode equal to one of sdd, vibe, wait read from the metadata block.
  it("FR-PARSE-028 AC-1: returns Mode read from the state.md metadata block (sdd|vibe|wait)", () => {
    expect(parseStepState(stateMdWithMode({ mode: "sdd" }).split("\n")).mode).toBe("sdd");

    const vibe = parseStepState(stateMdWithMode({ mode: "vibe", activeTask: "refactor-parser" }).split("\n"));
    expect(vibe.mode).toBe("vibe");
    expect(["sdd", "vibe", "wait"]).toContain(vibe.mode);

    expect(parseStepState(stateMdWithMode({ mode: "wait" }).split("\n")).mode).toBe("wait");
  });

  // AC-2: Active Task is returned as the task name when Mode is vibe and omitted otherwise.
  it("FR-PARSE-028 AC-2: exposes Active Task only when Mode is vibe and omits it otherwise", () => {
    const vibe = parseStepState(stateMdWithMode({ mode: "vibe", activeTask: "refactor-parser" }).split("\n"));
    expect(vibe.mode).toBe("vibe");
    expect(vibe.activeTask).toBe("refactor-parser");

    // Non-vibe modes omit Active Task even when an Active Task line is present in the file.
    const sdd = parseStepState(stateMdWithMode({ mode: "sdd", activeTask: "should-be-ignored" }).split("\n"));
    expect(sdd.mode).toBe("sdd");
    expect(sdd.activeTask).toBeUndefined();
  });

  // AC-3: A missing or unparseable state.md yields Mode=wait without throwing.
  it("FR-PARSE-028 AC-3: fails open to Mode=wait for missing/unparseable metadata without throwing", () => {
    // No Mode line at all in the metadata block.
    const noMode = parseStepState(stateMdWithMode().split("\n"));
    expect(noMode.mode).toBe("wait");
    expect(noMode.activeTask).toBeUndefined();

    // Completely empty / non-table input: still fails open, no throw.
    expect(() => parseStepState([])).not.toThrow();
    expect(parseStepState([]).mode).toBe("wait");

    // Garbage (unparseable) input still yields a wait default without throwing.
    expect(() => parseStepState(["not a state file", "@@@", ""])).not.toThrow();
    expect(parseStepState(["not a state file", "@@@", ""]).mode).toBe("wait");
  });

  // AC-4: A Mode value outside sdd, vibe, wait is treated as wait and flagged.
  it("FR-PARSE-028 AC-4: treats an out-of-enum Mode as wait and flags it via modeInvalid", () => {
    const bogus = parseStepState(stateMdWithMode({ mode: "turbo" }).split("\n"));
    expect(bogus.mode).toBe("wait");
    expect(bogus.modeInvalid).toBe(true);

    // A valid in-enum Mode is not flagged.
    const valid = parseStepState(stateMdWithMode({ mode: "sdd" }).split("\n"));
    expect(valid.modeInvalid).toBeFalsy();
  });

  // Regression guard for FR-PARSE-023: extending parseStepState with work-mode metadata must
  // preserve the StepStateEntry[] row contract (array semantics) in the same single parse pass.
  it("FR-PARSE-028: preserves the FR-PARSE-023 StepStateEntry[] row contract on the same result", () => {
    const result = parseStepState(stateMdWithMode({ mode: "vibe", activeTask: "refactor-parser" }).split("\n"));
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(1);
    expect(result[0]?.step).toBe("alpha");
    expect(result[0]?.status).toBe("active");
    expect(result[0]?.touchesReq).toBe("FR-PARSE-028");
  });
});
