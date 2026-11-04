import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { expireAcceptanceCriterion } from "../../src/core/mutation/expire-ac.js";
import { updateField } from "../../src/core/mutation/update-field.js";
import { parseWorkspace } from "../../src/core/parser/workspace-parser.js";
import { resolveProjectRoot } from "../../src/core/project-root.js";
import { validateWorkspace } from "../../src/core/validator/validate-workspace.js";
import { acFixture, SCOPE_FILE } from "./ac-expiry-fixture.js";

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

function block(id: string, acLines: readonly string[]): string {
  return `
### ${id} — Extra ${id}

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

SpecKiwi must hold ${id}.

#### Rationale

Probe.

#### Acceptance Criteria

${acLines.join("\n")}

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
}

const NODE_FILE = path.join("docs", "spec", "20.node.srs.md");
async function addNodeDocument(rootPath: string, body: string): Promise<void> {
  const header = "# Node\n\n| Field | Value |\n|---|---|\n| Document Type | scope_srs |\n| Scope | NODE |\n| Scope Name | Node |\n\n## 4. Requirements\n";
  await writeFile(path.join(rootPath, NODE_FILE), `${header}${body}`, "utf8");
  const indexPath = path.join(rootPath, "docs", "spec", "00.index.md");
  const index = await readFile(indexPath, "utf8");
  const row = "| Product Architecture | [10.product-architecture.srs.md](./10.product-architecture.srs.md) | ARCH | Architecture |";
  await writeFile(indexPath, index.replaceAll(row, `${row}\n| Node | [20.node.srs.md](./20.node.srs.md) | NODE | Node |`), "utf8");
}

async function expire(rootPath: string, id: string, acId: string, successor: string): Promise<void> {
  const result = await expireAcceptanceCriterion(await resolveProjectRoot(rootPath), { id, acId, reason: "moved", successor });
  expect(result.ok, JSON.stringify(result.error)).toBe(true);
}

async function errors(rootPath: string): Promise<string[]> {
  return validateWorkspace(await parseWorkspace(await resolveProjectRoot(rootPath))).errors
    .filter((item) => item.code === "SRS-E012" || item.code === "SRS-E078")
    .map((item) => `${item.code} ${item.message}`);
}

describe("verify r5 — AC expiry successor paths", () => {
  // @req FR-PARSE-044 AC-4
  it("a type migration whose second document write fails leaves no dangling successor", async () => {
    const rootPath = await acFixture({ acLines: ["- [x] AC-1: first", "- [ ] AC-2: second"] });
    await addNodeDocument(rootPath, block("FR-NODE-001", ["- [ ] AC-1: live", "- [ ] AC-2: old"]));
    await expire(rootPath, "FR-NODE-001", "AC-2", "FR-ARCH-002");
    const archBefore = await readFile(path.join(rootPath, SCOPE_FILE), "utf8");
    fault.failOnSrsRename = 2;
    await updateField(await resolveProjectRoot(rootPath), { id: "FR-ARCH-002", field: "type", value: "non_functional", signOff: true, dryRun: false }).catch(() => undefined);
    expect(fault.srsRenames).toBe(2);
    fault.failOnSrsRename = 0;
    expect(await errors(rootPath)).toEqual([]);
    expect(await readFile(path.join(rootPath, SCOPE_FILE), "utf8")).toBe(archBefore);
  });
});
