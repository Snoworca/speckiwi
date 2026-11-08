import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { checkPrd, parsePrd } from "../../src/core/prd/index.js";
import { buildPrd, DEFAULT_ITEMS } from "../core/prd/prd-fixture.js";

// FR-NODE-262 AC-2 — every kiwi-srs and kiwi-prd rendering counts PRD items as the `### PRD-` heading
// lines outside fenced code, the count the PRD reader returns, and the prd-quote command they ship
// prints that count. The command is not pinned but RUN against PRDs whose item bodies and Approval
// section hold fenced `## `, `### ` and `### PRD-` lines, and its count is compared with parsePrd.

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const RENDERINGS = ["skills/claude", "skills/codex", "skills/etc", ".agents/skills"] as const;
const read = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8").replace(/\r\n/g, "\n");

const SRS_SENTENCE = "PRD 항목 수는 코드 블록과 HTML 주석 밖의 `### PRD-` 제목 줄 수다 — PRD 리더가 돌려주고 `kiwi-prd` 의 `prd-quote` 명령이 출력하는 수다.";
const PRD_SENTENCE = "`## 2. Items` 밖의 `### PRD-` 줄을 검사하고 항목 수(PRD 리더처럼 코드·주석 밖 제목 수)를 출력";
const RETIRED = "PRD 항목 수는 `### PRD-` 로 시작하는 줄의 수다.";

const FENCE = "```";
const PATH = "docs/prd/2026-11-08.count.prd.md";

function withFirstItemBody(body: string[]): string {
  return buildPrd({ items: [{ ...DEFAULT_ITEMS[0]!, body: body.join("\n") }, ...DEFAULT_ITEMS.slice(1)] });
}

const VARIANTS: Array<[string, string]> = [
  ["a fenced `## ` line in an item body", withFirstItemBody(["Example:", "", `${FENCE}md`, "## Not a section", FENCE])],
  ["a fenced `### ` line in an item body", withFirstItemBody(["Example:", "", `${FENCE}md`, "### Example heading", FENCE])],
  ["a fenced `### PRD-` line in an item body", withFirstItemBody(["Example:", "", "~~~", "### PRD-9 — fenced example", "~~~"])],
  ["a fenced `### PRD-` line in the Approval section", buildPrd().replace("## 3. Approval\n", `## 3. Approval\n\n${FENCE}\n### PRD-9 — fenced example\n${FENCE}\n`)],
  ["a longer fence holding a shorter one", withFirstItemBody(["````md", FENCE, "## Not a section", FENCE, "### PRD-7 — inner", "````"])],
  ["a fence line with an info string inside an open fence", withFirstItemBody([FENCE, `${FENCE}md`, "## Not a section", FENCE])]
];

// Fence lines the reader judges by the shared classifier (`fence.ts` `fenceAt`): a fence that never
// closes runs to the end of the document, and a backtick run whose info string holds a backtick is a
// code span, not a fence. Only the count is compared: the hidden items change the verdict on purpose.
const COUNT_ONLY_VARIANTS: Array<[string, string]> = [
  ["an item body holding a fence that never closes", buildPrd({ items: DEFAULT_ITEMS.map((item, i) => (i === 1 ? { ...item, body: ["Example:", "", `${FENCE}md`, "code that runs on"].join("\n") } : item)) })],
  ["a tilde fence that never closes, after a closed backtick fence", buildPrd({ items: DEFAULT_ITEMS.map((item, i) => (i === 1 ? { ...item, body: [FENCE, "x", FENCE, "", "~~~", "runs on"].join("\n") } : item)) })],
  ["an item body line opening with a code span, followed later by a real fence", buildPrd({
    items: DEFAULT_ITEMS.map((item, i) =>
      i === 0 ? { ...item, body: `${FENCE}speckiwi prd check${FENCE} 로 확인한다.` } : i === 2 ? { ...item, body: [`${FENCE}md`, "example", FENCE].join("\n") } : item
    )
  })],
  // HTML comment blocks, which the reader does not read either: a block runs from a line starting with
  // `<!--` through the first line holding `-->`, a block that never closes hides nothing, and whichever
  // of a fence or a comment opens first holds the other.
  ["an item commented out in an HTML comment block in the Items section", buildPrd({ extraAfterItems: ["<!--", "### PRD-5 — commented out", "", "| Field | Value |", "|---|---|", "| Kind | in-scope |", "-->", ""].join("\n") })],
  ["an item commented out on one line", buildPrd({ extraAfterItems: ["<!-- ### PRD-5 is a draft -->", "### PRD-5 — after the comment", "", "| Field | Value |", "|---|---|", "| Kind | in-scope |", ""].join("\n") })],
  ["an HTML comment that never closes, which hides nothing", withFirstItemBody(["Note:", "", "<!-- left open"])],
  ["a fence opener shown inside an HTML comment block", withFirstItemBody(["<!--", FENCE, "-->"])],
  ["an HTML comment opener shown inside a fence", buildPrd({
    items: DEFAULT_ITEMS.map((item, i) => (i === 0 ? { ...item, body: [FENCE, "<!--", FENCE].join("\n") } : i === 2 ? { ...item, body: "end -->" } : item))
  })]
];

