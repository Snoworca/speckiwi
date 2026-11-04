import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { renderEmptyScopeTemplate } from "../../../src/core/bootstrap/templates.js";
import { renameScope } from "../../../src/core/mutation/rename-scope.js";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

// FR-NODE-232 — renameScope relocates a scope document and rewrites both index sections.
//
// Fixture: valid-basic (10.product-architecture.srs.md, prefix ARCH, registered in §2 and §4, plus
// the 90.appendix.md sidecar). The helpers below reorder §4 to this repository's own column order
// (`| Scope | Prefix | Primary Document | Notes |`), add a second scope document on the same number
// (the SRS-W070 state) and add an index link outside the two tables.

const ARCH = "10.product-architecture.srs.md";

function specPath(rootPath: string, name: string): string {
  return path.join(rootPath, "docs", "spec", name);
}

async function exists(filePath: string): Promise<boolean> {
  return access(filePath).then(
    () => true,
    () => false
  );
}

async function editIndex(rootPath: string, edit: (lines: string[]) => void): Promise<void> {
  const file = specPath(rootPath, "00.index.md");
  const text = await readFile(file, "utf8");
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  edit(lines);
  await writeFile(file, lines.join(newline), "utf8");
}

function rowsAfter(lines: string[], heading: RegExp): number {
  const at = lines.findIndex((line) => heading.test(line));
  let end = at + 3;
  while ((lines[end] ?? "").startsWith("|")) end += 1;
  return end;
}

