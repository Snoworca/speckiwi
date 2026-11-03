import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

// Round-15 verification. kiwi-prd shows the agent's scope limits and detail defaults as proposals the
// user corrects or accepts in one reply (§2), and its grammar forces anything without a user quote to be
// `Kind=proposal` — `prd-quote` rejects an agent-drafted exclusion written as `Kind=exclusion`. When the
// user approves ("이대로 진행하세요"), those proposals become `State=confirmed`: user decisions. But the
// PRD verdicts that kiwi-srs and kiwi-tdd apply check only intent/goal/in-scope items (a) and exclusion
// items (b); a confirmed proposal is never a boundary, and the `violated` verdict in the `prd_items[]`
// enum does not enter the pass condition. A requirement that contradicts a confirmed proposal — the
// fixture's confirmed "파일 형식은 JSON", or a confirmed "DB 별 구현은 만들지 않는다" — passes the loop
// as long as it cites an in-scope item, so the approved decision is lost.

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

function coreBlock(text: string): string {
  const start = text.search(/^## 핵심 규칙/m);
  expect(start, "precondition — core rule block").toBeGreaterThanOrEqual(0);
  const end = text.indexOf("\n---\n", start);
  return text.slice(start, end < 0 ? text.length : end);
}

const scratch = mkdtempSync(path.join(os.tmpdir(), "verify-r15-prd-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
let serial = 0;
function run(js: string, content: string): { status: number | null; stdout: string } {
  const file = path.join(scratch, `p-${(serial += 1)}.prd.md`);
  writeFileSync(file, content, "utf8");
  const result = spawnSync(process.execPath, ["-e", js, file], { encoding: "utf8" });
  return { status: result.status, stdout: result.stdout };
}

// PRD-6 rewritten as an exclusion the agent drafted (no user quote), first as `Kind=exclusion`, then as
// the confirmed proposal the grammar requires instead.
const PRD6_FROM = /### PRD-6 —[\s\S]*?(?=\n### PRD-7 )/;
const AGENT_EXCLUSION = `### PRD-6 — DB 별 저장소 구현은 만들지 않는다

| Field | Value |
|---|---|
| Kind | exclusion |
| Exclusion Class | user-excluded |
| Source | U-1 |
| State | confirmed |

> DB 별 저장소 구현은 만들지 않는다
`;
const AGENT_EXCLUSION_AS_PROPOSAL = `### PRD-6 — DB 별 저장소 구현은 만들지 않는다

| Field | Value |
|---|---|
| Kind | proposal |
| Effect | exclusion |
| Reason | 요청이 저장소 구현을 사용자에게 맡긴다 |
| State | confirmed |
`;

// @req FR-FLOW-205 AC-4 — a user-confirmed proposal (an approved default or scope limit) must bind the SRS; the PRD verdicts never check it
describe("verify-r15 — a confirmed proposal is a user decision the PRD verdicts never enforce", () => {
  const fixture = read(FIXTURE);
  for (const root of RENDERINGS) {
    const prd = read(`${root}/kiwi-prd/SKILL.md`);
    const js = quoteCommand(prd);

    it(`${root}: precondition — an agent-drafted exclusion can only be a proposal, which the user confirms`, () => {
      expect(prd).toContain("세부 기본값은 묻지 않고 proposal 목록으로 보여 주어");
      expect(prd).toContain("사용자가 받아들여도 `State` 만 `confirmed` 로 바꾸며 `Kind=proposal` 은 그대로 둔다");
      expect(fixture).toMatch(/### PRD-8 — 파일 형식은 JSON\n\n\| Field \| Value \|\n\|---\|---\|\n\| Kind \| proposal \|[\s\S]*?\| State \| confirmed \|/);
      const asExclusion = run(js, fixture.replace(PRD6_FROM, AGENT_EXCLUSION));
      expect(asExclusion.status, asExclusion.stdout).toBe(1);
      expect(asExclusion.stdout).toContain("PRD-6 quote");
      const asProposal = run(js, fixture.replace(PRD6_FROM, AGENT_EXCLUSION_AS_PROPOSAL));
      expect(asProposal.status, asProposal.stdout).toBe(0);
    });

    for (const skill of ["kiwi-srs", "kiwi-tdd"] as const) {
      it(`${root}/${skill}: the core PRD verdicts make a requirement that contradicts a confirmed proposal fail or drop`, () => {
        const block = coreBlock(read(`${root}/${skill}/SKILL.md`));
        expect(block, "precondition: the block carries verdicts (a) and (b)").toMatch(/\(a\)[\s\S]*\(b\)/);
        const enforced = /(confirmed|확정)[^\n]{0,200}proposal|proposal[^\n]{0,200}(confirmed|확정)/.test(
          block.replace(/`Reason` 이 `contradiction resolved:` 로 시작하는 proposal/g, ""),
        );
        expect(enforced, `${root}/${skill}: no verdict covers a confirmed proposal`).toBe(true);
      });
    }
  }
});
