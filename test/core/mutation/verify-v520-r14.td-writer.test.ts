import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import { validateWorkspace } from "../../../src/core/validator/validate-workspace.js";
import { addRequirement } from "../../../src/core/mutation/add-requirement.js";
import { updateStatus } from "../../../src/core/mutation/update-status.js";
import { syncIndexRollups } from "../../../src/core/mutation/sync-index.js";
import { supersedeRequirement } from "../../../src/core/mutation/supersede-requirement.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

// Verification probes, round 14: the pre-write rollup check, written=false on a no-op, and the
// remaining "wrote, then reported failure" paths.

const INDEX = path.join("docs", "spec", "00.index.md");
const SCOPE = path.join("docs", "spec", "10.product-architecture.srs.md");

// Lets one test edit the index between the pre-write rollup check and the write, as another editor would.
const race = vi.hoisted(() => ({ afterCheck: undefined as undefined | (() => Promise<void>) }));
vi.mock("../../../src/core/mutation/sync-index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/core/mutation/sync-index.js")>();
  return {
    ...actual,
    checkIndexRollupsWritableAt: async (...args: Parameters<typeof actual.checkIndexRollupsWritableAt>) => {
      const refusal = await actual.checkIndexRollupsWritableAt(...args);
      if (race.afterCheck) await race.afterCheck();
      return refusal;
    }
  };
});

async function readLf(rootPath: string, rel: string): Promise<string> {
  return (await readFile(path.join(rootPath, rel), "utf8")).replace(/^﻿/, "").replace(/\r\n/g, "\n");
}

async function withIndexTail(tail: string): Promise<string> {
  const rootPath = await copyFixtureWorkspace("mutation-target");
  const index = (await readLf(rootPath, INDEX)).trimEnd();
  await writeFile(path.join(rootPath, INDEX), `${index}\n\n${tail}`, "utf8");
  return rootPath;
}

const PROBE = { type: "functional" as const, scope: "ARCH", target: "v1.0.0", title: "Probe", statement: "The system shall probe.", acceptanceCriteria: ["probe"] };

describe("the pre-write rollup check agrees with the sync it guards", () => {
  // @req FR-NODE-018 AC-1
  it("R1 add-requirement is not refused for a rollup row the sync never has to rewrite", async () => {
    // `verified | 0 | note` has one cell too many, but its count stays 0 after a planned requirement is added.
    const rootPath = await withIndexTail("## 6. Status Summary\n\n| Status | Count |\n|---|---:|\n| planned | 1 |\n| verified | 0 | note |\n");
    const root = await resolveProjectRoot(rootPath);
    const errors = validateWorkspace(await parseWorkspace(root)).diagnostics.filter((item) => item.severity === "error");
    const result = await addRequirement(root, PROBE);
    const afterSync = await syncIndexRollups(root, { dryRun: true });
    // The index is valid and sync-index itself accepts it, so the requirement creation must not be refused for it.
    expect({ errors: errors.length, add: result.ok, error: result.error?.message, syncAfter: afterSync.ok }).toEqual({ errors: 0, add: true, error: undefined, syncAfter: true });
  });

  // @req FR-NODE-018 AC-1
  it("R2 add-requirement does not report failure after writing when the index changes after the pre-write check", async () => {
    const rootPath = await withIndexTail("## 6. Status Summary\n\n| Status | Count |\n|---|---:|\n| planned | 1 |\n");
    const root = await resolveProjectRoot(rootPath);
    const before = await readLf(rootPath, SCOPE);
    race.afterCheck = async () => {
      const index = await readLf(rootPath, INDEX);
      await writeFile(path.join(rootPath, INDEX), index.replace("| Status | Count |", "| Status | count |"), "utf8");
    };
    try {
      const result = await addRequirement(root, PROBE);
      const after = await readLf(rootPath, SCOPE);
      expect({ ok: result.ok, scopeChanged: after !== before }).not.toEqual({ ok: false, scopeChanged: true });
    } finally {
      race.afterCheck = undefined;
    }
  });
});

describe("a rollup row that already holds the right values", () => {
  // @req FR-NODE-018 AC-3
  it("R3 sync-index writes nothing for a Type Summary row whose empty Prefix has no prefix to fill", async () => {
    const rootPath = await withIndexTail("## 6. Status Summary\n\n| Status | Count |\n|---|---:|\n| planned | 1 |\n\n## 7. Requirement Type Summary\n\n| Type | Prefix | Count |\n|---|---|---:|\n| functional | FR | 1 |\n|custom||0|\n");
    const root = await resolveProjectRoot(rootPath);
    const before = await readLf(rootPath, INDEX);
    const result = await syncIndexRollups(root, {});
    const after = await readLf(rootPath, INDEX);
    expect({ written: result.value?.written, typeSummaryChanged: result.value?.typeSummaryChanged, indexChanged: after !== before }).toEqual({ written: false, typeSummaryChanged: false, indexChanged: false });
  });
});

describe("a status change to the status the requirement already has", () => {
  // @req FR-NODE-017 AC-1
  it("R4 update-status reports written=false and leaves the document untouched", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const root = await resolveProjectRoot(rootPath);
    const scopePath = path.join(rootPath, SCOPE);
    const mtimeBefore = (await stat(scopePath)).mtimeMs;
    const textBefore = await readLf(rootPath, SCOPE);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const result = await updateStatus(root, { id: "FR-ARCH-001", status: "planned" });
    const textAfter = await readLf(rootPath, SCOPE);
    const mtimeAfter = (await stat(scopePath)).mtimeMs;
    expect({ ok: result.ok, textChanged: textAfter !== textBefore, written: (result.value as { written?: boolean }).written, rewritten: mtimeAfter !== mtimeBefore }).toEqual({
      ok: true,
      textChanged: false,
      written: false,
      rewritten: false
    });
  });
});

describe("supersede refused by the discard guard", () => {
  // @req FR-NODE-045 AC-3
  it("R5 supersede of a protected (stable) requirement does not leave a minted successor behind its refusal", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const root = await resolveProjectRoot(rootPath);
    const before = await readLf(rootPath, SCOPE);
    const input = { oldId: "FR-ARCH-001", scope: "ARCH", target: "v1.0.0", title: "Next", statement: "The system shall next.", acceptanceCriteria: ["next"] };
    const result = await supersedeRequirement(root, input);
    const after = await readLf(rootPath, SCOPE);
    // Either refused with the document untouched, or reported done.
    expect({ ok: result.ok, scopeChanged: after !== before }).not.toEqual({ ok: false, scopeChanged: true });
  });
});
