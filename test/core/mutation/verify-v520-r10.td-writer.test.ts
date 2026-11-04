import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import { renameTarget } from "../../../src/core/mutation/rename-target.js";
import { setActiveTarget } from "../../../src/core/mutation/set-active-target.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

// Verification probes, round 10: set-active-target writes the Active Target row and Target Map rows
// with its own row matcher and fixed column order instead of the shared metadata writer, and
// rename-target renames a goal heading onto a name that already has one.

const INDEX = path.join("docs", "spec", "00.index.md");

async function editIndex(rootPath: string, edit: (lf: string) => string, bom = false): Promise<void> {
  const file = path.join(rootPath, INDEX);
  const text = (await readFile(file, "utf8")).replace(/^﻿/, "");
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  await writeFile(file, `${bom ? "﻿" : ""}${edit(text.replace(/\r\n/g, "\n")).replace(/\n/g, newline)}`, "utf8");
}

describe("set-active-target writes the rows the index parser reads", () => {
  it("P1 a compact Active Target row that ends the metadata table", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    await editIndex(rootPath, (t) => t.replace("| Active Target | v1.0.0 |\n| Status | baseline |", "| Status | baseline |\n|Active Target|v1.0.0|"));
    const root = await resolveProjectRoot(rootPath);
    expect((await parseWorkspace(root)).index.activeTarget).toBe("v1.0.0");

    const result = await setActiveTarget(root, { target: "v1.1.0" });

    expect(result.ok).toBe(true);
    expect((await parseWorkspace(root)).index.activeTarget).toBe("v1.1.0");
  });

  it("P2 a Target Map whose Status column comes before Type", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    await editIndex(rootPath, (t) =>
      t
        .replace("| Target | Type | Status | Description |", "| Target | Status | Type | Description |")
        .replace("| v1.0.0 | release | active | Fixture release |", "| v1.0.0 | active | release | Fixture release |")
        .replace("| v1.1.0 | version | planned | Next fixture target |", "| v1.1.0 | planned | version | Next fixture target |")
    );
    const root = await resolveProjectRoot(rootPath);

    const result = await setActiveTarget(root, { target: "v1.1.0" });

    expect(result.ok).toBe(true);
    const targets = (await parseWorkspace(root)).index.targets.map((entry) => `${entry.target}:${entry.status}:${entry.type}`);
    expect(targets).toEqual(["v1.0.0:planned:release", "v1.1.0:active:version"]);
  });
});

describe("rename-target probes", () => {
  it("P5 a goal heading already present under the new name does not replace the renamed target's goal", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    await editIndex(rootPath, (t) =>
      t.replace(
        "## 4. Scope Map",
        "### Target: v1.0.0\n\n**Goal:** Ship the real work.\n\n### Target: v1.0.9\n\n**Goal:** Stale draft goal.\n\n## 4. Scope Map"
      )
    );
    const root = await resolveProjectRoot(rootPath);
    const result = await renameTarget(root, { from: "v1.0.0", to: "v1.0.9", dryRun: false });
    const goal = (await parseWorkspace(root)).index.targetGoals["v1.0.9"];
    // Either the rename refuses, or the renamed target keeps its own goal.
    expect(result.ok ? goal : "refused").toBe(result.ok ? "Ship the real work." : "refused");
  });
});
