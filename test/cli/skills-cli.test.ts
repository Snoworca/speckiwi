import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";

function io() {
  return { stdout: new PassThrough() as NodeJS.WriteStream, stderr: new PassThrough() as NodeJS.WriteStream };
}

async function tempRoot(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "speckiwi-skills-cli-"));
}

async function writeSkill(root: string, source: "codex" | "claude" | "etc", name: string, entry = "SKILL.md"): Promise<void> {
  const skillDir = path.join(root, "skills", source, name);
  await mkdir(skillDir, { recursive: true });
  await writeFile(
    path.join(skillDir, entry),
    ["---", `name: ${name}`, `description: ${name}`, "---", "", `# ${name}`, "", "Normal operation requires speckiwi mcp."].join("\n"),
    "utf8"
  );
}

describe("skills CLI commands", () => {
  it("prints dry-run JSON with install/update semantics and MCP preflight", async () => {
    const root = await tempRoot();
    await writeSkill(root, "etc", "kiwi-pm");
    const commandIo = io();
    expect(await main(["--root", root, "skills", "install", "opencode", "kiwi-pm", "--dry-run", "--json"], commandIo)).toBe(0);
    expect(JSON.parse(commandIo.stdout.read()?.toString() ?? "")).toMatchObject({
      ok: true,
      value: {
        agent: "opencode",
        sourceRoot: path.join(root, "skills", "etc"),
        destinationRoot: path.join(root, ".opencode", "skills"),
        requiresMcp: true,
        mcpPreflight: { status: "not_checked" },
        results: [{ name: "kiwi-pm", operation: "install", changed: true }]
      }
    });
  });

  it("supports skills add alias and install-time Claude entrypoint normalization", async () => {
    const root = await tempRoot();
    await writeSkill(root, "claude", "kiwi-pm", "skill.md");
    const destinationRoot = path.join(root, "claude-dest");
    const commandIo = io();
    expect(await main(["--root", root, "skills", "add", "claude", "kiwi-pm", "--dest", destinationRoot, "--json"], commandIo)).toBe(0);
    expect(JSON.parse(commandIo.stdout.read()?.toString() ?? "")).toMatchObject({
      ok: true,
      value: { results: [{ name: "kiwi-pm", operation: "install", entrypointNormalized: true }] }
    });
    await expect(readFile(path.join(destinationRoot, "kiwi-pm", "SKILL.md"), "utf8")).resolves.toContain("name: kiwi-pm");
  });

  it("uses CLI usage errors for invalid option combinations", async () => {
    const root = await tempRoot();
    await writeSkill(root, "etc", "kiwi-pm");
    expect(await main(["--root", root, "skills", "install", "opencode", "kiwi-pm", "--global", "--dest", path.join(root, "dest")], io())).toBe(2);
    expect(await main(["--root", root, "skills", "install", "opencode", "kiwi-pm", "--category", "kiwi"], io())).toBe(2);
    expect(await main(["--root", root, "skills", "install", "unknown", "kiwi-pm"], io())).toBe(2);
  });

  it("returns structured JSON for skill command usage errors", async () => {
    const root = await tempRoot();
    await writeSkill(root, "etc", "kiwi-pm");

    const invalidAgentIo = io();
    expect(await main(["--root", root, "skills", "install", "unknown", "kiwi-pm", "--json"], invalidAgentIo)).toBe(2);
    expect(JSON.parse(invalidAgentIo.stdout.read()?.toString() ?? "")).toMatchObject({
      ok: false,
      error: { code: "SKILL_INSTALL_UNSUPPORTED_AGENT" }
    });

    const invalidScopeIo = io();
    expect(await main(["--root", root, "skills", "install", "opencode", "kiwi-pm", "--global", "--dest", path.join(root, "dest"), "--json"], invalidScopeIo)).toBe(2);
    expect(JSON.parse(invalidScopeIo.stdout.read()?.toString() ?? "")).toMatchObject({
      ok: false,
      error: { code: "SKILL_INSTALL_INVALID_OPTIONS" }
    });

    const invalidCategoryIo = io();
    expect(await main(["--root", root, "skills", "install", "opencode", "kiwi-pm", "--category", "kiwi", "--json"], invalidCategoryIo)).toBe(2);
    expect(JSON.parse(invalidCategoryIo.stdout.read()?.toString() ?? "")).toMatchObject({
      ok: false,
      error: { code: "SKILL_INSTALL_INVALID_OPTIONS" }
    });

    const missingSkillIo = io();
    expect(await main(["--root", root, "skills", "install", "opencode", "--json"], missingSkillIo)).toBe(2);
    expect(JSON.parse(missingSkillIo.stdout.read()?.toString() ?? "")).toMatchObject({
      ok: false,
      error: { code: "CLI_USAGE_ERROR" }
    });
  });

  it("plans global installs for OpenCode and Hermes without mutating user directories", async () => {
    const root = await tempRoot();
    await writeSkill(root, "etc", "kiwi-pm");

    const opencodeIo = io();
    expect(await main(["--root", root, "skills", "install", "opencode", "kiwi-pm", "-g", "--dry-run", "--json"], opencodeIo)).toBe(0);
    expect(JSON.parse(opencodeIo.stdout.read()?.toString() ?? "")).toMatchObject({
      ok: true,
      value: { agent: "opencode", scope: "global", results: [{ operation: "install" }] }
    });

    const hermesIo = io();
    expect(await main(["--root", root, "skills", "install", "hermes", "kiwi-pm", "--global", "--category", "kiwi", "--dry-run", "--json"], hermesIo)).toBe(0);
    expect(JSON.parse(hermesIo.stdout.read()?.toString() ?? "")).toMatchObject({
      ok: true,
      value: { agent: "hermes", scope: "global", results: [{ identity: { category: "kiwi" } }] }
    });
  });
});
