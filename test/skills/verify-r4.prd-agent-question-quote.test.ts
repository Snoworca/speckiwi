import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

// Round-4 verification: the canonical fixture records the AGENT's question inside a `U-<n>` block
// ("질문: …" above "답: …"). `prd-quote` accepts any passage of a U block as the user's words, so an
// in-scope item can quote the agent's own question — here the DB-table question the user answered
// "아니요" — and pass the machine check that is meant to keep the PRD to what the user said.

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const RENDERINGS = ["skills/claude", "skills/codex", "skills/etc", ".agents/skills"] as const;
const read = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8").replace(/\r\n/g, "\n");

function quoteCommand(skillText: string): string {
  const lines = skillText.split("\n");
  const at = lines.findIndex((line) => line.trim().startsWith("# prd-quote:"));
  const match = /^node -e "([^"]+)" \S+$/.exec((lines[at + 1] ?? "").trim());
  expect(match, "no prd-quote command line").not.toBeNull();
  return match?.[1] ?? "";
}

const scratch = mkdtempSync(path.join(os.tmpdir(), "verify-r4-prd-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
let serial = 0;
function run(js: string, content: string): { status: number | null; stdout: string } {
  const file = path.join(scratch, `p-${(serial += 1)}.prd.md`);
  writeFileSync(file, content, "utf8");
  const result = spawnSync(process.execPath, ["-e", js, file], { encoding: "utf8" });
  return { status: result.status, stdout: result.stdout };
}

const fixture = read("test/fixtures/prd/rbac.prd.md");
const OLD_U2 =
  "> 질문: 파일 스토어는 실행 중에 역할·권한을 바꿔 파일에 저장하는 것까지 해야 하나요, 아니면 시작할 때 읽기만 하면 되나요?\n>\n> 답: 저장까지 해야 합니다.\n";
const NEW_U2 = "> 질문: PostgreSQL·MySQL·Oracle 테이블 생성 스크립트도 만들까요?\n>\n> 답: 아니요.\n";
const ITEM_9 = [
  "### PRD-9 — DB 별 테이블 생성",
  "",
  "| Field | Value |",
  "|---|---|",
  "| Kind | in-scope |",
  "| Source | U-2 |",
  "| State | confirmed |",
  "",
  "> PostgreSQL·MySQL·Oracle 테이블 생성 스크립트도 만들까요",
  "",
  "",
].join("\n");

function variant(): string {
  expect(fixture.includes(OLD_U2), "precondition: fixture U-2").toBe(true);
  expect(fixture.includes("## 3. Approval"), "precondition: approval section").toBe(true);
  return fixture.replace(OLD_U2, NEW_U2).replace("## 3. Approval", `${ITEM_9}## 3. Approval`);
}

describe("prd-quote does not take the agent's question as the user's words (verify-r4)", () => {
  for (const root of RENDERINGS) {
    const js = quoteCommand(read(`${root}/kiwi-prd/SKILL.md`));
    it(`${root}: precondition — the unchanged fixture passes`, () => {
      expect(run(js, fixture).status).toBe(0);
    });
    // @req FR-FLOW-204 AC-3 — a non-proposal item must quote the user's words, not the agent's question
    it(`${root}: an in-scope item quoting only the agent's question fails`, () => {
      const r = run(js, variant());
      expect(r.status, `exit ${r.status}, ${r.stdout.trim()}`).toBe(1);
    });
  }
});
