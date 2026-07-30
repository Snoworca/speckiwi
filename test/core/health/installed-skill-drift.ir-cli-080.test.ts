import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { diagnoseHealth } from "../../../src/core/health/doctor.js";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

// IR-CLI-080 — doctor reports drift between the bundled skills and the copies an agent loads.
//
// Measured motivation: on 2026-07-30 every doctor check reported ok in this repository while the
// globally installed kiwi-wave-master was 169 lines against a bundled 573, missing the run-root
// preflight gate that v2.4.2 shipped to fix the worktree blocker. A verified fix was absent from the
// environment that runs it, and the tool reported health.
//
// The home directory is injected throughout. A check that read the real home would both be
// non-deterministic and report the developer's own machine, which is not what a project's doctor is for.

const TOPIC = "installed skill drift";

interface Fixtures {
  rootPath: string;
  homeDir: string;
  claudeSource: string;
  codexSource: string;
}

/**
 * A bundled skill source tree holding one skill and one shared contract file.
 *
 * The entrypoint is `SKILL.md` for both agents, which is what the bundled tree actually ships — every
 * one of its sixteen entrypoints is uppercase. Writing `skill.md` here resolved only because Windows
 * is case-insensitive, and would not be found on a case-sensitive filesystem.
 */
async function writeSource(root: string, body: string): Promise<void> {
  await mkdir(path.join(root, "kiwi-demo"), { recursive: true });
  await writeFile(path.join(root, "kiwi-demo", "SKILL.md"), body, "utf8");
  await mkdir(path.join(root, "_shared", "kiwi"), { recursive: true });
  await writeFile(path.join(root, "_shared", "kiwi", "contract.md"), "shared contract v1\n", "utf8");
}

async function setup(): Promise<Fixtures> {
  const rootPath = await copyFixtureWorkspace("valid-basic");
  const base = await mkdtemp(path.join(tmpdir(), "speckiwi-ir-cli-080-"));
  const homeDir = path.join(base, "home");
  const claudeSource = path.join(base, "skills", "claude");
  const codexSource = path.join(base, "skills", "codex");
  await mkdir(homeDir, { recursive: true });
  await writeSource(claudeSource, "bundled demo skill\n");
  await writeSource(codexSource, "bundled demo skill\n");
  return { rootPath, homeDir, claudeSource, codexSource };
}

/** Provisions an installed destination with the given skill body, mimicking what install writes. */
async function installSkillAt(destinationRoot: string, body: string, sharedBody = "shared contract v1\n"): Promise<void> {
  await mkdir(path.join(destinationRoot, "kiwi-demo"), { recursive: true });
  await writeFile(path.join(destinationRoot, "kiwi-demo", "SKILL.md"), body, "utf8");
  await mkdir(path.join(destinationRoot, "_shared", "kiwi"), { recursive: true });
  await writeFile(path.join(destinationRoot, "_shared", "kiwi", "contract.md"), sharedBody, "utf8");
}

async function driftCheck(fixtures: Fixtures) {
  const workspace = await parseWorkspace(await resolveProjectRoot(fixtures.rootPath));
  const report = await diagnoseHealth(workspace, {
    installedSkillsHomeDir: fixtures.homeDir,
    claudeSkillsSourceRoot: fixtures.claudeSource,
    codexSkillsSourceRoot: fixtures.codexSource
  });
  const check = report.checks.find((entry) => entry.topic === TOPIC);
  expect(check, "doctor must report an installed skill drift check").toBeDefined();
  return check!;
}

describe("IR-CLI-080 AC-1 — a drifted global skill is reported", () => {
  it("warns, names the skill and names the command that refreshes the global install", async () => {
    const fixtures = await setup();
    await installSkillAt(path.join(fixtures.homeDir, ".claude", "skills"), "stale global body\n");

    const check = await driftCheck(fixtures);

    expect(check.state).toBe("warn");
    expect(check.message).toContain("kiwi-demo");
    expect(check.message).toContain("global");
    expect(check.remediation).toContain("speckiwi init");
    expect(check.remediation).toContain("--global");
  });

  it("reports ok when the global copy matches the bundled source", async () => {
    const fixtures = await setup();
    await installSkillAt(path.join(fixtures.homeDir, ".claude", "skills"), "bundled demo skill\n");

    expect((await driftCheck(fixtures)).state).toBe("ok");
  });

  it("compares the codex global destination too", async () => {
    const fixtures = await setup();
    await installSkillAt(path.join(fixtures.homeDir, ".codex", "skills"), "stale codex global\n");

    const check = await driftCheck(fixtures);

    expect(check.state).toBe("warn");
    expect(check.message).toContain("kiwi-demo");
  });
});

