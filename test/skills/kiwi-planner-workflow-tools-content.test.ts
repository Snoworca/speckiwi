import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// @req FR-FLOW-031
// FR-FLOW-031 — kiwi-planner planner-document management and validation via v2.3.0 workflow_* MCP tools.
//
// RED-phase content assertions (T-PH002-03). These assert the FINAL desired state of the kiwi-planner
// skill instruction across all three PACKAGED VARIANTS and therefore FAIL until T-PH002-04 routes the
// planner document through the workflow_* MCP tool family in:
//   - claude: skills/claude/kiwi-planner/SKILL.md  (Korean canonical, invokes 0 workflow_* tools today)
//   - codex : skills/codex/kiwi-planner/SKILL.md   (English; already has an "Official Workflow Tool
//             Policy" section referencing a DIFFERENT 9-tool superset — 4 of the target-9 present,
//             5 missing: workflow_plan_task / workflow_diff / workflow_task_check /
//             workflow_task_uncheck / workflow_checklist_set)
//   - etc   : skills/etc/kiwi-planner/SKILL.md     (English, invokes 0 workflow_* tools today)
//
// A SKILL.md is natural-language agent instruction, not executable code, so behavior is verified by
// raw-text presence + windowed proximity assertions (FR-FLOW-014 kiwi-step / FR-FLOW-023 research-loop
// precedent), not skill execution.
//
// Two of the assertions below are deliberately ALWAYS-GREEN preservation guards, NOT red drivers:
//   (1) The install-skill token-contract preservation (AC-1) over the codex + .agents/skills
//       kiwi-planner mirror. The target-9 routing is APPENDED to the existing "Official Workflow Tool
//       Policy" section, never replacing it; this guard mirrors
//       test/core/skills/install-skill.test.ts "keeps scoped Kiwi skills on official workflow tools"
//       so a future edit cannot silently drop get_next_work_order / workflow_pipeline_emit /
//       degraded-mode wording / re-introduce includeContent / reorder emit-after-pipeline. These
//       tokens already exist in codex + the mirror today, so this guard passes from the start.
//   (2) The validator.mjs coverage-preservation grep (AC-3) over the three validator.mjs copies. It
//       requires all 28 makeCheck rule IDs (C00b, C01-C25, R01, R04) to remain present so plan-contract
//       validation coverage does not regress. validator.mjs is UNMODIFIED by this plan, so this guard
//       is green from the start (SRS AC-3 formally scopes to C01-C25).
//
// The genuine RED comes from the ABSENT workflow-tool-policy + degraded-fallback wording in the claude
// & etc kiwi-planner SKILL.md (0 workflow_* refs today) and the 5 target tools missing from codex.

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const VARIANTS = ["claude", "codex", "etc"] as const;
type Variant = (typeof VARIANTS)[number];

// The token contract is preserved across the installed codex source and its git-tracked mirror.
const MIRROR_ROOTS = ["skills/codex", ".agents/skills"] as const;

function plannerText(variant: Variant): string {
  return readFileSync(path.join(REPO_ROOT, "skills", variant, "kiwi-planner", "SKILL.md"), "utf8");
}

/** All .md files under a directory (recursive), for the install-skill-style joined-text guard. */
function listMdFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listMdFiles(full));
    else if (entry.name.endsWith(".md")) out.push(full);
  }
  return out;
}

/** Joined .md text of a kiwi-planner skill dir, matching install-skill.test.ts's gather scope. */
function joinedPlannerMd(root: string): string {
  const dir = path.join(REPO_ROOT, root, "kiwi-planner");
  return listMdFiles(dir)
    .map((f) => readFileSync(f, "utf8"))
    .join("\n");
}

/** Text windows of +/- `radius` chars around every match of `re` within a single `text`. */
function windowsAround(text: string, re: RegExp, radius = 500): string[] {
  const g = new RegExp(re.source, re.flags.replace("g", "") + "g");
  const out: string[] = [];
  for (let m = g.exec(text); m; m = g.exec(text)) {
    out.push(text.slice(Math.max(0, m.index - radius), m.index + m[0].length + radius));
    if (g.lastIndex === m.index) g.lastIndex++;
  }
  return out;
}

