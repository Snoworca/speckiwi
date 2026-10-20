import { describe, expect, it } from "vitest";

import { stripFrontmatter } from "./kiwi-orchestrator-variants.js";
import { RENDERINGS, readRepoFile, skillDirs } from "./kiwi-renderings.js";

// @req FR-MCP-067 — an MCP server whose startup search finds no SRS stays unbound: it never auto-inits,
// writes nothing and refuses every call with `MCP_WORKSPACE_UNBOUND`. The skills that read
// `mcpWorkspace.rootSource` name the values the server now returns and say what to do when unbound.
// kiwi-wave-master is not mirrored, so each skill is read where the rendering ships it.

const FILES = RENDERINGS.flatMap((rendering) =>
  ["kiwi-orchestrator", "kiwi-wave-master"]
    .filter((skill) => skillDirs(rendering).includes(skill))
    .map((skill) => `${rendering}/${skill}/SKILL.md`)
);

const read = (relPath: string): string => stripFrontmatter(readRepoFile(relPath).replace(/\r\n/g, "\n"));

describe("FR-MCP-067 — the workspace identity check names the unbound state, not auto-init", () => {
  it("FR-MCP-067: reads kiwi-orchestrator in four renderings and kiwi-wave-master in three", () => {
    expect(FILES).toHaveLength(7);
  });

  it.each(FILES)("FR-MCP-067: %s no longer names auto-init as a rootSource", (relPath) => {
    expect(read(relPath).includes("auto-init"), `${relPath} still names auto-init`).toBe(false);
  });

  it.each(FILES)("FR-MCP-067: %s names the two rootSource values and the unbound refusal", (relPath) => {
    const line = read(relPath).split("\n").find((entry) => entry.includes("`mcpWorkspace.rootSource`")) ?? "";
    expect(line, `${relPath}: the workspace identity check is missing`).not.toBe("");
    expect(line).toContain("`per-call-workspace-root`");
    expect(line).toContain("`server-cwd-discovery`");
    expect(line).toMatch(/`docs\/spec\/00\.index\.md` 를 찾지 못한 서버는[^\n]*`MCP_WORKSPACE_UNBOUND`\(SRS-E077\)[^\n]*아무것도 쓰지 않는다/);
  });

  it.each(FILES)("FR-MCP-067: %s stops on MCP_WORKSPACE_UNBOUND and tells the user to restart in the project", (relPath) => {
    const line = read(relPath).split("\n").find((entry) => entry.includes("`MCP_WORKSPACE_UNBOUND` 을 받으면")) ?? "";
    expect(line, `${relPath}: says nothing about what to do when unbound`).not.toBe("");
    expect(line).toMatch(/멈추고/);
    expect(line).toMatch(/프로젝트 안에서 세션을 다시 시작하라고/);
    expect(line).toMatch(/SRS 가 없으면 먼저 그곳에서 `speckiwi init` 을 실행한 뒤 다시 시작/);
    expect(line).toMatch(/다른 도구로 재시도하지 않는다/);
  });
});
