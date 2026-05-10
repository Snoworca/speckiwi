import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

function io() {
  return { stdout: new PassThrough() as NodeJS.WriteStream, stderr: new PassThrough() as NodeJS.WriteStream };
}

async function appendDeprecatedRequirement(root: string): Promise<void> {
  const specPath = path.join(root, "docs", "spec", "10.product-architecture.srs.md");
  const text = await readFile(specPath, "utf8");
  const blockStart = text.indexOf("### FR-ARCH-001");
  if (blockStart < 0) throw new Error("fixture requirement block not found");
  const deprecatedBlock = text
    .slice(blockStart)
    .replaceAll("FR-ARCH-001", "FR-ARCH-002")
    .replace("Fixture requirement", "Deprecated fixture requirement")
    .replace("| Status | planned |", "| Status | blocked |")
    .replace("| Stability | stable |", "| Stability | deprecated |");
  await writeFile(specPath, `${text.trimEnd()}\n\n${deprecatedBlock}\n`, "utf8");
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

  it("keeps deprecated requirements explicitly searchable while excluding them from default new-work candidates", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    await appendDeprecatedRequirement(root);

    const list = io();
    expect(await main(["--root", root, "list", "--status", "blocked", "--json"], list)).toBe(0);
    const listOutput = JSON.parse(list.stdout.read()?.toString() ?? "") as { records: Array<{ id: string }> };
    expect(listOutput.records.map((record) => record.id)).toEqual(["FR-ARCH-002"]);

    const show = io();
    expect(await main(["--root", root, "show", "FR-ARCH-002", "--json"], show)).toBe(0);
    const showOutput = JSON.parse(show.stdout.read()?.toString() ?? "") as { id: string; stability: string };
    expect(showOutput).toMatchObject({ id: "FR-ARCH-002", stability: "deprecated" });

    const summary = io();
    expect(await main(["--root", root, "summary", "--json"], summary)).toBe(0);
    const summaryOutput = JSON.parse(summary.stdout.read()?.toString() ?? "") as { deprecatedRequirements: string[]; newWorkCandidates: string[] };
    expect(summaryOutput.deprecatedRequirements).toContain("FR-ARCH-002");
    expect(summaryOutput.newWorkCandidates).not.toContain("FR-ARCH-002");
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
        countsByStability: { stable: 1 },
        blocked: [],
        implementedNotVerified: [],
        missingEvidence: [],
        draftRequirements: [],
        deprecatedRequirements: [],
        newWorkCandidates: ["FR-ARCH-001"],
        stabilityBlockers: [],
        stabilityWarnings: []
      }
    });

    const activeTarget = io();
    expect(await main(["--root", root, "active-target", "--json"], activeTarget)).toBe(0);
    const activeTargetOutput = JSON.parse(activeTarget.stdout.read()?.toString() ?? "");
    expect(activeTargetOutput.summary).toMatchObject({
      countsByStability: { stable: 1 },
      newWorkCandidates: ["FR-ARCH-001"],
      stabilityBlockers: [],
      stabilityWarnings: []
    });

    const summary = io();
    expect(await main(["--root", root, "summary", "--json"], summary)).toBe(0);
    const summaryOutput = JSON.parse(summary.stdout.read()?.toString() ?? "");
    expect(summaryOutput).toMatchObject({
      target: "v1.0.0",
      countsByStatus: { planned: 1 },
      countsByType: { functional: 1 },
      countsByStability: { stable: 1 },
      blocked: [],
      draftRequirements: [],
      deprecatedRequirements: [],
      newWorkCandidates: ["FR-ARCH-001"],
      stabilityBlockers: [],
      stabilityWarnings: [],
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
