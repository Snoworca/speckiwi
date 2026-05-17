import { describe, expect, it } from "vitest";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { resolveProjectRoot } from "../../src/core/project-root.js";
import { parseWorkspace } from "../../src/core/parser/workspace-parser.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

describe("FR-PARSE-018 — Target Goal e2e (index + appendix merge)", () => {
  it("AC-3/AC-5: surfaces single-paragraph goal from 00.index.md", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");
    const root = await resolveProjectRoot(rootPath);
    const workspace = await parseWorkspace(root);
    expect(workspace.index.targetGoals["v1.0.0"]).toBe("Establish parser baseline.");
  });

  it("AC-2/AC-5: preserves multi-paragraph goal text from 00.index.md", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");
    const root = await resolveProjectRoot(rootPath);
    const workspace = await parseWorkspace(root);
    expect(workspace.index.targetGoals["v1.1.0"]).toBe(
      "Active Target empty-init policy.\nSecond paragraph continuation."
    );
  });

  it("AC-1/AC-3: includes goal block found in 90.appendix.md alongside 00.index.md goals", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");
    const root = await resolveProjectRoot(rootPath);
    const workspace = await parseWorkspace(root);
    expect(workspace.index.targetGoals["v1.2.0"]).toBe("Hardening governance.");
  });

  it("AC-4: empty targetGoals when fixture has no Goal block", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const root = await resolveProjectRoot(rootPath);
    const workspace = await parseWorkspace(root);
    expect(workspace.index.targetGoals).toEqual({});
  });

  it("SRS-W040: emits warning when same target is defined in both index and appendix; appendix value wins", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");
    const appendixPath = join(rootPath, "docs/spec/90.appendix.md");
    const conflictText = [
      "# Appendix",
      "",
      "### Target: v1.0.0",
      "",
      "**Goal:** Appendix override.",
      "",
      "### Target: v1.2.0",
      "",
      "**Goal:** Hardening governance."
    ].join("\n") + "\n";
    await writeFile(appendixPath, conflictText, "utf8");
    const root = await resolveProjectRoot(rootPath);
    const workspace = await parseWorkspace(root);
    const conflictDiagnostic = workspace.diagnostics.find((d) => d.code === "SRS-W040" && d.message.includes("v1.0.0"));
    expect(conflictDiagnostic).toBeDefined();
    expect(conflictDiagnostic?.severity).toBe("warning");
    expect(workspace.index.targetGoals["v1.0.0"]).toBe("Appendix override.");
    // Note: "appendix wins" is an implementation choice in workspace-parser, not a contract in FR-PARSE-018.
    // If the policy is later flipped to "index wins" the SRS-W040 emission must remain; only the value resolution changes.
  });

  it("SRS-W040: does NOT fire when index defines target A and appendix defines distinct target B", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");
    const root = await resolveProjectRoot(rootPath);
    const workspace = await parseWorkspace(root);
    const w040 = workspace.diagnostics.filter((d) => d.code === "SRS-W040");
    expect(w040).toHaveLength(0);
  });
});
