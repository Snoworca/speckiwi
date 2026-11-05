import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "./kiwi-orchestrator-variants.js";
import { RENDERINGS } from "./kiwi-renderings.js";

// FR-FLOW-218 — workers report requirement changes as evidenced srs_deltas without stopping, and the host
// turns a stage's kept deltas into one serial incremental kiwi-srs call judged against the PRD.

const read = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8");
const PARALLEL = RENDERINGS.map((root) => `${root}/_shared/kiwi/parallel-waves.md`);
const REGISTRATION = RENDERINGS.map((root) => `${root}/_shared/kiwi/wave-srs-registration.md`);

function incremental(text: string): string {
  const start = text.indexOf("\n## 2. 증분 저작");
  return start < 0 ? "" : text.slice(start);
}

describe("FR-FLOW-218 AC-1 — the manifest carries srs_deltas[] and reporting one never stops the worker", () => {
  // @req FR-FLOW-218 AC-1 — language-neutral tokens: the claude contract is Korean, codex and etc are English.
  it.each(PARALLEL)("%s: PW-6 manifest entry shape, kinds, no stop, no docs/spec write", (rel) => {
    const text = read(rel);
    const start = text.indexOf("**PW-6 ·");
    const pw6 = text.slice(start, text.indexOf("**PW-7 ·", start));
    const line = pw6.split("\n").find((entry) => entry.includes("`srs_deltas[]` 는") || entry.includes("`srs_deltas[]` entry")) ?? "";
    expect(line, `${rel}: no srs_deltas[] definition in PW-6`).not.toBe("");
    expect(line).toContain("`{kind, about, prd_item, evidence {test_id, failure}, files, summary}`");
    for (const kind of ["`new-requirement`", "`ac-change`", "`residual`"]) expect(line, `${rel}: ${kind}`).toContain(kind);
    // Held as the whole clause: "멈추지 않고" alone also matches a sentence that stops the worker on another condition.
    expect(line).toContain(
      rel.startsWith("skills/claude/")
        ? "델타를 보고해도 워커는 멈추지 않고 그 wave 의 일을 계속하며, `docs/spec` 아래에 아무것도 쓰지 않는다. 호스트가 PW-1 에서 반영한다."
        : "Reporting a delta does not stop the worker, which carries on with the wave, and the worker writes nothing under `docs/spec`. The host applies the deltas at PW-1."
    );
    expect(pw6).toContain("srs_deltas[]");
  });
});

describe("FR-FLOW-218 AC-2 — a delta without a red test or command output is dropped and named", () => {
  // @req FR-FLOW-218 AC-2
  it.each(REGISTRATION)("%s: drops and names an unevidenced delta", (rel) => {
    expect(incremental(read(rel))).toContain("`evidence` 가 red 테스트나 명령 출력이 아닌 델타를 버리고 그 델타를 보고에 적는다");
  });
});

describe("FR-FLOW-218 AC-3 — one serial incremental call per stage, after replay and before wave verification", () => {
  // @req FR-FLOW-218 AC-3
  it.each(REGISTRATION)("%s: the call, its place and its PRD stop", (rel) => {
    const section = incremental(read(rel));
    expect(section).toContain("stage 당 한 번, PW-10 재생 뒤 · PW-13 검증 앞");
    expect(section).toContain("`{artifact_root}waves/stage-{s}/srs-deltas.md` 에 모아 한 번 부른다");
    expect(section).toContain('Skill({ skill: "kiwi-srs", args: "REQ_PATH={artifact_root}waves/stage-{s}/srs-deltas.md PRD_PATH=<run 의 PRD> TARGET=<제품 target>');
    expect(section).toContain("PRD 항목도 `fills:` 도 인용하지 않는 확장은 `prd-residual-user-decision` 으로 멈춘다");
    expect(read(rel)).toContain("호스트가 run root 에서 하나씩 부른다");
  });

  // @req FR-FLOW-218 AC-3 — PW-1 runs once, serially. The ban is read as its own sentence: the step's
  // heading says "serially" too, so a check on that word alone survives reversing the ban (verify r1).
  it.each(PARALLEL)("%s: PW-1 states outright that the call never runs in parallel", (rel) => {
    const text = read(rel);
    const start = text.indexOf("**PW-1 ·");
    const pw1 = text.slice(start, text.indexOf("**PW-2 ·", start));
    expect(pw1).toContain(
      rel.startsWith("skills/claude/") ? "**절대 병렬로 돌리지 않는다**(§1 의 네 경합)." : "**This never runs in parallel** (the four races of §1)."
    );
  });

  // @req FR-FLOW-218 AC-3 — the stage order places the call between PW-10 and PW-13.
  it.each(PARALLEL)("%s: PW-10 hands over to the incremental call before PW-13", (rel) => {
    const text = read(rel);
    const start = text.indexOf("**PW-10 ·");
    const pw10 = text.slice(start, text.indexOf("**PW-11 ·", start));
    // The hand-over sentence itself: a bare /PW-1\b/ matched any mention of the step.
    expect(pw10, `${rel}: PW-10 must run PW-1 after replay`).toContain(
      rel.startsWith("skills/claude/")
        ? "재생이 끝나면 PW-13 앞에서 PW-1 의 증분 저작을 돈다"
        : "Once the replay is done, PW-1's incremental authoring runs before PW-13"
    );
    expect(pw10).toContain("`wave-srs-registration.md §2`");
  });
});

describe("FR-FLOW-218 AC-4 — each delta kind has one route", () => {
  const ROUTES: Array<[RegExp, string[]]> = [
    [/^\| `new-requirement` \|/, ["`wave-decomposition.md §6` 의 R1 ~ R5 로 배치한다"]],
    [/^\| `ac-change` — 현재 wave 의 `verified` 아닌 요구 \|/, ["그 AC 를 고치고", "재진입 `r{m}`"]],
    [/^\| `ac-change` — 끝난 wave 의 `verified` 요구 \|/, ["그 요구를 고치지 않는다", "뒤 wave 에 후속 요구를 저작하고", "옛 AC 를 그 후속 요구를 지명해 만료한다"]],
    [/^\| 옛 동작 자체가 틀림 \|/, ["`wave-verify-cross-wave-fix-required` 로 멈춘다", "하향 · 수정 · 재승급은 사용자가 결정한 뒤에만 한다"]],
    [/^\| `residual` \|/, ["저작이 돌려준 ID 로 받는 wave 에 넣는다"]]
  ];
  for (const rel of REGISTRATION) {
    for (const [row, clauses] of ROUTES) {
      // @req FR-FLOW-218 AC-4
      it(`${rel}: ${row.source}`, () => {
        const line = incremental(read(rel)).split("\n").find((entry) => row.test(entry)) ?? "";
        for (const clause of clauses) expect(line, `${rel}: ${clause}`).toContain(clause);
      });
    }
  }
});
