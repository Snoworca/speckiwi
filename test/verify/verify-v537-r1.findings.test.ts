import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { resolveProjectRoot } from "../../src/core/project-root.js";
import { parseWorkspace } from "../../src/core/parser/workspace-parser.js";
import { setTargetGoal } from "../../src/core/mutation/set-target-goal.js";
import { setSdsStatus } from "../../src/core/mutation/set-sds-status.js";
import { setTargetDescription } from "../../src/core/mutation/set-active-target.js";
import { listSteps } from "../../src/core/query/list-steps.js";
import { checkPrd, parsePrd } from "../../src/core/prd/index.js";
import { buildPrd, DEFAULT_ITEMS, DEFAULT_USER_BLOCKS } from "../core/prd/prd-fixture.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

// Independent verification of the 5.3.7 working-tree change (round 1). Each test states the
// behaviour the requirement or its writer/reader pair implies and is expected to be RED on the change.

const INDEX = path.join("docs", "spec", "00.index.md");
const FENCE = "```";
const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

describe("V1 — set-target-goal and the index parser read the same `### Target:` heading (FR-NODE-260 AC-2)", () => {
  it("a goal written under a `###  Target:` heading (two spaces) is the goal the parser reads", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const root = await resolveProjectRoot(rootPath);
    const file = path.join(rootPath, INDEX);
    const text = await readFile(file, "utf8");
    const eol = text.includes("\r\n") ? "\r\n" : "\n";
    await writeFile(file, `${text}${eol}###  Target: v1.1.0${eol}`, "utf8");
    expect((await parseWorkspace(root)).index.targetGoals["v1.1.0"]).toBeUndefined();

    const result = await setTargetGoal(root, { target: "v1.1.0", goal: "GOAL-V1" });
    expect(result.ok).toBe(true);
    expect((await parseWorkspace(root)).index.targetGoals["v1.1.0"]).toBe("GOAL-V1");
  });
});

describe("V2 — set-sds-status and list_steps read the same Status row (FR-NODE-260 AC-2)", () => {
  it("after set-sds-status writes the Status row below a fenced `## ` line, list_steps reports it", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const root = await resolveProjectRoot(rootPath);
    const steps = path.join(rootPath, "docs", "spec", "steps");
    await mkdir(path.join(steps, "t537"), { recursive: true });
    await writeFile(
      path.join(steps, "state.md"),
      ["# Step State", "", "Mode: tdd", "", "| Step | Status | DependsOn | TouchesScope | TouchesReq | Created | Updated |", "| --- | --- | --- | --- | --- | --- | --- |", "| t537 | active | - | ARCH | - | 2026-11-08 | 2026-11-08 |", ""].join("\n"),
      "utf8"
    );
    await writeFile(
      path.join(steps, "t537", "design.md"),
      ["# Step SDS — t537", "", FENCE, "## not a heading", FENCE, "", "| Field | Value |", "| --- | --- |", "| Status | draft |", "", "## Interfaces", "", "- x", ""].join("\n"),
      "utf8"
    );

    const result = await setSdsStatus(root, { task: "t537", status: "agreed" });
    expect(result.ok).toBe(true);
    const entry = (await listSteps(root)).steps.find((step) => step.step === "t537");
    expect(entry?.sdsPresent).toBe(true);
    expect(entry?.sdsStatus).toBe("agreed");
  });
});

describe("V3 — set-target-description refuses a control character (FR-NODE-276 AC-3)", () => {
  it("a C1 control character (U+0085 NEXT LINE) is refused with USAGE and nothing is written", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const before = await readFile(path.join(rootPath, INDEX), "utf8");
    const result = await setTargetDescription(await resolveProjectRoot(rootPath), { target: "v1.1.0", description: "first\u0085second" });
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.error.code).toBe("USAGE");
    expect(await readFile(path.join(rootPath, INDEX), "utf8")).toBe(before);
  });
});

