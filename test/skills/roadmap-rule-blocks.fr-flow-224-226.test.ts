import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { REPO_ROOT } from "./kiwi-orchestrator-variants.js";
import { RENDERINGS } from "./kiwi-renderings.js";
import { UPDATE_RULE_BLOCKS, blocksOf, fileSections, sectionEntry, writeRecord } from "./rule-blocks.js";

// @req FR-FLOW-224 FR-FLOW-225 FR-FLOW-226 — the roadmap rule sections, frozen block by block.
//
// The per-requirement suites hold each rule as a whole line, so an exception appended to a rule turns
// them red. They do not see a contrary block written BESIDE a rule — a new bullet, row or paragraph in
// the same section. This suite records every block of every roadmap rule section per rendering (its
// sha-256 prefix and line count, rule-blocks.ts), the way the d1 and d2 suites hold theirs:
//   - kiwi-roadmap: every section of the skill, frontmatter included;
//   - kiwi-prd, kiwi-srs, kiwi-wave-master: every section in which some block names ROADMAP_ITEM or a
//     roadmap tool, so a roadmap call written into a new section adds an entry and turns this red too.
//
// Regenerate with UPDATE_D1_RULE_BLOCKS=1 (the one flag for every rule-block record) and read the diff.

interface Target {
  readonly id: string;
  readonly skill: string;
  /** null: every section; otherwise a section is recorded when one of its blocks matches. */
  readonly names: RegExp | null;
}
const ROADMAP_NAMES = /ROADMAP_ITEM|\b(?:list_roadmap_items|get_roadmap_item|check_roadmap|add_roadmap_item|update_roadmap_item|sync_roadmap_actuals)\b|speckiwi roadmap\b/;
const TARGETS: readonly Target[] = [
  { id: "FR-FLOW-224 kiwi-roadmap", skill: "kiwi-roadmap", names: null },
  { id: "FR-FLOW-225 kiwi-prd", skill: "kiwi-prd", names: ROADMAP_NAMES },
  { id: "FR-FLOW-225 kiwi-srs", skill: "kiwi-srs", names: ROADMAP_NAMES },
  { id: "FR-FLOW-226 kiwi-wave-master", skill: "kiwi-wave-master", names: ROADMAP_NAMES },
];
const FILES = ["SKILL.md", "references/extended-workflow.md"] as const;

/** The renderings that ship the skill (kiwi-wave-master has no .agents mirror). */
const shipping = (target: Target): string[] => RENDERINGS.filter((root) => existsSync(path.join(REPO_ROOT, root, target.skill, "SKILL.md")));

/** Every roadmap rule section of `target` in one rendering, one `sectionEntry` each. */
function ruleBlocks(root: string, target: Target): string[] {
  return FILES.flatMap((file) =>
    fileSections(`${root}/${target.skill}/${file}`).flatMap((section) => {
      const blocks = blocksOf(section.body);
      if (target.names !== null && !blocks.some((block) => target.names!.test(block))) return [];
      return [sectionEntry(file, section.heading, blocks)];
    })
  );
}

const SELF = fileURLToPath(import.meta.url);
const RECORD_START = "// <recorded-roadmap-rule-blocks>";
const RECORD_END = "// </recorded-roadmap-rule-blocks>";
if (UPDATE_RULE_BLOCKS) {
  const record = Object.fromEntries(TARGETS.map((target) => [target.id, Object.fromEntries(shipping(target).map((root) => [root, ruleBlocks(root, target)]))]));
  writeRecord(SELF, RECORD_START, RECORD_END, `const RECORDED_RULE_BLOCKS: Record<string, Record<string, string[]>> = ${JSON.stringify(record, null, 2)};`);
}

describe("FR-FLOW-224..226 — every block of every roadmap rule section is exactly as recorded", () => {
  for (const target of TARGETS) {
    it(`${target.id}: ships in every rendering but an excluded mirror`, () => {
      expect(shipping(target).length, target.id).toBeGreaterThanOrEqual(3);
    });
    for (const root of shipping(target)) {
      // @req FR-FLOW-224 FR-FLOW-225 FR-FLOW-226 (the requirement in the test title)
      it(`${target.id}: ${root} carries exactly the recorded blocks`, () => {
        const recorded = RECORDED_RULE_BLOCKS[target.id]?.[root];
        expect(recorded, `the record has no ${target.id} entry for ${root}`).toBeDefined();
        const live = ruleBlocks(root, target);
        expect(live.length, `${root}: no roadmap rule section found`).toBeGreaterThan(0);
        // Order and multiplicity matter: a block moved out of place or repeated is a changed section.
        expect(live, `${root}: roadmap rule-section blocks differ from the record — read the diff, then regenerate`).toEqual(recorded);
      });
    }
  }
});

