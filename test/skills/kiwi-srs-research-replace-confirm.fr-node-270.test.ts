import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { RENDERINGS as EVERY_RENDERING } from "./kiwi-renderings.js";
import { UPDATE_RULE_BLOCKS, blocksOf, fileSections, sectionEntry, writeRecord } from "./rule-blocks.js";

// @req FR-NODE-270 AC-9 — kiwi-srs-research, the shipped caller of `append_section_note` with
// `mode: "replace"`, dry-runs the replace, confirms only a dry run that reports removed items, and
// records what the dry run said it would remove.

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const RENDERINGS = [
  ["claude", ["skills", "claude", "kiwi-srs-research", "SKILL.md"]],
  ["codex", ["skills", "codex", "kiwi-srs-research", "references", "extended-workflow.md"]],
  ["etc", ["skills", "etc", "kiwi-srs-research", "references", "extended-workflow.md"]]
] as const;

/** Section 7.1.2, from its heading to the next `#### ` heading. */
function persistenceSection(rel: readonly string[]): string {
  const text = readFileSync(path.join(REPO_ROOT, ...rel), "utf8").replace(/\r\n/g, "\n");
  const start = text.indexOf("#### 7.1.2");
  expect(start, "section 7.1.2 must exist").toBeGreaterThan(-1);
  const end = text.indexOf("\n#### ", start + 1);
  return text.slice(start, end === -1 ? undefined : end);
}

/** Every `append_section_note { … }` call written in the section. */
function calls(section: string): string[] {
  return [...section.matchAll(/append_section_note \{[^}]*\}/g)].map((match) => match[0]);
}

describe("FR-NODE-270 AC-9 — kiwi-srs-research confirms a replace only after its dry run", () => {
  for (const [variant, rel] of RENDERINGS) {
    // @req FR-NODE-270 AC-9
    it(`${variant}: every replace call is the dry run, the unconfirmed write, or the confirmed write`, () => {
      const replaceCalls = calls(persistenceSection(rel)).filter((call) => /mode: "[^"]*replace/.test(call));
      expect(replaceCalls.length).toBeGreaterThanOrEqual(2);
      for (const call of replaceCalls) {
        // A mode that leaves the choice open (`append|replace`) hides which call is which.
        expect(call).toContain('mode: "replace"');
      }
      const dryRun = replaceCalls.findIndex((call) => call.includes("dryRun: true"));
      const confirmed = replaceCalls.findIndex((call) => call.includes("confirmReplace: true"));
      expect(dryRun, "a dry-run replace call").toBeGreaterThan(-1);
      expect(confirmed, "a confirmed replace call").toBeGreaterThan(dryRun);
      expect(replaceCalls[dryRun]).not.toContain("confirmReplace");
    });

    // @req FR-NODE-270 AC-9
    it(`${variant}: passes confirmReplace only when the dry run reports removedItems above 0`, () => {
      const section = persistenceSection(rel);
      const confirmedLine = section.split("\n").find((line) => line.includes("confirmReplace: true"));
      expect(confirmedLine).toBeDefined();
      expect(confirmedLine).toMatch(/`removedItems`\s*(가|이)?\s*(0 보다 (크|클)|> ?0)/);
      expect(confirmedLine).toMatch(/때만/);
    });

    // @req FR-NODE-270 AC-9
    it(`${variant}: records the dry run's removedLines in the run report`, () => {
      const section = persistenceSection(rel);
      const recordLine = section.split("\n").find((line) => line.includes("`removedLines`") && /기록/.test(line));
      expect(recordLine).toBeDefined();
      expect(recordLine).toMatch(/dry run/);
      expect(recordLine).toMatch(/보고/);
    });
  }
});

// The checks above hold words of the rule sentences, so a sentence turned around ("넘긴다" → "넘기지 않는다",
// "기록한다" → "기록하지 않는다") or hedged ("급하면 dry run 없이 확인 플래그를 넘겨도 된다") kept every word
// they look for (verify-v532-r1). The suite below holds the rule text itself: every block of every section of
// the skill that speaks of the replace route — section 7.1.2 among them — is recorded per rendering, mirror
// included, with its sha-256 prefix and line count (rule-blocks.ts), so a changed, added or removed sentence
// in any such section, or a new section that speaks of the route, changes the record.
//
// Regenerate with UPDATE_D1_RULE_BLOCKS=1 (the one flag for every rule-block record) and read the diff.

const SKILL = "kiwi-srs-research";
const SKILL_FILES = ["SKILL.md", "references/extended-workflow.md"] as const;
/** A block that names the replace route: the mode, its confirmation flag or what its dry run reports. */
const REPLACE_ROUTE = /\breplace\b|confirmReplace|removedItems|removedLines/;

/** The renderings that ship the skill, mirror included. */
const shipping = (): string[] => EVERY_RENDERING.filter((root) => existsSync(path.join(REPO_ROOT, root, SKILL, "SKILL.md")));

