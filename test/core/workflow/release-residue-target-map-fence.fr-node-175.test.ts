import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { summarizeReleaseReadiness } from "../../../src/core/workflow/release-readiness.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

// A residue row naming another target is skipped when the index registers that target. The registered
// targets come from the Target Map the index parser reads, so a fenced example of the Target Map
// earlier in the index must not stand in for it.

describe("FR-NODE-175 release residue reads the real Target Map, not a fenced example", () => {
  // @req FR-NODE-175 AC-10
  it("does not report a row naming a target that only the real Target Map registers", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");
    const indexPath = path.join(rootPath, "docs", "spec", "00.index.md");
    const text = await readFile(indexPath, "utf8");
    const newline = text.includes("\r\n") ? "\r\n" : "\n";
    const lines = text.split(/\r?\n/);
    const purpose = lines.findIndex((line) => /^## 1\. Purpose/.test(line));
    lines.splice(
      purpose + 3,
      0,
      "```markdown",
      "## 3. Target Map",
      "",
      "| Target | Type | Status | Description |",
      "|---|---|---|---|",
      "| v1.0.0 | release | active | Example |",
      "```",
      ""
    );
    const realRow = lines.lastIndexOf("| v1.0.0 | release | active | Fixture release |");
    lines.splice(realRow + 1, 0, "| v2.0.0 | release | planned | Later release |");
    lines.push(
      "",
      "## 12. Release Residue",
      "",
      "| Target | Requirement | Criterion | Reason |",
      "| --- | --- | --- | --- |",
      "| v2.0.0 | FR-ARCH-001 | AC-1 | Staged for the next release |",
      ""
    );
    await writeFile(indexPath, lines.join(newline), "utf8");

    const summary = summarizeReleaseReadiness(await parseWorkspace(await resolveProjectRoot(rootPath)), { target: "v1.0.0" });

    expect((summary.residueProblems ?? []).filter((problem) => problem.includes("v2.0.0"))).toEqual([]);
  });
});
