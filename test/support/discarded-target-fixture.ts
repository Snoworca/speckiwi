import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { expect } from "vitest";
import { addRequirement } from "../../src/core/mutation/add-requirement.js";
import { supersedeRequirement } from "../../src/core/mutation/supersede-requirement.js";
import { updateStability } from "../../src/core/mutation/update-stability.js";
import { resolveProjectRoot } from "../../src/core/project-root.js";
import type { ProjectRoot } from "../../src/core/types.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

// FR-PARSE-049 / FR-NODE-272 — a workspace where requirement A was discarded by `supersede` with
// successor S, and B and C point at A through rows written while A was still live. Built from the
// `mutation-target` fixture with the tools themselves, so it validates clean apart from what the
// discarded target causes.

export const SPEC_FILE = "docs/spec/10.product-architecture.srs.md";
/** The live fixture requirement that the scenario leaves untouched. */
export const LIVE = "FR-ARCH-001";
/** The discarded requirement. */
export const A = "FR-ARCH-002";
/** Holds `Requirement | A | extends`. */
export const B = "FR-ARCH-003";
/** Holds `Requirement | A | depends_on`. */
export const C = "FR-ARCH-004";
/** The successor `supersede` minted, holding `Requirement | A | supersedes`. */
export const S = "FR-ARCH-005";

async function add(root: ProjectRoot, title: string, trace: Array<{ type: string; reference: string; relation: string }> = []): Promise<string> {
  const added = await addRequirement(root, {
    type: "functional",
    scope: "ARCH",
    target: "v1.0.0",
    title,
    statement: `SpecKiwi SHALL keep the ${title.toLowerCase()}.`,
    rationale: "Fixture.",
    acceptanceCriteria: ["The requirement can be listed."],
    stability: "evolving",
    trace
  });
  expect(added.ok, JSON.stringify(added.error)).toBe(true);
  return added.value!.requirementId;
}

/** A discarded by supersede into S, with B (`extends`) and C (`depends_on`) still pointing at A. */
export async function discardedTargetWorkspace(): Promise<{ rootPath: string; root: ProjectRoot }> {
  const rootPath = await copyFixtureWorkspace("mutation-target");
  const root = await resolveProjectRoot(rootPath, rootPath);
  expect(await add(root, "Withdrawn requirement")).toBe(A);
  expect(await add(root, "Extending requirement", [{ type: "Requirement", reference: A, relation: "extends" }])).toBe(B);
  expect(await add(root, "Dependent requirement", [{ type: "Requirement", reference: A, relation: "depends_on" }])).toBe(C);
  const superseded = await supersedeRequirement(root, {
    oldId: A,
    scope: "ARCH",
    target: "v1.0.0",
    title: "Successor requirement",
    statement: "SpecKiwi SHALL keep the successor requirement.",
    acceptanceCriteria: ["The successor can be listed."]
  });
  expect(superseded.ok, JSON.stringify(superseded.error)).toBe(true);
  // supersede mints the successor at draft; evolving keeps SRS-W023 out of the workspace's findings.
  const stable = await updateStability(root, { id: S, stability: "evolving" });
  expect(stable.ok, JSON.stringify(stable.error)).toBe(true);
  return { rootPath, root };
}

/** The 1-based line of the first line of `file` that contains `text`. */
export async function lineOf(rootPath: string, text: string, file = SPEC_FILE): Promise<number> {
  const lines = (await readFile(path.join(rootPath, file), "utf8")).split(/\r?\n/);
  const index = lines.findIndex((line) => line.includes(text));
  if (index < 0) throw new Error(`fixture changed: no line containing ${text}`);
  return index + 1;
}

/** Every file under `rootPath`, relative path to bytes, so a refusal can be shown to write nothing. */
export async function snapshotTree(rootPath: string): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  async function walk(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else files.set(path.relative(rootPath, full).replace(/\\/g, "/"), (await readFile(full)).toString("base64"));
    }
  }
  await walk(rootPath);
  return files;
}
