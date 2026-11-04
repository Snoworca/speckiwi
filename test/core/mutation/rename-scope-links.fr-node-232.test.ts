import { readFileSync } from "node:fs";
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { renameScope } from "../../../src/core/mutation/rename-scope.js";
import { findMarkdownLinks, referenceKey, type MarkdownLink } from "../../../src/core/parser/markdown-links.js";
import { parseIndexDocument } from "../../../src/core/parser/index-parser.js";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { checkLinks, listFileReferences } from "../../../src/core/query/links.js";

// FR-NODE-232 AC-1 generalisation: this repository's real docs/spec/00.index.md, plus every link form
// a reader may write for each scope document, copied into a temp workspace. Every scope document is
// renamed in turn; afterwards no link may resolve to the old path and no other link may change.

const SPEC_SOURCE = path.resolve("docs", "spec");
const created: string[] = [];
afterAll(async () => {
  await Promise.all(created.map((dir) => rm(dir, { recursive: true, force: true, maxRetries: 5 })));
});

function variants(file: string, n: number): string[] {
  return [
    `Title: [${file}](./${file} "the ${file} scope").`,
    `Angle: [x](<./${file}#requirements>).`,
    `Relative: [x](../spec/${file}).`,
    `Nested: [[draft] ${file}](./${file}).`,
    `Decoy: [1${file} and ${file}x are others](./${file}).`,
    `Full: [${file}][ref-${n}].`,
    `Collapsed: [${file}][].`,
    `Shortcut: see [${file}].`,
    `Unrelated: [${file}](./elsewhere.md) and \`[${file}](./${file})\` in code.`,
    "",
    `[ref-${n}]: ./${file} "definition with a title"`,
    `[${file}]: <../spec/${file}>`,
    ""
  ];
}

/** Path a destination resolves to, relative to the repository root, as an index link is read. */
function resolve(destination: string): string {
  const pathPart = destination.replace(/[?#].*$/, "").replace(/\\/g, "/");
  return pathPart.startsWith("docs/spec/") ? path.posix.normalize(pathPart) : path.posix.join("docs/spec", pathPart);
}

interface FoundLink {
  line: number;
  whole: string;
  target?: string;
}

/** Every link in the text, with references resolved through the text's own definitions. */
function links(text: string): FoundLink[] {
  const lines = text.split(/\r?\n/);
  const found = lines.flatMap((line, index) => findMarkdownLinks(line).map((link) => ({ line: index, link, raw: line })));
  const definitions = new Map<string, string>();
  for (const { link } of found) if (link.kind === "definition") definitions.set(referenceKey(link.label.value), resolve(link.destination.value));
  const target = (link: MarkdownLink): string | undefined => {
    if (link.kind !== "reference") return resolve(link.destination.value);
    return definitions.get(referenceKey((link.label ?? link.text).value));
  };
  return found
    .filter(({ link }) => link.kind !== "reference" || target(link) !== undefined)
    .map(({ line, link, raw }) => ({ line, whole: raw.slice(link.start, link.end), target: target(link) }));
}

/** Independent of the extractor: every `](`, `][` and definition opener in the text, code spans removed. */
function grepLinkOpeners(text: string): number {
  const withoutCode = text.replace(/`[^`\n]*`/g, "");
  return (withoutCode.match(/\]\(|\]\[/g) ?? []).length + (withoutCode.match(/^ {0,3}\[[^\]\n]+\]:/gm) ?? []).length;
}

function tokenPattern(file: string): RegExp {
  return new RegExp(`(?<![A-Za-z0-9_.-])${file.replace(/[.]/g, "\\.")}(?![A-Za-z0-9_-]|\\.[A-Za-z0-9])`);
}

/** The scope documents the real index registers, read once when the suite is collected. */
function registeredDocuments(): string[] {
  const indexFile = path.join(SPEC_SOURCE, "00.index.md");
  const text = readFileSync(indexFile, "utf8");
  const lines = text.split(/\r?\n/);
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  return parseIndexDocument({ path: indexFile, relativePath: "docs/spec/00.index.md", text, lines, newline }).index.scopes.map((scope) =>
    scope.document.replace(/^\.\//, "")
  );
}

const documents = registeredDocuments();

async function workspaceWithVariants(): Promise<{ rootPath: string }> {
  const rootPath = await mkdtemp(path.join(tmpdir(), "speckiwi-rename-links-"));
  created.push(rootPath);
  await cp(SPEC_SOURCE, path.join(rootPath, "docs", "spec"), { recursive: true });
  const indexFile = path.join(rootPath, "docs", "spec", "00.index.md");
  const text = await readFile(indexFile, "utf8");
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  const block = documents.flatMap((file, n) => variants(file, n));
  await writeFile(indexFile, [...lines, "", ...block].join(newline), "utf8");
  return { rootPath };
}

describe("FR-NODE-232 renameScope over every link form in the real index", () => {
  it("finds every link opener an independent grep counts, so the denominator below is complete", async () => {
    const { rootPath } = await workspaceWithVariants();
    const text = await readFile(path.join(rootPath, "docs", "spec", "00.index.md"), "utf8");
    const all = text.split(/\r?\n/).flatMap((line) => findMarkdownLinks(line));
    const openers = all.filter((link) => link.kind !== "reference" || link.form !== "shortcut");
    expect(documents.length).toBeGreaterThanOrEqual(6);
    expect(openers.length).toBe(grepLinkOpeners(text));
  });

  for (const file of documents) {
    // @req FR-NODE-232 AC-1
    it(`renaming ${file} leaves no link at the old path and changes no other link`, async () => {
      const { rootPath } = await workspaceWithVariants();
      const indexFile = path.join(rootPath, "docs", "spec", "00.index.md");
      const oldPath = `docs/spec/${file}`;
      const renamed = file.replace(/\.srs\.md$/, "-renamed.srs.md");
      const before = links(await readFile(indexFile, "utf8"));
      expect(before.filter((link) => link.target === oldPath).length).toBeGreaterThanOrEqual(12);

      const result = await renameScope(await resolveProjectRoot(rootPath), { from: file, to: renamed.replace(/\.srs\.md$/, ""), apply: true });
      expect(result.ok, JSON.stringify(result.error)).toBe(true);

      const afterText = await readFile(indexFile, "utf8");
      const after = links(afterText);
      expect(after.filter((link) => link.target === oldPath)).toEqual([]);
      expect(after.filter((link) => link.target === `docs/spec/${renamed}`).length).toBe(before.filter((link) => link.target === oldPath).length);
      const untouched = (list: FoundLink[]) => list.filter((link) => link.target !== oldPath && link.target !== `docs/spec/${renamed}`);
      expect(untouched(after)).toEqual(untouched(before));
      // Link text and definition labels too: only the decoys and the code span may still spell the old name.
      const leftovers = afterText.split(/\r?\n/).filter((line) => tokenPattern(file).test(line));
      expect(leftovers).toEqual([`Unrelated: [${file}](./elsewhere.md) and \`[${file}](./${file})\` in code.`]);
    });
  }
});