/** §4 in `| Scope | Prefix | Primary Document | Notes |` order, plus a link outside both tables. */
async function workspace(): Promise<string> {
  const rootPath = await copyFixtureWorkspace("valid-basic");
  await editIndex(rootPath, (lines) => {
    const at = lines.findIndex((line) => /^## 4\. Scope Map/.test(line));
    lines[at + 2] = "| Scope | Prefix | Primary Document | Notes |";
    lines[at + 4] = `| Product Architecture | ARCH | [${ARCH}](./${ARCH}) | Architecture |`;
    const purpose = lines.findIndex((line) => /^## 1\. Purpose/.test(line));
    lines.splice(purpose + 3, 0, `See [the architecture scope ${ARCH}](./${ARCH}#requirements) first.`, "");
  });
  return rootPath;
}

/** Adds a scope document registered in both sections, with the given file name and prefix. */
async function addScope(rootPath: string, document: string, name: string, prefix: string): Promise<void> {
  await writeFile(specPath(rootPath, document), `${renderEmptyScopeTemplate({ name, prefix })}\n`, "utf8");
  await editIndex(rootPath, (lines) => {
    lines.splice(rowsAfter(lines, /^## 4\. Scope Map/), 0, `| ${name} | ${prefix} | [${document}](./${document}) | ${name} |`);
    lines.splice(rowsAfter(lines, /^## 2\. SRS Documents/), 0, `| ${name} | [${document}](./${document}) | ${prefix} | ${name} |`);
  });
}

async function snapshot(rootPath: string): Promise<Record<string, string>> {
  const dir = path.join(rootPath, "docs", "spec");
  const result: Record<string, string> = {};
  for (const name of await readdir(dir)) result[name] = await readFile(path.join(dir, name), "utf8");
  return result;
}

describe("FR-NODE-232 renameScope", () => {
  // @req FR-NODE-232 AC-1
  // @req FR-NODE-232 AC-3
  it("moves the file and rewrites the §2 row, the §4 row and every index link, each cell under its own column", async () => {
    const rootPath = await workspace();
    const archBody = await readFile(specPath(rootPath, ARCH), "utf8");
    const root = await resolveProjectRoot(rootPath);

    const result = await renameScope(root, { from: "10.product-architecture", to: "10.platform-architecture", apply: true });

    expect(result.ok, JSON.stringify(result.error)).toBe(true);
    const moved = "10.platform-architecture.srs.md";
    expect(await exists(specPath(rootPath, ARCH))).toBe(false);
    expect(await readFile(specPath(rootPath, moved), "utf8")).toBe(archBody);

    const index = await readFile(specPath(rootPath, "00.index.md"), "utf8");
    expect(index).not.toContain("product-architecture.srs.md");
    expect(index).toContain(`| Product Architecture | [${moved}](./${moved}) | ARCH | Architecture |`);
    expect(index).toContain(`| Product Architecture | ARCH | [${moved}](./${moved}) | Architecture |`);
    expect(index).toContain(`See [the architecture scope ${moved}](./${moved}#requirements) first.`);

    expect(result.value).toMatchObject({ dryRun: false, from: `docs/spec/${ARCH}`, to: `docs/spec/${moved}`, renumbered: false });
    expect(result.value?.rewrittenRows.map((row) => row.section).sort()).toEqual(["scope-map", "srs-documents"]);
    expect(result.value?.rewrittenLinks).toHaveLength(1);
    expect(result.value?.rewrittenLinks[0]?.after).toContain(`(./${moved}#requirements)`);

    const parsed = await parseWorkspace(root);
    expect(parsed.index.scopes.map((scope) => [scope.prefix, scope.document])).toEqual([["ARCH", `./${moved}`]]);
  });

  // @req FR-NODE-232 AC-1
  it("rewrites a bare document cell written without a link", async () => {
    const rootPath = await workspace();
    await editIndex(rootPath, (lines) => {
      const at = lines.findIndex((line) => /^## 4\. Scope Map/.test(line));
      lines[at + 4] = `| Product Architecture | ARCH | ./${ARCH} | - |`;
    });
    const result = await renameScope(await resolveProjectRoot(rootPath), { from: ARCH, to: "10.platform-architecture", apply: true });
    expect(result.ok, JSON.stringify(result.error)).toBe(true);
    expect(await readFile(specPath(rootPath, "00.index.md"), "utf8")).toContain("| Product Architecture | ARCH | ./10.platform-architecture.srs.md | - |");
  });

  // @req FR-NODE-232 AC-1
  it("rewrites a link nested in a shortcut reference to the document once, not twice", async () => {
    const rootPath = await workspace();
    await editIndex(rootPath, (lines) => {
      lines.push("", `Nested: [see [${ARCH}](./${ARCH}) here].`, "", `[see [${ARCH}](./${ARCH}) here]: ./${ARCH}`, "");
    });
    const result = await renameScope(await resolveProjectRoot(rootPath), { from: ARCH, to: "10.platform-architecture", apply: true });
    expect(result.ok, JSON.stringify(result.error)).toBe(true);
    const moved = "10.platform-architecture.srs.md";
    const index = await readFile(specPath(rootPath, "00.index.md"), "utf8");
    expect(index).toContain(`Nested: [see [${moved}](./${moved}) here].`);
    expect(index).toContain(`[see [${moved}](./${moved}) here]: ./${moved}`);
  });

  // @req FR-NODE-232 AC-1
  it("leaves link-shaped text in a tilde fence and an HTML comment alone, and rewrites the link after them", async () => {
    const rootPath = await workspace();
    const fenced = ["~~~~", `[a](./${ARCH})`, "~~~", `[b](./${ARCH})`, "~~~~"];
    const comment = ["<!--", `[c](./${ARCH})`, "-->"];
    await editIndex(rootPath, (lines) => {
      lines.push("", ...fenced, "", ...comment, "", `After: [d](./${ARCH})`, "");
    });
    const result = await renameScope(await resolveProjectRoot(rootPath), { from: ARCH, to: "10.platform-architecture", apply: true });
    expect(result.ok, JSON.stringify(result.error)).toBe(true);
    const index = (await readFile(specPath(rootPath, "00.index.md"), "utf8")).split(/\r?\n/);
    expect(index.join("\n")).toContain([...fenced, "", ...comment].join("\n"));
    expect(index).toContain("After: [d](./10.platform-architecture.srs.md)");
  });

  // @req FR-NODE-232 AC-1
  it("renames a reference whose key differs from its definition's only in case, so both still match", async () => {
    const rootPath = await workspace();
    await editIndex(rootPath, (lines) => {
      lines.push("", `Full: [x][${ARCH.toUpperCase()}].`, "", `[${ARCH}]: ./${ARCH}`, "");
    });
    const result = await renameScope(await resolveProjectRoot(rootPath), { from: ARCH, to: "10.platform-architecture", apply: true });
    expect(result.ok, JSON.stringify(result.error)).toBe(true);
    const moved = "10.platform-architecture.srs.md";
    const index = await readFile(specPath(rootPath, "00.index.md"), "utf8");
    expect(index).toContain(`Full: [x][${moved}].`);
    expect(index).toContain(`[${moved}]: ./${moved}`);
  });

  // @req FR-NODE-232 AC-6
  it("rewrites Related Docs entries and links to the document in the other files under docs/spec, and its own self-links", async () => {
    const rootPath = await workspace();
    await addScope(rootPath, "11.reporting.srs.md", "Reporting", "RPT");
    const reporting = specPath(rootPath, "11.reporting.srs.md");
    await writeFile(
      reporting,
      `${await readFile(reporting, "utf8")}\n| Related Docs | [Arch](./${ARCH}), [Index](./00.index.md) |\n\nSee [arch](./${ARCH}#x) and [other](./90.appendix.md).\n`,
      "utf8"
    );
    await writeFile(specPath(rootPath, ARCH), `${await readFile(specPath(rootPath, ARCH), "utf8")}\nSelf: [here](./${ARCH}#top)\n`, "utf8");
    const stepDir = path.join(rootPath, "docs", "spec", "steps", "t1");
    await mkdir(stepDir, { recursive: true });
    await writeFile(path.join(stepDir, "intent.md"), `Up: [arch](../../${ARCH})\n| Related Docs | [Arch](./${ARCH}) |\n`, "utf8");

    const result = await renameScope(await resolveProjectRoot(rootPath), { from: ARCH, to: "10.platform-architecture", apply: true });

    expect(result.ok, JSON.stringify(result.error)).toBe(true);
    const moved = "10.platform-architecture.srs.md";
    const reportingText = await readFile(reporting, "utf8");
    expect(reportingText).toContain(`| Related Docs | [Arch](./${moved}), [Index](./00.index.md) |`);
    expect(reportingText).toContain(`See [arch](./${moved}#x) and [other](./90.appendix.md).`);
    expect(await readFile(specPath(rootPath, moved), "utf8")).toContain(`Self: [here](./${moved}#top)`);
    // A Related Docs entry resolves against docs/spec, as links check reads it; other links against their file.
    expect(await readFile(path.join(stepDir, "intent.md"), "utf8")).toBe(`Up: [arch](../../${moved})\n| Related Docs | [Arch](./${moved}) |\n`);
    expect(result.value?.otherFileLinks.map((entry) => entry.file).sort()).toEqual([
      `docs/spec/${moved}`,
      "docs/spec/11.reporting.srs.md",
      "docs/spec/11.reporting.srs.md",
      "docs/spec/steps/t1/intent.md",
      "docs/spec/steps/t1/intent.md"
    ]);
  });

  // @req FR-NODE-232 AC-6
  it("rewrites the Trace Link paths that links check resolves to the document, keeping line suffixes and other parts", async () => {
    const rootPath = await workspace();
    const archPath = specPath(rootPath, ARCH);
    const row = "| Requirement | FR-ARCH-001 | self | Fixture self link |";
    const text = await readFile(archPath, "utf8");
    expect(text).toContain(row);
    await writeFile(
      archPath,
      text.replace(row, `${row}\n| Document | docs/spec/${ARCH}:12 | relates_to | self |\n| Code | src/a.ts; docs/spec/${ARCH}#top | implements | two |`),
      "utf8"
    );
    const moved = "10.platform-architecture.srs.md";

    const result = await renameScope(await resolveProjectRoot(rootPath), { from: ARCH, to: "10.platform-architecture", apply: true });

    expect(result.ok, JSON.stringify(result.error)).toBe(true);
    const after = await readFile(specPath(rootPath, moved), "utf8");
    expect(after).toContain(`| Document | docs/spec/${moved}:12 | relates_to | self |`);
    expect(after).toContain(`| Code | src/a.ts; docs/spec/${moved}#top | implements | two |`);
  });

  // @req FR-NODE-232 AC-6
  it("previews the other-file rewrites without writing them", async () => {
    const rootPath = await workspace();
    await addScope(rootPath, "11.reporting.srs.md", "Reporting", "RPT");
    const reporting = specPath(rootPath, "11.reporting.srs.md");
    await writeFile(reporting, `${await readFile(reporting, "utf8")}\n| Related Docs | [Arch](./${ARCH}) |\n`, "utf8");
    const before = await snapshot(rootPath);

    const result = await renameScope(await resolveProjectRoot(rootPath), { from: ARCH, to: "10.platform-architecture" });

    expect(result.value?.otherFileLinks).toHaveLength(1);
    expect(await snapshot(rootPath)).toEqual(before);
  });

  // @req FR-NODE-232 AC-1
  it("previews without writing unless apply is given", async () => {
    const rootPath = await workspace();
    const before = await snapshot(rootPath);

    const result = await renameScope(await resolveProjectRoot(rootPath), { from: "10.product-architecture", to: "10.platform-architecture" });

    expect(result.ok).toBe(true);
    expect(result.value?.dryRun).toBe(true);
    expect(result.value?.rewrittenRows).toHaveLength(2);
    expect(result.value?.rewrittenLinks).toHaveLength(1);
    expect(await snapshot(rootPath)).toEqual(before);
  });

  // @req FR-NODE-232 AC-1
  it("runs under the SRS mutation lock and writes nothing while another mutation holds it", async () => {
    const rootPath = await workspace();
    await mkdir(path.join(rootPath, "kiwi"), { recursive: true });
    const now = Date.now();
    await writeFile(
      path.join(rootPath, "kiwi", ".srs.lock"),
      JSON.stringify({ schemaVersion: "1.0.0", owner: "other:1", operation: "other", requestId: "r", acquiredAt: new Date(now).toISOString(), expiresAt: new Date(now + 60_000).toISOString() }),
      "utf8"
    );
    const before = await snapshot(rootPath);

    const result = await renameScope(await resolveProjectRoot(rootPath), { from: "10.product-architecture", to: "10.platform-architecture", apply: true });

    expect(result).toMatchObject({ ok: false, error: { code: "SRS_LOCKED" } });
    expect(await snapshot(rootPath)).toEqual(before);
  });

  // @req FR-NODE-232 AC-3
  it("refuses, writing nothing, a row whose cells do not line up with its header instead of dropping a cell", async () => {
    const rootPath = await workspace();
    await editIndex(rootPath, (lines) => {
      const at = lines.findIndex((line) => /^## 4\. Scope Map/.test(line));
      lines[at + 4] = `| Product Architecture | ARCH | [${ARCH}](./${ARCH}) | Architecture \\| core |`;
    });
    const before = await snapshot(rootPath);

    const result = await renameScope(await resolveProjectRoot(rootPath), { from: "10.product-architecture", to: "10.platform-architecture", apply: true });

    expect(result).toMatchObject({ ok: false, error: { code: "SCOPE_RENAME_ROW_UNPARSEABLE" } });
    expect(await snapshot(rootPath)).toEqual(before);
  });

  // @req FR-NODE-232 AC-2
  it("refuses, writing nothing, when the target file already exists", async () => {
    const rootPath = await workspace();
    await writeFile(specPath(rootPath, "10.platform-architecture.srs.md"), "# stray\n", "utf8");
    const before = await snapshot(rootPath);

    const result = await renameScope(await resolveProjectRoot(rootPath), { from: "10.product-architecture", to: "10.platform-architecture", apply: true });

    expect(result).toMatchObject({ ok: false, error: { code: "SCOPE_RENAME_TARGET_EXISTS" } });
    expect(await snapshot(rootPath)).toEqual(before);
  });

  // @req FR-NODE-232 AC-2
  it("refuses, writing nothing, when another Scope Map row already registers the target document", async () => {
    const rootPath = await workspace();
    await editIndex(rootPath, (lines) => {
      lines.splice(rowsAfter(lines, /^## 4\. Scope Map/), 0, "| Platform | PLAT | [10.platform-architecture.srs.md](./10.platform-architecture.srs.md) | - |");
    });
    const before = await snapshot(rootPath);

    const result = await renameScope(await resolveProjectRoot(rootPath), { from: "10.product-architecture", to: "10.platform-architecture", apply: true });

    expect(result).toMatchObject({ ok: false, error: { code: "SCOPE_RENAME_PREFIX_CONFLICT" } });
    expect(await snapshot(rootPath)).toEqual(before);
  });

  // @req FR-NODE-232 AC-2
  it("refuses, writing nothing, when the document's prefix is also held by another scope", async () => {
    const rootPath = await workspace();
    await addScope(rootPath, "11.shadow.srs.md", "Shadow", "ARCH");
    const before = await snapshot(rootPath);

    const result = await renameScope(await resolveProjectRoot(rootPath), { from: "10.product-architecture", to: "10.platform-architecture", apply: true });

    expect(result).toMatchObject({ ok: false, error: { code: "SCOPE_RENAME_PREFIX_CONFLICT" } });
    expect(result.error?.message).toContain("ARCH");
    expect(await snapshot(rootPath)).toEqual(before);
  });

  // @req FR-NODE-232 AC-4
  it("renumbers a document whose number another scope document shares to one above the highest number in use", async () => {
    const rootPath = await workspace();
    await addScope(rootPath, "10.reporting.srs.md", "Reporting", "RPT");
    const root = await resolveProjectRoot(rootPath);

    const result = await renameScope(root, { from: "10.reporting", to: "11.reporting", apply: true });

    expect(result.ok, JSON.stringify(result.error)).toBe(true);
    expect(result.value?.renumbered).toBe(true);
    expect(await exists(specPath(rootPath, "10.reporting.srs.md"))).toBe(false);
    expect(await exists(specPath(rootPath, "11.reporting.srs.md"))).toBe(true);
    const index = await readFile(specPath(rootPath, "00.index.md"), "utf8");
    expect(index).toContain("| Reporting | [11.reporting.srs.md](./11.reporting.srs.md) | RPT | Reporting |");
    expect(index).toContain("| Reporting | RPT | [11.reporting.srs.md](./11.reporting.srs.md) | Reporting |");
    expect(index).not.toContain("10.reporting.srs.md");
  });

  // @req FR-NODE-232 AC-5
  it("refuses a renumber, writing nothing, when no other scope document shares the current number", async () => {
    const rootPath = await workspace();
    const before = await snapshot(rootPath);

    const result = await renameScope(await resolveProjectRoot(rootPath), { from: "10.product-architecture", to: "11.product-architecture", apply: true });

    expect(result).toMatchObject({ ok: false, error: { code: "SCOPE_RENAME_NUMBER_NOT_SHARED" } });
    expect(result.error?.message).toContain("not shared");
    expect(await snapshot(rootPath)).toEqual(before);
  });

  // @req FR-NODE-232 AC-5
  it("refuses a renumber, writing nothing, when the requested number is not one above the highest in use", async () => {
    const rootPath = await workspace();
    await addScope(rootPath, "10.reporting.srs.md", "Reporting", "RPT");
    const before = await snapshot(rootPath);

    const result = await renameScope(await resolveProjectRoot(rootPath), { from: "10.reporting", to: "12.reporting", apply: true });

    expect(result).toMatchObject({ ok: false, error: { code: "SCOPE_RENAME_NUMBER_NOT_NEXT" } });
    expect(result.error?.message).toContain("11");
    expect(await snapshot(rootPath)).toEqual(before);
  });

  // @req FR-NODE-232 AC-5
  it("names both failed conditions when neither holds", async () => {
    const rootPath = await workspace();
    const result = await renameScope(await resolveProjectRoot(rootPath), { from: "10.product-architecture", to: "15.product-architecture", apply: true });
    expect(result).toMatchObject({ ok: false, error: { code: "SCOPE_RENAME_NUMBER_NOT_SHARED" } });
    expect(result.error?.message).toContain("not shared");
    expect(result.error?.message).toContain("11");
  });

  it("refuses a name that is not NN.slug, an unknown source, an unregistered source and a no-op", async () => {
    const rootPath = await workspace();
    const root = await resolveProjectRoot(rootPath);
    expect(await renameScope(root, { from: "10.product-architecture", to: "Platform" })).toMatchObject({ error: { code: "SCOPE_RENAME_INVALID_NAME" } });
    expect(await renameScope(root, { from: "10.product-architecture", to: "10.Platform_Arch" })).toMatchObject({ error: { code: "SCOPE_RENAME_INVALID_NAME" } });
    expect(await renameScope(root, { from: "../10.product-architecture", to: "10.x" })).toMatchObject({ error: { code: "SCOPE_RENAME_INVALID_NAME" } });
    expect(await renameScope(root, { from: "20.missing", to: "20.other" })).toMatchObject({ error: { code: "SCOPE_RENAME_SOURCE_NOT_FOUND" } });
    expect(await renameScope(root, { from: "10.product-architecture", to: "10.product-architecture" })).toMatchObject({ error: { code: "SCOPE_RENAME_NO_CHANGE" } });
    await writeFile(specPath(rootPath, "12.loose.srs.md"), "# loose\n", "utf8");
    expect(await renameScope(root, { from: "12.loose", to: "12.tight" })).toMatchObject({ error: { code: "SCOPE_RENAME_SOURCE_NOT_REGISTERED" } });
  });
});

describe("FR-NODE-232 — autolinks", () => {
  // An autolink is an absolute URI or an email address (CommonMark §6.5), never a scope document's
  // repository path, so a rename leaves it as written even when it ends in the old file name.
  // @req FR-NODE-232 AC-1
  it("leaves autolinks that end in the old file name unchanged while renaming the index links", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");
    const autolinks = [`<https://example.com/docs/spec/${ARCH}>`, `<file:./${ARCH}>`, `<owner@${ARCH}>`];
    await editIndex(rootPath, (lines) => {
      lines.push("", `Autolinks: ${autolinks.join(" ")} and [the doc](./${ARCH}).`, "");
    });

    const result = await renameScope(await resolveProjectRoot(rootPath), { from: "10.product-architecture", to: "10.product-core", apply: true });

    expect(result.ok).toBe(true);
    const line = (await readFile(specPath(rootPath, "00.index.md"), "utf8")).split(/\r?\n/).find((text) => text.startsWith("Autolinks: "));
    expect(line).toBe(`Autolinks: ${autolinks.join(" ")} and [the doc](./10.product-core.srs.md).`);
  });
});
