import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "./kiwi-orchestrator-variants.js";
import { RENDERINGS } from "./kiwi-renderings.js";

// FR-FLOW-216 — a wave worker runs kiwi-pm once per requirement in the node's order, leaves a test
// commit and an implementation commit per requirement, resumes from those commits, stops the node at
// the first failed requirement, and reviews the wave window once.

const read = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8");
const PARALLEL = RENDERINGS.map((root) => `${root}/_shared/kiwi/parallel-waves.md`);
const PM = RENDERINGS.map((root) => `${root}/kiwi-pm/SKILL.md`);

/** The claude contract is Korean; codex, etc and the mirror are English. */
const korean = (rel: string): boolean => rel.startsWith("skills/claude/");

/** One PW step, from its bold marker to the next one. */
function step(text: string, n: number): string {
  const start = text.indexOf(`**PW-${n} ·`);
  if (start < 0) return "";
  const next = text.indexOf("**PW-", start + 6);
  return text.slice(start, next < 0 ? undefined : next);
}

/** §6 of the contract — resume. */
function resume(text: string): string {
  const start = text.indexOf("\n## 6.");
  return start < 0 ? "" : text.slice(start);
}

/** The `--commit-lane-work` subsection of kiwi-pm §1.5. */
function laneCommit(text: string): string {
  const start = text.indexOf("#### `--commit-lane-work`");
  if (start < 0) return "";
  const next = text.indexOf("\n#### ", start + 10);
  return text.slice(start, next < 0 ? undefined : next);
}

describe("FR-FLOW-216 AC-1 — one kiwi-pm per requirement, in acs order, then one review of the window", () => {
  it.each(PARALLEL)("%s: PW-6 implements the node's requirements one at a time in acs order", (rel) => {
    // @req FR-FLOW-216 AC-1
    const pw6 = step(read(rel), 6);
    expect(pw6, `${rel}: PW-6 not found`).not.toBe("");
    expect(pw6).toContain(
      korean(rel)
        ? "노드의 요구를 `orchestrate wave show` 가 주는 그 노드의 `acs` 에서 요구 ID 가 처음 나오는 순서대로 하나씩 구현한다 — 요구마다 `/kiwi-pm` 을 한 번 부른다"
        : "Implement the node's requirements one at a time, in the order requirement IDs first occur in the node's `acs` as `orchestrate wave show` gives them — one `/kiwi-pm` call per requirement"
    );
  });

  it.each(PARALLEL)("%s: the call carries one requirement, a per-requirement run id and the worker flags", (rel) => {
    // @req FR-FLOW-216 AC-1
    const pw6 = step(read(rel), 6);
    const fence = /```\n\s*\/kiwi-pm --req-filter[^\n]*\n[\s\S]*?```/.exec(pw6)?.[0] ?? "";
    expect(fence, `${rel}: no /kiwi-pm fence in PW-6`).not.toBe("");
    expect(fence).toContain(
      korean(rel)
        ? "/kiwi-pm --req-filter <요구 하나> --run-id {run_id}-wave-{n}[-r{m}]-<요구 ID 소문자>"
        : "/kiwi-pm --req-filter <one requirement> --run-id {run_id}-wave-{n}[-r{m}]-<lower-case requirement ID>"
    );
    expect(fence).toContain("--no-final --no-pipeline-emit --commit-lane-work --defer-srs-mutation");
    expect(fence, `${rel}: the old one-call-per-wave filter is gone`).not.toMatch(/requirements\[\]/);
    expect(pw6).toContain(korean(rel) ? "run id 는 요구마다 다르다" : "The run id differs per requirement");
    expect(pw6).toContain(
      korean(rel)
        ? "앞 요구의 `/kiwi-pm` 이 `TASK_DONE` 으로 끝나야 다음 요구로 간다"
        : "the next requirement starts only after the previous requirement's `/kiwi-pm` ended `TASK_DONE`"
    );
    expect(pw6).toContain(
      korean(rel)
        ? "`--sds` 면 그 요구를 `@req` 로 담은 조각을 `--sds <그 조각>` 으로 함께 준다"
        : "Under `--sds`, also give the fragment whose `@req` holds that requirement as `--sds <that fragment>`"
    );
  });

  it.each(PARALLEL)("%s: the review runs once, after the last requirement, over the whole window", (rel) => {
    // @req FR-FLOW-216 AC-1
    const pw6 = step(read(rel), 6);
    expect(pw6).toContain(
      korean(rel)
        ? "리뷰는 마지막 요구 뒤에 워커의 창 전체에 한 번 돈다"
        : "The review runs once, after the last requirement, over the worker's whole window"
    );
    const pm = pw6.indexOf("/kiwi-pm --req-filter");
    const review = pw6.indexOf('skill: "kiwi-review-fix-loop"');
    expect(pm > -1 && review > pm, `${rel}: the review must follow the per-requirement calls`).toBe(true);
  });
});

