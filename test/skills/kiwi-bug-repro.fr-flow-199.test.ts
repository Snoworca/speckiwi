import { describe, expect, it } from "vitest";

import { EXPECTED_KIWI_SKILLS } from "../../src/doctor/package-doctor.js";
import { criticalGateRows, section, stripFrontmatter, tableRows } from "./kiwi-orchestrator-variants.js";
import { EXCEPTION, NEGATION, RENDERINGS, flat, proseSentences, readRepoFile, sentenceWith, sentencesWith } from "./kiwi-renderings.js";

// @req FR-FLOW-199 — kiwi-bug-repro reproduces a reported bug from the smallest scope outward before
// anything is fixed.
//
// The body is read by its numbered sections, which are language-neutral: §0 rules and the
// critical_gates table, §1 input, §2 static analysis, §3 staged reproduction, §4 outcomes, §5 report.
// claude is Korean; codex, etc and the `.agents` mirror are English, so each prose check carries both
// spellings. The mirror rows stay red until `speckiwi skills mirror --write` regenerates it.
//
// A rule is asserted in the sentence that states it, with its condition and its polarity
// (`sentenceWith`): checked across a whole section, a rule can be deleted or inverted while the
// vocabulary it used survives elsewhere, and the check stays green.

const SKILL = "kiwi-bug-repro";

function skillPath(rendering: string): string {
  return `${rendering}/${SKILL}/SKILL.md`;
}

function body(rendering: string): string {
  return stripFrontmatter(readRepoFile(skillPath(rendering)).replace(/\r\n/g, "\n"));
}

function part(rendering: string, heading: RegExp): string {
  return flat(section(body(rendering), heading));
}

