import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { loadStepDesign, loadStepIntent, validateWorkspaceScoped } from "../../../src/core/validator/validate-scoped.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

/**
 * FR-PARSE-040 — an SDS skip only holds when it is recorded, and the step gate is what compares.
 *
 * Counted before any edit of this item, over the whole repository: `SDS-E054` 0 occurrences in
 * `src/`, `test/`, `docs/` and `skills/`; `loadStepIntent` 0 occurrences in `src/`; the string
 * `SDS Skip` 0 occurrences in `src/` and in all four `kiwi-tdd` renderings. Today
 * `validate-scoped.ts` emits SDS-W050 for EVERY absent design.md and its own comment says the SDS
 * codes are "All warning severity", so every error assertion below was red and no intent.md was
 * read at all.
 *
 * The record is a structure, not a sentence: a `## SDS Skip` section carrying a `Decision` cell, a
 * `Reason` cell and an EARS `SDS-AC-n:` line. Three cells rather than free prose, because a free
 * "trivial" line is the self-declaration this requirement exists to remove — every step would carry
 * one and the gate would be back where it started.
 */

const STEP = "tdd-step-x";

async function writeStateMd(rootPath: string, mode: string): Promise<void> {
  const stepsDir = path.join(rootPath, "docs", "spec", "steps");
  await mkdir(stepsDir, { recursive: true });
  await writeFile(
    path.join(stepsDir, "state.md"),
    [
      "# Step State",
      "",
      `Mode: ${mode}`,
      ...(mode === "tdd" || mode === "vibe" ? [`Active Task: ${STEP}`] : []),
      "",
      "| Step | Status | DependsOn | TouchesScope | TouchesReq | Created | Updated |",
      "| --- | --- | --- | --- | --- | --- | --- |",
      `| ${STEP} | active | - | ARCH | - | 2026-09-01 | 2026-09-01 |`,
      ""
    ].join("\n"),
    "utf8"
  );
}

/**
 * The complete record, and the single place this suite spells its shape.
 *
 * Every malformed variant below is built by mutating ONE cell of this literal, so a case can never
 * pass by being malformed in a second way the assertion did not name. The overrides are applied to
 * the cell text, and an override of `undefined` deletes the row outright.
 */
function intentMd(
  overrides: { decision?: string | undefined; reason?: string | undefined; ears?: string | undefined } = {}
): string {
  const has = (key: "decision" | "reason" | "ears"): boolean => !(key in overrides) || overrides[key] !== undefined;
  const decision = overrides.decision ?? "skipped";
  const reason = overrides.reason ?? "Renames one private helper; no interface and no behaviour changes.";
  const ears = overrides.ears ?? "SDS-AC-1: WHEN the helper is renamed THE SYSTEM SHALL keep every caller resolving.";
  return [
    `# Intent: ${STEP}`,
    "",
    "Rename the private slug helper.",
    "",
    "## SDS Skip",
    "",
    "| Field | Value |",
    "| --- | --- |",
    ...(has("decision") ? [`| Decision | ${decision} |`] : []),
    ...(has("reason") ? [`| Reason | ${reason} |`] : []),
    "",
    ...(has("ears") ? [`- ${ears}`] : []),
    ""
  ].join("\n");
}

const FULL_SDS = [
  "# SDS: sample",
  "",
  "## 1. Context & Scope",
  "",
  "## 2. Goals / Non-goals",
  "",
  "## 3. Architecture Decisions",
  "",
  "## 4. Interfaces",
  "",
  "## 5. Acceptance Contracts",
  "",
  "- SDS-AC-1: WHEN X THE SYSTEM SHALL Y.",
  "",
  "## 6. Test Plan",
  "",
  "| SDS-AC | Test file (planned) | Case summary |",
  "|---|---|---|",
  "| SDS-AC-1 | test/x.test.ts | y |",
  "",
  "## 7. Open Questions",
  "",
  "- (none)"
].join("\n");

async function writeStepFile(rootPath: string, name: string, content: string): Promise<void> {
  const stepDir = path.join(rootPath, "docs", "spec", "steps", STEP);
  await mkdir(stepDir, { recursive: true });
  await writeFile(path.join(stepDir, name), content, "utf8");
}

async function scoped(rootPath: string) {
  const root = await resolveProjectRoot(rootPath);
  const workspace = await parseWorkspace(root);
  return validateWorkspaceScoped(workspace, {
    step: STEP,
    design: await loadStepDesign(root, STEP),
    intent: await loadStepIntent(root, STEP)
  });
}

function codes(items: readonly { code: string }[]): string[] {
  return items.map((item) => item.code);
}

