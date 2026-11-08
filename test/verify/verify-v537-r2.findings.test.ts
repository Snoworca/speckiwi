import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { resolveProjectRoot } from "../../src/core/project-root.js";
import { parseWorkspace } from "../../src/core/parser/workspace-parser.js";
import { setTargetGoal } from "../../src/core/mutation/set-target-goal.js";
import { registerTarget, setTargetDescription } from "../../src/core/mutation/set-active-target.js";
import { parsePrd } from "../../src/core/prd/index.js";
import { buildPrd, DEFAULT_ITEMS } from "../core/prd/prd-fixture.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

// Independent verification of the 5.3.7 working-tree change (round 2). Each test states the behaviour
// the user's request or the requirement implies and is expected to be RED on the change.

const INDEX = path.join("docs", "spec", "00.index.md");
const FENCE = "```";
const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

async function indexWith(append: string[]): Promise<{ rootPath: string; root: Awaited<ReturnType<typeof resolveProjectRoot>> }> {
  const rootPath = await copyFixtureWorkspace("mutation-target");
  const file = path.join(rootPath, INDEX);
  const text = await readFile(file, "utf8");
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  await writeFile(file, `${text}${eol}${append.join(eol)}${eol}`, "utf8");
  return { rootPath, root: await resolveProjectRoot(rootPath) };
}

describe("R2-1 — the goal set-target-goal writes is the goal the index parser reads (FR-NODE-260 AC-2, request 1)", () => {
  it("a fenced `### Target:` example after the Target Map does not hide the goal just written", async () => {
    const { root } = await indexWith([
      "## 9. Goal Format Example",
      "",
      `${FENCE}md`,
      "### Target: v1.1.0",
      "",
      "**Goal:** example goal",
      FENCE
    ]);
    const result = await setTargetGoal(root, { target: "v1.1.0", goal: "GOAL-R2-1" });
    expect(result.ok).toBe(true);
    expect((await parseWorkspace(root)).index.targetGoals["v1.1.0"]).toBe("GOAL-R2-1");
  });

  it("a fenced `## ` line between a target heading and its Goal line does not take the goal out of the block the parser reads", async () => {
    const { root } = await indexWith([
      "## 9. Target Goals",
      "",
      "### Target: v1.1.0",
      "",
      `${FENCE}md`,
      "## shown heading",
      FENCE,
      "",
      "**Goal:** old goal"
    ]);
    const result = await setTargetGoal(root, { target: "v1.1.0", goal: "GOAL-R2-2" });
    expect(result.ok).toBe(true);
    expect((await parseWorkspace(root)).index.targetGoals["v1.1.0"]).toBe("GOAL-R2-2");
  });
});

describe("R2-2 — a target description is judged the same on registration and on replacement (FR-NODE-276 AC-3, request 3)", () => {
  it("registering a target with a C1 control character in its description is refused like set-target-description refuses it", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const root = await resolveProjectRoot(rootPath);
    const before = await readFile(path.join(rootPath, INDEX), "utf8");
    const replaced = await setTargetDescription(root, { target: "v1.1.0", description: "first\u0085second" });
    expect(replaced.ok).toBe(false);
    const registered = await registerTarget(root, { target: "v9.9.9", description: "first\u0085second" });
    expect(registered.ok).toBe(false);
    expect(await readFile(path.join(rootPath, INDEX), "utf8")).toBe(before);
  });
});

// R2-3 — the prd-quote command prints the count the PRD reader returns (FR-NODE-262 AC-2).
const RENDERINGS = ["skills/claude", "skills/codex", "skills/etc", ".agents/skills"] as const;
const scratch = mkdtempSync(path.join(os.tmpdir(), "verify-v537-r2-"));
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
  const file = path.join(scratch, `r2-${serial}.prd.md`);
  writeFileSync(file, text, "utf8");
  return spawnSync(process.execPath, ["-e", script, file], { encoding: "utf8" }).stdout.split("\n")[0] ?? "";
}

function withItemBody(index: number, body: string[]): string {
  return buildPrd({ items: DEFAULT_ITEMS.map((item, i) => (i === index ? { ...item, body: body.join("\n") } : item)) });
}

const R2_3_VARIANTS: Array<[string, string]> = [
  // CommonMark: a fence inside a list item ends where the list item ends (the next column-0 heading).
  ["a list-item fence left open before the next item heading", withItemBody(0, ["- 예시:", "", `  ${FENCE}md`, "  code"])],
  // CommonMark: the column-0 closer is outside the list item, so it opens a new top-level fence.
  ["a list-item fence closed at column 0", withItemBody(0, ["- 예시:", "", `  ${FENCE}md`, "  ## shown", FENCE])]
];

describe("R2-3 — prd-quote prints the PRD reader's item count (FR-NODE-262 AC-2)", () => {
  for (const root of RENDERINGS) {
    for (const [label, text] of R2_3_VARIANTS) {
      // declared limit, 5.3.7 lead decision: FR-NODE-262 AC-2 declares that the one-line prd-quote
      // command does not model a fence opened inside a list item or blockquote; `speckiwi prd check`
      // is the count that holds. Kept as it.fails so a change that closes the gap turns it red.
      it.fails(`${root}/kiwi-prd prd-quote count equals parsePrd for ${label}`, () => {
        const doc = parsePrd(text, "docs/prd/2026-11-08.r2.prd.md");
        expect(quoteCount(quoteCommand(`${root}/kiwi-prd/SKILL.md`), text)).toBe(`${doc.items.length} items`);
      });
    }
  }
});
