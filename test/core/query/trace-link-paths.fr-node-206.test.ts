import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DIAGNOSTIC_DEFINITIONS } from "../../../src/core/diagnostic-registry.js";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { checkLinks } from "../../../src/core/query/links.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

// @req FR-NODE-206 AC-1 — the link checker resolves a Trace Link of a type other than Requirement.
//
// Before this it read Requirement rows alone, so the Code, Test and Document rows went unchecked
// whatever they said. Measured on this repository that left 210 references unread, which is how a
// designation could go stale under a source edit with nothing reddening.

const ARCH_DOC = path.join("docs", "spec", "10.product-architecture.srs.md");
const SELF_ROW = "| Requirement | FR-ARCH-001 | self | Fixture self link |";

async function linksFor(rootPath: string) {
  return checkLinks(await parseWorkspace(await resolveProjectRoot(rootPath)));
}

/** Appends trace rows below the fixture's single Requirement row, leaving that row intact. */
async function addTraceRows(rootPath: string, rows: readonly string[]): Promise<void> {
  const file = path.join(rootPath, ARCH_DOC);
  const text = await readFile(file, "utf8");
  if (!text.includes(SELF_ROW)) throw new Error("fixture changed: no Requirement trace row to append below");
  await writeFile(file, text.replace(SELF_ROW, [SELF_ROW, ...rows].join("\n")), "utf8");
}

/** Writes a file inside the copied fixture so a trace reference has something to resolve to. */
async function addFile(rootPath: string, relative: string): Promise<void> {
  const target = path.join(rootPath, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, "export const present = true;\n", "utf8");
}

describe("FR-NODE-206 AC-1 — a Code row naming a file the repository does not hold is reported", () => {
  it("names the requirement, the row as written and the path it resolved", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");
    await addTraceRows(rootPath, ["| Code | src/core/gone.ts | implements | - |"]);

    const broken = (await linksFor(rootPath)).broken;

    expect(broken).toHaveLength(1);
    expect(broken[0]).toMatchObject({ requirementId: "FR-ARCH-001", reference: "src/core/gone.ts" });
    expect(broken[0]?.reason, "the reason names the row type and the resolved path").toContain("Code");
    expect(broken[0]?.reason).toContain("src/core/gone.ts");
  });

  it("carries a code the diagnostic registry defines", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");
    await addTraceRows(rootPath, ["| Code | src/core/gone.ts | implements | - |"]);

    const broken = (await linksFor(rootPath)).broken;
    const registered = new Set(DIAGNOSTIC_DEFINITIONS.map((definition) => definition.code));

    expect(registered.has(broken[0]?.code ?? "")).toBe(true);
  });

  it("reports nothing for a Code row whose file exists", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");
    await addFile(rootPath, "src/core/present.ts");
    await addTraceRows(rootPath, ["| Code | src/core/present.ts | implements | - |"]);

    expect((await linksFor(rootPath)).broken).toHaveLength(0);
  });

  it("reaches a Test row and a Document row, not only a Code row", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");
    await addTraceRows(rootPath, [
      "| Test | test/core/gone.test.ts | verifies | - |",
      "| Document | docs/research/gone.md | documents | - |"
    ]);

    const broken = (await linksFor(rootPath)).broken;

    expect(broken.map((entry) => entry.reference).sort()).toEqual([
      "docs/research/gone.md",
      "test/core/gone.test.ts"
    ]);
  });
});

describe("FR-NODE-206 AC-1 — the count of resolved references rises", () => {
  it("counts each resolved path, so a branch that is never entered cannot pass", async () => {
    const baseline = (await linksFor(await copyFixtureWorkspace("valid-basic"))).checked;

    const rootPath = await copyFixtureWorkspace("valid-basic");
    await addFile(rootPath, "src/core/present.ts");
    await addTraceRows(rootPath, [
      "| Code | src/core/present.ts | implements | - |",
      "| Code | src/core/gone.ts | implements | - |"
    ]);

    expect((await linksFor(rootPath)).checked).toBe(baseline + 2);
  });

  it("does not count a row whose reference names no file", async () => {
    const baseline = (await linksFor(await copyFixtureWorkspace("valid-basic"))).checked;

    const rootPath = await copyFixtureWorkspace("valid-basic");
    await addTraceRows(rootPath, ["| Task | T-PH001-02 | implements | - |"]);

    expect((await linksFor(rootPath)).checked).toBe(baseline);
  });
});

