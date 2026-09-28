import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "./kiwi-orchestrator-variants.js";
import { ANOTHER_VERIFIER, MULTI_VERIFIER, ONE_VERIFIER, bulletLabel, defaultFanoutBullets, maxFanoutBullets } from "./verifier-count.js";

// @req FR-FLOW-180 — kiwi-srs and kiwi-srs-feasibility verify with one subagent by default and fan
// verification out only under --max.
//
// AC-1 and AC-2 retired in 4.0.0 with kiwi-planner; kiwi-sds, which replaced it, follows FR-FLOW-182
// AC-4 and is held by kiwi-sds.fr-flow-182.test.ts. AC-3 is asserted per bullet of the fan-out list in
// kiwi-srs-research-loop-content.test.ts (FR-FLOW-023 AC-5 as amended). This suite holds what that
// suite cannot see from one section: every document of the two skills, the etc variant, and the mirror.

const SKILLS = ["kiwi-srs", "kiwi-srs-feasibility"] as const;
const VARIANTS = ["claude", "codex", "etc"] as const;
const VARIANT_ROOTS = ["skills/claude", "skills/codex", "skills/etc", ".agents/skills"] as const;

function read(relPath: string): string {
  return readFileSync(path.join(REPO_ROOT, relPath), "utf8");
}

/** Every Markdown document of `skill` under `root`, the SKILL.md summary description included. */
function skillDocs(root: string, skill: string): string[] {
  const dir = path.join(REPO_ROOT, root, skill);
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  const walk = (abs: string): void => {
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      const next = path.join(abs, entry.name);
      if (entry.isDirectory()) walk(next);
      else if (entry.name.endsWith(".md")) out.push(path.relative(REPO_ROOT, next).split(path.sep).join("/"));
    }
  };
  walk(dir);
  return out;
}

const ALL_DOCS = VARIANT_ROOTS.flatMap((root) => SKILLS.flatMap((skill) => skillDocs(root, skill)));

/** The file carrying kiwi-srs §9.6 in each variant: claude keeps it inline, the others in the reference. */
function researchLoopCarrier(variant: (typeof VARIANTS)[number]): string {
  return variant === "claude" ? "skills/claude/kiwi-srs/SKILL.md" : `skills/${variant}/kiwi-srs/references/extended-workflow.md`;
}

describe("FR-FLOW-180 AC-4 — each main verification phase stays single-verifier by default", () => {
  // The phase-overview line an agent reads before the phase itself. claude/codex name the single
  // current-session-model verification subagent; etc names its single delegated evaluator.
  const MAIN_PHASE: Record<(typeof SKILLS)[number], RegExp> = {
    "kiwi-srs": /^Phase 5\s+: Verification \((.*)\)\s*$/m,
    "kiwi-srs-feasibility": /^Phase 5\s+: (?:Verification|Evaluation) \((.*)\)\s*$/m
  };
  /** The default before any `; Max:` clause. */
  const defaultPart = (clause: string): string => clause.split(/;\s*Max\b/)[0] ?? "";
  const SINGLE = /단일[^\n]{0,16}(?:서브에이전트|평가자)|single\s+delegated\s+evaluator/i;

  for (const variant of VARIANTS) {
    for (const skill of SKILLS) {
      it(`${variant}/${skill} states one verifier for its main verification phase`, () => {
        const match = read(`skills/${variant}/${skill}/SKILL.md`).match(MAIN_PHASE[skill]);
        expect(match, "the main verification phase line was not found").not.toBeNull();
        const def = defaultPart(match?.[1] ?? "");
        expect(SINGLE.test(def) || ONE_VERIFIER.test(def), "the default verifier of the main phase is not a single one").toBe(true);
        expect(MULTI_VERIFIER.test(def), "the main phase states more than one default verifier").toBe(false);
      });
    }
  }

  // The operative rows the phase body states, not only the overview line: the evaluator table's
  // `| Normal |` row and a `- Normal:` line that names a verifier.
  it.each(ALL_DOCS)("%s states one verifier on every Normal row that names one", (relPath) => {
    const rows = read(relPath)
      .split(/\r?\n/)
      .filter((line) => /^\|\s*Normal\s*\|/.test(line) || /^-\s*Normal\s*:/.test(line))
      .filter((line) => /서브에이전트|평가자|evaluator|subagent/i.test(line));
    for (const row of rows) {
      const statement = row.startsWith("|") ? (row.split("|")[2] ?? "") : row;
      expect(SINGLE.test(statement) || ONE_VERIFIER.test(statement), `a Normal row does not state one verifier: ${row}`).toBe(true);
      expect(MULTI_VERIFIER.test(statement), `a Normal row states more than one verifier: ${row}`).toBe(false);
      expect(/병렬|parallel/i.test(statement), `a Normal row runs verifiers in parallel: ${row}`).toBe(false);
      // "× 2" and a second named verifier ("+ 독립 2차 검증 서브에이전트") are how the adjacent --max rows
      // state their strengthening; a Normal row carries neither.
      expect(/×\s*(?:[2-9]|\d{2,})/.test(statement), `a Normal row multiplies its verifier: ${row}`).toBe(false);
      expect(statement.includes("+") || ANOTHER_VERIFIER.test(statement), `a Normal row adds a second verifier: ${row}`).toBe(false);
    }
  });
});

