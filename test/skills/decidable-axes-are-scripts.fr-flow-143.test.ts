import { mkdir, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";
import { REPO_ROOT } from "./kiwi-orchestrator-variants.js";

// @req FR-FLOW-143 — an axis whose rule is decidable is run by a script, not judged by an agent.
//
// req-mapping was not merely mechanizable: shipped checks already decide it. Before 4.0.0 that was
// the plan validator; with the plan gone it is `speckiwi sds check` (every `@req` and every
// `(<REQ-ID> AC-m)` resolves, every SDS-AC has a Test Plan row) together with
// `speckiwi coverage --tests --sds` (every Test Plan file exists and cites its `SDS-AC-<n>`).
// red-verification is exit status plus signature equality — a comparison a script makes exactly and
// a judge makes approximately, so moving it tightens the check rather than loosening it.

/** Every copy an agent reads: the three shipped variants and the generated mirror. */
const COPIES = [
  ["skills/claude", "skills/claude/kiwi-coder/SKILL.md"],
  ["skills/codex", "skills/codex/kiwi-coder/SKILL.md"],
  ["skills/etc", "skills/etc/kiwi-coder/SKILL.md"],
  [".agents mirror", ".agents/skills/kiwi-coder/SKILL.md"]
] as const;

function body(relPath: string): string {
  return readFileSync(path.join(REPO_ROOT, relPath), "utf8");
}

/** Rows of the Phase 1 TDD verification table — the axes still evaluated by an agent. */
function tddAxisRows(text: string): string[] {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => /^### 4\.2 /.test(line));
  if (start < 0) return [];
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^#{1,3} /.test(line));
  return (end < 0 ? rest : rest.slice(0, end)).filter((line) => /^\|\s*\*\*S\d/.test(line));
}

function section(text: string, heading: string): string {
  const start = text.indexOf(heading);
  if (start < 0) return "";
  const end = text.indexOf("\n### ", start + 1);
  return end < 0 ? text.slice(start) : text.slice(start, end);
}

/** The script decision table and its lead sentence, cut at the next paragraph that is not the table. */
function scriptTable(text: string): string {
  const start = text.indexOf("**req-mapping · red-verification 은");
  return start < 0 ? "" : text.slice(start, start + 1400);
}

describe("FR-FLOW-143 AC-1 — req-mapping reuses the SDS checks that already decide it", () => {
  it.each(COPIES)("FR-FLOW-143 AC-1: %s routes req-mapping to sds check and coverage --tests --sds", (_label, relPath) => {
    const row = scriptTable(body(relPath))
      .split(/\r?\n/)
      .find((line) => /^\|\s*req-mapping/.test(line)) ?? "";
    expect(row, "the script table has no req-mapping row").not.toBe("");
    expect(row, "req-mapping does not reuse sds check").toMatch(/speckiwi sds check/);
    expect(row, "req-mapping does not reuse the Test Plan citation check").toMatch(/coverage --tests[^|]*--sds/);
    expect(row, "req-mapping is reimplemented instead of reused").toMatch(/재구현하지 않는다/);
    expect(row, "req-mapping still names the retired plan validator").not.toMatch(/validator|kiwi-planner/i);
  });

  it.each(COPIES)("FR-FLOW-143 AC-1: %s leaves the per-requirement AC gaps to the test-sufficiency check", (_label, relPath) => {
    const table = scriptTable(body(relPath));
    expect(table, "the requirement-AC gaps coverage --tests also reports are claimed by this axis").toMatch(
      /test-sufficiency\.md/
    );
  });
});

describe("FR-FLOW-143 AC-4 — the agent-evaluated axes shrink, and the stated count follows", () => {
  it.each(COPIES)("FR-FLOW-143 AC-4: %s no longer lists req-mapping or red-verification as agent axes", (_label, relPath) => {
    const subjects = tddAxisRows(body(relPath)).join("\n");
    expect(subjects, "req-mapping is still an agent-evaluated axis").not.toMatch(/req-mapping/);
    expect(subjects, "red-verification is still an agent-evaluated axis").not.toMatch(/red-verification/);
  });

  it.each(COPIES)("FR-FLOW-143 AC-4: %s keeps the two judgement axes", (_label, relPath) => {
    const subjects = tddAxisRows(body(relPath)).join("\n");
    expect(subjects, "intent-alignment was dropped — it is a judgement axis and stays").toMatch(/intent-alignment/);
    expect(subjects, "technical-quality was dropped — it is a judgement axis and stays").toMatch(/tech|technical/);
  });

  it.each(COPIES)("FR-FLOW-143 AC-4: %s states an axis count equal to the rows it declares", (_label, relPath) => {
    // The count and the table must move together. A prior requirement in this repository shipped a
    // stale count beside a changed table and every assertion stayed green.
    const text = body(relPath);
    const rows = tddAxisRows(text).length;
    expect(rows, "the Phase 1 verification table was not found").toBeGreaterThan(0);
    const stated = [...section(text, "### 4.2 ").matchAll(/(\d+)\s*축|축\s*(\d+)\s*개/g)].map((m) => Number(m[1] ?? m[2]));
    expect(stated.length, "the section states no axis count").toBeGreaterThan(0);
    for (const count of stated) {
      expect(count, `a stated count of ${count} contradicts the ${rows}-row table`).toBe(rows);
    }
  });

  it.each(COPIES)("FR-FLOW-143 AC-4: %s does not still promise four parallel verifiers", (_label, relPath) => {
    // The heading and the mode matrix both carried "×4". Left alone they contradict the table.
    const text = body(relPath);
    const offenders = text
      .split(/\r?\n/)
      .filter((line) => /TDD\s*검증|병렬 TDD|Sonnet|standard/.test(line))
      .filter((line) => /×\s*4|x\s*4|4\s*개/.test(line));
    expect(offenders, "a line still promises four TDD verification subagents").toEqual([]);
  });
});

describe("FR-FLOW-143 AC-2 — red-verification compares by equality against an expectation the skill declares", () => {
  it.each(COPIES)("FR-FLOW-143 AC-2: %s compares the run against a declared expectation, exactly", (_label, relPath) => {
    const row = scriptTable(body(relPath))
      .split(/\r?\n/)
      .find((line) => /^\|\s*red-verification\s*\|/.test(line)) ?? "";
    expect(row, "the red-verification row was not found").not.toBe("");
    expect(row, "the comparison must be by equality").toMatch(/동등비교/);
    expect(row, "an approximate match must fail").toMatch(/근사 일치는 실패/);
    // 4.0.0 left the SDS-era location open; kiwi-coder declares it, so the equality has a right-hand side.
    expect(row, "the row must name where the expectation is declared").toMatch(/red_evidence_meta\.expected_failures/);
  });

  it.each(COPIES)("FR-FLOW-143 AC-2: %s tells the test author to record the expected failure there", (_label, relPath) => {
    const author = body(relPath)
      .split(/\r?\n/)
      .find((line) => /기대 실패가 분명하면/.test(line)) ?? "";
    expect(author, "§4.1.3 no longer tells the author what to record").toMatch(/red_evidence_meta\.expected_failures/);
  });
});

describe("FR-FLOW-143 AC-5 — the guarantee the axes carried is not weakened", () => {
  it.each(COPIES)("FR-FLOW-143 AC-5: %s still requires the red evidence before the phase passes", (_label, relPath) => {
    const text = body(relPath);
    expect(text, "the red evidence record is gone").toMatch(/red_evidence/);
    // The recorded fields survive the move off the plan sidecar; only their location is new.
    for (const field of ["command", "exit_code", "captured_failure", "timestamp"]) {
      expect(text, `the red evidence no longer records ${field}`).toContain(field);
    }
  });

  it.each(COPIES)("FR-FLOW-143 AC-5: %s still blocks the phase on a missing red", (_label, relPath) => {
    // Scoped to the CRITICAL line of §4.2, not to the file. Searching the whole document only
    // proves the phrase exists somewhere; the phrase also appears in prose, so the blocking
    // attribution could be downgraded while this stayed green.
    const text = body(relPath);
    const critical = section(text, "### 4.2 ")
      .split(/\r?\n/)
      .find((line) => line.includes("**CRITICAL**")) ?? "";
    expect(critical, "§4.2 declares no CRITICAL line").not.toBe("");
    expect(critical, "red 미발생 is no longer a blocking condition").toMatch(/red 미발생/);
  });

  it.each(COPIES)("FR-FLOW-143 AC-5: %s keeps the script verdicts blocking, not advisory", (_label, relPath) => {
    const table = scriptTable(body(relPath));
    expect(table, "the script decision table was not found").not.toBe("");
    expect(table, "the req-mapping verdict no longer blocks").toMatch(/CRITICAL/);
    expect(table, "the script verdicts were downgraded to advisory").not.toMatch(/WARN|경고만|기록만|정보만/);
  });
});

describe("FR-FLOW-143 AC-6 — the checks run here, on inputs this skill names", () => {
  it.each(COPIES)("FR-FLOW-143 AC-6: %s says where the checks' inputs come from", (_label, relPath) => {
    // The checks refuse without a path and a requirement scope. Naming the invocation without naming
    // its input leaves the guarantee resting on an upstream step having happened.
    const scoped = section(body(relPath), "### 4.2 ");
    expect(scoped, "the SDS path the checks read is not named").toMatch(/`SDS_PATH`/);
    expect(scoped, "the requirement scope — the SDS @req set — is not named").toMatch(/`@req` 집합/);
  });

  it.each(COPIES)("FR-FLOW-143 AC-6: %s runs the checks for its own SDS rather than trusting an upstream run", (_label, relPath) => {
    const scoped = section(body(relPath), "### 4.2 ");
    const rule = scoped.split(/\r?\n/).find((line) => /이 자리에서 직접 실행/.test(line)) ?? "";
    expect(rule, "nothing says the checks are run here").not.toBe("");
    expect(rule, "the run-here sentence is not about the SDS checks").toMatch(/sds check/);
    expect(scoped, "the skill assumes the checks already ran").not.toMatch(/이미 실행되었|이미 통과했다고 가정/);
  });
});

// ---------------------------------------------------------------------------------------------
// AC-3 — the reused checks are run, not named. A name found in a file proves a string is present.
// valid-basic carries FR-ARCH-001 (AC-1, AC-2) in target v1.0.0.
// ---------------------------------------------------------------------------------------------

interface Diagnostic {
  code: string;
}

function io() {
  return { stdout: new PassThrough(), stderr: new PassThrough() };
}

function drain(stream: PassThrough): string {
  return stream.read()?.toString() ?? "";
}

function sds(options: { reqId?: string; ac?: string; testPlan?: boolean } = {}): string {
  return [
    "# SDS: demo",
    "",
    "| Field | Value |",
    "|---|---|",
    "| Document Type | sds |",
    "| Profile | lite |",
    "| Target | v1.0.0 |",
    "| Status | agreed |",
    "| Date | 2026-09-27 |",
    "",
    "## Interfaces",
    "",
    "### Files",
    "",
    `- \`src/demo.ts\` — lists requirements @req ${options.reqId ?? "FR-ARCH-001"}`,
    "  - `listRequirements(root: string): string[]` — returns ids ← cli",
    "",
    "## Acceptance Contracts",
    "",
    `- SDS-AC-1 (FR-ARCH-001 ${options.ac ?? "AC-1"}): WHEN one requirement exists THE SYSTEM SHALL list it → \`listRequirements\``,
    "",
    "## Test Plan",
    "",
    "| SDS-AC | Test file | Case summary |",
    "|---|---|---|",
    ...(options.testPlan === false ? [] : ["| SDS-AC-1 | `test/demo.test.ts` | one requirement listed |"]),
    ""
  ].join("\n");
}

async function workspace(sdsText: string, testText: string): Promise<string> {
  const root = await copyFixtureWorkspace("valid-basic");
  await mkdir(path.join(root, "docs", "sds"), { recursive: true });
  await mkdir(path.join(root, "test"), { recursive: true });
  await writeFile(path.join(root, "docs", "sds", "demo.sds.md"), sdsText, "utf8");
  await writeFile(path.join(root, "test", "demo.test.ts"), testText, "utf8");
  return root;
}

async function sdsCheckCodes(root: string): Promise<string[]> {
  const streams = io();
  await main(["--root", root, "sds", "check", "docs/sds/demo.sds.md", "--json"], streams);
  return (JSON.parse(drain(streams.stdout)) as { diagnostics: Diagnostic[] }).diagnostics.map((item) => item.code);
}

async function sdsContractGaps(root: string): Promise<string[]> {
  const streams = io();
  await main(["--root", root, "coverage", "--tests", "--json", "--ids", "FR-ARCH-001", "--sds", "docs/sds/demo.sds.md"], streams);
  const report = JSON.parse(drain(streams.stdout)) as { gaps: { sdsContracts: Array<{ sdsAcId: string }> } };
  return report.gaps.sdsContracts.map((gap) => gap.sdsAcId);
}

const CITING = "it('SDS-AC-1 FR-ARCH-001 AC-1 lists one requirement', () => {});\n";

describe("FR-FLOW-143 AC-3 — the reused checks decide, proved by running them", () => {
  it("FR-FLOW-143 AC-3: a clean SDS with a citing test passes both checks", async () => {
    const root = await workspace(sds(), CITING);
    expect(await sdsCheckCodes(root)).toEqual([]);
    expect(await sdsContractGaps(root)).toEqual([]);
  });

  it("FR-FLOW-143 AC-3: an @req naming no requirement is reported", async () => {
    const root = await workspace(sds({ reqId: "FR-ARCH-999" }), CITING);
    expect(await sdsCheckCodes(root)).toContain("SDS-E062");
  });

  it("FR-FLOW-143 AC-3: a (REQ AC) naming a criterion the requirement does not have is reported", async () => {
    const root = await workspace(sds({ ac: "AC-9" }), CITING);
    expect(await sdsCheckCodes(root)).toContain("SDS-E063");
  });

  it("FR-FLOW-143 AC-3: an SDS-AC with no Test Plan row is reported", async () => {
    const root = await workspace(sds({ testPlan: false }), CITING);
    expect(await sdsCheckCodes(root)).toContain("SDS-E064");
  });

  it("FR-FLOW-143 AC-3: a Test Plan file that does not cite its SDS-AC is a gap", async () => {
    const root = await workspace(sds(), "it('lists one requirement', () => {});\n");
    expect(await sdsCheckCodes(root)).toEqual([]);
    expect(await sdsContractGaps(root)).toEqual(["SDS-AC-1"]);
  });
});

// ---------------------------------------------------------------------------------------------
// Each clause asserted against the line that carries it (AC-5's own rule): the red-verification
// row for what is executed and compared, §4.4's recording line for the evidence fields, and each
// script row's own result cell for the blocking verdict.
// ---------------------------------------------------------------------------------------------

/** One row of the script decision table, as its four cells. */
function scriptRow(text: string, axis: string): string[] {
  const line = scriptTable(text)
    .split(/\r?\n/)
    .find((entry) => new RegExp(String.raw`^\|\s*${axis}\s*\|`).test(entry)) ?? "";
  return line.split("|").slice(1, -1).map((cell) => cell.trim());
}

describe("FR-FLOW-143 AC-2 — the authored test is run, and its exit status and failure signature are what is compared", () => {
  it.each(COPIES)("FR-FLOW-143 AC-2: %s runs the test runner itself for red-verification", (_label, relPath) => {
    const [axis = "", actor = "", rule = ""] = scriptRow(body(relPath), "red-verification");
    expect(axis, "the red-verification row was not found").toBe("red-verification");
    expect(actor, "red-verification is not decided by running the tests").toMatch(/^테스트 러너 직접 실행/);
    expect(rule, "the compared quantity is not the run's exit status").toMatch(/^`exit_code` 와 `captured_failure` 를 /);
    expect(rule, "the comparison is not against the declared expectation").toMatch(/`red_evidence_meta\.expected_failures` 의 기대 실패 신호와 테스트마다 \*\*동등비교\*\*/);
  });
});

describe("FR-FLOW-143 AC-5 — the evidence fields and the blocking verdicts, on the lines that carry them", () => {
  it.each(COPIES)("FR-FLOW-143 AC-5: %s records all four red-evidence fields on §4.4's recording line", (_label, relPath) => {
    const line = section(body(relPath), "### 4.4 ")
      .split(/\r?\n/)
      .find((entry) => /`red_evidence` 에 기록한다/.test(entry)) ?? "";
    expect(line, "§4.4 has no line recording the red evidence").not.toBe("");
    expect(line, "the recording line does not keep the four fields").toMatch(
      /\(`command` \/ `exit_code` \/ `captured_failure` \/ `timestamp` 4필드\)/
    );
  });

  it.each(COPIES)("FR-FLOW-143 AC-5: %s blocks the phase on each script verdict, in that row's own result cell", (_label, relPath) => {
    const text = body(relPath);
    const mapping = scriptRow(text, "req-mapping").at(-1) ?? "";
    const red = scriptRow(text, "red-verification").at(-1) ?? "";
    expect(mapping, "a req-mapping violation no longer blocks Phase 2").toMatch(/CRITICAL, Phase 2 진입 차단/);
    expect(red, "a missing or mismatched red no longer blocks").toMatch(/red 미발생·신호 불일치 시 CRITICAL/);
  });
});
