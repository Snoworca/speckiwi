import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

// @req FR-FLOW-233 — worktree-lane.md §1 says, once, that a run rooted in a worktree is opened by a
// session started there and how to open it; both orchestrating skills point to it.

const read = async (relative: string): Promise<string> => (await readFile(path.join(process.cwd(), relative), "utf8")).replace(/\r\n/g, "\n");

/** §1 of the contract: from its heading to the next horizontal rule. */
function sectionOne(text: string): string {
  const start = text.search(/^## 1\. /m);
  expect(start, "worktree-lane.md has a §1").toBeGreaterThanOrEqual(0);
  const end = text.indexOf("\n---", start);
  return text.slice(start, end < 0 ? text.length : end);
}

const KO = {
  rule: "그 워크트리의 SRS 쓰기와 그 워크트리를 run root 로 하는 run 은 그 워크트리에서 시작한 에이전트 세션이 하고, 워크트리를 만든 세션은 그 워크트리의 SRS 를 쓰지 않는다.",
  steps:
    "여는 절차: (1) 그 워크트리를 작업 디렉터리로 새 에이전트 세션을 연다, (2) 그 세션에서 `mcp_workspace_info` 의 `workspaceRoot` 가 그 워크트리인지 확인한다, (3) 그 세션에서 run 을 시작한다."
};
const EN = {
  rule: "The SRS writes of a worktree and a run whose run root is that worktree are made by an agent session started in that worktree; the session that created the worktree does not write that worktree's SRS.",
  steps:
    "To open it: (1) start a new agent session whose working directory is the worktree, (2) confirm in that session that `mcp_workspace_info` reports the worktree as `workspaceRoot`, (3) start the run in that session."
};

const CONTRACTS: Array<[string, typeof KO]> = [
  ["skills/claude/_shared/kiwi/worktree-lane.md", KO],
  ["skills/codex/_shared/kiwi/worktree-lane.md", EN],
  ["skills/etc/_shared/kiwi/worktree-lane.md", EN],
  [".agents/skills/_shared/kiwi/worktree-lane.md", EN]
];

describe("FR-FLOW-233 AC-1 AC-2 — worktree-lane.md §1 states the rule and the steps", () => {
  it.each(CONTRACTS)("%s §1 states who writes a worktree's SRS and how to open that session", async (relative, sentences) => {
    const section = sectionOne(await read(relative));
    expect(section, relative).toContain(sentences.rule);
    expect(section, relative).toContain(sentences.steps);
  });
});

/** The `run-root-preflight-mismatch` row of a skill's gate table. */
async function preflightRow(relative: string): Promise<string> {
  const row = (await read(relative)).split("\n").find((line) => line.startsWith("| `run-root-preflight-mismatch` |"));
  expect(row, `${relative} has a run-root-preflight-mismatch row`).toBeDefined();
  return row ?? "";
}

const SKILLS = ["claude", "codex", "etc"].flatMap((tree) => [`skills/${tree}/kiwi-orchestrator/SKILL.md`, `skills/${tree}/kiwi-wave-master/SKILL.md`]).concat([
  ".agents/skills/kiwi-orchestrator/SKILL.md"
]);

describe("FR-FLOW-233 AC-3 — both skills point to §1 from the preflight row without restating it", () => {
  it.each(SKILLS)("%s names the refusal's recovery and worktree-lane.md §1", async (relative) => {
    const row = await preflightRow(relative);
    expect(row, relative).toContain("복구: 거절의 `recovery` 와 `_shared/kiwi/worktree-lane.md` §1");
    expect(row, relative).not.toContain("mcp_workspace_info");
  });
});
