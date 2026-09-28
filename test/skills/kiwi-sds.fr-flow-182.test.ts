import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { BUNDLED_SDS_RULES_FILENAME, BUNDLED_SDS_RULES_VERSION } from "../../src/core/bootstrap/templates.js";
import { EXPECTED_KIWI_SKILLS } from "../../src/doctor/package-doctor.js";
import { REPO_ROOT, criticalGateRows, section, stripFrontmatter, tableRows } from "./kiwi-orchestrator-variants.js";
import { RENDERINGS, flat, markdownFiles, readRepoFile } from "./kiwi-renderings.js";

// @req FR-FLOW-182 — kiwi-sds authors one lite SDS for the requirements in scope and checks it
// deterministically.
//
// The skill body is read by its numbered sections, which are language-neutral: §0 (rules and the
// critical_gates table), §1.1 (inputs), §2 (authoring). Each rendering is read on its own — claude is
// Korean, codex, etc and the `.agents` mirror are English — so every prose check carries both
// spellings. The mirror rows stay red until `speckiwi skills mirror --write` regenerates it.

const SKILL = "kiwi-sds";

function skillPath(rendering: string): string {
  return `${rendering}/${SKILL}/SKILL.md`;
}

function body(rendering: string): string {
  return stripFrontmatter(readRepoFile(skillPath(rendering)).replace(/\r\n/g, "\n"));
}

/** §N of the body, up to the next heading of the same depth. */
function part(rendering: string, heading: RegExp): string {
  return section(body(rendering), heading);
}

/** Every table row of `text`, cells joined, so a rule is read inside the row that states it. */
function rows(text: string): string[] {
  return tableRows(text).map((row) => row.cells.join(" | "));
}

/**
 * The §0 rule rows — first cell `§0.<n>` — and not the critical-gate rows that share the section: a
 * gate row names `agreed` and a negation for its own reason, which would answer for an inverted rule.
 */
