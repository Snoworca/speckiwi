import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

// IR-CLI-112 — the CLI surface of the target rename (renameTarget) and the single-requirement
// retarget (retarget). Fixture mutation-target: Target Map v1.0.0 (active) and v1.1.0 (planned);
// FR-ARCH-001 targets v1.0.0.

const INDEX = path.join("docs", "spec", "00.index.md");
const SPEC = path.join("docs", "spec", "10.product-architecture.srs.md");

function io() {
  return { stdout: new PassThrough(), stderr: new PassThrough() };
}

function drain(stream: PassThrough): string {
  return stream.read()?.toString() ?? "";
}

async function cli(root: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const streams = io();
  const code = await main(["--root", root, ...args], streams);
  return { code, stdout: drain(streams.stdout), stderr: drain(streams.stderr) };
}

async function specTree(root: string): Promise<Record<string, string>> {
  const dir = path.join(root, "docs", "spec");
  const out: Record<string, string> = {};
  for (const name of (await readdir(dir)).sort()) {
    if (name.endsWith(".md")) out[name] = await readFile(path.join(dir, name), "utf8");
  }
  return out;
}

async function read(root: string, relative: string): Promise<string> {
  return (await readFile(path.join(root, relative), "utf8")).replace(/\r\n/g, "\n");
}

/** Error diagnostics `speckiwi validate --json` reports, as `code:message` strings. */
async function validateErrors(root: string): Promise<string[]> {
  const run = await cli(root, ["validate", "--json"]);
  const parsed = JSON.parse(run.stdout) as { errors: Array<{ code: string; message: string }> };
  return parsed.errors.map((item) => `${item.code}:${item.message}`).sort();
}

/** Writes an unexpired lock owned by another session (same shape as the IR-CLI-078 suite). */
async function holdLock(root: string): Promise<void> {
  await mkdir(path.join(root, "kiwi"), { recursive: true });
  await writeFile(
    path.join(root, "kiwi", ".srs.lock"),
    `${JSON.stringify({
      schemaVersion: "1.0.0",
      owner: "another-session",
      operation: "add_requirement",
      requestId: "held",
      acquiredAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 600_000).toISOString()
    })}\n`,
    "utf8"
  );
}

/** A goal heading for v1.0.0, so the rename has every AC-1 site to rewrite. */
async function withGoal(root: string): Promise<string> {
  const file = path.join(root, INDEX);
  const text = await readFile(file, "utf8");
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  await writeFile(file, text.replace(`## 4. Scope Map`, `### Target: v1.0.0${newline}${newline}**Goal:** Ship v1.${newline}${newline}## 4. Scope Map`), "utf8");
  return root;
}

