import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterAll, describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";

// @req FR-NODE-105 — the `speckiwi skills mirror --check | --write` CLI surface.
//
// The mode is required and the two modes are mutually exclusive. `--write` is the destructive
// branch, so a bare `speckiwi skills mirror` is a usage error rather than a regeneration: a typo
// must not rewrite `.agents/skills/**`, and defaulting to `--check` would make `--write` reachable
// by accident from a script that dropped its flag.

const roots: string[] = [];

afterAll(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
});

function io() {
  return { stdout: new PassThrough() as NodeJS.WriteStream, stderr: new PassThrough() as NodeJS.WriteStream };
}

function readOut(stream: PassThrough): string {
  return stream.read()?.toString() ?? "";
}

async function write(absolutePath: string, text: string): Promise<void> {
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, text, "utf8");
}

async function fixture(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "speckiwi-mirror-cli-"));
  roots.push(root);
  await mkdir(path.join(root, ".git"));
  await write(
    path.join(root, "skills", "codex", "kiwi-alpha", "SKILL.md"),
    ["---", "name: kiwi-alpha", "description: kiwi-alpha", "---", "", "# kiwi-alpha", ""].join("\n")
  );
  await write(path.join(root, "skills", "codex", "_shared", "kiwi", "waves-event.md"), "# kiwi waves event v1.4.0\n");
  await write(
    path.join(root, ".agents", "skills", ".speckiwi-mirror-exclusions.json"),
    `${JSON.stringify({ excluded: [], reason: "nothing excluded in this fixture" })}\n`
  );
  return root;
}

async function listMirror(root: string): Promise<string[]> {
  const mirror = path.join(root, ".agents", "skills");
  const files: string[] = [];
  async function walk(current: string): Promise<void> {
    for (const entry of await readdir(current, { withFileTypes: true }).catch(() => [])) {
      const absolutePath = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(absolutePath);
      else if (entry.isFile()) files.push(path.relative(mirror, absolutePath).split(path.sep).join("/"));
    }
  }
  await walk(mirror);
  return files.sort();
}

describe("speckiwi skills mirror — usage", () => {
  it("refuses with a usage error when neither --check nor --write is given, and writes nothing", async () => {
    const root = await fixture();
    const before = await listMirror(root);
    const streams = io();

    const code = await main(["--root", root, "skills", "mirror", "--json"], streams);

    expect(code).not.toBe(0);
    const parsed = JSON.parse(readOut(streams.stdout)) as { ok: boolean; error?: { code: string } };
    expect(parsed.ok).toBe(false);
    expect(parsed.error?.code).toBe("SKILLS_MIRROR_MODE_REQUIRED");
    expect(await listMirror(root), "the destructive branch must not be the default").toEqual(before);
  });

  it("refuses with a usage error when both modes are given, and writes nothing", async () => {
    const root = await fixture();
    const before = await listMirror(root);
    const streams = io();

    const code = await main(["--root", root, "skills", "mirror", "--check", "--write", "--json"], streams);

    expect(code).not.toBe(0);
    const parsed = JSON.parse(readOut(streams.stdout)) as { ok: boolean; error?: { code: string } };
    expect(parsed.error?.code).toBe("SKILLS_MIRROR_MODE_CONFLICT");
    expect(await listMirror(root)).toEqual(before);
  });

  it("documents both modes in help", async () => {
    const streams = io();
    await main(["skills", "mirror", "--help"], streams);
    const help = readOut(streams.stdout);
    expect(help).toContain("--check");
    expect(help).toContain("--write");
  });
});

describe("speckiwi skills mirror --check", () => {
  it("exits non-zero on a divergent mirror and writes nothing", async () => {
    const root = await fixture();
    const before = await listMirror(root);
    const streams = io();

    const code = await main(["--root", root, "skills", "mirror", "--check", "--json"], streams);

    expect(code).not.toBe(0);
    const parsed = JSON.parse(readOut(streams.stdout)) as { ok: boolean; value?: { divergences: Array<{ path: string }> } };
    expect(parsed.ok).toBe(false);
    expect(await listMirror(root)).toEqual(before);
  });

  it("exits zero on an in-sync mirror", async () => {
    const root = await fixture();
    expect(await main(["--root", root, "skills", "mirror", "--write", "--json"], io())).toBe(0);

    const streams = io();
    const code = await main(["--root", root, "skills", "mirror", "--check", "--json"], streams);

    expect(code).toBe(0);
    const parsed = JSON.parse(readOut(streams.stdout)) as { ok: boolean; value: { divergences: unknown[] } };
    expect(parsed.ok).toBe(true);
    expect(parsed.value.divergences).toEqual([]);
  });
});

describe("speckiwi skills mirror --write", () => {
  it("regenerates the mirror from skills/codex", async () => {
    const root = await fixture();
    const streams = io();

    const code = await main(["--root", root, "skills", "mirror", "--write", "--json"], streams);

    expect(code).toBe(0);
    // The exclusions manifest is the workspace's, not mirror content, so it survives the write.
    expect(await listMirror(root)).toEqual([".speckiwi-mirror-exclusions.json", "_shared/kiwi/waves-event.md", "kiwi-alpha/SKILL.md"]);
    expect(await readFile(path.join(root, ".agents", "skills", "_shared", "kiwi", "waves-event.md"), "utf8")).toBe(
      "# kiwi waves event v1.4.0\n"
    );
  });
});
