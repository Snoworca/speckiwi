import { chmod, cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { renameScope } from "../../src/core/mutation/rename-scope.js";
import { parseWorkspace } from "../../src/core/parser/workspace-parser.js";
import { resolveProjectRoot } from "../../src/core/project-root.js";
import { checkLinks } from "../../src/core/query/links.js";

const repo = path.resolve(__dirname, "../..");
const FROM = "10.product-architecture";
const TO = "10.product-core";
const made: string[] = [];
const locked: string[] = [];
afterEach(async () => {
  await Promise.all(locked.splice(0).map((file) => chmod(file, 0o666).catch(() => undefined)));
  await Promise.all(made.splice(0).map((dir) => rm(dir, { recursive: true, force: true, maxRetries: 5 })));
});

async function realSpecCopy(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "speckiwi-r6-"));
  made.push(dir);
  await cp(path.join(repo, "docs", "spec"), path.join(dir, "docs", "spec"), { recursive: true });
  return dir;
}

async function snapshot(dir: string): Promise<Map<string, string>> {
  const spec = path.join(dir, "docs", "spec");
  const names = (await readdir(spec, { recursive: true, withFileTypes: true })).filter((entry) => entry.isFile());
  const map = new Map<string, string>();
  for (const entry of names) {
    const full = path.join(entry.parentPath, entry.name);
    map.set(path.relative(spec, full).split(path.sep).join("/"), (await readFile(full)).toString("base64"));
  }
  return map;
}

async function broken(dir: string): Promise<string[]> {
  const workspace = await parseWorkspace(await resolveProjectRoot(dir));
  return (await checkLinks(workspace)).broken.map((b) => `${b.requirementId}|${b.code}|${b.reference}`);
}

describe("verify r6: rename rollback across several files (FR-NODE-232 AC-6)", () => {
  it("reverts every patched file, not only the move, when a later write fails", async () => {
    const dir = await realSpecCopy();
    const notes = path.join(dir, "docs", "spec", "zz.notes.md");
    await writeFile(notes, `# Notes\n\nSee [arch](./${FROM}.srs.md).\n`, "utf8");
    const before = await snapshot(dir);
    await chmod(notes, 0o444);
    locked.push(notes);
    await expect(renameScope(await resolveProjectRoot(dir), { from: FROM, to: TO, apply: true })).rejects.toThrow();
    await chmod(notes, 0o666);
    const after = await snapshot(dir);
    const changed = [...before.keys()].filter((name) => after.get(name) !== before.get(name));
    expect(changed).toEqual([]);
  });
});

describe("verify r6: trace links to the renamed document (FR-NODE-232 AC-6)", () => {
  it("leaves no Trace Link path pointing at the old document after the rename", async () => {
    const dir = await realSpecCopy();
    const file = path.join(dir, "docs", "spec", "20.parser-validation.srs.md");
    const text = await readFile(file, "utf8");
    const header = "| Type | Reference | Relation | Notes |\n| --- | --- | --- | --- |\n";
    const at = text.indexOf(header);
    expect(at).toBeGreaterThan(0);
    const patched = `${text.slice(0, at + header.length)}| Document | docs/spec/${FROM}.srs.md | relates_to | architecture |\n${text.slice(at + header.length)}`;
    await writeFile(file, patched, "utf8");
    const pre = await broken(dir);
    const result = await renameScope(await resolveProjectRoot(dir), { from: FROM, to: TO, apply: true });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    const post = await broken(dir);
    expect(post.filter((entry) => !pre.includes(entry))).toEqual([]);
  });
});

describe("verify r6: non-file entries under docs/spec", () => {
  it("ignores a directory whose name ends in .md", async () => {
    const dir = await realSpecCopy();
    await mkdir(path.join(dir, "docs", "spec", "assets.md"));
    const result = await renameScope(await resolveProjectRoot(dir), { from: FROM, to: TO });
    expect(result.ok, JSON.stringify(result)).toBe(true);
  });
});