describe("FR-PARSE-040 AC-1 — a recorded skip stays a warning", () => {
  it("emits SDS-W050 as a warning and reports zero errors", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");
    await writeStateMd(rootPath, "tdd");
    await writeStepFile(rootPath, "intent.md", intentMd());

    const result = await scoped(rootPath);
    expect(codes(result.warnings)).toContain("SDS-W050");
    expect(codes(result.errors)).not.toContain("SDS-E054");
    expect(result.errors).toHaveLength(0);
  });

  it("accepts the record wherever the EARS line sits inside the section", async () => {
    // The three cells are what the gate reads; their order inside the section is not a contract, and
    // pinning one would reject a correct record for a cosmetic reason.
    const rootPath = await copyFixtureWorkspace("valid-basic");
    await writeStateMd(rootPath, "tdd");
    await writeStepFile(
      rootPath,
      "intent.md",
      [
        `# Intent: ${STEP}`,
        "",
        "## SDS Skip",
        "",
        "- SDS-AC-1: WHEN the flag is absent THE SYSTEM SHALL keep the previous default.",
        "",
        "| Field | Value |",
        "| --- | --- |",
        "| Decision | skipped |",
        "| Reason | One default value moves; the surrounding contract is unchanged. |",
        ""
      ].join("\n")
    );

    const result = await scoped(rootPath);
    expect(codes(result.warnings)).toContain("SDS-W050");
    expect(result.errors).toHaveLength(0);
  });
});

describe("FR-PARSE-040 AC-2 — an unrecorded skip is an error", () => {
  it("emits SDS-E054 and not SDS-W050 when intent.md is absent altogether", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");
    await writeStateMd(rootPath, "tdd");

    const result = await scoped(rootPath);
    expect(codes(result.errors)).toContain("SDS-E054");
    expect(codes(result.warnings)).not.toContain("SDS-W050");
    expect(codes(result.errors.concat(result.warnings))).not.toContain("SDS-W050");
  });

  it("emits SDS-E054 when intent.md exists but carries no SDS Skip section", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");
    await writeStateMd(rootPath, "tdd");
    await writeStepFile(rootPath, "intent.md", `# Intent: ${STEP}\n\nRename the private slug helper.\n`);

    const result = await scoped(rootPath);
    expect(codes(result.errors)).toContain("SDS-E054");
    expect(codes(result.warnings)).not.toContain("SDS-W050");
  });

  it("gives SDS-E054 error severity, so it is an error and not an advisory", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");
    await writeStateMd(rootPath, "tdd");

    const result = await scoped(rootPath);
    const hit = result.diagnostics.find((item) => item.code === "SDS-E054");
    expect(hit?.severity).toBe("error");
  });
});

describe("FR-PARSE-040 AC-3 — an incomplete record fails and names the failing part", () => {
  const cases: Array<{ label: string; overrides: Parameters<typeof intentMd>[0]; names: RegExp }> = [
    { label: "Decision is not 'skipped'", overrides: { decision: "authored" }, names: /Decision/i },
    { label: "the Decision row is missing", overrides: { decision: undefined }, names: /Decision/i },
    { label: "the Reason cell is empty", overrides: { reason: "" }, names: /Reason/i },
    { label: "the Reason row is missing", overrides: { reason: undefined }, names: /Reason/i },
    { label: "the EARS line is missing", overrides: { ears: undefined }, names: /SDS-AC/i },
    {
      label: "the SDS-AC line carries no WHEN/SHALL",
      overrides: { ears: "SDS-AC-1: this change is obvious." },
      names: /SDS-AC/i
    }
  ];

  for (const entry of cases) {
    it(`emits SDS-E054 naming the part when ${entry.label}`, async () => {
      const rootPath = await copyFixtureWorkspace("valid-basic");
      await writeStateMd(rootPath, "tdd");
      await writeStepFile(rootPath, "intent.md", intentMd(entry.overrides));

      const result = await scoped(rootPath);
      const hit = result.errors.find((item) => item.code === "SDS-E054");
      expect(hit, `SDS-E054 must fire when ${entry.label}`).toBeDefined();
      expect(hit?.message).toMatch(entry.names);
      expect(codes(result.warnings)).not.toContain("SDS-W050");
    });
  }

  it("covers every cell the requirement names, so no field is left unguarded", () => {
    // The denominator, pinned. A cell dropped from `intentMd` without a case here would leave that
    // part of the record unchecked while the suite stayed green.
    const guarded = new Set(cases.map((entry) => entry.names.source.replace(/\\/g, "")));
    expect(guarded).toEqual(new Set(["Decision", "Reason", "SDS-AC"]));
    expect(cases.length).toBeGreaterThanOrEqual(6);
  });
});

describe("FR-PARSE-040 AC-5 — the gate is tdd-scoped and leaves the other advisories alone", () => {
  for (const mode of ["sdd", "vibe", "wait"]) {
    it(`emits neither SDS-W050 nor SDS-E054 in ${mode} mode`, async () => {
      const rootPath = await copyFixtureWorkspace("valid-basic");
      await writeStateMd(rootPath, mode);

      const result = await scoped(rootPath);
      expect(codes(result.diagnostics)).not.toContain("SDS-E054");
      expect(codes(result.diagnostics)).not.toContain("SDS-W050");
    });
  }

  it("keeps SDS-W051 a warning when design.md is present but incomplete, with no skip record", async () => {
    // A present design.md never consults the record: the skip gate is about the absence, and an
    // authored SDS that misses a heading must stay advisory as FR-PARSE-033 has it.
    const rootPath = await copyFixtureWorkspace("valid-basic");
    await writeStateMd(rootPath, "tdd");
    await writeStepFile(rootPath, "design.md", FULL_SDS.replace("## 4. Interfaces", "## 4. Surfaces"));

    const result = await scoped(rootPath);
    expect(codes(result.warnings)).toContain("SDS-W051");
    expect(codes(result.diagnostics)).not.toContain("SDS-E054");
    expect(result.errors).toHaveLength(0);
  });
});
