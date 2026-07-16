import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { mkdtemp } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { diagnoseHealth } from "../../../src/core/health/doctor.js";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

// FR-NODE-083 — doctor detects codex skills mirror drift.
//
// Red-phase suite: one test case per acceptance criterion (AC-1..AC-4). The suite
// fails while diagnoseHealth carries no mirror check, until the green step adds the
// source-derived comparison between the bundled codex skills tree and the workspace
// .agents/skills install mirror.
//
// Contract under test (docs/spec/50.nodejs-implementation.srs.md FR-NODE-083):
//   - AC-1: mirror missing a source skill → warn naming it + install remediation.
//   - AC-2: mirror in sync → ok.
//   - AC-3: no .agents/skills directory → ok (not provisioned is not drift).
//   - AC-4: expected set derived by scanning the source tree (a new source skill is
//           detected without code changes).

/** Builds a fake bundled codex skills source tree with the given skill names. */
async function buildSourceTree(skills: Record<string, string>): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "speckiwi-fr-node-083-src-"));
  for (const [name, content] of Object.entries(skills)) {
    const dir = path.join(root, name);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "SKILL.md"), content, "utf8");
  }
  return root;
}

/** Installs mirror copies of the given skills under <workspace>/.agents/skills. */
async function buildMirror(workspaceRoot: string, skills: Record<string, string>): Promise<void> {
  for (const [name, content] of Object.entries(skills)) {
    const dir = path.join(workspaceRoot, ".agents", "skills", name);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "SKILL.md"), content, "utf8");
  }
}

async function mirrorCheck(root: string, sourceRoot: string) {
  const workspace = await parseWorkspace({ root });
  const report = await diagnoseHealth(workspace, { codexSkillsSourceRoot: sourceRoot });
  return report.checks.find((entry) => /mirror/i.test(entry.label));
}

describe("FR-NODE-083 — doctor codex skills mirror drift check", () => {
  it("FR-NODE-083 AC-1: a mirror missing a source skill warns with the install remediation", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    const source = await buildSourceTree({ "kiwi-alpha": "# a\n", "kiwi-beta": "# b\n" });
    await buildMirror(root, { "kiwi-alpha": "# a\n" });

    const check = await mirrorCheck(root, source);

    expect(check, "diagnoseHealth must include a codex mirror check").toBeDefined();
    expect(check?.state).toBe("warn");
    expect(check?.message).toContain("kiwi-beta");
    expect(check?.remediation).toMatch(/skills install codex all/);
  });

  it("FR-NODE-083 AC-2: an in-sync mirror reports ok", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    const source = await buildSourceTree({ "kiwi-alpha": "# a\n", "kiwi-beta": "# b\n" });
    await buildMirror(root, { "kiwi-alpha": "# a\n", "kiwi-beta": "# b\n" });

    const check = await mirrorCheck(root, source);

    expect(check).toBeDefined();
    expect(check?.state).toBe("ok");
  });

  it("FR-NODE-083 AC-3: a workspace without .agents/skills reports ok (not provisioned)", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    const source = await buildSourceTree({ "kiwi-alpha": "# a\n" });

    const check = await mirrorCheck(root, source);

    expect(check).toBeDefined();
    expect(check?.state).toBe("ok");
  });

  it("FR-NODE-083 AC-4: the expected set is derived from the source tree (divergence also warns)", async () => {
    // A skill added to the source is detected as missing without code changes.
    const root = await copyFixtureWorkspace("valid-basic");
    const source = await buildSourceTree({ "kiwi-alpha": "# a\n", "kiwi-new": "# n\n" });
    await buildMirror(root, { "kiwi-alpha": "# a\n" });
    const missing = await mirrorCheck(root, source);
    expect(missing?.state).toBe("warn");
    expect(missing?.message).toContain("kiwi-new");

    // A mirror whose SKILL.md content diverges from the source also warns.
    const divergedRoot = await copyFixtureWorkspace("valid-basic");
    const divergedSource = await buildSourceTree({ "kiwi-alpha": "# a v2\n" });
    await buildMirror(divergedRoot, { "kiwi-alpha": "# a v1\n" });
    const diverged = await mirrorCheck(divergedRoot, divergedSource);
    expect(diverged?.state).toBe("warn");
    expect(diverged?.message).toContain("kiwi-alpha");

    // An EOL-only difference (CRLF mirror vs LF source) is NOT drift — no spurious warn.
    const eolRoot = await copyFixtureWorkspace("valid-basic");
    const eolSource = await buildSourceTree({ "kiwi-alpha": "# a\nline\n" });
    await buildMirror(eolRoot, { "kiwi-alpha": "# a\r\nline\r\n" });
    const eol = await mirrorCheck(eolRoot, eolSource);
    expect(eol?.state).toBe("ok");
  });
});
