import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { expireAcceptanceCriterion } from "../../../src/core/mutation/expire-ac.js";
import { supersedeRequirement } from "../../../src/core/mutation/supersede-requirement.js";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { validateWorkspace } from "../../../src/core/validator/validate-workspace.js";
import { acFixture } from "../ac-expiry-fixture.js";

// @req FR-NODE-243 AC-7 — supersede moves markers that live in OTHER scope documents too, and a write
// that fails part-way leaves every document as it was: no discarded successor with half its markers moved.

/** Fails the n-th rename onto a `.srs.md` file while armed; every other call goes through. */
const fault = vi.hoisted(() => ({ failOnSrsRename: 0, srsRenames: 0 }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    rename: async (from: Parameters<typeof actual.rename>[0], to: Parameters<typeof actual.rename>[1]) => {
      if (fault.failOnSrsRename > 0 && String(to).endsWith(".srs.md")) {
        fault.srsRenames += 1;
        if (fault.srsRenames === fault.failOnSrsRename) throw Object.assign(new Error("injected write failure"), { code: "EIO" });
      }
      return actual.rename(from, to);
    }
  };
});

afterEach(() => {
  fault.failOnSrsRename = 0;
  fault.srsRenames = 0;
});

const NODE_FILE = path.join("docs", "spec", "20.node.srs.md");

const NODE_DOCUMENT = `# Node

| Field | Value |
|---|---|
| Document Type | scope_srs |
| Scope | NODE |
| Scope Name | Node |

## 4. Requirements

### FR-NODE-001 — Holder in another document

| Field | Value |
| --- | --- |
| Type | functional |
| Target | v1.0.0 |
| Status | planned |
| Priority | high |
| Tags | fixture |
| Risk | low |
| Stability | stable |
| Verification Method | test |
| GitHub Issue | - |
| Related Docs | - |

#### Requirement

It holds a marker.

#### Rationale

Cross-document fixture.

#### Acceptance Criteria

- [ ] AC-1: live
- [ ] AC-2: ~~moved~~ [EXPIRED 2026-11-03 → FR-ARCH-002]

#### Verification Evidence

| Evidence ID | Type | Reference | Covers | Notes |
| --- | --- | --- | --- | --- |

#### Trace Links

| Type | Reference | Relation | Notes |
| --- | --- | --- | --- |

#### Change Notes

| Date | Change | Reason |
| --- | --- | --- |
| 2026-05-08 | Created | Fixture |
`;

/** FR-ARCH-002 is cited by a marker in its own document and by one in 20.node.srs.md. */
async function twoDocumentFixture(): Promise<string> {
  const rootPath = await acFixture({ acLines: ["- [x] AC-1: first", "- [ ] AC-2: second", "- [x] AC-3: third"] });
  await writeFile(path.join(rootPath, NODE_FILE), NODE_DOCUMENT, "utf8");
  const indexPath = path.join(rootPath, "docs", "spec", "00.index.md");
  const index = await readFile(indexPath, "utf8");
  const row = "| Product Architecture | [10.product-architecture.srs.md](./10.product-architecture.srs.md) | ARCH | Architecture |";
  await writeFile(indexPath, index.replaceAll(row, `${row}\n| Node | [20.node.srs.md](./20.node.srs.md) | NODE | Node |`), "utf8");
  const expired = await expireAcceptanceCriterion(await resolveProjectRoot(rootPath), { id: "FR-ARCH-001", acId: "AC-2", reason: "moved", successor: "FR-ARCH-002" });
  expect(expired.ok).toBe(true);
  return rootPath;
}

const SUPERSEDE = {
  oldId: "FR-ARCH-002",
  scope: "ARCH",
  target: "v1.0.0",
  title: "New successor",
  statement: "SpecKiwi must carry this.",
  acceptanceCriteria: ["The new successor exists."],
  reason: "replaced",
  confirmDiscardVerified: true
};

async function successorsOf(rootPath: string): Promise<Record<string, string[]>> {
  const workspace = await parseWorkspace(await resolveProjectRoot(rootPath));
  return Object.fromEntries(
    ["FR-ARCH-001", "FR-NODE-001"].map((id) => [id, (workspace.records.find((record) => record.id === id)?.expiredAcceptanceCriteria ?? []).map((criterion) => criterion.successor ?? "")])
  );
}

describe("FR-NODE-243 AC-7 — supersede across scope documents", () => {
  // @req FR-NODE-243 AC-7
  it("moves the markers in every scope document and leaves no SRS-E012", async () => {
    const rootPath = await twoDocumentFixture();
    const result = await supersedeRequirement(await resolveProjectRoot(rootPath), SUPERSEDE);
    expect(result.ok, JSON.stringify(result.error)).toBe(true);
    const newId = result.value!.newId!;
    expect(await successorsOf(rootPath)).toEqual({ "FR-ARCH-001": [newId], "FR-NODE-001": [newId] });
    const workspace = await parseWorkspace(await resolveProjectRoot(rootPath));
    expect(validateWorkspace(workspace).errors.filter((item) => item.code === "SRS-E012")).toEqual([]);
  });

  // @req FR-NODE-243 AC-7
  it("a write that fails part-way restores every document of the discard step", async () => {
    const rootPath = await twoDocumentFixture();
    const root = await resolveProjectRoot(rootPath);
    // T1 (the new requirement) is one .srs.md write; the discard step writes two documents after it.
    // Failing the third .srs.md rename fails the second document of the discard step.
    fault.failOnSrsRename = 3;
    const nodeBefore = await readFile(path.join(rootPath, NODE_FILE), "utf8");
    const result = await supersedeRequirement(root, SUPERSEDE).catch((error: unknown) => ({ ok: false as const, thrown: error }));
    expect(result.ok).toBe(false);
    expect(fault.srsRenames).toBe(3);
    fault.failOnSrsRename = 0;
    const workspace = await parseWorkspace(root);
    // The discard step left nothing behind: FR-ARCH-002 is not discarded and no marker moved.
    expect(workspace.records.find((record) => record.id === "FR-ARCH-002")!.status).toBe("planned");
    expect(await successorsOf(rootPath)).toEqual({ "FR-ARCH-001": ["FR-ARCH-002"], "FR-NODE-001": ["FR-ARCH-002"] });
    expect(await readFile(path.join(rootPath, NODE_FILE), "utf8")).toBe(nodeBefore);
    expect(validateWorkspace(workspace).errors.filter((item) => item.code === "SRS-E012")).toEqual([]);
  });
});
