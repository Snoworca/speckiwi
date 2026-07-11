import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// @req FR-FLOW-022
// FR-FLOW-022 — Single current-model verification subagent across kiwi skills (remove --mini).
//
// RED-phase content assertions (T-PH001-01). These assert the FINAL desired state and
// therefore FAIL until T-PH001-02 removes the `--mini` option + `_shared/kiwi/mini-option.md`
// SSOT and authors the single current-session-model verification wording, and PH-006/T-PH006-01
// re-syncs the installed `.agents/skills/` codex mirror.
//
// A SKILL.md is natural-language agent instruction, not executable code, so behavior is verified
// by raw-text presence/absence assertions (FR-FLOW-014 kiwi-step precedent), not skill execution.
// Assertions key on language-neutral technical tokens (`--mini`, `mini-option`, `--model`) plus a
// bilingual (English / Korean) regex for the "current session model" concept, so the Korean
// canonical (claude) variant and the English mirror (codex) are validated by the same checks.

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

// AC-2 / AC-3 presence is SCOPED to the claude + codex variants only: they carry the Opus+Sonnet
// dual-model evaluator panels being collapsed. skills/etc has no Opus/Sonnet/--model wording and
// T-PH001-02 edits zero skills/etc files, so a repo-wide presence assertion is unsatisfiable there.
const PRESENCE_VARIANTS = ["claude", "codex"] as const;

// skills/etc/MIGRATION_PLAN.md is out of the absence scope BY CONSTRUCTION — it is not a SKILL.md,
// not under _shared/kiwi/, and not under references/, so the inclusion globs below never select it.
// This constant keeps that carve-out EXPLICIT (per the plan) and defensive: were the inclusion globs
// ever broadened, this filter would still keep the historical migration doc's lone `--mini` excluded.
const MIGRATION_DOC = path.resolve(REPO_ROOT, "skills", "etc", "MIGRATION_PLAN.md");

// All three copies of the shared mini-option SSOT that AC-1 requires to be gone: the two source
// copies (claude + codex) and the installed mirror's third copy under .agents/skills.
const THREE_MINI_OPTION_COPIES = [
  path.join(REPO_ROOT, "skills", "claude", "_shared", "kiwi", "mini-option.md"),
  path.join(REPO_ROOT, "skills", "codex", "_shared", "kiwi", "mini-option.md"),
  path.join(REPO_ROOT, ".agents", "skills", "_shared", "kiwi", "mini-option.md"),
];

/** Recursively list every file under `dir`; returns [] when the directory does not exist. */
function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}

function relPosix(f: string): string {
  return toPosix(path.relative(REPO_ROOT, f));
}

/**
 * AC-1 repo-wide absence scope: every skills/**\/SKILL.md, every skills/**\/_shared/kiwi/** SSOT
 * doc, every skills/**\/references/**.md, AND every .agents/skills/** file (the git-tracked
 * installed codex mirror) — minus ONLY skills/etc/MIGRATION_PLAN.md.
 */
function absenceScopeFiles(): string[] {
  const inSkills = walk(path.join(REPO_ROOT, "skills")).filter((f) => {
    const posix = toPosix(f); // absolute path in POSIX form; the substring probes below are anchor-agnostic
    if (path.basename(f) === "SKILL.md") return true;
    if (posix.includes("/_shared/kiwi/")) return true;
    if (/\/references\/.*\.md$/.test(posix)) return true;
    return false;
  });
  const inAgents = walk(path.join(REPO_ROOT, ".agents", "skills")); // every file in the installed mirror
  return [...inSkills, ...inAgents].filter((f) => path.resolve(f) !== MIGRATION_DOC);
}

/**
 * AC-2 / AC-3 presence file texts for a variant: its kiwi skill bodies (SKILL.md), reference docs,
 * and _shared/kiwi SSOT docs — EXCLUDING mini-option.md. mini-option.md is deleted at green and
 * today holds the only stray `--model` in the tree, so excluding it keeps the RED assertion
 * genuinely red now while staying satisfiable wherever T-PH001-02 lands the new wording. Returned
 * per-file (not concatenated) so proximity checks cannot bleed tokens across file boundaries.
 */
function presenceFiles(variant: string): string[] {
  const files = walk(path.join(REPO_ROOT, "skills", variant)).filter((f) => {
    if (path.basename(f) === "mini-option.md") return false;
    const posix = toPosix(f); // absolute path in POSIX form; the substring probes below are anchor-agnostic
    if (path.basename(f) === "SKILL.md") return true;
    if (posix.includes("/_shared/kiwi/")) return true;
    if (/\/references\/.*\.md$/.test(posix)) return true;
    return false;
  });
  return files.map((f) => readFileSync(f, "utf8"));
}

/** Text windows of +/- `radius` chars around every match of `re` within a single `text`. */
function windowsAround(text: string, re: RegExp, radius = 120): string[] {
  const g = new RegExp(re.source, re.flags.replace("g", "") + "g");
  const out: string[] = [];
  for (let m = g.exec(text); m; m = g.exec(text)) {
    out.push(text.slice(Math.max(0, m.index - radius), m.index + m[0].length + radius));
    if (g.lastIndex === m.index) g.lastIndex++;
  }
  return out;
}

