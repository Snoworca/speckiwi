import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import { syncIndexRollups } from "../../../src/core/mutation/sync-index.js";
import { addCompletedWork } from "../../../src/core/mutation/add-completed-work.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

// Verification probes, round 12: the index-table writes that moved onto the shared header-addressed
// row writer. Both documents below validate clean (no diagnostics), so the tool has to handle them.

const INDEX = path.join("docs", "spec", "00.index.md");
const HISTORY = path.join("docs", "spec", "91.completed-work-log.md");

async function readLf(rootPath: string, rel: string): Promise<string> {
  return (await readFile(path.join(rootPath, rel), "utf8")).replace(/^﻿/, "").replace(/\r\n/g, "\n");
}

describe("sync-index on a Requirement Type Summary without a Prefix column", () => {
  // @req FR-NODE-018 AC-3
  it("R1 syncs both rollups instead of refusing the whole sync over the absent Prefix column", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const index = (await readLf(rootPath, INDEX)).trimEnd();
    await writeFile(
      path.join(rootPath, INDEX),
      `${index}\n\n## 6. Status Summary\n\n| Status | Count |\n|---|---:|\n| planned | 9 |\n\n## 7. Requirement Type Summary\n\n| Type | Count |\n|---|---:|\n| functional | 9 |\n`,
      "utf8"
    );
    const root = await resolveProjectRoot(rootPath);
    const result = await syncIndexRollups(root, {});
    expect(result.ok).toBe(true);
    const { index: parsed } = await parseWorkspace(root);
    expect(parsed.statusSummary?.find((entry) => entry.status === "planned")?.count).toBe(1);
    expect(parsed.requirementTypeSummary?.find((entry) => entry.type === "functional")?.count).toBe(1);
  });
});

describe("add-completed-work on a log whose header lacks a column for a supplied value", () => {
  // @req FR-PARSE-043 AC-2
  it("R2 does not report success while the Scope it was given is dropped from the written row", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    await writeFile(
      path.join(rootPath, HISTORY),
      ["## 7. Completed Work Log", "", "| Date | Target | Requirement IDs | Summary |", "|---|---|---|---|", ""].join("\n"),
      "utf8"
    );
    const root = await resolveProjectRoot(rootPath);
    const result = await addCompletedWork(root, { date: "2026-11-04", summary: "probe", target: "v1.0.0", scope: "ARCH", requirementIds: [], allowIncomplete: true });
    const entry = (await parseWorkspace(root)).index.completedWork.find((row) => row.summary === "probe");
    // Either refused (nothing written), or written so that the parser reads back the Scope it reported.
    const silentlyDropped = result.ok && entry?.scope !== "ARCH";
    expect({ ok: result.ok, readBackScope: entry?.scope, silentlyDropped }).toMatchObject({ silentlyDropped: false });
  });
});