describe("FR-FLOW-180 AC-5 — no document states a default-mode fan-out above one, and the mirror is regenerated", () => {
  it("scans a non-empty set that includes every variant and the mirror", () => {
    for (const root of VARIANT_ROOTS) {
      for (const skill of SKILLS) {
        expect(ALL_DOCS, `${root}/${skill}/SKILL.md is missing from the scan`).toContain(`${root}/${skill}/SKILL.md`);
      }
    }
  });

  // The superseded default-mode statements, as they were written before FR-FLOW-180. This catches a
  // literal revert anywhere. Inside §9.6 the FR-FLOW-023 suite also reads every non-max line for a
  // stated count above one or an added verifier; a reworded claim outside that section that is neither
  // a Normal row nor a phase-overview line is not caught.
  const SUPERSEDED = [
    "문서별로 순차", // kiwi-srs §9.6: non-max spawned one verifier per document
    "sequential, per document"
  ];
  it.each(ALL_DOCS)("%s states no superseded default-mode fan-out", (relPath) => {
    const text = read(relPath);
    for (const phrase of SUPERSEDED) {
      expect(text, `the superseded default-mode fan-out "${phrase}" remains`).not.toContain(phrase);
    }
  });

  // etc treats `--max` as its default (skills/etc/_shared/kiwi/local-llm-profile.md), so in etc the
  // --max rows are what runs. Its non-max rows must say so and its --max rows must be labelled, or a
  // local model reading "기본" as "what runs by default" takes the one-verifier row and weakens --max.
  // The premise (etc treats --max as its default, stated as a cause) and the routing (which statement
  // actually runs) are asserted separately: a premise alone stayed green when the routing clause was
  // deleted or pointed back at the non-max statement.
  const ETC_PREMISE = /etc[^\n]{0,8}`--max`[^\n]{0,20}기본으로\s*(?:취급|간주)하므로/;
  const ETC_DEFAULT_LABEL = /etc\s*기본/;

  it("etc kiwi-srs §9.6 routes its default runs to the --max bullets", () => {
    const text = read(researchLoopCarrier("etc"));
    const [def] = defaultFanoutBullets(text);
    expect(def ?? "", "the non-max bullet does not state that etc treats --max as its default").toMatch(ETC_PREMISE);
    expect(def ?? "", "the non-max bullet does not route etc runs to the --max rows").toMatch(
      /실제\s*실행에는\s*아래\s*`--max`\(etc\s*기본\)\s*행이\s*적용된다/
    );
    const maxBullets = maxFanoutBullets(text);
    expect(maxBullets.length, "the fan-out list names no --max bullet").toBeGreaterThan(0);
    for (const bullet of maxBullets) {
      expect(bulletLabel(bullet), "a --max bullet's label does not name it the etc default").toMatch(ETC_DEFAULT_LABEL);
    }
  });

  it.each(["kiwi-srs/SKILL.md", "kiwi-srs/references/extended-workflow.md"])(
    "the mirror's %s matches skills/codex",
    (rel) => {
      expect(read(`.agents/skills/${rel}`)).toBe(read(`skills/codex/${rel}`));
    }
  );
});