function ruleRows(rendering: string): string[] {
  return tableRows(part(rendering, /^##\s*0\./))
    .filter((row) => /^§0\.\d+$/.test(row.cells[0] ?? ""))
    .map((row) => row.cells.join(" | "));
}

/** Paragraphs and list items of `text` (blank-line or bullet separated), whitespace flattened. */
function blocks(text: string): string[] {
  return text
    .split(/\n\s*\n|\n(?=\s*(?:[-*]|\d+\.)\s)/)
    .map((block) => flat(block).trim())
    .filter((block) => block !== "");
}

const NEGATION = /없다|않는다|않고|않으며|하지 않|금지|\bno\b|\bnot\b|\bnever\b|\bwithout\b/i;

/**
 * The sentences of rows or blocks. A rule and its negation must sit in ONE sentence: a row that says
 * "X. Y does not Z." would otherwise let X be inverted while the unrelated negation keeps it green.
 */
function sentences(texts: readonly string[]): string[] {
  return texts.flatMap((text) => text.split(/(?<=\.)\s+|\s\|\s/)).map((sentence) => sentence.trim());
}

describe("FR-FLOW-182 AC-1 — kiwi-sds ships in every rendering and in the package doctor's list", () => {
  it.each(RENDERINGS)("%s carries kiwi-sds/SKILL.md named kiwi-sds", (rendering) => {
    const text = readRepoFile(skillPath(rendering));
    expect(text, `${skillPath(rendering)} is missing`).not.toBe("");
    expect(/^---\s*\nname:\s*kiwi-sds\s*\n/.test(text.replace(/\r\n/g, "\n")), `${skillPath(rendering)}: frontmatter name is not kiwi-sds`).toBe(
      true
    );
  });

  it("codex carries the agents/openai.yaml UI metadata naming $kiwi-sds", () => {
    const yaml = readRepoFile("skills/codex/kiwi-sds/agents/openai.yaml");
    expect(yaml).toContain("display_name:");
    expect(yaml).toContain("$kiwi-sds");
  });

  it("EXPECTED_KIWI_SKILLS lists kiwi-sds", () => {
    expect(EXPECTED_KIWI_SKILLS).toContain(SKILL);
  });
});

describe("FR-FLOW-182 AC-2 — one lite SDS file, its shape cited from the SDS rules rather than restated", () => {
  it.each(RENDERINGS)("%s: writes docs/sds/<sds-id>.sds.md", (rendering) => {
    expect(part(rendering, /^##\s*1\./)).toContain("docs/sds/<sds-id>.sds.md");
    expect(part(rendering, /^##\s*2\./)).toContain("docs/sds/<sds-id>.sds.md");
  });

  it.each(RENDERINGS)("%s: takes a target or a requirement filter as its scope", (rendering) => {
    const inputs = rows(part(rendering, /^###\s*1\.1\b/));
    expect(inputs.some((row) => /`TARGET`/.test(row)), `${rendering}: no TARGET input row`).toBe(true);
    expect(inputs.some((row) => /`--req-filter/.test(row)), `${rendering}: no --req-filter input row`).toBe(true);
    expect(inputs.some((row) => /`--sds-id/.test(row)), `${rendering}: no --sds-id input row`).toBe(true);
  });

  it.each(RENDERINGS)("%s: cites the lite profile of the SDS rules document by path", (rendering) => {
    const text = body(rendering);
    expect(
      /docs\/rule\/SDS-MD-Rules-v\d+\.\d+\.\d+\.md`?\s*§9\b/.test(text),
      `${rendering}: the SDS rules document is not cited with its §9 lite profile`
    ).toBe(true);
  });

  it.each(RENDERINGS)("%s: names the lite metadata and the three sections the SDS carries", (rendering) => {
    const authoring = flat(part(rendering, /^##\s*2\./));
    for (const token of ["`Document Type`", "`sds`", "`Profile`", "`lite`", "`Target`", "`Status`", "`Date`"]) {
      expect(authoring, `${rendering}: the authoring section does not name metadata ${token}`).toContain(token);
    }
    for (const heading of ["## Interfaces", "### Depends", "### Files", "## Acceptance Contracts", "## Test Plan"]) {
      expect(authoring, `${rendering}: the authoring section does not name ${heading}`).toContain(heading);
    }
  });

  it.each(RENDERINGS)("%s: holds the 100-line cap", (rendering) => {
    const authoring = blocks(part(rendering, /^##\s*2\./));
    expect(
      authoring.some((block) => /\b100\b/.test(block) && /줄|lines?\b/i.test(block) && /상한|cap/i.test(block)),
      `${rendering}: no authoring rule states the 100-line cap`
    ).toBe(true);
  });

  it.each(RENDERINGS)("%s: does not copy the grammar or the template into the skill", (rendering) => {
    const text = body(rendering);
    // The template's metadata rows and its Depends chain are the grammar's surface; a copy of either
    // is the second copy FR-FLOW-182 forbids.
    expect(text, `${rendering}: the lite metadata table is copied into the skill`).not.toMatch(/^\|\s*Profile\s*\|\s*lite\s*\|/m);
    expect(text, `${rendering}: the SDS-E06x diagnostic table is copied into the skill`).not.toMatch(/SDS-E06[0-7]/);
  });
});

describe("FR-FLOW-182 AC-3 — every in-scope requirement is named, every decision is a contract, every contract has a test", () => {
  it.each(RENDERINGS)("%s: every in-scope requirement ID is named with @req", (rendering) => {
    const authoring = blocks(part(rendering, /^##\s*2\./));
    expect(
      authoring.some(
        (block) => /`@req`/.test(block) && /모든 요구 ID|every in-scope requirement|every requirement ID in (?:the )?scope/i.test(block)
      ),
      `${rendering}: no authoring rule names every in-scope requirement with @req`
    ).toBe(true);
    // The deterministic half of the rule: the `Requirements` metadata row makes SDS-E070 refuse an
    // in-scope id no `@req` names (SDS rules §9.2), so the coverage is not left to a comparison by eye.
    expect(
      authoring.some((block) => /`Requirements`/.test(block) && /SDS-E070/.test(block)),
      `${rendering}: the authoring rules do not write the Requirements row that SDS-E070 checks`
    ).toBe(true);
    // SDS-E070 is per file, so a split SDS needs the union of its pieces' rows checked against the scope.
    const check = blocks(part(rendering, /^###\s*2\.4\b/));
    expect(
      check.some((block) => /`Requirements`/.test(block) && /합친|union/i.test(block)),
      `${rendering}: a split SDS's scope coverage across its pieces is not checked`
    ).toBe(true);
  });

  it.each(RENDERINGS)("%s: an interpretation decision is written in the contract shape", (rendering) => {
    expect(part(rendering, /^##\s*2\./)).toContain("`SDS-AC-n (<REQ-ID> AC-m): WHEN … THE SYSTEM SHALL …`");
  });

  it.each(RENDERINGS)("%s: every SDS-AC has a Test Plan row naming a test file", (rendering) => {
    const authoring = blocks(part(rendering, /^##\s*2\./));
    expect(
      authoring.some((block) => /모든 SDS-AC|every SDS-AC/i.test(block) && /Test Plan/.test(block) && /테스트 파일|test file/i.test(block)),
      `${rendering}: no authoring rule gives every SDS-AC a Test Plan row naming a test file`
    ).toBe(true);
  });
});

describe("FR-FLOW-182 AC-4 — the deterministic check gates agreement, and --max adds exactly one verifier pass", () => {
  it.each(RENDERINGS)("%s: names the check on both surfaces", (rendering) => {
    const text = body(rendering);
    expect(text).toContain("check_sds");
    expect(text).toMatch(/speckiwi sds check docs\/sds\/<sds-id>\.sds\.md --json|speckiwi sds check <path> --json/);
  });

  it.each(RENDERINGS)("%s: no Status agreed while a check error remains", (rendering) => {
    const rules = ruleRows(rendering).filter((row) => /check_sds/.test(row));
    expect(
      sentences(rules).some((sentence) => /`agreed`/.test(sentence) && /오류|error/i.test(sentence) && NEGATION.test(sentence)),
      `${rendering}: the §0 rule tying agreement to a clean check is missing or inverted`
    ).toBe(true);
    const gates = criticalGateRows(body(rendering)).map((row) => row.gateId);
    expect(gates, `${rendering}: the unresolved-check gate is not declared critical`).toContain("sds-check-errors-unresolved");
  });

  it.each(RENDERINGS)("%s: the default mode runs no LLM verification loop", (rendering) => {
    const rules = sentences(ruleRows(rendering));
    expect(
      rules.some((sentence) => /기본 모드|default mode/i.test(sentence) && /LLM/.test(sentence) && /루프|loop/i.test(sentence) && NEGATION.test(sentence)),
      `${rendering}: no §0 rule states that the default mode runs no LLM verification loop`
    ).toBe(true);
  });

  it.each(RENDERINGS)("%s: --max adds exactly one independent verifier pass and no second one", (rendering) => {
    const text = flat(body(rendering));
    expect(
      /`--max`[^.。|]{0,120}(?:독립 검증 서브에이전트 1회|exactly one independent verifi\w+ (?:pass|subagent))/i.test(text),
      `${rendering}: --max is not tied to exactly one independent verifier pass`
    ).toBe(true);
    const maxPass = blocks(part(rendering, /^###\s*2\.5\b/));
    expect(
      maxPass.some((block) => /두 번째 검증 패스는 없다|no second (?:verification )?pass/i.test(block)),
      `${rendering}: the --max pass is not closed against a second pass`
    ).toBe(true);
  });
});

describe("FR-FLOW-182 AC-5 — work that does not fit is split, never grown", () => {
  it.each(RENDERINGS)("%s: splits into more SDS files one per work unit", (rendering) => {
    const authoring = blocks(part(rendering, /^##\s*2\./));
    expect(
      authoring.some(
        (block) =>
          /나눈다|split/i.test(block) &&
          /작업 단위|work unit/i.test(block) &&
          /키우지 않|never grow|not grow|does not grow/i.test(block) &&
          block.includes("docs/sds/<sds-id>-<k>.sds.md")
      ),
      `${rendering}: no authoring rule splits an oversized SDS into docs/sds/<sds-id>-<k>.sds.md instead of growing it`
    ).toBe(true);
  });
});

describe("FR-FLOW-182 AC-6 — the finish emits a kiwi-sds event hinting kiwi-pm", () => {
  it.each(RENDERINGS)("%s: skill = kiwi-sds and next_hint = kiwi-pm on the emit line", (rendering) => {
    const authoring = blocks(part(rendering, /^##\s*2\./));
    expect(
      authoring.some(
        (block) => /`skill`\s*=\s*`kiwi-sds`/.test(block) && /`next_hint`\s*=\s*`kiwi-pm`/.test(block) && block.includes("pipeline-event.md")
      ),
      `${rendering}: the authoring finish does not emit skill = kiwi-sds with next_hint = kiwi-pm per pipeline-event.md`
    ).toBe(true);
  });
});

describe("FR-FLOW-182 AC-7 — written for agents, self-agreed, no approval gate, questions asked as questions", () => {
  it.each(RENDERINGS)("%s: English, no narrative prose", (rendering) => {
    const rules = sentences(ruleRows(rendering));
    expect(
      rules.some((sentence) => /영어|English/.test(sentence) && /서사|narrative/i.test(sentence) && NEGATION.test(sentence)),
      `${rendering}: no §0 rule says the SDS is English with no narrative`
    ).toBe(true);
  });

  it.each(RENDERINGS)("%s: self-agreed after the check, with no user approval gate before implementation", (rendering) => {
    const rules = ruleRows(rendering);
    const row = rules.find((entry) => /사용자 승인 게이트가 없다|no user approval gate/i.test(entry));
    expect(row, `${rendering}: no §0 rule states there is no user approval gate`).toBeDefined();
    expect(/스스로|itself/i.test(row ?? "") && /`agreed`/.test(row ?? ""), `${rendering}: the rule does not say kiwi-sds sets agreed itself`).toBe(
      true
    );
  });

  it.each(RENDERINGS)("%s: a real design question is a question, and under --auto the committee's", (rendering) => {
    const rules = ruleRows(rendering);
    expect(
      rules.some(
        (row) =>
          /질문|question/i.test(row) && /`--auto`/.test(row) && /위원회|committee/i.test(row) && /SDS 검토가 아니라|not (?:as )?an SDS review/i.test(row)
      ),
      `${rendering}: no §0 rule routes a design question to a question (or the --auto committee) instead of an SDS review`
    ).toBe(true);
  });
});

describe("FR-FLOW-182 — the renderings declare the same contract", () => {
  it("every rendering declares the same critical gate set", () => {
    const sets = RENDERINGS.map((rendering) => `${rendering}=${criticalGateRows(body(rendering)).map((row) => row.gateId).sort().join(",")}`);
    expect(new Set(sets.map((entry) => entry.split("=")[1])).size, sets.join("\n")).toBe(1);
  });

  it("every rendering declares the same input options", () => {
    const options = (rendering: string): string =>
      [...new Set(rows(part(rendering, /^###\s*1\.1\b/)).flatMap((row) => row.match(/`--[a-z-]+/g) ?? []))].sort().join(",");
    const sets = RENDERINGS.map((rendering) => `${rendering}=${options(rendering)}`);
    expect(new Set(sets.map((entry) => entry.split("=")[1])).size, sets.join("\n")).toBe(1);
  });

  it("the skill directory exists in every source rendering (mirror excluded)", () => {
    for (const rendering of RENDERINGS.filter((entry) => entry.startsWith("skills/"))) {
      expect(existsSync(path.join(REPO_ROOT, rendering, SKILL)), `${rendering}/${SKILL}`).toBe(true);
    }
  });
});

// @req FR-FLOW-063 AC-7 — the recorded existing-module list is an input to SDS authoring, so the layer
// that creates a change sees the structure the judging layer will hold it to.
describe("FR-FLOW-063 AC-7 — SDS authoring reads the recorded existing-module list", () => {
  it.each(RENDERINGS)("%s: --existing-modules is an input", (rendering) => {
    const inputs = rows(part(rendering, /^###\s*1\.1\b/));
    expect(inputs.some((row) => /`--existing-modules <path>`/.test(row) && /existing_modules/.test(row)), `${rendering}: no --existing-modules input row`).toBe(true);
  });

  it.each(RENDERINGS)("%s: the read phase holds the Interfaces to the existing modules", (rendering) => {
    const read = sentences(blocks(part(rendering, /^###\s*2\.2\b/)));
    expect(
      read.some((sentence) => /`existing_modules`/.test(sentence) && /이름을 바꾸지|rename/i.test(sentence) && NEGATION.test(sentence)),
      `${rendering}: §2.2 does not keep the SDS from re-creating or renaming a recorded existing module`
    ).toBe(true);
  });
});

// FR-NODE-087 AC-7 raised the SDS rules to their own version. Every skill that cites the grammar by
// path (kiwi-sds, kiwi-pm, kiwi-coder, kiwi-tdd) must name the file `speckiwi init` installs, or an
// agent following the citation opens a path that no longer exists.
describe("FR-FLOW-182 AC-2 · FR-NODE-087 AC-7 — every skill cites the SDS rules at the bundled file name", () => {
  it.each(RENDERINGS)("%s: no skill names an SDS rules file other than the bundled one", (rendering) => {
    const cited = markdownFiles(rendering).flatMap((relPath) =>
      [...readRepoFile(relPath).matchAll(/docs\/rule\/(SDS-MD-Rules-v[0-9.]+?\.md)/g)].map((match) => `${relPath}: ${match[1] as string}`)
    );
    expect(cited.length, `${rendering}: no skill cites the SDS rules at all`).toBeGreaterThan(0);
    expect(cited.filter((entry) => !entry.endsWith(`: ${BUNDLED_SDS_RULES_FILENAME}`))).toEqual([]);
  });

  it.each(RENDERINGS)("%s: no skill names the SDS rules by a title version other than the bundled one", (rendering) => {
    const named = markdownFiles(rendering).flatMap((relPath) =>
      [...readRepoFile(relPath).matchAll(/SDS-MD Authoring Rules v([0-9]+(?:[.][0-9]+)+)/g)].map((match) => `${relPath}: ${match[1] as string}`)
    );
    expect(named.filter((entry) => !entry.endsWith(`: ${BUNDLED_SDS_RULES_VERSION}`))).toEqual([]);
  });
});
