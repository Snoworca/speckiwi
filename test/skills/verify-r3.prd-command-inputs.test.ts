import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

// Round-3 verification: the `prd-quote` command each kiwi-prd rendering ships is RUN against
// copies of test/fixtures/prd/rbac.prd.md changed in one place. Each case is an input the command
// passes (exit 0) although the rule it enforces says it must fail.

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const RENDERINGS = ["skills/claude", "skills/codex", "skills/etc", ".agents/skills"] as const;
const FIXTURE = "test/fixtures/prd/rbac.prd.md";

const read = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8").replace(/\r\n/g, "\n");

function quoteCommand(skillText: string): string {
  const lines = skillText.split("\n");
  const at = lines.findIndex((line) => line.trim().startsWith("# prd-quote:"));
  const match = /^node -e "([^"]+)" \S+$/.exec((lines[at + 1] ?? "").trim());
  expect(match, "no prd-quote command line").not.toBeNull();
  return match?.[1] ?? "";
}

const scratch = mkdtempSync(path.join(os.tmpdir(), "verify-r3-prd-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
let serial = 0;
function run(js: string, content: string): { status: number | null; stdout: string } {
  const file = path.join(scratch, `p-${(serial += 1)}.prd.md`);
  writeFileSync(file, content, "utf8");
  const result = spawnSync(process.execPath, ["-e", js, file], { encoding: "utf8" });
  return { status: result.status, stdout: result.stdout };
}

const fixture = read(FIXTURE);
const PROPOSAL_TAIL = "| Reason | 의존성이 없고 사람이 고치기 쉽다 |\n| State | confirmed |\n";
/** Adds one free-text line under the proposal PRD-8 (agent-written text, not the user's words). */
function withProposalLine(line: string): string {
  expect(fixture.includes(PROPOSAL_TAIL)).toBe(true);
  return fixture.replace(PROPOSAL_TAIL, `${PROPOSAL_TAIL}\n${line}\n`);
}

// @req FR-FLOW-204 AC-7 — the PRD carries no Requirement ID or acceptance criterion line. The
// command's ID pattern is `-[A-Z0-9]+-[0-9]{3}\b`, narrower than the SRS-MD ID grammar
// (`-[A-Z0-9][A-Z0-9-]{1,24}-[0-9]{3,4}`, docs/rule/SRS-MD-Rules-v2.6.0.md), and its AC pattern
// does not match the SRS checkbox form `- [ ] AC-<n>:`.
describe("verify-r3 — prd-quote passes requirement grammar written by the agent", () => {
  const cases: ReadonlyArray<readonly [string, string]> = [
    ["a valid Requirement ID with a hyphenated scope", "저장소 요구는 FR-RBAC-STORE-001 로 둔다."],
    ["a valid four-digit Requirement ID", "저장소 요구는 FR-RBAC-0001 로 둔다."],
    ["an SRS checkbox acceptance criterion line", "- [ ] AC-1: 파일 스토어는 PostgreSQL 테이블을 만든다."],
  ];
  for (const root of RENDERINGS) {
    const js = quoteCommand(read(`${root}/kiwi-prd/SKILL.md`));
    for (const [name, line] of cases) {
      it(`${root}: fails on ${name} in a proposal`, () => {
        expect(run(js, fixture).status, "fixture must pass first").toBe(0);
        const result = run(js, withProposalLine(line));
        expect(result.status, `exit 0 on: ${line}\n${result.stdout}`).toBe(1);
      });
    }
  }
});

// @req FR-FLOW-205 AC-3 — "a round whose prd_items[] length differs from the PRD item count SHALL
// NOT pass". kiwi-prd says the count is what prd-quote prints; kiwi-srs's core block says it is the
// number of lines starting `### PRD-`. A `### PRD-9` block written after `## 3. Approval` is never
// validated by prd-quote (it only scans `## 2. Items`), yet kiwi-srs counts it as an item a
// requirement may cite — e.g. an in-scope "DB 별 테이블 생성" item quoting "DB로 붙일 수 있게".
describe("verify-r3 — prd-quote accepts a PRD item outside `## 2. Items` that kiwi-srs counts", () => {
  const stray = `${fixture.trimEnd()}\n\n### PRD-9 — DB 별 테이블 생성\n\n| Field | Value |\n|---|---|\n| Kind | in-scope |\n| Source | U-1 |\n| State | confirmed |\n\n> 사용자가 상속 받아서 DB로 붙일 수 있게\n`;
  const headingLines = stray.split("\n").filter((line) => line.startsWith("### PRD-")).length;
  for (const root of RENDERINGS) {
    it(`${root}: either fails or prints the same count kiwi-srs uses`, () => {
      const result = run(quoteCommand(read(`${root}/kiwi-prd/SKILL.md`)), stray);
      const printed = Number(/^(\d+) items$/m.exec(result.stdout)?.[1] ?? "-1");
      expect(result.status === 1 || printed === headingLines, `exit ${result.status}, printed ${printed}, kiwi-srs counts ${headingLines}`).toBe(true);
    });
  }
});