describe("FR-FLOW-216 AC-1 — kiwi-coder implements only the requirement set kiwi-pm passed, even with --sds", () => {
  const CODER = RENDERINGS.map((root) => `${root}/kiwi-coder/SKILL.md`);
  it.each(CODER)("%s: §3.3 takes the passed set as the implementation set", (rel) => {
    // @req FR-FLOW-216 AC-1 — the worker gives one requirement and, under --sds, the fragment holding it;
    // the coder must not widen the run to the fragment's whole @req set.
    const text = read(rel);
    const start = text.indexOf("### 3.3 요구 AC 로드");
    const section = text.slice(start, text.indexOf("\n### 3.4", start));
    expect(section, `${rel}: §3.3 not found`).not.toBe("");
    expect(section).toContain(
      "구현 대상은 넘겨받은 요구 집합(`--req-filter` · `REQ_IDS`)이다 — `--sds` 를 함께 받아도 SDS `@req` 전체가 아니라 그 집합이고, 요구 집합 없이 `--sds` 만 받았을 때만 SDS `@req` 집합이다"
    );
    expect(section).toContain("아래에서 `--sds` 의 `@req` 집합이라 적은 곳은 모두 이 구현 집합이다");
  });
});

describe("FR-FLOW-216 AC-2 — two commits per requirement, the test commit first", () => {
  it.each(PM)("%s: --commit-lane-work makes a test commit then an implementation commit per requirement", (rel) => {
    // @req FR-FLOW-216 AC-2
    const section = laneCommit(read(rel));
    expect(section, `${rel}: no --commit-lane-work subsection`).not.toBe("");
    expect(section).toContain(
      "요구마다 커밋 두 개를 만든다 — 먼저 그 요구의 새 테스트와 바뀐 테스트만 stage 한 **테스트 커밋**, 그다음 그 요구의 구현을 stage 한 **구현 커밋**이다"
    );
    expect(section).toContain(
      "두 커밋 모두 `REQ: <요구 ID>` 와 `Commit-Kind: test` 또는 `Commit-Kind: implementation`, 그리고 run 좌표(`Orch-Run` · `Orch-Wave` · `Orch-Stage` · `Orch-Lane`)를 trailer 로 싣는다"
    );
    expect(section).toContain("테스트 커밋이 구현 커밋보다 앞선다");
    expect(section, `${rel}: the one-commit-per-run rule is gone`).not.toContain("commit 1개");
  });

  it.each(PM)("%s: the argument summary and the output table say two commits per requirement", (rel) => {
    // @req FR-FLOW-216 AC-2
    const text = read(rel);
    const summary = text.split("\n").find((line) => /^\s*\[--commit-lane-work\]/.test(line)) ?? "";
    expect(summary).toContain("요구마다 테스트 커밋과 구현 커밋 2개");
    const output = text.split("\n").find((line) => line.startsWith("|") && line.includes("`--commit-lane-work` 가 있고")) ?? "";
    expect(output).toContain("요구마다 테스트 커밋과 구현 커밋");
  });

  // §6.1 is where the result is fixed and the commits are made: in SKILL.md for claude, in the extended
  // workflow reference for the renderings that split it out.
  const CLOSE_OUT = RENDERINGS.map((root) => (root === "skills/claude" ? `${root}/kiwi-pm/SKILL.md` : `${root}/kiwi-pm/references/extended-workflow.md`));
  it.each(CLOSE_OUT)("%s: §6.1 makes the per-requirement commits of §1.5, not one commit", (rel) => {
    // @req FR-FLOW-216 AC-2
    const sentence = read(rel).split("\n").find((line) => line.includes("`--commit-lane-work` 가 있고 `run.status = \"done\"` 이면")) ?? "";
    expect(sentence, `${rel}: §6.1 commit sentence`).not.toBe("");
    // The split-out reference names the file it points into (`SKILL.md` §1.5); SKILL.md itself says §1.5.
    expect(sentence).toMatch(/이 시점에 (?:`SKILL\.md` )?§1\.5 대로 요구마다 테스트 커밋과 그 뒤의 구현 커밋을 만든다/);
    expect(sentence).toContain("`run.commit_sha` 는 그 가운데 마지막 구현 커밋이다");
    expect(sentence).not.toMatch(/commit 1개|커밋 하나|커밋 1개/);
  });

  it.each(PM)("%s: the state field and the pseudocode say which of the commits run.commit_sha holds", (rel) => {
    // @req FR-FLOW-216 AC-2 — one sha field for two commits per requirement: it names the last implementation commit.
    const lines = read(rel).split("\n");
    const field = lines.find((line) => line.startsWith("- `run.commit_sha` — ")) ?? "";
    expect(field).toContain("`--commit-lane-work` 가 §1.5 대로 요구마다 만든 테스트 커밋 · 구현 커밋 가운데 마지막 구현 커밋");
    const assign = lines.find((line) => line.includes("state.run.commit_sha = ")) ?? "";
    expect(assign).toContain("state.run.commit_sha = COMMIT_PER_REQUIREMENT(state)");
    expect(assign).toContain("# §1.5 — 요구마다 테스트 커밋 뒤 구현 커밋, 값은 마지막 구현 커밋 sha");
    expect(lines.some((line) => line.includes("COMMIT_WRITE_SET"))).toBe(false);
  });
});

