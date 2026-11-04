import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import { addRequirement } from "../../../src/core/mutation/add-requirement.js";
import { updateStatus } from "../../../src/core/mutation/update-status.js";
import { addCompletedWork } from "../../../src/core/mutation/add-completed-work.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

// Verification probes, round 13: the shared header-addressed writer refuses a table that lacks the
// column holding its core value. These probes look at what the mutations that run sync-index as a
// follow-up do with that refusal.

const INDEX = path.join("docs", "spec", "00.index.md");
const SCOPE = path.join("docs", "spec", "10.product-architecture.srs.md");

async function readLf(rootPath: string, rel: string): Promise<string> {
  return (await readFile(path.join(rootPath, rel), "utf8")).replace(/^﻿/, "").replace(/\r\n/g, "\n");
}

/** A mutation-target copy whose Status Summary has a lowercase `count` column the writer refuses. */
async function workspaceWithUnwritableRollup(): Promise<string> {
  const rootPath = await copyFixtureWorkspace("mutation-target");
  const index = (await readLf(rootPath, INDEX)).trimEnd();
  await writeFile(path.join(rootPath, INDEX), `${index}\n\n## 6. Status Summary\n\n| Status | count |\n|---|---:|\n| planned | 1 |\n`, "utf8");
  return rootPath;
}

describe("a mutation whose follow-up rollup sync is refused", () => {
  // @req FR-NODE-018 AC-1
  it("T1 add-requirement does not report failure after it already wrote the requirement block", async () => {
    const rootPath = await workspaceWithUnwritableRollup();
    const root = await resolveProjectRoot(rootPath);
    const before = await readLf(rootPath, SCOPE);
    const result = await addRequirement(root, { type: "functional", scope: "ARCH", target: "v1.0.0", title: "Probe", statement: "The system shall probe.", acceptanceCriteria: ["probe"] });
    const after = await readLf(rootPath, SCOPE);
    // Either the whole change is refused and the scope document is untouched, or it is reported as written.
    expect({ ok: result.ok, scopeChanged: after !== before }).not.toEqual({ ok: false, scopeChanged: true });
  });

  // @req FR-NODE-018 AC-2
  it("T2 update-status does not report failure after it already wrote the new Status", async () => {
    const rootPath = await workspaceWithUnwritableRollup();
    const root = await resolveProjectRoot(rootPath);
    const result = await updateStatus(root, { id: "FR-ARCH-001", status: "in_progress" });
    const record = (await parseWorkspace(root)).records.find((candidate) => candidate.id === "FR-ARCH-001");
    expect({ ok: result.ok, status: record?.status }).not.toEqual({ ok: false, status: "in_progress" });
  });
});

const HISTORY = path.join("docs", "spec", "91.completed-work-log.md");

describe("add-completed-work with Report Paths on a log that has a column of its own", () => {
  // @req FR-PARSE-043 AC-2
  it("T3 keeps the values of a column the log already holds when it adds the Report Paths column", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    await writeFile(
      path.join(rootPath, HISTORY),
      ["## 7. Completed Work Log", "", "| Date | Target | Scope | Requirement IDs | Summary | Owner |", "|---|---|---|---|---|---|", "| 2026-11-01 | v1.0.0 | ARCH | FR-ARCH-001 | earlier | alice |", ""].join("\n"),
      "utf8"
    );
    const root = await resolveProjectRoot(rootPath);
    const result = await addCompletedWork(root, { date: "2026-11-04", summary: "probe", target: "v1.0.0", scope: "ARCH", requirementIds: [], reportPaths: ["docs/report.md"], allowIncomplete: true });
    const text = await readLf(rootPath, HISTORY);
    // Either refused with the log untouched, or written with the earlier row's Owner value still there.
    expect({ ok: result.ok, ownerKept: text.includes("alice") }).not.toEqual({ ok: true, ownerKept: false });
  });
});
