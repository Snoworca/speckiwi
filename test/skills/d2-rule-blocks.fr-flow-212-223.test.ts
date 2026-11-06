import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { REPO_ROOT } from "./kiwi-orchestrator-variants.js";
import { RENDERINGS } from "./kiwi-renderings.js";
import { UPDATE_RULE_BLOCKS, blocksOf, fileSections, sectionEntry, writeRecord } from "./rule-blocks.js";

// @req FR-FLOW-212 FR-FLOW-213 FR-FLOW-216 FR-FLOW-217 FR-FLOW-218 FR-FLOW-219 FR-FLOW-220 FR-FLOW-221 FR-FLOW-222
// FR-FLOW-223 — the rule sections of the D2 shared contracts and skills, frozen block by block.
//
// The per-rule suites hold their rule sentences as substrings, so an exception appended after a sentence
// ("— `--auto` 면 …"), a bracketed condition inside the same block, or a new block beside it passed them all
// (verify r5: 13 such mutations survived the whole of test/skills). This suite holds the sections instead,
// the way the d1 suite holds FR-FLOW-208..211: every block of every listed section is recorded at the end
// of this file per rendering, with its sha-256 prefix and line count (rule-blocks.ts). The semantic suites
// stay where they are and still say what the text must mean; this one says nothing was added beside it.
//
// Regenerate with UPDATE_D1_RULE_BLOCKS=1 (the one flag for every rule-block record) and read the diff: a
// changed entry names the section, and the position of the changed hash names the block.