describe("IR-CLI-112 — rename-target command", () => {
  // @req IR-CLI-112 AC-1
  it("AC-1: --from/--to with --apply rewrites every site that names the old target and reports each", async () => {
    const root = await withGoal(await copyFixtureWorkspace("mutation-target"));
    const run = await cli(root, ["rename-target", "--from", "v1.0.0", "--to", "v2.0.0", "--apply", "--json"]);

    expect(run.code, run.stdout + run.stderr).toBe(0);
    const parsed = JSON.parse(run.stdout) as { ok: boolean; value: { dryRun: boolean; written: boolean; locations: Array<{ kind: string; file: string }> } };
    expect(parsed.ok).toBe(true);
    expect(parsed.value.written).toBe(true);
    expect(parsed.value.locations.map((item) => item.kind).sort()).toEqual(
      ["active-target", "requirement-target", "target-goal-heading", "target-map-row"]
    );
    const index = await read(root, INDEX);
    expect(index).toContain("| Active Target | v2.0.0 |");
    expect(index).toContain("| v2.0.0 | release | active | Fixture release |");
    expect(index).toContain("### Target: v2.0.0\n");
    expect(await read(root, SPEC)).toContain("| Target | v2.0.0 |");
    expect(await read(root, SPEC)).not.toContain("| Target | v1.0.0 |");
  });

  // @req IR-CLI-112 AC-2
  it("AC-2: an already registered new name or an unregistered old name is refused with a diagnostic, writing nothing", async () => {
    for (const [from, to, code, diagnostic] of [
      ["v1.0.0", "v1.1.0", "MUTATION_DENIED", "SRS-E022"],
      ["v9.9.9", "v2.0.0", "NOT_FOUND", "SRS-W002"]
    ] as const) {
      const root = await copyFixtureWorkspace("mutation-target");
      const before = await specTree(root);
      const run = await cli(root, ["rename-target", "--from", from, "--to", to, "--apply", "--json"]);
      expect(run.code, `${from}->${to}`).toBe(5);
      const parsed = JSON.parse(run.stdout) as { ok: boolean; error: { code: string }; diagnostics: Array<{ code: string }> };
      expect(parsed.ok).toBe(false);
      expect(parsed.error.code).toBe(code);
      expect(parsed.diagnostics.map((item) => item.code)).toContain(diagnostic);
      expect(await specTree(root)).toEqual(before);
    }
  });

  // @req IR-CLI-112 AC-4
  it("AC-4: without --apply, and with --dry-run, the command reports the locations and writes nothing", async () => {
    for (const flags of [[], ["--dry-run"]]) {
      const root = await withGoal(await copyFixtureWorkspace("mutation-target"));
      const before = await specTree(root);
      const run = await cli(root, ["rename-target", "--from", "v1.0.0", "--to", "v2.0.0", ...flags, "--json"]);
      expect(run.code, run.stdout + run.stderr).toBe(0);
      const parsed = JSON.parse(run.stdout) as { value: { dryRun: boolean; written: boolean; locations: unknown[] } };
      expect(parsed.value.dryRun, flags.join(" ")).toBe(true);
      expect(parsed.value.written).toBe(false);
      expect(parsed.value.locations).toHaveLength(4);
      expect(await specTree(root)).toEqual(before);
    }
  });

  // @req IR-CLI-112 AC-4
  it("AC-4: --apply together with --dry-run is refused as a usage error, writing nothing", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    const before = await specTree(root);
    const run = await cli(root, ["rename-target", "--from", "v1.0.0", "--to", "v2.0.0", "--apply", "--dry-run"]);
    expect(run.code).toBe(2);
    expect(await specTree(root)).toEqual(before);
  });

  // @req IR-CLI-112 AC-1
  it("AC-1: runs under the SRS mutation lock, which --ignore-lock bypasses", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    await holdLock(root);
    const blocked = await cli(root, ["rename-target", "--from", "v1.0.0", "--to", "v2.0.0", "--apply", "--json"]);
    expect(blocked.code, blocked.stdout).toBe(5);
    expect(await read(root, SPEC)).toContain("| Target | v1.0.0 |");
    const bypassed = await cli(root, ["rename-target", "--from", "v1.0.0", "--to", "v2.0.0", "--apply", "--ignore-lock", "--json"]);
    expect(bypassed.code, bypassed.stdout + bypassed.stderr).toBe(0);
    expect(await read(root, SPEC)).toContain("| Target | v2.0.0 |");
  });

  // @req IR-CLI-112 AC-4
  it("AC-4: validate reports zero new errors after an applied rename", async () => {
    const root = await withGoal(await copyFixtureWorkspace("mutation-target"));
    const before = await validateErrors(root);
    const run = await cli(root, ["rename-target", "--from", "v1.0.0", "--to", "v2.0.0", "--apply", "--json"]);
    expect(run.code, run.stdout).toBe(0);
    expect(await validateErrors(root)).toEqual(before);
  });
});

