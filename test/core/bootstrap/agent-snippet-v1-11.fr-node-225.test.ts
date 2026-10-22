import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  AGENT_INSTRUCTION_END_MARKER,
  AGENT_INSTRUCTION_HEADING_PREFIX,
  AGENT_INSTRUCTION_VERSION,
  renderAgentInstructionSnippet
} from "../../../src/core/bootstrap/templates.js";
import { upsertAgentInstruction } from "../../../src/core/bootstrap/init-project.js";
import { diagnoseHealth } from "../../../src/core/health/doctor.js";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

// FR-NODE-225 — block v1.11: the tool check that installs and version-checks SpecKiwi, the review
// corrections, a content-based doctor check, and no copy of the block inside the rules document.

const { version: packageVersion } = createRequire(import.meta.url)("../../../package.json") as { version: string };
const repo = (file: string) => path.resolve(import.meta.dirname, "../../..", file);

function lines(): string[] {
  return renderAgentInstructionSnippet().split("\n");
}

function section(title: string): string {
  const all = lines();
  const start = all.indexOf(title);
  if (start === -1) return "";
  const end = all.indexOf("", start + 1);
  return all.slice(start, end === -1 ? undefined : end).join("\n");
}

describe("FR-NODE-225 — agent instruction block 1.11", () => {
  it("FR-NODE-225 AC-1: the heading carries 1.11 and the next line names the rendering package version", () => {
    expect(AGENT_INSTRUCTION_VERSION).toBe("1.11");
    const [heading, written] = lines();
    expect(heading).toBe(`${AGENT_INSTRUCTION_HEADING_PREFIX}1.11`);
    expect(written).toBe(`Written by speckiwi ${packageVersion}.`);
  });

  it("FR-NODE-225 AC-2: a tool check before the rules installs SpecKiwi from npm and runs init when the project or the MCP tools are missing", () => {
    const snippet = renderAgentInstructionSnippet();
    const check = section("SpecKiwi tool check (once per session, before the first SpecKiwi call):");
    expect(check).not.toBe("");
    expect(snippet.indexOf("SpecKiwi tool check")).toBeLessThan(snippet.indexOf("Before making any code"));
    expect(check).toContain("`speckiwi --version`");
    expect(check).toContain("`node --version`");
    expect(check).toMatch(/Node\.js 22 or newer/);
    expect(check).toMatch(/stop and report/);
    expect(check).toContain("`npm install -g speckiwi@latest`");
    expect(check).toMatch(
      /no directory from the working directory up to the git top level holds `docs\/spec\/00\.index\.md`[^\n]*propose `speckiwi init` at the git top level and run it only when the user agrees/
    );
    expect(check).toMatch(
      /no SpecKiwi MCP tools[^\n]*`speckiwi init`[^\n]*user scope[^\n]*Claude Code and Codex[^\n]*only when the user agrees[^\n]*ask the user to restart[^\n]*already present \(`skipped`\)[^\n]*still missing[^\n]*stop and report/
    );
    expect(check).toMatch(/none exists elsewhere in the repository[^\n]*`speckiwi init --dry-run` first/);
    // init rewrites the agent files and the rules documents, so it never runs without the user.
    expect(check).not.toMatch(/\brun `speckiwi init`/);
  });

  it("FR-NODE-225 AC-3: the version rule updates an older CLI, proposes upgrade for a newer one only with consent, and restarts on an MCP mismatch", () => {
    const check = section("SpecKiwi tool check (once per session, before the first SpecKiwi call):");
    expect(check).toMatch(/`Written by` version/);
    const older = check.split("\n").find((line) => line.includes("CLI is older")) ?? "";
    expect(older).toContain("`npm install -g speckiwi@latest`");
    expect(older).toMatch(/`npm view speckiwi version`[^\n]*only when that version is newer than the installed CLI/);
    expect(older).toMatch(/never install an older version/);
    // An older CLI's init or upgrade rewrites the block and the rules back to its own version.
    expect(older).toMatch(/run neither `speckiwi init` nor `speckiwi upgrade` with it/);
    const newer = check.split("\n").find((line) => line.includes("CLI is newer")) ?? "";
    expect(newer).toContain("`speckiwi upgrade --dry-run`");
    expect(newer).toMatch(/only when the user agrees/);
    expect(newer).not.toMatch(/\brun `speckiwi upgrade`(?! --dry-run)/);
    const mcp = check.split("\n").find((line) => line.includes("mcpWorkspace.packageVersion")) ?? "";
    expect(mcp).toMatch(/ask the user to restart the session once/);
    expect(mcp).toMatch(/still differ[^\n]*report both versions/);
  });

  it("FR-NODE-225 AC-4: the server binds by walking up to the nearest index and never to the home directory", () => {
    const item = lines().find((line) => line.startsWith("1. The MCP server binds")) ?? "";
    expect(item).toMatch(/nearest directory at or above its working directory/);
    expect(item).toContain("`docs/spec/00.index.md`");
    expect(item).toMatch(/never the home directory/);
    expect(renderAgentInstructionSnippet()).not.toContain("resolves its root from its own process working directory");
  });

  it("FR-NODE-225 AC-5: vibe mode is described and shares the coverage exception", () => {
    const vibe = lines().find((line) => /^\d+\. When the mode is `vibe`/.test(line)) ?? "";
    expect(vibe).toMatch(/code may come first for the Active Task/);
    expect(vibe).toMatch(/synthesized[^\n]*before the commit that lands the task/);
    expect(vibe).toContain("`check_vibe_gate`");
    expect(vibe).toContain("`speckiwi vibe-gate check`");
    expect(vibe).toMatch(/step directory exists, not that the synthesis ran/);
    expect(vibe).toMatch(/Switch to vibe only when the user asks for it/);
    const coverage = lines().find((line) => line.startsWith("5. ") && line.includes("tdd")) ?? "";
    expect(coverage).toMatch(/in vibe mode/);
  });

  it("FR-NODE-225 AC-6: the stale hedges are gone, links check is CLI only and log rows go through add_completed_work", () => {
    const snippet = renderAgentInstructionSnippet();
    expect(snippet).not.toContain("when that option is available");
    expect(snippet).not.toContain("only when the tool supports Active Target defaulting");
    expect(snippet).not.toContain("When implemented runtime CLI or MCP repair tooling is available");
    expect(snippet).toMatch(/`speckiwi links check --json` \(CLI only\)/);
    expect(snippet).toMatch(/Completed Work Log[^\n]*only with MCP `add_completed_work`/);
  });

  describe("FR-NODE-225 AC-7: doctor judges the block by its content", () => {
    let root: string;
    beforeEach(async () => {
      root = await copyFixtureWorkspace("valid-basic");
    });

    async function workflowCheck(): Promise<string | undefined> {
      const report = await diagnoseHealth(await parseWorkspace({ root }));
      return report.checks.find((check) => check.topic === "agent workflow block version currency")?.state;
    }

    it("FR-NODE-225 AC-7: a block identical to the shipped snippet is current", async () => {
      for (const file of ["AGENTS.md", "CLAUDE.md"]) await writeFile(path.join(root, file), `${renderAgentInstructionSnippet()}\n`, "utf8");
      expect(await workflowCheck()).toBe("ok");
    });

    it("FR-NODE-225 AC-7: a block whose only difference is the Written by line warns", async () => {
      const stale = renderAgentInstructionSnippet().replace(`Written by speckiwi ${packageVersion}.`, "Written by speckiwi 0.0.1.");
      expect(stale).not.toBe(renderAgentInstructionSnippet());
      await writeFile(path.join(root, "AGENTS.md"), `${renderAgentInstructionSnippet()}\n`, "utf8");
      await writeFile(path.join(root, "CLAUDE.md"), `${stale}\n`, "utf8");
      expect(await workflowCheck()).toBe("warn");
    });
  });

  it("FR-NODE-225 AC-8: the rules document points to the block instead of carrying a copy", async () => {
    const rules = await readFile(repo("docs/rule/SRS-MD-Rules-v2.5.0.md"), "utf8");
    expect(rules).not.toContain(AGENT_INSTRUCTION_HEADING_PREFIX);
    expect(rules).not.toContain(AGENT_INSTRUCTION_END_MARKER);
    expect(rules).toMatch(/AGENTS\.md[^\n]*CLAUDE\.md|CLAUDE\.md[^\n]*AGENTS\.md/);
  });

  it("FR-NODE-225 AC-9: this repository's agent files carry exactly the rendered block", async () => {
    const snippet = renderAgentInstructionSnippet();
    for (const file of ["AGENTS.md", "agents.md", "CLAUDE.md"]) {
      const text = (await readFile(repo(file), "utf8")).replace(/\r\n/g, "\n");
      expect(text, file).toContain(snippet);
    }
  });
});

