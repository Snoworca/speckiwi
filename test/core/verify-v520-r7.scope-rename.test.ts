import { chmod, cp, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
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
  const dir = await mkdtemp(path.join(tmpdir(), "speckiwi-r7-"));
  made.push(dir);
  await cp(path.join(repo, "docs", "spec"), path.join(dir, "docs", "spec"), { recursive: true });
  return dir;
}

async function specEntries(dir: string): Promise<string[]> {
  const spec = path.join(dir, "docs", "spec");
  return (await readdir(spec, { recursive: true, withFileTypes: true }))
    .map((entry) => path.relative(spec, path.join(entry.parentPath, entry.name)).split(path.sep).join("/"))
    .sort();
}

async function broken(dir: string): Promise<string[]> {
  const workspace = await parseWorkspace(await resolveProjectRoot(dir));
  return (await checkLinks(workspace)).broken.map((b) => `${b.requirementId}|${b.code}|${b.reference}`);
}

async function patchFirstRelatedDocs(dir: string, value: string): Promise<void> {
  const file = path.join(dir, "docs", "spec", "20.parser-validation.srs.md");
  const text = await readFile(file, "utf8");
  const row = "| Related Docs | - |";
  expect(text.includes(row)).toBe(true);
  await writeFile(file, text.replace(row, `| Related Docs | ${value} |`), "utf8");
}

async function addTraceRow(dir: string, reference: string): Promise<string> {
  const file = path.join(dir, "docs", "spec", "20.parser-validation.srs.md");
  const text = await readFile(file, "utf8");
  const header = "| Type | Reference | Relation | Notes |\n| --- | --- | --- | --- |\n";
  const at = text.indexOf(header);
  expect(at).toBeGreaterThan(0);
  await writeFile(file, `${text.slice(0, at + header.length)}| Document | ${reference} | relates_to | architecture |\n${text.slice(at + header.length)}`, "utf8");
  return file;
}

describe("verify r7: a failed rename leaves docs/spec as it was (FR-NODE-232 AC-6)", () => {
  it("leaves no temporary file behind when a write fails", async () => {
    const dir = await realSpecCopy();
    const notes = path.join(dir, "docs", "spec", "zz.notes.md");
    await writeFile(notes, `# Notes\n\nSee [arch](./${FROM}.srs.md).\n`, "utf8");
    const before = await specEntries(dir);
    await chmod(notes, 0o444);
    locked.push(notes);
    await expect(renameScope(await resolveProjectRoot(dir), { from: FROM, to: TO, apply: true })).rejects.toThrow();
    expect(await specEntries(dir)).toEqual(before);
  });
});

describe("verify r7: references links check resolves on a case-insensitive file system (FR-NODE-232 AC-6)", () => {
  it.runIf(process.platform === "win32")("adds no broken Related Docs reference when the entry spells the file name in other case", async () => {
    const dir = await realSpecCopy();
    await patchFirstRelatedDocs(dir, "[arch](10.Product-Architecture.srs.md)");
    const pre = await broken(dir);
    const result = await renameScope(await resolveProjectRoot(dir), { from: FROM, to: TO, apply: true });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect((await broken(dir)).filter((entry) => !pre.includes(entry))).toEqual([]);
  });

  it.runIf(process.platform === "win32")("adds no broken Trace Link path when the reference spells the file name in other case", async () => {
    const dir = await realSpecCopy();
    await addTraceRow(dir, "docs/spec/10.Product-Architecture.srs.md");
    const pre = await broken(dir);
    const result = await renameScope(await resolveProjectRoot(dir), { from: FROM, to: TO, apply: true });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect((await broken(dir)).filter((entry) => !pre.includes(entry))).toEqual([]);
  });
});

describe("verify r7: Trace Link rewrite keeps the reference as written (FR-NODE-232 AC-6)", () => {
  it("does not expand `$&` in an anchor into the old reference", async () => {
    const dir = await realSpecCopy();
    const file = await addTraceRow(dir, `docs/spec/${FROM}.srs.md#a$&b`);
    const result = await renameScope(await resolveProjectRoot(dir), { from: FROM, to: TO, apply: true });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    const text = await readFile(file, "utf8");
    expect(text).toContain(`| Document | docs/spec/${TO}.srs.md#a$&b | relates_to | architecture |`);
  });
});
