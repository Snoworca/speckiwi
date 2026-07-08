import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";
import { editAcceptanceCriteria } from "../../../src/core/mutation/check-ac.js";

// FR-NODE-026 — hardening tests for edit_acceptance_criteria.
//
// FND-005 (input validation): input.text is written verbatim onto the AC line, so
//   a newline would split the AC entry into two lines and a control char would
//   corrupt the row. editAcceptanceCriteria MUST reject empty / over-long /
//   control-char / newline text with USAGE and write nothing — matching the
//   updateRequirementStatement guard.

const ARCH_FILE = path.join("docs", "spec", "10.product-architecture.srs.md");

async function readArch(rootPath: string): Promise<string> {
  return readFile(path.join(rootPath, ARCH_FILE), "utf8");
}

describe("FR-NODE-026 FND-005 — edit_acceptance_criteria rejects unsafe text and writes nothing", () => {
  const cases: Array<{ label: string; text: string }> = [
    { label: "empty text", text: "" },
    { label: "newline (LF)", text: "first line\nsecond line" },
    { label: "carriage return", text: "first\rsecond" },
    { label: "NUL control char", text: `before${String.fromCharCode(0)}after` }
  ];

  for (const { label, text } of cases) {
    it(`rejects ${label} with USAGE and leaves the document unchanged`, async () => {
      const rootPath = await copyFixtureWorkspace("mutation-target");
      const root = await resolveProjectRoot(rootPath);
      const before = await readArch(rootPath);

      const result = await editAcceptanceCriteria(root, {
        id: "FR-ARCH-001",
        acId: "AC-1",
        text
      });

      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe("USAGE");
      expect(await readArch(rootPath)).toBe(before);
    });
  }

  it("rejects text exceeding the maximum length with USAGE and leaves the document unchanged", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const root = await resolveProjectRoot(rootPath);
    const before = await readArch(rootPath);

    const result = await editAcceptanceCriteria(root, {
      id: "FR-ARCH-001",
      acId: "AC-1",
      text: "x".repeat(5000)
    });

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("USAGE");
    expect(await readArch(rootPath)).toBe(before);
  });
});
