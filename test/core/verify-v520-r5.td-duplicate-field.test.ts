import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveProjectRoot } from "../../src/core/project-root.js";
import { parseWorkspace } from "../../src/core/parser/workspace-parser.js";
import { updateStatus } from "../../src/core/mutation/update-status.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

// findMetadataLine says it finds "the row the parser reads". With a duplicated Field row the parser
// keeps the last row (parseMetadataRows overwrites), while the helper returns the first one, so a
// mutation edits a row nobody reads and still reports ok. No validator flags duplicate Field rows.
const SPEC = path.join("docs", "spec", "10.product-architecture.srs.md");

async function fixture(from: string, to: string): Promise<string> {
  const rootPath = await copyFixtureWorkspace("mutation-target");
  const file = path.join(rootPath, SPEC);
  const text = (await readFile(file, "utf8")).replace(/\r\n/g, "\n");
  await writeFile(file, text.replace(from, to), "utf8");
  return rootPath;
}

async function parsed(rootPath: string) {
  const ws = await parseWorkspace(await resolveProjectRoot(rootPath));
  return ws.records.find((r) => r.id === "FR-ARCH-001")!;
}

describe("duplicate metadata Field rows", () => {
  it("update_status that reports ok changes the Status the parser reads", async () => {
    const rootPath = await fixture("| Status | planned |", "| Status | planned |\n| Status | planned |");
    const result = await updateStatus(await resolveProjectRoot(rootPath), { id: "FR-ARCH-001", status: "in_progress" });
    expect(result.ok).toBe(true);
    expect((await parsed(rootPath)).metadata.Status).toBe("in_progress");
  });

});
