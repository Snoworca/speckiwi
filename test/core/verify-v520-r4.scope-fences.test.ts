import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { renameScope } from "../../src/core/mutation/rename-scope.js";
import { parseWorkspace } from "../../src/core/parser/workspace-parser.js";
import { resolveProjectRoot } from "../../src/core/project-root.js";
import { checkLinks } from "../../src/core/query/links.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

const repo = path.resolve(__dirname, "../..");
const FROM = "10.product-architecture";
const TO = "10.product-core";
const made: string[] = [];
afterEach(async () => {
  await Promise.all(made.splice(0).map((dir) => rm(dir, { recursive: true, force: true, maxRetries: 5 })));
});

/** A temp workspace holding a copy of this repository's real docs/spec. */
async function realSpecCopy(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "speckiwi-r4-"));
  made.push(dir);
  await cp(path.join(repo, "docs", "spec"), path.join(dir, "docs", "spec"), { recursive: true });
  return dir;
}

/** Appends lines at the end of the real index (after section 12), renames, returns the new index text. */
async function renameWithAppended(...lines: string[]): Promise<string> {
  const dir = await realSpecCopy();
  const index = path.join(dir, "docs", "spec", "00.index.md");
  const text = await readFile(index, "utf8");
  await writeFile(index, `${text.replace(/\s*$/, "")}\n\n${lines.join("\n")}\n`, "utf8");
  const result = await renameScope(await resolveProjectRoot(dir), { from: FROM, to: TO, apply: true });
  expect(result.ok, JSON.stringify(result)).toBe(true);
  return readFile(index, "utf8");
}

async function brokenWith(relatedDocs: string) {
  const rootPath = await copyFixtureWorkspace("valid-basic");
  const file = path.join(rootPath, "docs", "spec", "10.product-architecture.srs.md");
  const text = await readFile(file, "utf8");
  await writeFile(file, text.replace(/^\| Related Docs \| .*\|$/m, `| Related Docs | ${relatedDocs} |`), "utf8");
  return (await checkLinks(await parseWorkspace(await resolveProjectRoot(rootPath)))).broken;
}

describe("verify r4: renameScope on the real index leaves no link at the old path (FR-NODE-232 AC-1)", () => {
  it("rewrites a link that follows a code span holding an unclosed `<!--`", async () => {
    const after = await renameWithAppended("Write `<!--` to start a note.", "", `See [arch](./${FROM}.srs.md).`);
    expect(after).not.toContain(`](./${FROM}.srs.md)`);
  });

  it("rewrites a link after a fenced block whose closing fence carries a trailing tab", async () => {
    const after = await renameWithAppended("```text", "example", "```\t", "", `See [arch](./${FROM}.srs.md).`);
    expect(after).not.toContain(`](./${FROM}.srs.md)`);
  });

  it("rewrites a link after a line whose leading triple-backtick run is an inline code span, not a fence", async () => {
    const after = await renameWithAppended("```inline``` spans are code.", "", `See [arch](./${FROM}.srs.md).`);
    expect(after).not.toContain(`](./${FROM}.srs.md)`);
  });
});

describe("verify r4: renameScope rewrites links only, not code (FR-NODE-232 AC-1)", () => {
  it("leaves a link inside a fenced block nested in an ordered list item unchanged", async () => {
    const after = await renameWithAppended("10. Example:", "", "    ```md", `    [arch](./${FROM}.srs.md)`, "    ```");
    expect(after).toContain(`    [arch](./${FROM}.srs.md)`);
  });
});

describe("verify r4: links check still reports a planted broken local link (FR-PARSE-036 AC-2)", () => {
  it("reports a missing file linked after a code span holding `<!--`", async () => {
    const broken = await brokenWith("`<!--` marker; [gone](./no-such-file.md)");
    expect(broken.map((entry) => entry.reference)).toContain("./no-such-file.md");
  });

  it("reports a missing file linked by a Windows drive-letter path", async () => {
    const broken = await brokenWith("[gone](C:/no/such/dir/no-such-file.md)");
    expect(broken.map((entry) => entry.reference)).toContain("C:/no/such/dir/no-such-file.md");
  });
});