// --- The target-9 workflow_* tools, grouped by SRS operation category (AC-1) ---------------------
const READ_TOOLS = ["workflow_plan_status", "workflow_plan_task", "workflow_next_plan_task"];
const VALIDATE_TOOLS = ["workflow_doctor", "workflow_schema_check", "workflow_diff"];
const MUTATE_TOOLS = ["workflow_task_check", "workflow_task_uncheck", "workflow_checklist_set"];
const TARGET_9 = [...READ_TOOLS, ...VALIDATE_TOOLS, ...MUTATE_TOOLS];

// --- Bilingual operation-category words (EN mirrors + KO canonical) -------------------------------
const READ_CAT = /\bread(?:ing|s)?\b|읽기|읽는|조회|판독/i;
const VALIDATE_CAT = /validat(?:e|es|ion|ing)|diagnos(?:tic|tics|is|e)|검증|진단/i;
const MUTATE_CAT = /mutat(?:e|es|ing|ion|ions)|checkbox|체크박스|뮤테이|변경/i;

/** True iff some window anchored on `catRe` contains every tool of that operation category. */
function hasCategoryGroup(text: string, catRe: RegExp, tools: string[]): boolean {
  return windowsAround(text, catRe, 500).some((w) => tools.every((t) => w.includes(t)));
}

// --- Install-skill token contract (must survive the target-9 append) ------------------------------
const TOKEN_CONTRACT = [
  "Official Workflow Tool Policy",
  "get_next_work_order",
  "workflow_pipeline_emit",
  "degraded mode",
  "capturing tool diagnostics",
  "affected artifact paths",
  "active target",
  "follow-up requirement or candidate ID",
];

// --- Degraded raw-file fallback (AC-3) ------------------------------------------------------------
// "degraded" is the SRS / MIG-FLOW-003 canonical term and is retained even in the Korean canonical.
const DEGRADED = /degraded/i;
const RAW_ACCESS =
  /raw[\s-]*(?:file|docs)|docs\/plans|원본\s*파일|파일\s*(?:직접\s*)?(?:접근|읽|핸들)|파일\s*핸들링/i;

// --- validator.mjs coverage preservation (AC-3, always-green guard) -------------------------------
const VALIDATOR_PATHS = [
  "skills/claude/kiwi-planner/validator.mjs",
  "skills/codex/kiwi-planner/scripts/validator.mjs",
  "skills/etc/kiwi-planner/scripts/validator.mjs",
];
// 28 makeCheck rule IDs: C00b + C01..C25 + R01 + R04.
const EXPECTED_RULE_IDS = [
  "C00b",
  ...Array.from({ length: 25 }, (_, i) => `C${String(i + 1).padStart(2, "0")}`),
  "R01",
  "R04",
];

