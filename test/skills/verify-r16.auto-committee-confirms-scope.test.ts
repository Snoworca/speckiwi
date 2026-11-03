import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

// Round-16 verification. Since the `Effect` row (round 15), a confirmed proposal whose `Effect` is
// in-scope is judged as an in-scope item: kiwi-srs and kiwi-tdd fail the round unless a requirement cites
// it. Under `--auto` no user is present, and kiwi-prd lets the FR-FLOW-025 committee "decide proposals"
// while forbidding it to "add in-scope items". Nothing stops the committee from writing a proposal with
// `Effect=in-scope` and `State=confirmed` — `prd-quote` accepts it — so the committee adds a mandatory
// in-scope item after all (e.g. "PostgreSQL 저장소 구현 기본 제공" on the RBAC request), and the SRS loop
// must author it. The two rules contradict each other and reopen the RBAC expansion in unattended runs.

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

const scratch = mkdtempSync(path.join(os.tmpdir(), "verify-r16-prd-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
let serial = 0;
function run(js: string, content: string): { status: number | null; stdout: string } {
  const file = path.join(scratch, `p-${(serial += 1)}.prd.md`);
  writeFileSync(file, content, "utf8");
  const result = spawnSync(process.execPath, ["-e", js, file], { encoding: "utf8" });
  return { status: result.status, stdout: result.stdout };
}

// The fixture turned into an `--auto` PRD with one committee-made, committee-"confirmed" scope addition.
const COMMITTEE_SCOPE = `### PRD-9 — PostgreSQL 저장소 구현 기본 제공

| Field | Value |
|---|---|
| Kind | proposal |
| Effect | in-scope |
| Reason | 결정 위원회: 사용자가 바로 쓰기 편하다 |
| State | confirmed |

`;
function autoPrd(fixture: string): string {
  return fixture
    .replace("| Status | approved |", "| Status | unapproved |")
    .replace("| Approved | 2026-11-03 |", "| Approved | --auto |")
    .replace("\n## 3. Approval", `\n${COMMITTEE_SCOPE}## 3. Approval`);
}

/** Sentences (split on Korean sentence end) that name the decision committee. */
const committeeSentences = (text: string): string[] =>
  text.split(/다\.\s|\n/).filter((s) => s.includes("결정 위원회") && s.includes("proposal"));

// @req FR-FLOW-204 AC-5 — under --auto the committee must not add in-scope items, yet it may confirm an Effect=in-scope proposal, which the PRD verdicts treat as an in-scope item
describe("verify-r16 — under --auto the committee can add a mandatory in-scope item through a confirmed Effect=in-scope proposal", () => {
  const fixture = read(FIXTURE);
  for (const root of RENDERINGS) {
    const prd = read(`${root}/kiwi-prd/SKILL.md`);
    const srs = read(`${root}/kiwi-srs/SKILL.md`);

    it(`${root}: precondition — prd-quote accepts a committee-confirmed Effect=in-scope proposal in an --auto PRD, and kiwi-srs judges it as in-scope`, () => {
      const result = run(quoteCommand(prd), autoPrd(fixture));
      expect(result.status, result.stdout).toBe(0);
      expect(result.stdout).toContain("9 items");
      expect(srs).toContain("`Effect` 가 in-scope 인 확정 proposal 은 in-scope 항목처럼 이 fail 검사를 받는다.");
      expect(prd).toContain("결정 위원회는 proposal 만 정할 수 있고 in-scope 항목을 더하거나 exclusion 항목을 지우지 못한다");
    });

    it(`${root}: kiwi-prd's --auto rule keeps a committee proposal from becoming a confirmed in-scope item`, () => {
      const restricted = committeeSentences(prd).some((s) => /\bState\b|\bEffect\b|confirmed|proposed|확정/.test(s));
      expect(restricted, `${root}/kiwi-prd: committee may confirm an Effect=in-scope proposal`).toBe(true);
    });
  }

  it("FR-FLOW-204 AC-5: the committee limit also covers confirming an Effect=in-scope proposal", () => {
    const shown = spawnSync(process.execPath, [path.join(REPO_ROOT, "bin/speckiwi"), "show", "FR-FLOW-204", "--json"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    const ac5 = (JSON.parse(shown.stdout).acceptanceCriteria as { id: string; text: string }[]).find((a) => a.id === "AC-5");
    expect(ac5?.text, "precondition: AC-5").toContain("the decision committee SHALL NOT add in-scope items");
    expect(ac5?.text ?? "", "AC-5 lets the committee confirm an Effect=in-scope proposal").toMatch(/confirm|Effect/);
  });
});