describe("FR-NODE-225 AC-10: an older CLI never rewrites a block a newer one wrote", () => {
  let root: string;
  beforeEach(async () => {
    root = await copyFixtureWorkspace("valid-basic");
  });

  const newer = () => renderAgentInstructionSnippet().replace(`Written by speckiwi ${packageVersion}.`, "Written by speckiwi 999.0.0.");

  it("FR-NODE-225 AC-10: the init upsert leaves a newer block unchanged and reports it", async () => {
    const before = `# Project

${newer()}
`;
    await writeFile(path.join(root, "CLAUDE.md"), before, "utf8");
    const output = { created: [], skipped: [], updated: [], removed: [], warnings: [] as string[] };
    await upsertAgentInstruction(root, "CLAUDE.md", output);
    expect(await readFile(path.join(root, "CLAUDE.md"), "utf8")).toBe(before);
    expect(output.updated).toEqual([]);
    expect(output.warnings.some((w) => w.includes("999.0.0") && w.includes(packageVersion))).toBe(true);
  });

  it("FR-NODE-225 AC-10: doctor names the npm update instead of --fix for a newer block", async () => {
    for (const file of ["AGENTS.md", "CLAUDE.md"]) await writeFile(path.join(root, file), `${newer()}
`, "utf8");
    const report = await diagnoseHealth(await parseWorkspace({ root }));
    const check = report.checks.find((entry) => entry.topic === "agent workflow block version currency");
    expect(check?.state).toBe("warn");
    expect(`${check?.message} ${check?.remediation}`).toContain("999.0.0");
    expect(check?.remediation).toContain("npm install -g speckiwi@latest");
    expect(check?.remediation).not.toContain("--fix");
  });
});
