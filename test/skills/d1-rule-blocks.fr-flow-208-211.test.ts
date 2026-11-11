import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { RENDERINGS } from "./kiwi-renderings.js";
import { UPDATE_RULE_BLOCKS, blocksOf, fileSections, sectionEntry, writeRecord } from "./rule-blocks.js";

// @req FR-FLOW-208 FR-FLOW-209 FR-FLOW-210 FR-FLOW-211 — the rule sections of the four requirements,
// frozen block by block.
//
// Five verification rounds each found an exception that could be written INTO a section holding one
// of these rules — a hedge appended to a pinned row, a new row or bullet beside it, an alternative
// citation form on the same line — and that the per-rule suites did not see, because each held only
// the sentences it named. This suite holds the sections instead. A RULE SECTION is a section (heading
// to the next heading of any depth) of the skill a requirement governs in which some block names that
// requirement's rule (the patterns below). Every block of every rule section — paragraph, list item,
// table row, pseudocode line — is recorded at the end of this file per rendering: one entry per rule
// section, holding its file, its heading, its block count and a sha-256 prefix with the line count of each block in order
// (rule-blocks.ts, shared with the d2 suite). A block added to or removed
// from a rule section, or changed inside one, turns this red; the semantic suites (the four-way flag
// evaluation of kiwi-pm, the coverage run of kiwi-srs citations, the requirement-site denominator)
// stay where they are and still say what the text must mean.
//
// Regenerate the record with UPDATE_D1_RULE_BLOCKS=1 (the one flag for every d1 record) and read the
// diff: a changed entry names the section, and the position of the changed hash names the block.

interface Rule {
  readonly requirement: string;
  readonly skill: string;
  /** A block naming the rule: any section holding one is a rule section. */
  readonly names: RegExp;
}
const RULES: readonly Rule[] = [
  // depends_on links, prose-only dependencies, and the FR-PARSE-045 warnings kept as findings.
  { requirement: "FR-FLOW-208", skill: "kiwi-srs", names: /depends_on|FR-PARSE-045|요구 사이 의존/ },
  // the PRD citation forms a Rationale is written in.
  { requirement: "FR-FLOW-209", skill: "kiwi-srs", names: /← PRD-|fills: PRD-|AC-n ← |PRD 항목을 인용/ },
  // one PRD item per normative sentence of a design or research document.
  { requirement: "FR-FLOW-210", skill: "kiwi-prd", names: /규범 문장|설계·연구 문서/ },
  // --req-filter, reading by ID, the missing-ID stop and the resume.
  {
    requirement: "FR-FLOW-211",
    skill: "kiwi-pm",
    names: /--req-filter|req_filter|get_requirement|HALT_ON_MISSING_IDS|HALT_ON_IDS_OUTSIDE_SDS|FIND_SESSION|찾지 못한 ID|LOAD_OR_INIT_STATE|`--resume` 동작/,
  },
];

const FILES = ["SKILL.md", "references/extended-workflow.md"] as const;

/** Every rule section of `rule` in one rendering, one `sectionEntry` each. */
function ruleBlocks(root: string, rule: Rule): string[] {
  return FILES.flatMap((file) =>
    fileSections(`${root}/${rule.skill}/${file}`).flatMap((section) => {
      const blocks = blocksOf(section.body);
      if (!blocks.some((block) => rule.names.test(block)) && !rule.names.test(section.heading)) return [];
      return [sectionEntry(file, section.heading, blocks)];
    })
  );
}

const SELF = fileURLToPath(import.meta.url);
const RECORD_START = "// <recorded-d1-rule-blocks>";
const RECORD_END = "// </recorded-d1-rule-blocks>";
if (UPDATE_RULE_BLOCKS) {
  const record = Object.fromEntries(RULES.map((rule) => [rule.requirement, Object.fromEntries(RENDERINGS.map((root) => [root, ruleBlocks(root, rule)]))]));
  writeRecord(SELF, RECORD_START, RECORD_END, `const RECORDED_RULE_BLOCKS: Record<string, Record<string, string[]>> = ${JSON.stringify(record, null, 2)};`);
}

describe("FR-FLOW-208..211 — every block of every rule section is exactly as recorded", () => {
  for (const rule of RULES) {
    for (const root of RENDERINGS) {
      // @req FR-FLOW-208 FR-FLOW-209 FR-FLOW-210 FR-FLOW-211 (the requirement in the test title)
      it(`${rule.requirement}: ${root}/${rule.skill} rule sections carry exactly the recorded blocks`, () => {
        const recorded = RECORDED_RULE_BLOCKS[rule.requirement]?.[root];
        expect(recorded, `the record has no ${rule.requirement} entry for ${root}`).toBeDefined();
        const live = ruleBlocks(root, rule);
        expect(live.length, `${root}: no rule section found`).toBeGreaterThan(0);
        // Order and multiplicity matter: a block moved out of place or repeated is a changed section.
        expect(live, `${root}: rule-section blocks differ from the record — read the diff, then regenerate`).toEqual(recorded);
      });
    }
  }
});

