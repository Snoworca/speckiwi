import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

// FR-NODE-210 AC-2..AC-5 — `speckiwi coverage --tests` reports, per acceptance criterion of the scope's
// requirements, the test lines that cite the requirement id and `AC-<n>` together, and per SDS-AC
// whether the Test Plan's test file exists and cites it.
//
// The workspace: valid-basic's FR-ARCH-001 (AC-1, AC-2) plus FR-ARCH-002 (AC-1, AC-2), both in target
// v1.0.0. Every test file below is written by the case that reads it.

interface Citation {
  file: string;
  line: number;
}

interface Report {
  scope: { target: string | null; ids: string[] | null; sds: string | null };
  requirements: Array<{ requirementId: string; acs: Array<{ acId: string; cited: boolean; citations: Citation[] }> }>;
  sdsContracts: Array<{ sdsAcId: string; cited: boolean; testFiles: Array<{ path: string; exists: boolean; citations: Citation[] }> }>;
  gaps: { requirements: Array<{ requirementId: string; acIds: string[] }>; sdsContracts: Array<{ sdsAcId: string; reason: string }> };
  passed: boolean;
}

function io() {
  return { stdout: new PassThrough(), stderr: new PassThrough() };
}

function drain(stream: PassThrough): string {
  return stream.read()?.toString() ?? "";
}

async function put(root: string, relative: string, text: string): Promise<void> {
  await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
  await writeFile(path.join(root, relative), text, "utf8");
}

async function workspace(): Promise<string> {
  const root = await copyFixtureWorkspace("valid-basic");
  const scope = path.join(root, "docs", "spec", "10.product-architecture.srs.md");
  const text = await readFile(scope, "utf8");
  const block = text.slice(text.indexOf("### FR-ARCH-001"));
  await writeFile(
    scope,
    `${text}\n${block.replace("FR-ARCH-001 — Fixture requirement", "FR-ARCH-002 — Second fixture requirement").replace("| Requirement | FR-ARCH-001 | self |", "| Requirement | FR-ARCH-002 | self |")}`,
    "utf8"
  );
  await put(
    root,
    "test/arch.test.ts",
    [
      "describe('FR-ARCH-001 AC-1 — lists', () => {});",
      "describe('FR-ARCH-001 AC-2 — shows', () => {});",
      "it('FR-ARCH-002 AC-1: second', () => {}); // SDS-AC-2 cited here, which is not its planned file",
      ""
    ].join("\n")
  );
  // Neither of these is a test file, so the FR-ARCH-002 AC-2 they carry is not a citation.
  await put(root, "src/notes.ts", "// FR-ARCH-002 AC-2\n");
  await put(root, "node_modules/pkg/x.test.js", "// FR-ARCH-002 AC-2\n");
  return root;
}

async function coverage(root: string, ...args: string[]): Promise<{ code: number; stdout: string }> {
  const streams = io();
  const code = await main(["--root", root, "coverage", ...args], streams);
  return { code, stdout: drain(streams.stdout) };
}

async function report(root: string, ...args: string[]): Promise<Report> {
  return JSON.parse((await coverage(root, "--tests", "--json", ...args)).stdout) as Report;
}