interface Target {
  readonly id: string;
  /** Files under a rendering; codex and etc split some skills into references/extended-workflow.md. */
  readonly files: readonly string[];
  /** The headings of the rule sections. */
  readonly headings: RegExp;
}
const skillFiles = (skill: string): string[] => [`${skill}/SKILL.md`, `${skill}/references/extended-workflow.md`];
const TARGETS: readonly Target[] = [
  // FR-FLOW-220 · FR-FLOW-221: machine checks, verifiers, rounds, the end condition, oscillation, delegation, carry-over.
  { id: "verify-loop §2–§8", files: ["_shared/kiwi/verify-loop.md"], headings: /^## [2-8]\. / },
  // FR-FLOW-213 · FR-FLOW-216 · FR-FLOW-218 · FR-FLOW-222: PW-1..PW-17, the completion actions and the resume.
  { id: "parallel-waves PW-1–PW-17 · §5.1 · §6", files: ["_shared/kiwi/parallel-waves.md"], headings: /^## 5\. |^### 5\.1 |^## 6\. / },
  // FR-FLOW-212 · FR-FLOW-213 · FR-FLOW-217 · FR-FLOW-219: the decomposition, its PRD items, coverage and redecomposition.
  { id: "wave-decomposition §1–§7", files: ["_shared/kiwi/wave-decomposition.md"], headings: /^## [1-7]\. / },
  // FR-FLOW-212 · FR-FLOW-218: the one initial authoring and the per-stage incremental authoring.
  { id: "wave-srs-registration", files: ["_shared/kiwi/wave-srs-registration.md"], headings: /^#{1,2} / },
  // FR-FLOW-216 AC-3 · FR-FLOW-218 AC-4 (FR-FLOW-122): lane-branch preparation.
  { id: "worktree-lane §2", files: ["_shared/kiwi/worktree-lane.md"], headings: /^## 2\. / },
  // FR-FLOW-221: the TDD phase and the implementation loop's kept-finding rounds.
  { id: "kiwi-coder §4 · §5.1", files: skillFiles("kiwi-coder"), headings: /^## 4\. |^### 4\.\d |^### 5\.1 / },
  // FR-FLOW-223 core rules, FR-FLOW-217 (§0.5 in §0), FR-FLOW-214 (§8), the worktree procedure (§11).
  { id: "kiwi-wave-master core rules · §0 · §8 · §11", files: skillFiles("kiwi-wave-master"), headings: /^## 핵심 규칙|^## 0\. |^## 8\. |^## 11 / },
  { id: "kiwi-orchestrator core rules", files: skillFiles("kiwi-orchestrator"), headings: /^## 핵심 규칙/ },
  { id: "kiwi-pm core rules", files: skillFiles("kiwi-pm"), headings: /^## 핵심 규칙/ },
];

/** The renderings that ship the target (kiwi-wave-master has no .agents mirror). */
const shipping = (target: Target): string[] => RENDERINGS.filter((root) => existsSync(path.join(REPO_ROOT, root, target.files[0]!)));

/** Every rule section of `target` in one rendering, one `sectionEntry` each. */
function ruleBlocks(root: string, target: Target): string[] {
  return target.files.flatMap((file) =>
    fileSections(`${root}/${file}`)
      .filter((section) => target.headings.test(section.heading))
      .map((section) => sectionEntry(file, section.heading, blocksOf(section.body)))
  );
}

const SELF = fileURLToPath(import.meta.url);
const RECORD_START = "// <recorded-d2-rule-blocks>";
const RECORD_END = "// </recorded-d2-rule-blocks>";
if (UPDATE_RULE_BLOCKS) {
  const record = Object.fromEntries(TARGETS.map((target) => [target.id, Object.fromEntries(shipping(target).map((root) => [root, ruleBlocks(root, target)]))]));
  writeRecord(SELF, RECORD_START, RECORD_END, `const RECORDED_RULE_BLOCKS: Record<string, Record<string, string[]>> = ${JSON.stringify(record, null, 2)};`);
}

describe("FR-FLOW-212..223 — every block of every D2 rule section is exactly as recorded", () => {
  for (const target of TARGETS) {
    it(`${target.id}: ships in every rendering but the excluded mirror`, () => {
      expect(shipping(target).length, target.id).toBeGreaterThanOrEqual(3);
    });
    for (const root of shipping(target)) {
      // @req FR-FLOW-212 FR-FLOW-213 FR-FLOW-216 FR-FLOW-217 FR-FLOW-218 FR-FLOW-219 FR-FLOW-220 FR-FLOW-221 FR-FLOW-222 FR-FLOW-223
      it(`${target.id}: ${root} carries exactly the recorded blocks`, () => {
        const recorded = RECORDED_RULE_BLOCKS[target.id]?.[root];
        expect(recorded, `the record has no ${target.id} entry for ${root}`).toBeDefined();
        const live = ruleBlocks(root, target);
        expect(live.length, `${root}: no rule section found`).toBeGreaterThan(0);
        // Order and multiplicity matter: a block moved out of place or repeated is a changed section.
        expect(live, `${root}: rule-section blocks differ from the record — read the diff, then regenerate`).toEqual(recorded);
      });
    }
  }
});

// The recorded rule-section blocks of the D2 contracts. Generated; read the diff whenever it changes.
// <recorded-d2-rule-blocks>
const RECORDED_RULE_BLOCKS: Record<string, Record<string, string[]>> = {
  "verify-loop §2–§8": {
    "skills/claude": [
      "_shared/kiwi/verify-loop.md\t## 2. 기계 검사가 먼저다\t11\tb95cb790:1 97119924:1 23cca02b:1 511415f7:1 1f56c437:1 35de896a:1 73417659:1 b8518895:1 590ba2c9:1 96ce18aa:1 cb3f91d5:1",
      "_shared/kiwi/verify-loop.md\t## 3. 검증자 — 라운드마다 새로\t5\t9a420a64:1 5c591dab:1 b7e66567:1 34d25ab2:1 cb3f91d5:1",
      "_shared/kiwi/verify-loop.md\t## 4. 라운드 — red 테스트만 finding 으로 남는다\t4\ta59c0356:1 83c31e13:1 acf1b5bb:1 cb3f91d5:1",
      "_shared/kiwi/verify-loop.md\t## 5. 종료 조건 — kiwi-wave-master §5.5.4 에서 이동\t14\t5c2c7135:1 a6317fb0:1 4199ba45:1 e6521e79:1 1c407825:1 e0ab9cdd:1 9bcfc1f0:1 f5039b61:1 1324decf:1 747593ad:1 47707262:1 e8347e6b:1 7f9032f7:1 cb3f91d5:1",
      "_shared/kiwi/verify-loop.md\t## 6. 진동(oscillation) 감지\t3\ta4912c68:1 d529dd7d:1 cb3f91d5:1",
      "_shared/kiwi/verify-loop.md\t## 7. 개선 위임 (수정 주체) — kiwi-wave-master §5.5.5 에서 이동\t16\tf8bbf6ec:1 316d63f5:1 4199ba45:1 4761714a:1 24bf9a6a:1 1a8f0bb6:1 4a13e2ab:1 b72adcae:1 8732047a:1 94dd46b8:1 1cbb27b4:1 bc6fadff:1 1b8e8d2a:1 1ab196ca:1 9c56e5e9:1 cb3f91d5:1",
      "_shared/kiwi/verify-loop.md\t## 8. 교차 wave 이월 — kiwi-wave-master §5.5.7 에서 이동\t6\t3fc61461:1 19b7625c:1 27ff7a10:1 05a4e6d4:1 096e8a3d:1 cb3f91d5:1"
    ],
    "skills/codex": [
      "_shared/kiwi/verify-loop.md\t## 2. 기계 검사가 먼저다\t11\tb95cb790:1 97119924:1 23cca02b:1 511415f7:1 1f56c437:1 35de896a:1 73417659:1 b8518895:1 590ba2c9:1 96ce18aa:1 cb3f91d5:1",
      "_shared/kiwi/verify-loop.md\t## 3. 검증자 — 라운드마다 새로\t5\t9a420a64:1 5c591dab:1 b7e66567:1 34d25ab2:1 cb3f91d5:1",
      "_shared/kiwi/verify-loop.md\t## 4. 라운드 — red 테스트만 finding 으로 남는다\t4\ta59c0356:1 83c31e13:1 acf1b5bb:1 cb3f91d5:1",
      "_shared/kiwi/verify-loop.md\t## 5. 종료 조건 — kiwi-wave-master §5.5.4 에서 이동\t14\t5c2c7135:1 a6317fb0:1 4199ba45:1 e6521e79:1 1c407825:1 e0ab9cdd:1 9bcfc1f0:1 7e87d64a:1 1324decf:1 747593ad:1 47707262:1 e8347e6b:1 7f9032f7:1 cb3f91d5:1",
      "_shared/kiwi/verify-loop.md\t## 6. 진동(oscillation) 감지\t3\ta4912c68:1 d529dd7d:1 cb3f91d5:1",
      "_shared/kiwi/verify-loop.md\t## 7. 개선 위임 (수정 주체) — kiwi-wave-master §5.5.5 에서 이동\t16\tf8bbf6ec:1 316d63f5:1 4199ba45:1 4761714a:1 24bf9a6a:1 1a8f0bb6:1 4a13e2ab:1 b72adcae:1 1b2fd315:1 94dd46b8:1 1cbb27b4:1 bc6fadff:1 1b8e8d2a:1 1ab196ca:1 9c56e5e9:1 cb3f91d5:1",
      "_shared/kiwi/verify-loop.md\t## 8. 교차 wave 이월 — kiwi-wave-master §5.5.7 에서 이동\t6\t3fc61461:1 19b7625c:1 27ff7a10:1 05a4e6d4:1 096e8a3d:1 cb3f91d5:1"
    ],
    "skills/etc": [
      "_shared/kiwi/verify-loop.md\t## 2. 기계 검사가 먼저다\t11\tb95cb790:1 97119924:1 23cca02b:1 511415f7:1 1f56c437:1 35de896a:1 73417659:1 b8518895:1 590ba2c9:1 96ce18aa:1 cb3f91d5:1",
      "_shared/kiwi/verify-loop.md\t## 3. 검증자 — 라운드마다 새로\t5\tc3dd28c0:1 5c591dab:1 b7e66567:1 34d25ab2:1 cb3f91d5:1",
      "_shared/kiwi/verify-loop.md\t## 4. 라운드 — red 테스트만 finding 으로 남는다\t4\ta59c0356:1 83c31e13:1 acf1b5bb:1 cb3f91d5:1",
      "_shared/kiwi/verify-loop.md\t## 5. 종료 조건 — kiwi-wave-master §5.5.4 에서 이동\t14\t5c2c7135:1 a6317fb0:1 4199ba45:1 6f258fff:1 ed0fde8a:1 ff86abd1:1 9bcfc1f0:1 10325de8:1 1324decf:1 747593ad:1 47707262:1 c9e99fee:1 7f9032f7:1 cb3f91d5:1",
      "_shared/kiwi/verify-loop.md\t## 6. 진동(oscillation) 감지\t3\ta4912c68:1 d529dd7d:1 cb3f91d5:1",
      "_shared/kiwi/verify-loop.md\t## 7. 개선 위임 (수정 주체) — kiwi-wave-master §5.5.5 에서 이동\t16\tf8bbf6ec:1 316d63f5:1 4199ba45:1 4761714a:1 24bf9a6a:1 1a8f0bb6:1 4a13e2ab:1 b72adcae:1 1b2fd315:1 94dd46b8:1 1cbb27b4:1 bc6fadff:1 1b8e8d2a:1 1ab196ca:1 9c56e5e9:1 cb3f91d5:1",
      "_shared/kiwi/verify-loop.md\t## 8. 교차 wave 이월 — kiwi-wave-master §5.5.7 에서 이동\t6\t3fc61461:1 19b7625c:1 27ff7a10:1 05a4e6d4:1 096e8a3d:1 cb3f91d5:1"
    ],
    ".agents/skills": [
      "_shared/kiwi/verify-loop.md\t## 2. 기계 검사가 먼저다\t11\tb95cb790:1 97119924:1 23cca02b:1 511415f7:1 1f56c437:1 35de896a:1 73417659:1 b8518895:1 590ba2c9:1 96ce18aa:1 cb3f91d5:1",
      "_shared/kiwi/verify-loop.md\t## 3. 검증자 — 라운드마다 새로\t5\t9a420a64:1 5c591dab:1 b7e66567:1 34d25ab2:1 cb3f91d5:1",
      "_shared/kiwi/verify-loop.md\t## 4. 라운드 — red 테스트만 finding 으로 남는다\t4\ta59c0356:1 83c31e13:1 acf1b5bb:1 cb3f91d5:1",
      "_shared/kiwi/verify-loop.md\t## 5. 종료 조건 — kiwi-wave-master §5.5.4 에서 이동\t14\t5c2c7135:1 a6317fb0:1 4199ba45:1 e6521e79:1 1c407825:1 e0ab9cdd:1 9bcfc1f0:1 7e87d64a:1 1324decf:1 747593ad:1 47707262:1 e8347e6b:1 7f9032f7:1 cb3f91d5:1",
      "_shared/kiwi/verify-loop.md\t## 6. 진동(oscillation) 감지\t3\ta4912c68:1 d529dd7d:1 cb3f91d5:1",
      "_shared/kiwi/verify-loop.md\t## 7. 개선 위임 (수정 주체) — kiwi-wave-master §5.5.5 에서 이동\t16\tf8bbf6ec:1 316d63f5:1 4199ba45:1 4761714a:1 24bf9a6a:1 1a8f0bb6:1 4a13e2ab:1 b72adcae:1 1b2fd315:1 94dd46b8:1 1cbb27b4:1 bc6fadff:1 1b8e8d2a:1 1ab196ca:1 9c56e5e9:1 cb3f91d5:1",
      "_shared/kiwi/verify-loop.md\t## 8. 교차 wave 이월 — kiwi-wave-master §5.5.7 에서 이동\t6\t3fc61461:1 19b7625c:1 27ff7a10:1 05a4e6d4:1 096e8a3d:1 cb3f91d5:1"
    ]
  },
  "parallel-waves PW-1–PW-17 · §5.1 · §6": {
    "skills/claude": [
      "_shared/kiwi/parallel-waves.md\t## 5. stage 한 번의 순서\t62\t8675588a:1 033400c6:1 f1b90184:1 d88fb04c:1 0333e3c0:1 f1b90184:1 b86dafb1:1 d152111c:1 03c47672:1 00416823:1 26afced6:1 45153ab0:1 feeca658:1 d1691b93:1 ce4dd16f:1 f89b306f:1 f1b90184:1 806859f1:1 05ad41fe:1 f1b90184:1 a4f3b710:1 14f9bd8b:1 c82efb09:1 f1b90184:1 4f95bcbf:1 11787def:1 f1b90184:1 1ea124b3:1 f1573fcf:1 9acc88bb:1 45af41f1:1 226f7247:1 888f1ed6:1 f1b90184:1 94403b50:1 f18b7a11:1 c6a175d8:1 40aa29cb:1 07834a6a:1 bbf000d5:1 ca77962c:1 85c26369:1 7890f841:1 08d89f70:1 f1b90184:1 9492db10:1 3f16799f:1 2af4ed68:1 34d644c9:1 4336d188:1 f1b90184:1 475996c8:1 67ac2625:1 f1b90184:1 66f9540a:1 5a29cb76:1 99bd1f10:1 7d72a3b7:1 0f4041c4:1 9d1e910a:1 d7b54435:1 c901d0a4:1",
      "_shared/kiwi/parallel-waves.md\t### 5.1 완료 행동 — 노드의 `complete` 뒤, 호스트만\t6\t4d656802:1 f574a434:1 5e471838:1 54ba0f9d:1 2e31fe7f:1 cb3f91d5:1",
      "_shared/kiwi/parallel-waves.md\t## 6. 재개\t5\t33e781be:1 e871a11e:1 f5e0b35a:1 110eb556:1 f28fdefa:1"
    ],
    "skills/codex": [
      "_shared/kiwi/parallel-waves.md\t## 5. The order of one stage\t62\tc56b6365:1 a4067cb0:1 f1b90184:1 a82cabc2:1 710aa74f:1 f1b90184:1 cc004d61:1 19e72f83:1 bee44a24:1 b3d69172:1 422360c1:1 36691000:1 885408c8:1 d1691b93:1 1c5b1fd2:1 592bdbcb:1 f1b90184:1 35f6b0fe:1 4bc65e76:1 f1b90184:1 d192ddda:1 475ce599:1 45b882d0:1 f1b90184:1 85223555:1 11787def:1 f1b90184:1 ea1687b3:1 feb29f48:1 56e90e66:1 0fc3dbe5:1 b98b8ac9:1 28a21f1d:1 f1b90184:1 c1180d93:1 69423d7c:1 ff289189:1 d2489833:1 8a7b492b:1 d6f4aff8:1 fa8c69e0:1 b358c4a2:1 50760c9d:1 4200df1b:1 f1b90184:1 8f7020ec:1 f9b09ef4:1 6f88d89f:1 b0affde5:1 239bf83e:1 f1b90184:1 a595a209:1 67ac2625:1 f1b90184:1 aa534b07:1 a0aa41fb:1 86e2bc0f:1 86d15411:1 d9c91562:1 0dab3c8a:1 ed155ef0:1 5876fff1:1",
      "_shared/kiwi/parallel-waves.md\t### 5.1 Completion actions — after a node's `complete`, host only\t6\tcf87ff5c:1 1aead9e2:1 939881da:1 417e8fec:1 12e3746f:1 cb3f91d5:1",
      "_shared/kiwi/parallel-waves.md\t## 6. Resume\t5\t9b8b77f6:1 0a08322d:1 4cb75060:1 cbed460f:1 425bc951:1"
    ],
    "skills/etc": [
      "_shared/kiwi/parallel-waves.md\t## 5. The order of one stage\t62\tc56b6365:1 a4067cb0:1 f1b90184:1 a82cabc2:1 710aa74f:1 f1b90184:1 cc004d61:1 19e72f83:1 bee44a24:1 b3d69172:1 422360c1:1 36691000:1 885408c8:1 d1691b93:1 1c5b1fd2:1 592bdbcb:1 f1b90184:1 35f6b0fe:1 4bc65e76:1 f1b90184:1 d192ddda:1 475ce599:1 45b882d0:1 f1b90184:1 85223555:1 11787def:1 f1b90184:1 ea1687b3:1 feb29f48:1 56e90e66:1 0fc3dbe5:1 b98b8ac9:1 28a21f1d:1 f1b90184:1 c1180d93:1 69423d7c:1 ff289189:1 d2489833:1 8a7b492b:1 d6f4aff8:1 fa8c69e0:1 b358c4a2:1 50760c9d:1 4200df1b:1 f1b90184:1 8f7020ec:1 f9b09ef4:1 6f88d89f:1 b0affde5:1 239bf83e:1 f1b90184:1 a595a209:1 67ac2625:1 f1b90184:1 aa534b07:1 a0aa41fb:1 86e2bc0f:1 86d15411:1 d9c91562:1 0dab3c8a:1 ed155ef0:1 5876fff1:1",
      "_shared/kiwi/parallel-waves.md\t### 5.1 Completion actions — after a node's `complete`, host only\t6\tcf87ff5c:1 1aead9e2:1 939881da:1 417e8fec:1 12e3746f:1 cb3f91d5:1",
      "_shared/kiwi/parallel-waves.md\t## 6. Resume\t5\t9b8b77f6:1 0a08322d:1 4cb75060:1 cbed460f:1 425bc951:1"
    ],
    ".agents/skills": [
      "_shared/kiwi/parallel-waves.md\t## 5. The order of one stage\t62\tc56b6365:1 a4067cb0:1 f1b90184:1 a82cabc2:1 710aa74f:1 f1b90184:1 cc004d61:1 19e72f83:1 bee44a24:1 b3d69172:1 422360c1:1 36691000:1 885408c8:1 d1691b93:1 1c5b1fd2:1 592bdbcb:1 f1b90184:1 35f6b0fe:1 4bc65e76:1 f1b90184:1 d192ddda:1 475ce599:1 45b882d0:1 f1b90184:1 85223555:1 11787def:1 f1b90184:1 ea1687b3:1 feb29f48:1 56e90e66:1 0fc3dbe5:1 b98b8ac9:1 28a21f1d:1 f1b90184:1 c1180d93:1 69423d7c:1 ff289189:1 d2489833:1 8a7b492b:1 d6f4aff8:1 fa8c69e0:1 b358c4a2:1 50760c9d:1 4200df1b:1 f1b90184:1 8f7020ec:1 f9b09ef4:1 6f88d89f:1 b0affde5:1 239bf83e:1 f1b90184:1 a595a209:1 67ac2625:1 f1b90184:1 aa534b07:1 a0aa41fb:1 86e2bc0f:1 86d15411:1 d9c91562:1 0dab3c8a:1 ed155ef0:1 5876fff1:1",
      "_shared/kiwi/parallel-waves.md\t### 5.1 Completion actions — after a node's `complete`, host only\t6\tcf87ff5c:1 1aead9e2:1 939881da:1 417e8fec:1 12e3746f:1 cb3f91d5:1",
      "_shared/kiwi/parallel-waves.md\t## 6. Resume\t5\t9b8b77f6:1 0a08322d:1 4cb75060:1 cbed460f:1 425bc951:1"
    ]
  },
  "wave-decomposition §1–§7": {
    "skills/claude": [
      "_shared/kiwi/wave-decomposition.md\t## 1. 입력 — 호출자가 넘기는 것\t8\tbfc83737:1 4199ba45:1 3e546ede:1 7ac1e767:1 9fe915cb:1 6861e060:1 ecaceed7:1 e0cd050c:1",
      "_shared/kiwi/wave-decomposition.md\t## 2. 순서 — run 당 한 번\t8\t599a737f:1 e811fc45:1 b41fcde4:1 c6de7a14:1 c8e94e9a:1 35b4a419:1 733b7331:1 57935fc1:1",
      "_shared/kiwi/wave-decomposition.md\t## 3. 배정은 그래프의 `acs` 다\t1\t10cd731e:1",
      "_shared/kiwi/wave-decomposition.md\t## 4. 노드의 PRD 항목\t1\t979e531b:1",
      "_shared/kiwi/wave-decomposition.md\t## 5. PRD 커버리지 — `wave-decomposition-coverage-gap`\t1\taaed8894:1",
      "_shared/kiwi/wave-decomposition.md\t## 6. 재분해 — 아직 dispatch 하지 않은 노드만\t8\t6c203021:1 9a75905f:1 e305b2a8:1 ba76a06b:1 19fc95b3:1 26b8801f:1 1d71e47a:1 e80801c2:1",
      "_shared/kiwi/wave-decomposition.md\t## 7. 제외 분류\t1\t03f768a3:1"
    ],
    "skills/codex": [
      "_shared/kiwi/wave-decomposition.md\t## 1. 입력 — 호출자가 넘기는 것\t8\tbfc83737:1 4199ba45:1 3e546ede:1 7ac1e767:1 9fe915cb:1 6861e060:1 ecaceed7:1 e0cd050c:1",
      "_shared/kiwi/wave-decomposition.md\t## 2. 순서 — run 당 한 번\t8\t599a737f:1 e811fc45:1 b41fcde4:1 c6de7a14:1 c8e94e9a:1 35b4a419:1 733b7331:1 57935fc1:1",
      "_shared/kiwi/wave-decomposition.md\t## 3. 배정은 그래프의 `acs` 다\t1\t10cd731e:1",
      "_shared/kiwi/wave-decomposition.md\t## 4. 노드의 PRD 항목\t1\t979e531b:1",
      "_shared/kiwi/wave-decomposition.md\t## 5. PRD 커버리지 — `wave-decomposition-coverage-gap`\t1\taaed8894:1",
      "_shared/kiwi/wave-decomposition.md\t## 6. 재분해 — 아직 dispatch 하지 않은 노드만\t8\t6c203021:1 9a75905f:1 e305b2a8:1 ba76a06b:1 19fc95b3:1 26b8801f:1 1d71e47a:1 e80801c2:1",
      "_shared/kiwi/wave-decomposition.md\t## 7. 제외 분류\t1\t03f768a3:1"
    ],
    "skills/etc": [
      "_shared/kiwi/wave-decomposition.md\t## 1. 입력 — 호출자가 넘기는 것\t8\tbfc83737:1 4199ba45:1 3e546ede:1 7ac1e767:1 9fe915cb:1 6861e060:1 ecaceed7:1 e0cd050c:1",
      "_shared/kiwi/wave-decomposition.md\t## 2. 순서 — run 당 한 번\t8\t599a737f:1 e811fc45:1 b41fcde4:1 c6de7a14:1 c8e94e9a:1 35b4a419:1 733b7331:1 57935fc1:1",
      "_shared/kiwi/wave-decomposition.md\t## 3. 배정은 그래프의 `acs` 다\t1\t10cd731e:1",
      "_shared/kiwi/wave-decomposition.md\t## 4. 노드의 PRD 항목\t1\t979e531b:1",
      "_shared/kiwi/wave-decomposition.md\t## 5. PRD 커버리지 — `wave-decomposition-coverage-gap`\t1\taaed8894:1",
      "_shared/kiwi/wave-decomposition.md\t## 6. 재분해 — 아직 dispatch 하지 않은 노드만\t8\t6c203021:1 9a75905f:1 e305b2a8:1 ba76a06b:1 19fc95b3:1 26b8801f:1 1d71e47a:1 e80801c2:1",
      "_shared/kiwi/wave-decomposition.md\t## 7. 제외 분류\t1\t03f768a3:1"
    ],
    ".agents/skills": [
      "_shared/kiwi/wave-decomposition.md\t## 1. 입력 — 호출자가 넘기는 것\t8\tbfc83737:1 4199ba45:1 3e546ede:1 7ac1e767:1 9fe915cb:1 6861e060:1 ecaceed7:1 e0cd050c:1",
      "_shared/kiwi/wave-decomposition.md\t## 2. 순서 — run 당 한 번\t8\t599a737f:1 e811fc45:1 b41fcde4:1 c6de7a14:1 c8e94e9a:1 35b4a419:1 733b7331:1 57935fc1:1",
      "_shared/kiwi/wave-decomposition.md\t## 3. 배정은 그래프의 `acs` 다\t1\t10cd731e:1",
      "_shared/kiwi/wave-decomposition.md\t## 4. 노드의 PRD 항목\t1\t979e531b:1",
      "_shared/kiwi/wave-decomposition.md\t## 5. PRD 커버리지 — `wave-decomposition-coverage-gap`\t1\taaed8894:1",
      "_shared/kiwi/wave-decomposition.md\t## 6. 재분해 — 아직 dispatch 하지 않은 노드만\t8\t6c203021:1 9a75905f:1 e305b2a8:1 ba76a06b:1 19fc95b3:1 26b8801f:1 1d71e47a:1 e80801c2:1",
      "_shared/kiwi/wave-decomposition.md\t## 7. 제외 분류\t1\t03f768a3:1"
    ]
  },
  "wave-srs-registration": {
    "skills/claude": [
      "_shared/kiwi/wave-srs-registration.md\t# kiwi wave-srs-registration v1.0.0\t2\t86c95ba8:1 cb3f91d5:1",
      "_shared/kiwi/wave-srs-registration.md\t## 1. 처음 저작 — run 당 한 번, 분해 앞\t4\tf1b90184:1 5ea1c67e:1 f1b90184:1 591dfc7e:1",
      "_shared/kiwi/wave-srs-registration.md\t## 2. 증분 저작 — stage 당 한 번, PW-10 재생 뒤 · PW-13 검증 앞\t13\t2bda4ba7:1 f1b90184:1 c451c17a:1 f1b90184:1 8d704361:1 c7a53f2f:1 70d3cf2f:1 4199ba45:1 10bfd1d4:1 d111fd3d:1 78570f66:1 848f69fb:1 a72b2a69:1"
    ],
    "skills/codex": [
      "_shared/kiwi/wave-srs-registration.md\t# kiwi wave-srs-registration v1.0.0\t2\t86c95ba8:1 cb3f91d5:1",
      "_shared/kiwi/wave-srs-registration.md\t## 1. 처음 저작 — run 당 한 번, 분해 앞\t4\tf1b90184:1 5ea1c67e:1 f1b90184:1 591dfc7e:1",
      "_shared/kiwi/wave-srs-registration.md\t## 2. 증분 저작 — stage 당 한 번, PW-10 재생 뒤 · PW-13 검증 앞\t13\t2bda4ba7:1 f1b90184:1 c451c17a:1 f1b90184:1 8d704361:1 c7a53f2f:1 70d3cf2f:1 4199ba45:1 10bfd1d4:1 d111fd3d:1 78570f66:1 848f69fb:1 a72b2a69:1"
    ],
    "skills/etc": [
      "_shared/kiwi/wave-srs-registration.md\t# kiwi wave-srs-registration v1.0.0\t2\t86c95ba8:1 cb3f91d5:1",
      "_shared/kiwi/wave-srs-registration.md\t## 1. 처음 저작 — run 당 한 번, 분해 앞\t4\tf1b90184:1 5ea1c67e:1 f1b90184:1 591dfc7e:1",
      "_shared/kiwi/wave-srs-registration.md\t## 2. 증분 저작 — stage 당 한 번, PW-10 재생 뒤 · PW-13 검증 앞\t13\t2bda4ba7:1 f1b90184:1 c451c17a:1 f1b90184:1 8d704361:1 c7a53f2f:1 70d3cf2f:1 4199ba45:1 10bfd1d4:1 d111fd3d:1 78570f66:1 848f69fb:1 a72b2a69:1"
    ],
    ".agents/skills": [
      "_shared/kiwi/wave-srs-registration.md\t# kiwi wave-srs-registration v1.0.0\t2\t86c95ba8:1 cb3f91d5:1",
      "_shared/kiwi/wave-srs-registration.md\t## 1. 처음 저작 — run 당 한 번, 분해 앞\t4\tf1b90184:1 5ea1c67e:1 f1b90184:1 591dfc7e:1",
      "_shared/kiwi/wave-srs-registration.md\t## 2. 증분 저작 — stage 당 한 번, PW-10 재생 뒤 · PW-13 검증 앞\t13\t2bda4ba7:1 f1b90184:1 c451c17a:1 f1b90184:1 8d704361:1 c7a53f2f:1 70d3cf2f:1 4199ba45:1 10bfd1d4:1 d111fd3d:1 78570f66:1 848f69fb:1 a72b2a69:1"
    ]
  },
  "worktree-lane §2": {
    "skills/claude": [
      "_shared/kiwi/worktree-lane.md\t## 2. 만들기 — 기본 HEAD 를 믿지 않는다\t24\tb838671e:1 0146f3e1:1 f9424fc1:1 7b8b67b7:1 5766d454:1 fbe53099:1 a3232911:1 58afdf56:1 f60a8aba:1 20af3f60:1 0e660d4a:1 c9f6d796:1 4b876deb:1 6e612414:1 e474ce34:1 399875de:1 bcdae543:1 ec53bdc4:1 77acdfd8:1 f1b90184:1 c8a7bc8a:1 f1b90184:1 02ceb298:1 cb3f91d5:1"
    ],
    "skills/codex": [
      "_shared/kiwi/worktree-lane.md\t## 2. Creating one — never trust the default head\t24\t14d8a1bc:1 39306ec9:1 bf59fffd:1 0e4ae387:1 656178d8:1 25c04ca9:1 0e9d1d26:1 690a33ef:1 156775aa:1 c33fdd49:1 d287d55d:1 53b05063:1 14ceca0f:1 c57dbd9a:1 6114c9e5:1 89641f4f:1 caf2f72b:1 c07e4991:1 660752c9:1 f1b90184:1 c8a7bc8a:1 f1b90184:1 81bafe3d:1 cb3f91d5:1"
    ],
    "skills/etc": [
      "_shared/kiwi/worktree-lane.md\t## 2. Creating one — never trust the default head\t24\t14d8a1bc:1 39306ec9:1 bf59fffd:1 0e4ae387:1 656178d8:1 25c04ca9:1 0e9d1d26:1 690a33ef:1 156775aa:1 c33fdd49:1 d287d55d:1 53b05063:1 14ceca0f:1 c57dbd9a:1 6114c9e5:1 89641f4f:1 caf2f72b:1 c07e4991:1 660752c9:1 f1b90184:1 c8a7bc8a:1 f1b90184:1 81bafe3d:1 cb3f91d5:1"
    ],
    ".agents/skills": [
      "_shared/kiwi/worktree-lane.md\t## 2. Creating one — never trust the default head\t24\t14d8a1bc:1 39306ec9:1 bf59fffd:1 0e4ae387:1 656178d8:1 25c04ca9:1 0e9d1d26:1 690a33ef:1 156775aa:1 c33fdd49:1 d287d55d:1 53b05063:1 14ceca0f:1 c57dbd9a:1 6114c9e5:1 89641f4f:1 caf2f72b:1 c07e4991:1 660752c9:1 f1b90184:1 c8a7bc8a:1 f1b90184:1 81bafe3d:1 cb3f91d5:1"
    ]
  },
  "kiwi-coder §4 · §5.1": {
    "skills/claude": [
      "kiwi-coder/SKILL.md\t## 4. Phase 1 — TDD 작성·검증\t0\t",
      "kiwi-coder/SKILL.md\t### 4.1 테스트 작성\t15\t096cd5a8:1 fc23a2d7:1 d43cb4fb:1 b0833015:1 b3f74977:1 6e923bae:1 8da97daa:1 a7cb60e5:1 6a461038:1 57f55ffd:1 b8db05ea:1 78056766:1 d55bc412:1 7ca8de78:1 05cc5350:1",
      "kiwi-coder/SKILL.md\t### 4.2 TDD 검증 (2축)\t14\t0f82e102:1 77dcb9aa:1 0ad862ab:1 4da1ec6f:1 698cd92b:1 a2002708:1 449809c2:1 fb1c85de:1 4da1ec6f:1 f9cf2231:1 5eaab45a:1 be3250b2:1 3d321287:1 1b5cb815:1",
      "kiwi-coder/SKILL.md\t### 4.3 개선 루프 (kept finding 0 까지)\t10\tf1b90184:1 dd31b78a:1 a79aaf79:1 e639cd07:1 2ce10404:1 f1b90184:1 d831d273:1 8c4112ff:1 21ee059e:1 f93970cf:1",
      "kiwi-coder/SKILL.md\t### 4.4 red 확정 + red_evidence 기록\t12\t6c211636:1 a56726cd:1 021fb596:1 828d225d:1 52e9d2c8:1 7c191a20:1 9807e23e:1 d10b36aa:1 f1b90184:1 8e481f37:1 f5401bbb:1 cb3f91d5:1",
      "kiwi-coder/SKILL.md\t### 5.1 단계 흐름\t49\tf1b90184:1 5c692ce5:1 6572a848:1 8a9945bf:1 7ce6b290:1 c00094da:1 890d8096:1 017367c4:1 979b63ab:1 c77e86d0:1 b2a92dda:1 bebb030b:1 7113351d:1 a4a8fd11:1 3d9a7ec3:1 d0e22c3f:1 7400dec8:1 899f8d92:1 ddf1ad3b:1 dd0f7643:1 fabb17b0:1 6cd581f6:1 4fcc5134:1 e45635d5:1 5c783013:1 fa2344d4:1 3ae6fb27:1 8d4db2f0:1 068fdeac:1 6033ebed:1 334539de:1 5994230d:1 99b9e357:1 e3b01123:1 3e9a8072:1 c5640ce0:1 8c4287be:1 a5d8c3f6:1 f80facd9:1 4929ea02:1 9eda2ac0:1 fa956af8:1 fd543da4:1 99242134:1 5e977371:1 5a279ce0:1 40c4b763:1 256e1e8f:1 f1b90184:1"
    ],
    "skills/codex": [
      "kiwi-coder/SKILL.md\t## 4. Phase 1 — TDD 작성·검증\t0\t",
      "kiwi-coder/SKILL.md\t### 4.1 테스트 작성\t15\t096cd5a8:1 fc23a2d7:1 bb4def56:1 b0833015:1 b3f74977:1 6e923bae:1 8da97daa:1 a7cb60e5:1 6a461038:1 57f55ffd:1 b8db05ea:1 78056766:1 d55bc412:1 7ca8de78:1 05cc5350:1",
      "kiwi-coder/SKILL.md\t### 4.2 TDD 검증 (2축)\t14\t9872e27c:1 77dcb9aa:1 0ad862ab:1 4da1ec6f:1 d0d9e1c5:1 ef3b4d0c:1 449809c2:1 fb1c85de:1 4da1ec6f:1 45b073f1:1 5eaab45a:1 2b47baa2:1 3d321287:1 1b5cb815:1",
      "kiwi-coder/SKILL.md\t### 4.3 개선 루프 (kept finding 0 까지)\t10\tf1b90184:1 dd31b78a:1 a79aaf79:1 e639cd07:1 2ce10404:1 f1b90184:1 d831d273:1 8c4112ff:1 21ee059e:1 1afd40f2:1",
      "kiwi-coder/SKILL.md\t### 4.4 red 확정 + red_evidence 기록\t12\t6c211636:1 a56726cd:1 021fb596:1 828d225d:1 52e9d2c8:1 7c191a20:1 9807e23e:1 d10b36aa:1 f1b90184:1 8e481f37:1 f5401bbb:1 cb3f91d5:1",
      "kiwi-coder/SKILL.md\t### 5.1 단계 흐름\t49\tf1b90184:1 5c692ce5:1 6572a848:1 8a9945bf:1 7ce6b290:1 95c16a22:1 890d8096:1 017367c4:1 979b63ab:1 c77e86d0:1 b2a92dda:1 bebb030b:1 7113351d:1 a4a8fd11:1 3d9a7ec3:1 d0e22c3f:1 7400dec8:1 899f8d92:1 ddf1ad3b:1 dd0f7643:1 fabb17b0:1 6cd581f6:1 4fcc5134:1 e45635d5:1 5c783013:1 fa2344d4:1 3ae6fb27:1 8d4db2f0:1 068fdeac:1 6033ebed:1 334539de:1 5994230d:1 99b9e357:1 e3b01123:1 3e9a8072:1 c5640ce0:1 8c4287be:1 a5d8c3f6:1 f80facd9:1 4929ea02:1 9eda2ac0:1 fa956af8:1 fd543da4:1 99242134:1 5e977371:1 5a279ce0:1 40c4b763:1 256e1e8f:1 f1b90184:1"
    ],
    "skills/etc": [
      "kiwi-coder/SKILL.md\t## 4. Phase 1 — TDD 작성·검증\t0\t",
      "kiwi-coder/SKILL.md\t### 4.1 테스트 작성\t15\t096cd5a8:1 fc23a2d7:1 d41225c7:1 b0833015:1 b3f74977:1 6e923bae:1 8da97daa:1 a7cb60e5:1 6a461038:1 57f55ffd:1 b8db05ea:1 78056766:1 d55bc412:1 7ca8de78:1 05cc5350:1",
      "kiwi-coder/SKILL.md\t### 4.2 TDD 검증 (2축)\t14\t49fe4583:1 77dcb9aa:1 0ad862ab:1 4da1ec6f:1 68986799:1 4573daf2:1 449809c2:1 fb1c85de:1 4da1ec6f:1 45b073f1:1 5eaab45a:1 2b47baa2:1 3d321287:1 1b5cb815:1",
      "kiwi-coder/SKILL.md\t### 4.3 개선 루프 (kept finding 0 까지)\t12\tf1b90184:1 f17631cb:1 7e524750:1 cc9f3613:1 1dd51224:1 e7bb72ea:1 f64b99d0:1 f1b90184:1 d831d273:1 8c4112ff:1 21ee059e:1 0ba22ab3:1",
      "kiwi-coder/SKILL.md\t### 4.4 red 확정 + red_evidence 기록\t12\t6c211636:1 a56726cd:1 021fb596:1 828d225d:1 52e9d2c8:1 7c191a20:1 9807e23e:1 d10b36aa:1 f1b90184:1 8e481f37:1 f5401bbb:1 cb3f91d5:1",
      "kiwi-coder/SKILL.md\t### 5.1 단계 흐름\t49\tf1b90184:1 5c692ce5:1 6572a848:1 8a9945bf:1 7ce6b290:1 caccc807:1 890d8096:1 017367c4:1 979b63ab:1 c77e86d0:1 b2a92dda:1 bebb030b:1 7113351d:1 a4a8fd11:1 3d9a7ec3:1 d0e22c3f:1 7400dec8:1 899f8d92:1 ddf1ad3b:1 dd0f7643:1 fabb17b0:1 6cd581f6:1 4fcc5134:1 e45635d5:1 5c783013:1 fa2344d4:1 3ae6fb27:1 8d4db2f0:1 068fdeac:1 6033ebed:1 334539de:1 5994230d:1 99b9e357:1 e3b01123:1 3e9a8072:1 c5640ce0:1 c14f23b8:1 a5d8c3f6:1 f80facd9:1 4929ea02:1 9eda2ac0:1 fa956af8:1 fd543da4:1 99242134:1 5e977371:1 5a279ce0:1 40c4b763:1 256e1e8f:1 f1b90184:1"
    ],
    ".agents/skills": [
      "kiwi-coder/SKILL.md\t## 4. Phase 1 — TDD 작성·검증\t0\t",
      "kiwi-coder/SKILL.md\t### 4.1 테스트 작성\t15\t096cd5a8:1 fc23a2d7:1 bb4def56:1 b0833015:1 b3f74977:1 6e923bae:1 8da97daa:1 a7cb60e5:1 6a461038:1 57f55ffd:1 b8db05ea:1 78056766:1 d55bc412:1 7ca8de78:1 05cc5350:1",
      "kiwi-coder/SKILL.md\t### 4.2 TDD 검증 (2축)\t14\t9872e27c:1 77dcb9aa:1 0ad862ab:1 4da1ec6f:1 d0d9e1c5:1 ef3b4d0c:1 449809c2:1 fb1c85de:1 4da1ec6f:1 45b073f1:1 5eaab45a:1 2b47baa2:1 3d321287:1 1b5cb815:1",
      "kiwi-coder/SKILL.md\t### 4.3 개선 루프 (kept finding 0 까지)\t10\tf1b90184:1 dd31b78a:1 a79aaf79:1 e639cd07:1 2ce10404:1 f1b90184:1 d831d273:1 8c4112ff:1 21ee059e:1 1afd40f2:1",
      "kiwi-coder/SKILL.md\t### 4.4 red 확정 + red_evidence 기록\t12\t6c211636:1 a56726cd:1 021fb596:1 828d225d:1 52e9d2c8:1 7c191a20:1 9807e23e:1 d10b36aa:1 f1b90184:1 8e481f37:1 f5401bbb:1 cb3f91d5:1",
      "kiwi-coder/SKILL.md\t### 5.1 단계 흐름\t49\tf1b90184:1 5c692ce5:1 6572a848:1 8a9945bf:1 7ce6b290:1 95c16a22:1 890d8096:1 017367c4:1 979b63ab:1 c77e86d0:1 b2a92dda:1 bebb030b:1 7113351d:1 a4a8fd11:1 3d9a7ec3:1 d0e22c3f:1 7400dec8:1 899f8d92:1 ddf1ad3b:1 dd0f7643:1 fabb17b0:1 6cd581f6:1 4fcc5134:1 e45635d5:1 5c783013:1 fa2344d4:1 3ae6fb27:1 8d4db2f0:1 068fdeac:1 6033ebed:1 334539de:1 5994230d:1 99b9e357:1 e3b01123:1 3e9a8072:1 c5640ce0:1 8c4287be:1 a5d8c3f6:1 f80facd9:1 4929ea02:1 9eda2ac0:1 fa956af8:1 fd543da4:1 99242134:1 5e977371:1 5a279ce0:1 40c4b763:1 256e1e8f:1 f1b90184:1"
    ]
  },
  "kiwi-wave-master core rules · §0 · §8 · §11": {
    "skills/claude": [
      "kiwi-wave-master/SKILL.md\t## 핵심 규칙 — 컴팩션 뒤에도 남는 PRD 규칙 (FR-FLOW-204)\t6\te86c695c:1 4a85b919:1 cb3f91d5:1 85587d51:1 4cec756b:1 cb3f91d5:1",
      "kiwi-wave-master/SKILL.md\t## 핵심 규칙 — 컴팩션 뒤에도 남는 실행 규칙 (FR-FLOW-223)\t12\t5da8b034:1 d470a9c8:1 127a027d:1 7a8e1dfd:1 db49f1fc:1 8572077e:1 f21e0e3e:1 568767c7:1 5caf7ff4:1 e0b01cbf:1 fac5f71d:1 cb3f91d5:1",
      "kiwi-wave-master/SKILL.md\t## 0. 공통 규약 (SSOT)\t19\t3cd39375:1 4199ba45:1 fe348441:1 7d99bd73:1 fc6a2bd8:1 33a029ee:1 ba3ebd05:1 afe834b6:1 587b08c9:1 48422008:1 c1647e3f:1 638bf0f8:1 e70721cf:1 ca2c20b2:1 1809db0f:1 30f641d3:1 daf30c1a:1 ce59393d:1 cb3f91d5:1",
      "kiwi-wave-master/SKILL.md\t## 8. 에픽 이슈 진입 모드 (FR-FLOW-214)\t2\tc8458038:1 cb3f91d5:1",
      "kiwi-wave-master/SKILL.md\t## 11 워크트리 절차 — 만들고, 그 안에서 일하고, 되돌려준다\t24\t00774939:1 f7ae9a66:1 0ec32875:1 45df90ed:1 f1b90184:1 65b4276d:1 f1b90184:1 bc16d203:1 4d93fc7a:1 4ded5dd1:1 9d700098:1 a67beca6:1 db22b050:1 f1b90184:1 c8a7bc8a:1 f1b90184:1 9cd5430b:1 a370d569:1 9c678472:1 f1b90184:1 2696b5f1:1 f1b90184:1 d8781f29:1 ff86bb18:1"
    ],
    "skills/codex": [
      "kiwi-wave-master/SKILL.md\t## 핵심 규칙 — 컴팩션 뒤에도 남는 PRD 규칙 (FR-FLOW-204)\t6\te86c695c:1 4a85b919:1 cb3f91d5:1 85587d51:1 a578ac2c:1 cb3f91d5:1",
      "kiwi-wave-master/SKILL.md\t## 핵심 규칙 — 컴팩션 뒤에도 남는 실행 규칙 (FR-FLOW-223)\t12\t5da8b034:1 d470a9c8:1 127a027d:1 7a8e1dfd:1 db49f1fc:1 8572077e:1 f21e0e3e:1 568767c7:1 5caf7ff4:1 e0b01cbf:1 fac5f71d:1 cb3f91d5:1",
      "kiwi-wave-master/SKILL.md\t## 0. 공통 규약 (SSOT)\t19\t3cd39375:1 4199ba45:1 f86041b0:1 7d99bd73:1 fc6a2bd8:1 267a7ab9:1 ba3ebd05:1 afe834b6:1 59cee1ef:1 c9741018:1 43e322fe:1 e478d331:1 001f66b8:1 ac01d9dc:1 89e01f2b:1 30f641d3:1 49677d25:1 ce59393d:1 cb3f91d5:1",
      "kiwi-wave-master/SKILL.md\t## 8. 에픽 이슈 진입 모드 (FR-FLOW-214)\t2\tc8458038:1 cb3f91d5:1",
      "kiwi-wave-master/SKILL.md\t## 11 워크트리 절차 — 만들고, 그 안에서 일하고, 되돌려준다\t24\tcf8d33f5:1 56367194:1 0ec32875:1 45df90ed:1 f1b90184:1 65b4276d:1 f1b90184:1 bc16d203:1 4d93fc7a:1 4ded5dd1:1 9d700098:1 a67beca6:1 db22b050:1 f1b90184:1 c8a7bc8a:1 f1b90184:1 9cd5430b:1 a370d569:1 9c678472:1 f1b90184:1 2696b5f1:1 f1b90184:1 d8781f29:1 ff86bb18:1"
    ],
    "skills/etc": [
      "kiwi-wave-master/SKILL.md\t## 핵심 규칙 — 컴팩션 뒤에도 남는 PRD 규칙 (FR-FLOW-204)\t6\te86c695c:1 4a85b919:1 cb3f91d5:1 98047d4a:1 a578ac2c:1 cb3f91d5:1",
      "kiwi-wave-master/SKILL.md\t## 핵심 규칙 — 컴팩션 뒤에도 남는 실행 규칙 (FR-FLOW-223)\t12\t5da8b034:1 d470a9c8:1 127a027d:1 7a8e1dfd:1 db49f1fc:1 8572077e:1 f21e0e3e:1 568767c7:1 5caf7ff4:1 e0b01cbf:1 fac5f71d:1 cb3f91d5:1",
      "kiwi-wave-master/SKILL.md\t## 0. 공통 규약 (SSOT)\t19\t3cd39375:1 4199ba45:1 f86041b0:1 7d99bd73:1 fc6a2bd8:1 267a7ab9:1 ba3ebd05:1 afe834b6:1 59cee1ef:1 c9741018:1 43e322fe:1 e478d331:1 001f66b8:1 ac01d9dc:1 89e01f2b:1 30f641d3:1 49677d25:1 ce59393d:1 cb3f91d5:1",
      "kiwi-wave-master/SKILL.md\t## 8. 에픽 이슈 진입 모드 (FR-FLOW-214)\t2\tc8458038:1 cb3f91d5:1",
      "kiwi-wave-master/SKILL.md\t## 11 워크트리 절차 — 만들고, 그 안에서 일하고, 되돌려준다\t24\tcf8d33f5:1 56367194:1 0ec32875:1 45df90ed:1 f1b90184:1 65b4276d:1 f1b90184:1 bc16d203:1 4d93fc7a:1 4ded5dd1:1 9d700098:1 a67beca6:1 db22b050:1 f1b90184:1 c8a7bc8a:1 f1b90184:1 9cd5430b:1 a370d569:1 9c678472:1 f1b90184:1 2696b5f1:1 f1b90184:1 d8781f29:1 ff86bb18:1"
    ]
  },
  "kiwi-orchestrator core rules": {
    "skills/claude": [
      "kiwi-orchestrator/SKILL.md\t## 핵심 규칙 — 컴팩션 뒤에도 남는 PRD 규칙 (FR-FLOW-204)\t9\t2f25f90c:1 7f5c481a:1 7a98c9ec:1 d08392a9:1 cb3f91d5:1 f36e19b0:1 ff85047e:1 a9a09cf7:1 cb3f91d5:1"
    ],
    "skills/codex": [
      "kiwi-orchestrator/SKILL.md\t## 핵심 규칙 — 컴팩션 뒤에도 남는 PRD 규칙 (FR-FLOW-204)\t9\t2f25f90c:1 7f5c481a:1 7a98c9ec:1 d08392a9:1 cb3f91d5:1 f36e19b0:1 80c252fe:1 a9a09cf7:1 cb3f91d5:1"
    ],
    "skills/etc": [
      "kiwi-orchestrator/SKILL.md\t## 핵심 규칙 — 컴팩션 뒤에도 남는 PRD 규칙 (FR-FLOW-204)\t9\t2f25f90c:1 7f5c481a:1 7a98c9ec:1 d08392a9:1 cb3f91d5:1 3f030bfe:1 80c252fe:1 a9a09cf7:1 cb3f91d5:1"
    ],
    ".agents/skills": [
      "kiwi-orchestrator/SKILL.md\t## 핵심 규칙 — 컴팩션 뒤에도 남는 PRD 규칙 (FR-FLOW-204)\t9\t2f25f90c:1 7f5c481a:1 7a98c9ec:1 d08392a9:1 cb3f91d5:1 f36e19b0:1 80c252fe:1 a9a09cf7:1 cb3f91d5:1"
    ]
  },
  "kiwi-pm core rules": {
    "skills/claude": [
      "kiwi-pm/SKILL.md\t## 핵심 규칙 — 컴팩션 뒤에도 남는 실행 규칙 (FR-FLOW-223)\t3\t63451555:1 69b1661e:1 cb3f91d5:1"
    ],
    "skills/codex": [
      "kiwi-pm/SKILL.md\t## 핵심 규칙 — 컴팩션 뒤에도 남는 실행 규칙 (FR-FLOW-223)\t3\t63451555:1 69b1661e:1 cb3f91d5:1"
    ],
    "skills/etc": [
      "kiwi-pm/SKILL.md\t## 핵심 규칙 — 컴팩션 뒤에도 남는 실행 규칙 (FR-FLOW-223)\t3\t63451555:1 69b1661e:1 cb3f91d5:1"
    ],
    ".agents/skills": [
      "kiwi-pm/SKILL.md\t## 핵심 규칙 — 컴팩션 뒤에도 남는 실행 규칙 (FR-FLOW-223)\t3\t63451555:1 69b1661e:1 cb3f91d5:1"
    ]
  }
};
// </recorded-d2-rule-blocks>