// The recorded rule-section blocks of FR-FLOW-208..211. Generated; read the diff whenever it changes.
// <recorded-d1-rule-blocks>
const RECORDED_RULE_BLOCKS: Record<string, Record<string, string[]>> = {
  "FR-FLOW-208": {
    "skills/claude": [
      "SKILL.md\t## 핵심 규칙 — 요구 사이 의존 (FR-FLOW-208)\t6\t10d6f4b2:1 50d4e6e8:1 cb3f91d5:1 087f1e9b:1 d8c58aac:1 cb3f91d5:1",
      "SKILL.md\t## 0. 공통 규약 (SSOT)\t25\t3cd39375:1 4199ba45:1 b49ed306:1 eb7749d9:1 cf39f9d4:1 695b2fd5:1 d41ce53e:1 409d5935:1 66105baa:1 32391a33:1 4e7732cb:1 69be011d:1 b7735515:1 bb651fbb:1 59ea2061:1 a2f4baf6:1 f6344a99:1 b1193bb3:1 c49a9d1a:1 475f9c0c:1 61d41699:1 8991009c:1 363ef397:1 55118954:1 163b506f:1",
      "SKILL.md\t### 6.1 분류\t18\tb6ce8fb9:1 a56726cd:1 021fb596:1 eb868a52:1 8a718f6d:1 0371d57a:1 80778808:1 06001ab4:1 42402ab3:1 39d4b54e:1 ee407353:1 9b6879ad:1 5db94bf9:1 717c35b4:1 18c43429:1 671df184:1 d10b36aa:1 f1b90184:1",
      "SKILL.md\t### 6.5 Multi-aspect 요구사항 분리\t5\t2c70a7a0:1 5bfbc903:1 e292f01d:1 c93d17b9:1 cb3f91d5:1",
      "SKILL.md\t### 9.1 작성자 컨텍스트\t10\tf496c86c:1 0cc77084:1 138d4f3e:1 9b8c6770:1 692879a3:1 0a43f9f3:1 24b803ff:1 f853dd0d:1 5c7fb4cd:1 4a69ba62:1",
      "SKILL.md\t#### new-feature\t12\t5ed2f36c:1 ce98a41b:1 f1b90184:1 f633b27f:1 f1b90184:1 8d517f4a:1 ce39536f:1 7fbee4b0:1 848a58ec:1 058c4be0:1 5be11a5a:1 7c6abcba:1",
      "SKILL.md\t### 11.1 keep / drop\t7\t571a66ca:1 1196e5c7:1 23cca02b:1 3c7052db:1 cd083da4:1 94be3cb9:1 79b35da1:1"
    ],
    "skills/codex": [
      "SKILL.md\t## 핵심 규칙 — 요구 사이 의존 (FR-FLOW-208)\t6\t10d6f4b2:1 50d4e6e8:1 cb3f91d5:1 087f1e9b:1 d8c58aac:1 cb3f91d5:1",
      "SKILL.md\t## 0. 공통 규약 (SSOT)\t25\t3cd39375:1 4199ba45:1 b49ed306:1 eb7749d9:1 cf39f9d4:1 695b2fd5:1 d41ce53e:1 2828f516:1 d8e89fe9:1 32391a33:1 4e7732cb:1 69be011d:1 b7735515:1 bb651fbb:1 59ea2061:1 0c22beea:1 f6344a99:1 b1193bb3:1 c49a9d1a:1 475f9c0c:1 87438d74:1 f8319948:1 6cdf0ecf:1 fc0d1db1:1 163b506f:1",
      "SKILL.md\t### 6.1 분류\t18\tb6ce8fb9:1 a56726cd:1 021fb596:1 eb868a52:1 8a718f6d:1 0371d57a:1 80778808:1 06001ab4:1 42402ab3:1 39d4b54e:1 ee407353:1 9b6879ad:1 5db94bf9:1 717c35b4:1 18c43429:1 671df184:1 d10b36aa:1 f1b90184:1",
      "SKILL.md\t### 6.5 Multi-aspect 요구사항 분리\t5\t2c70a7a0:1 5bfbc903:1 e292f01d:1 c93d17b9:1 cb3f91d5:1",
      "references/extended-workflow.md\t### 9.1 작성자 컨텍스트\t10\tcb2239cb:1 8e42b0a4:1 138d4f3e:1 9b8c6770:1 692879a3:1 0a43f9f3:1 24b803ff:1 f853dd0d:1 5c7fb4cd:1 4a69ba62:1",
      "references/extended-workflow.md\t#### new-feature\t12\t5ed2f36c:1 ce98a41b:1 f1b90184:1 f633b27f:1 f1b90184:1 8d517f4a:1 ce39536f:1 7fbee4b0:1 848a58ec:1 058c4be0:1 5be11a5a:1 7c6abcba:1",
      "references/extended-workflow.md\t### 11.1 keep / drop\t7\t571a66ca:1 1196e5c7:1 23cca02b:1 3c7052db:1 cd083da4:1 94be3cb9:1 79b35da1:1"
    ],
    "skills/etc": [
      "SKILL.md\t## 핵심 규칙 — 요구 사이 의존 (FR-FLOW-208)\t6\t10d6f4b2:1 50d4e6e8:1 cb3f91d5:1 087f1e9b:1 d8c58aac:1 cb3f91d5:1",
      "SKILL.md\t## 0. 공통 규약 (SSOT)\t24\t3cd39375:1 4199ba45:1 8d3669a9:1 eb7749d9:1 cf39f9d4:1 695b2fd5:1 d41ce53e:1 e5a4b6f8:1 db970291:1 32391a33:1 4e7732cb:1 69be011d:1 b7735515:1 bb651fbb:1 59ea2061:1 e227a985:1 f6344a99:1 b1193bb3:1 c49a9d1a:1 475f9c0c:1 99701985:1 3a8996be:1 9702d609:1 8ed3ace5:1",
      "SKILL.md\t### 6.1 분류\t18\tb6ce8fb9:1 a56726cd:1 021fb596:1 eb868a52:1 8a718f6d:1 0371d57a:1 80778808:1 06001ab4:1 42402ab3:1 39d4b54e:1 ee407353:1 9b6879ad:1 5db94bf9:1 717c35b4:1 18c43429:1 671df184:1 d10b36aa:1 f1b90184:1",
      "SKILL.md\t### 6.5 Multi-aspect 요구사항 분리\t5\t2c70a7a0:1 5bfbc903:1 e292f01d:1 c93d17b9:1 cb3f91d5:1",
      "references/extended-workflow.md\t### 9.1 작성자 컨텍스트\t10\tc0a00764:1 8e42b0a4:1 138d4f3e:1 9b8c6770:1 692879a3:1 0a43f9f3:1 24b803ff:1 f853dd0d:1 5c7fb4cd:1 4a69ba62:1",
      "references/extended-workflow.md\t#### new-feature\t12\t5ed2f36c:1 ce98a41b:1 f1b90184:1 f633b27f:1 f1b90184:1 8d517f4a:1 ce39536f:1 7fbee4b0:1 848a58ec:1 058c4be0:1 5be11a5a:1 7c6abcba:1",
      "references/extended-workflow.md\t### 11.1 keep / drop\t7\t571a66ca:1 1196e5c7:1 23cca02b:1 3c7052db:1 cd083da4:1 94be3cb9:1 79b35da1:1"
    ],
    ".agents/skills": [
      "SKILL.md\t## 핵심 규칙 — 요구 사이 의존 (FR-FLOW-208)\t6\t10d6f4b2:1 50d4e6e8:1 cb3f91d5:1 087f1e9b:1 d8c58aac:1 cb3f91d5:1",
      "SKILL.md\t## 0. 공통 규약 (SSOT)\t25\t3cd39375:1 4199ba45:1 b49ed306:1 eb7749d9:1 cf39f9d4:1 695b2fd5:1 d41ce53e:1 2828f516:1 d8e89fe9:1 32391a33:1 4e7732cb:1 69be011d:1 b7735515:1 bb651fbb:1 59ea2061:1 0c22beea:1 f6344a99:1 b1193bb3:1 c49a9d1a:1 475f9c0c:1 87438d74:1 f8319948:1 6cdf0ecf:1 fc0d1db1:1 163b506f:1",
      "SKILL.md\t### 6.1 분류\t18\tb6ce8fb9:1 a56726cd:1 021fb596:1 eb868a52:1 8a718f6d:1 0371d57a:1 80778808:1 06001ab4:1 42402ab3:1 39d4b54e:1 ee407353:1 9b6879ad:1 5db94bf9:1 717c35b4:1 18c43429:1 671df184:1 d10b36aa:1 f1b90184:1",
      "SKILL.md\t### 6.5 Multi-aspect 요구사항 분리\t5\t2c70a7a0:1 5bfbc903:1 e292f01d:1 c93d17b9:1 cb3f91d5:1",
      "references/extended-workflow.md\t### 9.1 작성자 컨텍스트\t10\tcb2239cb:1 8e42b0a4:1 138d4f3e:1 9b8c6770:1 692879a3:1 0a43f9f3:1 24b803ff:1 f853dd0d:1 5c7fb4cd:1 4a69ba62:1",
      "references/extended-workflow.md\t#### new-feature\t12\t5ed2f36c:1 ce98a41b:1 f1b90184:1 f633b27f:1 f1b90184:1 8d517f4a:1 ce39536f:1 7fbee4b0:1 848a58ec:1 058c4be0:1 5be11a5a:1 7c6abcba:1",
      "references/extended-workflow.md\t### 11.1 keep / drop\t7\t571a66ca:1 1196e5c7:1 23cca02b:1 3c7052db:1 cd083da4:1 94be3cb9:1 79b35da1:1"
    ]
  },
  "FR-FLOW-209": {
    "skills/claude": [
      "SKILL.md\t## 핵심 규칙 — 컴팩션 뒤에도 남는 PRD 판정 (FR-FLOW-205)\t15\t7287441c:1 c4d1e424:1 3fda81f9:1 ad332335:1 47fcb43d:1 97d93c95:1 f1b90184:1 c9b58f8c:1 fedf5f55:1 e090372b:1 836ee316:1 b7586751:1 5ce42c99:1 06b389ea:1 cb3f91d5:1",
      "SKILL.md\t### 9.1 작성자 컨텍스트\t10\tf496c86c:1 0cc77084:1 138d4f3e:1 9b8c6770:1 692879a3:1 0a43f9f3:1 24b803ff:1 f853dd0d:1 5c7fb4cd:1 4a69ba62:1",
      "SKILL.md\t### 10.3 출력 스키마\t27\ta56726cd:1 021fb596:1 27032e39:1 b9b8ab92:1 b68c3150:1 021fb596:1 2d2b4dac:1 631d4c4c:1 374ca6fa:1 bd3d33aa:1 4e877f3f:1 a35c03a6:1 5426aa43:1 ed2d6de9:1 e5890a48:1 d10b36aa:1 39d4b54e:1 ec5e9af8:1 b6e56484:1 39d4b54e:1 34d8e0c7:1 d61e285c:1 39d4b54e:1 a363748f:1 d10b36aa:1 f1b90184:1 9d0321a5:1"
    ],
    "skills/codex": [
      "SKILL.md\t## 핵심 규칙 — 컴팩션 뒤에도 남는 PRD 판정 (FR-FLOW-205)\t15\t7287441c:1 c4d1e424:1 3fda81f9:1 ad332335:1 47fcb43d:1 97d93c95:1 f1b90184:1 c9b58f8c:1 fedf5f55:1 e090372b:1 836ee316:1 b7586751:1 5ce42c99:1 06b389ea:1 cb3f91d5:1",
      "references/extended-workflow.md\t### 9.1 작성자 컨텍스트\t10\tcb2239cb:1 8e42b0a4:1 138d4f3e:1 9b8c6770:1 692879a3:1 0a43f9f3:1 24b803ff:1 f853dd0d:1 5c7fb4cd:1 4a69ba62:1",
      "references/extended-workflow.md\t### 10.3 출력 스키마\t27\ta56726cd:1 021fb596:1 27032e39:1 b9b8ab92:1 b68c3150:1 021fb596:1 2d2b4dac:1 631d4c4c:1 374ca6fa:1 bd3d33aa:1 4e877f3f:1 a35c03a6:1 5426aa43:1 ed2d6de9:1 e5890a48:1 d10b36aa:1 39d4b54e:1 ec5e9af8:1 b6e56484:1 39d4b54e:1 34d8e0c7:1 d61e285c:1 39d4b54e:1 a363748f:1 d10b36aa:1 f1b90184:1 9d0321a5:1"
    ],
    "skills/etc": [
      "SKILL.md\t## 핵심 규칙 — 컴팩션 뒤에도 남는 PRD 판정 (FR-FLOW-205)\t15\t7287441c:1 c4d1e424:1 3fda81f9:1 ad332335:1 47fcb43d:1 97d93c95:1 f1b90184:1 c9b58f8c:1 fedf5f55:1 e090372b:1 836ee316:1 b7586751:1 5ce42c99:1 06b389ea:1 cb3f91d5:1",
      "references/extended-workflow.md\t### 9.1 작성자 컨텍스트\t10\tc0a00764:1 8e42b0a4:1 138d4f3e:1 9b8c6770:1 692879a3:1 0a43f9f3:1 24b803ff:1 f853dd0d:1 5c7fb4cd:1 4a69ba62:1",
      "references/extended-workflow.md\t### 10.3 출력 스키마\t27\ta56726cd:1 021fb596:1 27032e39:1 b9b8ab92:1 b68c3150:1 021fb596:1 2d2b4dac:1 631d4c4c:1 374ca6fa:1 bd3d33aa:1 4e877f3f:1 a35c03a6:1 5426aa43:1 ed2d6de9:1 e5890a48:1 d10b36aa:1 39d4b54e:1 ec5e9af8:1 b6e56484:1 39d4b54e:1 34d8e0c7:1 d61e285c:1 39d4b54e:1 a363748f:1 d10b36aa:1 f1b90184:1 9d0321a5:1"
    ],
    ".agents/skills": [
      "SKILL.md\t## 핵심 규칙 — 컴팩션 뒤에도 남는 PRD 판정 (FR-FLOW-205)\t15\t7287441c:1 c4d1e424:1 3fda81f9:1 ad332335:1 47fcb43d:1 97d93c95:1 f1b90184:1 c9b58f8c:1 fedf5f55:1 e090372b:1 836ee316:1 b7586751:1 5ce42c99:1 06b389ea:1 cb3f91d5:1",
      "references/extended-workflow.md\t### 9.1 작성자 컨텍스트\t10\tcb2239cb:1 8e42b0a4:1 138d4f3e:1 9b8c6770:1 692879a3:1 0a43f9f3:1 24b803ff:1 f853dd0d:1 5c7fb4cd:1 4a69ba62:1",
      "references/extended-workflow.md\t### 10.3 출력 스키마\t27\ta56726cd:1 021fb596:1 27032e39:1 b9b8ab92:1 b68c3150:1 021fb596:1 2d2b4dac:1 631d4c4c:1 374ca6fa:1 bd3d33aa:1 4e877f3f:1 a35c03a6:1 5426aa43:1 ed2d6de9:1 e5890a48:1 d10b36aa:1 39d4b54e:1 ec5e9af8:1 b6e56484:1 39d4b54e:1 34d8e0c7:1 d61e285c:1 39d4b54e:1 a363748f:1 d10b36aa:1 f1b90184:1 9d0321a5:1"
    ]
  },
  "FR-FLOW-210": {
    "skills/claude": [
      "SKILL.md\t## 3. PRD 문법\t34\tee97337f:1 35880051:1 ba73bbe5:1 90772ac0:1 0871a59c:1 911417ae:1 c40ed45f:1 895bf878:1 a410d240:1 b98d4548:1 307c96a4:1 8985de79:1 e1141331:1 d4618a3c:1 1824849c:1 4199ba45:1 9be1436a:1 c28ccada:1 70b90b36:1 65d4874f:1 d779f61a:1 966cb1c0:1 e39c8d93:1 b959e348:1 1824849c:1 4199ba45:1 51e6da68:1 f820ba12:1 3ee43b7b:1 0f07c1cc:1 7207e7bb:1 3e9fc4bc:1 eadf7aca:1 f1b90184:1"
    ],
    "skills/codex": [
      "SKILL.md\t## 3. PRD 문법\t34\tee97337f:1 35880051:1 ba73bbe5:1 90772ac0:1 0871a59c:1 911417ae:1 c40ed45f:1 895bf878:1 a410d240:1 b98d4548:1 307c96a4:1 8985de79:1 e1141331:1 d4618a3c:1 1824849c:1 4199ba45:1 9be1436a:1 c28ccada:1 70b90b36:1 65d4874f:1 d779f61a:1 966cb1c0:1 e39c8d93:1 b959e348:1 1824849c:1 4199ba45:1 51e6da68:1 f820ba12:1 3ee43b7b:1 0f07c1cc:1 7207e7bb:1 3e9fc4bc:1 eadf7aca:1 f1b90184:1"
    ],
    "skills/etc": [
      "SKILL.md\t## 3. PRD 문법\t34\tee97337f:1 35880051:1 ba73bbe5:1 90772ac0:1 0871a59c:1 911417ae:1 c40ed45f:1 895bf878:1 a410d240:1 b98d4548:1 307c96a4:1 8985de79:1 e1141331:1 d4618a3c:1 1824849c:1 4199ba45:1 9be1436a:1 c28ccada:1 70b90b36:1 65d4874f:1 d779f61a:1 966cb1c0:1 e39c8d93:1 b959e348:1 1824849c:1 4199ba45:1 51e6da68:1 f820ba12:1 3ee43b7b:1 0f07c1cc:1 7207e7bb:1 3e9fc4bc:1 eadf7aca:1 f1b90184:1"
    ],
    ".agents/skills": [
      "SKILL.md\t## 3. PRD 문법\t34\tee97337f:1 35880051:1 ba73bbe5:1 90772ac0:1 0871a59c:1 911417ae:1 c40ed45f:1 895bf878:1 a410d240:1 b98d4548:1 307c96a4:1 8985de79:1 e1141331:1 d4618a3c:1 1824849c:1 4199ba45:1 9be1436a:1 c28ccada:1 70b90b36:1 65d4874f:1 d779f61a:1 966cb1c0:1 e39c8d93:1 b959e348:1 1824849c:1 4199ba45:1 51e6da68:1 f820ba12:1 3ee43b7b:1 0f07c1cc:1 7207e7bb:1 3e9fc4bc:1 eadf7aca:1 f1b90184:1"
    ]
  },
  "FR-FLOW-211": {
    "skills/claude": [
      "SKILL.md\t(top)\t2\td914dca4:1 0b7beaa4:1",
      "SKILL.md\t# kiwi-pm v0.1\t3\tc0395013:1 4fce87bd:1 cb3f91d5:1",
      "SKILL.md\t## 핵심 규칙 — 컴팩션 뒤에도 남는 실행 규칙 (FR-FLOW-223)\t3\t63451555:1 69b1661e:1 cb3f91d5:1",
      "SKILL.md\t## 0. 공통 규약 (SSOT)\t20\t3cd39375:1 4199ba45:1 40f7dcfe:1 ef23af26:1 25826395:1 01f55da4:1 f7bf6e70:1 1330dbf8:1 88af73b5:1 8ddfe9db:1 b677cae3:1 f6a5c73d:1 22d3dbf9:1 d8f66d4f:1 30dcc1c8:1 4a150061:1 ac212ca6:1 538cad9a:1 7865cd3c:1 1296a589:1",
      "SKILL.md\t#### §0.G1 — 입력 무결성\t11\t657898dc:1 41399f0d:1 4199ba45:1 da39e2f1:1 4b5aa45b:1 05f7e7b6:1 5fbfa5af:1 f6525a47:1 350aa6f7:1 d9aab87d:1 6fab408c:1",
      "SKILL.md\t### 1.1 필수 입력\t4\t0c96df4b:1 67a39b75:1 77299e13:1 ba3e7763:1",
      "SKILL.md\t### 1.2 선택 입력 + 자연어 매핑\t24\t6460e4f5:1 23cca02b:1 6d3dd213:1 f44289e1:1 9501812a:1 bf15fdb1:1 75589663:1 3d10f4bb:1 8694050f:1 53bb0005:1 8cff72d0:1 16c681b6:1 942017fb:1 4bd580a7:1 3808a5bb:1 4bd86e10:1 408f323a:1 f1066a26:1 6f485945:1 22df5d45:1 a7de704f:1 c8c521ba:1 05ce11b8:1 a135f60c:1",
      "SKILL.md\t### 1.3 CLI 인자 요약\t24\tf1b90184:1 5cf11cea:1 165a339b:1 c3e24366:1 15dc63dd:1 9ab3924c:1 1ee10aa0:1 0c54dcd7:1 08f70a28:1 9cb00540:1 ba4886d1:1 2c0eb37b:1 9227871d:1 a1df9fd9:1 727d1d37:1 337efdf1:1 f4f07d06:1 5f396501:1 0da87072:1 24c243f8:1 f1a068dd:1 644594c6:1 f1b90184:1 6623c532:1",
      "SKILL.md\t### 2.1 디렉토리 SSOT\t10\t2665e098:1 f1b90184:1 b2c313cc:1 5daa0874:1 72ecd566:1 e943679f:1 f2f3cfcf:1 93fd123f:1 f1b90184:1 a322de30:1",
      "SKILL.md\t### 2.2 pm-state.json 스키마\t61\ta56726cd:1 021fb596:1 5e1df321:1 a6401169:1 cf999688:1 782dee37:1 039f4196:1 0f8aa7ea:1 56555ea8:1 f051c952:1 6edb669c:1 c0c97be4:1 381661be:1 41a17a02:1 c40b10a0:1 e9b14849:1 03a7ec42:1 00725b8f:1 d607abd6:1 dabf2967:1 89a8d5fa:1 de62e534:1 6c480085:1 3df4708d:1 e52a1813:1 e0f18bb1:1 1d41ad4c:1 50b7638e:1 74cab6a3:1 cc5e69f6:1 31211cda:1 e98425ed:1 52ff8615:1 e52a1813:1 09c9b4ed:1 2a241a87:1 5e2e2e20:1 d10b36aa:1 e52a1813:1 0ced1e3a:1 d6d32596:1 6878f75e:1 3ae387e6:1 34a1e910:1 d10b36aa:1 f1b90184:1 b9933a98:1 9c9abd03:1 3a3d488b:1 a7ac7968:1 42f86bcc:1 7ac81781:1 fa64283a:1 271cb387:1 765b5c74:1 457a0f1f:1 49536efe:1 32620e3b:1 73ae175f:1 e376678c:1 e7363a75:1",
      "SKILL.md\t### 3.1 실행 의사코드\t66\tf1b90184:1 9001197a:1 bcfc5f77:1 259a8a3f:1 e1ef9597:1 f323b53c:1 61ce65fb:1 4c8d3e14:1 4567438f:1 7eb16d75:1 93f122fc:1 623c0244:1 f323b53c:1 7ef16ea8:1 883daaca:1 9a86703d:1 b154c3b8:1 f602e3da:1 5d6015f1:1 da651d16:1 5b009f13:1 dfe32373:1 b8abfa25:1 59d347a4:1 8243025d:1 f13936ce:1 08552cee:1 05b77223:1 52cc528a:1 2196a538:1 6906e1f1:1 18b285a9:1 d5f44025:1 c0ad4cfc:1 521977cf:1 3587e83a:1 13a4c6d0:1 b4534ebc:1 a5ad98c0:1 7f4d2406:1 1ebaccd3:1 11cf1bb1:1 dfff1e39:1 89649012:1 b2871417:1 3d06c96d:1 c1a94cfc:1 2cdf4891:1 9dc81840:1 3112333a:1 313efe90:1 5b009f13:1 6c123afd:1 ad55851b:1 3eed94b1:1 f0e38742:1 3c7ef9e3:1 b970532f:1 9436ffd9:1 dcf673c9:1 3d88d4be:1 8f5afa7a:1 30c28bb1:1 c890f506:1 4a6d9a1a:1 f1b90184:1",
      "SKILL.md\t### 3.2 Agent 자식 spawn 프롬프트\t72\tae9beca2:1 f1b90184:1 e1e23bd4:1 d9c74041:1 a7d181b7:1 116b5e0f:1 6bd79203:1 156e7beb:1 8eeffcd3:1 e8b586fd:1 2f85eaf6:1 a8ee85a7:1 16619b38:1 08aeee64:1 d22ee250:1 2e07bb66:1 6d3b4515:1 116a82b0:1 af5ff034:1 847c1074:1 67e5c77a:1 8bf5e970:1 371fccd3:1 9623854b:1 64cf2fae:1 b48af5bf:1 0111fe88:1 7b06fcd4:1 c798ab43:1 95e46748:1 e0d29a6e:1 6e5e7b22:1 d16b2b8b:1 346418cd:1 6ad76f56:1 aa3b6d42:1 c2a16db7:1 08a2b1b6:1 e618d6f7:1 a9ba2592:1 a70b1163:1 9d0e8aa2:1 fea6b101:1 00dbf6a8:1 b04da399:1 37225a75:1 0bc83e10:1 9d0e8aa2:1 b7dec176:1 df2650ed:1 fd4f347f:1 6ed2d708:1 f6f65e7b:1 c9071b35:1 519512e1:1 a3c9f9cc:1 e3f39742:1 a9b57585:1 97a44e86:1 bfc557fd:1 39d4b54e:1 80c2a81f:1 2f86e39b:1 39d4b54e:1 d17e0a41:1 4fa54ef7:1 7b3ef6a4:1 526eb357:1 f796e345:1 2f86e39b:1 2f86e39b:1 f1b90184:1",
      "SKILL.md\t## 4. Lifecycle Gate\t1\t8995c83f:1",
      "SKILL.md\t### 4.1 차단 분류\t7\t6f693ca6:1 23cca02b:1 a185d3ea:1 e1105342:1 b80639d0:1 4e6bb72e:1 284873df:1",
      "SKILL.md\t### 4.3 `--auto` 동작\t7\td2a220fd:1 439d3721:1 f89751f3:1 016198d7:1 e3c17a36:1 ee2a12e5:1 f02bf049:1",
      "SKILL.md\t### 4.4 MCP 미가용 fallback\t6\t0494229e:1 4f6ded7a:1 ace3c338:1 c1e6c003:1 d3cc1cdb:1 9c63f939:1",
      "SKILL.md\t### 4.5 의사코드\t74\tf1b90184:1 7663e118:1 45b171eb:1 d8bcd7b0:1 c3172d0b:1 dd587fee:1 a73392d5:1 b86bf6a4:1 b94508f0:1 37209f38:1 c049bebc:1 30a41c86:1 b282f4ed:1 81dbf376:1 394ae9cd:1 cd1f1f32:1 b9329af8:1 cbff586f:1 50fd7403:1 9701065d:1 2c299b78:1 f323b53c:1 394ae9cd:1 d2acf45c:1 b9329af8:1 2f87bb9b:1 50fd7403:1 9701065d:1 2c299b78:1 e1a3eaac:1 45ea3849:1 0dd7b0a2:1 75247e17:1 b6489057:1 463d499a:1 3db32804:1 bf8f8fcc:1 724bb1ff:1 097d5704:1 5eb9d76d:1 11e5569a:1 388591a7:1 bbe2e005:1 d10b36aa:1 5b009f13:1 8efcb51e:1 011ab388:1 92c91e98:1 9de35576:1 b5713fd2:1 5b009f13:1 838478fa:1 c3172d0b:1 961b297f:1 13f70c60:1 06401138:1 cfebdfbf:1 c7452b58:1 cde998c3:1 b5713fd2:1 5b009f13:1 be3d47f8:1 f323b53c:1 d1c769a0:1 07c34733:1 15923329:1 12dcb914:1 cb62b811:1 2fbbe8b2:1 5b009f13:1 f1b90184:1 a7aec2b9:1 04395454:1 cb3f91d5:1",
      "SKILL.md\t### 5.4 `--resume` 동작\t13\t79e93128:1 419c6489:1 38fbe38d:1 d64a5f9b:1 145fde51:1 ed2c9513:1 79da0845:1 c24513af:1 c366f4dc:1 f64b53d8:1 3a77daf3:1 e1e6b76b:1 505d252c:1",
      "SKILL.md\t### 6.2 T-final SRS Status 마무리\t95\tbbb929fc:1 cb1cbc27:1 369be77b:1 bb9ab4df:1 f1b90184:1 52d73ce6:1 f813fff0:1 81dbf376:1 b90c44c4:1 f323b53c:1 d2acf45c:1 904d812f:1 a66c3c7a:1 a3bb586d:1 865da60d:1 8345bd5e:1 ee9c6a97:1 ca9c9562:1 4373adb6:1 2450ae94:1 c35c47b3:1 63496bba:1 64d9e501:1 dc45ddf1:1 176f8c70:1 f972fe70:1 31aab716:1 d10b36aa:1 f2fea05e:1 eb98e45b:1 6695869a:1 10e83ec4:1 b8f35f7b:1 bd3c47a8:1 8647ee76:1 f8b63aa3:1 89e9ca78:1 ba5ec51d:1 ac3e49a9:1 cfe08573:1 a97d23f6:1 c3172d0b:1 ab1d12ad:1 453ca891:1 fb918a78:1 334359b9:1 e3e68604:1 f49766f7:1 ccc7c649:1 79d938b2:1 9ef480ce:1 17f60690:1 aa9a6bd5:1 f0528cd6:1 d21df8be:1 394ae9cd:1 284c6232:1 ebd2589c:1 f323b53c:1 aef1f971:1 60a91c4e:1 17be6445:1 834f30b4:1 2c58b0f2:1 78866c05:1 5dcb8680:1 98f4d591:1 188b390d:1 4205e179:1 ba5ec51d:1 170e52b1:1 6327beb3:1 ba89141a:1 6794f608:1 48b0fc37:1 873b6ba9:1 d345717a:1 ba5ec51d:1 60a91c4e:1 493fba3b:1 f58a5318:1 2c58b0f2:1 1513ffa7:1 9bb5c2d7:1 4583e302:1 62499381:1 5b009f13:1 f1b90184:1 f23904a0:1 f97c1e7a:1 4da1ec6f:1 d401586f:1 c0dd8c24:1 578aea0a:1 0513e2fd:1",
      "SKILL.md\t### 6.4 kiwi-review-fix-loop hand-off\t18\t6d4c80f7:1 f1b90184:1 0fab5cbf:1 2eb1576f:1 3204227e:1 907ba7fa:1 1a9ad4ef:1 f1b90184:1 216e5fc0:1 e8c4e496:1 33a7fcaf:1 14a507a1:1 c4520987:1 07cc28eb:1 1c67e2b2:1 cbd4d0c4:1 478d6c48:1 07d1df6b:1",
      "SKILL.md\t#### 6.4.1 `--sds` 실행의 hand-off (FR-FLOW-183)\t13\t458550e3:1 f1b90184:1 88f439fe:1 f1278a54:1 0fab5cbf:1 48e5b48c:1 1d2c95fa:1 907ba7fa:1 1a9ad4ef:1 a65d9c37:1 f1b90184:1 1c63e425:1 cb3f91d5:1",
      "SKILL.md\t### 7.1 입력 무결성 게이트 (T-1)\t12\t680f383f:1 4199ba45:1 ad7c5a8d:1 dafeb7d1:1 25fc947b:1 c097b74e:1 8f907b48:1 2ea87bac:1 1498a676:1 c2ce9d7c:1 9059b750:1 6fab408c:1",
      "SKILL.md\t## 8. 호출 예시\t15\tad332335:1 1fa1bf69:1 19956b63:1 eda75814:1 f5cbe88b:1 6c0ba719:1 e0eb53ed:1 7c14f5b3:1 1305f1dd:1 94d086d9:1 bea06ae6:1 9fa3393d:1 dcf67bf8:1 f1b90184:1 cb3f91d5:1",
      "SKILL.md\t## 9. 설계 요약\t7\t351fe964:1 91cc172f:1 cf34f87a:1 b8ea4484:1 799db331:1 90cecd2a:1 052ead20:1",
      "SKILL.md\t### MCP 호출 분담 표 (speckiwi 실제 schema)\t14\t481f5962:1 4da1ec6f:1 01c46fb7:1 d2354436:1 48868688:1 02ef48b8:1 f71fe53a:1 ebe584e6:1 70999ede:1 5a8f92c2:1 c8b46f50:1 bd917e01:1 e35f0d35:1 cb3f91d5:1"
    ],
    "skills/codex": [
      "SKILL.md\t(top)\t2\tda0bb095:1 0b7beaa4:1",
      "SKILL.md\t## Official Workflow Tool Policy\t8\t56dd546e:1 b27d11cb:1 e31eeaec:1 bb86273e:1 6ee48ca6:1 0b3c8e90:1 befb240b:1 cb3f91d5:1",
      "SKILL.md\t## 핵심 규칙 — 컴팩션 뒤에도 남는 실행 규칙 (FR-FLOW-223)\t3\t63451555:1 69b1661e:1 cb3f91d5:1",
      "SKILL.md\t## 0. 공통 규약 (SSOT)\t20\t3cd39375:1 4199ba45:1 40f7dcfe:1 62e7b719:1 25826395:1 89aa7b3e:1 f7bf6e70:1 1330dbf8:1 4783f3b6:1 d88d1702:1 b677cae3:1 2691ea84:1 22d3dbf9:1 d8f66d4f:1 30dcc1c8:1 4a150061:1 1f7c6729:1 4e14f40a:1 b68dfcd6:1 1296a589:1",
      "SKILL.md\t#### §0.G1 — 입력 무결성\t11\t657898dc:1 41399f0d:1 4199ba45:1 da39e2f1:1 1b66a4f8:1 05f7e7b6:1 93d5dd17:1 86d34597:1 32205632:1 d9aab87d:1 6fab408c:1",
      "SKILL.md\t### 1.1 필수 입력\t4\t0c96df4b:1 b7be39ca:1 e715c3d5:1 ba3e7763:1",
      "SKILL.md\t### 1.2 선택 입력 + 자연어 매핑\t24\t6460e4f5:1 23cca02b:1 6d3dd213:1 f44289e1:1 9501812a:1 bf15fdb1:1 1af78acd:1 3d10f4bb:1 8694050f:1 53bb0005:1 8cff72d0:1 6f485945:1 22df5d45:1 a7de704f:1 c8c521ba:1 05ce11b8:1 a135f60c:1 16c681b6:1 942017fb:1 4bd580a7:1 3808a5bb:1 4bd86e10:1 408f323a:1 f1066a26:1",
      "SKILL.md\t### 1.3 CLI 인자 요약\t24\tf1b90184:1 ec49dbc8:1 165a339b:1 c3e24366:1 15dc63dd:1 4c10be3a:1 1ee10aa0:1 0c54dcd7:1 08f70a28:1 9cb00540:1 ba4886d1:1 2c0eb37b:1 9227871d:1 a1df9fd9:1 727d1d37:1 337efdf1:1 f4f07d06:1 5f396501:1 0da87072:1 24c243f8:1 f1a068dd:1 644594c6:1 f1b90184:1 47af0045:1",
      "SKILL.md\t### 2.1 디렉토리 SSOT\t10\t2665e098:1 f1b90184:1 b2c313cc:1 5daa0874:1 72ecd566:1 e943679f:1 f2f3cfcf:1 93fd123f:1 f1b90184:1 a322de30:1",
      "SKILL.md\t### 2.2 pm-state.json 스키마\t61\ta56726cd:1 021fb596:1 5e1df321:1 a6401169:1 cf999688:1 782dee37:1 039f4196:1 0f8aa7ea:1 56555ea8:1 f051c952:1 6edb669c:1 c0c97be4:1 381661be:1 41a17a02:1 c40b10a0:1 e9b14849:1 03a7ec42:1 00725b8f:1 d607abd6:1 dabf2967:1 89a8d5fa:1 de62e534:1 6c480085:1 3df4708d:1 e52a1813:1 e0f18bb1:1 1d41ad4c:1 50b7638e:1 74cab6a3:1 cc5e69f6:1 31211cda:1 e98425ed:1 52ff8615:1 e52a1813:1 09c9b4ed:1 2a241a87:1 5e2e2e20:1 d10b36aa:1 e52a1813:1 0ced1e3a:1 d6d32596:1 6878f75e:1 3ae387e6:1 34a1e910:1 d10b36aa:1 f1b90184:1 b9933a98:1 9c9abd03:1 3a3d488b:1 a7ac7968:1 42f86bcc:1 7ac81781:1 fa64283a:1 271cb387:1 d7b2993f:1 457a0f1f:1 49536efe:1 32620e3b:1 73ae175f:1 e376678c:1 e7363a75:1",
      "SKILL.md\t### 3.1 실행 의사코드\t66\tf1b90184:1 9001197a:1 bcfc5f77:1 259a8a3f:1 e1ef9597:1 f323b53c:1 61ce65fb:1 4c8d3e14:1 4567438f:1 7eb16d75:1 93f122fc:1 623c0244:1 f323b53c:1 7ef16ea8:1 883daaca:1 9a86703d:1 d3fa6650:1 f602e3da:1 5d6015f1:1 da651d16:1 5b009f13:1 dfe32373:1 b8abfa25:1 59d347a4:1 8243025d:1 f13936ce:1 08552cee:1 05b77223:1 52cc528a:1 1f9c3c87:1 6906e1f1:1 18b285a9:1 d5f44025:1 c0ad4cfc:1 521977cf:1 3587e83a:1 13a4c6d0:1 b4534ebc:1 a5ad98c0:1 3abdbc4c:1 1ebaccd3:1 11cf1bb1:1 dfff1e39:1 89649012:1 b2871417:1 3d06c96d:1 c1a94cfc:1 2cdf4891:1 9dc81840:1 3112333a:1 313efe90:1 5b009f13:1 6c123afd:1 ad55851b:1 3eed94b1:1 f0e38742:1 3c7ef9e3:1 b970532f:1 9436ffd9:1 dcf673c9:1 3d88d4be:1 8f5afa7a:1 30c28bb1:1 c890f506:1 4a6d9a1a:1 f1b90184:1",
      "SKILL.md\t### 3.2 서브에이전트 자식 실행 프롬프트\t70\t9353246d:1 f1b90184:1 e1e23bd4:1 d9c74041:1 a7d181b7:1 116b5e0f:1 6bd79203:1 156e7beb:1 8eeffcd3:1 eac55062:1 e8b586fd:1 2f85eaf6:1 a8ee85a7:1 16619b38:1 08aeee64:1 d22ee250:1 2e07bb66:1 e9bda2f2:1 091a8af5:1 f1b90184:1 6b2de1c7:1 f1b90184:1 7f8cda0e:1 7abc310b:1 d674eaca:1 0111fe88:1 c798ab43:1 95e46748:1 e0d29a6e:1 6e5e7b22:1 d16b2b8b:1 eb1225f4:1 6ad76f56:1 aa3b6d42:1 c2a16db7:1 08a2b1b6:1 e618d6f7:1 a9ba2592:1 a70b1163:1 9d0e8aa2:1 fea6b101:1 00dbf6a8:1 b04da399:1 37225a75:1 0bc83e10:1 9d0e8aa2:1 b7dec176:1 df2650ed:1 fd4f347f:1 6ed2d708:1 f6f65e7b:1 c9071b35:1 519512e1:1 a3c9f9cc:1 e3f39742:1 a9b57585:1 97a44e86:1 bfc557fd:1 39d4b54e:1 7c971303:1 2f86e39b:1 39d4b54e:1 d17e0a41:1 4fa54ef7:1 7b3ef6a4:1 526eb357:1 f796e345:1 2f86e39b:1 2f86e39b:1 f1b90184:1",
      "SKILL.md\t### 3.6 Lifecycle gate 차단의 `--auto` 동작\t9\t455cbc37:1 a851faa1:1 439d3721:1 f89751f3:1 016198d7:1 e3c17a36:1 ee2a12e5:1 f02bf049:1 cb3f91d5:1",
      "references/extended-workflow.md\t## Table of Contents\t26\t81031d43:1 d93d9db6:1 3ef4b814:1 47f69970:1 42ebd5b1:1 0cfec429:1 dd3c9b9a:1 8b9ecfa5:1 7ec7ae1a:1 6db35dda:1 41b6694f:1 ade9dd48:1 7f91eab1:1 ba6ff726:1 21295fb0:1 de503533:1 ecb3ceef:1 7e30cf73:1 8229260f:1 25cd6bbc:1 1521de42:1 8a21a99a:1 9ef51fcc:1 88ae657b:1 37b49457:1 cb3f91d5:1",
      "references/extended-workflow.md\t## 4. Lifecycle Gate (kiwi-pipeline-v1 §4.2)\t1\tf50dcdb0:1",
      "references/extended-workflow.md\t### 4.1 차단 분류\t7\t6f693ca6:1 23cca02b:1 a185d3ea:1 2fea631a:1 b80639d0:1 4e6bb72e:1 284873df:1",
      "references/extended-workflow.md\t### 4.4 MCP 미가용 처리\t3\t0494229e:1 772d0f20:1 c3da7d07:1",
      "references/extended-workflow.md\t### 4.5 의사코드\t70\tf1b90184:1 7663e118:1 45b171eb:1 d8bcd7b0:1 c3172d0b:1 dd587fee:1 1ca6a8b8:1 7f87730e:1 04fb9a8d:1 b86bf6a4:1 b94508f0:1 37209f38:1 c049bebc:1 006cae08:1 b282f4ed:1 81dbf376:1 394ae9cd:1 cd1f1f32:1 b9329af8:1 04fb9a8d:1 f323b53c:1 394ae9cd:1 d2acf45c:1 b9329af8:1 04fb9a8d:1 e1a3eaac:1 45ea3849:1 0dd7b0a2:1 75247e17:1 b6489057:1 463d499a:1 3db32804:1 bf8f8fcc:1 724bb1ff:1 097d5704:1 5eb9d76d:1 11e5569a:1 388591a7:1 bbe2e005:1 d10b36aa:1 5b009f13:1 8efcb51e:1 011ab388:1 92c91e98:1 9de35576:1 b5713fd2:1 5b009f13:1 838478fa:1 c3172d0b:1 961b297f:1 13f70c60:1 06401138:1 cfebdfbf:1 c7452b58:1 cde998c3:1 b5713fd2:1 5b009f13:1 757309cc:1 f323b53c:1 2a4ec5ad:1 7b9bc909:1 15923329:1 12dcb914:1 cb62b811:1 2fbbe8b2:1 5b009f13:1 f1b90184:1 a7aec2b9:1 04395454:1 cb3f91d5:1",
      "references/extended-workflow.md\t### 5.4 `--resume` 동작\t13\t79e93128:1 419c6489:1 38fbe38d:1 d64a5f9b:1 145fde51:1 ed2c9513:1 7ac726c1:1 c24513af:1 c366f4dc:1 f64b53d8:1 3a77daf3:1 e1e6b76b:1 a5ffe824:1",
      "references/extended-workflow.md\t### 6.2 T-final SRS Status 마무리\t95\tbba5ecb8:1 cb1cbc27:1 369be77b:1 bb9ab4df:1 f1b90184:1 52d73ce6:1 f813fff0:1 81dbf376:1 b90c44c4:1 f323b53c:1 d2acf45c:1 904d812f:1 a66c3c7a:1 a3bb586d:1 865da60d:1 8345bd5e:1 ee9c6a97:1 ca9c9562:1 4373adb6:1 2450ae94:1 c35c47b3:1 63496bba:1 64d9e501:1 dc45ddf1:1 176f8c70:1 f972fe70:1 31aab716:1 d10b36aa:1 f2fea05e:1 eb98e45b:1 6695869a:1 10e83ec4:1 b8f35f7b:1 ec3225c8:1 8647ee76:1 f8b63aa3:1 89e9ca78:1 ba5ec51d:1 ac3e49a9:1 cfe08573:1 a97d23f6:1 c3172d0b:1 ab1d12ad:1 810a10ac:1 fb918a78:1 334359b9:1 e3e68604:1 f49766f7:1 ccc7c649:1 79d938b2:1 9ef480ce:1 17f60690:1 aa9a6bd5:1 f0528cd6:1 d21df8be:1 394ae9cd:1 284c6232:1 ebd2589c:1 f323b53c:1 aef1f971:1 60a91c4e:1 17be6445:1 834f30b4:1 2c58b0f2:1 78866c05:1 5dcb8680:1 98f4d591:1 188b390d:1 4205e179:1 ba5ec51d:1 170e52b1:1 6327beb3:1 ba89141a:1 6794f608:1 48b0fc37:1 873b6ba9:1 d345717a:1 ba5ec51d:1 60a91c4e:1 493fba3b:1 f58a5318:1 2c58b0f2:1 1513ffa7:1 9bb5c2d7:1 4583e302:1 62499381:1 5b009f13:1 f1b90184:1 f23904a0:1 f97c1e7a:1 4da1ec6f:1 d401586f:1 c0dd8c24:1 578aea0a:1 0513e2fd:1",
      "references/extended-workflow.md\t### 6.4 kiwi-review-fix-loop hand-off\t14\t6d4c80f7:1 f1b90184:1 3ff2b9fb:1 f1b90184:1 216e5fc0:1 63a88c1c:1 33a7fcaf:1 14a507a1:1 c4520987:1 07cc28eb:1 1c67e2b2:1 cbd4d0c4:1 478d6c48:1 378a137b:1",
      "references/extended-workflow.md\t#### 6.4.1 `--sds` 실행의 hand-off (FR-FLOW-183)\t9\t458550e3:1 f1b90184:1 4aca28d1:1 f1278a54:1 be7491a3:1 4aca28d1:1 f1b90184:1 97c0933d:1 cb3f91d5:1",
      "references/extended-workflow.md\t### 7.1 입력 무결성 게이트 (T-1)\t12\t680f383f:1 4199ba45:1 ad7c5a8d:1 dafeb7d1:1 25fc947b:1 b288bda8:1 8f907b48:1 f1dca28c:1 e76bc3c1:1 d9f57ec9:1 9059b750:1 a27a1418:1",
      "references/extended-workflow.md\t## 8. 호출 예시\t15\tad332335:1 1fa1bf69:1 1bc5b697:1 eda75814:1 042f8a37:1 6c0ba719:1 aab86769:1 7c14f5b3:1 e2d48ad6:1 94d086d9:1 4c3c5b83:1 9fa3393d:1 89beb565:1 f1b90184:1 cb3f91d5:1",
      "references/extended-workflow.md\t## 9. 설계 요약\t7\t034f5ece:1 91cc172f:1 b87f3b07:1 dbdde9c9:1 799db331:1 90cecd2a:1 052ead20:1",
      "references/extended-workflow.md\t### MCP 호출 분담 표 (speckiwi 실제 schema)\t14\t481f5962:1 4da1ec6f:1 01c46fb7:1 d2354436:1 48868688:1 02ef48b8:1 f71fe53a:1 ebe584e6:1 70999ede:1 5a8f92c2:1 c8b46f50:1 bd917e01:1 c2a0c3cb:1 cb3f91d5:1"
    ],
    "skills/etc": [
      "SKILL.md\t(top)\t1\t7c8337e7:1",
      "SKILL.md\t# kiwi-pm v0.1\t4\tdba4d1c2:1 eb708c0f:1 befb240b:1 cb3f91d5:1",
      "SKILL.md\t## 핵심 규칙 — 컴팩션 뒤에도 남는 실행 규칙 (FR-FLOW-223)\t3\t63451555:1 69b1661e:1 cb3f91d5:1",
      "SKILL.md\t## 0. 공통 규약 (SSOT)\t19\t3cd39375:1 4199ba45:1 40f7dcfe:1 62e7b719:1 25826395:1 b60eac6f:1 f7bf6e70:1 1330dbf8:1 4783f3b6:1 1ae19e86:1 b677cae3:1 2691ea84:1 22d3dbf9:1 d8f66d4f:1 30dcc1c8:1 4a150061:1 85a976eb:1 12bfdbde:1 b18f5717:1",
      "SKILL.md\t#### §0.G1 — 입력 무결성\t11\t657898dc:1 41399f0d:1 4199ba45:1 da39e2f1:1 1b66a4f8:1 05f7e7b6:1 93d5dd17:1 86d34597:1 32205632:1 d9aab87d:1 6fab408c:1",
      "SKILL.md\t### 1.1 필수 입력\t4\t0c96df4b:1 b7be39ca:1 e715c3d5:1 ba3e7763:1",
      "SKILL.md\t### 1.2 선택 입력 + 자연어 매핑\t23\t6460e4f5:1 23cca02b:1 6d3dd213:1 f44289e1:1 9501812a:1 bf15fdb1:1 1af78acd:1 3d10f4bb:1 51f1730b:1 53bb0005:1 8cff72d0:1 6f485945:1 39dbe571:1 c8c521ba:1 05ce11b8:1 a135f60c:1 16c681b6:1 942017fb:1 4bd580a7:1 3808a5bb:1 4bd86e10:1 408f323a:1 f1066a26:1",
      "SKILL.md\t### 1.3 CLI 인자 요약\t24\tf1b90184:1 ec49dbc8:1 165a339b:1 c3e24366:1 15dc63dd:1 d76ce85a:1 a3249d53:1 bc8be9bb:1 08f70a28:1 9cb00540:1 ba4886d1:1 2c0eb37b:1 9227871d:1 a1df9fd9:1 727d1d37:1 337efdf1:1 f4f07d06:1 5f396501:1 0da87072:1 24c243f8:1 f1a068dd:1 644594c6:1 f1b90184:1 47af0045:1",
      "SKILL.md\t### 2.1 디렉토리 SSOT\t10\t2665e098:1 f1b90184:1 b2c313cc:1 5daa0874:1 72ecd566:1 e943679f:1 f2f3cfcf:1 93fd123f:1 f1b90184:1 a322de30:1",
      "SKILL.md\t### 2.2 pm-state.json 스키마\t61\ta56726cd:1 021fb596:1 5e1df321:1 a6401169:1 cf999688:1 782dee37:1 039f4196:1 0f8aa7ea:1 56555ea8:1 f051c952:1 6edb669c:1 c0c97be4:1 381661be:1 41a17a02:1 c40b10a0:1 e9b14849:1 03a7ec42:1 00725b8f:1 d607abd6:1 dabf2967:1 89a8d5fa:1 de62e534:1 6c480085:1 3df4708d:1 e52a1813:1 e0f18bb1:1 1d41ad4c:1 50b7638e:1 74cab6a3:1 cc5e69f6:1 31211cda:1 e98425ed:1 52ff8615:1 e52a1813:1 09c9b4ed:1 2a241a87:1 5e2e2e20:1 d10b36aa:1 e52a1813:1 0ced1e3a:1 d6d32596:1 6878f75e:1 3ae387e6:1 34a1e910:1 d10b36aa:1 f1b90184:1 b9933a98:1 9c9abd03:1 3a3d488b:1 a7ac7968:1 42f86bcc:1 7ac81781:1 fa64283a:1 271cb387:1 2e0341fd:1 457a0f1f:1 49536efe:1 32620e3b:1 73ae175f:1 e376678c:1 e7363a75:1",
      "SKILL.md\t### 3.1 실행 의사코드\t66\tf1b90184:1 9001197a:1 bcfc5f77:1 259a8a3f:1 e1ef9597:1 f323b53c:1 61ce65fb:1 4c8d3e14:1 4567438f:1 7eb16d75:1 93f122fc:1 623c0244:1 f323b53c:1 7ef16ea8:1 883daaca:1 9a86703d:1 d3fa6650:1 f602e3da:1 5d6015f1:1 da651d16:1 5b009f13:1 dfe32373:1 b8abfa25:1 59d347a4:1 8243025d:1 f13936ce:1 08552cee:1 05b77223:1 52cc528a:1 8e901698:1 6906e1f1:1 18b285a9:1 d5f44025:1 c0ad4cfc:1 521977cf:1 3587e83a:1 13a4c6d0:1 b4534ebc:1 a5ad98c0:1 39da6703:1 1ebaccd3:1 11cf1bb1:1 dfff1e39:1 89649012:1 b2871417:1 3d06c96d:1 c1a94cfc:1 2cdf4891:1 9dc81840:1 3112333a:1 313efe90:1 5b009f13:1 6c123afd:1 ad55851b:1 3eed94b1:1 f0e38742:1 3c7ef9e3:1 b970532f:1 9436ffd9:1 dcf673c9:1 3d88d4be:1 8f5afa7a:1 30c28bb1:1 c890f506:1 4a6d9a1a:1 f1b90184:1",
      "SKILL.md\t### 3.2 위임 worker 자식 실행 프롬프트\t69\t6614ec7f:1 f1b90184:1 a428728b:1 d9c74041:1 a7d181b7:1 116b5e0f:1 6bd79203:1 156e7beb:1 8eeffcd3:1 53a605fb:1 e8b586fd:1 2f85eaf6:1 a8ee85a7:1 16619b38:1 08aeee64:1 d22ee250:1 2e07bb66:1 e9bda2f2:1 31f6d1f4:1 f1b90184:1 58c21b27:1 f1b90184:1 7f8cda0e:1 18cfdb3a:1 0111fe88:1 c798ab43:1 95e46748:1 e0d29a6e:1 6e5e7b22:1 d16b2b8b:1 eb1225f4:1 6ad76f56:1 aa3b6d42:1 c2a16db7:1 08a2b1b6:1 e618d6f7:1 a9ba2592:1 a70b1163:1 9d0e8aa2:1 fea6b101:1 00dbf6a8:1 b04da399:1 37225a75:1 0bc83e10:1 9d0e8aa2:1 b7dec176:1 df2650ed:1 fd4f347f:1 6ed2d708:1 f6f65e7b:1 c9071b35:1 519512e1:1 a3c9f9cc:1 e3f39742:1 a9b57585:1 97a44e86:1 bfc557fd:1 39d4b54e:1 3c114f8f:1 2f86e39b:1 39d4b54e:1 d17e0a41:1 4fa54ef7:1 7b3ef6a4:1 526eb357:1 f796e345:1 2f86e39b:1 2f86e39b:1 f1b90184:1",
      "SKILL.md\t### 3.6 Lifecycle gate 차단의 `--auto` 동작\t9\t455cbc37:1 a851faa1:1 439d3721:1 f89751f3:1 016198d7:1 e3c17a36:1 ee2a12e5:1 e864d101:1 cb3f91d5:1",
      "references/extended-workflow.md\t## Table of Contents\t26\t81031d43:1 d93d9db6:1 3ef4b814:1 47f69970:1 a3e88b84:1 0cfec429:1 04652fd5:1 a335068a:1 7ec7ae1a:1 6db35dda:1 41b6694f:1 ade9dd48:1 7f91eab1:1 ba6ff726:1 21295fb0:1 de503533:1 ecb3ceef:1 7e30cf73:1 8229260f:1 25cd6bbc:1 1521de42:1 8a21a99a:1 9ef51fcc:1 88ae657b:1 37b49457:1 cb3f91d5:1",
      "references/extended-workflow.md\t## 4. Lifecycle Gate (kiwi-pipeline-v1 §4.2)\t1\tf50dcdb0:1",
      "references/extended-workflow.md\t### 4.1 차단 분류\t7\t6f693ca6:1 23cca02b:1 a185d3ea:1 2fea631a:1 b80639d0:1 4e6bb72e:1 284873df:1",
      "references/extended-workflow.md\t### 4.4 MCP 미가용\t4\t0494229e:1 1275d69d:1 98392480:1 9c63f939:1",
      "references/extended-workflow.md\t### 4.5 의사코드\t68\tf1b90184:1 7663e118:1 45b171eb:1 d8bcd7b0:1 c3172d0b:1 dd587fee:1 1ca6a8b8:1 b86bf6a4:1 b94508f0:1 37209f38:1 c049bebc:1 02b7c82c:1 b282f4ed:1 81dbf376:1 394ae9cd:1 cd1f1f32:1 b9329af8:1 babe06f7:1 f323b53c:1 394ae9cd:1 d2acf45c:1 b9329af8:1 babe06f7:1 e1a3eaac:1 45ea3849:1 0dd7b0a2:1 75247e17:1 b6489057:1 463d499a:1 3db32804:1 bf8f8fcc:1 724bb1ff:1 097d5704:1 5eb9d76d:1 11e5569a:1 388591a7:1 bbe2e005:1 d10b36aa:1 5b009f13:1 8efcb51e:1 011ab388:1 92c91e98:1 9de35576:1 b5713fd2:1 5b009f13:1 838478fa:1 c3172d0b:1 961b297f:1 13f70c60:1 06401138:1 cfebdfbf:1 c7452b58:1 cde998c3:1 b5713fd2:1 5b009f13:1 757309cc:1 f323b53c:1 59be6532:1 7b9bc909:1 15923329:1 12dcb914:1 cb62b811:1 2fbbe8b2:1 5b009f13:1 f1b90184:1 a7aec2b9:1 04395454:1 cb3f91d5:1",
      "references/extended-workflow.md\t### 5.4 `--resume` 동작\t13\t79e93128:1 419c6489:1 38fbe38d:1 d64a5f9b:1 145fde51:1 ed2c9513:1 7ac726c1:1 c24513af:1 c366f4dc:1 f64b53d8:1 3a77daf3:1 e1e6b76b:1 a5ffe824:1",
      "references/extended-workflow.md\t### 6.2 T-final SRS Status 마무리\t95\tbba5ecb8:1 cb1cbc27:1 369be77b:1 bb9ab4df:1 f1b90184:1 52d73ce6:1 f813fff0:1 81dbf376:1 b90c44c4:1 f323b53c:1 d2acf45c:1 904d812f:1 a66c3c7a:1 a3bb586d:1 865da60d:1 8345bd5e:1 ee9c6a97:1 ca9c9562:1 4373adb6:1 2450ae94:1 c35c47b3:1 63496bba:1 64d9e501:1 dc45ddf1:1 176f8c70:1 f972fe70:1 31aab716:1 d10b36aa:1 f2fea05e:1 eb98e45b:1 6695869a:1 10e83ec4:1 b8f35f7b:1 154a9d57:1 8647ee76:1 f8b63aa3:1 89e9ca78:1 ba5ec51d:1 ac3e49a9:1 cfe08573:1 a97d23f6:1 c3172d0b:1 ab1d12ad:1 3b44898a:1 fb918a78:1 334359b9:1 e3e68604:1 f49766f7:1 ccc7c649:1 79d938b2:1 9ef480ce:1 17f60690:1 aa9a6bd5:1 f0528cd6:1 d21df8be:1 394ae9cd:1 284c6232:1 ebd2589c:1 f323b53c:1 aef1f971:1 60a91c4e:1 17be6445:1 834f30b4:1 2c58b0f2:1 78866c05:1 5dcb8680:1 98f4d591:1 188b390d:1 4205e179:1 ba5ec51d:1 170e52b1:1 6327beb3:1 ba89141a:1 6794f608:1 48b0fc37:1 873b6ba9:1 d345717a:1 ba5ec51d:1 60a91c4e:1 493fba3b:1 f58a5318:1 2c58b0f2:1 1513ffa7:1 9bb5c2d7:1 4583e302:1 62499381:1 5b009f13:1 f1b90184:1 f23904a0:1 f97c1e7a:1 4da1ec6f:1 d401586f:1 c0dd8c24:1 578aea0a:1 0513e2fd:1",
      "references/extended-workflow.md\t### 6.4 kiwi-review-fix-loop hand-off\t14\t6d4c80f7:1 f1b90184:1 3ff2b9fb:1 f1b90184:1 216e5fc0:1 63a88c1c:1 33a7fcaf:1 14a507a1:1 c4520987:1 07cc28eb:1 1c67e2b2:1 cbd4d0c4:1 478d6c48:1 378a137b:1",
      "references/extended-workflow.md\t#### 6.4.1 `--sds` 실행의 hand-off (FR-FLOW-183)\t9\t458550e3:1 f1b90184:1 4aca28d1:1 f1278a54:1 be7491a3:1 4aca28d1:1 f1b90184:1 97c0933d:1 cb3f91d5:1",
      "references/extended-workflow.md\t### 7.1 입력 무결성 게이트 (T-1)\t12\t680f383f:1 4199ba45:1 ad7c5a8d:1 dafeb7d1:1 25fc947b:1 b288bda8:1 8f907b48:1 f1dca28c:1 e76bc3c1:1 d9f57ec9:1 9059b750:1 a27a1418:1",
      "references/extended-workflow.md\t## 8. 호출 예시\t15\tad332335:1 1fa1bf69:1 1bc5b697:1 eda75814:1 042f8a37:1 d0e685b6:1 a8623c54:1 7c14f5b3:1 e2d48ad6:1 94d086d9:1 4c3c5b83:1 9fa3393d:1 89beb565:1 f1b90184:1 cb3f91d5:1",
      "references/extended-workflow.md\t## 9. 설계 요약\t7\t3a8fd2de:1 91cc172f:1 38b69fc6:1 d85141fc:1 799db331:1 90cecd2a:1 052ead20:1",
      "references/extended-workflow.md\t### MCP 호출 분담 표 (speckiwi 실제 schema)\t14\t481f5962:1 4da1ec6f:1 01c46fb7:1 d2354436:1 48868688:1 02ef48b8:1 f71fe53a:1 ebe584e6:1 70999ede:1 5a8f92c2:1 c8b46f50:1 bd917e01:1 c2a0c3cb:1 cb3f91d5:1"
    ],
    ".agents/skills": [
      "SKILL.md\t(top)\t2\tda0bb095:1 0b7beaa4:1",
      "SKILL.md\t## Official Workflow Tool Policy\t8\t56dd546e:1 b27d11cb:1 e31eeaec:1 bb86273e:1 6ee48ca6:1 0b3c8e90:1 befb240b:1 cb3f91d5:1",
      "SKILL.md\t## 핵심 규칙 — 컴팩션 뒤에도 남는 실행 규칙 (FR-FLOW-223)\t3\t63451555:1 69b1661e:1 cb3f91d5:1",
      "SKILL.md\t## 0. 공통 규약 (SSOT)\t20\t3cd39375:1 4199ba45:1 40f7dcfe:1 62e7b719:1 25826395:1 89aa7b3e:1 f7bf6e70:1 1330dbf8:1 4783f3b6:1 d88d1702:1 b677cae3:1 2691ea84:1 22d3dbf9:1 d8f66d4f:1 30dcc1c8:1 4a150061:1 1f7c6729:1 4e14f40a:1 b68dfcd6:1 1296a589:1",
      "SKILL.md\t#### §0.G1 — 입력 무결성\t11\t657898dc:1 41399f0d:1 4199ba45:1 da39e2f1:1 1b66a4f8:1 05f7e7b6:1 93d5dd17:1 86d34597:1 32205632:1 d9aab87d:1 6fab408c:1",
      "SKILL.md\t### 1.1 필수 입력\t4\t0c96df4b:1 b7be39ca:1 e715c3d5:1 ba3e7763:1",
      "SKILL.md\t### 1.2 선택 입력 + 자연어 매핑\t24\t6460e4f5:1 23cca02b:1 6d3dd213:1 f44289e1:1 9501812a:1 bf15fdb1:1 1af78acd:1 3d10f4bb:1 8694050f:1 53bb0005:1 8cff72d0:1 6f485945:1 22df5d45:1 a7de704f:1 c8c521ba:1 05ce11b8:1 a135f60c:1 16c681b6:1 942017fb:1 4bd580a7:1 3808a5bb:1 4bd86e10:1 408f323a:1 f1066a26:1",
      "SKILL.md\t### 1.3 CLI 인자 요약\t24\tf1b90184:1 ec49dbc8:1 165a339b:1 c3e24366:1 15dc63dd:1 4c10be3a:1 1ee10aa0:1 0c54dcd7:1 08f70a28:1 9cb00540:1 ba4886d1:1 2c0eb37b:1 9227871d:1 a1df9fd9:1 727d1d37:1 337efdf1:1 f4f07d06:1 5f396501:1 0da87072:1 24c243f8:1 f1a068dd:1 644594c6:1 f1b90184:1 47af0045:1",
      "SKILL.md\t### 2.1 디렉토리 SSOT\t10\t2665e098:1 f1b90184:1 b2c313cc:1 5daa0874:1 72ecd566:1 e943679f:1 f2f3cfcf:1 93fd123f:1 f1b90184:1 a322de30:1",
      "SKILL.md\t### 2.2 pm-state.json 스키마\t61\ta56726cd:1 021fb596:1 5e1df321:1 a6401169:1 cf999688:1 782dee37:1 039f4196:1 0f8aa7ea:1 56555ea8:1 f051c952:1 6edb669c:1 c0c97be4:1 381661be:1 41a17a02:1 c40b10a0:1 e9b14849:1 03a7ec42:1 00725b8f:1 d607abd6:1 dabf2967:1 89a8d5fa:1 de62e534:1 6c480085:1 3df4708d:1 e52a1813:1 e0f18bb1:1 1d41ad4c:1 50b7638e:1 74cab6a3:1 cc5e69f6:1 31211cda:1 e98425ed:1 52ff8615:1 e52a1813:1 09c9b4ed:1 2a241a87:1 5e2e2e20:1 d10b36aa:1 e52a1813:1 0ced1e3a:1 d6d32596:1 6878f75e:1 3ae387e6:1 34a1e910:1 d10b36aa:1 f1b90184:1 b9933a98:1 9c9abd03:1 3a3d488b:1 a7ac7968:1 42f86bcc:1 7ac81781:1 fa64283a:1 271cb387:1 d7b2993f:1 457a0f1f:1 49536efe:1 32620e3b:1 73ae175f:1 e376678c:1 e7363a75:1",
      "SKILL.md\t### 3.1 실행 의사코드\t66\tf1b90184:1 9001197a:1 bcfc5f77:1 259a8a3f:1 e1ef9597:1 f323b53c:1 61ce65fb:1 4c8d3e14:1 4567438f:1 7eb16d75:1 93f122fc:1 623c0244:1 f323b53c:1 7ef16ea8:1 883daaca:1 9a86703d:1 d3fa6650:1 f602e3da:1 5d6015f1:1 da651d16:1 5b009f13:1 dfe32373:1 b8abfa25:1 59d347a4:1 8243025d:1 f13936ce:1 08552cee:1 05b77223:1 52cc528a:1 1f9c3c87:1 6906e1f1:1 18b285a9:1 d5f44025:1 c0ad4cfc:1 521977cf:1 3587e83a:1 13a4c6d0:1 b4534ebc:1 a5ad98c0:1 3abdbc4c:1 1ebaccd3:1 11cf1bb1:1 dfff1e39:1 89649012:1 b2871417:1 3d06c96d:1 c1a94cfc:1 2cdf4891:1 9dc81840:1 3112333a:1 313efe90:1 5b009f13:1 6c123afd:1 ad55851b:1 3eed94b1:1 f0e38742:1 3c7ef9e3:1 b970532f:1 9436ffd9:1 dcf673c9:1 3d88d4be:1 8f5afa7a:1 30c28bb1:1 c890f506:1 4a6d9a1a:1 f1b90184:1",
      "SKILL.md\t### 3.2 서브에이전트 자식 실행 프롬프트\t70\t9353246d:1 f1b90184:1 e1e23bd4:1 d9c74041:1 a7d181b7:1 116b5e0f:1 6bd79203:1 156e7beb:1 8eeffcd3:1 eac55062:1 e8b586fd:1 2f85eaf6:1 a8ee85a7:1 16619b38:1 08aeee64:1 d22ee250:1 2e07bb66:1 e9bda2f2:1 091a8af5:1 f1b90184:1 6b2de1c7:1 f1b90184:1 7f8cda0e:1 7abc310b:1 d674eaca:1 0111fe88:1 c798ab43:1 95e46748:1 e0d29a6e:1 6e5e7b22:1 d16b2b8b:1 eb1225f4:1 6ad76f56:1 aa3b6d42:1 c2a16db7:1 08a2b1b6:1 e618d6f7:1 a9ba2592:1 a70b1163:1 9d0e8aa2:1 fea6b101:1 00dbf6a8:1 b04da399:1 37225a75:1 0bc83e10:1 9d0e8aa2:1 b7dec176:1 df2650ed:1 fd4f347f:1 6ed2d708:1 f6f65e7b:1 c9071b35:1 519512e1:1 a3c9f9cc:1 e3f39742:1 a9b57585:1 97a44e86:1 bfc557fd:1 39d4b54e:1 7c971303:1 2f86e39b:1 39d4b54e:1 d17e0a41:1 4fa54ef7:1 7b3ef6a4:1 526eb357:1 f796e345:1 2f86e39b:1 2f86e39b:1 f1b90184:1",
      "SKILL.md\t### 3.6 Lifecycle gate 차단의 `--auto` 동작\t9\t455cbc37:1 a851faa1:1 439d3721:1 f89751f3:1 016198d7:1 e3c17a36:1 ee2a12e5:1 f02bf049:1 cb3f91d5:1",
      "references/extended-workflow.md\t## Table of Contents\t26\t81031d43:1 d93d9db6:1 3ef4b814:1 47f69970:1 42ebd5b1:1 0cfec429:1 dd3c9b9a:1 8b9ecfa5:1 7ec7ae1a:1 6db35dda:1 41b6694f:1 ade9dd48:1 7f91eab1:1 ba6ff726:1 21295fb0:1 de503533:1 ecb3ceef:1 7e30cf73:1 8229260f:1 25cd6bbc:1 1521de42:1 8a21a99a:1 9ef51fcc:1 88ae657b:1 37b49457:1 cb3f91d5:1",
      "references/extended-workflow.md\t## 4. Lifecycle Gate (kiwi-pipeline-v1 §4.2)\t1\tf50dcdb0:1",
      "references/extended-workflow.md\t### 4.1 차단 분류\t7\t6f693ca6:1 23cca02b:1 a185d3ea:1 2fea631a:1 b80639d0:1 4e6bb72e:1 284873df:1",
      "references/extended-workflow.md\t### 4.4 MCP 미가용 처리\t3\t0494229e:1 772d0f20:1 c3da7d07:1",
      "references/extended-workflow.md\t### 4.5 의사코드\t70\tf1b90184:1 7663e118:1 45b171eb:1 d8bcd7b0:1 c3172d0b:1 dd587fee:1 1ca6a8b8:1 7f87730e:1 04fb9a8d:1 b86bf6a4:1 b94508f0:1 37209f38:1 c049bebc:1 006cae08:1 b282f4ed:1 81dbf376:1 394ae9cd:1 cd1f1f32:1 b9329af8:1 04fb9a8d:1 f323b53c:1 394ae9cd:1 d2acf45c:1 b9329af8:1 04fb9a8d:1 e1a3eaac:1 45ea3849:1 0dd7b0a2:1 75247e17:1 b6489057:1 463d499a:1 3db32804:1 bf8f8fcc:1 724bb1ff:1 097d5704:1 5eb9d76d:1 11e5569a:1 388591a7:1 bbe2e005:1 d10b36aa:1 5b009f13:1 8efcb51e:1 011ab388:1 92c91e98:1 9de35576:1 b5713fd2:1 5b009f13:1 838478fa:1 c3172d0b:1 961b297f:1 13f70c60:1 06401138:1 cfebdfbf:1 c7452b58:1 cde998c3:1 b5713fd2:1 5b009f13:1 757309cc:1 f323b53c:1 2a4ec5ad:1 7b9bc909:1 15923329:1 12dcb914:1 cb62b811:1 2fbbe8b2:1 5b009f13:1 f1b90184:1 a7aec2b9:1 04395454:1 cb3f91d5:1",
      "references/extended-workflow.md\t### 5.4 `--resume` 동작\t13\t79e93128:1 419c6489:1 38fbe38d:1 d64a5f9b:1 145fde51:1 ed2c9513:1 7ac726c1:1 c24513af:1 c366f4dc:1 f64b53d8:1 3a77daf3:1 e1e6b76b:1 a5ffe824:1",
      "references/extended-workflow.md\t### 6.2 T-final SRS Status 마무리\t95\tbba5ecb8:1 cb1cbc27:1 369be77b:1 bb9ab4df:1 f1b90184:1 52d73ce6:1 f813fff0:1 81dbf376:1 b90c44c4:1 f323b53c:1 d2acf45c:1 904d812f:1 a66c3c7a:1 a3bb586d:1 865da60d:1 8345bd5e:1 ee9c6a97:1 ca9c9562:1 4373adb6:1 2450ae94:1 c35c47b3:1 63496bba:1 64d9e501:1 dc45ddf1:1 176f8c70:1 f972fe70:1 31aab716:1 d10b36aa:1 f2fea05e:1 eb98e45b:1 6695869a:1 10e83ec4:1 b8f35f7b:1 ec3225c8:1 8647ee76:1 f8b63aa3:1 89e9ca78:1 ba5ec51d:1 ac3e49a9:1 cfe08573:1 a97d23f6:1 c3172d0b:1 ab1d12ad:1 810a10ac:1 fb918a78:1 334359b9:1 e3e68604:1 f49766f7:1 ccc7c649:1 79d938b2:1 9ef480ce:1 17f60690:1 aa9a6bd5:1 f0528cd6:1 d21df8be:1 394ae9cd:1 284c6232:1 ebd2589c:1 f323b53c:1 aef1f971:1 60a91c4e:1 17be6445:1 834f30b4:1 2c58b0f2:1 78866c05:1 5dcb8680:1 98f4d591:1 188b390d:1 4205e179:1 ba5ec51d:1 170e52b1:1 6327beb3:1 ba89141a:1 6794f608:1 48b0fc37:1 873b6ba9:1 d345717a:1 ba5ec51d:1 60a91c4e:1 493fba3b:1 f58a5318:1 2c58b0f2:1 1513ffa7:1 9bb5c2d7:1 4583e302:1 62499381:1 5b009f13:1 f1b90184:1 f23904a0:1 f97c1e7a:1 4da1ec6f:1 d401586f:1 c0dd8c24:1 578aea0a:1 0513e2fd:1",
      "references/extended-workflow.md\t### 6.4 kiwi-review-fix-loop hand-off\t14\t6d4c80f7:1 f1b90184:1 3ff2b9fb:1 f1b90184:1 216e5fc0:1 63a88c1c:1 33a7fcaf:1 14a507a1:1 c4520987:1 07cc28eb:1 1c67e2b2:1 cbd4d0c4:1 478d6c48:1 378a137b:1",
      "references/extended-workflow.md\t#### 6.4.1 `--sds` 실행의 hand-off (FR-FLOW-183)\t9\t458550e3:1 f1b90184:1 4aca28d1:1 f1278a54:1 be7491a3:1 4aca28d1:1 f1b90184:1 97c0933d:1 cb3f91d5:1",
      "references/extended-workflow.md\t### 7.1 입력 무결성 게이트 (T-1)\t12\t680f383f:1 4199ba45:1 ad7c5a8d:1 dafeb7d1:1 25fc947b:1 b288bda8:1 8f907b48:1 f1dca28c:1 e76bc3c1:1 d9f57ec9:1 9059b750:1 a27a1418:1",
      "references/extended-workflow.md\t## 8. 호출 예시\t15\tad332335:1 1fa1bf69:1 1bc5b697:1 eda75814:1 042f8a37:1 6c0ba719:1 aab86769:1 7c14f5b3:1 e2d48ad6:1 94d086d9:1 4c3c5b83:1 9fa3393d:1 89beb565:1 f1b90184:1 cb3f91d5:1",
      "references/extended-workflow.md\t## 9. 설계 요약\t7\t034f5ece:1 91cc172f:1 b87f3b07:1 dbdde9c9:1 799db331:1 90cecd2a:1 052ead20:1",
      "references/extended-workflow.md\t### MCP 호출 분담 표 (speckiwi 실제 schema)\t14\t481f5962:1 4da1ec6f:1 01c46fb7:1 d2354436:1 48868688:1 02ef48b8:1 f71fe53a:1 ebe584e6:1 70999ede:1 5a8f92c2:1 c8b46f50:1 bd917e01:1 c2a0c3cb:1 cb3f91d5:1"
    ]
  }
};
// </recorded-d1-rule-blocks>
