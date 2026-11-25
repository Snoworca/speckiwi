import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  AGENT_INSTRUCTION_HEADING_PREFIX,
  AGENT_INSTRUCTION_VERSION,
  renderAgentInstructionSnippet,
  WORKTREE_CLI_EXCEPTION,
  WORKTREE_CLI_EXCEPTION_KO
} from "../../../src/core/bootstrap/templates.js";

// @req FR-NODE-327 — block 1.14: the MCP binding does not follow a session into a worktree, and a
// worktree no session can start in is written with the CLI run from it; every skill sentence that
// calls the CLI diagnostic only carries the same exception.

const repo = (file: string) => path.resolve(import.meta.dirname, "../../..", file);
const lines = () => renderAgentInstructionSnippet().split("\n");
const item4 = () => lines().find((line) => line.startsWith("4. Every other tool refuses `workspaceRoot`")) ?? "";

describe("FR-NODE-327 AC-1 — the block is 1.14 and the repository carries it", () => {
  it("FR-NODE-327 AC-1: AGENT_INSTRUCTION_VERSION is 1.14 and the heading carries it", () => {
    expect(AGENT_INSTRUCTION_VERSION).toBe("1.14");
    expect(lines()[0]).toBe(`${AGENT_INSTRUCTION_HEADING_PREFIX}1.14`);
  });

  it.each(["CLAUDE.md", "AGENTS.md", "agents.md"])("FR-NODE-327 AC-1: the repository's own %s carries the 1.14 item 4", async (file) => {
    const text = await readFile(repo(file), "utf8");
    expect(text).toContain(`${AGENT_INSTRUCTION_HEADING_PREFIX}1.14`);
    expect(text).toContain(item4());
  });
});

describe("FR-NODE-327 AC-2 — the binding does not follow a session into a worktree", () => {
  it("FR-NODE-327 AC-2: item 4 says moving into a worktree mid-session keeps the binding", () => {
    expect(item4()).toContain("The server binds once, when the session starts, so moving into a worktree during the session leaves it bound to the checkout it started in.");
  });
});

describe("FR-NODE-327 AC-3 — the worktree CLI is the write path when no session can start there", () => {
  it("FR-NODE-327 AC-3: item 4 names the CLI run from the worktree, not --root, the doctor root check and the lane exclusion", () => {
    const item = item4();
    const cli = item.indexOf("When no agent session can be started in a worktree");
    expect(cli, "the CLI sentence").toBeGreaterThan(item.indexOf("leaves it bound"));
    const rest = item.slice(cli);
    expect(rest).toContain("a `speckiwi` CLI mutation run with that worktree as its working directory, not pointed at it with `--root` from elsewhere, is the sanctioned way to write that worktree's SRS");
    expect(rest).toContain("confirm the checkout from `workspace.root` of `speckiwi doctor --json` run there instead of from `mcpWorkspace`");
    expect(rest).toContain("An orchestrator run keeps its own rule: a lane defers its SRS writes with `--defer-srs-mutation`, and a run rooted in a worktree is opened by a session started there.");
  });

  it("FR-NODE-327 AC-3: item 6 names the identity check of the CLI path", () => {
    const item6 = lines().find((line) => line.startsWith("6. Agents MUST confirm workspace identity")) ?? "";
    expect(item6).toContain("On the CLI path of item 4 the identity is `workspace.root` of `speckiwi doctor --json` instead.");
  });

  it("FR-NODE-327 AC-3: item 4 still says writing in a worktree takes a session started there first", () => {
    expect(item4()).toContain("to write in a worktree, start an agent session in that worktree");
  });
});

describe("FR-NODE-327 AC-4 — the MCP-only paragraph names the worktree case", () => {
  it("FR-NODE-327 AC-4: the CLI exceptions include the worktree no session can start in", () => {
    const paragraph = lines().find((line) => line.includes("may use the CLI:")) ?? "";
    expect(paragraph).toContain("a worktree where no agent session can start is written with the CLI run from that worktree (Per-call workspace root item 4)");
  });
});

async function markdownFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await markdownFiles(full)));
    // MIGRATION_PLAN.md records what a past migration did; it states no rule an agent follows.
    else if (entry.name.endsWith(".md") && entry.name !== "MIGRATION_PLAN.md") out.push(full);
  }
  return out;
}

const TREES = ["skills/claude", "skills/codex", "skills/etc", ".agents/skills"];
const ENGLISH = /CLI (?:diagnostics\/remediation )?is diagnostic\/remediation only[^.]*\./;
// Verification round 2: the sentence that says no other SRS mutation goes through the CLI states the rule too.
const KOREAN_RULES = ["CLI 는 설치/버전/설정 진단과 MCP 복구 안내에만 사용하고 정상 mutation 대체 경로가 아니다.", "다른 어떤 SRS mutation 도 CLI 로 대체하지 않는다."];

describe("FR-NODE-327 AC-5 — every skill sentence that calls the CLI diagnostic only carries the exception", () => {
  it.each(TREES)("FR-NODE-327 AC-5: %s", async (tree) => {
    let english = 0;
    let korean = 0;
    for (const file of await markdownFiles(repo(tree))) {
      const text = await readFile(file, "utf8");
      for (const line of text.split(/\r?\n/)) {
        const match = ENGLISH.exec(line);
        if (match) {
          english += 1;
          expect(match[0], `${file}: ${line.slice(0, 80)}`).toContain(WORKTREE_CLI_EXCEPTION);
        }
        for (const rule of KOREAN_RULES) {
          for (let at = line.indexOf(rule); at >= 0; at = line.indexOf(rule, at + rule.length)) {
            korean += 1;
            expect(line.slice(at + rule.length).trimStart().startsWith(WORKTREE_CLI_EXCEPTION_KO), `${file}: ${line.slice(0, 80)}`).toBe(true);
          }
        }
      }
    }
    // The banner alone appears in a dozen skills of each tree; a scan that matched nothing proves nothing.
    expect(english).toBeGreaterThan(10);
    expect(korean).toBe(tree === "skills/etc" ? 1 : 3);
  });
});
