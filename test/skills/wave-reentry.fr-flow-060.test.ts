import { describe, expect, it } from "vitest";

import { section } from "./kiwi-orchestrator-variants.js";
import { RENDERINGS, readRepoFile, skillFiles } from "./kiwi-renderings.js";

// @req FR-FLOW-060 AC-2 — a wave re-entry is distinguishable in the waves journal, and a re-entry whose
// kiwi-coder run changed nothing inside its lane write set does not report completion.
// @req FR-FLOW-064 AC-3 — a kiwi-pipeline re-entry leaves an event sequence its self-recursion check
// accepts, and a wave re-entry under the shared parallel-waves contract enters no kiwi-pipeline.

const read = (relPath: string): string => readRepoFile(relPath).replace(/\r\n/g, "\n");

/** The parallel-waves.md §3 bullet that defines a re-entry. */
function reentryBullet(rendering: string): string {
  const stages = section(read(`${rendering}/_shared/kiwi/parallel-waves.md`), /^##\s*3\./);
  return stages.split("\n").find((line) => /^- \*\*(?:재진입\*\*의 단위 id|A re-entry's\*\* unit id)/.test(line)) ?? "";
}

describe("FR-FLOW-060 AC-2 — a re-entry is told apart in the journal, and a no-op one is not a completion", () => {
  it.each(RENDERINGS)("FR-FLOW-060 AC-2: %s gives a wave re-entry its own unit id on the journal line", (rendering) => {
    const bullet = reentryBullet(rendering);
    expect(bullet, `${rendering}: parallel-waves.md §3 does not define a re-entry`).not.toBe("");
    expect(bullet).toContain("`{run_id}-wave-{n}-r{m}`");
    expect(bullet, `${rendering}: the re-entry id is not what the journal records`).toMatch(/저널 `sds_id`|journal `sds_id`/);
  });

  it.each(RENDERINGS)("FR-FLOW-060 AC-2: %s/kiwi-pm refuses TASK_DONE for a re-entry that changed nothing in the lane write set", (rendering) => {
    const rule = skillFiles(rendering, "kiwi-pm")
      .flatMap((doc) => doc.text.replace(/\r\n/g, "\n").split("\n"))
      .find((line) => line.includes("**무동작 재진입은 완료가 아니다**")) ?? "";
    expect(rule, `${rendering}: kiwi-pm states no no-op re-entry rule`).not.toBe("");
    expect(rule, `${rendering}: the write set is not the lane's as the stage lanes lock records it`).toContain("stage lanes lock 이 기록한 lane 쓰기 집합");
    expect(rule).toMatch(/commit 도 작업 트리 변경도 남기지 않았으면/);
    expect(rule, `${rendering}: the no-op run still reports completion`).toMatch(/`TASK_DONE` 이 아니라 `no-op` 사유를 실은 `NEEDS_USER` 를 반환한다/);
  });
});

describe("FR-FLOW-064 AC-3 — a re-entry does not trip the pipeline's self-recursion check", () => {
  it.each(RENDERINGS)("FR-FLOW-064 AC-3: %s/kiwi-pipeline reads a previous own event with another next_hint as a normal re-entry", (rendering) => {
    const pipeline = skillFiles(rendering, "kiwi-pipeline").map((doc) => doc.text.replace(/\r\n/g, "\n")).join("\n");
    const recursion = section(pipeline, /^###\s*6\.5\s/);
    expect(recursion, `${rendering}: kiwi-pipeline has no §6.5 self-recursion section`).not.toBe("");
    expect(recursion).toMatch(/`next_hint` 가 `kiwi-pipeline` 이 \*\*아니면\*\* 정상 재진입이다/);
    const emitKey = section(pipeline, /^###\s*7\.5\s/);
    expect(emitKey, `${rendering}: a re-entry has no emit key of its own`).toMatch(/emit \*\*멱등 키\*\*는 `\{run_id\}#r\{n\}` 이다/);
  });

  it.each(RENDERINGS)("FR-FLOW-064 AC-3: %s re-enters a wave through the shared contract, not through kiwi-pipeline", (rendering) => {
    const bullet = reentryBullet(rendering);
    expect(bullet).toMatch(/PW-3 부터 다시 돈다|runs again from PW-3/);
    expect(bullet.includes("kiwi-pipeline"), `${rendering}: the wave re-entry enters kiwi-pipeline`).toBe(false);
  });
});
