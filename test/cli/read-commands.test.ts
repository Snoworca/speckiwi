import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

function io() {
  return { stdout: new PassThrough() as NodeJS.WriteStream, stderr: new PassThrough() as NodeJS.WriteStream };
}

describe("read-only CLI commands", () => {
  it("validates, lists, shows, summarizes, and checks links", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    for (const args of [
      ["--root", root, "validate", "--json"],
      ["--root", root, "list", "--json"],
      ["--root", root, "show", "FR-ARCH-001", "--json", "--markdown"],
      ["--root", root, "active-target", "--json"],
      ["--root", root, "summary", "--json"],
      ["--root", root, "links", "check", "--json"]
    ]) {
      const streams = io();
      const code = await main(args, streams);
      expect(code).toBe(0);
      expect(() => JSON.parse(streams.stdout.read()?.toString() ?? "")).not.toThrow();
    }
  });

  it("adds diagnostics summaries to read JSON payloads and expands target summaries", async () => {
    const root = await copyFixtureWorkspace("valid-basic");

    const validate = io();
    expect(await main(["--root", root, "validate", "--json"], validate)).toBe(0);
    const validateOutput = JSON.parse(validate.stdout.read()?.toString() ?? "");
    expect(validateOutput.summary).toEqual({ errors: 0, warnings: 1, byCode: { "SRS-W015": 1 } });

    const targets = io();
    expect(await main(["--root", root, "targets", "--json"], targets)).toBe(0);
    const targetsOutput = JSON.parse(targets.stdout.read()?.toString() ?? "");
    expect(targetsOutput.diagnosticsSummary).toEqual({ errors: 0, warnings: 1, byCode: { "SRS-W015": 1 } });
    expect(targetsOutput.targets[0]).toMatchObject({
      target: "v1.0.0",
      summary: {
        countsByStatus: { planned: 1 },
        countsByType: { functional: 1 },
        blocked: [],
        implementedNotVerified: [],
        missingEvidence: []
      }
    });

    const summary = io();
    expect(await main(["--root", root, "summary", "--json"], summary)).toBe(0);
    const summaryOutput = JSON.parse(summary.stdout.read()?.toString() ?? "");
    expect(summaryOutput).toMatchObject({
      target: "v1.0.0",
      countsByStatus: { planned: 1 },
      countsByType: { functional: 1 },
      blocked: [],
      diagnosticsSummary: { errors: 0, warnings: 1, byCode: { "SRS-W015": 1 } }
    });
  });

  it("reads completed work and reports empty active target honestly", async () => {
    const root = await copyFixtureWorkspace("valid-basic");

    const completed = io();
    expect(await main(["--root", root, "completed-work", "--target", "v1.0.0", "--scope", "ARCH", "--since", "2026-05-09", "--limit", "2", "--json"], completed)).toBe(0);
    const completedOutput = JSON.parse(completed.stdout.read()?.toString() ?? "");
    expect(completedOutput.completedWork.map((entry: { summary: string }) => entry.summary)).toEqual([
      "Fixture parser coverage completed.",
      "Cross-target fixture setup completed."
    ]);

    const completedFileOrder = io();
    expect(await main(["--root", root, "completed-work", "--target", "v1.0.0", "--scope", "ARCH", "--since", "2026-05-09", "--limit", "2", "--order", "file", "--json"], completedFileOrder)).toBe(0);
    const fileOrderOutput = JSON.parse(completedFileOrder.stdout.read()?.toString() ?? "");
    expect(fileOrderOutput.completedWork.map((entry: { summary: string }) => entry.summary)).toEqual([
      "Cross-target fixture setup completed.",
      "Fixture parser coverage completed."
    ]);

    const invalidLimit = io();
    expect(await main(["--root", root, "completed-work", "--limit", "0"], invalidLimit)).toBe(2);
    expect(invalidLimit.stderr.read()?.toString()).toContain("limit must be a positive integer");

    const invalidOrder = io();
    expect(await main(["--root", root, "completed-work", "--order", "random"], invalidOrder)).toBe(2);
    expect(invalidOrder.stderr.read()?.toString()).toContain("order must be latest or file");

    const mutationRoot = await copyFixtureWorkspace("mutation-target");
    const indexPath = path.join(mutationRoot, "docs", "spec", "00.index.md");
    await writeFile(indexPath, (await readFile(indexPath, "utf8")).replace("| Active Target | v1.0.0 |", "| Active Target |  |"), "utf8");
    const activeTarget = io();
    expect(await main(["--root", mutationRoot, "active-target", "--json"], activeTarget)).toBe(0);
    const activeOutput = JSON.parse(activeTarget.stdout.read()?.toString() ?? "");
    expect(activeOutput.activeTarget).toBe("");
    expect(activeOutput.summary.target).toBe("");
    expect(activeOutput.summary.completedWork).toEqual([]);
  });
});
