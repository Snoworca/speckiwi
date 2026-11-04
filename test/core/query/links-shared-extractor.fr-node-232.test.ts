import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { checkLinks } from "../../../src/core/query/links.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

// `links check` reads Related Docs links with the same extractor renameScope (FR-NODE-232) rewrites,
// so a destination with a title or in angle brackets is checked as the path it names.

async function brokenWith(relatedDocs: string) {
  const rootPath = await copyFixtureWorkspace("valid-basic");
  const file = path.join(rootPath, "docs", "spec", "10.product-architecture.srs.md");
  const text = await readFile(file, "utf8");
  await writeFile(file, text.replace(/^\| Related Docs \| .*\|$/m, `| Related Docs | ${relatedDocs} |`), "utf8");
  return (await checkLinks(await parseWorkspace(await resolveProjectRoot(rootPath)))).broken;
}

describe("links check uses the shared markdown link extractor", () => {
  // @req FR-NODE-232 AC-1
  it("checks the destination of a titled or angle-bracketed link, not the raw parenthesis content", async () => {
    expect(await brokenWith(`[Index](./00.index.md "the index"), [Index](<./00.index.md>), [[draft] Index](./00.index.md)`)).toEqual([]);
    expect(await brokenWith(`[Gone](./99.absent.md "gone")`)).toMatchObject([{ reference: "./99.absent.md", code: "SRS-W003" }]);
  });

  // @req FR-NODE-232 AC-1
  it("skips external links of any scheme and checks the path of a local link without its query, fragment or encoding", async () => {
    expect(
      await brokenWith(
        "[a](HTTPS://example.com/x) [b](mailto:o@example.com) [c](./00.index.md?raw=1) [d](./00%2Eindex.md) [e](./00.index.md#top) [f](#local)"
      )
    ).toEqual([]);
    expect(await brokenWith("<!-- [g](./99.absent.md) --> [h](./98.absent.md)")).toMatchObject([{ reference: "./98.absent.md" }]);
  });
});