describe("FR-NODE-210 AC-2 — per-AC citations over the requirement scope", () => {
  it("FR-NODE-210 AC-2: reports every AC of every in-target requirement with the lines that cite it", async () => {
    const root = await workspace();
    const result = await report(root, "--target", "v1.0.0");
    expect(result.scope).toMatchObject({ target: "v1.0.0", ids: null, sds: null });
    expect(result.requirements.map((item) => [item.requirementId, item.acs.map((ac) => [ac.acId, ac.cited, ac.citations])])).toEqual([
      ["FR-ARCH-001", [["AC-1", true, [{ file: "test/arch.test.ts", line: 1 }]], ["AC-2", true, [{ file: "test/arch.test.ts", line: 2 }]]]],
      ["FR-ARCH-002", [["AC-1", true, [{ file: "test/arch.test.ts", line: 3 }]], ["AC-2", false, []]]]
    ]);
  });

  it("FR-NODE-210 AC-2: a discarded requirement of the target is not part of the scope", async () => {
    const root = await workspace();
    const scope = path.join(root, "docs", "spec", "10.product-architecture.srs.md");
    const text = await readFile(scope, "utf8");
    const at = text.lastIndexOf("| Status | planned |");
    await writeFile(scope, `${text.slice(0, at)}| Status | discarded |${text.slice(at + "| Status | planned |".length)}`, "utf8");
    const result = await report(root, "--target", "v1.0.0");
    expect(result.requirements.map((item) => item.requirementId)).toEqual(["FR-ARCH-001"]);
    expect(result.passed).toBe(true);
  });

  it("FR-NODE-210 AC-2: defaults to the Active Target when neither --target nor --ids is given", async () => {
    const root = await workspace();
    const result = await report(root);
    expect(result.scope.target).toBe("v1.0.0");
    expect(result.gaps.requirements).toEqual([{ requirementId: "FR-ARCH-002", acIds: ["AC-2"] }]);
  });

  it("FR-NODE-210 AC-2: with --sds, each SDS-AC needs its Test Plan file to exist and cite it", async () => {
    const root = await workspace();
    await put(
      root,
      "docs/sds/demo.sds.md",
      [
        "# SDS: demo",
        "",
        "| Field | Value |",
        "|---|---|",
        "| Document Type | sds |",
        "| Profile | lite |",
        "| Target | v1.0.0 |",
        "| Status | agreed |",
        "| Date | 2026-09-27 |",
        "",
        "## Interfaces",
        "",
        "### Files",
        "",
        "- `src/demo.ts` — demo @req FR-ARCH-001",
        "  - `list(): string[]` — lists ← cli",
        "",
        "## Acceptance Contracts",
        "",
        "- SDS-AC-1 (FR-ARCH-001 AC-1): WHEN one requirement exists THE SYSTEM SHALL list it → `list`",
        "- SDS-AC-2 (FR-ARCH-001 AC-2): WHEN asked THE SYSTEM SHALL show it → `list`",
        "- SDS-AC-3 (FR-ARCH-001 AC-2): WHEN asked twice THE SYSTEM SHALL show it once → `list`",
        "",
        "## Test Plan",
        "",
        "| SDS-AC | Test file | Case summary |",
        "|---|---|---|",
        "| SDS-AC-1 | `test/demo.test.ts` | lists |",
        "| SDS-AC-2 | `test/missing.test.ts` | shows |",
        "| SDS-AC-3 | `test/arch.test.ts` | shows once |",
        ""
      ].join("\n")
    );
    await put(root, "test/demo.test.ts", "it('SDS-AC-1 lists', () => {});\n");
    const result = await report(root, "--target", "v1.0.0", "--sds", "docs/sds/demo.sds.md");
    expect(result.scope.sds).toBe("docs/sds/demo.sds.md");
    expect(result.sdsContracts.map((item) => [item.sdsAcId, item.cited, item.testFiles])).toEqual([
      ["SDS-AC-1", true, [{ path: "test/demo.test.ts", exists: true, citations: [{ file: "test/demo.test.ts", line: 1 }] }]],
      ["SDS-AC-2", false, [{ path: "test/missing.test.ts", exists: false, citations: [] }]],
      ["SDS-AC-3", false, [{ path: "test/arch.test.ts", exists: true, citations: [] }]]
    ]);
    expect(result.gaps.sdsContracts.map((gap) => gap.sdsAcId)).toEqual(["SDS-AC-2", "SDS-AC-3"]);
  });
});

describe("FR-NODE-210 AC-2 — a planned test file is read only from inside the workspace", () => {
  it("FR-NODE-210 AC-2: a Test Plan file reached through a link to outside the workspace counts as missing", async () => {
    const root = await workspace();
    const { mkdtemp, symlink } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const outside = await mkdtemp(path.join(tmpdir(), "speckiwi-coverage-outside-"));
    await writeFile(path.join(outside, "far.test.ts"), "it('SDS-AC-1', () => {});\n", "utf8");
    await symlink(outside, path.join(root, "test", "link"), process.platform === "win32" ? "junction" : "dir");
    await put(
      root,
      "docs/sds/demo.sds.md",
      [
        "# SDS: demo",
        "",
        "| Field | Value |",
        "|---|---|",
        "| Document Type | sds |",
        "| Profile | lite |",
        "| Target | v1.0.0 |",
        "| Status | agreed |",
        "| Date | 2026-09-27 |",
        "",
        "## Interfaces",
        "",
        "### Files",
        "",
        "- `src/demo.ts` — demo @req FR-ARCH-001",
        "  - `list(): string[]` — lists ← cli",
        "",
        "## Acceptance Contracts",
        "",
        "- SDS-AC-1 (FR-ARCH-001 AC-1): WHEN one requirement exists THE SYSTEM SHALL list it → `list`",
        "",
        "## Test Plan",
        "",
        "| SDS-AC | Test file | Case summary |",
        "|---|---|---|",
        "| SDS-AC-1 | `test/link/far.test.ts` | lists |",
        ""
      ].join("\n")
    );
    const result = await report(root, "--target", "v1.0.0", "--sds", "docs/sds/demo.sds.md");
    expect(result.sdsContracts.map((item) => [item.sdsAcId, item.cited, item.testFiles])).toEqual([
      ["SDS-AC-1", false, [{ path: "test/link/far.test.ts", exists: false, citations: [] }]]
    ]);
  });
});