/** Every section of the skill in one rendering that names the replace route, one `sectionEntry` each. */
function replaceRuleBlocks(root: string): string[] {
  return SKILL_FILES.flatMap((file) =>
    fileSections(`${root}/${SKILL}/${file}`).flatMap((section) => {
      const blocks = blocksOf(section.body);
      if (!blocks.some((block) => REPLACE_ROUTE.test(block))) return [];
      return [sectionEntry(file, section.heading, blocks)];
    })
  );
}

const SELF = fileURLToPath(import.meta.url);
const RECORD_START = "// <recorded-replace-rule-blocks>";
const RECORD_END = "// </recorded-replace-rule-blocks>";
if (UPDATE_RULE_BLOCKS) {
  const record = Object.fromEntries(shipping().map((root) => [root, replaceRuleBlocks(root)]));
  writeRecord(SELF, RECORD_START, RECORD_END, `const RECORDED_RULE_BLOCKS: Record<string, string[]> = ${JSON.stringify(record, null, 2)};`);
}

describe("FR-NODE-270 AC-9 — every block of every replace-route section of kiwi-srs-research is exactly as recorded", () => {
  it("ships in the three renderings and the mirror", () => {
    expect(shipping().length).toBeGreaterThanOrEqual(4);
  });
  for (const root of shipping()) {
    // @req FR-NODE-270 AC-9
    it(`${root}: carries exactly the recorded blocks, section 7.1.2 among them`, () => {
      const recorded = RECORDED_RULE_BLOCKS[root];
      expect(recorded, `the record has no entry for ${root}`).toBeDefined();
      const live = replaceRuleBlocks(root);
      expect(live.some((entry) => entry.split("\t")[1]!.startsWith("#### 7.1.2 ")), `${root}: section 7.1.2 is recorded`).toBe(true);
      // Order and multiplicity matter: a block moved out of place or repeated is a changed section.
      expect(live, `${root}: replace-route section blocks differ from the record — read the diff, then regenerate`).toEqual(recorded);
    });
  }
});

