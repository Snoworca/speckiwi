import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import { syncIndexRollups } from "../../../src/core/mutation/sync-index.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

// Verification probes, round 11: sync-index rewrites Status Summary and Requirement Type Summary rows
// in a fixed column order instead of by the table's own header.

const INDEX = path.join("docs", "spec", "00.index.md");

async function editIndex(rootPath: string, edit: (lf: string) => string): Promise<void> {
  const file = path.join(rootPath, INDEX);
  const text = (await readFile(file, "utf8")).replace(/^﻿/, "").replace(/\r\n/g, "\n");
  await writeFile(file, edit(text), "utf8");
}

describe("sync-index rollups on tables whose column order differs", () => {
  it("S1 Status Summary with Count before Status", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    await editIndex(rootPath, (t) => `${t.trimEnd()}\n\n## 6. Status Summary\n\n| Count | Status |\n|---:|---|\n| 99 | planned |\n`);
    const root = await resolveProjectRoot(rootPath);
    const result = await syncIndexRollups(root, {});
    expect(result.ok).toBe(true);
    const summary = (await parseWorkspace(root)).index.statusSummary ?? [];
    expect(summary.every((entry) => Number.isFinite(entry.count))).toBe(true);
  });

  it("S2 Requirement Type Summary with an extra trailing column", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    await editIndex(rootPath, (t) => `${t.trimEnd()}\n\n## 6. Requirement Type Summary\n\n| Type | Prefix | Count | Note |\n|---|---|---:|---|\n| functional | FR | 99 | keep me |\n`);
    const root = await resolveProjectRoot(rootPath);
    const result = await syncIndexRollups(root, {});
    expect(result.ok).toBe(true);
    const text = await readFile(path.join(rootPath, INDEX), "utf8");
    expect(text).toContain("keep me");
  });
});
