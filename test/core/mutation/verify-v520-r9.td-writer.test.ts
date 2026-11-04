import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import { renameTarget } from "../../../src/core/mutation/rename-target.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

// Verification probes, round 9: rename-target rewrites the index's Active Target row with its own
// cell regex (column 1, trailing pipe required) instead of the parser's row reading, so index
// metadata shapes the parser accepts are reported renamed while the Active Target keeps the old name.

const INDEX = path.join("docs", "spec", "00.index.md");

async function editIndex(rootPath: string, edit: (lf: string) => string): Promise<void> {
  const file = path.join(rootPath, INDEX);
  const text = await readFile(file, "utf8");
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  await writeFile(file, edit(text.replace(/\r\n/g, "\n")).replace(/\n/g, newline), "utf8");
}

const SHAPES: ReadonlyArray<readonly [string, (lf: string) => string]> = [
  ["no trailing pipe", (t) => t.replace("| Active Target | v1.0.0 |", "| Active Target | v1.0.0")],
  [
    "value-first header",
    (t) =>
      t.replace(/\| Field \| Value \|\n\|---\|---\|\n((?:\|.*\n)+)/, (_m, rows: string) => `| Value | Field |\n|---|---|\n${rows.replace(/^\| ([^|]+?) \| ([^|]+?) \|$/gm, "| $2 | $1 |")}`)
  ]
];

describe("rename-target renames the Active Target the parser reads", () => {
  for (const [name, shape] of SHAPES) {
    it(`index metadata table shape: ${name}`, async () => {
      const rootPath = await copyFixtureWorkspace("mutation-target");
      await editIndex(rootPath, shape);
      const root = await resolveProjectRoot(rootPath);
      expect((await parseWorkspace(root)).index.activeTarget).toBe("v1.0.0");

      const result = await renameTarget(root, { from: "v1.0.0", to: "v1.0.9", dryRun: false });

      expect(result.ok, JSON.stringify(result.error)).toBe(true);
      expect((await parseWorkspace(root)).index.activeTarget).toBe("v1.0.9");
    });
  }
});