/** The §0 rule rows, cells joined — not the critical-gate rows that may share the section. */
function ruleRows(rendering: string): string[] {
  return tableRows(section(body(rendering), /^##\s*0\./))
    .filter((row) => /^§0\.\d+$/.test(row.cells[0] ?? ""))
    .map((row) => row.cells.join(" | "));
}

/** A sentence that mentions guessing is allowed only as the prohibition of it. */
function unnegatedGuesses(text: string): string[] {
  return proseSentences(text).filter((sentence) => /짐작|추측|guess/i.test(sentence) && !NEGATION.test(sentence));
}

const STOP = /멈추|멈춰|멈춘|\bstops?\b/i;
const ASK = /묻|\bask/i;
/** What keeps a stop a stop under `--auto`. */
const ALSO = /에서도|라도|as well|\btoo\b|\balso\b/i;

describe("FR-FLOW-199 AC-1 — kiwi-bug-repro ships in every rendering and in the package doctor's list", () => {
  it.each(RENDERINGS)("%s carries kiwi-bug-repro/SKILL.md named kiwi-bug-repro", (rendering) => {
    const text = readRepoFile(skillPath(rendering)).replace(/\r\n/g, "\n");
    expect(text, `${skillPath(rendering)} is missing`).not.toBe("");
    expect(/^---\s*\nname:\s*kiwi-bug-repro\s*\n/.test(text), `${skillPath(rendering)}: frontmatter name`).toBe(true);
  });

  it("codex carries the agents/openai.yaml UI metadata naming $kiwi-bug-repro", () => {
    const yaml = readRepoFile("skills/codex/kiwi-bug-repro/agents/openai.yaml");
    expect(yaml).toContain("display_name:");
    expect(yaml).toContain("$kiwi-bug-repro");
  });

  it("EXPECTED_KIWI_SKILLS lists kiwi-bug-repro", () => {
    expect(EXPECTED_KIWI_SKILLS).toContain(SKILL);
  });
});

describe("FR-FLOW-199 AC-2 — the issue is read as the user gives it, and no tracker or tool is named", () => {
  it.each(RENDERINGS)("%s: §1 reads the issue or description the user provides", (rendering) => {
    const input = part(rendering, /^##\s*1\./);
    expect(input).toMatch(/사용자가 (준|제공한) 이슈|issue the user (gave|provided|provides)/i);
    for (const field of [/증상|symptom/i, /기대 동작|expected behaviou?r/i, /실제 동작|actual behaviou?r/i, /재현 절차|reported steps|steps to reproduce/i]) {
      expect(input, `${rendering} §1 does not record ${field}`).toMatch(field);
    }
  });

  it.each(RENDERINGS)("%s: names no tracker, command or tool for reading the issue", (rendering) => {
    expect(body(rendering)).not.toMatch(/\bgh\s+(issue|api)\b|\bjira\b|\bjql\b|\bcurl\b|mcp__|issuehub/i);
  });

  it.each(RENDERINGS)("%s: an unreadable or insufficient input is a critical gate located in §1", (rendering) => {
    const row = criticalGateRows(body(rendering)).find((gate) => gate.gateId === "repro-input-insufficient");
    expect(row, `${rendering}: no repro-input-insufficient gate`).toBeDefined();
    expect(row?.location).toMatch(/§1/);
  });

  it.each(RENDERINGS)("%s: §1 stops and asks — under --auto too — when the issue cannot be read or states neither behaviour", (rendering) => {
    const input = part(rendering, /^##\s*1\./);
    expect(sentenceWith(input, /읽을 수 없|cannot be read/i, STOP, ASK, /--auto/), `${rendering}: unreadable issue`).toBeDefined();
    expect(sentenceWith(input, /기대 동작|expected/i, /실제 동작|actual/i, STOP, ASK, /--auto/), `${rendering}: neither behaviour stated`).toBeDefined();
    expect(unnegatedGuesses(input), `${rendering}: §1 guesses`).toEqual([]);
  });
});

describe("FR-FLOW-199 AC-3 — static analysis comes first and orders the causes", () => {
  it.each(RENDERINGS)("%s: §2 infers causes before anything runs, with file:line evidence and a confidence", (rendering) => {
    const analysis = part(rendering, /^##\s*2\./);
    expect(analysis).toMatch(/정적 분석|static analysis/i);
    expect(analysis).toMatch(/실행하기 전|before (running|anything runs|it runs)/i);
    expect(analysis).toContain("file:line");
    expect(analysis).toMatch(/확신도|confidence/i);
    expect(analysis).toMatch(/순서|order/i);
  });

  it.each(RENDERINGS)("%s: §2 goes straight to stage 3 when no candidate has evidence", (rendering) => {
    const analysis = part(rendering, /^##\s*2\./);
    expect(sentenceWith(analysis, /후보가 (하나도 )?없|no candidate/i, /3단계|stage 3/i, /바로|directly/i)).toBeDefined();
  });
});

describe("FR-FLOW-199 AC-4 — three stages, widening only on failure, and never a fourth", () => {
  it.each(RENDERINGS)("%s: §3 defines stage 1, 2 and 3 in that order", (rendering) => {
    const stages = part(rendering, /^##\s*3\./);
    const at = (n: number) => stages.search(new RegExp(`${n}단계|stage ${n}`, "i"));
    expect(at(1), `${rendering}: stage 1`).toBeGreaterThanOrEqual(0);
    expect(at(2), `${rendering}: stage 2`).toBeGreaterThan(at(1));
    expect(at(3), `${rendering}: stage 3`).toBeGreaterThan(at(2));
  });

  it.each(RENDERINGS)("%s: stage 2 takes at least two more causes and stage 3 builds and runs the product", (rendering) => {
    const stages = part(rendering, /^##\s*3\./);
    expect(stages).toMatch(/(원인|가설)[^.|]{0,40}(2|두)\s*개 이상|at least two (further |more )?(causes|hypotheses)/i);
    expect(stages).toMatch(/빌드|build/i);
    expect(stages).toMatch(/시도 상한|attempt cap/i);
  });

  it.each(RENDERINGS)("%s: says there is no stage after stage 3", (rendering) => {
    expect(part(rendering, /^##\s*3\./)).toMatch(/3단계를 넘(지 않|어가지 않)|(never|not) (go|goes) (past|beyond) stage 3|no stage 4/i);
  });

  it.each(RENDERINGS)("%s: one sentence moves to the next stage only when the current one has not reproduced within its cap", (rendering) => {
    const stages = part(rendering, /^##\s*3\./);
    expect(sentenceWith(stages, /다음 단계|next stage/i, /재현하지 못|has not reproduced/i, /때만|only when/i, /시도 상한|attempt cap/i)).toBeDefined();
  });

  it.each(RENDERINGS)("%s: each stage states its attempt cap as a number between 1 and 10", (rendering) => {
    for (const sub of [/^###\s*3\.1\b/, /^###\s*3\.2\b/, /^###\s*3\.3\b/]) {
      const text = part(rendering, sub);
      const caps = [...text.matchAll(/(?:시도 상한|attempt cap)\**\s+(\d+)/gi)].map((match) => Number(match[1]));
      expect(caps.length, `${rendering} ${sub}: no numeric cap`).toBeGreaterThan(0);
      for (const cap of caps) expect(cap >= 1 && cap <= 10, `${rendering} ${sub}: cap ${cap}`).toBe(true);
    }
  });

  it.each(RENDERINGS)("%s: the three stages carry their scopes — smallest test, module or integration, product end to end", (rendering) => {
    const one = part(rendering, /^###\s*3\.1\b/);
    expect(one).toMatch(/가장 작은 범위|smallest scope/i);
    expect(one).toMatch(/자동 테스트|automated test/i);
    const two = part(rendering, /^###\s*3\.2\b/);
    expect(two).toMatch(/모듈|module/i);
    expect(two).toMatch(/통합|integration/i);
    const three = part(rendering, /^###\s*3\.3\b/);
    expect(three).toMatch(/빌드|build/i);
    expect(three).toMatch(/처음부터 끝까지|end to end/i);
    expect(three).toMatch(/보고된 입력|reported input/i);
  });
});

describe("FR-FLOW-199 AC-5 — a reproduction ends as a failing automated test", () => {
  it.each(RENDERINGS)("%s: §4 records the red output of a failing test that matches the symptom", (rendering) => {
    const outcomes = part(rendering, /^##\s*4\./);
    expect(outcomes).toMatch(/실패하는 (자동 )?테스트|failing (automated )?test/i);
    expect(outcomes).toMatch(/\bred\b/i);
    expect(sentenceWith(outcomes, /red 출력|red output/i, /report\.md/)).toBeDefined();
  });

  it.each(RENDERINGS)("%s: a build-only reproduction becomes a test, or a script with the observation", (rendering) => {
    const outcomes = part(rendering, /^##\s*4\./);
    expect(outcomes).toMatch(/재현 스크립트|reproduction script/i);
    expect(outcomes).toMatch(/관찰|observation/i);
  });

  it.each(RENDERINGS)("%s: 'reproduced without an automated test' is its own outcome that no caller treats as a failing test", (rendering) => {
    const outcomes = part(rendering, /^##\s*4\./);
    expect(sentenceWith(outcomes, /`reproduced-no-test`/, /호출자|caller/i, /실패하는 테스트|failing test/i, NEGATION)).toBeDefined();
  });

  it.each(RENDERINGS)("%s: §5 returns one of the named outcomes", (rendering) => {
    const report = part(rendering, /^##\s*5\./);
    for (const outcome of ["reproduced", "reproduced-no-test", "not-a-bug", "not-reproduced", "input-insufficient", "analysis-only"]) {
      expect(report, `${rendering}: ${outcome}`).toContain(`\`${outcome}\``);
    }
  });
});

describe("FR-FLOW-199 AC-6 — not reproduced after stage 3 stops and asks, also under --auto", () => {
  it.each(RENDERINGS)("%s: declares repro-not-reproduced as a critical gate", (rendering) => {
    const gates = criticalGateRows(body(rendering)).map((row) => row.gateId);
    expect(gates).toContain("repro-not-reproduced");
  });

  it.each(RENDERINGS)("%s: §4 asks the user for environment, version, input data and steps, listing what was tried", (rendering) => {
    const outcomes = part(rendering, /^##\s*4\./);
    for (const need of [/환경|environment/i, /버전|version/i, /입력 데이터|input data/i, /재현 절차의 빠진 단계|missing steps/i]) expect(outcomes).toMatch(need);
    expect(outcomes).toMatch(/시도한|tried/i);
  });

  it.each(RENDERINGS)("%s: §4.3 stops and asks under --auto as well, and never guesses", (rendering) => {
    const notReproduced = part(rendering, /^###\s*4\.3\b/);
    expect(sentenceWith(notReproduced, STOP, ASK, /--auto/)).toBeDefined();
    expect(unnegatedGuesses(notReproduced), `${rendering}: §4.3 guesses`).toEqual([]);
  });

  it.each(RENDERINGS)("%s: §4.3 names one owner for the loop after the answer — the caller re-invokes, a standalone run resumes itself", (rendering) => {
    const notReproduced = part(rendering, /^###\s*4\.3\b/);
    expect(sentenceWith(notReproduced, /호출자|caller/i, /다시 부른|again/i)).toBeDefined();
    expect(sentenceWith(notReproduced, /단독|standalone/i, /§2/)).toBeDefined();
  });
});

describe("FR-FLOW-199 AC-7 — specified behaviour is not a bug and goes to kiwi-srs", () => {
  it.each(RENDERINGS)("%s: §4 reports 'not a bug' and points to kiwi-srs", (rendering) => {
    const outcomes = part(rendering, /^##\s*4\./);
    expect(outcomes).toMatch(/버그가 아니|not a bug/i);
    expect(outcomes).toContain("kiwi-srs");
  });

  it.each(RENDERINGS)("%s: §4.2 hands an unclear case to one subagent reading the SRS, the contract and the report alone, and records verdict and reason", (rendering) => {
    const notABug = part(rendering, /^###\s*4\.2\b/);
    expect(sentenceWith(notABug, /불분명|unclear/i, /서브에이전트 1\s*개|one subagent/i, /SRS/, /계약|contract/i, /보고서|report/i, /만|alone/i)).toBeDefined();
    expect(sentenceWith(notABug, /판정과 그 이유|verdict and (its )?reason/i, /기록|record/i)).toBeDefined();
  });

  it.each(RENDERINGS)("%s: §4.2 removes the reproduction test by the §0.1 rule rather than keeping it", (rendering) => {
    const notABug = part(rendering, /^###\s*4\.2\b/);
    expect(sentenceWith(notABug, /재현 테스트|reproduction test/i, /지우|delete/i, /되돌|restore/i)).toBeDefined();
    expect(notABug).not.toMatch(/keep the (test )?file|파일을 (그대로 )?남긴다/i);
  });
});

describe("FR-FLOW-199 AC-8 — isolated runs, no real data, no product code change, no lost work", () => {
  it.each(RENDERINGS)("%s: a §0 rule builds and runs only in an isolated temporary copy", (rendering) => {
    const rule = ruleRows(rendering).find((row) => /격리|isolated/i.test(row));
    expect(rule, `${rendering}: no isolation rule in §0`).toBeDefined();
    expect(rule).toMatch(/임시|temporary/i);
    expect(rule).toMatch(/(실제|운영)[^|]{0,30}(데이터|서비스)|real user data|production/i);
    expect(sentenceWith(rule ?? "", /격리|isolated/i, /사본|copy/i, /에서만|only in/i)).toBeDefined();
  });

  it.each(RENDERINGS)("%s: the isolation rule removes credential files and credential environment variables", (rendering) => {
    const rule = ruleRows(rendering).find((row) => /격리|isolated/i.test(row)) ?? "";
    expect(sentenceWith(rule, /\.env/, /자격 증명|credential/i, /지운|remove/i)).toBeDefined();
    expect(sentenceWith(rule, /환경 변수|environment variable/i, /DATABASE_URL/, /자격 증명|credential/i, /뺀|remove|unset/i)).toBeDefined();
  });

  it.each(RENDERINGS)("%s: the real-data prohibition is stated with its negation in the same sentence", (rendering) => {
    const rule = ruleRows(rendering).find((row) => /격리|isolated/i.test(row)) ?? "";
    expect(sentenceWith(rule, /실제 사용자 데이터|real user data/i, /운영 서비스|production service/i, NEGATION)).toBeDefined();
  });

  it.each(RENDERINGS)("%s: a reproduction script a caller re-runs follows the same isolation rule", (rendering) => {
    expect(sentenceWith(body(rendering), /재현 스크립트|reproduction script/i, /호출자|caller/i, /같은 규칙|same rule/i)).toBeDefined();
  });

  it.each(RENDERINGS)("%s: a §0 rule forbids changing product code", (rendering) => {
    const rule = ruleRows(rendering).find((row) => /제품 코드|product code/i.test(row));
    expect(rule, `${rendering}: no product-code rule in §0`).toBeDefined();
    expect(rule).toMatch(/고치지 않|바꾸지 않|수정하지 않|does not change|never changes|SHALL NOT change|not change/i);
  });

  it.each(RENDERINGS)("%s: a §0 rule saves an existing file's bytes before an attempt edits it and restores them when it is abandoned", (rendering) => {
    const rules = ruleRows(rendering).join(" | ");
    expect(sentenceWith(rules, /바이트|bytes/i, /저장|save/i, /되돌|restore/i, /버릴|abandon/i)).toBeDefined();
    expect(sentenceWith(rules, /만든 파일만|only (the )?files it created/i, /지우|delete/i)).toBeDefined();
    expect(sentenceWith(rules, /남기는 파일|leaves in the repository/i, /재현 테스트|reproduction test/i, /보고서|report/i, /뿐|only/i)).toBeDefined();
  });

  it.each(RENDERINGS)("%s: every attempt's touched files are kept in state.json, and §3 no longer deletes a failed attempt's test file outright", (rendering) => {
    expect(sentenceWith(body(rendering), /건드린 파일|touched/i, /시도마다|each attempt|every attempt/i, /state\.json/)).toBeDefined();
    expect(part(rendering, /^##\s*3\./)).not.toMatch(/재현하지 못한 시도의 테스트 파일은 지우|Delete the test file of every attempt/i);
  });
});

describe("FR-FLOW-199 AC-9 — a report and a kiwi-bug-repro pipeline event", () => {
  it.each(RENDERINGS)("%s: §5 writes the report and emits skill = kiwi-bug-repro", (rendering) => {
    const report = part(rendering, /^##\s*5\./);
    expect(report).toMatch(/보고서|report/i);
    expect(report).toMatch(/workflow_pipeline_emit|pipeline event|파이프라인 이벤트/i);
    expect(report).toMatch(/`?skill`?\s*[=:]\s*`?kiwi-bug-repro`?/);
  });

  it.each(RENDERINGS)("%s: --no-pipeline-emit suppresses the event and is an option of §1", (rendering) => {
    expect(sentenceWith(part(rendering, /^##\s*5\./), /--no-pipeline-emit/, NEGATION)).toBeDefined();
    expect(part(rendering, /^##\s*1\./)).toContain("--no-pipeline-emit");
  });

  it.each(RENDERINGS)("%s: the run id carries seconds and a random suffix, so two runs in one minute do not collide", (rendering) => {
    const runId = proseSentences(part(rendering, /^##\s*1\./)).find((sentence) => /Run-id/.test(sentence)) ?? "";
    expect(runId).toMatch(/HHMMSS/);
    expect(runId).toMatch(/무작위|random/i);
  });
});

describe("FR-FLOW-199 AC-10 — --analysis-only records the input and runs the static analysis only", () => {
  it.each(RENDERINGS)("%s: --analysis-only returns the ordered causes, runs no stage and writes no test", (rendering) => {
    const text = body(rendering);
    expect(part(rendering, /^##\s*1\./)).toContain("--analysis-only");
    expect(sentenceWith(text, /--analysis-only/, /원인|cause/i, /순서|order/i, /돌려|return/i)).toBeDefined();
    expect(sentenceWith(text, /--analysis-only/, /단계|stage/i, /테스트|test/i, /(돌리지 않|runs no|run no)/i)).toBeDefined();
  });
});

describe("FR-FLOW-199 — inverting or deleting a rule turns its check red", () => {
  it.each(RENDERINGS)("%s AC-2/AC-6: every stop of §1 and §4.3 that names --auto holds under it, with no exception carved out", (rendering) => {
    for (const [heading, least] of [[/^##\s*1\./, 2], [/^###\s*4\.3\b/, 1]] as const) {
      const stops = sentencesWith(part(rendering, heading), /--auto/, STOP);
      expect(stops.length, `${rendering} ${heading}: stops naming --auto`).toBeGreaterThanOrEqual(least);
      for (const stop of stops) {
        expect(stop, `${rendering}: ${stop}`).toMatch(ALSO);
        expect(stop, `${rendering}: ${stop}`).not.toMatch(EXCEPTION);
      }
    }
  });

  it.each(RENDERINGS)("%s AC-3: a §0 rule runs no test, build or product before the §2 cause list exists", (rendering) => {
    const rule = ruleRows(rendering).find((row) => /정적 분석|static analysis/i.test(row)) ?? "";
    expect(sentenceWith(rule, /§2/, /전에는|until/i, /테스트|test/i, /빌드|build/i, NEGATION), `${rendering}: static-analysis-first rule`).toBeDefined();
  });

  it.each(RENDERINGS)("%s AC-5: a §0 rule counts a compile error, broken setup or timeout as a defect of the test, not a reproduction", (rendering) => {
    const rule = ruleRows(rendering).find((row) => /컴파일 오류|compile error/i.test(row)) ?? "";
    expect(rule, `${rendering}: no symptom-match rule`).toMatch(/증상|symptom/i);
    expect(sentenceWith(rule, /컴파일 오류|compile error/i, /타임아웃|timeout/i, /테스트의 결함|defect of the test/i)).toBeDefined();
  });

  it.each(RENDERINGS)("%s AC-5: a build-only reproduction is turned into an automated test that is confirmed red", (rendering) => {
    const reproduced = part(rendering, /^###\s*4\.1\b/);
    expect(sentenceWith(reproduced, /관찰|observation/i, /자동 테스트|automated test/i, /옮긴|turn/i)).toBeDefined();
    const confirm = sentencesWith(reproduced, /\bred\b/i, /확인|confirm/i);
    expect(confirm.length, `${rendering}: red confirmation`).toBeGreaterThan(0);
    for (const sentence of confirm) expect(sentence).not.toMatch(NEGATION);
  });

  it.each(RENDERINGS)("%s AC-7: every mention of the main agent's conclusion in §4.2 withholds it", (rendering) => {
    const mentions = sentencesWith(part(rendering, /^###\s*4\.2\b/), /결론|conclusion/i);
    expect(mentions.length).toBeGreaterThan(0);
    for (const mention of mentions) expect(mention, `${rendering}: ${mention}`).toMatch(NEGATION);
  });

  it.each(RENDERINGS)("%s AC-8: stage 1 and stage 2 tests run with home and configuration variables pointed into a temporary directory", (rendering) => {
    const rule = ruleRows(rendering).find((row) => /격리|isolated/i.test(row)) ?? "";
    expect(sentenceWith(rule, /HOME/, /USERPROFILE/, /임시|temporary|that directory|그 디렉토리/i)).toBeDefined();
    expect(sentenceWith(rule, /1단계|stage 1/i, /2단계|stage 2/i, /홈|home/i, /임시|temporary/i)).toBeDefined();
  });
});

describe("FR-FLOW-199 AC-8 — the temporary copy and an interrupted run", () => {
  it.each(RENDERINGS)("%s: the temporary copy is made without .git and drops registry, cloud and SSH credentials", (rendering) => {
    const rule = ruleRows(rendering).find((row) => /격리|isolated/i.test(row)) ?? "";
    expect(sentenceWith(rule, /`\.git`/, /빼고|without|제외|않/i)).toBeDefined();
    for (const credential of [".npmrc", ".aws", ".ssh"]) expect(rule, `${rendering}: ${credential}`).toContain(credential);
  });

  it.each(RENDERINGS)("%s: a run starts by undoing an earlier run that state.json does not record as finished", (rendering) => {
    const rules = ruleRows(rendering).join(" | ");
    const start = sentencesWith(rules, /이전|earlier/i, /state\.json/, /끝났|finished/i);
    expect(start.length, `${rendering}: the start-of-run check`).toBeGreaterThan(0);
    for (const sentence of start) {
      expect(sentence, `${rendering}: ${sentence}`).toMatch(/먼저|first/i);
      expect(sentence, `${rendering}: ${sentence}`).not.toMatch(/never looks|찾지 않는다|skip/i);
    }
    expect(sentenceWith(rules, /되돌|restore/i, /만든 파일|created/i, /지우|지운|delete/i)).toBeDefined();
    expect(sentenceWith(rules, /끝날 때|end of every run|when the run ends/i, /state\.json/, /끝났|finished/i)).toBeDefined();
    expect(rules).not.toMatch(/재개한 실행도 그 목록으로|a resumed run restores from that list/i);
  });

  it.each(RENDERINGS)("%s: what an abandoned attempt already undid is marked, and the start-of-run undo skips it", (rendering) => {
    const rules = ruleRows(rendering).join(" | ");
    expect(sentenceWith(rules, /버린 시도|abandoned attempt/i, /되돌림|undone/i)).toBeDefined();
    expect(sentenceWith(rules, /되돌|restore/i, /되돌림으로 적히지 않은|not marked undone/i)).toBeDefined();
  });

  it.each(RENDERINGS)("%s: a run that may still be going in another session is not undone — the run stops and asks", (rendering) => {
    expect(sentenceWith(ruleRows(rendering).join(" | "), /다른 세션|another session/i, /state\.json/, STOP)).toBeDefined();
  });
});

describe("FR-FLOW-199 AC-6/AC-8 — stage 1 and 2 environment", () => {
  it.each(RENDERINGS)("%s: dependency caches stay reachable, and a tool home that holds credentials is not passed whole", (rendering) => {
    const rule = ruleRows(rendering).find((row) => /격리|isolated/i.test(row)) ?? "";
    expect(sentenceWith(rule, /의존성 캐시|dependency cache/i, /GOMODCACHE/, /실제|real/i)).toBeDefined();
    expect(sentenceWith(rule, /GRADLE_USER_HOME/, /CARGO_HOME/, NEGATION)).toBeDefined();
  });

  it.each(RENDERINGS)("%s: when the repository holds credential files, stage 1 and 2 tests also run in an isolated copy", (rendering) => {
    const rule = ruleRows(rendering).find((row) => /격리|isolated/i.test(row)) ?? "";
    expect(sentenceWith(rule, /자격 증명 파일|credential files/i, /1단계|stage 1/i, /격리|isolated/i, /사본|copy/i)).toBeDefined();
  });

  it.each(RENDERINGS)("%s: a test that cannot run for an unresolved dependency is not an attempt and stops as §4.3 does", (rendering) => {
    expect(sentenceWith(body(rendering), /의존성|dependency/i, /시도가 아니|시도로 세지 않|not an attempt/i, /§4\.3/)).toBeDefined();
  });

  it.each(RENDERINGS)("%s: a file changed since that run is neither restored nor deleted — the run stops and asks, under --auto too", (rendering) => {
    const rules = ruleRows(rendering).join(" | ");
    expect(sentenceWith(rules, /해시|hash/i, STOP, ASK, ALSO)).toBeDefined();
    const gate = criticalGateRows(body(rendering)).find((row) => row.gateId === "repro-restore-conflict");
    expect(gate, `${rendering}: no repro-restore-conflict gate`).toBeDefined();
  });
});

describe("FR-FLOW-199 AC-9 — next_hint names kiwi-hot-fix only for a failing automated test", () => {
  const HOT_FIX_FOR_NO_TEST = /`reproduced-no-test`[^→|]{0,30}→\s*`kiwi-hot-fix`/;

  it.each(RENDERINGS)("%s: §5 sends reproduced to kiwi-hot-fix and reproduced-no-test to null", (rendering) => {
    const report = part(rendering, /^##\s*5\./);
    const hint = sentenceWith(report, /next_hint/) ?? "";
    expect(hint).toMatch(/`reproduced`\s*→\s*`kiwi-hot-fix`/);
    expect(hint).not.toMatch(HOT_FIX_FOR_NO_TEST);
    expect(sentenceWith(report, /`reproduced-no-test`/, /null/)).toBeDefined();
  });

  it.each(RENDERINGS)("%s: the pipeline-v1 summary row gives reproduced-no-test no hint", (rendering) => {
    const row = readRepoFile(`${rendering}/_shared/kiwi/pipeline-v1.md`).split(/\r?\n/).find((line) => /^\|\s*`kiwi-bug-repro`\s*\|\s*`TASK_DONE`/.test(line)) ?? "";
    expect(row).toMatch(/none for `reproduced-no-test`/);
  });

  it.each(RENDERINGS.flatMap((rendering) => [`${rendering}/kiwi-pipeline/SKILL.md`, `${rendering}/_shared/kiwi/pipeline-event.md`]))("%s: the kiwi-bug-repro row agrees", (relPath) => {
    const row = readRepoFile(relPath).split(/\r?\n/).find((line) => /^\|\s*kiwi-bug-repro\s*\|/.test(line));
    expect(row, `${relPath}: no kiwi-bug-repro row`).toBeDefined();
    expect(row).toMatch(/`reproduced`\)?\s*→\s*`kiwi-hot-fix`/);
    expect(row).toMatch(/`reproduced-no-test`/);
    expect(row).not.toMatch(HOT_FIX_FOR_NO_TEST);
  });
});

describe("FR-FLOW-199 AC-6/AC-8 — record order, a confirmed-dead run, and runtimes that ignore HOME", () => {
  it.each(RENDERINGS)("%s: a path is recorded before it is written and its hash after, and an entry with no hash is undone from saved/", (rendering) => {
    const rules = ruleRows(rendering).join(" | ");
    expect(sentenceWith(rules, /먼저 적고|first records|before .{0,30}writes?/i, /해시|hash/i)).toBeDefined();
    expect(sentenceWith(rules, /해시가 (아직 )?없는|no hash yet/i, /saved\//)).toBeDefined();
  });

  it.each(RENDERINGS)("%s: once the user confirms the earlier run ended, the time condition no longer stops the undo", (rendering) => {
    expect(sentenceWith(ruleRows(rendering).join(" | "), /끝났다고 (확인|답)|confirm(s|ed)? .{0,20}ended/i, /시간 조건|hour/i)).toBeDefined();
  });

  it.each(RENDERINGS)("%s: a JVM gets its temporary home through JAVA_TOOL_OPTIONS, and a runtime that cannot get one stops", (rendering) => {
    const rule = ruleRows(rendering).find((row) => /격리|isolated/i.test(row)) ?? "";
    expect(sentenceWith(rule, /JAVA_TOOL_OPTIONS/, /user\.home/)).toBeDefined();
    expect(sentenceWith(rule, /줄 수 없는 런타임|runtime that cannot/i, /§4\.3/, STOP)).toBeDefined();
  });
});
