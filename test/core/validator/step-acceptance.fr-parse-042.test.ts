import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { renderSdsDesignTemplate, renderStepIntentTemplate } from "../../../src/core/bootstrap/templates.js";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { evaluateVibeGate } from "../../../src/core/query/vibe-gate.js";
import { stepAcceptanceFailure } from "../../../src/core/validator/step-acceptance.js";
import { loadStepDesign, loadStepIntent, validateWorkspaceScoped } from "../../../src/core/validator/validate-scoped.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

/**
 * FR-PARSE-042 — a tdd step without an authored design.md carries a checked acceptance contract in
 * intent.md. The check replaces FR-PARSE-040's SDS skip record (discarded in 4.1.0) and keeps its
 * guarantee: a written contract exists before tests, and a tool checks it.
 */

const STEP = "tdd-step-x";
const PLACEHOLDER_LINE = "AC-1: WHEN <condition> THE SYSTEM SHALL <behaviour>";

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
      `| ${STEP} | active | - | ARCH | - | 2026-10-20 | 2026-10-20 |`,
      ""
    ].join("\n"),
    "utf8"
  );
}

function intentMd(acceptance: readonly string[] | undefined): string {
  return [
    `# Intent: ${STEP}`,
    "",
    "Rename the private slug helper.",
    "",
    ...(acceptance === undefined ? [] : ["## Acceptance", "", ...acceptance, ""]),
    "## Notes",
    "",
    "- AC-9: WHEN outside the section THE SYSTEM SHALL not count.",
    ""
  ].join("\n");
}

const AUTHORED_LINE = "- AC-1: WHEN the helper is renamed THE SYSTEM SHALL keep every caller resolving.";

