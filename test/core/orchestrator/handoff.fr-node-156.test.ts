// FR-NODE-156 — the English-only scan over a named denominator, with three excluded constructs
// (05 §6.2 layer 3).
//
// The denominator is the handoff body plus exactly two front-matter fields, `escalation` and every
// `acceptance[].untested_reason`. Every other front-matter field is outside it, and the scan is a
// script check rather than a language check — AC-5 pins that limitation rather than hiding it.

import { describe, expect, it } from "vitest";
import { validateHandoff, type HandoffValidation } from "../../../src/core/orchestrator/handoff.js";
import { defaultCatalog, defaultLane, defaultRoot, defaultSections, handoffWith, renderBody, TEST_PATH, VERIFICATION_CMD, HEARTBEAT_PATH, READ_A, READ_B } from "./handoff-fixtures.js";

function codes(text: string): string[] {
  const result: HandoffValidation = validateHandoff(text, defaultLane(), defaultCatalog(), defaultRoot());
  return result.violations.map((violation) => violation.code);
}

function bodyWith(objective: string): string {
  const sections = defaultSections();
  sections.Objective = objective;
  return renderBody(sections);
}

const SCRIPTS: Array<[label: string, sample: string]> = [
  ["Hangul", "한글"],
  ["a CJK ideograph", "漢字"],
  ["Kana", "カナ"],
  ["Cyrillic", "Привет"]
];

describe("FR-NODE-156 AC-1 — four scripts in the handoff body each raise handoff-not-english", () => {
  it.each(SCRIPTS)("raises the violation for %s in the body", (_label, sample) => {
    expect(codes(handoffWith({}, bodyWith(`Implement the partitioner. ${sample}`)))).toContain("handoff-not-english");
  });

  it("accepts the body the four fixtures vary", () => {
    expect(codes(handoffWith({}, bodyWith("Implement the partitioner and nothing else.")))).not.toContain("handoff-not-english");
  });
});

describe("FR-NODE-156 AC-2 — fenced code, inline code and blockquote content are excluded", () => {
  it.each(SCRIPTS)("accepts %s inside a fenced code block", (_label, sample) => {
    expect(codes(handoffWith({}, bodyWith(["Implement the partitioner.", "", "```text", sample, "```"].join("\n"))))).not.toContain("handoff-not-english");
  });

  it.each(SCRIPTS)("accepts %s inside an inline code span", (_label, sample) => {
    expect(codes(handoffWith({}, bodyWith(`Implement the partitioner, whose legacy label is \`${sample}\`.`)))).not.toContain("handoff-not-english");
  });

  it.each(SCRIPTS)("accepts %s inside blockquote content", (_label, sample) => {
    expect(codes(handoffWith({}, bodyWith(["Implement the partitioner.", "", `> ${sample}`].join("\n"))))).not.toContain("handoff-not-english");
  });
});

describe("FR-NODE-156 AC-3 — the two in-denominator front-matter fields", () => {
  it("raises the violation for Hangul in the escalation field", () => {
    const escalation = 'escalation: "Stop and write manifest_path with the matching status. 중단하고 보고하라."';
    expect(codes(handoffWith({ escalation }))).toContain("handoff-not-english");
  });

  it("raises the violation for Hangul in an acceptance row's untested reason", () => {
    const acceptance = [
      "acceptance:",
      `  - { ac_id: "AC-1", req_id: "FR-FLOW-071", test_id: "${TEST_PATH}::assigns every task to exactly one lane" }`,
      '  - { ac_id: "AC-2", req_id: "FR-FLOW-071", test_id: null,',
      '      untested_reason: "다음 웨이브가 만드는 산출물에 의존하므로 이번 레인에서는 테스트할 수 없다.",',
      '      untested_owner: "wave-3/lane-5" }'
    ].join("\n");
    expect(codes(handoffWith({ acceptance }))).toContain("handoff-not-english");
  });
});

describe("FR-NODE-156 AC-4 — every other front-matter field is outside the denominator", () => {
  it("does not raise the violation for Hangul in an identifier", () => {
    expect(codes(handoffWith({ lane: 'lane: "레인-3"' }))).not.toContain("handoff-not-english");
  });

  it("does not raise the violation for Hangul in a path", () => {
    const read_set = ["read_set:", `  - "${READ_A}"`, `  - "${READ_B}"`, '  - "src/core/한글/module.ts"'].join("\n");
    expect(codes(handoffWith({ read_set }))).not.toContain("handoff-not-english");
  });

  it("does not raise the violation for Hangul in an enumerated value", () => {
    const commit_policy = ["commit_policy:", '  granularity: "작업별"', '  pathspec: "write_set"', '  trailers: ["Orch-Run"]'].join("\n");
    expect(codes(handoffWith({ commit_policy }))).not.toContain("handoff-not-english");
  });

  it("does not raise the violation for Hangul in a command", () => {
    const verification_cmd = ["verification_cmd:", `  posix: "${VERIFICATION_CMD} # 검증"`, `  windows: "${VERIFICATION_CMD} # 검증"`].join("\n");
    expect(codes(handoffWith({ verification_cmd }))).not.toContain("handoff-not-english");
  });

  it("does not raise the violation for Hangul in a bootstrap entry", () => {
    const bootstrap = ["bootstrap:", "  - kind: assert", '    posix:   "npx vitest --version # 버전 확인"', '    windows: "npx vitest --version # 버전 확인"'].join("\n");
    expect(codes(handoffWith({ bootstrap }))).not.toContain("handoff-not-english");
  });

  it("does not raise the violation for Hangul in a forbidden-list entry", () => {
    const forbidden = ["forbidden:", '  - "Do not run git push."', '  - "요구사항 ID 를 직접 할당하지 말 것."'].join("\n");
    expect(codes(handoffWith({ forbidden }))).not.toContain("handoff-not-english");
  });

  it("keeps the heartbeat path outside the denominator too", () => {
    expect(HEARTBEAT_PATH).not.toContain(" ");
    expect(codes(handoffWith({ heartbeat_path: 'heartbeat_path: "kiwi/orchestrator/실행/w2-s2-l3.heartbeat"' }))).not.toContain("handoff-not-english");
  });
});

describe("FR-NODE-156 AC-5 — the scan is a script check and not a language check", () => {
  it("accepts a handoff body written in fluent Spanish", () => {
    const sections = defaultSections();
    sections.Objective = "Implementa la función pura que reparte las tareas del expediente en carriles de ejecución.";
    sections.Context = "El analizador del expediente y el detector de ciclos ya existen. Ninguno de los dos cambia aquí.";
    sections.Constraints = "La función es pura. No lee ningún archivo, no consulta el reloj y no abre ningún socket.";

    expect(codes(handoffWith({}, renderBody(sections)))).not.toContain("handoff-not-english");
  });
});