describe("FR-FLOW-216 AC-3 — the requirement-ID commits are the resume cursor", () => {
  it.each(PARALLEL)("%s: §6 resumes from the trailer commits", (rel) => {
    // @req FR-FLOW-216 AC-3
    const section = resume(read(rel));
    expect(section, `${rel}: §6 not found`).not.toBe("");
    const clauses = korean(rel)
      ? [
          "워커의 재개 커서는 요구 ID trailer 커밋이다",
          "`REQ: <요구 ID>` 와 `Commit-Kind: implementation` trailer 를 단 커밋이 `<base_sha>..<레인 브랜치>` 범위에 있는 요구는 끝난 것으로 보고 다시 돌리지 않는다",
          "테스트 커밋만 있는 요구는 그 구현부터 이어 간다",
          "그다음 요구로 계속 간다"
        ]
      : [
          "The worker's resume cursor is its requirement-ID trailer commits",
          "a requirement whose commit carrying the `REQ: <requirement ID>` and `Commit-Kind: implementation` trailers lies in the range `<base_sha>..<lane branch>` is done and does not run again",
          "a requirement with only its test commit resumes at its implementation",
          "then the worker continues with the next requirement"
        ];
    for (const clause of clauses) expect(section, `${rel}: ${clause}`).toContain(clause);
  });
});