describe("IR-CLI-080 AC-2 — a drifted project-local skill is reported", () => {
  it("warns and names the project install command rather than the global one", async () => {
    const fixtures = await setup();
    await installSkillAt(path.join(fixtures.rootPath, ".claude", "skills"), "stale project body\n");

    const check = await driftCheck(fixtures);

    expect(check.state).toBe("warn");
    expect(check.message).toContain("kiwi-demo");
    expect(check.remediation).toContain("speckiwi init");
  });
});

describe("IR-CLI-080 AC-3 — a missing skill is distinguished from a diverged one", () => {
  it("says missing for a provisioned directory that lacks a bundled skill", async () => {
    const fixtures = await setup();
    const destination = path.join(fixtures.homeDir, ".claude", "skills");
    // Provisioned (the shared tree is present) but the skill itself was never written.
    await mkdir(path.join(destination, "_shared", "kiwi"), { recursive: true });
    await writeFile(path.join(destination, "_shared", "kiwi", "contract.md"), "shared contract v1\n", "utf8");

    const check = await driftCheck(fixtures);

    expect(check.state).toBe("warn");
    expect(check.message).toContain("missing");
    expect(check.message).not.toContain("diverged");
  });

  it("says diverged, not missing, for a skill whose body differs", async () => {
    const fixtures = await setup();
    await installSkillAt(path.join(fixtures.homeDir, ".claude", "skills"), "different body\n");

    const check = await driftCheck(fixtures);

    expect(check.message).toContain("diverged");
    expect(check.message).not.toContain("missing");
  });
});

describe("IR-CLI-080 AC-4 — an unprovisioned destination is not drift", () => {
  it("reports ok and says nothing is provisioned when no destination exists", async () => {
    const fixtures = await setup();

    const check = await driftCheck(fixtures);

    expect(check.state).toBe("ok");
    expect(check.message).toContain("no installed");
  });
});

describe("IR-CLI-080 AC-5 — a stale shared contract is reported", () => {
  it("reports a shared contract file that differs from the bundled copy", async () => {
    const fixtures = await setup();
    await installSkillAt(path.join(fixtures.homeDir, ".claude", "skills"), "bundled demo skill\n", "shared contract v0\n");

    const check = await driftCheck(fixtures);

    expect(check.state).toBe("warn");
    expect(check.message).toContain("_shared/kiwi/contract.md");
  });

  it("reports nothing when the shared contract matches", async () => {
    const fixtures = await setup();
    await installSkillAt(path.join(fixtures.homeDir, ".claude", "skills"), "bundled demo skill\n", "shared contract v1\n");

    expect((await driftCheck(fixtures)).state).toBe("ok");
  });
});

describe("IR-CLI-080 AC-6 — line endings are not drift", () => {
  it("reports ok for a copy that differs only in line endings", async () => {
    const fixtures = await setup();
    await installSkillAt(path.join(fixtures.homeDir, ".claude", "skills"), "bundled demo skill\r\n", "shared contract v1\r\n");

    expect((await driftCheck(fixtures)).state).toBe("ok");
  });
});

describe("IR-CLI-080 AC-7 — a project mirror exclusion does not silence a global install", () => {
  it("still reports the globally installed skill the project mirror excludes", async () => {
    const fixtures = await setup();
    const mirror = path.join(fixtures.rootPath, ".agents", "skills");
    await mkdir(mirror, { recursive: true });
    await writeFile(
      path.join(mirror, ".speckiwi-mirror-exclusions.json"),
      JSON.stringify({ excluded: ["kiwi-demo"], reason: "project mirror only" }),
      "utf8"
    );
    await installSkillAt(path.join(fixtures.homeDir, ".claude", "skills"), "stale global body\n");

    const check = await driftCheck(fixtures);

    expect(check.state).toBe("warn");
    expect(check.message).toContain("kiwi-demo");
  });
});