describe("IR-CLI-112 — retarget of one requirement", () => {
  // @req IR-CLI-112 AC-3
  it("AC-3: --id and a registered --to, with no --from, change only that Target field and add a Change Notes row naming both targets", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    const before = (await read(root, SPEC)).split("\n");
    const run = await cli(root, ["retarget", "--id", "FR-ARCH-001", "--to", "v1.1.0", "--reason", "next release", "--apply", "--json"]);

    expect(run.code, run.stdout + run.stderr).toBe(0);
    const after = (await read(root, SPEC)).split("\n");
    expect(before.filter((line) => !after.includes(line))).toEqual(["| Target | v1.0.0 |"]);
    const added = after.filter((line) => !before.includes(line));
    expect(added).toHaveLength(2);
    expect(added[0]).toBe("| Target | v1.1.0 |");
    expect(added[1]).toMatch(/^\| \d{4}-\d{2}-\d{2} \| Target v1\.0\.0 -> v1\.1\.0 \| next release \|$/);
  });

  // @req IR-CLI-112 AC-3
  it("AC-3: neither --from nor --id is a usage error, writing nothing", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    const before = await specTree(root);
    const run = await cli(root, ["retarget", "--to", "v1.1.0", "--reason", "x", "--apply", "--json"]);
    expect(run.code).toBe(2);
    expect(run.stdout + run.stderr).toMatch(/--from|--id/);
    expect(await specTree(root)).toEqual(before);
  });

  // @req IR-CLI-112 AC-3
  it("AC-3: an --id outside the --from/--scope/--status/--type selection is refused with exit 5, writing nothing", async () => {
    for (const filter of [["--from", "v1.1.0"], ["--scope", "NOPE"], ["--status", "verified"], ["--type", "interface"]]) {
      const root = await copyFixtureWorkspace("mutation-target");
      const before = await specTree(root);
      const run = await cli(root, ["retarget", ...filter, "--id", "FR-ARCH-001", "--to", "v1.1.0", "--reason", "x", "--apply", "--json"]);
      expect(run.code, filter.join(" ")).toBe(5);
      const parsed = JSON.parse(run.stdout) as { ok: boolean; error: { message: string } };
      expect(parsed.ok).toBe(false);
      expect(parsed.error.message).toContain("FR-ARCH-001");
      expect(await specTree(root), filter.join(" ")).toEqual(before);
    }
  });

  // @req IR-CLI-112 AC-3
  it("AC-3: an unregistered --from is refused with NOT_FOUND and exit 5, on argv and through --input-json, writing nothing", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    const before = await specTree(root);
    const viaArgv = await cli(root, ["retarget", "--from", "v9.9.9", "--to", "v1.1.0", "--reason", "x", "--apply", "--json"]);
    expect(viaArgv.code, viaArgv.stdout).toBe(5);
    expect((JSON.parse(viaArgv.stdout) as { error: { code: string; message: string } }).error).toMatchObject({ code: "NOT_FOUND" });
    expect(viaArgv.stdout).toContain("v9.9.9");

    const payload = JSON.stringify({ from: "v9.9.9", to: "v1.1.0", reason: "x", apply: true });
    const viaJson = await cli(root, ["retarget", "--input-json", payload, "--json"]);
    expect(viaJson.code, viaJson.stdout + viaJson.stderr).toBe(5);
    expect(await specTree(root)).toEqual(before);
  });

  // @req IR-CLI-112 AC-3
  it("AC-3: an --id inside the selection still moves", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    const run = await cli(root, ["retarget", "--from", "v1.0.0", "--scope", "ARCH", "--id", "FR-ARCH-001", "--to", "v1.1.0", "--reason", "x", "--apply", "--json"]);
    expect(run.code, run.stdout + run.stderr).toBe(0);
    expect(await read(root, SPEC)).toContain("| Target | v1.1.0 |");
  });

  // @req IR-CLI-112 AC-3
  it("AC-3: an --id no requirement holds refuses the whole move with exit 5, even beside one that exists", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    const before = await specTree(root);
    const run = await cli(root, ["retarget", "--id", "FR-ARCH-001", "--id", "FR-NOPE-001", "--to", "v1.1.0", "--reason", "x", "--apply", "--json"]);
    expect(run.code, run.stdout).toBe(5);
    const parsed = JSON.parse(run.stdout) as { ok: boolean; error: { code: string; message: string } };
    expect(parsed.error.code).toBe("NOT_FOUND");
    expect(parsed.error.message).toContain("FR-NOPE-001");
    expect(await specTree(root)).toEqual(before);
  });

  // @req IR-CLI-112 AC-4
  it("AC-4: retarget --dry-run previews and writes nothing, and --dry-run with --apply is refused", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    const before = await specTree(root);
    const preview = await cli(root, ["retarget", "--id", "FR-ARCH-001", "--to", "v1.1.0", "--reason", "x", "--dry-run", "--json"]);
    expect(preview.code, preview.stdout + preview.stderr).toBe(0);
    expect((JSON.parse(preview.stdout) as { value: { dryRun: boolean } }).value.dryRun).toBe(true);
    expect(await specTree(root)).toEqual(before);

    const both = await cli(root, ["retarget", "--id", "FR-ARCH-001", "--to", "v1.1.0", "--reason", "x", "--dry-run", "--apply"]);
    expect(both.code).toBe(2);
    expect(await specTree(root)).toEqual(before);
  });

  // @req IR-CLI-112 AC-4
  it("AC-4: retarget accepts --ignore-lock and passes it to the mutation", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    await holdLock(root);

    const blocked = await cli(root, ["retarget", "--id", "FR-ARCH-001", "--to", "v1.1.0", "--reason", "x", "--apply", "--json"]);
    expect(blocked.code, blocked.stdout).toBe(5);
    const bypassed = await cli(root, ["retarget", "--id", "FR-ARCH-001", "--to", "v1.1.0", "--reason", "x", "--apply", "--ignore-lock", "--json"]);
    expect(bypassed.code, bypassed.stdout + bypassed.stderr).toBe(0);
    expect(await read(root, SPEC)).toContain("| Target | v1.1.0 |");
  });

  // @req IR-CLI-112 AC-4
  it("AC-4: validate reports zero new errors after an applied retarget", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    const before = await validateErrors(root);
    const run = await cli(root, ["retarget", "--id", "FR-ARCH-001", "--to", "v1.1.0", "--reason", "x", "--apply", "--json"]);
    expect(run.code, run.stdout).toBe(0);
    expect(await validateErrors(root)).toEqual(before);
  });
});