const MINI_TOKEN = /--mini\b|mini-option/;
const CURRENT_SESSION_MODEL = /current[\s-]?session[\s-]?model|현재\s*세션\s*(의\s*)?모델/i;
const SINGLE_TOKEN = /\bsingle\b|단일|하나의/i;
const SUBAGENT_TOKEN = /subagent|서브에이전트/i;
const MODEL_FLAG = /--model\b/;

describe("FR-FLOW-022 — remove --mini, single current-model verification subagent", () => {
  it("AC-1: --mini/mini-option absent repo-wide and all three mini-option.md copies removed", () => {
    const offenders: string[] = [];
    for (const f of absenceScopeFiles()) {
      if (MINI_TOKEN.test(readFileSync(f, "utf8"))) offenders.push(relPosix(f));
    }
    expect(
      offenders,
      `FR-FLOW-022 AC-1: content still references --mini/mini-option in: ${offenders.join(", ")}`,
    ).toEqual([]);

    for (const copy of THREE_MINI_OPTION_COPIES) {
      expect(
        existsSync(copy),
        `FR-FLOW-022 AC-1: mini-option.md SSOT copy must be removed: ${relPosix(copy)}`,
      ).toBe(false);
    }
  });

  for (const variant of PRESENCE_VARIANTS) {
    it(`AC-2 [${variant}]: a single verification subagent runs on the current session model`, () => {
      // Discriminating co-occurrence: within one file, a window around a "current session model"
      // mention must also carry SINGLE + SUBAGENT wording, so GREEN cannot pass merely by adding an
      // unrelated "current session model" phrase without describing the single verification subagent
      // that replaces the Opus×1+Sonnet×1 dual-model evaluator panels.
      const tied = presenceFiles(variant).some((text) =>
        windowsAround(text, CURRENT_SESSION_MODEL, 100).some(
          (win) => SINGLE_TOKEN.test(win) && SUBAGENT_TOKEN.test(win),
        ),
      );
      expect(
        tied,
        `FR-FLOW-022 AC-2: ${variant} kiwi skills must describe a SINGLE verification subagent running on the current session model (replacing the Opus×1+Sonnet×1 dual-model evaluator panels)`,
      ).toBe(true);
    });

    it(`AC-3 [${variant}]: a --model override selects the verification subagent model`, () => {
      // Tie --model to the verification subagent it selects the model for (mirrors AC-2's
      // discriminating proximity), so an unrelated stray --model mention cannot satisfy AC-3.
      const tied = presenceFiles(variant).some((text) =>
        windowsAround(text, MODEL_FLAG, 160).some((win) => SUBAGENT_TOKEN.test(win)),
      );
      expect(
        tied,
        `FR-FLOW-022 AC-3: ${variant} kiwi skills must document the --model override selecting the verification subagent's model`,
      ).toBe(true);
    });
  }
});

// ---------------------------------------------------------------------------
// FR-FLOW-022 AC-2 — operational evaluator/verifier topology tables (T-PH001-02 gap)
// ---------------------------------------------------------------------------
// The §0.x SSOT + frontmatter were collapsed to the single current-session-model verification
// subagent, but the OPERATIONAL topology tables (kiwi-srs §10.4, feasibility §8.4, from-code §8.1,
// review-fix-loop/hot-fix §1.3) must not re-introduce the OLD DUAL-MODEL EVALUATOR PANEL — the
// collapsed Opus×1 harsh-review + Sonnet×1 formal-check pair that hardcoded two DIFFERENT fixed
// model tiers onto the verifier roles. AC-2 requires those tables to carry no live dual-model panel.
//
// PRECISION: SECTION-SCOPED to the specific topology table under a named heading. The offender
// signature is ">=2 DISTINCT fixed model tiers in one table" (the "서로 다른 고정 모델" dual panel),
// NOT "any model tier". A SINGLE cheap-fixed tier is allowed: the hot-fix §1.3 table legitimately
// annotates its Sonnet root-cause pre-investigation / TDD row while keeping the formal-check +
// harsh-review verifier cells on the current session model — exactly kiwi-coder §1.3, which pairs
// "TDD 검증 (Sonnet)" with "정형 검사 (현재 세션 모델)" in one table. Flagging that lone Sonnet would
// be a false-red. These checks still do NOT scan trigger descriptions, the historical
// "replaces Opus×1+Sonnet×1" SSOT note, phase-flow blocks, or authoring roles.

const VARIANTS = ["claude", "codex", "etc"] as const;

// Model-tier tokens across the three variant vocabularies (claude / codex / etc).
const MODEL_TIER =
  /\bOpus\b|\bSonnet\b|high-reasoning|\bstandard\b|\blightweight\b|local evaluator|local-LLM max-profile/;

