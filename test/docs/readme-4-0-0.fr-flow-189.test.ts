import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { toolSchemas } from "../../src/mcp/server.js";

// @req FR-FLOW-189 — the user-facing documents move with 4.0.0: the README (both languages), the two
// MIGRATION_PLAN inventories and the 3.0.0 plan index that recorded the decision 4.0.0 reverses.

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const KOREAN_HEADING = "# SpecKiwi (한국어)";

function read(relativePath: string): string {
  return readFileSync(path.join(REPO_ROOT, relativePath), "utf8").replace(/\r\n/g, "\n");
}

/** The README split at the Korean top-level heading, so each language is held on its own. */
function readmeHalves(): { en: string; ko: string } {
  const readme = read("README.md");
  const split = readme.indexOf(`\n${KOREAN_HEADING}\n`);
  expect(split, "README.md must carry the Korean section heading").toBeGreaterThan(0);
  return { en: readme.slice(0, split), ko: readme.slice(split) };
}

const REMOVED_PLAN_TOOLS = [
  "workflow_plan_status",
  "workflow_plan_task",
  "workflow_next_plan_task",
  "workflow_resume_hint",
  "workflow_doctor",
  "workflow_diff",
  "workflow_schema_check",
  "workflow_task_check",
  "workflow_task_uncheck",
  "workflow_checklist_set",
  "workflow_task_status_set",
  "preview_legacy_workflow_migration"
] as const;

/** The FR-FLOW-184 AC-1 chain, in order, on one line — arrows written either way. */
const CHAIN = /kiwi-srs`?\s*(?:→|->)\s*`?\(?`?kiwi-srs-feasibility`?\)?`?\s*(?:→|->)\s*`?kiwi-sds`?\s*(?:→|->)\s*`?kiwi-pm`?\s*(?:→|->)\s*`?kiwi-review-fix-loop/;

const LANGUAGES = [
  {
    key: "en" as const,
    total: (count: number) => `**${count} tools ship in total.**`,
    planToolsRemoved: /plan[^.\n]*tools?[^.\n]*removed|removed[^.\n]*plan[^.\n]*tools?/i,
    parallel: /parallel/i,
    deletion: /(?:remove|delete)/i,
    byHand: /(?:by hand|manually)/i,
    global: /global/i
  },
  {
    key: "ko" as const,
    total: (count: number) => `총 ${count}개 도구가 배포됩니다`,
    planToolsRemoved: /계획[^.\n]*도구[^.\n]*제거/,
    parallel: /병렬/,
    deletion: /(?:제거|삭제|지우)/,
    byHand: /(?:직접|수동)/,
    global: /전역/
  }
];

describe("FR-FLOW-189 AC-1 — the README describes 4.0.0 in both languages", () => {
  for (const language of LANGUAGES) {
    it(`FR-FLOW-189 AC-1 (${language.key}): names the chain, kiwi-sds, parallel waves with --serial and the test-sufficiency check`, () => {
      const text = readmeHalves()[language.key];
      expect(text, "the FR-FLOW-184 chain on one line").toMatch(CHAIN);
      expect(text).toContain("kiwi-sds");
      const serialLines = text.split("\n").filter((line) => line.includes("--serial"));
      expect(serialLines.length, "a line naming --serial").toBeGreaterThan(0);
      expect(serialLines.some((line) => language.parallel.test(line)), "--serial stated beside the parallel waves it serialises").toBe(true);
      expect(text, "the test-sufficiency tool or command").toMatch(/`speckiwi coverage --tests`|`check_test_sufficiency`/);
    });

    it(`FR-FLOW-189 AC-1 (${language.key}): states the tool count the running registry has`, () => {
      const text = readmeHalves()[language.key];
      expect(text).toContain(language.total(Object.keys(toolSchemas).length));
    });

    it(`FR-FLOW-189 AC-1 (${language.key}): says kiwi-planner and the plan tools are gone and names no removed tool`, () => {
      const text = readmeHalves()[language.key];
      expect(text, "a sentence saying the plan tools were removed").toMatch(language.planToolsRemoved);
      const named = REMOVED_PLAN_TOOLS.filter((tool) => text.includes(tool));
      expect(named, "a removed tool the README still names").toEqual([]);
      const plannerLines = text.split("\n").filter((line) => line.includes("kiwi-planner"));
      expect(plannerLines.length, "the removal is stated, not merely left unsaid").toBeGreaterThan(0);
      const offered = plannerLines.filter((line) => !language.deletion.test(line));
      expect(offered, "a line naming kiwi-planner as something other than removed").toEqual([]);
      expect(
        plannerLines.some((line) => language.byHand.test(line) && language.global.test(line)),
        "users are told to delete a globally installed kiwi-planner copy by hand"
      ).toBe(true);
    });
  }
});

describe("FR-FLOW-189 AC-2 — the migration inventories list kiwi-sds and no planner", () => {
  for (const file of ["skills/codex/MIGRATION_PLAN.md", "skills/etc/MIGRATION_PLAN.md"]) {
    it(`FR-FLOW-189 AC-2: ${file}`, () => {
      const text = read(file);
      expect(text).toContain("kiwi-sds");
      expect(text).not.toContain("kiwi-planner");
      expect(text).not.toContain("validator.mjs");
    });
  }
});

describe("FR-FLOW-189 AC-3 — the 3.0.0 plan index records the reversal", () => {
  it("FR-FLOW-189 AC-3: one decision row dated 2026-09-27 reverses the 2026-08-24 planning-step decision for 4.0.0", () => {
    const rows = read("docs/plan/3.0.0/00.index.md")
      .split("\n")
      .filter((line) => line.startsWith("| 2026-09-27 |"));
    expect(
      rows.filter((row) => row.includes("2026-08-24") && row.includes("4.0.0") && /번복|뒤집/.test(row)),
      "the reversal row"
    ).toHaveLength(1);
  });

  it("FR-FLOW-189 AC-3: the reversal row names the decision it reverses and the user instruction that reversed it", () => {
    const row =
      read("docs/plan/3.0.0/00.index.md")
        .split("\n")
        .find((line) => line.startsWith("| 2026-09-27 |") && /번복|뒤집/.test(line)) ?? "";
    const reversed = /2026-08-24 의 "([^"]+)" 결정을/.exec(row);
    expect(reversed?.[1], "the row does not quote the 2026-08-24 decision it reverses").toBe("계획 단계는 유지");
    // The quoted decision is the one the index itself records under 2026-08-24, not a paraphrase of it.
    const original = read("docs/plan/3.0.0/00.index.md")
      .split("\n")
      .filter((line) => line.startsWith("| 2026-08-24 |") && line.includes(`**${reversed?.[1] ?? "\u0000"}.**`));
    expect(original, "the reversed decision is not the one recorded on 2026-08-24").toHaveLength(1);
    expect(row, "the row does not say the reversal was by user instruction").toMatch(/사용자 지시\([^)]*\)로 \*\*번복\*\*/);
    expect(row, "the row does not name the target the reversal is for").toMatch(/목표 4\.0\.0/);
  });
});
