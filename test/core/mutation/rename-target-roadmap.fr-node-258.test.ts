import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { todayStamp } from "../../../src/core/date-stamp.js";
import { renameTarget } from "../../../src/core/mutation/rename-target.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { readRoadmap } from "../../../src/core/roadmap/load-roadmap.js";
import { parseRoadmap } from "../../../src/core/roadmap/parse-roadmap.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";
import { roadmapText, sources } from "../roadmap/roadmap-fixture.js";

// FR-NODE-258 — a target rename rewrites the roadmap's Targets entries that name the old target, in the
// same locked write as the SRS rename. The workspace registers both `5.2` and `5.2.0`, so every rewrite
// has a near-miss neighbour.

async function workspace(withRoadmap = true): Promise<{ rootPath: string; roadmap: string }> {
  const rootPath = await copyFixtureWorkspace("valid-basic");
  const index = path.join(rootPath, "docs", "spec", "00.index.md");
  const text = await readFile(index, "utf8");
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  await writeFile(
    index,
    text.replace("| v1.0.0 | release | active | Fixture release |", ["| v1.0.0 | release | active | Fixture release |", "| 5.2 | release | planned | Short name |", "| 5.2.0 | version | planned | Long name |"].join(newline)),
    "utf8"
  );
  const roadmap = path.join(rootPath, "docs", "roadmap.md");
  if (withRoadmap) {
    await writeFile(roadmap, roadmapText({ n: 1, fields: { Targets: "5.2, v1.0.0" } }, { n: 2, fields: { Targets: "5.2.0" } }, { n: 3, fields: { Targets: "5.2" } }), "utf8");
  }
  return { rootPath, roadmap };
}

const lf = async (file: string) => (await readFile(file, "utf8")).replace(/\r\n/g, "\n");

describe("FR-NODE-258 AC-1 — the roadmap Targets entries follow the rename", () => {
  // @req FR-NODE-258 AC-1
  it("replaces the old name in each Targets list, appends a Targets history row naming the rename, and reports each location", async () => {
    const { rootPath, roadmap } = await workspace();
    const original = parseRoadmap(await lf(roadmap), sources()).document.items;
    const result = await renameTarget(await resolveProjectRoot(rootPath), { from: "5.2", to: "5.3", dryRun: false });
    expect(result.ok).toBe(true);
    expect(result.value?.written).toBe(true);
    const items = parseRoadmap(await lf(roadmap), sources()).document.items;
    expect(items.map((item) => item.fields.Targets?.value)).toEqual(["5.3, v1.0.0", "5.2.0", "5.3"]);
    const last = (index: number) => items[index]!.history.at(-1)!;
    expect([last(0).date, last(0).field, last(0).from, last(0).to]).toEqual([todayStamp(), "Targets", "5.2, v1.0.0", "5.3, v1.0.0"]);
    expect(last(0).reason).toContain("5.2");
    expect(last(0).reason).toContain("5.3");
    expect(last(0).reason.toLowerCase()).toContain("rename");
    expect([last(2).field, last(2).from, last(2).to]).toEqual(["Targets", "5.2", "5.3"]);
    const located = result.value!.locations.filter((location) => location.file === "docs/roadmap.md");
    expect(located.map((location) => [location.kind, location.line, location.after])).toEqual([
      // Lines of the document as it was read, like every other location the rename reports.
      ["roadmap-targets", original[0]!.fields.Targets!.line, "| Targets | 5.3, v1.0.0 |"],
      ["roadmap-targets", original[2]!.fields.Targets!.line, "| Targets | 5.3 |"]
    ]);
    expect(located[0]!.before).toBe("| Targets | 5.2, v1.0.0 |");
  });
});

describe("FR-NODE-258 AC-2 — whole entries only, and no roadmap means no roadmap write", () => {
  // @req FR-NODE-258 AC-2
  it("leaves a 5.2.0 entry and its history untouched when 5.2 is renamed", async () => {
    const { rootPath, roadmap } = await workspace();
    await renameTarget(await resolveProjectRoot(rootPath), { from: "5.2", to: "5.3", dryRun: false });
    const neighbour = parseRoadmap(await lf(roadmap), sources()).document.items[1]!;
    expect(neighbour.fields.Targets?.value).toBe("5.2.0");
    expect(neighbour.history.map((row) => row.field)).toEqual(["Created"]);
  });

  // @req FR-NODE-258 AC-2
  it("writes no roadmap when docs/roadmap.md does not exist", async () => {
    const { rootPath, roadmap } = await workspace(false);
    const result = await renameTarget(await resolveProjectRoot(rootPath), { from: "5.2", to: "5.3", dryRun: false });
    expect(result.ok).toBe(true);
    expect(result.value?.locations.some((location) => location.file === "docs/roadmap.md")).toBe(false);
    expect(existsSync(roadmap)).toBe(false);
  });
});

describe("FR-NODE-258 AC-3 — previewable, and no stale name afterwards", () => {
  // @req FR-NODE-258 AC-3
  it("shows the roadmap rewrite in a dry-run plan and writes nothing", async () => {
    const { rootPath, roadmap } = await workspace();
    const before = await readFile(roadmap, "utf8");
    const index = await readFile(path.join(rootPath, "docs", "spec", "00.index.md"), "utf8");
    const result = await renameTarget(await resolveProjectRoot(rootPath), { from: "5.2", to: "5.3" });
    expect(result.value?.dryRun).toBe(true);
    expect(result.value?.locations.filter((location) => location.kind === "roadmap-targets")).toHaveLength(2);
    expect(await readFile(roadmap, "utf8")).toBe(before);
    expect(await readFile(path.join(rootPath, "docs", "spec", "00.index.md"), "utf8")).toBe(index);
  });

  // @req FR-NODE-258 AC-3
  it("leaves the roadmap check with no ROADMAP-W009 for the new name after a rename that writes", async () => {
    const { rootPath } = await workspace();
    const root = await resolveProjectRoot(rootPath);
    const before = await readRoadmap(root, { asOf: "2026-11-05" });
    expect(before.ok && before.value.diagnostics.filter((item) => item.code === "ROADMAP-W009")).toEqual([]);
    await renameTarget(root, { from: "5.2", to: "5.3", dryRun: false });
    const after = await readRoadmap(root, { asOf: "2026-11-05" });
    expect(after.ok && after.value.diagnostics).toEqual([]);
  });
});
