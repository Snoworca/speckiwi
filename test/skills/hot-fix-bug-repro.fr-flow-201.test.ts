import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { REPO_ROOT, criticalGateRows, section, stripFrontmatter } from "./kiwi-orchestrator-variants.js";
import { NEGATION, RENDERINGS, flat, proseSentences, sentenceWith, sentencesWith } from "./kiwi-renderings.js";

// @req FR-FLOW-201 — kiwi-hot-fix delegates root-cause analysis and reproduction to kiwi-bug-repro.
//
// The renderings of kiwi-hot-fix do not share a section layout (claude numbers its phases, codex and
// etc keep a short Workflow list and move detail into references/), so most checks read the whole
// package a reader is given: SKILL.md plus every references/*.md beside it. A rule is asserted in the
// sentence that states it (`sentenceWith`), so that it cannot borrow its condition from elsewhere.

const SKILL = "kiwi-hot-fix";

function skillBody(rendering: string): string {
  return stripFrontmatter(readFileSync(path.join(REPO_ROOT, rendering, SKILL, "SKILL.md"), "utf8")).replace(/\r\n/g, "\n");
}

function packageText(rendering: string): string {
  const dir = path.join(REPO_ROOT, rendering, SKILL);
  const parts = [skillBody(rendering)];
  const references = path.join(dir, "references");
  if (existsSync(references)) {
    for (const entry of readdirSync(references).filter((name) => name.endsWith(".md")).sort()) {
      parts.push(readFileSync(path.join(references, entry), "utf8"));
    }
  }
  return flat(parts.join("\n").replace(/\r\n/g, "\n"));
}

