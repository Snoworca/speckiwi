import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { parseWorkspace } from "../../src/core/parser/workspace-parser.js";
import { resolveProjectRoot } from "../../src/core/project-root.js";
import { validateWorkspace } from "../../src/core/validator/validate-workspace.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

function io() {
  return { stdout: new PassThrough() as NodeJS.WriteStream, stderr: new PassThrough() as NodeJS.WriteStream };
}

async function runJson(root: string, args: string[], expected = 0): Promise<Record<string, unknown>> {
  const streams = io();
  expect(await main(["--root", root, ...args, "--json"], streams)).toBe(expected);
  return JSON.parse(streams.stdout.read()?.toString() ?? "") as Record<string, unknown>;
}

async function codes(root: string): Promise<string[]> {
  return validateWorkspace(await parseWorkspace(await resolveProjectRoot(root))).diagnostics.map((item) => item.code);
}

async function addRollupTables(root: string): Promise<void> {
  const indexPath = path.join(root, "docs", "spec", "00.index.md");
  const text = await readFile(indexPath, "utf8");
  await writeFile(
    indexPath,
    text.replace(
      "## 5. Completed Work Log",
      [
        "## 5. Status Summary",
        "",
        "| Status | Count |",
        "|---|---:|",
        "| planned | 1 |",
        "",
        "## 6. Requirement Type Summary",
        "",
        "| Type | Prefix | Count |",
        "|---|---|---:|",
        "| functional | FR | 1 |",
        "",
        "## 7. Completed Work Log"
      ].join("\n")
    ),
    "utf8"
  );
}

describe("FR-NODE-018 CLI sync-index command", () => {
  it("keeps validation clean after CLI add-requirement and update-status tool flows", async () => {
    const addRoot = await copyFixtureWorkspace("mutation-target");
    await addRollupTables(addRoot);

    const addResult = await runJson(addRoot, [
      "add-requirement",
      "--type",
      "reliability",
      "--scope",
      "ARCH",
      "--target",
      "v1.0.0",
      "--title",
      "CLI rollup-safe requirement",
      "--requirement",
      "CLI must keep rollups synchronized after requirement creation.",
      "--ac",
      "rollups synchronized",
      "--stability",
      "stable"
    ]);
    expect(addResult).toMatchObject({ ok: true, value: { written: true }, indexSync: { written: true, statusSummaryChanged: true, typeSummaryChanged: true } });
    expect(await codes(addRoot)).toEqual([]);

    const statusRoot = await copyFixtureWorkspace("mutation-target");
    await addRollupTables(statusRoot);

    const statusResult = await runJson(statusRoot, ["update-status", "FR-ARCH-001", "implemented"]);
    expect(statusResult).toMatchObject({ ok: true, value: { written: true }, indexSync: { written: true, statusSummaryChanged: true } });
    expect(await codes(statusRoot)).toEqual([]);
  });

  it("previews and writes index rollup repairs with stale guards", async () => {
    const root = await copyFixtureWorkspace("index-drift-type-summary");
    const workspace = await parseWorkspace(await resolveProjectRoot(root));
    const index = workspace.files.find((file) => file.relativePath === "docs/spec/00.index.md");

    const dryRun = await runJson(root, ["sync-index", "--dry-run"]);
    expect(dryRun).toMatchObject({
      ok: true,
      value: { written: false, typeSummaryChanged: true },
      mutation: { kind: "sync_index_rollups", dryRun: true, written: false }
    });
    expect(await codes(root)).toContain("SRS-W020");

    const stale = await runJson(root, ["sync-index", "--expected-sha256", "wrong"], 5);
    expect(stale).toMatchObject({ ok: false, error: { code: "STALE_PATCH" } });

    const written = await runJson(root, ["sync-index", "--expected-sha256", index?.snapshot?.sha256 ?? ""]);
    expect(written).toMatchObject({ ok: true, value: { written: true, typeSummaryChanged: true } });
    expect(await codes(root)).not.toContain("SRS-W020");
  });
});
