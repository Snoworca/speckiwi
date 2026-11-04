import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveProjectRoot } from "../../src/core/project-root.js";
import { setSupersede } from "../../src/core/mutation/add-trace.js";
import { updateRequirementFields } from "../../src/core/mutation/edit-requirement.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

const SPEC = path.join("docs", "spec", "10.product-architecture.srs.md");

async function edit(rootPath: string, relative: string, change: (text: string) => string): Promise<void> {
  const file = path.join(rootPath, relative);
  const text = await readFile(file, "utf8");
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  await writeFile(file, change(text.replace(/\r\n/g, "\n")).replace(/\n/g, newline), "utf8");
}
const readLf = async (rootPath: string, relative: string): Promise<string> => (await readFile(path.join(rootPath, relative), "utf8")).replace(/\r\n/g, "\n");

describe("verify v5.2.0 r4: findMetadataLine callers", () => {
  it("setSupersede does not overwrite a prose line that reads exactly 'Supersedes'", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    await edit(rootPath, SPEC, (text) => text.replace("Mutation tests need a stable target.", "Supersedes"));
    const root = await resolveProjectRoot(rootPath);
    const result = await setSupersede(root, { id: "FR-ARCH-001", supersedes: "FR-ARCH-002", dryRun: false });
    expect(result.ok).toBe(true);
    const after = await readLf(rootPath, SPEC);
    expect(after).toContain("#### Rationale\n\nSupersedes\n");
  }, 30000);

  it("updateRequirementFields refuses Tags when the metadata table has no Tags row, rather than rewriting a prose line 'Tags'", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    await edit(rootPath, SPEC, (text) => text.replace("| Tags | fixture |\n", "").replace("Mutation tests need a stable target.", "Tags"));
    const root = await resolveProjectRoot(rootPath);
    await updateRequirementFields(root, { id: "FR-ARCH-001", tags: ["x"], dryRun: false });
    expect(await readLf(rootPath, SPEC)).toContain("#### Rationale\n\nTags\n");
  }, 30000);
});
