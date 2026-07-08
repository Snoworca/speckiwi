import { writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { discoverSrsFiles } from "../../../src/core/parser/discover.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

const posix = (p: string) => p.replace(/\\/g, "/");
const HISTORY = "docs/spec/91.completed-work-log.md";

// FR-PARSE-029: discoverSrsFiles optionally reads docs/spec/91.completed-work-log.md as
// SrsFileSet.completedWorkLog (a non-.srs.md file read like 90.appendix.md), excluded from
// scopeFiles, stepFiles, and parsed records.
describe("FR-PARSE-029 Completed Work Log history file discovery", () => {
  it("exposes the history file as completedWorkLog and keeps it out of scope/step files", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    await writeFile(
      path.join(root, "docs", "spec", "91.completed-work-log.md"),
      "## 7. Completed Work Log\n\n| Date | Target | Scope | Requirement IDs | Summary | Report Paths |\n|---|---|---|---|---|---|\n",
      "utf8"
    );

    const files = await discoverSrsFiles(await resolveProjectRoot(root));

    expect(files.completedWorkLog).toBeDefined();
    expect(posix(files.completedWorkLog!.relativePath)).toBe(HISTORY);

    const scopeRel = files.scopeFiles.map((f) => posix(f.relativePath));
    const stepRel = files.stepFiles.map((f) => posix(f.relativePath));
    expect(scopeRel).not.toContain(HISTORY);
    expect(stepRel).not.toContain(HISTORY);
  });

  it("leaves completedWorkLog undefined when the history file is absent", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    const files = await discoverSrsFiles(await resolveProjectRoot(root));
    expect(files.completedWorkLog).toBeUndefined();
  });
});
