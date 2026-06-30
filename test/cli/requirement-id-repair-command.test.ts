import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

function io() {
  return { stdout: new PassThrough() as NodeJS.WriteStream, stderr: new PassThrough() as NodeJS.WriteStream };
}

async function run(root: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const streams = io();
  const code = await main(["--root", root, ...args, "--json"], streams);
  return {
    code,
    stdout: streams.stdout.read()?.toString() ?? "",
    stderr: streams.stderr.read()?.toString() ?? ""
  };
}

async function runJson<T = Record<string, unknown>>(root: string, args: string[]): Promise<T> {
  const result = await run(root, args);
  expect(result.code, result.stderr || result.stdout).toBe(0);
  return JSON.parse(result.stdout) as T;
}

interface DiagnoseOutput {
  ok: true;
  value: {
    groups: Array<{
      duplicateId: string;
      occurrences: Array<{ filePath: string; headingLine: number; blockHash: string }>;
      candidateReplacementIds: string[];
    }>;
  };
}

function occurrence(value: { filePath: string; headingLine: number; blockHash: string }): string {
  return `${value.filePath}:${value.headingLine}:${value.blockHash}`;
}

describe("IR-CLI-044 Requirement ID collision repair commands", () => {
  it("diagnoses, plans, writes a plan file, and applies a selected collision repair", async () => {
    const root = await copyFixtureWorkspace("duplicate-id");
    const diagnosed = await runJson<DiagnoseOutput>(root, ["repair", "requirement-id-collisions", "diagnose"]);
    const group = diagnosed.value.groups.find((item) => item.duplicateId === "FR-ARCH-001");
    expect(group).toBeDefined();
    if (!group) return;

    const planPath = "kiwi/repair/fr-arch-001.json";
    const planned = await runJson<{
      ok: true;
      value: { replacementId: string; written: false; operations: unknown[] };
    }>(root, [
      "repair",
      "requirement-id-collisions",
      "plan",
      "--duplicate-id",
      group.duplicateId,
      "--keep",
      occurrence(group.occurrences[0]!),
      "--rename",
      occurrence(group.occurrences[1]!),
      "--allocate-next",
      "--write-plan",
      planPath
    ]);
    expect(planned.value).toMatchObject({ replacementId: "FR-ARCH-002", written: false });
    expect(await readFile(path.join(root, planPath), "utf8")).toContain('"replacementId": "FR-ARCH-002"');

    const applied = await runJson<{ ok: true; value: { written: boolean; completedOperations: number } }>(root, [
      "repair",
      "requirement-id-collisions",
      "apply",
      "--plan",
      planPath
    ]);
    expect(applied.value).toMatchObject({ written: true, completedOperations: 1 });

    const validated = await runJson<{ summary: { byCode: Record<string, number> } }>(root, ["validate"]);
    expect(validated.summary.byCode["SRS-E002"]).toBeUndefined();
  });

  it("keeps --ignore-lock on apply only and can bypass only the SRS lock", async () => {
    const root = await copyFixtureWorkspace("duplicate-id");
    const diagnosed = await runJson<DiagnoseOutput>(root, ["repair", "requirement-id-collisions", "diagnose"]);
    const group = diagnosed.value.groups[0]!;
    const planPath = "kiwi/repair/locked.json";
    await runJson(root, [
      "repair",
      "requirement-id-collisions",
      "plan",
      "--duplicate-id",
      group.duplicateId,
      "--keep",
      occurrence(group.occurrences[0]!),
      "--rename",
      occurrence(group.occurrences[1]!),
      "--replacement-id",
      "FR-ARCH-002",
      "--write-plan",
      planPath
    ]);

    await mkdir(path.join(root, "kiwi"), { recursive: true });
    await writeFile(
      path.join(root, "kiwi/.srs.lock"),
      JSON.stringify({
        schemaVersion: "1.0.0",
        owner: "cli-test",
        operation: "other_mutation",
        requestId: "repair-cli",
        acquiredAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 60_000).toISOString()
      }),
      "utf8"
    );

    const denied = await run(root, ["repair", "requirement-id-collisions", "apply", "--plan", planPath]);
    expect(denied.code).toBe(5);
    expect(JSON.parse(denied.stdout)).toMatchObject({ ok: false, error: { code: "SRS_LOCKED" } });

    const applied = await runJson<{ ok: true; diagnosticsSummary: { byCode: Record<string, number> } }>(root, [
      "repair",
      "requirement-id-collisions",
      "apply",
      "--plan",
      planPath,
      "--ignore-lock"
    ]);
    expect(applied.diagnosticsSummary.byCode["SRS-W067"]).toBe(1);
  });
});
