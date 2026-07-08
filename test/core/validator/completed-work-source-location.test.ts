import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import { validateWorkspace } from "../../../src/core/validator/validate-workspace.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

const posix = (p: string) => p.replace(/\\/g, "/");
const HISTORY = "docs/spec/91.completed-work-log.md";

// FR-PARSE-031: §7 Completed Work Log diagnostics (SRS-W011..W015, W024) report the originating
// file via each entry sourceFile instead of a hardcoded docs/spec/00.index.md location.
describe("FR-PARSE-031 Completed Work Log diagnostics report source file location", () => {
  it("reports a malformed history-file row at the history file path (AC-1)", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    await writeFile(
      path.join(root, "docs", "spec", "91.completed-work-log.md"),
      [
        "## 7. Completed Work Log",
        "",
        "| Date | Target | Scope | Requirement IDs | Summary |",
        "|---|---|---|---|---|",
        "| not-a-date | v1.0.0 | ARCH | FR-ARCH-001 | History bad date row. |",
        ""
      ].join("\n"),
      "utf8"
    );

    const result = validateWorkspace(await parseWorkspace(await resolveProjectRoot(root)));
    const w011 = result.diagnostics.filter((d) => d.code === "SRS-W011");
    expect(w011).toHaveLength(1);
    expect(posix(w011[0]!.filePath!)).toBe(HISTORY);
  });

  it("still reports a malformed index row at 00.index.md (AC-2, no history file)", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    const indexPath = path.join(root, "docs", "spec", "00.index.md");
    const original = await readFile(indexPath, "utf8");
    const patched = original.replace(
      "| 2026-05-09 |  | ARCH |  | Cross-target fixture setup completed. |",
      "| 2026-05-09 |  | ARCH |  | Cross-target fixture setup completed. |\n| not-a-date |  | ARCH |  | Index bad date row. |"
    );
    await writeFile(indexPath, patched, "utf8");

    const result = validateWorkspace(await parseWorkspace(await resolveProjectRoot(root)));
    const w011 = result.diagnostics.filter((d) => d.code === "SRS-W011");
    expect(w011).toHaveLength(1);
    expect(posix(w011[0]!.filePath!)).toBe("docs/spec/00.index.md");
  });

  it("reports a history-file unregistered target (SRS-W012) at the history file path (W012-W015 source coverage)", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    await writeFile(
      path.join(root, "docs", "spec", "91.completed-work-log.md"),
      [
        "## 7. Completed Work Log",
        "",
        "| Date | Target | Scope | Requirement IDs | Summary |",
        "|---|---|---|---|---|",
        "| 2026-05-21 | v9.9.9 | ARCH | FR-ARCH-001 | History unknown target. |",
        ""
      ].join("\n"),
      "utf8"
    );

    const result = validateWorkspace(await parseWorkspace(await resolveProjectRoot(root)));
    const w012 = result.diagnostics.filter((d) => d.code === "SRS-W012");
    expect(w012).toHaveLength(1);
    expect(posix(w012[0]!.filePath!)).toBe(HISTORY);
  });
});
