import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { installSkill, planSkillInstall } from "../../src/core/skills/install-skill.js";
import type { SkillInstallOptions } from "../../src/core/skills/types.js";

// @req IR-CLI-086 — the command must not tell the caller something other than what the run does.
//
// Three ways it did. `skills install --global` passed no environment to the service, so it resolved
// the codex global root from the home directory while `init --global` and `doctor` both honour
// CODEX_HOME — three entry points, two destinations. The dry-run path returned the plan before the
// conflict gate, so an identical destination reported ok at exit 0 while the real run refused at
// exit 5. And `mcpPreflight` was a hardcoded `not_checked` with no other writer, while two verified
// requirements enumerate three states as though a preflight runs.

async function tempRoot(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "speckiwi-install-surface-"));
}

function options(root: string, overrides: Partial<SkillInstallOptions> = {}): SkillInstallOptions {
  return {
    projectRoot: { root },
    sourceBaseDir: path.join(root, "skills"),
    homeDir: path.join(root, "home"),
    env: {},
    agent: "claude",
    selector: "kiwi-pm",
    scope: "project",
    dryRun: false,
    ...overrides
  };
}

async function writeSourceSkill(root: string, variant: string, name: string): Promise<void> {
  const dir = path.join(root, "skills", variant, name);
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, "SKILL.md"),
    ["---", `name: ${name}`, `description: ${name} test skill`, "---", "", "# body", "", "Normal operation requires speckiwi mcp."].join("\n"),
    "utf8"
  );
}

describe("IR-CLI-086 — the install surface agrees with the run", () => {
  it("AC-1: the service honours CODEX_HOME for a global codex install", async () => {
    const root = await tempRoot();
    const codexHome = path.join(root, "codex-home");
    await writeSourceSkill(root, "codex", "kiwi-pm");

    const planned = await planSkillInstall(
      options(root, { agent: "codex", scope: "global", dryRun: true, env: { CODEX_HOME: codexHome } })
    );
    expect(planned.ok, planned.ok ? "" : planned.error.message).toBe(true);
    if (!planned.ok) return;
    expect(planned.value.destinationRoot, "the global install ignored CODEX_HOME").toBe(path.join(codexHome, "skills"));
  });

  it("AC-1: the install CLI hands the service its environment", async () => {
    // The service always honoured CODEX_HOME; the command never gave it one, which is why `init
    // --global` and `doctor` landed somewhere else. Asserted against the wiring because the plan
    // this produces depends on the caller's real environment, which a test must not depend on.
    const source = await readFile(path.resolve(__dirname, "../../src/cli/commands/skills.ts"), "utf8");
    const installCall = source.slice(source.indexOf("await installSkill({"));
    expect(installCall.slice(0, 400), "the install CLI passes no env to the service").toContain("env:");
  });

  it("AC-2: a dry-run reports the refusal the real run would report", async () => {
    const root = await tempRoot();
    const dest = path.join(root, "dest");
    await writeSourceSkill(root, "claude", "kiwi-pm");
    // A destination the run refuses: a valid body with no SpecKiwi install metadata.
    const installedDir = path.join(dest, "kiwi-pm");
    await mkdir(installedDir, { recursive: true });
    await writeFile(path.join(installedDir, "SKILL.md"), ["---", "name: kiwi-pm", "description: hand written", "---", "", "# mine"].join("\n"), "utf8");

    const dry = await installSkill(options(root, { scope: "custom", dest, dryRun: true }));
    const real = await installSkill(options(root, { scope: "custom", dest }));

    expect(real.ok, "the real run was expected to refuse").toBe(false);
    expect(dry.ok, "the dry-run reported success for a run that refuses").toBe(real.ok);
    if (dry.ok || real.ok) return;
    expect(dry.error.code).toBe(real.error.code);
  });

  it("AC-3: the preflight status reflects a check that actually runs", async () => {
    const root = await tempRoot();
    await writeSourceSkill(root, "claude", "kiwi-pm");

    const withoutMcp = await planSkillInstall(options(root, { dryRun: true }));
    expect(withoutMcp.ok).toBe(true);
    if (!withoutMcp.ok) return;
    expect(withoutMcp.value.mcpPreflight.status, "a project with no .mcp.json still reports not_checked").toBe("missing");

    await writeFile(
      path.join(root, ".mcp.json"),
      JSON.stringify({ mcpServers: { speckiwi: { command: "npx", args: ["-y", "speckiwi", "mcp"] } } }),
      "utf8"
    );
    const withMcp = await planSkillInstall(options(root, { dryRun: true }));
    expect(withMcp.ok).toBe(true);
    if (!withMcp.ok) return;
    expect(withMcp.value.mcpPreflight.status, "a registered MCP server is not detected").toBe("satisfied");
  });

  it("AC-4: a relative --dest resolves against the project root, and that is stated", async () => {
    const root = await tempRoot();
    await writeSourceSkill(root, "claude", "kiwi-pm");

    const planned = await planSkillInstall(options(root, { scope: "custom", dest: "reldest", dryRun: true }));
    expect(planned.ok, planned.ok ? "" : planned.error.message).toBe(true);
    if (!planned.ok) return;
    expect(planned.value.destinationRoot).toBe(path.join(root, "reldest"));
  });
});
