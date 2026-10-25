import { describe, expect, it } from "vitest";

import { GATE_IDS } from "../../src/core/orchestrator/auto-gate.js";
import {
  ORCHESTRATOR_MIRROR,
  ORCHESTRATOR_VARIANTS,
  criticalGateRows,
  readVariant,
  section,
  stripFrontmatter,
  tableRows,
  verbSection
} from "./kiwi-orchestrator-variants.js";
import { NEGATION, RENDERINGS, flat, readRepoFile, sentenceWith, sentencesWith } from "./kiwi-renderings.js";

// @req FR-FLOW-200 — kiwi-orchestrator reproduces a bug input with kiwi-bug-repro before it routes or
// designs.
//
// Read where each rule lives: the Phase 1 overview in §3 (the order of steps), §5 Phase 1 intake (the
// bug judgement and what the reproduction is used for), §15 (the commit schedule), the §V entries a
// resumed session reads instead of §5, and the critical_gates table. Every orchestrator rendering is
// Korean; prose checks still carry the English spelling for the day one is not. kiwi-tdd, which AC-3
// makes adopt the reproduction test, is read in every rendering it ships in.

const FILES = [...ORCHESTRATOR_VARIANTS.map((variant) => variant.relPath), ORCHESTRATOR_MIRROR];
const GATES = ["bug-not-reproduced", "bug-not-a-bug", "bug-input-dirty-tree", "bug-test-unskippable", "bug-repro-test-unresolved"] as const;
const INTAKE_VERBS = ["intake-qna", "intake-document", "intake-issue"] as const;

function body(relPath: string): string {
  return stripFrontmatter(readVariant(relPath).replace(/\r\n/g, "\n"));
}