describe("IR-CLI-080 AC-8 — the home directory is injected, never read from the environment", () => {
  it("reads only the injected home, so an unrelated home produces no finding", async () => {
    const fixtures = await setup();
    // A drifted install under a DIFFERENT home must be invisible to this check.
    const otherHome = await mkdtemp(path.join(tmpdir(), "speckiwi-other-home-"));
    await installSkillAt(path.join(otherHome, ".claude", "skills"), "stale elsewhere\n");

    expect((await driftCheck(fixtures)).state).toBe("ok");
  });

  it("declares the injected home in the check so a reader knows what was compared", async () => {
    const fixtures = await setup();
    await installSkillAt(path.join(fixtures.homeDir, ".claude", "skills"), "bundled demo skill\n");

    const check = await driftCheck(fixtures);

    // The count of compared destinations makes the scope of an "ok" verifiable rather than assumed.
    expect(check.message).toMatch(/1 installed location/);
  });
});

describe("IR-CLI-080 — the bundled source is what the released package ships", () => {
  it("resolves the real bundled claude and codex trees when no source override is given", async () => {
    // A check that silently compared against nothing would report ok forever. This pins that the
    // default source roots exist in the package layout.
    // `SKILL.md`, not `skill.md`: every bundled entrypoint in git is uppercase, and the lowercase
    // spelling only resolved because Windows is case-insensitive — on CI this read would be ENOENT and
    // the assertion would fail for the wrong reason.
    const claude = path.resolve("skills", "claude", "kiwi-wave-master", "SKILL.md");
    const codex = path.resolve("skills", "codex", "kiwi-wave-master", "SKILL.md");

    await expect(readFile(claude, "utf8")).resolves.toContain("kiwi-wave-master");
    await expect(readFile(codex, "utf8")).resolves.toContain("kiwi-wave-master");
  });
});

describe("IR-CLI-080 — the codex global destination honours CODEX_HOME", () => {
  it("compares the directory init writes to when CODEX_HOME is set, not ~/.codex", async () => {
    // Found by audit: the check hardcoded `<home>/.codex/skills` while `speckiwi init --global`
    // resolves `${CODEX_HOME}/skills` when that variable is set. A user who sets it got
    // `state: ok — nothing is provisioned` over a genuinely stale install: the very failure this
    // requirement exists to prevent, reproduced inside it.
    const fixtures = await setup();
    const codexHome = await mkdtemp(path.join(tmpdir(), "speckiwi-codex-home-"));
    await installSkillAt(path.join(codexHome, "skills"), "stale codex body\n");

    const workspace = await parseWorkspace(await resolveProjectRoot(fixtures.rootPath));
    const report = await diagnoseHealth(workspace, {
      installedSkillsHomeDir: fixtures.homeDir,
      installedSkillsCodexHome: codexHome,
      claudeSkillsSourceRoot: fixtures.claudeSource,
      codexSkillsSourceRoot: fixtures.codexSource
    });
    const check = report.checks.find((entry) => entry.topic === TOPIC)!;

    expect(check.state).toBe("warn");
    expect(check.message).toContain("kiwi-demo");
  });

  it("falls back to ~/.codex/skills when CODEX_HOME is absent", async () => {
    const fixtures = await setup();
    await installSkillAt(path.join(fixtures.homeDir, ".codex", "skills"), "stale codex body\n");

    expect((await driftCheck(fixtures)).state).toBe("warn");
  });

  it("does not report the default location when CODEX_HOME points elsewhere", async () => {
    // With CODEX_HOME set, `~/.codex` is not where init writes, so a stale copy there is not the
    // installed surface and reporting it would send the reader to the wrong directory.
    const fixtures = await setup();
    await installSkillAt(path.join(fixtures.homeDir, ".codex", "skills"), "stale in the default place\n");
    const codexHome = await mkdtemp(path.join(tmpdir(), "speckiwi-codex-home-"));
    await installSkillAt(path.join(codexHome, "skills"), "bundled demo skill\n");

    const workspace = await parseWorkspace(await resolveProjectRoot(fixtures.rootPath));
    const report = await diagnoseHealth(workspace, {
      installedSkillsHomeDir: fixtures.homeDir,
      installedSkillsCodexHome: codexHome,
      claudeSkillsSourceRoot: fixtures.claudeSource,
      codexSkillsSourceRoot: fixtures.codexSource
    });

    expect(report.checks.find((entry) => entry.topic === TOPIC)!.state).toBe("ok");
  });
});
