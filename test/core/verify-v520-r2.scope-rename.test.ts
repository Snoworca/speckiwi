import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { renameScope } from "../../src/core/mutation/rename-scope.js";
import { resolveProjectRoot } from "../../src/core/project-root.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

const ARCH = "10.product-architecture.srs.md";
const NEW = "10.platform-architecture.srs.md";

function specPath(rootPath: string, name: string): string {
  return path.join(rootPath, "docs", "spec", name);
}
async function editIndex(rootPath: string, edit: (lines: string[]) => void): Promise<void> {
  const file = specPath(rootPath, "00.index.md");
  const lines = (await readFile(file, "utf8")).split(/\r?\n/);
  edit(lines);
  await writeFile(file, lines.join("\n"), "utf8");
}
function insertAfterPurpose(lines: string[], text: string): void {
  const purpose = lines.findIndex((line) => /^## 1\. Purpose/.test(line));
  lines.splice(purpose + 3, 0, text, "");
}
async function run(rootPath: string) {
  return renameScope(await resolveProjectRoot(rootPath), { from: "10.product-architecture", to: "10.platform-architecture", apply: true });
}
async function index(rootPath: string): Promise<string> {
  return readFile(specPath(rootPath, "00.index.md"), "utf8");
}

describe("verify r2: renameScope link rewriting (FR-NODE-232 AC-1)", () => {
  it("rewrites a link that reaches the document through ../spec/", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");
    await editIndex(rootPath, (lines) => insertAfterPurpose(lines, `See [architecture](../spec/${ARCH}).`));
    const result = await run(rootPath);
    expect(result.ok, JSON.stringify(result.error)).toBe(true);
    expect(await index(rootPath)).not.toContain(ARCH);
  });

  it("rewrites the text of a full reference link that names the document", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");
    await editIndex(rootPath, (lines) => insertAfterPurpose(lines, `See [${ARCH}][arch].\n\n[arch]: ./${ARCH}`));
    const result = await run(rootPath);
    expect(result.ok, JSON.stringify(result.error)).toBe(true);
    expect(await index(rootPath)).not.toContain(ARCH);
  });

  it("rewrites a link whose text contains nested brackets", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");
    await editIndex(rootPath, (lines) => insertAfterPurpose(lines, `See [[draft] architecture](./${ARCH}).`));
    const result = await run(rootPath);
    expect(result.ok, JSON.stringify(result.error)).toBe(true);
    expect(await index(rootPath)).not.toContain(ARCH);
  });

  it("does not alter another document's file name inside a rewritten link's text", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");
    await editIndex(rootPath, (lines) => insertAfterPurpose(lines, `See [1${ARCH} supersedes this](./${ARCH}).`));
    const result = await run(rootPath);
    expect(result.ok, JSON.stringify(result.error)).toBe(true);
    expect(await index(rootPath)).toContain(`[1${ARCH} supersedes this](./${NEW})`);
  });
});
