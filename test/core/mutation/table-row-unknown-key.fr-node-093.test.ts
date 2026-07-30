import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { addVerificationEvidence } from "../../../src/core/mutation/add-evidence.js";
import { addTraceLink } from "../../../src/core/mutation/add-trace.js";
import { editRequirementTableRows } from "../../../src/core/mutation/edit-requirement.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

// FR-NODE-093 — an unrecognised `values` key must fail, not be ignored.
//
// The row is rebuilt from its existing cells with `values.covers ?? fallback.covers`, so a key the
// builder never reads produces a replacement identical to the original — reported as ok/written. The
// column names in the rendered header are capitalised (`| Covers |`), which is exactly the spelling a
// caller reaches for, so the silent path is the likely one rather than an exotic one.

const SPEC_FILE = path.join("docs", "spec", "10.product-architecture.srs.md");
const ID = "FR-ARCH-001";

async function workspace(): Promise<string> {
  return copyFixtureWorkspace("valid-basic");
}

/** A workspace whose requirement already carries one evidence row and one trace link. */
async function seeded(): Promise<string> {
  const rootPath = await workspace();
  const root = await resolveProjectRoot(rootPath);
  const evidence = await addVerificationEvidence(root, {
    id: ID,
    type: "test",
    reference: "test/example.test.ts",
    covers: "AC-1",
    notes: "seeded"
  });
  if (!evidence.ok) throw new Error(evidence.error?.message ?? "evidence seed failed");
  const trace = await addTraceLink(root, {
    id: ID,
    type: "Code",
    reference: "src/example.ts",
    relation: "implements",
    notes: "seeded"
  });
  if (!trace.ok) throw new Error(trace.error?.message ?? "trace seed failed");
  return rootPath;
}

async function specText(rootPath: string): Promise<string> {
  return readFile(path.join(rootPath, SPEC_FILE), "utf8");
}

describe("FR-NODE-093 AC-1 / AC-3 — an unknown key fails and writes nothing", () => {
  it("rejects the capitalised column spelling instead of silently ignoring it", async () => {
    const rootPath = await seeded();
    const before = await specText(rootPath);

    const result = await editRequirementTableRows(await resolveProjectRoot(rootPath), {
      id: ID,
      section: "verification_evidence",
      operations: [{ kind: "update", rowId: "VE-1", values: { Covers: "AC-2", Notes: "corrected" } }]
    });

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("USAGE");
    expect(result.error?.message).toContain("Covers");
    expect(await specText(rootPath), "a rejected edit must not write").toBe(before);
  });
});

describe("FR-NODE-093 AC-2 — the failure names the accepted keys", () => {
  it("lists the settable columns of the target section", async () => {
    const rootPath = await seeded();

    const evidence = await editRequirementTableRows(await resolveProjectRoot(rootPath), {
      id: ID,
      section: "verification_evidence",
      operations: [{ kind: "update", rowId: "VE-1", values: { nonsense: "x" } }]
    });
    for (const key of ["type", "reference", "covers", "notes"]) {
      expect(evidence.error?.message, `evidence keys must be listed: ${key}`).toContain(key);
    }

    const trace = await editRequirementTableRows(await resolveProjectRoot(rootPath), {
      id: ID,
      section: "trace_links",
      operations: [{ kind: "update", rowIndex: 0, values: { nonsense: "x" } }]
    });
    for (const key of ["type", "reference", "relation", "notes"]) {
      expect(trace.error?.message, `trace keys must be listed: ${key}`).toContain(key);
    }
    // `covers` is not a trace-link column, so it must not be advertised for that section.
    expect(trace.error?.message).not.toContain("covers");
  });
});

describe("FR-NODE-093 AC-4 — every settable column still works", () => {
  it("updates each evidence cell", async () => {
    const rootPath = await seeded();

    const result = await editRequirementTableRows(await resolveProjectRoot(rootPath), {
      id: ID,
      section: "verification_evidence",
      operations: [
        { kind: "update", rowId: "VE-1", values: { type: "review", reference: "docs/review.md", covers: "AC-2", notes: "updated" } }
      ]
    });

    expect(result.ok, result.error?.message).toBe(true);
    const row = (await specText(rootPath)).split(/\r?\n/).find((line) => line.startsWith("| VE-1 |"));
    expect(row).toBe("| VE-1 | review | docs/review.md | AC-2 | updated |");
  });

  it("updates each trace link cell", async () => {
    const rootPath = await seeded();

    const result = await editRequirementTableRows(await resolveProjectRoot(rootPath), {
      id: ID,
      section: "trace_links",
      operations: [
        { kind: "update", rowIndex: 0, values: { type: "Test", reference: "test/other.test.ts", relation: "verifies", notes: "updated" } }
      ]
    });

    expect(result.ok, result.error?.message).toBe(true);
    const row = (await specText(rootPath)).split(/\r?\n/).find((line) => line.startsWith("| Test |"));
    expect(row).toBe("| Test | test/other.test.ts | verifies | updated |");
  });
});

describe("FR-NODE-093 AC-5 — the derived evidence row id is not settable", () => {
  it("rejects `id` rather than dropping it", async () => {
    const rootPath = await seeded();
    const before = await specText(rootPath);

    const result = await editRequirementTableRows(await resolveProjectRoot(rootPath), {
      id: ID,
      section: "verification_evidence",
      operations: [{ kind: "update", rowId: "VE-1", values: { id: "VE-9" } }]
    });

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("USAGE");
    expect(await specText(rootPath)).toBe(before);
  });
});
