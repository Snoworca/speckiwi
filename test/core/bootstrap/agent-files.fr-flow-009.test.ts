import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  AGENT_INSTRUCTION_END_MARKER,
  AGENT_INSTRUCTION_HEADING_PREFIX,
  AGENT_INSTRUCTION_VERSION,
  BUNDLED_SRS_RULES_FILENAME,
  renderAgentInstructionSnippet
} from "../../../src/core/bootstrap/templates.js";
import { initProject } from "../../../src/core/bootstrap/init-project.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";

/** FR-FLOW-009 — canonical root agent instruction files. */

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..");

async function emptyRepo(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "speckiwi-agent-files-"));
  await mkdir(path.join(root, ".git"), { recursive: true });
  return root;
}

function count(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

describe("FR-FLOW-009 AC-2 — init upserts the block by versioned heading and marker, not by a rules link", () => {
  it("FR-FLOW-009 AC-2: a file that already links the rules document but carries an older block gets the current block", async () => {
    const rootPath = await emptyRepo();
    const old = renderAgentInstructionSnippet({ version: "1.4" });
    const withLink = [
      "# My Project",
      "",
      `For detailed SRS structure and authoring rules, read [rules](docs/rule/${BUNDLED_SRS_RULES_FILENAME}).`,
      "",
      old,
      ""
    ].join("\n");
    await writeFile(path.join(rootPath, "AGENTS.md"), withLink, "utf8");

    const result = await initProject(await resolveProjectRoot(rootPath), {});
    expect(result.ok).toBe(true);
    const agents = await readFile(path.join(rootPath, "AGENTS.md"), "utf8");
    expect(agents).toContain(`${AGENT_INSTRUCTION_HEADING_PREFIX}${AGENT_INSTRUCTION_VERSION}`);
    expect(agents).not.toContain(`${AGENT_INSTRUCTION_HEADING_PREFIX}1.4\n`);
    expect(count(agents, AGENT_INSTRUCTION_END_MARKER)).toBe(1);
    expect(agents).toContain(`read [rules](docs/rule/${BUNDLED_SRS_RULES_FILENAME})`);
  });
});

describe("FR-FLOW-009 AC-4 — lowercase agents.md is documented as a compatibility mirror", () => {
  /** The sentence the root AGENTS.md uses to say what the lowercase file is. */
  const MIRROR = /Lowercase `agents\.md` is kept as a compatibility mirror/;

  it("FR-FLOW-009 AC-4: AGENTS.md states that lowercase agents.md is a compatibility mirror, and git tracks both", async () => {
    const agents = await readFile(path.join(REPO_ROOT, "AGENTS.md"), "utf8");
    expect(agents).toMatch(MIRROR);
    const tracked = execFileSync("git", ["ls-files", "--", "AGENTS.md", "agents.md"], { cwd: REPO_ROOT, encoding: "utf8" })
      .split(/\r?\n/)
      .filter(Boolean);
    expect(tracked.sort()).toEqual(["AGENTS.md", "agents.md"]);
  });

  it("FR-FLOW-009 AC-4: the check fails on a copy without the statement (negative control)", async () => {
    const agents = await readFile(path.join(REPO_ROOT, "AGENTS.md"), "utf8");
    expect(agents.replace(MIRROR, "")).not.toMatch(MIRROR);
  });
});