describe("V4 — the Request SHA256 covers the User Request section the PRD reader reads (FR-NODE-262 AC-1)", () => {
  // declared limit, 5.3.7 lead decision: the Request SHA256 still ends the User Request section at the
  // first raw `## ` line (FR-NODE-262 Implementation Notes), so this case stays red on purpose.
  it.fails("changing user words the reader takes from the User Request section is caught by prd check", () => {
    // U-1 shows a fenced `## ` line; the reader keeps the User Request section going past it (AC-1),
    // so U-2 below it is a user block and an item may quote it.
    const blocks = [
      `### U-1 — 2026-11-04 request\n\n> 로그인 화면에 비밀번호 재설정 링크를 추가해 주세요.\n> Password reset email must expire after one hour.\n\n${FENCE}md\n## Example\n${FENCE}\n`,
      DEFAULT_USER_BLOCKS[1]!
    ];
    const approved = buildPrd({ userBlocks: blocks });
    const path0 = "docs/prd/2026-11-08.v4.prd.md";
    expect(parsePrd(approved, path0).userBlocks.map((block) => block.id)).toEqual(["U-1", "U-2"]);
    expect(checkPrd(parsePrd(approved, path0))).toEqual([]);

    // Rewrite U-2's user words and the item quoting them, keeping the approved Request SHA256 cell.
    const tampered = approved.replaceAll("소셜 로그인은 이번에 하지 않습니다.", "소셜 로그인도 이번에 합니다.");
    expect(tampered).not.toBe(approved);
    const doc = parsePrd(tampered, path0);
    expect(doc.userBlocks.map((block) => block.id)).toEqual(["U-1", "U-2"]);
    expect(checkPrd(doc).map((d) => d.code)).not.toEqual([]);
  });
});

// V5 — the prd-quote command each kiwi-prd rendering ships prints the count the PRD reader returns.
const RENDERINGS = ["skills/claude", "skills/codex", "skills/etc", ".agents/skills"] as const;
const scratch = mkdtempSync(path.join(os.tmpdir(), "verify-v537-r1-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
let serial = 0;

function quoteCommand(rel: string): string {
  const lines = readFileSync(path.join(REPO_ROOT, rel), "utf8").replace(/\r\n/g, "\n").split("\n");
  const at = lines.findIndex((line) => line.trim().startsWith("# prd-quote:"));
  const match = /^node -e "([^"]+)" \S+$/.exec((lines[at + 1] ?? "").trim());
  if (!match) throw new Error(`${rel}: no prd-quote command`);
  return match[1]!;
}

function quoteCount(script: string, text: string): string {
  serial += 1;
  const file = path.join(scratch, `v5-${serial}.prd.md`);
  writeFileSync(file, text, "utf8");
  return spawnSync(process.execPath, ["-e", script, file], { encoding: "utf8" }).stdout.split("\n")[0] ?? "";
}

function withItemBody(index: number, body: string[]): string {
  return buildPrd({ items: DEFAULT_ITEMS.map((item, i) => (i === index ? { ...item, body: body.join("\n") } : item)) });
}

const V5_VARIANTS: Array<[string, string]> = [
  ["an item body holding a fence that is never closed", withItemBody(1, ["Example:", "", `${FENCE}md`, "code that runs on"])],
  ["an item body line opening with a code span, followed later by a real fence", buildPrd({
    items: DEFAULT_ITEMS.map((item, i) =>
      i === 0 ? { ...item, body: `${FENCE}speckiwi prd check${FENCE} 로 확인한다.` } : i === 2 ? { ...item, body: [`${FENCE}md`, "example", FENCE].join("\n") } : item
    )
  })],
  ["an item commented out in an HTML comment block in the Items section", buildPrd({ extraAfterItems: ["<!--", "### PRD-5 — commented out", "", "| Field | Value |", "|---|---|", "| Kind | in-scope |", "-->", ""].join("\n") })]
];

describe("V5 — prd-quote prints the PRD reader's item count (FR-NODE-262 AC-2)", () => {
  for (const root of RENDERINGS) {
    for (const [label, text] of V5_VARIANTS) {
      it(`${root}/kiwi-prd prd-quote count equals parsePrd for ${label}`, () => {
        const doc = parsePrd(text, "docs/prd/2026-11-08.v5.prd.md");
        expect(quoteCount(quoteCommand(`${root}/kiwi-prd/SKILL.md`), text)).toBe(`${doc.items.length} items`);
      });
    }
  }
});

