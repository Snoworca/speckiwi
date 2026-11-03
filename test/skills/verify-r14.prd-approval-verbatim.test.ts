import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

// Round-14 verification: kiwi-prd §1 step 5 copies the user's approval sentence verbatim into
// `## 3. Approval`, and §4 requires `prd-quote` to exit 0 after every write. The command's grammar
// check exempts the U blocks and non-proposal quotes as "the user's words" but scans the approval
// section, so an approval that names a Requirement ID — "FR-FLOW-205 와 겹치지 않게, 이대로 진행하세요."
// — fails the check, and the only way to make it pass is to rewrite the user's sentence.

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const RENDERINGS = ["skills/claude", "skills/codex", "skills/etc", ".agents/skills"] as const;
const FIXTURE = "test/fixtures/prd/rbac.prd.md";
const APPROVAL = "> 사용자: 이대로 진행하세요.";
const APPROVAL_WITH_ID = "> 사용자: FR-FLOW-205 와 겹치지 않게, 이대로 진행하세요.";

const read = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8").replace(/\r\n/g, "\n");

function quoteCommand(skillText: string): string {
  const lines = skillText.split("\n");
  const at = lines.findIndex((line) => line.trim().startsWith("# prd-quote:"));
  const match = /^node -e "([^"]+)" \S+$/.exec((lines[at + 1] ?? "").trim());
  expect(match, "no prd-quote command line").not.toBeNull();
  return match?.[1] ?? "";
}

const scratch = mkdtempSync(path.join(os.tmpdir(), "verify-r14-prd-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
let serial = 0;
function run(js: string, content: string): { status: number | null; stdout: string } {
  const file = path.join(scratch, `p-${(serial += 1)}.prd.md`);
  writeFileSync(file, content, "utf8");
  const result = spawnSync(process.execPath, ["-e", js, file], { encoding: "utf8" });
  return { status: result.status, stdout: result.stdout };
}

// @req FR-FLOW-204 AC-7 — a verbatim user approval that names a Requirement ID fails prd-quote, so the user's words must be rewritten
describe("verify-r14 — prd-quote rejects the user's verbatim approval sentence", () => {
  const fixture = read(FIXTURE);
  for (const root of RENDERINGS) {
    const skill = read(`${root}/kiwi-prd/SKILL.md`);
    const js = quoteCommand(skill);
    it(`${root}: precondition — step 5 copies the approval verbatim and the fixture passes`, () => {
      expect(skill).toContain("승인 문장은 `## 3. Approval` 에 그대로 옮기고");
      expect(fixture).toContain(APPROVAL);
      expect(run(js, fixture).status).toBe(0);
    });
    it(`${root}: the same PRD whose verbatim approval names a Requirement ID still passes`, () => {
      const result = run(js, fixture.replace(APPROVAL, APPROVAL_WITH_ID));
      expect(result.status, `exit ${result.status}\n${result.stdout}`).toBe(0);
    });
  }
});