function intake(relPath: string): string {
  return flat(section(body(relPath), /^##\s*5\./));
}

function tddBody(rendering: string): string {
  return stripFrontmatter(readRepoFile(`${rendering}/kiwi-tdd/SKILL.md`).replace(/\r\n/g, "\n"));
}

describe("FR-FLOW-200 AC-1 — Phase 1.a also judges whether the input reports a bug", () => {
  it.each(FILES)("%s: §5 names the three signs of a bug", (relPath) => {
    const text = intake(relPath);
    expect(text).toMatch(/라벨|label/i);
    expect(text).toMatch(/증상|symptom/i);
    expect(text).toMatch(/기대 동작|expected behaviou?r/i);
    expect(text).toMatch(/실제 동작|actual behaviou?r/i);
    expect(text).toMatch(/사용자가[^.]{0,20}버그라고|user calls it a bug/i);
  });
});

describe("FR-FLOW-200 AC-2 — an ambiguous judgement goes to one subagent and is recorded", () => {
  it.each(FILES)("%s: §5 hands an ambiguous case to a subagent and records the verdict in 01.intake.md", (relPath) => {
    const text = intake(relPath);
    expect(text).toMatch(/애매|모호|ambiguous/i);
    expect(text).toMatch(/서브에이전트|subagent/i);
    expect(text).toContain("01.intake.md");
    expect(text).toMatch(/판정[^.]{0,40}(이유|근거)|verdict and (its )?reason/i);
  });
});

describe("FR-FLOW-200 AC-3 — kiwi-bug-repro runs before the investigators and its test drives the fix", () => {
  it.each(FILES)("%s: the Phase 1 overview runs kiwi-bug-repro after 1.a and before 1.b", (relPath) => {
    const flow = section(body(relPath), /^##\s*3\./);
    const a = flow.search(/^\s*1\.a\s/m);
    const repro = flow.indexOf("kiwi-bug-repro");
    const b = flow.search(/^\s*1\.b\s/m);
    expect(a, `${relPath}: 1.a`).toBeGreaterThanOrEqual(0);
    expect(repro, `${relPath}: kiwi-bug-repro after 1.a`).toBeGreaterThan(a);
    expect(b, `${relPath}: 1.b after kiwi-bug-repro`).toBeGreaterThan(repro);
  });

  it.each(FILES)("%s: §5 records the reproduction test and uses it on both routes", (relPath) => {
    const text = intake(relPath);
    expect(text).toContain("kiwi-bug-repro");
    expect(text).toMatch(/재현 테스트|reproduction test/i);
    expect(text).toContain("R-STEP");
    expect(text).toContain("R-ORCH");
    expect(text).toMatch(/실패하는 테스트|failing test|\bred\b/i);
  });

  it.each(FILES)("%s: §5 calls kiwi-bug-repro with --no-pipeline-emit", (relPath) => {
    expect(intake(relPath)).toMatch(/skill:\s*"kiwi-bug-repro",\s*args:\s*"[^"]*--no-pipeline-emit/);
  });

  it.each(FILES)("%s: §5 goes on to 1.b only after a reproduction with an automated test", (relPath) => {
    expect(sentenceWith(intake(relPath), /1\.b/, /자동 테스트|automated test/i, /때만|only/i)).toBeDefined();
  });

  it.each(FILES)("%s: on R-STEP kiwi-tdd adopts the reproduction test as the test of the step's acceptance line", (relPath) => {
    expect(sentenceWith(intake(relPath), /kiwi-tdd/, /acceptance 줄|acceptance line/i, /채택|adopt/i, /재현 테스트|reproduction test/i)).toBeDefined();
  });

  it.each(FILES)("%s: §15 commits the reproduction test with the intake artifacts at the end of Phase 1", (relPath) => {
    expect(sentenceWith(section(body(relPath), /^##\s*15\./), /Phase 1 끝|end of Phase 1/i, /재현 테스트|reproduction test/i)).toBeDefined();
  });

  it.each(FILES)("%s: §V.commit-wave-inputs does not commit the reproduction test again — Phase 1 already put it in every dispatch base", (relPath) => {
    expect(sentenceWith(flat(verbSection(body(relPath), "commit-wave-inputs")), /재현 테스트|reproduction test/i, NEGATION)).toBeDefined();
  });
});

describe("FR-FLOW-200 AC-3 — kiwi-tdd adopts a caller-supplied reproduction test after writing the acceptance line", () => {
  it.each(RENDERINGS)("%s: §0.4 states the adoption as an explicit exception to 'no test before the acceptance contract'", (rendering) => {
    const rule = tableRows(section(tddBody(rendering), /^##\s*0\./))
      .find((row) => row.cells[0] === "§0.4")
      ?.cells.join(" | ");
    expect(rule, `${rendering}: no §0.4 row`).toBeDefined();
    expect(sentenceWith(rule ?? "", /예외|exception/i, /재현 테스트|reproduction test/i, /acceptance 줄|acceptance line/i)).toBeDefined();
  });

  it.each(RENDERINGS)("%s: Phase 3 writes the line first, cites its AC on the existing test and re-confirms red instead of writing a new test", (rendering) => {
    const red = flat(section(tddBody(rendering), /^###\s*2\.4\b/));
    expect(sentenceWith(red, /재현 테스트|reproduction test/i, /acceptance 줄|acceptance line/i, /먼저|first/i)).toBeDefined();
    expect(sentenceWith(red, /AC-<n>/, /제목 줄|title line/i, /재현 테스트|reproduction test/i)).toBeDefined();
    expect(sentenceWith(red, /\bred\b/i, /다시 확인|again/i)).toBeDefined();
    expect(sentenceWith(red, /새 테스트를 쓰지 않|instead of writing a new test/i)).toBeDefined();
  });
});

describe("FR-FLOW-200 AC-4 — not reproduced, or not a bug, stops the run", () => {
  it.each(FILES)("%s: both stops are critical gates", (relPath) => {
    const gates = criticalGateRows(body(relPath)).map((row) => row.gateId);
    for (const gate of GATES) expect(gates, `${relPath}: ${gate}`).toContain(gate);
  });

  it("both gates are in the gate-id union the kernel closes over", () => {
    for (const gate of GATES) expect(GATE_IDS as readonly string[]).toContain(gate);
  });

  it.each(FILES)("%s: §5 says a not-a-bug verdict asks whether to continue as a requirement change", (relPath) => {
    expect(intake(relPath)).toMatch(/요구사항 변경|requirement change/i);
  });

  it.each(FILES)("%s: a reproduction without an automated test stops at bug-not-reproduced too", (relPath) => {
    expect(sentenceWith(intake(relPath), /자동 테스트 없이|without an automated test|reproduced-no-test/i, /bug-not-reproduced/)).toBeDefined();
    const row = criticalGateRows(body(relPath)).find((gate) => gate.gateId === "bug-not-reproduced");
    expect(row?.reason).toMatch(/자동 테스트|automated test/i);
  });
});

describe("FR-FLOW-200 AC-5 — input that is not a bug runs Phase 1 as before", () => {
  it.each(FILES)("%s: §5 skips kiwi-bug-repro for input that does not report a bug", (relPath) => {
    expect(intake(relPath)).toMatch(/버그가 아닌 입력[^.]{0,80}(그대로|부르지 않)|(input that does not report a bug|non-bug input)[^.]{0,80}(as before|without|unchanged)/i);
  });
});

describe("FR-FLOW-200 AC-6 — the bug steps live in the intake verbs a resumed run reads", () => {
  const cases = FILES.flatMap((relPath) => INTAKE_VERBS.map((verb) => [relPath, verb] as const));

  it.each(cases)("%s §V.%s: judges the bug and calls kiwi-bug-repro", (relPath, verb) => {
    const entry = flat(verbSection(body(relPath), verb));
    expect(entry, `${relPath}: §V.${verb} is missing`).not.toBe("");
    expect(sentenceWith(entry, /버그 (보고인지 )?판정|bug judgement/i)).toBeDefined();
    expect(sentenceWith(entry, /kiwi-bug-repro/, /--no-pipeline-emit/)).toBeDefined();
  });

  it.each(cases)("%s §V.%s: does not reproduce again when 01.intake.md already holds a reproduction", (relPath, verb) => {
    const entry = flat(verbSection(body(relPath), verb));
    expect(sentenceWith(entry, /01\.intake\.md/, /이미|already/i, /재현|reproduc/i, /다시 부르지 않|not .*again/i)).toBeDefined();
  });

  it.each(cases)("%s §V.%s: calls kiwi-bug-repro again with the user's answer to bug-not-reproduced", (relPath, verb) => {
    const entry = flat(verbSection(body(relPath), verb));
    expect(sentenceWith(entry, /bug-not-reproduced/, /답|answer/i, /다시 부른|again/i)).toBeDefined();
  });
});

const STOP = /멈추|멈춰|멈춘|\bstops?\b/i;

describe("FR-FLOW-200 — inverting or deleting a rule turns its check red", () => {
  it.each(FILES)("%s AC-3: 1.b follows only a reproduction WITH an automated test, and no sentence lets one without it through", (relPath) => {
    const text = intake(relPath);
    // The same sentence names the user's two ways on, so the rule and those paths cannot read as a contradiction.
    expect(sentenceWith(text, /1\.b/, /자동 테스트가 있는|with an automated test/i, /때만|only/i, /계속|continue/i)).toBeDefined();
    expect(sentencesWith(text, /1\.b/, /자동 테스트(가)? 없는|without an automated test/i, /때만|only/i)).toEqual([]);
  });

  it.each(FILES)("%s AC-6: an answer to the insufficient-input question also calls kiwi-bug-repro again", (relPath) => {
    expect(sentenceWith(intake(relPath), /input-insufficient/, /답|answer/i, /다시 부른|again/i)).toBeDefined();
  });

  it.each(FILES)("%s AC-4: every not-reproduced stop that names --auto holds under it and no committee decides it", (relPath) => {
    const text = intake(relPath);
    const stops = sentencesWith(text, /bug-not-reproduced/, /--auto/);
    expect(stops.length).toBeGreaterThan(0);
    for (const stop of stops) {
      expect(stop, `${relPath}: ${stop}`).toMatch(/에서도|as well/i);
      expect(stop, `${relPath}: ${stop}`).not.toMatch(/결정 위원회|committee/i);
    }
    expect(sentencesWith(text, /not-reproduced/, /결정 위원회|committee/i)).toEqual([]);
  });

  it.each(RENDERINGS)("%s AC-3: kiwi-tdd re-runs the adopted test and confirms red, with no sentence skipping that run", (rendering) => {
    const red = flat(section(tddBody(rendering), /^###\s*2\.4\b/));
    const again = sentencesWith(red, /\bred\b/i, /다시|again/i);
    expect(again.length).toBeGreaterThan(0);
    for (const sentence of again) expect(sentence, `${rendering}: ${sentence}`).not.toMatch(NEGATION);
  });

  it.each(RENDERINGS)("%s AC-3: the §0.4 exception adopts the test after the acceptance line is written, never before", (rendering) => {
    const rule = tableRows(section(tddBody(rendering), /^##\s*0\./)).find((row) => row.cells[0] === "§0.4")?.cells.join(" | ") ?? "";
    const exception = sentencesWith(rule, /재현 테스트|reproduction test/i, /채택|adopt/i);
    expect(exception.length).toBeGreaterThan(0);
    for (const sentence of exception) {
      expect(sentence, `${rendering}: ${sentence}`).toMatch(/먼저 쓴 뒤|after that line is written/i);
      expect(sentence, `${rendering}: ${sentence}`).not.toMatch(/쓰기 전에|before that line/i);
    }
  });

  it.each(RENDERINGS)("%s AC-3: the claim-first rule says the caller's reproduction test is not an artifact of the step", (rendering) => {
    const rule = tableRows(section(tddBody(rendering), /^##\s*0\./)).find((row) => row.cells[0] === "§0.2")?.cells.join(" | ") ?? "";
    expect(sentenceWith(rule, /재현 테스트|reproduction test/i, /claim/i, /산출물이 아니|not an artifact/i)).toBeDefined();
  });
});

describe("FR-FLOW-200 AC-3 — on R-ORCH the reproduction test is committed skipped and adopted by the wave that owns the bug", () => {
  const SKIP = /건너뛰기 표시|skip marker/i;

  it.each(FILES)("%s: §5 commits the test once, in Phase 1, and not again at 3.d", (relPath) => {
    const text = intake(relPath);
    expect(sentenceWith(text, /3\.d/, /다시 커밋하지 않|not commit(ted)? (it )?again/i)).toBeDefined();
    expect(sentencesWith(text, /3\.d/, /목록에 적는다|lists? it/i)).toEqual([]);
  });

  it.each(FILES)("%s: §5 commits it with a skip marker, so no other wave, worker, verification round or tool counts it as a failure", (relPath) => {
    const text = intake(relPath);
    expect(sentenceWith(text, SKIP, /Phase 1/, /커밋|commit/i)).toBeDefined();
    const counted = sentencesWith(text, /건너뛴 테스트|skipped test/i, /실패/);
    expect(counted.length, `${relPath}: the skipped test's effect`).toBeGreaterThan(0);
    for (const sentence of counted) {
      expect(sentence).toMatch(NEGATION);
      for (const reader of [/워커|worker/i, /loop P/, /stage 병합|stage-merge/i]) expect(sentence, `${relPath}: ${reader}`).toMatch(reader);
    }
    expect(text).not.toMatch(/intended_red/);
  });

  it.each(FILES)("%s: the owning wave carries the test in its write set, and its worker removes the marker, cites its AC, confirms red and turns it green", (relPath) => {
    const text = intake(relPath);
    expect(sentenceWith(text, /files\[\]/, /쓰기 집합|write set/i, /재현 테스트|테스트 파일|test file/i)).toBeDefined();
    expect(sentenceWith(text, /워커|worker/i, /표시를 걷|remove the (skip )?marker/i, /AC-<n>/, /\bred\b/i, /green/i)).toBeDefined();
    expect(sentenceWith(text, /새로 쓰지 않|instead of writing/i, /워커|worker/i)).toBeDefined();
  });

  it.each(FILES)("%s: a requirement whose reproduction test still carries the marker is not promoted", (relPath) => {
    expect(sentenceWith(intake(relPath), /표시가 남아|still carries/i, /승급하지 않|not promoted?/i)).toBeDefined();
  });

  it.each(RENDERINGS)("%s: the shared parallel-waves contract is not widened for it", (rendering) => {
    expect(readRepoFile(`${rendering}/_shared/kiwi/parallel-waves.md`)).not.toMatch(/intended_red/);
  });
});

describe("FR-FLOW-200 AC-4 — uncommitted changes in the run root stop a bug input before the reproduction", () => {
  it.each(FILES)("%s: §5.3 stops at bug-input-dirty-tree, under --auto too, before calling kiwi-bug-repro", (relPath) => {
    const text = intake(relPath);
    expect(sentenceWith(text, /커밋하지 않은 변경|uncommitted change/i, /bug-input-dirty-tree/, /부르지 않|not invoke/i, /--auto/, /에서도|as well/i)).toBeDefined();
    expect(sentenceWith(text, /docs\/research\/\{work\}/, /밖|outside/i)).toBeDefined();
  });

  it.each(FILES)("%s: no sentence of §5.3 hands a stop to the decision committee", (relPath) => {
    expect(sentencesWith(flat(section(body(relPath), /^###\s*5\.3\b/)), /결정 위원회|committee/i)).toEqual([]);
  });
});

describe("FR-FLOW-200 AC-4/AC-6 — a reproduction without a test, and continuing as a requirement change", () => {
  it.each(FILES)("%s: the reproduced-no-test stop offers to continue with the reproduction script as the evidence", (relPath) => {
    const text = intake(relPath);
    expect(sentenceWith(text, /재현 스크립트|reproduction script/i, /근거|evidence/i, /계속|continue/i)).toBeDefined();
    const row = criticalGateRows(body(relPath)).find((gate) => gate.gateId === "bug-not-reproduced");
    expect(row?.reason).toMatch(/재현 스크립트|reproduction script/i);
  });

  it.each(FILES)("%s: a decision to continue is written to 01.intake.md", (relPath) => {
    const text = intake(relPath);
    expect(sentenceWith(text, /요구사항 변경으로 계속|continue as a requirement change/i, /01\.intake\.md/, /결정|decision/i)).toBeDefined();
    expect(sentenceWith(text, /재현 스크립트|reproduction script/i, /01\.intake\.md/, /결정|decision/i)).toBeDefined();
  });

  const cases = FILES.flatMap((relPath) => INTAKE_VERBS.map((verb) => [relPath, verb] as const));
  it.each(cases)("%s §V.%s: a recorded decision to continue skips the judgement and the call", (relPath, verb) => {
    const entry = flat(verbSection(body(relPath), verb));
    expect(sentenceWith(entry, /01\.intake\.md/, /재현 스크립트|reproduction script/i, /요구사항 변경|requirement change/i, /다시 부르지 않|not .*again/i)).toBeDefined();
    expect(sentenceWith(entry, /버그 판정|bug judgement/i, /하지 않|not/i, /이미|already/i)).toBeDefined();
  });

  it.each(FILES)("%s: STOP is kept on the no-test outcome as well", (relPath) => {
    expect(sentenceWith(intake(relPath), /reproduced-no-test|자동 테스트 없이 재현됨/, STOP, /--auto/)).toBeDefined();
  });
});

describe("FR-FLOW-200 AC-3/AC-4 — the skipped reproduction test cannot be lost on the wave route", () => {
  it.each(FILES)("%s: a tool with no skip marker stops at bug-test-unskippable instead of changing the route", (relPath) => {
    const text = intake(relPath);
    expect(sentenceWith(text, /건너뛰기 표시가 없으면/, /bug-test-unskippable/, STOP, /--auto/, /에서도/)).toBeDefined();
    expect(text).not.toMatch(/R-ORCH 로 보내지 않는다/);
  });

  it.each(FILES)("%s: the test sits in exactly one wave's files[], and the run does not end complete while it is skipped or red", (relPath) => {
    const text = intake(relPath);
    expect(sentenceWith(text, /정확히 한 wave/, /files\[\]/, /bug-repro-test-unresolved/)).toBeDefined();
    expect(sentenceWith(text, /Phase 4/, /표시가 남아/, /green/, /bug-repro-test-unresolved/, /에서도/)).toBeDefined();
  });

  it.each(FILES)("%s: only the reproduction case is skipped, and its citation of an existing requirement is taken off first", (relPath) => {
    const text = intake(relPath);
    expect(sentenceWith(text, /재현 케이스 하나에만/, /파일|묶음/)).toBeDefined();
    expect(sentenceWith(text, /기존 요구 인용/, /걷어/, /01\.intake\.md/)).toBeDefined();
  });

  it.each(FILES)("%s: the dirty-tree check counts tracked files only and leaves out what kiwi-bug-repro wrote for this run", (relPath) => {
    const dirty = sentenceWith(intake(relPath), /커밋하지 않은 변경/, /bug-input-dirty-tree/) ?? "";
    expect(dirty).toMatch(/추적되는 파일/);
    expect(dirty).toMatch(/kiwi-bug-repro.{0,10}(가 )?남긴/);
  });

  it.each(FILES)("%s: every sentence of §5.3 that names --auto keeps its stop", (relPath) => {
    const autos = sentencesWith(flat(section(body(relPath), /^###\s*5\.3\b/)), /--auto/).filter((sentence) => !/\[--auto\]/.test(sentence));
    expect(autos.length).toBeGreaterThan(0);
    for (const sentence of autos) expect(sentence, `${relPath}: ${sentence}`).toMatch(/에서도/);
  });
});

describe("FR-FLOW-200 AC-3 — kiwi-coder adopts the reproduction test a requirement names", () => {
  it.each(RENDERINGS)("%s: a §0.20 row makes the adoption explicit and not a weakening", (rendering) => {
    const coder = stripFrontmatter(readRepoFile(`${rendering}/kiwi-coder/SKILL.md`).replace(/\r\n/g, "\n"));
    const row = tableRows(section(coder, /^##\s*0\./)).find((candidate) => candidate.cells[0] === "§0.20.5")?.cells.join(" | ") ?? "";
    expect(row, `${rendering}: no §0.20.5`).not.toBe("");
    expect(sentenceWith(row, /Implementation Notes/, /재현 테스트|reproduction test/i, /채택|adopt/i)).toBeDefined();
    expect(sentenceWith(row, /건너뛰기 표시|skip marker/i, /AC-<n>/, /\bred\b/i)).toBeDefined();
    expect(sentenceWith(row, /약화|weaken/i, NEGATION)).toBeDefined();
  });
});