// The recorded roadmap rule-section blocks. Generated; read the diff whenever it changes.
// <recorded-roadmap-rule-blocks>
const RECORDED_RULE_BLOCKS: Record<string, Record<string, string[]>> = {
  "FR-FLOW-224 kiwi-roadmap": {
    "skills/claude": [
      "SKILL.md\t(top)\t1\t26f2c10b:1",
      "SKILL.md\t# kiwi-roadmap v0.1\t6\tc48b9ec4:1 23fa003d:1 82192901:1 5b83418e:1 0b7beaa4:1 e854732d:1",
      "SKILL.md\t## 1. 순서\t5\tba7d70e3:1 76d4cb85:1 4656de1f:1 6b36f89d:1 5922b161:1",
      "SKILL.md\t## 2. 착수 — kiwi-prd 로 넘긴다\t3\t217d0713:1 40a05851:1 840f0c92:1",
      "references/extended-workflow.md\t(top)\t0\t"
    ],
    "skills/codex": [
      "SKILL.md\t(top)\t1\t4eac29b7:1",
      "SKILL.md\t# kiwi-roadmap v0.1\t7\tc48b9ec4:1 23fa003d:1 82192901:1 5b83418e:1 0b7beaa4:1 86488b0f:1 e854732d:1",
      "SKILL.md\t## 1. 순서\t5\tba7d70e3:1 76d4cb85:1 4656de1f:1 6b36f89d:1 5922b161:1",
      "SKILL.md\t## 2. 착수 — kiwi-prd 로 넘긴다\t3\tc9ce8c65:1 66b6dcc1:1 840f0c92:1",
      "references/extended-workflow.md\t(top)\t0\t"
    ],
    "skills/etc": [
      "SKILL.md\t(top)\t1\t86e8348a:1",
      "SKILL.md\t# kiwi-roadmap v0.1\t7\tc48b9ec4:1 23fa003d:1 82192901:1 5b83418e:1 0b7beaa4:1 3a4cc1df:1 e854732d:1",
      "SKILL.md\t## 1. 순서\t5\tba7d70e3:1 76d4cb85:1 4656de1f:1 6b36f89d:1 5922b161:1",
      "SKILL.md\t## 2. 착수 — kiwi-prd 로 넘긴다\t3\tc42b21ee:1 11e957df:1 840f0c92:1",
      "references/extended-workflow.md\t(top)\t0\t"
    ],
    ".agents/skills": [
      "SKILL.md\t(top)\t1\t4eac29b7:1",
      "SKILL.md\t# kiwi-roadmap v0.1\t7\tc48b9ec4:1 23fa003d:1 82192901:1 5b83418e:1 0b7beaa4:1 86488b0f:1 e854732d:1",
      "SKILL.md\t## 1. 순서\t5\tba7d70e3:1 76d4cb85:1 4656de1f:1 6b36f89d:1 5922b161:1",
      "SKILL.md\t## 2. 착수 — kiwi-prd 로 넘긴다\t3\tc9ce8c65:1 66b6dcc1:1 840f0c92:1",
      "references/extended-workflow.md\t(top)\t0\t"
    ]
  },
  "FR-FLOW-225 kiwi-prd": {
    "skills/claude": [
      "SKILL.md\t## 1. 순서\t8\t38898658:1 facbffdc:1 091d083f:1 aaecf530:1 1dbecec1:1 5f4e2790:1 b944d741:1 1cbf6f8a:1"
    ],
    "skills/codex": [
      "SKILL.md\t## 1. 순서\t8\t38898658:1 facbffdc:1 091d083f:1 aaecf530:1 1dbecec1:1 5f4e2790:1 b944d741:1 d249b81a:1"
    ],
    "skills/etc": [
      "SKILL.md\t## 1. 순서\t8\t38898658:1 facbffdc:1 091d083f:1 aaecf530:1 1dbecec1:1 5f4e2790:1 b944d741:1 faa23275:1"
    ],
    ".agents/skills": [
      "SKILL.md\t## 1. 순서\t8\t38898658:1 facbffdc:1 091d083f:1 aaecf530:1 1dbecec1:1 5f4e2790:1 b944d741:1 d249b81a:1"
    ]
  },
  "FR-FLOW-225 kiwi-srs": {
    "skills/claude": [
      "SKILL.md\t### 1.1 필수 입력 (택1)\t6\tb91f69fa:1 c3bafbd4:1 b0e46b03:1 f0b10788:1 8fbdbcb7:1 249aadd0:1",
      "SKILL.md\t### 12.1.4 로드맵 항목 연결 (FR-FLOW-225)\t1\tfb62f058:1"
    ],
    "skills/codex": [
      "SKILL.md\t### 1.1 필수 입력 (택1)\t6\tb91f69fa:1 c3bafbd4:1 b0e46b03:1 f0b10788:1 8fbdbcb7:1 249aadd0:1",
      "references/extended-workflow.md\t### 12.1.4 로드맵 항목 연결 (FR-FLOW-225)\t1\tfb62f058:1"
    ],
    "skills/etc": [
      "SKILL.md\t### 1.1 필수 입력 (택1)\t6\tb91f69fa:1 c3bafbd4:1 b0e46b03:1 f0b10788:1 8fbdbcb7:1 249aadd0:1",
      "references/extended-workflow.md\t### 12.1.4 로드맵 항목 연결 (FR-FLOW-225)\t1\tfb62f058:1"
    ],
    ".agents/skills": [
      "SKILL.md\t### 1.1 필수 입력 (택1)\t6\tb91f69fa:1 c3bafbd4:1 b0e46b03:1 f0b10788:1 8fbdbcb7:1 249aadd0:1",
      "references/extended-workflow.md\t### 12.1.4 로드맵 항목 연결 (FR-FLOW-225)\t1\tfb62f058:1"
    ]
  },
  "FR-FLOW-226 kiwi-wave-master": {
    "skills/claude": [
      "SKILL.md\t### 1.2 선택 입력 + 자연어 매핑\t18\t6460e4f5:1 23cca02b:1 d234794c:1 97702a0a:1 3dfe5231:1 f2a50acf:1 95b57e58:1 e59fca87:1 9298f12a:1 fff97965:1 02c216f5:1 0637c92a:1 bcab6e44:1 bf136415:1 592834d0:1 95156c43:1 2523d151:1 129f7549:1",
      "SKILL.md\t### 3.1 로드맵 항목 (FR-FLOW-226)\t5\tb6b7cf06:1 86aa8713:1 015d1efb:1 ed7dd3ce:1 a1b06c66:1",
      "SKILL.md\t## 9. Pipeline emit (의무)\t5\te93653de:1 7df68e04:1 8a4af4c5:1 1b96ef05:1 d7d896dc:1"
    ],
    "skills/codex": [
      "SKILL.md\t### 1.2 선택 입력 + 자연어 매핑\t18\t6460e4f5:1 23cca02b:1 d234794c:1 97702a0a:1 3dfe5231:1 f2a50acf:1 95b57e58:1 e59fca87:1 9298f12a:1 fff97965:1 02c216f5:1 0637c92a:1 bcab6e44:1 bf136415:1 592834d0:1 95156c43:1 2523d151:1 129f7549:1",
      "SKILL.md\t### 3.1 로드맵 항목 (FR-FLOW-226)\t5\tb6b7cf06:1 86aa8713:1 015d1efb:1 ed7dd3ce:1 a1b06c66:1",
      "SKILL.md\t## 9. Pipeline emit (의무)\t5\tc70b4ada:1 7df68e04:1 8a4af4c5:1 1b96ef05:1 d7d896dc:1"
    ],
    "skills/etc": [
      "SKILL.md\t### 1.2 선택 입력 + 자연어 매핑\t18\t6460e4f5:1 23cca02b:1 d234794c:1 a2ee70fc:1 3dfe5231:1 f2a50acf:1 95b57e58:1 e59fca87:1 9298f12a:1 87151630:1 02c216f5:1 0637c92a:1 bcab6e44:1 bf136415:1 592834d0:1 95156c43:1 2523d151:1 129f7549:1",
      "SKILL.md\t### 3.1 로드맵 항목 (FR-FLOW-226)\t5\tb6b7cf06:1 86aa8713:1 015d1efb:1 ed7dd3ce:1 a1b06c66:1",
      "SKILL.md\t## 9. Pipeline emit (의무)\t5\tc70b4ada:1 7df68e04:1 8a4af4c5:1 1b96ef05:1 d7d896dc:1"
    ]
  }
};
// </recorded-roadmap-rule-blocks>
