import { describe, expect, it } from "vitest";

import { section, tableRows } from "./kiwi-orchestrator-variants.js";
import { RENDERINGS, flat, scanUnits, skillFiles, skillSection } from "./kiwi-renderings.js";

// @req FR-FLOW-194 — kiwi-pm and kiwi-coder implement a requirement-ID set by default, and an SDS only
// when the user gives one (`--sds <path>`, alias `SDS_PATH=`). Supersedes FR-FLOW-185, whose SDS-path
// assertions are kept, re-scoped under the opt-in, in sds-execution-unit.fr-flow-185 (AC-9).
//
// Both skills are Korean in every rendering. Each assertion is scoped to the section or unit that
// states the rule; the `.agents` mirror goes red until it is regenerated.

const PM = "kiwi-pm";
const CODER = "kiwi-coder";

/** Words that turn a SHALL into a MAY. */
const HEDGE = /수 있다|해도 된다|권장|바람직|가능하면|되도록|경우에 따라|가급적/;

function whole(rendering: string, skill: string): string {
  return skillFiles(rendering, skill)
    .map((doc) => doc.text)
    .join("\n\n");
}

function unitWith(text: string, re: RegExp): string {
  return scanUnits(text).find((unit) => re.test(unit.text))?.text ?? "";
}