/** Every markdown file under docs/spec, keyed by its path below docs/spec, with its lines. */
async function specTexts(rootPath: string): Promise<Map<string, string[]>> {
  const spec = path.join(rootPath, "docs", "spec");
  const names = (await readdir(spec, { recursive: true })).map((name) => String(name).replace(/\\/g, "/")).filter((name) => name.endsWith(".md"));
  const texts = new Map<string, string[]>();
  for (const name of names.sort()) texts.set(name, (await readFile(path.join(spec, name), "utf8")).split(/\r?\n/));
  return texts;
}

/** Every file reference links check resolves, as requirement|source|path, sorted. */
async function referenceSet(rootPath: string): Promise<string[]> {
  const workspace = await parseWorkspace(await resolveProjectRoot(rootPath));
  return listFileReferences(workspace)
    .map((entry) => `${entry.requirementId}|${entry.source}|${entry.path}`)
    .sort();
}

async function brokenLinks(rootPath: string): Promise<string[]> {
  const workspace = await parseWorkspace(await resolveProjectRoot(rootPath));
  return (await checkLinks(workspace)).broken.map((entry) => `${entry.requirementId}|${entry.code}|${entry.reference}`);
}

describe("FR-NODE-232 AC-6 renameScope over this repository's real docs/spec", () => {
  for (const file of documents) {
    // @req FR-NODE-232 AC-6
    it(`renaming ${file} adds no broken link and changes only lines that named it`, async () => {
      const rootPath = await mkdtemp(path.join(tmpdir(), "speckiwi-rename-real-"));
      created.push(rootPath);
      await cp(SPEC_SOURCE, path.join(rootPath, "docs", "spec"), { recursive: true });
      const renamed = file.replace(/\.srs\.md$/, "-renamed.srs.md");
      // A trace path to the document, so the reference set below holds one of each kind links check reads.
      const host = path.join(rootPath, "docs", "spec", documents.find((other) => other !== file) ?? file);
      const hostText = await readFile(host, "utf8");
      const traceHeader = /\| Type \| Reference \| Relation \| Notes \|\r?\n\| --- \| --- \| --- \| --- \|\r?\n/.exec(hostText);
      expect(traceHeader).not.toBeNull();
      const insertAt = (traceHeader?.index ?? 0) + (traceHeader?.[0].length ?? 0);
      await writeFile(host, `${hostText.slice(0, insertAt)}| Document | docs/spec/${file}:3 | relates_to | renamed |\n${hostText.slice(insertAt)}`, "utf8");
      const brokenBefore = await brokenLinks(rootPath);
      const referencesBefore = await referenceSet(rootPath);
      const before = await specTexts(rootPath);

      const result = await renameScope(await resolveProjectRoot(rootPath), { from: file, to: renamed.replace(/\.srs\.md$/, ""), apply: true });
      expect(result.ok, JSON.stringify(result.error)).toBe(true);

      expect((await brokenLinks(rootPath)).filter((entry) => !brokenBefore.includes(entry))).toEqual([]);
      // links check's own reference set: the same references, each that named the old path now naming the new one.
      const oldPath = `docs/spec/${file}`;
      expect(referencesBefore.some((entry) => entry.endsWith(`|${oldPath}`))).toBe(true);
      expect(await referenceSet(rootPath)).toEqual(
        referencesBefore.map((entry) => (entry.endsWith(`|${oldPath}`) ? entry.replace(`|${oldPath}`, `|docs/spec/${renamed}`) : entry)).sort()
      );
      const after = await specTexts(rootPath);
      expect([...after.keys()]).toEqual([...before.keys()].map((name) => (name === file ? renamed : name)).sort());
      const oldName = new RegExp(file.replace(/[.]/g, "\\."), "i");
      for (const [name, lines] of before) {
        const changed = (after.get(name === file ? renamed : name) ?? []).flatMap((line, index) => (line === lines[index] ? [] : [lines[index] ?? ""]));
        for (const line of changed) expect(line, `${name}: ${line}`).toMatch(oldName);
      }
    });
  }
});
