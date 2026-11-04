import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveProjectRoot } from "../../src/core/project-root.js";
import { retarget } from "../../src/core/mutation/retarget.js";
import { parseWorkspace } from "../../src/core/parser/workspace-parser.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

const SPEC = path.join("docs", "spec", "10.product-architecture.srs.md");

async function edit(rootPath: string, relative: string, change: (text: string) => string): Promise<void> {
  const file = path.join(rootPath, relative);
  const text = await readFile(file, "utf8");
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  await writeFile(file, change(text.replace(/\r\n/g, "\n")).replace(/\n/g, newline), "utf8");
}

async function readLf(rootPath: string, relative: string): Promise<string> {
  return (await readFile(path.join(rootPath, relative), "utf8")).replace(/\r\n/g, "\n");
}

describe("verify v5.2.0 r3: rename and retarget edge cases", () => {
  // @req IR-CLI-112 AC-3
  it("retarget changes a Target row the parser reads despite extra spaces in its Field cell", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    await edit(rootPath, SPEC, (text) => text.replace("| Target | v1.0.0 |", "|  Target  | v1.0.0 |"));
    const root = await resolveProjectRoot(rootPath);
    expect((await parseWorkspace(root)).records.find((record) => record.id === "FR-ARCH-001")?.target).toBe("v1.0.0");
    const result = await retarget(root, { ids: ["FR-ARCH-001"], toTarget: "v1.1.0", dryRun: false });
    expect(result.ok ? "ok" : result.error.message).toBe("ok");
    expect((await parseWorkspace(root)).records.find((record) => record.id === "FR-ARCH-001")?.target).toBe("v1.1.0");
  }, 30000);

  // @req IR-CLI-112 AC-3
  it("retarget to the requirement's current target records no Change Notes row", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const root = await resolveProjectRoot(rootPath);
    const before = await readLf(rootPath, SPEC);
    const result = await retarget(root, { ids: ["FR-ARCH-001"], toTarget: "v1.0.0", dryRun: false });
    expect(result.ok).toBe(true);
    expect(await readLf(rootPath, SPEC)).toBe(before);
  }, 30000);

});
