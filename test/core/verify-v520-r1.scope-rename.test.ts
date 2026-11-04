import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { renameScope } from "../../src/core/mutation/rename-scope.js";
import { resolveProjectRoot } from "../../src/core/project-root.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

const ARCH = "10.product-architecture.srs.md";

function specPath(rootPath: string, name: string): string {
  return path.join(rootPath, "docs", "spec", name);
}
async function editIndex(rootPath: string, edit: (lines: string[]) => void): Promise<void> {
  const file = specPath(rootPath, "00.index.md");
  const text = await readFile(file, "utf8");
  const lines = text.split(/\r?\n/);
  edit(lines);
  await writeFile(file, lines.join("\n"), "utf8");
}
async function rename(rootPath: string) {
  return renameScope(await resolveProjectRoot(rootPath), { from: "10.product-architecture", to: "10.platform-architecture", apply: true });
}
function insertAfterPurpose(lines: string[], text: string): void {
  const purpose = lines.findIndex((line) => /^## 1\. Purpose/.test(line));
  lines.splice(purpose + 3, 0, text, "");
}

describe("verify r1: renameScope leaves no index link pointing at the old path (FR-NODE-232 AC-1)", () => {
  it("rewrites an index link that carries a title", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");
    await editIndex(rootPath, (lines) => insertAfterPurpose(lines, `See [architecture](./${ARCH} "Architecture scope").`));
    const result = await rename(rootPath);
    expect(result.ok, JSON.stringify(result.error)).toBe(true);
    expect(await readFile(specPath(rootPath, "00.index.md"), "utf8")).not.toContain(ARCH);
  });

  it("rewrites a link to the document in another scope's row of the Scope Map", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");
    await writeFile(specPath(rootPath, "11.reporting.srs.md"), (await readFile(specPath(rootPath, ARCH), "utf8")).replace(/ARCH/g, "RPT"), "utf8");
    await editIndex(rootPath, (lines) => {
      const at = lines.findIndex((line) => /^## 4\. Scope Map/.test(line));
      lines.splice(at + 5, 0, `| Reporting | [11.reporting.srs.md](./11.reporting.srs.md) | RPT | Builds on [architecture](./${ARCH}) |`);
    });
    const result = await rename(rootPath);
    expect(result.ok, JSON.stringify(result.error)).toBe(true);
    expect(await readFile(specPath(rootPath, "00.index.md"), "utf8")).not.toContain(ARCH);
  });

  it("rewrites a reference-style link definition", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");
    await editIndex(rootPath, (lines) => insertAfterPurpose(lines, `See [architecture][arch].\n\n[arch]: ./${ARCH}`));
    const result = await rename(rootPath);
    expect(result.ok, JSON.stringify(result.error)).toBe(true);
    expect(await readFile(specPath(rootPath, "00.index.md"), "utf8")).not.toContain(ARCH);
  });

  it("rewrites a link whose destination is in angle brackets", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");
    await editIndex(rootPath, (lines) => insertAfterPurpose(lines, `See [architecture](<./${ARCH}>).`));
    const result = await rename(rootPath);
    expect(result.ok, JSON.stringify(result.error)).toBe(true);
    expect(await readFile(specPath(rootPath, "00.index.md"), "utf8")).not.toContain(ARCH);
  });
});