/** The workflow a reader follows in order: claude's Phase 1 section, or the Workflow list elsewhere. */
function workflow(rendering: string): string {
  const body = skillBody(rendering);
  return flat(section(body, /^##\s*4\./) || section(body, /^##\s*Workflow\b/));
}

const NO_FIX = /fix 를 적용하지 않|apply no fix|no fix is applied/i;
/** A line-level "no fix": the outcome cell and the rule share a table row or a list item. */
const NO_FIX_LINE = /fix 를 적용하지 않|apply no fix|no fix is applied|no fix/i;

describe("FR-FLOW-201 AC-1 — the root cause and the regression test come from kiwi-bug-repro", () => {
  it.each(RENDERINGS)("%s: invokes kiwi-bug-repro and uses its reproduction test as the regression test", (rendering) => {
    const text = packageText(rendering);
    expect(text).toContain("kiwi-bug-repro");
    expect(text).toMatch(/재현 테스트[^.]{0,60}회귀 테스트|회귀 테스트[^.]{0,60}재현 테스트|reproduction test[^.]{0,60}regression test|regression test[^.]{0,60}reproduction test/i);
  });

  it.each(RENDERINGS)("%s: keeps no second root-cause or reproduction procedure of its own", (rendering) => {
    expect(packageText(rendering)).not.toMatch(/symptom analyst|scope analyst|two isolated root-cause passes|Sonnet\s*×\s*2/i);
  });

  it.each(RENDERINGS)("%s: the returned most likely cause is the fix hypothesis", (rendering) => {
    expect(sentenceWith(packageText(rendering), /가장 유력한 원인|most likely cause/i, /fix 가설|fix hypothesis/i)).toBeDefined();
  });

  it.each(RENDERINGS)("%s: an existing kiwi-bug-repro report for the same input is used instead of reproducing again", (rendering) => {
    const text = packageText(rendering);
    expect(text).toContain("BUG_REPRO_REPORT");
    expect(sentenceWith(text, /직전 파이프라인 이벤트|previous pipeline event/i, /kiwi-bug-repro/)).toBeDefined();
    expect(sentenceWith(text, /보고서|report/i, /다시 재현하지 않|instead of reproducing again/i)).toBeDefined();
  });
});

describe("FR-FLOW-201 AC-2 — no reproduction, or not a bug, means no fix", () => {
  it.each(RENDERINGS)("%s: stops without a fix when kiwi-bug-repro cannot reproduce or reports not a bug", (rendering) => {
    const text = packageText(rendering);
    expect(text).toMatch(/재현(하지 못|되지 않)|cannot reproduce|not reproduced/i);
    expect(text).toMatch(/버그가 아니|not a bug/i);
    expect(text).toMatch(/fix 를 적용하지 않|수정하지 않|no fix|apply no fix|without (a|any) fix/i);
  });

  it.each(RENDERINGS)("%s: TDD_EXEMPT_REASON still skips the reproduction test", (rendering) => {
    expect(packageText(rendering)).toContain("TDD_EXEMPT_REASON");
  });

  it.each(RENDERINGS)("%s: 'no fix' is stated with each outcome that causes it", (rendering) => {
    const text = packageText(rendering);
    expect(sentenceWith(text, /재현하지 못|not reproduced/i, NO_FIX), `${rendering}: not reproduced`).toBeDefined();
    expect(sentenceWith(text, /버그가 아님|not a bug/i, NO_FIX), `${rendering}: not a bug`).toBeDefined();
    expect(sentenceWith(text, /자동 테스트 없이|without an automated test/i, /멈추|멈춘|\bstops?\b/i, /TDD_EXEMPT_REASON/), `${rendering}: no automated test`).toBeDefined();
  });

  it.each(RENDERINGS)("%s: TDD_EXEMPT_REASON skips only the reproduction test and still calls kiwi-bug-repro --analysis-only", (rendering) => {
    const text = packageText(rendering);
    expect(sentenceWith(text, /TDD_EXEMPT_REASON/, /재현 테스트만|only the reproduction test/i)).toBeDefined();
    expect(sentenceWith(text, /TDD_EXEMPT_REASON/, /kiwi-bug-repro --analysis-only/)).toBeDefined();
    expect(text).not.toMatch(/skip the delegation|위임\(§4\)도 하지 않|이 위임을 건너뛴/i);
  });

  it.each(RENDERINGS)("%s: the workflow checks the exemption before it invokes kiwi-bug-repro", (rendering) => {
    const steps = workflow(rendering);
    const exempt = steps.indexOf("TDD_EXEMPT_REASON");
    const call = steps.search(/Skill\(skill="kiwi-bug-repro"|[Ii]nvoke `\$?kiwi-bug-repro`/);
    expect(exempt, `${rendering}: no exemption check in the workflow`).toBeGreaterThanOrEqual(0);
    expect(call, `${rendering}: no invocation in the workflow`).toBeGreaterThanOrEqual(0);
    expect(exempt, `${rendering}: the exemption is checked after the call`).toBeLessThan(call);
  });

  it.each(RENDERINGS)("%s: a reproduction script re-run around the fix runs isolated", (rendering) => {
    expect(sentenceWith(packageText(rendering), /재현 스크립트|reproduction script/i, /격리|isolat/i)).toBeDefined();
  });
});

describe("FR-FLOW-201 AC-3 — the same test is red before the fix and green after it", () => {
  it.each(RENDERINGS)("%s: names red before and green after for that test", (rendering) => {
    const text = packageText(rendering);
    expect(text).toMatch(/\bred\b/i);
    expect(text).toMatch(/\bgreen\b/i);
    expect(text).toMatch(/같은 (재현 )?테스트|same (reproduction )?test/i);
  });

  it.each(RENDERINGS)("%s: one sentence ties the reproduction test to red before the fix and the same test green after it", (rendering) => {
    expect(sentenceWith(packageText(rendering), /재현 테스트|reproduction test/i, /\bred\b/i, /fix 전|before the fix/i, /\bgreen\b/i, /fix 뒤|after/i, /같은|same/i)).toBeDefined();
  });
});

describe("FR-FLOW-201 AC-4 — a working-tree input is reproduced in a temporary worktree and never moved", () => {
  it.each(RENDERINGS)("%s: never stashes, resets or checks out the user's change", (rendering) => {
    const text = packageText(rendering);
    const moving = proseSentences(text).filter((sentence) => /\bgit (stash|reset|checkout)\b/.test(sentence) && !NEGATION.test(sentence));
    expect(moving, `${rendering}: a sentence moves the user's change`).toEqual([]);
    expect(sentenceWith(text, /stash/i, /reset/i, /checkout|checks? out|checked out/i, NEGATION)).toBeDefined();
  });

  it.each(RENDERINGS)("%s: reproduces in a temporary git worktree of HEAD, where the test is red", (rendering) => {
    const text = packageText(rendering);
    expect(sentenceWith(text, /git worktree add/, /HEAD/)).toBeDefined();
    expect(sentenceWith(text, /worktree|워크트리/i, /\bred\b/i)).toBeDefined();
  });

  it.each(RENDERINGS)("%s: copies the test into the user's tree and completes the user's change as the fix candidate", (rendering) => {
    const text = packageText(rendering);
    expect(sentenceWith(text, /복사|cop(y|ies)/i, /재현 테스트|reproduction test/i, /작업 트리|working tree/i)).toBeDefined();
    expect(sentenceWith(text, /fix 후보|fix candidate/i, /사용자|user/i)).toBeDefined();
    expect(sentenceWith(text, /두 번째 fix|second fix/i, NEGATION)).toBeDefined();
  });

  it.each(RENDERINGS)("%s: records the worktree in state.json, reuses it on --resume and removes it when the run completes", (rendering) => {
    const text = packageText(rendering);
    expect(text).toContain("repro_worktree");
    expect(sentenceWith(text, /--resume/, /worktree|워크트리/i, /다시 쓴|reuse/i)).toBeDefined();
    expect(sentenceWith(text, /git worktree remove/, /완료|complete/i)).toBeDefined();
  });
});

/** Every line of the package a reader is given, unflattened, so a table row or list item is one unit. */
function packageLines(rendering: string): string[] {
  const dir = path.join(REPO_ROOT, rendering, SKILL);
  const parts = [skillBody(rendering)];
  const references = path.join(dir, "references");
  if (existsSync(references)) {
    for (const entry of readdirSync(references).filter((name) => name.endsWith(".md")).sort()) {
      parts.push(readFileSync(path.join(references, entry), "utf8").replace(/\r\n/g, "\n"));
    }
  }
  return parts.join("\n").split("\n");
}

const STOP = /멈추|멈춰|멈춘|\bstops?\b|\bhalts?\b/i;
const ASK = /묻|\bask/i;
const ALSO = /에서도|라도|as well|\btoo\b|\balso\b/i;

describe("FR-FLOW-201 — inverting or deleting a rule turns its check red", () => {
  it.each(RENDERINGS)("%s AC-2: every line that handles a not-reproduced outcome applies no fix", (rendering) => {
    const lines = packageLines(rendering).filter((line) => /재현하지 못|cannot reproduce|`not-reproduced`/i.test(line));
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(line, `${rendering}: ${line}`).toMatch(NO_FIX_LINE);
  });

  it.each(RENDERINGS)("%s AC-2: no sentence pairs kiwi-bug-repro with a FAILED status it never returns", (rendering) => {
    expect(sentencesWith(packageText(rendering), /kiwi-bug-repro/, /\bFAILED\b/)).toEqual([]);
    expect(sentenceWith(packageText(rendering), /`not-reproduced`/, /`input-insufficient`/, STOP, ALSO)).toBeDefined();
  });

  it.each(RENDERINGS)("%s AC-3/AC-4: the red check before the fix runs in repro_worktree for a working-tree input", (rendering) => {
    expect(sentenceWith(packageText(rendering), /\bred\b/i, /repro_worktree/, /git-status|working-tree/i)).toBeDefined();
  });
});

describe("FR-FLOW-201 AC-4 — the user's change is never overwritten", () => {
  it.each(RENDERINGS)("%s: every sentence that copies the reproduction test into the user's tree limits it to a free path", (rendering) => {
    const copies = sentencesWith(packageText(rendering), /복사|cop(y|ies|ied)/i, /재현 테스트|reproduction test/i, /작업 트리|working tree/i);
    expect(copies.length).toBeGreaterThan(0);
    for (const copy of copies) expect(copy, `${rendering}: ${copy}`).toMatch(/파일이 없는 경로|no file exists/i);
    expect(sentenceWith(packageText(rendering), /복사|cop(y|ies)/i, /재현 테스트|reproduction test/i, /파일이 없는 경로|no file exists/i, /에만|only/i)).toBeDefined();
  });

  it.each(RENDERINGS)("%s: a taken path is neither copied nor merged — the run stops and asks, under --auto too", (rendering) => {
    const text = packageText(rendering);
    expect(sentenceWith(text, /이미|already/i, /복사하지 않|do not copy/i, /합치지|merge/i, STOP, ASK, ALSO)).toBeDefined();
    expect(criticalGateRows(skillBody(rendering)).map((row) => row.gateId)).toContain("repro-path-occupied");
  });

  it.each(RENDERINGS)("%s: the worktree's dependencies are prepared from the lockfile, or the run stops and asks", (rendering) => {
    const text = packageText(rendering);
    expect(sentenceWith(text, /lockfile/, /의존성|dependencies/i, /worktree|워크트리/i)).toBeDefined();
    expect(sentenceWith(text, /준비할 수 없|cannot be prepared/i, STOP, ASK, ALSO)).toBeDefined();
    expect(criticalGateRows(skillBody(rendering)).map((row) => row.gateId)).toContain("repro-worktree-unprepared");
  });

  it.each(RENDERINGS)("%s: the worktree is kept while the run waits, recreated on --resume, and removed only on completion or abandonment", (rendering) => {
    const text = packageText(rendering);
    const removals = sentencesWith(text, /git worktree remove/);
    expect(removals.length).toBeGreaterThan(0);
    for (const removal of removals) {
      expect(removal, `${rendering}: ${removal}`).not.toMatch(NEGATION);
      expect(removal, `${rendering}: ${removal}`).toMatch(/완료|complete/i);
      expect(removal, `${rendering}: ${removal}`).toMatch(/포기|abandon/i);
      expect(removal, `${rendering}: ${removal}`).not.toMatch(/중단|halt/i);
    }
    expect(sentenceWith(text, /기다리|waits/i, /worktree|워크트리/i, /남긴|남겨|keep/i)).toBeDefined();
    expect(sentenceWith(text, /--resume/, /다시 만든|recreate/i)).toBeDefined();
    expect(sentenceWith(text, /사용자의 (작업 )?트리|user's tree/i, /부르지 않|never invoke/i)).toBeDefined();
  });

  it.each(RENDERINGS)("%s: an existing report for a working-tree input still checks red in a HEAD worktree", (rendering) => {
    expect(sentenceWith(packageText(rendering), /기존 보고서|existing report|BUG_REPRO_REPORT/, /git-status|working-tree/i, /worktree|워크트리/i, /\bred\b/i)).toBeDefined();
  });
});

describe("FR-FLOW-201 AC-5 — a large fix stops at fix-complexity-large", () => {
  it.each(RENDERINGS)("%s: every sentence about a large estimate stops at the gate and none proceeds anyway", (rendering) => {
    const text = packageText(rendering);
    // The gate row's own reason cell names the condition; the gate is the row it sits in.
    const reasons = new Set(criticalGateRows(skillBody(rendering)).map((row) => flat(row.reason).trim()));
    const large = sentencesWith(text, /complexity is large|`?fix_complexity_estimate`? ?=+ ?"?large|`large`/i).filter((sentence) => !reasons.has(sentence));
    expect(large.length).toBeGreaterThan(0);
    for (const sentence of large) {
      expect(sentence, `${rendering}: ${sentence}`).toMatch(/fix-complexity-large/);
      expect(sentence, `${rendering}: ${sentence}`).toMatch(STOP);
      expect(sentence, `${rendering}: ${sentence}`).not.toMatch(/그래도 진행|or ask whether|proceeds? anyway/i);
    }
  });
});

/**
 * The package files that lay out the working-tree flow (the ones that run `git worktree add`), each
 * flattened. A rule stated in two files is asserted in each: inverted in the detailed file while the
 * summary kept it, it read as green when the package was searched as one text.
 */
function flowFiles(rendering: string): Array<{ name: string; text: string }> {
  const dir = path.join(REPO_ROOT, rendering, SKILL);
  const files = [{ name: "SKILL.md", text: skillBody(rendering) }];
  const references = path.join(dir, "references");
  if (existsSync(references)) {
    for (const entry of readdirSync(references).filter((name) => name.endsWith(".md")).sort()) {
      files.push({ name: `references/${entry}`, text: readFileSync(path.join(references, entry), "utf8").replace(/\r\n/g, "\n") });
    }
  }
  return files.filter((file) => file.text.includes("git worktree add")).map((file) => ({ name: file.name, text: flat(file.text) }));
}

const FLOW_CASES = RENDERINGS.flatMap((rendering) => flowFiles(rendering).map((file) => [rendering, file.name] as const));
const flowText = (rendering: string, name: string): string => flowFiles(rendering).find((file) => file.name === name)?.text ?? "";

describe("FR-FLOW-201 AC-4 — every file that lays out the working-tree flow states its rules itself", () => {
  it("every rendering has one", () => {
    for (const rendering of RENDERINGS) expect(flowFiles(rendering).length, rendering).toBeGreaterThan(0);
  });

  it.each(FLOW_CASES)("%s %s: only a file kiwi-bug-repro created is copied, and only to a free path", (rendering, name) => {
    const text = flowText(rendering, name);
    const rule = sentenceWith(text, /복사|cop(y|ies)/i, /재현 테스트|reproduction test/i, /만든|created/i, /파일이 없는 경로|no file exists/i);
    expect(rule, `${rendering} ${name}`).toBeDefined();
    expect(rule).not.toMatch(/^(do not|don't|never)\b|복사하지 않는다/i);
  });

  it.each(FLOW_CASES)("%s %s: a file it edited is copied only when the user's copy is byte-for-byte HEAD", (rendering, name) => {
    expect(sentenceWith(flowText(rendering, name), /고친|고쳤|edited/i, /HEAD/, /바이트|byte-for-byte/i, /때만|only when/i)).toBeDefined();
  });

  it.each(FLOW_CASES)("%s %s: anything else is neither copied nor merged — the run stops and asks, under --auto too", (rendering, name) => {
    expect(sentenceWith(flowText(rendering, name), /복사하지 않|do not copy/i, /합치지|merge/i, STOP, ASK, ALSO)).toBeDefined();
  });

  it.each(FLOW_CASES)("%s %s: the worktree is kept while the run waits, and no sentence removes it then", (rendering, name) => {
    const text = flowText(rendering, name);
    expect(sentenceWith(text, /기다리|waits/i, /worktree|워크트리/i, /남긴|남겨|keep/i)).toBeDefined();
    expect(sentencesWith(text, /기다리|waits/i, /worktree|워크트리/i, /지운|지우|remove/i)).toEqual([]);
  });

  it.each(FLOW_CASES)("%s %s: an end with nothing to fix removes the worktree, and a vanished path is pruned before it is made again", (rendering, name) => {
    const text = flowText(rendering, name);
    expect(sentenceWith(text, /git worktree remove/, /bug-not-a-bug|고칠 것이 없|nothing to fix/i)).toBeDefined();
    expect(sentenceWith(text, /git worktree prune/, /다시 만든|recreate/i)).toBeDefined();
  });

  it.each(FLOW_CASES)("%s %s: dependencies come from the lockfile, the build tool when there is none, with lifecycle scripts off", (rendering, name) => {
    const text = flowText(rendering, name);
    expect(sentenceWith(text, /lockfile 이 없|no lockfile/i, /의존성|dependencies/i, /빌드 도구|build tool/i)).toBeDefined();
    expect(text).toContain("--ignore-scripts");
  });
});

describe("FR-FLOW-201 AC-2/AC-4 — answers and exemptions after a stop", () => {
  it.each(RENDERINGS)("%s: after a taken-path stop, --resume looks for the test the user moved in themselves", (rendering) => {
    expect(sentenceWith(packageText(rendering), /직접|themselves/i, /--resume/, /재현 테스트|reproduction test/i)).toBeDefined();
  });

  it.each(RENDERINGS)("%s: TDD_EXEMPT_REASON given after a no-test reproduction checks with its script instead of reproducing again", (rendering) => {
    const text = packageText(rendering);
    expect(sentenceWith(text, /TDD_EXEMPT_REASON/, /reproduced-no-test|자동 테스트 없이 재현/i, /--resume/, /--analysis-only/, NEGATION)).toBeDefined();
    expect(sentenceWith(text, /재현 스크립트|reproduction script/i, /repro_worktree/, /fix 전|before the fix/i)).toBeDefined();
  });
});

describe("FR-FLOW-201 AC-2/AC-4 — the HEAD the worktree came from, other inputs, and what a run leaves behind", () => {
  it.each(FLOW_CASES)("%s %s: the worktree's base commit is recorded, and a moved HEAD copies nothing", (rendering, name) => {
    const text = flowText(rendering, name);
    expect(sentenceWith(text, /repro_base/, /sha/i)).toBeDefined();
    expect(sentenceWith(text, /--resume/, /repro_base/, /복사하지 않|copies nothing|nothing is copied/i, STOP, ASK, ALSO)).toBeDefined();
    expect(sentenceWith(text, /고친|고쳤|edited/i, /repro_base/, /바이트|byte-for-byte/i)).toBeDefined();
  });

  it.each(FLOW_CASES)("%s %s: an issue or symptom input on a tree with uncommitted changes stops before reproducing", (rendering, name) => {
    expect(sentenceWith(flowText(rendering, name), /이슈|issue/i, /커밋하지 않은 변경|uncommitted change/i, STOP, ASK, ALSO, /repro-dirty-tree/)).toBeDefined();
  });

  it.each(FLOW_CASES)("%s %s: a finished report leaves the worktree before it is removed, and an abandoned run leaves the test it copied alone", (rendering, name) => {
    const text = flowText(rendering, name);
    expect(sentenceWith(text, /지우기 전|before (it is )?removed|before removing/i, /보고서|report/i, /사용자 트리|user's tree/i, /끝났다고|finished/i)).toBeDefined();
    // Taking a copied test back on abandonment lost an edit the user made after the copy (review r5, P-2).
    const abandon = sentencesWith(text, /포기|abandon/i, /복사한|copied/i, /재현 테스트|reproduction test/i);
    expect(abandon.length).toBeGreaterThan(0);
    for (const sentence of abandon) expect(sentence, `${rendering} ${name}: ${sentence}`).toMatch(NEGATION);
  });

  it.each(FLOW_CASES)("%s %s: every sentence naming --auto keeps its stop, except the flag propagation", (rendering, name) => {
    // claude keeps the whole skill in one file, so its flow is §4; the option rows and the gate preamble
    // elsewhere in that file name `--auto` for other reasons.
    const flow = name === "SKILL.md" ? flat(section(skillBody(rendering), /^##\s*4\./)) : flowText(rendering, name);
    // A table cell holding only the flag names it; it states no rule.
    const autos = sentencesWith(flow, /--auto(?![\w-])/).filter((sentence) => !/전파|propagate|\{auto\}/i.test(sentence) && !/^\|?\s*`--auto`\s*\|?$/.test(sentence));
    expect(autos.length).toBeGreaterThan(0);
    for (const sentence of autos) expect(sentence, `${rendering} ${name}: ${sentence}`).toMatch(ALSO);
  });

  it.each(RENDERINGS)("%s: input-insufficient and a moved base are critical gates, and the run waits at input-insufficient with its worktree", (rendering) => {
    const gates = criticalGateRows(skillBody(rendering)).map((row) => row.gateId);
    for (const gate of ["bug-input-insufficient", "repro-base-moved", "repro-dirty-tree", "bug-repro-question"]) expect(gates, `${rendering}: ${gate}`).toContain(gate);
    expect(sentenceWith(packageText(rendering), /기다리|waits/i, /bug-input-insufficient/, /남겨|keep/i)).toBeDefined();
  });
});