describe("FR-NODE-210 AC-3 — test files by default patterns or --test-glob", () => {
  it("FR-NODE-210 AC-3: a default-pattern file in tests/ counts; src and node_modules do not", async () => {
    const root = await workspace();
    expect((await report(root, "--target", "v1.0.0")).gaps.requirements).toEqual([{ requirementId: "FR-ARCH-002", acIds: ["AC-2"] }]);
    await put(root, "tests/extra_test.py", "# FR-ARCH-002 AC-2\n");
    expect((await report(root, "--target", "v1.0.0")).gaps.requirements).toEqual([]);
  });

  it("FR-NODE-210 AC-3: --test-glob replaces the default patterns", async () => {
    const root = await workspace();
    await put(root, "checks/all.ts", ["// FR-ARCH-001 AC-1, AC-2", "// FR-ARCH-002 AC-1 AC-2", ""].join("\n"));
    const result = await report(root, "--target", "v1.0.0", "--test-glob", "checks/**/*.ts");
    expect(result.gaps.requirements).toEqual([]);
    expect(result.requirements[0]?.acs[0]?.citations).toEqual([{ file: "checks/all.ts", line: 1 }]);
  });
});

describe("FR-NODE-210 AC-4 — JSON gaps and --fail-on-gap", () => {
  it("FR-NODE-210 AC-4: lists gaps per requirement and exits 0 without --fail-on-gap", async () => {
    const root = await workspace();
    const { code, stdout } = await coverage(root, "--tests", "--json", "--target", "v1.0.0");
    expect(code).toBe(0);
    const result = JSON.parse(stdout) as Report;
    expect(result.passed).toBe(false);
    expect(result.gaps).toEqual({ requirements: [{ requirementId: "FR-ARCH-002", acIds: ["AC-2"] }], sdsContracts: [] });
  });

  it("FR-NODE-210 AC-4: --fail-on-gap exits non-zero while a gap exists and zero once it is closed", async () => {
    const root = await workspace();
    expect((await coverage(root, "--tests", "--json", "--target", "v1.0.0", "--fail-on-gap")).code).toBe(1);
    await put(root, "test/more.test.ts", "it('FR-ARCH-002 AC-2', () => {});\n");
    expect((await coverage(root, "--tests", "--json", "--target", "v1.0.0", "--fail-on-gap")).code).toBe(0);
  });

  it("FR-NODE-210 AC-4: the human output names each gap", async () => {
    const root = await workspace();
    const { stdout } = await coverage(root, "--tests", "--target", "v1.0.0");
    expect(stdout).toContain("gap FR-ARCH-002 AC-2");
  });
});

describe("FR-NODE-210 AC-5 — the scan covers only the given scope", () => {
  it("FR-NODE-210 AC-5: --ids reports only the named requirements and does not fail on an uncited one outside them", async () => {
    const root = await workspace();
    const { code, stdout } = await coverage(root, "--tests", "--json", "--ids", "FR-ARCH-001", "--fail-on-gap");
    expect(code).toBe(0);
    const result = JSON.parse(stdout) as Report;
    expect(result.scope.ids).toEqual(["FR-ARCH-001"]);
    expect(result.requirements.map((item) => item.requirementId)).toEqual(["FR-ARCH-001"]);
  });
});

describe("FR-NODE-210 — contradictory or unknown arguments fail before any scan", () => {
  it("FR-NODE-210 AC-2: --target with --ids is a usage error, and so are the --tests options without --tests", async () => {
    const root = await workspace();
    expect((await coverage(root, "--tests", "--json", "--target", "v1.0.0", "--ids", "FR-ARCH-001")).code).toBe(2);
    expect((await coverage(root, "--json", "--ids", "FR-ARCH-001")).code).toBe(2);
    expect((await coverage(root, "--json", "--fail-on-gap")).code).toBe(2);
  });

  it("FR-NODE-210 AC-2: an unknown requirement id or target is NOT_FOUND", async () => {
    const root = await workspace();
    const unknownId = await coverage(root, "--tests", "--json", "--ids", "FR-ARCH-001,FR-NOPE-001");
    expect(unknownId.code).toBe(5);
    expect(unknownId.stdout).toContain("FR-NOPE-001");
    expect((await coverage(root, "--tests", "--json", "--target", "v9.9.9")).code).toBe(5);
  });

  it("FR-NODE-210 AC-2: plain coverage keeps its IR-CLI-053 answer", async () => {
    const root = await workspace();
    const { code, stdout } = await coverage(root, "--json");
    expect(code).toBe(0);
    expect(Object.keys(JSON.parse(stdout) as object).sort()).toEqual(["acCoverageGaps", "target"]);
  });
});
