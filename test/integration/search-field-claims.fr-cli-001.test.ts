import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { beforeAll, describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { renderToolDescriptions } from "../../src/mcp/schemas.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

// @req FR-CLI-001 AC-5 — the search description says which fields each kind of match reads, and what
// it says is what the search does: spacing and particle tolerance holds in the word-matched fields,
// and text that lives only in the rationale is found by its exact phrase alone.

let root: string;

async function cli(argv: string[]): Promise<{ code: number; stdout: string }> {
  const streams = { stdout: new PassThrough(), stderr: new PassThrough() };
  const code = await main(argv, streams);
  return { code, stdout: streams.stdout.read()?.toString() ?? "" };
}

async function ids(query: string): Promise<string[]> {
  const result = await cli(["--root", root, "search", query, "--json"]);
  expect(result.code).toBe(0);
  return (JSON.parse(result.stdout) as { records: Array<{ id: string }> }).records.map((record) => record.id);
}

beforeAll(async () => {
  root = await copyFixtureWorkspace("valid-basic");
  const file = path.join(root, "docs", "spec", "10.product-architecture.srs.md");
  const text = await readFile(file, "utf8");
  await writeFile(
    file,
    text
      .replace("SpecKiwi must parse this fixture requirement.", "SpecKiwi must parse this fixture requirement through the 검색엔진 path.")
      .replace("The parser needs a small valid workspace.", "The parser needs a small valid workspace for the 색인저장소 store."),
    "utf8"
  );
});

describe("FR-CLI-001 AC-5 — the fields each match reads", () => {
  // @req FR-CLI-001 AC-5
  it("the help and the tool description name the word-matched fields and the phrase-only fields", async () => {
    const help = (await cli(["search", "--help"])).stdout.replace(/\s+/g, " ");
    const description = renderToolDescriptions().search_requirements ?? "";
    for (const text of [help, description]) {
      expect(text).toContain("word match reads only ID, title, tags, statement and acceptance criteria");
      expect(text).toMatch(/text that lives only in rationale, research or Change Notes is found by its exact phrase only/);
    }
  });

  // @req FR-CLI-001 AC-5
  it("spacing and particles still match in the statement", async () => {
    expect(await ids("검색엔진")).toEqual(["FR-ARCH-001"]);
    expect(await ids("검색 엔진")).toEqual(["FR-ARCH-001"]);
    expect(await ids("검색엔진을")).toEqual(["FR-ARCH-001"]);
  });

  // @req FR-CLI-001 AC-5
  it("text only in the rationale is found by its exact phrase and not by a spaced variant", async () => {
    expect(await ids("색인저장소")).toEqual(["FR-ARCH-001"]);
    expect(await ids("색인 저장소")).toEqual([]);
  });
});