describe("FR-FLOW-031 — kiwi-planner planner-document management via v2.3.0 workflow_* MCP tools", () => {
  // ---- AC-1: the target-9 workflow_* tools named by operation category (all three variants) -------
  for (const variant of VARIANTS) {
    it(`FR-FLOW-031 red :: AC-1 [${variant}] — names the target-9 workflow_* tools by operation category`, () => {
      const text = plannerText(variant);

      // Primary red driver: claude/etc reference no workflow_* tools; codex is missing 5 of the target-9.
      for (const tool of TARGET_9) {
        expect(
          text.includes(tool),
          `FR-FLOW-031 AC-1: ${variant} kiwi-planner must name ${tool}`,
        ).toBe(true);
      }

      // The tools must be grouped by their SRS operation category (reading / validating / mutating).
      expect(
        hasCategoryGroup(text, READ_CAT, READ_TOOLS),
        `FR-FLOW-031 AC-1: ${variant} must group ${READ_TOOLS.join(" / ")} under a reading operation category`,
      ).toBe(true);
      expect(
        hasCategoryGroup(text, VALIDATE_CAT, VALIDATE_TOOLS),
        `FR-FLOW-031 AC-1: ${variant} must group ${VALIDATE_TOOLS.join(" / ")} under a validating operation category`,
      ).toBe(true);
      expect(
        hasCategoryGroup(text, MUTATE_CAT, MUTATE_TOOLS),
        `FR-FLOW-031 AC-1: ${variant} must group ${MUTATE_TOOLS.join(" / ")} under a mutating operation category`,
      ).toBe(true);
    });
  }

  // ---- AC-1: install-skill token contract PRESERVED (codex + mirror, always-green guard) ----------
  for (const root of MIRROR_ROOTS) {
    it(`FR-FLOW-031 red :: AC-1 [${root}] — preserves the install-skill workflow-tool token contract (always-green guard)`, () => {
      const text = joinedPlannerMd(root);

      for (const token of TOKEN_CONTRACT) {
        expect(
          text.includes(token),
          `FR-FLOW-031 AC-1: ${root} kiwi-planner must PRESERVE install-skill token "${token}" after appending the target-9 routing`,
        ).toBe(true);
      }
      expect(
        text.includes("includeContent"),
        `FR-FLOW-031 AC-1: ${root} kiwi-planner must NOT re-introduce includeContent`,
      ).toBe(false);

      const officialIndex = text.indexOf("workflow_pipeline_emit");
      const rawPipelineIndex = text.indexOf("./kiwi/pipeline.jsonl");
      expect(
        officialIndex,
        `FR-FLOW-031 AC-1: ${root} kiwi-planner must keep workflow_pipeline_emit`,
      ).toBeGreaterThanOrEqual(0);
      if (rawPipelineIndex >= 0) {
        expect(
          officialIndex,
          `FR-FLOW-031 AC-1: ${root} kiwi-planner must keep workflow_pipeline_emit before ./kiwi/pipeline.jsonl`,
        ).toBeLessThan(rawPipelineIndex);
      }
    });
  }

  // ---- AC-2: all three variants route planner-document ops through workflow_* tools ---------------
  for (const variant of VARIANTS) {
    it(`FR-FLOW-031 red :: AC-2 [${variant}] — routes planner-document operations through the workflow_* MCP tools`, () => {
      const text = plannerText(variant);

      // Every packaged variant must carry the routing policy section. Red driver: claude & etc lack it.
      expect(
        text.includes("Official Workflow Tool Policy"),
        `FR-FLOW-031 AC-2: ${variant} kiwi-planner must declare an Official Workflow Tool Policy routing planner-document operations through workflow_* tools`,
      ).toBe(true);
      expect(
        /workflow_[a-z_]+/.test(text),
        `FR-FLOW-031 AC-2: ${variant} kiwi-planner must reference the workflow_* MCP tool family`,
      ).toBe(true);
    });
  }

  it("FR-FLOW-031 red :: AC-2 [claude] — the claude variant, which currently invokes none, is brought into compliance", () => {
    const text = plannerText("claude");

    // claude invokes zero workflow_* tools today; compliance means it now routes BOTH reads and
    // mutations through the workflow_* family (net-new, also satisfying MIG-FLOW-003).
    expect(
      READ_TOOLS.some((t) => text.includes(t)),
      "FR-FLOW-031 AC-2: claude kiwi-planner must route reads through a workflow_* read tool",
    ).toBe(true);
    expect(
      MUTATE_TOOLS.some((t) => text.includes(t)),
      "FR-FLOW-031 AC-2: claude kiwi-planner must route checkbox mutations through a workflow_* mutate tool",
    ).toBe(true);
  });

  // ---- AC-3: raw docs/plans access documented as degraded fallback only (all three variants) ------
  for (const variant of VARIANTS) {
    it(`FR-FLOW-031 red :: AC-3 [${variant}] — documents raw docs/plans access as a degraded fallback only`, () => {
      const text = plannerText(variant);

      // Red driver: claude & etc have no degraded-fallback wording. Anchored on the SRS/MIG term
      // "degraded" co-occurring with a raw-file-access mention.
      const degradedFallback = windowsAround(text, DEGRADED, 400).some((w) => RAW_ACCESS.test(w));
      expect(
        degradedFallback,
        `FR-FLOW-031 AC-3: ${variant} kiwi-planner must document raw docs/plans file access as a degraded fallback only`,
      ).toBe(true);
    });
  }

  // ---- AC-3: validator.mjs plan-contract coverage preserved (always-green guard) ------------------
  it("FR-FLOW-031 red :: AC-3 — validator.mjs plan-contract coverage does not regress (28 makeCheck rule IDs, always-green guard)", () => {
    for (const rel of VALIDATOR_PATHS) {
      const text = readFileSync(path.join(REPO_ROOT, rel), "utf8");
      for (const id of EXPECTED_RULE_IDS) {
        expect(
          text.includes(`makeCheck('${id}'`),
          `FR-FLOW-031 AC-3: ${rel} must preserve plan-contract check makeCheck('${id}') (count not decreased)`,
        ).toBe(true);
      }
    }
  });
});
