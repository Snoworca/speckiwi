import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { updateRequirementFields } from "../../../src/core/mutation/edit-requirement.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

// FR-NODE-267 — a title change keeps the heading markers the status and stability mutations own.
//
// edit-requirement rewrote the heading as `### <id> — <title>` only, which dropped the
// `[DRAFT — pending decision]` marker that update_stability writes only on a transition INTO draft,
// so the heading and the Stability row then disagreed with no way back.

const ORIGINAL_HEADING = "### FR-ARCH-001 — Mutable requirement";

/** The mutation-target fixture with FR-ARCH-001's heading and one metadata row rewritten. */
async function fixture(heading: string, row: { field: "Stability" | "Status"; from: string; to: string }) {
  const rootPath = await copyFixtureWorkspace("mutation-target");
  const specPath = path.join(rootPath, "docs", "spec", "10.product-architecture.srs.md");
  const text = await readFile(specPath, "utf8");
  const rewritten = text.replace(ORIGINAL_HEADING, heading).replace(`| ${row.field} | ${row.from} |`, `| ${row.field} | ${row.to} |`);
  expect(rewritten).toContain(heading);
  expect(rewritten).toContain(`| ${row.field} | ${row.to} |`);
  await writeFile(specPath, rewritten, "utf8");
  return { rootPath, specPath, root: await resolveProjectRoot(rootPath) };
}

function headingOf(text: string): string | undefined {
  return text.split(/\r?\n/).find((line) => line.startsWith("### ") && line.includes("FR-ARCH-001"));
}

const DRAFT_MARKERS = [
  "[DRAFT — pending decision]",
  "[DRAFT — pending decision, see FR-ARCH-009]",
  "[DRAFT — pending decision, see FR-ARCH-009 +2]"
];

describe("FR-NODE-267 AC-1 — a draft requirement's title change keeps its [DRAFT — pending decision] marker", () => {
  for (const marker of DRAFT_MARKERS) {
    // @req FR-NODE-267 AC-1
    it(`keeps ${marker} in the written file`, async () => {
      const { specPath, root } = await fixture(`${ORIGINAL_HEADING} ${marker}`, { field: "Stability", from: "stable", to: "draft" });

      const result = await updateRequirementFields(root, { id: "FR-ARCH-001", title: "Renamed requirement" });

      expect(result.ok, JSON.stringify(result.error)).toBe(true);
      expect(headingOf(await readFile(specPath, "utf8"))).toBe(`### FR-ARCH-001 — Renamed requirement ${marker}`);
    });

    // @req FR-NODE-267 AC-1
    it(`keeps ${marker} in the --dry-run preview and writes nothing`, async () => {
      const { specPath, root } = await fixture(`${ORIGINAL_HEADING} ${marker}`, { field: "Stability", from: "stable", to: "draft" });
      const before = await readFile(specPath, "utf8");

      const result = await updateRequirementFields(root, { id: "FR-ARCH-001", title: "Renamed requirement", dryRun: true });

      expect(result.ok, JSON.stringify(result.error)).toBe(true);
      expect(result.mutation?.preview).toEqual([`### FR-ARCH-001 — Renamed requirement ${marker}`]);
      expect(await readFile(specPath, "utf8")).toBe(before);
    });
  }
});

const DISCARDED_HEADINGS = [
  { heading: "### ~~FR-ARCH-001 — Mutable requirement~~ [DISCARDED]", renamed: "### ~~FR-ARCH-001 — Renamed requirement~~ [DISCARDED]" },
  {
    heading: "### ~~FR-ARCH-001 — Mutable requirement~~ [DISCARDED → see FR-ARCH-009 +1]",
    renamed: "### ~~FR-ARCH-001 — Renamed requirement~~ [DISCARDED → see FR-ARCH-009 +1]"
  }
];

describe("FR-NODE-267 AC-2 — the strikethrough and [DISCARDED] marker are kept or the edit is refused", () => {
  for (const { heading, renamed } of DISCARDED_HEADINGS) {
    for (const dryRun of [false, true]) {
      // @req FR-NODE-267 AC-2
      it(`never writes ${JSON.stringify(heading)} without its markers${dryRun ? " (--dry-run)" : ""}`, async () => {
        const { specPath, root } = await fixture(heading, { field: "Status", from: "planned", to: "discarded" });
        const before = await readFile(specPath, "utf8");

        const result = await updateRequirementFields(root, { id: "FR-ARCH-001", title: "Renamed requirement", dryRun });
        const after = await readFile(specPath, "utf8");

        if (result.ok) {
          const expected = dryRun ? heading : renamed;
          expect(headingOf(after)).toBe(expected);
          expect(result.mutation?.preview).toEqual([renamed]);
        } else {
          expect(after).toBe(before);
        }
      });
    }
  }
});