function quoteCommand(rel: string): string {
  const lines = read(rel).split("\n");
  const at = lines.findIndex((line) => line.trim().startsWith("# prd-quote:"));
  expect(at, `${rel}: no '# prd-quote:' command line`).toBeGreaterThan(0);
  const match = /^node -e "([^"]+)" \S+$/.exec((lines[at + 1] ?? "").trim());
  expect(match, `${rel}: the prd-quote line is not a node -e command`).not.toBeNull();
  return match![1]!;
}

const scratch = mkdtempSync(path.join(os.tmpdir(), "prd-item-count-fr-node-262-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
let serial = 0;

function runQuote(script: string, text: string): { status: number | null; stdout: string } {
  serial += 1;
  const file = path.join(scratch, `variant-${serial}.prd.md`);
  writeFileSync(file, text, "utf8");
  const run = spawnSync(process.execPath, ["-e", script, file], { encoding: "utf8" });
  return { status: run.status, stdout: run.stdout };
}

function quoteCount(root: string, text: string): string {
  return runQuote(quoteCommand(`${root}/kiwi-prd/SKILL.md`), text).stdout.split("\n")[0] ?? "";
}

describe("FR-NODE-262 AC-2 — the skills count PRD items as the PRD reader does", () => {
  for (const root of RENDERINGS) {
    // @req FR-NODE-262 AC-2
    it(`${root}/kiwi-srs states the count as the heading lines outside fenced code`, () => {
      const text = read(`${root}/kiwi-srs/SKILL.md`);
      expect(text).toContain(SRS_SENTENCE);
      expect(text).not.toContain(RETIRED);
    });

    // @req FR-NODE-262 AC-2
    it(`${root}/kiwi-prd states the count as the heading lines outside fenced code`, () => {
      const text = read(`${root}/kiwi-prd/SKILL.md`);
      expect(text).toContain(PRD_SENTENCE);
    });

    for (const [label, text] of VARIANTS) {
      // @req FR-NODE-262 AC-2
      it(`${root}/kiwi-prd prd-quote prints the reader's item count and verdict for ${label}`, () => {
        const doc = parsePrd(text, PATH);
        expect(doc.items).toHaveLength(DEFAULT_ITEMS.length);
        expect(checkPrd(doc)).toEqual([]);
        const result = runQuote(quoteCommand(`${root}/kiwi-prd/SKILL.md`), text);
        expect(result.stdout.split("\n")[0]).toBe(`${doc.items.length} items`);
        expect(result.status, result.stdout).toBe(0);
      });
    }

    for (const [label, text] of COUNT_ONLY_VARIANTS) {
      // @req FR-NODE-262 AC-2
      it(`${root}/kiwi-prd prd-quote prints the reader's item count for ${label}`, () => {
        const doc = parsePrd(text, PATH);
        expect(quoteCount(root, text)).toBe(`${doc.items.length} items`);
      });
    }

    // @req FR-NODE-262 AC-2 — control: a `### PRD-` heading outside code and outside Items still fails.
    it(`${root}/kiwi-prd prd-quote still fails a \`### PRD-\` heading outside code in the Approval section`, () => {
      const text = buildPrd().replace("## 3. Approval\n", "## 3. Approval\n\n### PRD-9 — stray\n");
      const result = runQuote(quoteCommand(`${root}/kiwi-prd/SKILL.md`), text);
      expect(result.stdout).toMatch(/PRD item outside ## 2\. Items/);
      expect(result.status).toBe(1);
    });
  }
});
