import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { addRequirement } from "../../../src/core/mutation/add-requirement.js";
import { updateRequirementFields } from "../../../src/core/mutation/edit-requirement.js";
import { supersedeRequirement } from "../../../src/core/mutation/supersede-requirement.js";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

// FR-NODE-266 — requirement title writers refuse a title the parser would report as SRS-E020.
//
// The writers checked a title only for line breaks and control characters, while the SRS-E020 rule
// lived only in the parser, so a title with a code span was written with ok and validate then
// rejected the heading.

const FORBIDDEN_TITLES: Readonly<Record<string, string>> = {
  "inline link": "See [the guide](https://example.com/guide) first",
  "code span": "Parse the `--json` flag",
  bold: "A **bold** claim",
  italic: "An *italic* claim",
  emoji: "Ship it 🚀"
};

async function specSnapshot(rootPath: string): Promise<string> {
  const specDir = path.join(rootPath, "docs", "spec");
  const names = (await readdir(specDir)).sort();
  return (await Promise.all(names.map((name) => readFile(path.join(specDir, name), "utf8")))).join("\n--\n");
}

async function fixture() {
  const rootPath = await copyFixtureWorkspace("mutation-target");
  return { rootPath, root: await resolveProjectRoot(rootPath) };
}

function addWith(title: string) {
  return { type: "functional" as const, scope: "ARCH", target: "v1.0.0", title, statement: "S.", acceptanceCriteria: ["criterion"] };
}

describe("FR-NODE-266 AC-1 — add-requirement and supersede refuse a forbidden title and write nothing", () => {
  for (const [kind, title] of Object.entries(FORBIDDEN_TITLES)) {
    // @req FR-NODE-266 AC-1
    it(`add-requirement refuses a title holding ${kind}`, async () => {
      const { rootPath, root } = await fixture();
      const before = await specSnapshot(rootPath);

      const result = await addRequirement(root, addWith(title));

      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe("USAGE");
      expect(result.error?.message).toMatch(/\btitle\b/);
      expect(await specSnapshot(rootPath)).toBe(before);
    });

    // @req FR-NODE-266 AC-1
    it(`supersede refuses a title holding ${kind}`, async () => {
      const { rootPath, root } = await fixture();
      const before = await specSnapshot(rootPath);

      const result = await supersedeRequirement(root, {
        oldId: "FR-ARCH-001",
        scope: "ARCH",
        target: "v1.0.0",
        title,
        statement: "S.",
        acceptanceCriteria: ["criterion"],
        reason: "probe",
        confirmDiscardVerified: true
      });

      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe("USAGE");
      expect(result.error?.message).toMatch(/\btitle\b/);
      expect(await specSnapshot(rootPath)).toBe(before);
    });
  }
});

describe("FR-NODE-266 AC-2 — edit-requirement refuses the same way, with and without --dry-run", () => {
  for (const [kind, title] of Object.entries(FORBIDDEN_TITLES)) {
    for (const dryRun of [false, true]) {
      // @req FR-NODE-266 AC-2
      it(`edit-requirement refuses a title holding ${kind}${dryRun ? " under --dry-run" : ""}`, async () => {
        const { rootPath, root } = await fixture();
        const before = await specSnapshot(rootPath);

        const result = await updateRequirementFields(root, { id: "FR-ARCH-001", title, dryRun });

        expect(result.ok).toBe(false);
        expect(result.error?.code).toBe("USAGE");
        expect(result.error?.message).toMatch(/\btitle\b/);
        expect(await specSnapshot(rootPath)).toBe(before);
      });
    }
  }
});

describe("FR-NODE-266 AC-3 — a title the writers accept never makes validate report SRS-E020", () => {
  // Titles on both sides of the rule, the near misses included: underscores inside a word, a lone
  // asterisk, square brackets without a link target. Whatever a writer decides, the parser must agree.
  const SAMPLES = [
    ...Object.values(FORBIDDEN_TITLES),
    "Plain words only",
    "snake_case_name stays",
    "2 * 3 is arithmetic",
    "A [TBD] note",
    "Path a/b(c)",
    "__dunder__ wrapper"
  ];

  for (const title of SAMPLES) {
    // @req FR-NODE-266 AC-3
    it(`writer and parser agree on ${JSON.stringify(title)}`, async () => {
      const { rootPath, root } = await fixture();
      const edited = await updateRequirementFields(root, { id: "FR-ARCH-001", title });
      if (!edited.ok) {
        // Refused: the parser must report SRS-E020 for the same heading written by hand.
        const file = path.join(rootPath, "docs", "spec", "10.product-architecture.srs.md");
        const text = await readFile(file, "utf8");
        await writeFile(file, text.replace("### FR-ARCH-001 — Mutable requirement", `### FR-ARCH-001 — ${title}`), "utf8");
      }
      const codes = (await parseWorkspace(root)).diagnostics.filter((entry) => entry.code === "SRS-E020");
      expect(codes.length > 0, `writer ${edited.ok ? "accepted" : "refused"} the title`).toBe(!edited.ok);
    });
  }
});
