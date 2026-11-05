import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "./kiwi-orchestrator-variants.js";
import { RENDERINGS } from "./kiwi-renderings.js";

// FR-FLOW-217 — only waves not yet dispatched may be redecomposed, by the fixed rules R1 to R5, and every
// change is journalled with its graph version and checked again before the next dispatch.

const read = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8");
const DECOMPOSITION = RENDERINGS.map((root) => `${root}/_shared/kiwi/wave-decomposition.md`);
const WAVE_MASTER = ["skills/claude", "skills/codex", "skills/etc"].map((root) => `${root}/kiwi-wave-master/SKILL.md`);

function redecomposition(text: string): string {
  const start = text.indexOf("\n## 6. 재분해");
  if (start < 0) return "";
  const end = text.indexOf("\n## ", start + 1);
  return text.slice(start, end < 0 ? undefined : end);
}

/** The bullet line that starts with `- **<rule>**`. */
const rule = (section: string, id: string): string => section.split("\n").find((line) => line.startsWith(`- **${id}** —`)) ?? "";

describe("FR-FLOW-217 AC-1 — a remaining wave is not dispatched and has no journal line", () => {
  // @req FR-FLOW-217 AC-1 — revised 2026-11-05: `dispatched: false` alone is not enough; a node the journal
  // already names (its `--sds` SDS line, say) has a `ts` and is no longer remaining.
  it.each(DECOMPOSITION)("%s: remaining is dispatched: false and ts null in wave status, never read from the journal", (rel) => {
    const section = redecomposition(read(rel));
    expect(section).toContain(
      "`speckiwi orchestrate wave status --waves <그래프> --run-id {run_id} --json` 의 행이 `dispatched: false` 이고 저널 줄이 없는(`ts` 가 null) 노드다"
    );
    expect(section).toContain("저널을 손으로 읽지 않는다");
    expect(section).toContain(
      "그 밖의 노드 — dispatch 했거나, `--sds` 의 SDS 줄처럼 이미 저널 줄에 이름이 오른 노드 — 의 순서 · 범위 · 의존은 바꾸지 않는다"
    );
    expect(section).not.toContain("`dispatched: false` 로 보고하는 노드다");
  });
});

describe("FR-FLOW-217 AC-2 — the five placement rules", () => {
  const RULES: Array<[string, string[]]> = [
    ["R1", ["남은 노드 하나와만 겹치면 그 노드에 넣는다"]],
    ["R2", ["남은 노드 여럿과 겹치면", "위상 순서로 마지막인 노드에 넣고", "그 노드로 간선을 더하며", "사이클을 이루는 노드는 합친다"]],
    // R3 revised 2026-11-05: the nodes it may not touch are every node that is not remaining, not only dispatched ones.
    ["R3", ["남은 노드가 아닌 노드와만 겹치면 새 노드를 만든다", "추가 wave 상한 3 에 센다"]],
    ["R4", ["어느 노드와도 겹치지 않으면", "간선 없는 새 노드를 만들거나", "의존하는 요구를 가진 노드에 넣는다"]],
    ["R5", ["크기 상한을 넘으면", "남은 노드일 때만 둘로 나눈다"]]
  ];
  for (const rel of DECOMPOSITION) {
    for (const [id, clauses] of RULES) {
      // @req FR-FLOW-217 AC-2
      it(`${rel}: ${id}`, () => {
        const line = rule(redecomposition(read(rel)), id);
        for (const clause of clauses) expect(line, `${rel} ${id}: ${clause}`).toContain(clause);
      });
    }
  }
});

describe("FR-FLOW-217 AC-3 — each change is a new graph version, a redecompose line, and a fresh check", () => {
  // @req FR-FLOW-217 AC-3
  it.each(DECOMPOSITION)("%s: writes, journals and re-checks before the next dispatch", (rel) => {
    const last = redecomposition(read(rel)).trim().split("\n").pop() ?? "";
    for (const clause of [
      // The path is fixed: PW-4, PW-5 and §3 check and schedule `{artifact_root}waves/waves.json`, so a version
      // written elsewhere is never the one checked (verify r3). AC-3 allows the same path; the contract takes it.
      "변경마다 그래프의 새 판을 늘 같은 경로 `{artifact_root}waves/waves.json` 에 덮어쓰고",
      "`graph {path, digest}` 를 실은 `phase=\"redecompose\"` 줄을",
      "speckiwi orchestrate journal append",
      "다음 dispatch 전에 `orchestrate wave check` 와 `orchestrate schedule waves` 를 다시 통과시킨다"
    ]) {
      expect(last, `${rel}: ${clause}`).toContain(clause);
    }
    expect(redecomposition(read(rel)), `${rel}: the other-path option is back`).not.toMatch(/다른 경로|another path/);
  });
});

describe("FR-FLOW-217 AC-4 — wave-master §0.5 states the invariant", () => {
  // @req FR-FLOW-217 AC-4
  it.each(WAVE_MASTER)("%s: a dispatched wave never changes; remaining waves change only by R1 to R5", (rel) => {
    const row = read(rel).split("\n").find((line) => line.startsWith("| §0.5 |")) ?? "";
    expect(row).toContain("dispatch 한 wave 의 순서 · 범위 · 의존은 바꾸지 않는다");
    expect(row).toContain("남은 wave 는 `wave-decomposition.md §6` 의 R1 ~ R5 로만 바뀐다");
    // FR-FLOW-217 AC-1 (revised): the row's own definition of a remaining wave carries the journal-line condition.
    expect(row).toContain("남은 wave 는 `orchestrate wave status` 의 행이 `dispatched: false` 이고 저널 줄이 없는(`ts` 가 null) wave 다");
    expect(row).toContain("`--sds` 의 SDS 줄처럼 저널에 이미 이름이 오른 wave 도 바꾸지 않는다");
    expect(row).not.toContain("처음부터 다시 분해한다");
  });

  // @req FR-FLOW-217 AC-4 — moved from FR-FLOW-047 AC-5: appending a wave changes no dispatched wave, so the §0.5 row
  // itself carries the exception; stated anywhere else, the row still reads as an absolute ban.
  it.each(WAVE_MASTER)("%s: the §0.5 row carries the append exception under the run cap", (rel) => {
    const row = read(rel).split("\n").find((line) => line.startsWith("| §0.5 |")) ?? "";
    expect(row).toContain("새 wave 를 **추가**하는 것(R3 · R4, run 당 3 회 상한)은 dispatch 한 wave 를 바꾸지 않으므로 이 원칙의 **예외**로 허용된다");
  });
});
