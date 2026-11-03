import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// FR-FLOW-205 AC-8: every `NEEDS_USER` ending FR-FLOW-204/205 define is a declared critical gate, so
// no unattended mode turns it into `TASK_DONE`. Under `--auto`, `_shared/kiwi/auto-option.md` §4
// hands a NEEDS_USER gate missing from the skill's `critical_gates[]` to the decision committee;
// under kiwi-wave-master `--drive`, only the §7.5.1 closed list stays shut. So each stop has to be
// (1) named as `critical gate \`x\`` where the core block ends the run, (2) a row of that skill's
// gate table, (3) a row of the §7.5.1 closed list and (4) named in §7.5.3's journaling rule.
// The gate names are collected from the prose, not only from the list below, so a stop added later
// under a new name reddens here until all four places carry it.

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const ROOTS = ["skills/claude", "skills/codex", "skills/etc", ".agents/skills"] as const;
const read = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8").replace(/\r\n/g, "\n");
const exists = (rel: string): boolean => existsSync(path.join(REPO_ROOT, rel));

/** The stops each skill must declare, from FR-FLOW-205 AC-1 (unapproved), AC-2 (tampered), AC-7 (residual), AC-8 (cap). */
const REQUIRED: Record<string, readonly string[]> = {
  "kiwi-srs": [
    "prd-record-tampered",
    "prd-unapproved-user-decision",
    "prd-residual-user-decision",
    "prd-cap-unpassed-user-decision"
  ],
  "kiwi-tdd": ["prd-unapproved-user-decision", "prd-residual-user-decision"]
};

const skillText = (root: string, skill: string): string =>
  [`${root}/${skill}/SKILL.md`, `${root}/${skill}/references/extended-workflow.md`].filter(exists).map(read).join("\n");

/** The core block ("## 핵심 규칙 …" up to the next "\n---"). */
const coreBlock = (skill: string): string => {
  const start = skill.indexOf("## 핵심 규칙");
  expect(start, "precondition: core block exists").toBeGreaterThanOrEqual(0);
  const end = skill.indexOf("\n---", start);
  return skill.slice(start, end < 0 ? skill.length : end);
};

/** First-column ids of the table whose header row starts with `| gate_id |`. */
const gateTable = (skill: string): Set<string> => {
  const lines = skill.split("\n");
  const at = lines.findIndex((l) => l.startsWith("| gate_id |"));
  expect(at, "precondition: a gate_id table exists").toBeGreaterThanOrEqual(0);
  const ids = new Set<string>();
  for (let i = at + 2; i < lines.length && lines[i].startsWith("|"); i++) {
    const m = /^\| `([a-z0-9-]+)` \|/.exec(lines[i]);
    if (m) ids.add(m[1]);
  }
  return ids;
};

const namedGates = (text: string): Set<string> =>
  new Set([...text.matchAll(/critical gate `([a-z0-9-]+)`/g)].map((m) => m[1]));

/** Sentences that end the run NEEDS_USER (split at ". ", "; " and line ends). */
const endingSentences = (text: string): string[] =>
  text.split(/\.\s+|;\s+|\n/).filter((s) => /`NEEDS_USER` 로 (끝나|끝난|멈춘다|멈추며)/.test(s));

const section = (text: string, heading: string): string => {
  const at = text.indexOf(heading);
  expect(at, `precondition: ${heading}`).toBeGreaterThanOrEqual(0);
  const end = text.indexOf("\n#### ", at + 1);
  return text.slice(at, end < 0 ? text.length : end);
};

const prdGatesOf = (root: string): Set<string> => {
  const all = new Set<string>();
  for (const skill of Object.keys(REQUIRED)) {
    for (const g of namedGates(skillText(root, skill))) all.add(g);
    for (const g of REQUIRED[skill]) all.add(g);
  }
  return all;
};

describe("FR-FLOW-205 AC-8 — every PRD NEEDS_USER ending is a declared critical gate", () => {
  for (const root of ROOTS) {
    for (const skill of Object.keys(REQUIRED)) {
      // @req FR-FLOW-205 AC-8
      it(`${root}/${skill}: each ending in the core block names its critical gate`, () => {
        const core = coreBlock(read(`${root}/${skill}/SKILL.md`));
        const endings = endingSentences(core);
        expect(endings.length).toBeGreaterThan(0);
        for (const s of endings) {
          expect(/critical gate `[a-z0-9-]+`/.test(s) && /--auto/.test(s), `ending without --auto critical gate: ${s}`).toBe(true);
        }
        const named = namedGates(core);
        for (const g of REQUIRED[skill]) expect(named.has(g), `${g} not named in the core block`).toBe(true);
      });

      // @req FR-FLOW-205 AC-8
      it(`${root}/${skill}: every PRD gate the prose names is a row of its gate table`, () => {
        const table = gateTable(read(`${root}/${skill}/SKILL.md`));
        const names = new Set([...namedGates(skillText(root, skill)), ...REQUIRED[skill]]);
        for (const g of names) expect(table.has(g), `${root}/${skill}: ${g} missing from the gate table`).toBe(true);
      });
    }

    // @req FR-FLOW-205 AC-8 — the round-cap sentences name the cap gate wherever they appear.
    it(`${root}/kiwi-srs: every round-cap NEEDS_USER sentence names prd-cap-unpassed-user-decision`, () => {
      const caps = skillText(root, "kiwi-srs")
        .split(/\.\s+|;\s+|\n/)
        .filter((l) => /라운드 상한/.test(l) && /NEEDS_USER/.test(l) && /TASK_DONE/.test(l));
      expect(caps.length).toBeGreaterThan(0);
      for (const l of caps) expect(l, "cap sentence").toContain("`prd-cap-unpassed-user-decision`");
    });

    // @req FR-FLOW-205 AC-8 — kiwi-step has no --auto, so auto-option §1 keeps its PRD stops away from the committee.
    it(`${root}/kiwi-step: has no --auto path that could settle its PRD stops`, () => {
      const rel = `${root}/kiwi-step/SKILL.md`;
      if (!exists(rel)) return;
      expect(read(rel)).not.toMatch(/--auto\b/);
    });

    const wm = `${root}/kiwi-wave-master/SKILL.md`;
    if (!exists(wm)) continue;

    // @req FR-FLOW-205 AC-8 — --drive keeps every PRD stop shut and journals it as §7.5.3 says.
    it(`${root}/kiwi-wave-master: §7.5.1 closed list and §7.5.3 carry every PRD gate`, () => {
      const text = read(wm);
      const closed = section(text, "#### 7.5.1");
      const journal = section(text, "#### 7.5.3");
      for (const g of prdGatesOf(root)) {
        expect(closed.split("\n").some((l) => l.startsWith(`| \`${g}\` |`)), `§7.5.1 lacks ${g}`).toBe(true);
        expect(journal, `§7.5.3 lacks ${g}`).toContain(`\`${g}\``);
      }
    });
  }
});
