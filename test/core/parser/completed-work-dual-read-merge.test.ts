import { writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

const posix = (p: string) => p.replace(/\\/g, "/");
const HISTORY = "docs/spec/91.completed-work-log.md";

// FR-PARSE-030: parseCompletedWork is exported and applied to both the index section-7 table and the
// history file; workspace.index.completedWork is the append-concatenation (index then history),
// each entry carries a sourceFile, and rows identical across sources are deduped with SRS-W025.
describe("FR-PARSE-030 Completed Work Log dual-read merge", () => {
  async function setup() {
    const root = await copyFixtureWorkspace("valid-basic");
    await writeFile(
      path.join(root, "docs", "spec", "91.completed-work-log.md"),
      [
        "## 7. Completed Work Log",
        "",
        "| Date | Target | Scope | Requirement IDs | Summary |",
        "|---|---|---|---|---|",
        // duplicate of the fixture index row (2026-05-10)
        "| 2026-05-10 | v1.0.0 | ARCH | FR-ARCH-001 | Fixture parser coverage completed. |",
        // history-only unique row
        "| 2026-05-12 | v1.0.0 | ARCH | FR-ARCH-001 | History-only entry. |",
        ""
      ].join("\n"),
      "utf8"
    );
    return parseWorkspace(await resolveProjectRoot(root));
  }

  it("merges index and history rows with source attribution and dedups identical rows", async () => {
    const ws = await setup();
    const cw = ws.index.completedWork;

    // index has 2 rows, history has 2 rows, 1 duplicate -> 3 unique entries
    expect(cw).toHaveLength(3);

    // index entry carries sourceFile = index
    const indexEntry = cw.find((e) => e.date === "2026-05-09");
    expect(posix(indexEntry!.sourceFile!)).toBe("docs/spec/00.index.md");

    // history-only entry carries sourceFile = history file and parsed columns
    const historyEntry = cw.find((e) => e.date === "2026-05-12");
    expect(historyEntry).toBeDefined();
    expect(posix(historyEntry!.sourceFile!)).toBe(HISTORY);
    expect(historyEntry!.target).toBe("v1.0.0");

    // the duplicated row appears exactly once
    expect(
      cw.filter((e) => e.date === "2026-05-10" && e.summary === "Fixture parser coverage completed.")
    ).toHaveLength(1);
  });

  it("emits SRS-W025 for a row duplicated across index and history", async () => {
    const ws = await setup();
    const dup = ws.diagnostics.filter((d) => d.code === "SRS-W025");
    expect(dup).toHaveLength(1);
    expect(posix(dup[0]!.filePath!)).toBe(HISTORY);
  });

  it("keeps history-file content out of parsed requirement records (FR-PARSE-029 AC-3)", async () => {
    const ws = await setup();
    expect(ws.records.length).toBeGreaterThan(0);
    expect(ws.records.every((r) => !posix(r.filePath).includes("91.completed-work-log.md"))).toBe(true);
  });

  // FND-005 regression: the dedup key must include Scope. Two rows that differ ONLY by scope are
  // distinct completed-work entries and must both survive without a spurious SRS-W025 warning.
  it("keeps two rows that differ only by scope and emits no SRS-W025 (FND-005)", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    await writeFile(
      path.join(root, "docs", "spec", "91.completed-work-log.md"),
      [
        "## 7. Completed Work Log",
        "",
        "| Date | Target | Scope | Requirement IDs | Summary |",
        "|---|---|---|---|---|",
        // same date/target/reqIds/summary as a fixture index row, but a DIFFERENT scope
        "| 2026-05-10 | v1.0.0 | NODE | FR-ARCH-001 | Fixture parser coverage completed. |",
        ""
      ].join("\n"),
      "utf8"
    );
    const ws = await parseWorkspace(await resolveProjectRoot(root));

    // Both the ARCH index row and the NODE history row must be present.
    const matching = ws.index.completedWork.filter(
      (e) => e.date === "2026-05-10" && e.summary === "Fixture parser coverage completed."
    );
    const scopes = matching.map((e) => e.scope).sort();
    expect(scopes).toEqual(["ARCH", "NODE"]);

    // No spurious duplicate warning, since the rows differ by scope.
    expect(ws.diagnostics.filter((d) => d.code === "SRS-W025")).toHaveLength(0);
  });

  it("parses six-column Report Paths rows from the history file (FR-PARSE-030 AC-4)", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    await writeFile(
      path.join(root, "docs", "spec", "91.completed-work-log.md"),
      [
        "## 7. Completed Work Log",
        "",
        "| Date | Target | Scope | Requirement IDs | Summary | Report Paths |",
        "|---|---|---|---|---|---|",
        "| 2026-05-20 | v1.0.0 | ARCH | FR-ARCH-001 | History six-column row. | docs/reports/h.md |",
        ""
      ].join("\n"),
      "utf8"
    );
    const ws = await parseWorkspace(await resolveProjectRoot(root));
    const entry = ws.index.completedWork.find((e) => e.date === "2026-05-20");
    expect(entry).toBeDefined();
    expect(entry!.reportPaths).toEqual(["docs/reports/h.md"]);
    expect(posix(entry!.sourceFile!)).toBe(HISTORY);
  });
});
