import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../../src/cli/index.js";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { checkLinks } from "../../../src/core/query/links.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

// FR-PARSE-048 AC-4 — `links check` also checks the local links in the body of docs/spec/00.index.md,
// and reports a broken one with its file path, line, reference and reason in a list of its own, so the
// requirement-scoped `broken` entries keep their shape.

const INDEX = path.join("docs", "spec", "00.index.md");
const FENCE = "```";

async function workspaceWith(insert: string): Promise<{ rootPath: string; line: number }> {
  const rootPath = await copyFixtureWorkspace("mutation-target");
  const file = path.join(rootPath, INDEX);
  const text = await readFile(file, "utf8");
  const updated = text.replace("## 3. Target Map", `${insert}\n\n## 3. Target Map`);
  await writeFile(file, updated, "utf8");
  const line = updated.split("\n").findIndex((l) => l.includes("missing-guide")) + 1;
  return { rootPath, line };
}

async function check(rootPath: string) {
  return checkLinks(await parseWorkspace(await resolveProjectRoot(rootPath)));
}

describe("FR-PARSE-048 AC-4 — links check covers the index body", () => {
  // @req FR-PARSE-048 AC-4
  it("reports a broken local inline link of the index body with its file path, line, reference and reason", async () => {
    const { rootPath, line } = await workspaceWith("See [the missing guide](./missing-guide.md#usage).");
    const result = await check(rootPath);
    expect(result.brokenIndexLinks).toEqual([
      { filePath: "docs/spec/00.index.md", line, reference: "./missing-guide.md#usage", reason: "local file missing", code: "SRS-W003" }
    ]);
  });

  // @req FR-PARSE-048 AC-4
  it("reports a broken link reference definition, and keeps the requirement-scoped broken list as it was", async () => {
    const baseline = await check(await copyFixtureWorkspace("mutation-target"));
    const { rootPath, line } = await workspaceWith("See [the guide][g].\n\n[g]: ../missing-guide.md");
    const result = await check(rootPath);
    expect(result.brokenIndexLinks.map((entry) => [entry.line, entry.reference])).toEqual([[line, "../missing-guide.md"]]);
    expect(result.broken).toEqual(baseline.broken);
    for (const entry of result.broken) expect(Object.keys(entry).sort()).toEqual(["code", "reason", "reference", "requirementId"]);
  });

  // @req FR-PARSE-048 AC-4
  it("counts each local index link it checks", async () => {
    const baseline = await check(await copyFixtureWorkspace("mutation-target"));
    const { rootPath } = await workspaceWith("See [the missing guide](./missing-guide.md) and [the scope](./10.product-architecture.srs.md).");
    expect((await check(rootPath)).checked).toBe(baseline.checked + 2);
  });

  // @req FR-PARSE-048 AC-4 — control: links that exist, external links, same-document links and code are not reported.
  it("reports nothing for an existing file, an external or same-document link, or a link inside code", async () => {
    const { rootPath } = await workspaceWith(
      ["See [arch](./10.product-architecture.srs.md), [site](https://example.com/missing.md), [here](#3-target-map) and `[c](./missing-guide.md)`.", "", FENCE, "[f](./missing-guide.md)", FENCE].join("\n")
    );
    expect((await check(rootPath)).brokenIndexLinks).toEqual([]);
  });

  // @req FR-PARSE-048 AC-4
  it("the CLI prints the same brokenIndexLinks list", async () => {
    const { rootPath } = await workspaceWith("See [the missing guide](./missing-guide.md).");
    const streams = { stdout: new PassThrough(), stderr: new PassThrough() };
    await main(["--root", rootPath, "links", "check", "--json"], streams);
    const out = JSON.parse(streams.stdout.read()?.toString() ?? "{}") as { brokenIndexLinks?: unknown };
    expect(out.brokenIndexLinks).toEqual((await check(rootPath)).brokenIndexLinks);
    expect(out.brokenIndexLinks).toHaveLength(1);
  });
});
