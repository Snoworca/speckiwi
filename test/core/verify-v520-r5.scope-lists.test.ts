import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
afterEach(async () => {
  await Promise.all(made.splice(0).map((dir) => rm(dir, { recursive: true, force: true, maxRetries: 5 })));
});

async function realSpecCopy(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "speckiwi-r5-"));
  made.push(dir);
  await cp(path.join(repo, "docs", "spec"), path.join(dir, "docs", "spec"), { recursive: true });
  return dir;
}

async function renameWithAppended(...lines: string[]): Promise<string> {
  const dir = await realSpecCopy();
  const index = path.join(dir, "docs", "spec", "00.index.md");
  const text = await readFile(index, "utf8");
  await writeFile(index, `${text.replace(/\s*$/, "")}\n\n${lines.join("\n")}\n`, "utf8");
  const result = await renameScope(await resolveProjectRoot(dir), { from: FROM, to: TO, apply: true });
  expect(result.ok, JSON.stringify(result)).toBe(true);
  return readFile(index, "utf8");
}

describe("verify r5: list items and fences", () => {
  it("rewrites a link after a fenced block opened on a bullet list item line", async () => {
    const after = await renameWithAppended("- ```text", "  example", "  ```", "", `See [arch](./${FROM}.srs.md).`);
    expect(after).toContain(`See [arch](./${TO}.srs.md).`);
  });

  it("rewrites a link after a fenced block opened on an ordered list item line", async () => {
    const after = await renameWithAppended("1. ```md", "   example", "   ```", "", `See [arch](./${FROM}.srs.md).`);
    expect(after).toContain(`See [arch](./${TO}.srs.md).`);
  });
});

async function state(dir: string) {
  const workspace = await parseWorkspace(await resolveProjectRoot(dir));
  const broken = (await checkLinks(workspace)).broken.map((b) => `${b.requirementId}|${b.code}|${b.reference}`);
  return { broken };
}

describe("verify r5: renaming a scope document keeps links check clean (FR-NODE-232 AC-1, FR-PARSE-036)", () => {
  it("leaves no Related Docs link in another scope document pointing at the renamed document's old path", async () => {
    const from = "30.cli-interface";
    const dir = await realSpecCopy();
    const before = await state(dir);
    const result = await renameScope(await resolveProjectRoot(dir), { from, to: `${from}-renamed`, apply: true });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    const after = await state(dir);
    expect(after.broken.filter((entry) => !before.broken.includes(entry))).toEqual([]);
  });
});
