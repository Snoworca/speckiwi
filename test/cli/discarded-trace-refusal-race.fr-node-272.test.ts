import { beforeEach, describe, expect, it, vi } from "vitest";
import { addRequirement } from "../../src/core/mutation/add-requirement.js";
import { addTraceLink } from "../../src/core/mutation/add-trace.js";
import type * as SrsLock from "../../src/core/mutation/srs-lock.js";
import { supersedeRequirement } from "../../src/core/mutation/supersede-requirement.js";
import { parseWorkspace } from "../../src/core/parser/workspace-parser.js";
import { checkLinks } from "../../src/core/query/links.js";
import type { MutationResult, ProjectRoot } from "../../src/core/types.js";
import { B, LIVE, discardedTargetWorkspace, snapshotTree } from "../support/discarded-target-fixture.js";

// @req FR-NODE-272 AC-1, AC-4, AC-5 — a writer decides on what the workspace holds when it writes. Another
// writer can take the SRS lock first and supersede the target, after this writer looked at the workspace
// and before it got the lock; the row must still be refused, or links check reports what it accepted.

const race = vi.hoisted(() => ({ otherWriter: undefined as (() => Promise<void>) | undefined }));

vi.mock("../../src/core/mutation/srs-lock.js", async (importOriginal) => {
  const actual = await importOriginal<typeof SrsLock>();
  const withSrsMutationLock = async (...args: Parameters<typeof actual.withSrsMutationLock>) => {
    const otherWriter = race.otherWriter;
    race.otherWriter = undefined;
    await otherWriter?.();
    return actual.withSrsMutationLock(...args);
  };
  return { ...actual, withSrsMutationLock };
});

/** Only `docs/`: a refusal inside the lock leaves kiwi/.status.json saying the lock is held (FR-NODE-273). */
async function documents(rootPath: string): Promise<Array<[string, string]>> {
  return [...(await snapshotTree(rootPath))].filter(([file]) => file.startsWith("docs/"));
}

/** Runs `write` with another writer superseding B just before it reaches the lock, and checks the refusal. */
async function expectRefusedWhenBIsSupersededFirst(rootPath: string, root: ProjectRoot, write: () => Promise<MutationResult<unknown>>): Promise<void> {
  let successor = "";
  let documentsAfterOtherWriter: Array<[string, string]> = [];
  race.otherWriter = async () => {
    const superseded = await supersedeRequirement(root, {
      oldId: B,
      scope: "ARCH",
      target: "v1.0.0",
      title: "Successor of the extending requirement",
      statement: "SpecKiwi SHALL keep the successor of the extending requirement.",
      acceptanceCriteria: ["The successor can be listed."]
    });
    expect(superseded.ok, JSON.stringify(superseded.error)).toBe(true);
    successor = superseded.value!.newId!;
    documentsAfterOtherWriter = await documents(rootPath);
  };

  const result = await write();

  expect(race.otherWriter, "the other writer did not run").toBeUndefined();
  expect(result.ok, "the row was accepted").toBe(false);
  expect(result.error?.code).toBe("USAGE");
  expect(result.error?.message).toContain(B);
  expect(result.error?.message).toContain(successor);
  expect(await documents(rootPath)).toEqual(documentsAfterOtherWriter);
  const reported = (await checkLinks(await parseWorkspace(root))).broken.filter((entry) => entry.code === "SRS-W081" && entry.reference === B);
  expect(reported).toEqual([]);
}

describe("FR-NODE-272 — the target is superseded by another writer that reaches the lock first", () => {
  beforeEach(() => {
    race.otherWriter = undefined;
  });

  // @req FR-NODE-272 AC-1, AC-5
  it("add-trace refuses the row", async () => {
    const { rootPath, root } = await discardedTargetWorkspace();
    await expectRefusedWhenBIsSupersededFirst(rootPath, root, () => addTraceLink(root, { id: LIVE, type: "Requirement", reference: B, relation: "extends" }));
  });

  // @req FR-NODE-272 AC-4, AC-5
  it.each([
    { label: "with every cell given", row: { type: "Requirement", reference: B, relation: "extends" } },
    { label: "with its type and relation left out", row: { reference: B } }
  ])("add-requirement refuses a row $label and creates no requirement", async ({ row }) => {
    const { rootPath, root } = await discardedTargetWorkspace();
    await expectRefusedWhenBIsSupersededFirst(rootPath, root, () =>
      addRequirement(root, {
        type: "functional",
        scope: "ARCH",
        target: "v1.0.0",
        title: "Late requirement",
        statement: "SpecKiwi SHALL keep the late requirement.",
        acceptanceCriteria: ["The requirement can be listed."],
        trace: [row]
      })
    );
  });
});
