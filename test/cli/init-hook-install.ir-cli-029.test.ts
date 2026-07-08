import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";

/**
 * IR-CLI-047 — speckiwi init hook-install extension (CLI-surface verification).
 *
 * These tests drive the real `speckiwi init` command through the CLI `main()`
 * entry point (no mocks) and assert each acceptance criterion at the CLI
 * boundary: hook/scaffold installation on disk, the created/updated/skipped/
 * warned report shape, and clobber / enterprise-suppression warnings surfaced
 * in the command output.
 */

function io() {
  return { stdout: new PassThrough() as NodeJS.WriteStream, stderr: new PassThrough() as NodeJS.WriteStream };
}

interface InitReport {
  created: string[];
  skipped: string[];
  updated: string[];
  warnings: string[];
}

function readJson(stream: NodeJS.WriteStream): { ok: boolean; value: InitReport } {
  const raw = (stream as unknown as PassThrough).read();
  if (!raw) throw new Error("init command produced no JSON output on stdout");
  return JSON.parse(String(raw)) as { ok: boolean; value: InitReport };
}

async function emptyRepo() {
  const root = await mkdtemp(path.join(tmpdir(), "speckiwi-init-cli-"));
  await mkdir(path.join(root, ".git"));
  return root;
}

async function exists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

describe("IR-CLI-047 speckiwi init hook-install extension (CLI surface)", () => {
  it("IR-CLI-047 AC-1: installs the Claude, Codex, and git hooks and the docs/.kiwi scaffold", async () => {
    const root = await emptyRepo();
    const streams = io();
    const exitCode = await main(["--root", root, "init", "--json"], streams);
    expect(exitCode).toBe(0);

    const report = readJson(streams.stdout);
    expect(report.ok).toBe(true);

    const claudeSettings = path.join(root, ".claude", "settings.json");
    const codexHooks = path.join(root, ".codex", "hooks.json");
    const gitPreCommit = path.join(root, ".git", "hooks", "pre-commit");
    const kiwiState = path.join(root, "docs", "spec", "steps", "state.md");

    // Files materialise on disk (real installation, not a dry preview).
    expect(await exists(claudeSettings)).toBe(true);
    expect(await exists(codexHooks)).toBe(true);
    expect(await exists(gitPreCommit)).toBe(true);
    expect(await exists(path.join(root, "docs", ".kiwi", "hooks"))).toBe(true);
    expect(await exists(path.join(root, "docs", ".kiwi", "trace"))).toBe(true);
    expect(await exists(kiwiState)).toBe(true);

    // The git pre-commit hook delegates to the docs/.kiwi pre-commit runner.
    const hookBody = await readFile(gitPreCommit, "utf8");
    expect(hookBody).toContain("docs/.kiwi/hooks/pre-commit.mjs");

    // The Claude settings carry the PostToolUse trace hook.
    const claudeBody = await readFile(claudeSettings, "utf8");
    expect(claudeBody).toContain("PostToolUse");

    // Each installed path is reported as created by the CLI.
    expect(report.value.created).toContain(claudeSettings);
    expect(report.value.created).toContain(codexHooks);
    expect(report.value.created).toContain(gitPreCommit);
    expect(report.value.created).toContain(kiwiState);
  });

  it("IR-CLI-047 AC-2: reports created, updated, skipped, and warned paths", async () => {
    const root = await emptyRepo();

    const first = io();
    expect(await main(["--root", root, "init", "--json"], first)).toBe(0);
    const firstReport = readJson(first.stdout).value;

    // The report exposes all four buckets as arrays.
    for (const bucket of ["created", "skipped", "updated", "warnings"] as const) {
      expect(Array.isArray(firstReport[bucket])).toBe(true);
    }
    // First run actually creates paths.
    expect(firstReport.created.length).toBeGreaterThan(0);
    // Codex's "trust the repo" advisory is always warned.
    expect(firstReport.warnings.length).toBeGreaterThan(0);

    // A second run on the same root re-detects the installed hooks and reports
    // them as skipped rather than re-creating them.
    const second = io();
    expect(await main(["--root", root, "init", "--json"], second)).toBe(0);
    const secondReport = readJson(second.stdout).value;
    expect(secondReport.skipped).toContain(path.join(root, ".claude", "settings.json"));
    expect(secondReport.skipped).toContain(path.join(root, ".codex", "hooks.json"));
    expect(secondReport.skipped).toContain(path.join(root, ".git", "hooks", "pre-commit"));
    // Nothing was newly created on the idempotent second run.
    expect(secondReport.created).not.toContain(path.join(root, ".claude", "settings.json"));
  });

  it("IR-CLI-047 AC-3: surfaces clobber and enterprise-suppression warnings in its output", async () => {
    const root = await emptyRepo();

    // Pre-existing non-speckiwi pre-commit hook -> clobber warning.
    await mkdir(path.join(root, ".git", "hooks"), { recursive: true });
    await writeFile(path.join(root, ".git", "hooks", "pre-commit"), "#!/bin/sh\necho legacy\n", "utf8");
    // Claude enterprise managed settings -> enterprise-suppression warning.
    await mkdir(path.join(root, ".claude"), { recursive: true });
    await writeFile(path.join(root, ".claude", "managed-settings.json"), "{}\n", "utf8");
    // Codex managed-hooks-only policy -> enterprise-suppression warning.
    await mkdir(path.join(root, ".codex"), { recursive: true });
    await writeFile(path.join(root, ".codex", "config.toml"), "allow_managed_hooks_only = true\n", "utf8");

    const streams = io();
    expect(await main(["--root", root, "init", "--json"], streams)).toBe(0);
    const warnings = readJson(streams.stdout).value.warnings;

    // Clobber warning: the existing pre-commit hook is left untouched.
    expect(warnings.some((w) => /pre-commit/i.test(w) && /(left unchanged|overwrit)/i.test(w))).toBe(true);
    // Enterprise-suppression warnings: Claude managed settings and Codex managed-hooks-only.
    expect(warnings.some((w) => /managed-settings\.json/i.test(w) || /enterprise policy/i.test(w))).toBe(true);
    expect(warnings.some((w) => /allow_managed_hooks_only/i.test(w))).toBe(true);

    // The legacy hook was not overwritten by the speckiwi runner.
    const hookBody = await readFile(path.join(root, ".git", "hooks", "pre-commit"), "utf8");
    expect(hookBody).toContain("echo legacy");
    expect(hookBody).not.toContain("docs/.kiwi/hooks/pre-commit.mjs");
  });
});
