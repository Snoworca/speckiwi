import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { addRequirement, type AddRequirementInput } from "../../../src/core/mutation/add-requirement.js";
import { REQUIREMENT_STATUSES } from "../../../src/core/types.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

// FR-NODE-198 — the writing site enforces the status enum that the changing site already enforces.
//
// `status` is declared as `RequirementStatus` on the input interface, so no typed caller can reach
// this. The reachable caller is the MCP `add_requirement` tool, whose schema declares `status` as a
// bare optional string, and the CLI behind it. The casts below stand in for that untyped input;
// they are the shape the defect actually arrives in, not a contrivance.

const SPEC_FILE = path.join("docs", "spec", "10.product-architecture.srs.md");

/** Values outside REQUIREMENT_STATUSES that the skill layer has actually named in a status slot. */
const OUT_OF_ENUM_STATUSES = [
  // What kiwi-srs instructs for a new requirement, and the value the 2026-07-16 SRS-E005 repair
  // erased from eleven requirement blocks without touching the text that dictates it.
  "proposed",
  // A Stability value standing in a Status slot — the axis confusion the same audit found.
  "draft",
  // An arbitrary string: the guard is an enum membership test, not a denylist of known-bad tokens.
  "not-a-status"
];

function baseInput(title: string): AddRequirementInput {
  return {
    type: "functional",
    scope: "ARCH",
    target: "v1.0.0",
    title,
    statement: "The writing site must enforce the status enum.",
    acceptanceCriteria: ["the enum is enforced on creation"]
  };
}

describe("FR-NODE-198 AC-1 — an out-of-enum status is refused with USAGE and writes nothing", () => {
  for (const status of OUT_OF_ENUM_STATUSES) {
    it(`FR-NODE-198 AC-1: rejects status "${status}" and leaves the target document byte-identical`, async () => {
      const rootPath = await copyFixtureWorkspace("mutation-target");
      const root = await resolveProjectRoot(rootPath);
      const specPath = path.join(rootPath, SPEC_FILE);
      const before = await readFile(specPath, "utf8");

      const result = await addRequirement(root, {
        ...baseInput(`Out-of-enum ${status}`),
        status: status as AddRequirementInput["status"]
      });

      // Half one: the call fails, and it fails as caller error rather than as a denial or a crash.
      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe("USAGE");
      expect(result.error?.message).toContain(status);
      expect(result.value).toBeUndefined();

      // Half two: nothing landed. A rejection that still wrote a partial block would satisfy the
      // first half alone, which is why the AC asks for both.
      const after = await readFile(specPath, "utf8");
      expect(after).toBe(before);
    });
  }
});

describe("FR-NODE-198 AC-2 — omitting status is not a rejection case", () => {
  it("FR-NODE-198 AC-2: an absent status resolves to planned in the record and in the metadata Status row", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const root = await resolveProjectRoot(rootPath);
    const specPath = path.join(rootPath, SPEC_FILE);

    const result = await addRequirement(root, baseInput("Absent status defaults to planned"));

    expect(result.ok).toBe(true);
    if (!result.ok || !result.value) return;
    expect(result.value.record.status).toBe("planned");
    expect(result.value.record.metadata.Status).toBe("planned");

    const after = await readFile(specPath, "utf8");
    const heading = `### ${result.value.requirementId} — Absent status defaults to planned`;
    expect(after).toContain(heading);

    // Scoped to the block that was just appended. The fixture requirement carries a
    // `| Status | planned |` row of its own, so the same check run over the whole document
    // passes whatever value the new block wrote — and passes when no block was written at all.
    const appended = after.slice(after.indexOf(heading) + heading.length);
    const block = appended.split(/^### /m)[0] as string;
    expect(block).toContain("| Status | planned |");
  });

  it("FR-NODE-198 AC-2: every member of REQUIREMENT_STATUSES that creation can carry is still accepted", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const root = await resolveProjectRoot(rootPath);

    // `verified` is excluded here, and only here: creation refuses it through a separate,
    // pre-existing gate (unchecked AC and no evidence), so it would fail for a reason this
    // requirement does not own. Its membership in the enum is covered by AC-3 below.
    for (const status of REQUIREMENT_STATUSES.filter((value) => value !== "verified")) {
      const result = await addRequirement(root, {
        ...baseInput(`In-enum ${status}`),
        status,
        dryRun: true
      });
      expect(result.ok, `status "${status}" must be accepted`).toBe(true);
    }
  });
});

describe("FR-NODE-198 AC-3 — one entry-point check closes both spend sites", () => {
  it("FR-NODE-198 AC-3: the refused value reaches neither the metadata Status row nor a rendered block", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const root = await resolveProjectRoot(rootPath);
    const specPath = path.join(rootPath, SPEC_FILE);
    const headingsBefore = (await readFile(specPath, "utf8")).split("\n").filter((line) => line.startsWith("### ")).length;

    const result = await addRequirement(root, {
      ...baseInput("Neither spend site admits it"),
      status: "proposed" as AddRequirementInput["status"]
    });
    expect(result.ok).toBe(false);

    const after = await readFile(specPath, "utf8");
    // Spend site one — the metadata `Status` row that `buildOutputRecord` resolves. A guard
    // re-added at the record site alone leaves this row admitting the value.
    expect(after).not.toContain("| Status | proposed |");
    // Spend site two — the record, whose rendered form is the appended block. A guard re-added at
    // the metadata site alone leaves a block appended with the metadata silently defaulted.
    expect(after).not.toContain("Neither spend site admits it");
    expect(after.split("\n").filter((line) => line.startsWith("### ")).length).toBe(headingsBefore);
  });

  it("FR-NODE-198 AC-3: an accepted status is spent identically at both sites", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const root = await resolveProjectRoot(rootPath);
    const specPath = path.join(rootPath, SPEC_FILE);

    const result = await addRequirement(root, { ...baseInput("Both sites agree"), status: "in_progress" });
    expect(result.ok).toBe(true);
    if (!result.ok || !result.value) return;

    expect(result.value.record.status).toBe("in_progress");
    expect(result.value.record.metadata.Status).toBe("in_progress");
    expect(await readFile(specPath, "utf8")).toContain("| Status | in_progress |");
  });
});