// The recorded replace-route section blocks. Generated; read the diff whenever it changes.
// <recorded-replace-rule-blocks>
const RECORDED_RULE_BLOCKS: Record<string, string[]> = {
  "skills/claude": [
    "SKILL.md\t## 0. 공통 규약 (SSOT)\t21\t3cd39375:1 4199ba45:1 bb40c549:1 ab98ce9f:1 09eefc14:1 c1a2dc71:1 7dc7e77f:1 6d9dbd3a:1 fb85c4e0:1 51c660fe:1 864fa62e:1 2925e43a:1 f3b57411:1 f69c2f83:1 9d296fc2:1 bf41420b:1 34daa6fc:1 8e254eb5:1 03bfb834:1 66ff58a5:1 594e843c:1",
    "SKILL.md\t### 1.7 `--auto` critical_gates[] 선언 (standalone 모드 한정)\t8\t3b2d912f:1 2df48075:1 23cca02b:1 efd4d37d:1 3a521e91:1 b391aa71:1 24dadeac:1 cb3f91d5:1",
    "SKILL.md\t#### 7.1.1 사용자 결정 게이트\t5\t63c1a549:1 f5245acc:1 cd5bcc90:1 95697fae:1 daba9fa4:1",
    "SKILL.md\t#### 7.1.2 speckiwi 영속화\t12\t01e6a6a3:1 0afbe451:1 7e220dae:1 741be4b7:1 779ef8d8:1 dd9427bb:1 f1b90184:1 1194cbcf:1 f1b90184:1 1d81cbbb:1 914ed422:1 7ca4dcd8:1",
    "SKILL.md\t#### 7.1.3 사용자 보고\t21\t1b72e989:1 307c96a4:1 00569d5e:1 2b77e14d:1 438bf842:1 98c68beb:1 e6a5ce14:1 4241350c:1 8dc0023e:1 dd6aa948:1 0aec251f:1 c4222eea:1 d0eb3f28:1 a8733c72:1 18f09fc0:1 62b98cf2:1 0e36054e:1 7c4a9888:1 a3e4829c:1 d22f2662:1 f1b90184:1"
  ],
  "skills/codex": [
    "SKILL.md\t## 0. 공통 규약 (SSOT)\t21\t3cd39375:1 4199ba45:1 bb40c549:1 ab98ce9f:1 09eefc14:1 c1a2dc71:1 1413743f:1 db872515:1 fb85c4e0:1 51c660fe:1 864fa62e:1 48c9a02e:1 f3b57411:1 d59134fb:1 84396923:1 bf41420b:1 34daa6fc:1 df18c749:1 03bfb834:1 334eb44d:1 422d7c79:1",
    "SKILL.md\t#### §0.G7 — `--auto` critical_gates[]\t8\t27401e77:1 23cca02b:1 f1f1fc66:1 e893e5ae:1 3269337b:1 5e21561b:1 205f71f3:1 cb3f91d5:1",
    "references/extended-workflow.md\t#### 7.1.1 사용자 결정 게이트\t5\t63c1a549:1 4bf34e77:1 cd5bcc90:1 95697fae:1 daba9fa4:1",
    "references/extended-workflow.md\t#### 7.1.2 speckiwi 영속화\t12\t01e6a6a3:1 0afbe451:1 7e220dae:1 741be4b7:1 779ef8d8:1 dd9427bb:1 f1b90184:1 1194cbcf:1 f1b90184:1 1d81cbbb:1 914ed422:1 7ca4dcd8:1",
    "references/extended-workflow.md\t#### 7.1.3 사용자 보고\t21\t1b72e989:1 307c96a4:1 00569d5e:1 2b77e14d:1 438bf842:1 5ddf7fa7:1 e6a5ce14:1 4241350c:1 8dc0023e:1 dd6aa948:1 0aec251f:1 c4222eea:1 d0eb3f28:1 a8733c72:1 18f09fc0:1 62b98cf2:1 0e36054e:1 7c4a9888:1 a3e4829c:1 d22f2662:1 f1b90184:1"
  ],
  "skills/etc": [
    "SKILL.md\t## 0. 공통 규약 (SSOT)\t20\t3cd39375:1 4199ba45:1 7cff380e:1 0bc8522d:1 09eefc14:1 c46ee5b1:1 c4f625da:1 95a58e34:1 8c6769e7:1 51c660fe:1 864fa62e:1 7d3d3b5d:1 0518524d:1 fea783f5:1 84396923:1 bf41420b:1 4cd0c1f5:1 3fdff134:1 ed1c9408:1 b64f3535:1",
    "SKILL.md\t#### §0.G7 — `--auto` critical_gates[]\t8\t27401e77:1 23cca02b:1 f1f1fc66:1 e893e5ae:1 3269337b:1 5e21561b:1 65afcce6:1 cb3f91d5:1",
    "references/extended-workflow.md\t#### 7.1.1 사용자 결정 게이트\t5\t63c1a549:1 b68ab69b:1 cd5bcc90:1 95697fae:1 daba9fa4:1",
    "references/extended-workflow.md\t#### 7.1.2 speckiwi 영속화\t12\t01e6a6a3:1 0afbe451:1 7e220dae:1 741be4b7:1 779ef8d8:1 dd9427bb:1 f1b90184:1 1194cbcf:1 f1b90184:1 1d81cbbb:1 914ed422:1 7ca4dcd8:1",
    "references/extended-workflow.md\t#### 7.1.3 사용자 보고\t21\t1b72e989:1 307c96a4:1 00569d5e:1 2b77e14d:1 438bf842:1 ade28341:1 e6a5ce14:1 4241350c:1 8dc0023e:1 dd6aa948:1 0aec251f:1 c4222eea:1 d0eb3f28:1 a8733c72:1 18f09fc0:1 62b98cf2:1 0e36054e:1 7c4a9888:1 a3e4829c:1 d22f2662:1 f1b90184:1"
  ],
  ".agents/skills": [
    "SKILL.md\t## 0. 공통 규약 (SSOT)\t21\t3cd39375:1 4199ba45:1 bb40c549:1 ab98ce9f:1 09eefc14:1 c1a2dc71:1 1413743f:1 db872515:1 fb85c4e0:1 51c660fe:1 864fa62e:1 48c9a02e:1 f3b57411:1 d59134fb:1 84396923:1 bf41420b:1 34daa6fc:1 df18c749:1 03bfb834:1 334eb44d:1 422d7c79:1",
    "SKILL.md\t#### §0.G7 — `--auto` critical_gates[]\t8\t27401e77:1 23cca02b:1 f1f1fc66:1 e893e5ae:1 3269337b:1 5e21561b:1 205f71f3:1 cb3f91d5:1",
    "references/extended-workflow.md\t#### 7.1.1 사용자 결정 게이트\t5\t63c1a549:1 4bf34e77:1 cd5bcc90:1 95697fae:1 daba9fa4:1",
    "references/extended-workflow.md\t#### 7.1.2 speckiwi 영속화\t12\t01e6a6a3:1 0afbe451:1 7e220dae:1 741be4b7:1 779ef8d8:1 dd9427bb:1 f1b90184:1 1194cbcf:1 f1b90184:1 1d81cbbb:1 914ed422:1 7ca4dcd8:1",
    "references/extended-workflow.md\t#### 7.1.3 사용자 보고\t21\t1b72e989:1 307c96a4:1 00569d5e:1 2b77e14d:1 438bf842:1 5ddf7fa7:1 e6a5ce14:1 4241350c:1 8dc0023e:1 dd6aa948:1 0aec251f:1 c4222eea:1 d0eb3f28:1 a8733c72:1 18f09fc0:1 62b98cf2:1 0e36054e:1 7c4a9888:1 a3e4829c:1 d22f2662:1 f1b90184:1"
  ]
};
// </recorded-replace-rule-blocks>