function row(rendering: string, skill: string, key: string): string {
  return (
    tableRows(skillSection(rendering, skill, /^##\s*0\.\s/))
      .find((entry) => entry.cells[0] === key)
      ?.cells.join(" | ") ?? ""
  );
}

describe("FR-FLOW-194 AC-1 — kiwi-pm takes a requirement-ID set, confirmed at a gate when not given", () => {
  it.each(RENDERINGS)("%s: §1.1 names --req-filter as the default input and --sds <path> as the opt-in", (rendering) => {
    const input = flat(skillSection(rendering, PM, /^###\s*1\.1\s/));
    expect(input, `${rendering}: kiwi-pm §1.1 is missing`).not.toBe(" ");
    expect(input).toContain("`--req-filter <REQ-ID,...>`");
    expect(input).toMatch(/`--sds <path>` \(별칭 `SDS_PATH=<path>`\)/);
  });

  it.each(RENDERINGS)("%s: without --req-filter the open work candidates are printed and confirmed at a gate (the committee under --auto)", (rendering) => {
    const rule = unitWith(skillSection(rendering, PM, /^###\s*1\.1\s/), /`--req-filter <REQ-ID,\.\.\.>`/);
    expect(rule).toMatch(/열린 작업 후보/);
    expect(rule).toMatch(/kiwi-coder 를 띄우기 전에 사용자 게이트에서 확인/);
    expect(rule).toMatch(/`--auto` 면 결정 위원회가 정한다/);
    expect(rule).toMatch(/`pm-state\.json` 의 `req_ids`/);
    expect(rule, `${rendering}: a missing SDS still halts the run`).toMatch(/SDS 가 없다는 이유로 멈추지 않는다/);
    expect(HEDGE.test(rule)).toBe(false);
  });

  it.each(RENDERINGS)("%s: the Stability gate leaves draft/deprecated out and halts only when none is left", (rendering) => {
    const gate = flat(skillSection(rendering, PM, /^###\s*4\.1\s/));
    expect(gate).toMatch(/요구 집합에서 빼고 보고한다/);
    expect(gate).toMatch(/남은 요구가 없으면 HALT/);
  });
});

/** The open-SDS report rule: report the path, never read, check or implement from it. */
const REPORT_ONLY = /열린\(`agreed`, `closed` 아님\) SDS[^]*`@req`[^]*경로를 정보로 보고만 하고, 읽지도 검사하지도 그것으로 구현하지도 않는다/;

describe("FR-FLOW-194 AC-2 — an open SDS naming a requirement of the set is reported, never used, in every mode", () => {
  for (const skill of [PM, CODER]) {
    it.each(RENDERINGS)(`%s/${skill}: the report-only rule holds under --auto and in worker mode`, (rendering) => {
      const rule = unitWith(whole(rendering, skill), REPORT_ONLY);
      expect(rule, `${rendering}/${skill}: no report-only rule for an open SDS`).not.toBe("");
      expect(rule).toMatch(/`--auto` 와 워커 모드에서도 같다/);
      expect(HEDGE.test(rule)).toBe(false);
    });
  }
});

describe("FR-FLOW-194 AC-3 — one invocation is one kiwi-coder run with req_ids, base_sha and run_id recorded", () => {
  it.each(RENDERINGS)("%s: §0.7 declares the unit for both inputs", (rendering) => {
    const cell = row(rendering, PM, "§0.7");
    expect(cell).toMatch(/호출 하나 = kiwi-coder 실행 하나/);
    expect(cell).toMatch(/요구 ID 집합 하나/);
  });

  it.each(RENDERINGS)("%s: §0.14 derives run_id, resumes an unfinished session and suffixes a done one", (rendering) => {
    const cell = row(rendering, PM, "§0.14");
    expect(cell).toContain("`--run-id <id>`");
    expect(cell).toMatch(/`<target>-<정렬한 REQ ID 의 sha256 앞 8 hex>`/);
    expect(cell).toMatch(/끝나지 않았으면 이어서 돌고/);
    expect(cell).toMatch(/`<run_id>-2`, `-3`/);
    expect(cell).toMatch(/`--sds` 면 `run_id` = sds-id/);
    expect(cell).toMatch(/SDS 없는 실행에는 SDS sha pin 도 `sha-mismatch-on-resume` 의 SDS 경우도 없다/);
  });

  it.each(RENDERINGS)("%s: pm-state.json records req_ids, base_sha and run_id", (rendering) => {
    const schema = skillSection(rendering, PM, /^###\s*2\.2\s/);
    for (const field of ['"run_id"', '"req_ids"', '"base_sha"']) expect(schema, `${rendering}: pm-state lost ${field}`).toContain(field);
  });
});

describe("FR-FLOW-194 AC-4 — kiwi-coder writes failing tests first against every AC of the set", () => {
  it.each(RENDERINGS)("%s: the test denominator is every AC of every requirement in the set", (rendering) => {
    const authoring = flat(skillSection(rendering, CODER, /^###\s*4\.1\s/));
    expect(authoring).toMatch(/요구 집합의 모든 요구의 SRS AC 가 분모다/);
    expect(authoring).toMatch(/get_requirement/);
    expect(authoring).toContain("`<REQ-ID> AC-<n>`");
  });

  it.each(RENDERINGS)("%s: red comes before implementation", (rendering) => {
    const flow = skillSection(rendering, CODER, /^##\s*2\.\s/);
    expect(flow.indexOf("red")).toBeGreaterThan(-1);
    expect(flow.indexOf("red")).toBeLessThan(flow.indexOf("Phase 2"));
  });
});

/** The text of one step of kiwi-coder §5.1's tree, from its label up to the next step label. */
function step(rendering: string, label: RegExp, next: RegExp): string {
  const loop = skillSection(rendering, CODER, /^###\s*5\.1\s/);
  const from = loop.search(label);
  if (from < 0) return "";
  const rest = loop.slice(from + 1);
  const to = rest.search(next);
  return flat(to < 0 ? loop.slice(from) : loop.slice(from, from + 1 + to));
}

describe("FR-FLOW-194 AC-5 — preservation and the caller check run in every run; the SDS-code gate only under --sds", () => {
  it.each(RENDERINGS)("%s: the preservation check runs with or without an SDS and lists the four detections", (rendering) => {
    const preserve = step(rendering, /\(d\) 보존 검사/, /\(d′\)|\(e\)/);
    expect(preserve, `${rendering}: §5.1 has no (d) preservation step`).not.toBe("");
    expect(preserve).toMatch(/SDS 유무와 무관하게 모든 실행에서 돈다/);
    for (const detection of ["기존 테스트 파일 삭제", "기존 테스트 케이스 제거", "기존 단언 약화", "기존 파일의 삭제·이동"]) {
      expect(preserve, `${rendering}: the preservation check lost "${detection}"`).toContain(detection);
    }
  });

  it.each(RENDERINGS)("%s: the SDS-code match gate is the --sds step", (rendering) => {
    const gate = step(rendering, /\(d′\) SDS-코드 일치 게이트/, /\(e\)/);
    expect(gate, `${rendering}: §5.1 has no (d′) SDS-code gate`).not.toBe("");
    expect(gate.slice(0, 80), `${rendering}: the SDS-code gate is not conditioned on --sds`).toMatch(/`--sds` 일 때만/);
  });

  it.each(RENDERINGS)("%s: the formal check carries the caller check over every newly defined symbol", (rendering) => {
    const formal = step(rendering, /\(e\) 정형 검사/, /\(f\)/);
    const caller = /호출자 검사[^]*?finding/.exec(formal)?.[0] ?? "";
    expect(caller, `${rendering}: the formal check has no caller-check item`).not.toBe("");
    for (const part of ["새로 정의한 함수·클래스·export 심볼", "정의와 import 밖의 비-테스트 코드", "의도된 진입점", "공개 API", "CLI 명령", "MCP 도구", "테스트 헬퍼", "개선 루프"]) {
      expect(caller, `${rendering}: the caller check lost "${part}"`).toContain(part);
    }
    expect(caller).toMatch(/모든 실행/);
  });

  it.each(RENDERINGS)("%s: a standalone run without an SDS has no write-set bound and reports every changed path", (rendering) => {
    const rule = unitWith(whole(rendering, CODER), /쓰기 집합 경계가 없다/);
    expect(rule).toMatch(/바꾼 경로를 모두 보고서에 적/);
    expect(rule).toMatch(/kiwi-review-fix-loop/);
  });
});

describe("FR-FLOW-194 AC-6 — --commit-lane-work without an SDS stages only the paths the run changed", () => {
  it.each(RENDERINGS)("%s: §1.5 states it and leaves containment to the host at PW-8", (rendering) => {
    const lane = flat(skillSection(rendering, PM, /^####\s*`--commit-lane-work`/));
    expect(lane).toMatch(/kiwi-coder 가 보고한 변경 경로와 그 실행이 쓴 테스트만 stage 한다/);
    expect(lane).toMatch(/작업 트리 전체를 stage 하지 않는다/);
    expect(lane).toMatch(/PW-8/);
    expect(lane).toMatch(/`--sds` 면 그 SDS 의 쓰기 집합/);
  });
});

describe("FR-FLOW-194 AC-7 — T-final without an SDS promotes the requirements coverage --tests clears", () => {
  it.each(RENDERINGS)("%s: §6.2 names the coverage check, the req-summary kind and the report of the rest", (rendering) => {
    const final = flat(skillSection(rendering, PM, /^###\s*6\.2\s/));
    expect(final).toMatch(/speckiwi coverage --tests --ids <(그 요구|it)>/);
    expect(final).toMatch(/인용한 테스트가 통과한/);
    expect(final).toContain("req-summary");
    expect(final).toMatch(/나머지는 gap 과 함께 보고한다/);
    expect(final).toContain("--no-final");
  });
});

describe("FR-FLOW-194 AC-8 — without an SDS there is no close-out, and a standalone run always hands off with the set", () => {
  it.each(RENDERINGS)("%s: §6.4's default hand-off calls the review with --req-filter and no kiwi-sds", (rendering) => {
    const handoff = section(skillSection(rendering, PM, /^###\s*6\.4\s/), /^###\s*6\.4\s/);
    const head = handoff.split(/^####\s/m)[0] ?? "";
    expect(head).toMatch(/Skill\(skill="kiwi-review-fix-loop",[^)]*--req-filter|Use \$kiwi-review-fix-loop with --req-filter/);
    expect(/skill="kiwi-sds"|Use \$kiwi-sds with/.test(head), `${rendering}: the default hand-off still calls kiwi-sds`).toBe(false);
    expect(flat(head)).toMatch(/SDS 없는 실행은 `kiwi-sds --close` 를 부르지 않는다/);
  });

  it.each(RENDERINGS)("%s: §10 hints kiwi-review-fix-loop for a run without an SDS", (rendering) => {
    const emit = skillSection(rendering, PM, /^##\s*10\.\s/);
    const hint = emit.split("\n").find((line) => /`next_hint`/.test(line)) ?? "";
    expect(hint).toMatch(/SDS 없는 실행은 `"kiwi-review-fix-loop"`/);
  });

  it.each(RENDERINGS)("%s: kiwi-coder's standalone hand-off calls no kiwi-sds without an SDS", (rendering) => {
    const handoff = flat(skillSection(rendering, CODER, /^###\s*8\.4\s/));
    expect(handoff).toMatch(/SDS 없는 실행은 `kiwi-sds --close` 를 부르지 않는다/);
  });

  it.each(RENDERINGS)("%s: kiwi-coder's standalone run without an SDS always hands off — no later or skip choice", (rendering) => {
    const section = skillSection(rendering, CODER, /^###\s*8\.4\s/);
    const rule = section.split("\n").find((line) => line.trimStart().startsWith("SDS 없는 실행은")) ?? "";
    expect(rule).toMatch(/3지선다 없이 끝에서 \*\*항상\*\* `kiwi-review-fix-loop` 로 넘긴다/);
    // Any other line offering the 3-way choice belongs to the --sds run and comes after the rule.
    for (const ask of section.split("\n").filter((line) => line !== rule && line.includes("3지선다"))) {
      expect(ask, `${rendering}: the 3-way choice is not scoped to --sds runs`).toMatch(/`--sds` 실행/);
      expect(section.indexOf(rule), `${rendering}: the no-SDS rule must precede the --sds choice`).toBeLessThan(section.indexOf(ask));
    }
  });
});

describe("FR-FLOW-194 — the default path is presented as the requirement-ID set, not as an SDS", () => {
  it.each(RENDERINGS)("%s: kiwi-pm's description names SDS steps only under --sds", (rendering) => {
    const text = skillFiles(rendering, PM)[0]?.text.replace(/\r\n/g, "\n") ?? "";
    const description = /^description:\s*(.*)$/m.exec(text)?.[1] ?? "";
    expect(description, `${rendering}: kiwi-pm has no description`).not.toBe("");
    expect(description).toContain("--req-filter");
    // An SDS step (the sds check, the SDS @req promotion, the sds-summary entry) is named only inside a
    // clause that conditions it on --sds; the clause is the text since the last comma, period or dash.
    for (const match of description.matchAll(/sds check|SDS @req|sds-summary|SDS check/g)) {
      const clause = description.slice(0, match.index).split(/[,.—;]/).at(-1) ?? "";
      expect(clause, `${rendering}: "${match[0]}" is presented as the default`).toMatch(/--sds/);
    }
  });

  it.each(RENDERINGS)("%s: kiwi-coder §6.2 and §8.2 offer SDS steps only under --sds", (rendering) => {
    for (const heading of [/^###\s*6\.2\s/, /^###\s*8\.2\s/]) {
      const body = skillSection(rendering, CODER, heading);
      expect(body, `${rendering}: kiwi-coder ${heading} is missing`).not.toBe("");
      for (const line of body.split("\n").filter((l) => /SDS|kiwi-sds/.test(l))) {
        expect(line, `${rendering}: an SDS step without --sds in ${heading}`).toMatch(/--sds/);
      }
    }
    const rework = skillSection(rendering, CODER, /^###\s*8\.2\s/).split("\n").find((l) => l.includes("REWORK")) ?? "";
    expect(rework, `${rendering}: the default run's REWORK option names the requirement equivalent`).toMatch(/요구 집합 실행이면[^)]*kiwi-srs`/);
  });
});