// The old 3-slot evaluator-panel enum signature "<tier>-A|<tier>-B|<tier>-C" (kiwi-srs §10.3).
const PANEL_ENUM = /"evaluator":\s*"[^"]*-A\|[^"]*-B\|[^"]*-C"/;

// Each skill's evaluator/verifier topology table lives under one of these headings. Per variant the
// table sits either inline in SKILL.md (claude) or in references/extended-workflow.md (codex/etc);
// review-fix-loop/hot-fix have the table only in the claude variant.
const TOPOLOGY_TARGETS = [
  { skill: "kiwi-srs", heading: /^###\s*10\.4\s+토폴로지/ },
  { skill: "kiwi-srs-feasibility", heading: /^###\s*8\.4\s+토폴로지/ },
  { skill: "kiwi-srs-from-code", heading: /^###\s*8\.1\s+검증자 4종/ },
  { skill: "kiwi-review-fix-loop", heading: /^###\s*1\.3\s+모드 매트릭스/ },
  { skill: "kiwi-hot-fix", heading: /^###\s*1\.3\s+모드 매트릭스/ },
] as const;

/** Candidate docs that could hold a skill's operational table: SKILL.md + references/extended-workflow.md. */
function skillDocs(variant: string, skill: string): { rel: string; text: string }[] {
  const candidates = [
    path.join(REPO_ROOT, "skills", variant, skill, "SKILL.md"),
    path.join(REPO_ROOT, "skills", variant, skill, "references", "extended-workflow.md"),
  ];
  return candidates
    .filter(existsSync)
    .map((f) => ({ rel: relPosix(f), text: readFileSync(f, "utf8") }));
}

/** First contiguous markdown-table block after the line matching `headingRe`; "" if the section has none. */
function tableAfterHeading(text: string, headingRe: RegExp): string {
  const lines = text.split(/\r?\n/);
  let i = lines.findIndex((l) => headingRe.test(l));
  if (i < 0) return "";
  i++;
  // Skip prose/blank lines until the table starts; bail if the next heading arrives first (no table).
  while (i < lines.length && !/^\s*\|/.test(lines[i])) {
    if (/^#{1,6}\s/.test(lines[i])) return "";
    i++;
  }
  const block: string[] = [];
  while (i < lines.length && /^\s*\|/.test(lines[i])) block.push(lines[i++]);
  return block.join("\n");
}

/**
 * Distinct fixed model-tier tokens present in a topology `table` (lower-cased, de-duplicated).
 * A dual-model evaluator panel (Opus harsh-review + Sonnet formal-check) surfaces as >=2 DISTINCT
 * fixed tiers in one table. A lone cheap-fixed tier — e.g. the Sonnet root-cause/TDD row that
 * coexists with current-session verifier cells (kiwi-coder §1.3 pattern) — yields ONE distinct tier
 * and is allowed, so a table is an offender only when this set has length >= 2.
 */
function distinctModelTiers(table: string): string[] {
  const g = new RegExp(MODEL_TIER.source, "g");
  const seen = new Set<string>();
  for (let m = g.exec(table); m; m = g.exec(table)) {
    seen.add(m[0].toLowerCase());
    if (g.lastIndex === m.index) g.lastIndex++;
  }
  return [...seen];
}

describe("FR-FLOW-022 AC-2 — operational evaluator topology tables carry no live dual-model panel", () => {
  for (const { skill, heading } of TOPOLOGY_TARGETS) {
    it(`${skill}: the evaluator/verifier topology table carries no dual-model panel`, () => {
      const offenders: string[] = [];
      for (const variant of VARIANTS) {
        for (const doc of skillDocs(variant, skill)) {
          const table = tableAfterHeading(doc.text, heading);
          // Offender = the dual-model evaluator panel: >=2 DISTINCT fixed model tiers hardcoded in one
          // table. A single cheap-fixed Sonnet (root-cause pre-investigation / TDD) alongside
          // current-session verifier cells is the legitimate kiwi-coder §1.3 pattern, not an offender.
          if (table && distinctModelTiers(table).length >= 2) offenders.push(doc.rel);
        }
      }
      expect(
        offenders,
        `FR-FLOW-022 AC-2: ${skill} evaluator/verifier topology table still hardcodes a dual-model panel (>=2 distinct fixed model tiers) in: ${offenders.join(", ")} — verifier roles (formal-check + harsh-review) must run on the single current-session model; only a lone cheap-fixed Sonnet pre-investigation/TDD tier may remain`,
      ).toEqual([]);
    });
  }

  it("kiwi-srs: the §10.3 output-schema enum drops the 3-slot evaluator-panel signature", () => {
    const offenders: string[] = [];
    for (const variant of VARIANTS) {
      for (const doc of skillDocs(variant, "kiwi-srs")) {
        if (PANEL_ENUM.test(doc.text)) offenders.push(doc.rel);
      }
    }
    expect(
      offenders,
      `FR-FLOW-022 AC-2: kiwi-srs §10.3 evaluator enum still declares the "<tier>-A|<tier>-B|<tier>-C" dual-model panel in: ${offenders.join(", ")}`,
    ).toEqual([]);
  });
});