const AUTHORED_SDS = [
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

async function tddStep(files: { intent?: string; design?: string }): Promise<string> {
  const rootPath = await copyFixtureWorkspace("valid-basic");
  await writeStateMd(rootPath, "tdd");
  await mkdir(path.join(rootPath, "docs", "spec", "steps", STEP), { recursive: true });
  if (files.intent !== undefined) await writeStepFile(rootPath, "intent.md", files.intent);
  if (files.design !== undefined) await writeStepFile(rootPath, "design.md", files.design);
  return rootPath;
}

function codes(items: readonly { code: string }[]): string[] {
  return items.map((item) => item.code);
}

const lines = (text: string) => ({ present: true, lines: text.split("\n") });
const absent = { present: false, lines: [] as string[] };

describe("FR-PARSE-042 AC-1 — an EARS acceptance line in intent.md passes", () => {
  it("reports no STEP_ACCEPTANCE_MISSING for an authored acceptance line", async () => {
    const result = await scoped(await tddStep({ intent: intentMd([AUTHORED_LINE]) }));
    expect(codes(result.diagnostics)).not.toContain("STEP_ACCEPTANCE_MISSING");
    expect(result.errors).toHaveLength(0);
  });

  for (const marker of ["", "* ", "1. "]) {
    it(`accepts the line after the optional list marker '${marker}'`, () => {
      const line = `${marker}AC-2: WHEN a flag is absent THE SYSTEM SHALL keep the default.`;
      expect(stepAcceptanceFailure(absent, lines(intentMd([line])))).toBeUndefined();
    });
  }

  it("does not count the scaffold's placeholder line as an acceptance line (mutation: drop the placeholder clause)", async () => {
    const result = await scoped(await tddStep({ intent: renderStepIntentTemplate(STEP) }));
    expect(renderStepIntentTemplate(STEP)).toContain(PLACEHOLDER_LINE);
    expect(codes(result.errors)).toContain("STEP_ACCEPTANCE_MISSING");
  });

  it("rejects a placeholder token anywhere in the line", () => {
    const line = "- AC-1: WHEN the helper is renamed THE SYSTEM SHALL keep <callers> resolving.";
    expect(stepAcceptanceFailure(absent, lines(intentMd([line])))).toBeDefined();
  });

  // FR-PARSE-042 AC-1 as amended after review r2: the fixtures the criterion names.
  it("FR-PARSE-042 AC-1: any ## section whose heading contains Acceptance counts, not only the first", async () => {
    const intent = [
      `# Intent: ${STEP}`,
      "",
      "## Acceptance Notes",
      "",
      "Notes about how the acceptance lines were chosen.",
      "",
      "## Acceptance",
      "",
      "- AC-1: WHEN a THE SYSTEM SHALL b",
      ""
    ].join("\n");
    const result = await scoped(await tddStep({ intent }));
    expect(codes(result.diagnostics)).not.toContain("STEP_ACCEPTANCE_MISSING");
  });

  for (const line of [
    "- AC-1: WHEN `speckiwi step validate <task>` runs THE SYSTEM SHALL exit 1",
    "- AC-1: WHEN n < 5 and m > 2 THE SYSTEM SHALL report both bounds"
  ]) {
    it(`FR-PARSE-042 AC-1: a <…> inside inline code or a comparison is not a placeholder: ${line}`, async () => {
      const result = await scoped(await tddStep({ intent: intentMd([line]) }));
      expect(codes(result.diagnostics)).not.toContain("STEP_ACCEPTANCE_MISSING");
    });
  }

  for (const placeholder of ["<condition>", "<behaviour>", "<observable behavior>"]) {
    it(`FR-PARSE-042 AC-1: ${placeholder} outside inline code is a placeholder`, () => {
      const line = `- AC-1: WHEN the flag is set THE SYSTEM SHALL ${placeholder}`;
      expect(stepAcceptanceFailure(absent, lines(intentMd([line])))).toBeDefined();
    });
  }
});

describe("FR-PARSE-042 AC-2 — a missing contract is an error naming the first failing part", () => {
  const cases: Array<{ label: string; intent: string | undefined; names: RegExp }> = [
    { label: "intent.md is absent", intent: undefined, names: /intent\.md is absent/ },
    { label: "intent.md has no Acceptance section", intent: intentMd(undefined), names: /no '## Acceptance' section/ },
    {
      label: "the section has no acceptance line",
      intent: intentMd(["- AC-1: this change is obvious."]),
      names: /no acceptance line/
    },
    { label: "the line misses WHEN", intent: intentMd(["- AC-1: THE SYSTEM SHALL work."]), names: /no acceptance line/ },
    { label: "the line misses the AC id", intent: intentMd(["- WHEN x THE SYSTEM SHALL y."]), names: /no acceptance line/ }
  ];

  for (const entry of cases) {
    it(`emits STEP_ACCEPTANCE_MISSING at error severity when ${entry.label}`, async () => {
      const result = await scoped(await tddStep(entry.intent === undefined ? {} : { intent: entry.intent }));
      const hit = result.errors.find((item) => item.code === "STEP_ACCEPTANCE_MISSING");
      expect(hit, `STEP_ACCEPTANCE_MISSING must fire when ${entry.label}`).toBeDefined();
      expect(hit?.severity).toBe("error");
      expect(hit?.message).toMatch(entry.names);
      expect(hit?.filePath).toBe(`docs/spec/steps/${STEP}/intent.md`);
    });
  }
});

describe("FR-PARSE-042 AC-3 — only an authored design.md switches the check off", () => {
  it("an authored design.md switches the check off and gets the SDS-W051..W053 advisories", async () => {
    const result = await scoped(await tddStep({ design: AUTHORED_SDS.replace("## 4. Interfaces", "## 4. Surfaces") }));
    expect(codes(result.diagnostics)).not.toContain("STEP_ACCEPTANCE_MISSING");
    expect(codes(result.warnings)).toContain("SDS-W051");
    expect(result.errors).toHaveLength(0);
  });

  it("the 4.0.0 scaffold stub design.md does not switch the check off (mutation: drop the authored-design rule)", async () => {
    const stub = renderSdsDesignTemplate({ task: STEP });
    const result = await scoped(await tddStep({ design: stub }));
    expect(codes(result.errors)).toContain("STEP_ACCEPTANCE_MISSING");
  });

  it("FR-PARSE-042 AC-3: an authored SDS-AC line quoting `<task>` in inline code still counts as authored", () => {
    const design = AUTHORED_SDS.replace("- SDS-AC-1: WHEN X THE SYSTEM SHALL Y.", "- SDS-AC-1: WHEN `speckiwi step validate <task>` runs THE SYSTEM SHALL exit 1.");
    expect(stepAcceptanceFailure(lines(design), absent)).toBeUndefined();
  });

  it("an SDS-AC line outside the Acceptance Contracts section does not count", () => {
    // The only SDS-AC line sits under Open Questions, the last section.
    const design = AUTHORED_SDS.replace("- SDS-AC-1: WHEN X THE SYSTEM SHALL Y.", "- (none)");
    expect(stepAcceptanceFailure(lines(`${design}\n- SDS-AC-2: WHEN A THE SYSTEM SHALL B.`), absent)).toBeDefined();
    expect(stepAcceptanceFailure(lines(AUTHORED_SDS), absent)).toBeUndefined();
  });

  for (const mode of ["sdd", "vibe", "wait"]) {
    it(`emits no STEP_ACCEPTANCE_MISSING in ${mode} mode`, async () => {
      const rootPath = await copyFixtureWorkspace("valid-basic");
      await writeStateMd(rootPath, mode);
      const result = await scoped(rootPath);
      expect(codes(result.diagnostics)).not.toContain("STEP_ACCEPTANCE_MISSING");
    });
  }
});

describe("FR-PARSE-042 AC-5 — the vibe gate decides its tdd branch with the same predicate", () => {
  it("the gate and step validate agree on a passing and a failing step", async () => {
    for (const [intent, blocked] of [
      [intentMd([AUTHORED_LINE]), false],
      [renderStepIntentTemplate(STEP), true]
    ] as const) {
      const rootPath = await tddStep({ intent });
      const gate = await evaluateVibeGate(await resolveProjectRoot(rootPath));
      const result = await scoped(rootPath);
      expect(gate.blocked).toBe(blocked);
      expect(codes(result.errors).includes("STEP_ACCEPTANCE_MISSING")).toBe(blocked);
    }
  });
});

describe("FR-PARSE-042 AC-6 — SDS-E054 and SDS-W050 are no longer emitted", () => {
  it("no source file under src/ names either retired code", async () => {
    const offenders: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) await walk(full);
        else if (/\.ts$/.test(entry.name) && /SDS-(E054|W050)/.test(await readFile(full, "utf8"))) offenders.push(full);
      }
    };
    await walk(path.join(process.cwd(), "src"));
    expect(offenders).toEqual([]);
  });

  it("an absent design.md with an old SDS Skip record yields STEP_ACCEPTANCE_MISSING, not SDS-W050", async () => {
    const record = [
      `# Intent: ${STEP}`,
      "",
      "## SDS Skip",
      "",
      "| Field | Value |",
      "| --- | --- |",
      "| Decision | skipped |",
      "| Reason | Renames one private helper. |",
      "",
      "- SDS-AC-1: WHEN the helper is renamed THE SYSTEM SHALL keep every caller resolving.",
      ""
    ].join("\n");
    const result = await scoped(await tddStep({ intent: record }));
    expect(codes(result.diagnostics)).not.toContain("SDS-W050");
    expect(codes(result.diagnostics)).not.toContain("SDS-E054");
    expect(codes(result.errors)).toContain("STEP_ACCEPTANCE_MISSING");
  });
});
