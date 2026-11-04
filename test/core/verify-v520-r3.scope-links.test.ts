import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { renameScope } from "../../src/core/mutation/rename-scope.js";
import { parseWorkspace } from "../../src/core/parser/workspace-parser.js";
import { resolveProjectRoot } from "../../src/core/project-root.js";
import { checkLinks } from "../../src/core/query/links.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

const ARCH = "10.product-architecture.srs.md";
const NEW = "10.platform-architecture.srs.md";
const spec = (root: string, name: string) => path.join(root, "docs", "spec", name);

async function editIndex(rootPath: string, ...text: string[]): Promise<void> {
  const file = spec(rootPath, "00.index.md");
  const lines = (await readFile(file, "utf8")).split(/\r?\n/);
  const purpose = lines.findIndex((line) => /^## 1\. Purpose/.test(line));
  lines.splice(purpose + 3, 0, ...text, "");
  await writeFile(file, lines.join("\n"), "utf8");
}
async function rename(rootPath: string) {
  return renameScope(await resolveProjectRoot(rootPath), { from: "10.product-architecture", to: "10.platform-architecture", apply: true });
}
async function brokenWith(relatedDocs: string) {
  const rootPath = await copyFixtureWorkspace("valid-basic");
  const file = spec(rootPath, ARCH);
  const text = await readFile(file, "utf8");
  await writeFile(file, text.replace(/^\| Related Docs \| .*\|$/m, `| Related Docs | ${relatedDocs} |`), "utf8");
  return (await checkLinks(await parseWorkspace(await resolveProjectRoot(rootPath)))).broken;
}

describe("verify r3: links check reports only local targets that do not exist (FR-PARSE-036 AC-2)", () => {
  it("does not report a link to an existing file that carries an anchor", async () => {
    expect(await brokenWith(`[index](./00.index.md#2-srs-documents)`)).toEqual([]);
  });

  it("does not report a mailto link as a missing local file", async () => {
    expect(await brokenWith(`[owner](mailto:owner@example.com)`)).toEqual([]);
  });
});

describe("verify r3: renameScope rewrites links only (FR-NODE-232 AC-1)", () => {
  it("leaves a link-shaped line inside a fenced code block unchanged", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");
    await editIndex(rootPath, "```markdown", `[arch](./${ARCH})`, "```");
    const result = await rename(rootPath);
    expect(result.ok, JSON.stringify(result.error)).toBe(true);
    expect(await readFile(spec(rootPath, "00.index.md"), "utf8")).toContain(`\`\`\`markdown\n[arch](./${ARCH})\n\`\`\``);
  });

  it("keeps a shortcut reference matched to its definition when the label differs only in case", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");
    await editIndex(rootPath, `See [${ARCH}].`, "", `[${ARCH.toUpperCase()}]: ./${ARCH}`);
    const result = await rename(rootPath);
    expect(result.ok, JSON.stringify(result.error)).toBe(true);
    const text = await readFile(spec(rootPath, "00.index.md"), "utf8");
    const reference = /See \[([^\]]+)\]\./.exec(text)?.[1] ?? "";
    const definition = /^\[([^\]]+)\]: (.*)$/m.exec(text);
    expect(definition?.[2]).toBe(`./${NEW}`);
    expect(reference.toLowerCase()).toBe(definition?.[1]?.toLowerCase());
  });
});