// Lane-branch preparation (PW-6 step 1, the PW-8 retry branch) lives in worktree-lane.md §2 alone and is
// pinned and run in lane-branch-preparation.fr-flow-122.test.ts.
describe("FR-FLOW-216 AC-3 · FR-FLOW-218 AC-4 — the resume cursor counts only this dispatch's commits", () => {
  it.each(PARALLEL)("%s: §6 counts only the trailer commits after this dispatch's base", (rel) => {
    // @req FR-FLOW-216 AC-3 — a merged earlier dispatch's implementation commit must not mark a re-entry requirement done.
    const section = resume(read(rel));
    for (const clause of korean(rel)
      ? [
          "trailer 를 단 커밋이 `<base_sha>..<레인 브랜치>` 범위에 있는 요구는 끝난 것으로 보고 다시 돌리지 않는다",
          "범위 밖의 커밋 — 이미 병합된 앞 dispatch 의 커밋 — 은 세지 않는다",
          "`<base_sha>..<통합 브랜치>` 범위에 그 lane 의 구현 커밋이 이미 있는 요구도 다시 돌리지 않는다"
        ]
      : [
          "trailers lies in the range `<base_sha>..<lane branch>` is done and does not run again",
          "(commits outside that range — those of an earlier, already merged dispatch — do not count)",
          "A requirement whose implementation commit of that lane already lies in `<base_sha>..<integration branch>` does not run again either"
        ]) {
      expect(section, `${rel}: ${clause}`).toContain(clause);
    }
  });
});

describe("FR-FLOW-216 AC-4 — a failed requirement stops the node; only landed requirements are promoted", () => {
  it.each(PARALLEL)("%s: PW-6 stops at the failed requirement and the manifest lists landed, failed and held", (rel) => {
    // @req FR-FLOW-216 AC-4
    const pw6 = step(read(rel), 6);
    const clauses = korean(rel)
      ? [
          "**요구 하나가 실패하면 노드를 멈춘다.**",
          "뒤 요구를 돌리지 않고",
          "`requirements` 에 착지한 요구(`landed`) · 실패한 요구(`failed`) · 돌리지 않은 뒤 요구(`held`)를 적는다"
        ]
      : [
          "**When one requirement fails, the node stops.**",
          "runs no later requirement",
          "lists in `requirements` the landed requirements (`landed`), the failed one (`failed`) and the later ones it did not run (`held`)"
        ];
    for (const clause of clauses) expect(pw6, `${rel}: ${clause}`).toContain(clause);
    expect(pw6, `${rel}: the manifest field list`).toMatch(/\{branch, head_sha, commits\[\], requirements,/);
  });

  it.each(PARALLEL)("%s: PW-16 promotes only the landed requirements", (rel) => {
    // @req FR-FLOW-216 AC-4
    const pw16 = step(read(rel), 16);
    expect(pw16).toContain(
      korean(rel)
        ? "승급 집합은 착지한 요구뿐이다 — 매니페스트의 `requirements.landed` 가운데 구현 커밋이 통합 브랜치에 있는 요구이고, `failed` · `held` 요구는 들지 않는다"
        : "The promotion set is the landed requirements only — those of the manifest's `requirements.landed` whose implementation commit is on the integration branch; a `failed` or `held` requirement is not in it"
    );
  });
});

describe("FR-FLOW-216 AC-5 — the host verdict checks the test-before-implementation order", () => {
  it.each(PARALLEL)("%s: PW-8 checks each landed requirement's commit order beside red_evidence[]", (rel) => {
    // @req FR-FLOW-216 AC-5
    const pw8 = step(read(rel), 8);
    const block = /```\n([\s\S]*?)```/.exec(pw8)?.[1] ?? "";
    expect(block, `${rel}: PW-8 has no verdict block`).not.toBe("");
    expect(block).toContain(
      korean(rel)
        ? "착지한 요구마다 그 요구의 테스트 커밋이 구현 커밋의 조상이다"
        : "for each landed requirement, its test commit is an ancestor of its implementation commit"
    );
    expect(block).toMatch(/red_evidence\[\]/);
    const pw6 = step(read(rel), 6);
    expect(pw6, `${rel}: the one-commit excuse for test-first is gone`).not.toMatch(/run 당 커밋이 하나라|one commit per run/);
  });
});