describe("FR-NODE-206 AC-1 — a reference that does not name a file is not resolved as one", () => {
  it("passes a task id, a requirement id and a sentence without reporting them", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");
    await addTraceRows(rootPath, [
      "| Task | T-PH001-02 | implements | - |",
      "| requirement | FR-ARCH-001 | refines | - |",
      "| Reference | the SRS-MD rules document BUNDLED_SRS_RULES_FILENAME names, section 30.2 | informs | - |"
    ]);

    expect((await linksFor(rootPath)).broken).toHaveLength(0);
  });

  it("resolves each file of a semicolon-separated row", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");
    await addFile(rootPath, "src/core/present.ts");
    await addTraceRows(rootPath, ["| Code | src/core/present.ts; src/core/gone.ts | implements | - |"]);

    const broken = (await linksFor(rootPath)).broken;

    expect(broken).toHaveLength(1);
    expect(broken[0]?.reason).toContain("src/core/gone.ts");
    // The row as written, so a reader finds the cell to edit rather than only the file that is gone.
    expect(broken[0]?.reference).toBe("src/core/present.ts; src/core/gone.ts");
  });
});

describe("FR-NODE-206 AC-1 — the resolution matches the two readers that already strip", () => {
  it("drops a trailing line suffix before resolving, as releaseReadiness does", async () => {
    const baseline = (await linksFor(await copyFixtureWorkspace("valid-basic"))).checked;

    const rootPath = await copyFixtureWorkspace("valid-basic");
    await addFile(rootPath, "src/core/present.ts");
    await addTraceRows(rootPath, [
      "| Code | src/core/present.ts:9999 | implements | - |",
      "| Code | src/core/present.ts:12-40 | implements | - |"
    ]);

    const result = await linksFor(rootPath);

    // Both rows are resolved rather than skipped for carrying a suffix; and the suffix itself is not
    // judged, so a line past the end of the file is silent here rather than a second kind of finding.
    expect(result.checked).toBe(baseline + 2);
    expect(result.broken).toHaveLength(0);
  });

  it("drops a heading fragment before resolving", async () => {
    const baseline = (await linksFor(await copyFixtureWorkspace("valid-basic"))).checked;

    const rootPath = await copyFixtureWorkspace("valid-basic");
    await addFile(rootPath, "docs/guide/present.md");
    await addTraceRows(rootPath, ["| Document | docs/guide/present.md#5.5 | documents | - |"]);

    const result = await linksFor(rootPath);

    expect(result.checked).toBe(baseline + 1);
    expect(result.broken).toHaveLength(0);
  });
});

describe("FR-NODE-206 AC-5 — a designation is never resolved by basename", () => {
  it("reports a bare filename that the workspace root does not hold, rather than finding it elsewhere", async () => {
    // The fixture holds `10.product-architecture.srs.md` under docs/spec. Resolving by basename would
    // find it there and score the row fresh; the rule is exact-path resolution from the root, so this
    // row is reported. Enabling the fallback silently resolved 20 pointers at a path no branch has
    // ever held onto a different file.
    const rootPath = await copyFixtureWorkspace("valid-basic");
    await addTraceRows(rootPath, ["| Document | 10.product-architecture.srs.md | documents | - |"]);

    const broken = (await linksFor(rootPath)).broken;

    expect(broken).toHaveLength(1);
    expect(broken[0]?.reference).toBe("10.product-architecture.srs.md");
  });

  it("resolves a bare filename the workspace root does hold", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");
    await addFile(rootPath, "package.json");
    await addTraceRows(rootPath, ["| Code | package.json | implements | - |"]);

    expect((await linksFor(rootPath)).broken).toHaveLength(0);
  });
});

describe("FR-NODE-206 AC-1 — the Requirement row keeps the behaviour it had", () => {
  it("still reports a Requirement reference naming no requirement, and does not resolve it as a path", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");
    const file = path.join(rootPath, ARCH_DOC);
    const text = await readFile(file, "utf8");
    await writeFile(file, text.replace("| Requirement | FR-ARCH-001 | self |", "| Requirement | FR-ARCH-404 | self |"), "utf8");

    const broken = (await linksFor(rootPath)).broken;

    expect(broken).toHaveLength(1);
    expect(broken[0]).toMatchObject({ reference: "FR-ARCH-404", reason: "requirement missing", code: "SRS-E012" });
  });
});
