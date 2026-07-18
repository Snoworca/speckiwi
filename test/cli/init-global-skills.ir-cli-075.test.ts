import { access, mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";

// @req IR-CLI-075 — speckiwi init --global / -g flag provisions global skills for present agents.

function io() {
  return { stdout: new PassThrough() as NodeJS.WriteStream, stderr: new PassThrough() as NodeJS.WriteStream };
}

async function emptyRepo(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "speckiwi-init-global-cli-"));
  await mkdir(path.join(root, ".git"));
  return root;
}

async function tempHome(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "speckiwi-home-cli-"));
}

async function exists(target: string): Promise<boolean> {
  return access(target).then(() => true).catch(() => false);
}

function readJson(stream: PassThrough): { ok: boolean; value: { created: string[]; updated: string[]; skipped: string[]; removed: string[]; warnings?: string[] } } {
  return JSON.parse(stream.read()?.toString() ?? "");
}

// Override HOME/USERPROFILE/CODEX_HOME to a hermetic temp home for the duration of fn, then restore.
async function withHome<T>(home: string, fn: () => Promise<T>): Promise<T> {
  const prev = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, CODEX_HOME: process.env.CODEX_HOME };
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  delete process.env.CODEX_HOME;
  try {
    return await fn();
  } finally {
    for (const key of ["HOME", "USERPROFILE", "CODEX_HOME"] as const) {
      if (prev[key] === undefined) delete process.env[key];
      else process.env[key] = prev[key];
    }
  }
}

describe("speckiwi init --global CLI (IR-CLI-075)", () => {
  it("AC-1: init --global plans global skills for each present agent (claude + codex)", async () => {
    const root = await emptyRepo();
    const home = await tempHome();
    await mkdir(path.join(home, ".claude"));
    await mkdir(path.join(home, ".codex"));
    const streams = io();
    const code = await withHome(home, () => main(["--root", root, "init", "--global", "--no-mcp", "--dry-run", "--json"], streams));
    expect(code).toBe(0);
    const parsed = readJson(streams.stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.value.created.some((p) => p.startsWith(path.join(home, ".claude", "skills")))).toBe(true);
    expect(parsed.value.created.some((p) => p.startsWith(path.join(home, ".codex", "skills")))).toBe(true);
  }, 60000);

  it("AC-1b: -g short alias is accepted", async () => {
    const root = await emptyRepo();
    const home = await tempHome();
    await mkdir(path.join(home, ".claude"));
    await mkdir(path.join(home, ".codex"));
    const streams = io();
    const code = await withHome(home, () => main(["--root", root, "init", "-g", "--no-mcp", "--dry-run", "--json"], streams));
    expect(code).toBe(0);
    const parsed = readJson(streams.stdout);
    expect(parsed.value.created.some((p) => p.startsWith(path.join(home, ".claude", "skills")))).toBe(true);
  }, 60000);

  it("AC-2: without --global, no global skills directory is planned or touched", async () => {
    const root = await emptyRepo();
    const home = await tempHome();
    await mkdir(path.join(home, ".claude"));
    await mkdir(path.join(home, ".codex"));
    const streams = io();
    const code = await withHome(home, () => main(["--root", root, "init", "--no-mcp", "--dry-run", "--json"], streams));
    expect(code).toBe(0);
    const parsed = readJson(streams.stdout);
    // project skills still planned...
    expect(parsed.value.created.some((p) => p.includes(path.join(".claude", "skills")))).toBe(true);
    // ...but nothing under the global home.
    expect(parsed.value.created.some((p) => p.startsWith(home))).toBe(false);
  }, 60000);

  it("AC-3: --no-skills dominates --global (no skill provisioning at all)", async () => {
    const root = await emptyRepo();
    const home = await tempHome();
    await mkdir(path.join(home, ".claude"));
    await mkdir(path.join(home, ".codex"));
    const streams = io();
    const code = await withHome(home, () => main(["--root", root, "init", "--global", "--no-skills", "--no-mcp", "--dry-run", "--json"], streams));
    expect(code).toBe(0);
    const parsed = readJson(streams.stdout);
    expect(parsed.value.created.some((p) => p.startsWith(home))).toBe(false);
    expect(parsed.value.created.some((p) => p.includes(path.join(".claude", "skills")))).toBe(false);
    expect(parsed.value.created.some((p) => p.includes(path.join(".agents", "skills")))).toBe(false);
  }, 60000);

  it("AC-4: --global --dry-run writes nothing to the filesystem", async () => {
    const root = await emptyRepo();
    const home = await tempHome();
    await mkdir(path.join(home, ".claude"));
    await mkdir(path.join(home, ".codex"));
    const streams = io();
    await withHome(home, () => main(["--root", root, "init", "--global", "--no-mcp", "--dry-run", "--json"], streams));
    expect(await exists(path.join(home, ".claude", "skills"))).toBe(false);
    expect(await exists(path.join(home, ".codex", "skills"))).toBe(false);
  }, 60000);

  it("AC-5: --json output includes created/updated/skipped/removed/warnings arrays", async () => {
    const root = await emptyRepo();
    const home = await tempHome();
    await mkdir(path.join(home, ".claude"));
    await mkdir(path.join(home, ".codex"));
    const streams = io();
    await withHome(home, () => main(["--root", root, "init", "--global", "--no-mcp", "--dry-run", "--json"], streams));
    const parsed = readJson(streams.stdout);
    expect(Array.isArray(parsed.value.created)).toBe(true);
    expect(Array.isArray(parsed.value.updated)).toBe(true);
    expect(Array.isArray(parsed.value.skipped)).toBe(true);
    expect(Array.isArray(parsed.value.removed)).toBe(true);
    expect(Array.isArray(parsed.value.warnings ?? [])).toBe(true);
  }, 60000);

  it("AC: a present agent gets global skills while an absent agent is skipped with a warning", async () => {
    const root = await emptyRepo();
    const home = await tempHome();
    await mkdir(path.join(home, ".claude")); // claude present, codex absent
    const streams = io();
    await withHome(home, () => main(["--root", root, "init", "--global", "--no-mcp", "--dry-run", "--json"], streams));
    const parsed = readJson(streams.stdout);
    expect(parsed.value.created.some((p) => p.startsWith(path.join(home, ".claude", "skills")))).toBe(true);
    expect(parsed.value.created.some((p) => p.startsWith(path.join(home, ".codex", "skills")))).toBe(false);
    expect((parsed.value.warnings ?? []).some((w) => /codex/i.test(w) && /global/i.test(w))).toBe(true);
  }, 60000);
});
