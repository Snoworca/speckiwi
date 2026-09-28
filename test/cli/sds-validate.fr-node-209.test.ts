import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { createTestMcpServer } from "../../src/mcp/adapter.js";
import { registerReadTools } from "../../src/mcp/tools/read-tools.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

// FR-NODE-209 AC-2 / AC-3 — `speckiwi validate` carries the lite SDS diagnostics in every work-mode,
// and the full-profile step SDS checks stay where they were.
//
// The workspace is the valid-basic fixture: one requirement, FR-ARCH-001 (AC-1, AC-2), target v1.0.0.

interface Diagnostic {
  code: string;
  severity: string;
  filePath?: string;
  line?: number;
}

function io() {
  return { stdout: new PassThrough(), stderr: new PassThrough() };
}

function drain(stream: PassThrough): string {
  return stream.read()?.toString() ?? "";
}

function liteSds(options: { reqId?: string; profile?: string } = {}): string {
  return [
    "# SDS: demo",
    "",
    "| Field | Value |",
    "|---|---|",
    "| Document Type | sds |",
    `| Profile | ${options.profile ?? "lite"} |`,
    "| Target | v1.0.0 |",
    "| Status | draft |",
    "| Date | 2026-09-27 |",
    "",
    "## Interfaces",
    "",
    "### Files",
    "",
    `- \`src/demo.ts\` — lists requirements @req ${options.reqId ?? "FR-ARCH-001"}`,
    "  - `listRequirements(root: string): string[]` — returns ids ← cli",
    "",
    "## Acceptance Contracts",
    "",
    "- SDS-AC-1 (FR-ARCH-001 AC-1): WHEN the workspace holds one requirement THE SYSTEM SHALL list it → `listRequirements`",
    "",
    "## Test Plan",
    "",
    "| SDS-AC | Test file | Case summary |",
    "|---|---|---|",
    "| SDS-AC-1 | `test/demo.test.ts` | one requirement listed |",
    ""
  ].join("\n");
}

async function workspace(mode?: string): Promise<string> {
  const root = await copyFixtureWorkspace("valid-basic");
  if (mode !== undefined) {
    const stepsDir = path.join(root, "docs", "spec", "steps");
    await mkdir(stepsDir, { recursive: true });
    await writeFile(
      path.join(stepsDir, "state.md"),
      ["# Step State", "", `Mode: ${mode}`, "", "| Step | Status | DependsOn | TouchesScope | TouchesReq | Created | Updated |", "| --- | --- | --- | --- | --- | --- | --- |", ""].join("\n"),
      "utf8"
    );
  }
  await mkdir(path.join(root, "docs", "sds"), { recursive: true });
  return root;
}

async function validate(root: string): Promise<{ code: number; errors: Diagnostic[]; warnings: Diagnostic[] }> {
  const streams = io();
  const code = await main(["--root", root, "validate", "--json"], streams);
  const output = JSON.parse(drain(streams.stdout)) as { errors: Diagnostic[]; warnings: Diagnostic[] };
  return { code, errors: output.errors, warnings: output.warnings };
}

const sdsCodes = (diagnostics: Diagnostic[]): string[] => diagnostics.map((item) => item.code).filter((code) => code.startsWith("SDS-"));

describe("FR-NODE-209 AC-3 — speckiwi validate includes the lite SDS diagnostics", () => {
  it("FR-NODE-209 AC-3: an unresolved @req in docs/sds fails validate with the file and line", async () => {
    const root = await workspace();
    await writeFile(path.join(root, "docs", "sds", "demo.sds.md"), liteSds({ reqId: "FR-ARCH-999" }), "utf8");
    const result = await validate(root);
    expect(result.code).toBe(1);
    const found = result.errors.filter((item) => item.code === "SDS-E062");
    expect(found.map(({ filePath, line }) => ({ filePath, line }))).toEqual([{ filePath: "docs/sds/demo.sds.md", line: 15 }]);
  });

  it("FR-NODE-209 AC-3: a clean lite SDS adds nothing to validate", async () => {
    const root = await workspace();
    await writeFile(path.join(root, "docs", "sds", "demo.sds.md"), liteSds(), "utf8");
    const result = await validate(root);
    expect(sdsCodes([...result.errors, ...result.warnings])).toEqual([]);
    expect(result.code).toBe(0);
  });

  it("FR-NODE-209 AC-3: reads docs/sds/*.sds.md only — neither other names nor subdirectories", async () => {
    const root = await workspace();
    await writeFile(path.join(root, "docs", "sds", "notes.md"), liteSds({ reqId: "FR-ARCH-999" }), "utf8");
    await mkdir(path.join(root, "docs", "sds", "archive"), { recursive: true });
    await writeFile(path.join(root, "docs", "sds", "archive", "old.sds.md"), liteSds({ reqId: "FR-ARCH-999" }), "utf8");
    const result = await validate(root);
    expect(sdsCodes([...result.errors, ...result.warnings])).toEqual([]);
  });

  it("FR-NODE-209 AC-3: an SDS file in docs/sds that is not lite is reported as skipped, not silently passed", async () => {
    const root = await workspace();
    await writeFile(path.join(root, "docs", "sds", "demo.sds.md"), liteSds({ profile: "full" }), "utf8");
    const result = await validate(root);
    expect(result.warnings.filter((item) => item.code === "SDS-W069").map((item) => item.filePath)).toEqual(["docs/sds/demo.sds.md"]);
  });

  it("FR-NODE-209 AC-3: a (REQ AC) resolves against the body requirement when a step carries the same id", async () => {
    const root = await workspace();
    const { readFile } = await import("node:fs/promises");
    const scope = await readFile(path.join(root, "docs", "spec", "10.product-architecture.srs.md"), "utf8");
    const block = scope.slice(scope.indexOf("### FR-ARCH-001")).replace("- [ ] AC-2: The requirement can be shown.\n", "");
    await mkdir(path.join(root, "docs", "spec", "steps", "beta"), { recursive: true });
    await writeFile(path.join(root, "docs", "spec", "steps", "beta", "beta.srs.md"), `# Step: beta\n\n## Requirements\n\n${block}`, "utf8");
    await writeFile(path.join(root, "docs", "sds", "demo.sds.md"), liteSds().replace("(FR-ARCH-001 AC-1)", "(FR-ARCH-001 AC-2)"), "utf8");
    const result = await validate(root);
    expect(sdsCodes([...result.errors, ...result.warnings])).toEqual([]);
  });

  it("FR-NODE-209 AC-3: an SDS directory that resolves outside the workspace is not read", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    const { mkdtemp, symlink } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const outside = await mkdtemp(path.join(tmpdir(), "speckiwi-sds-dir-outside-"));
    await writeFile(path.join(outside, "far.sds.md"), liteSds({ reqId: "FR-ARCH-999" }), "utf8");
    await symlink(outside, path.join(root, "docs", "sds"), process.platform === "win32" ? "junction" : "dir");
    const result = await validate(root);
    expect(sdsCodes([...result.errors, ...result.warnings])).toEqual([]);
  });

  it("FR-NODE-209 AC-3: a workspace without docs/sds validates exactly as before", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    const result = await validate(root);
    expect(sdsCodes([...result.errors, ...result.warnings])).toEqual([]);
  });

  it("FR-NODE-209 AC-3: MCP validate_spec reports the same lite diagnostics as the CLI", async () => {
    const root = await workspace();
    await writeFile(path.join(root, "docs", "sds", "demo.sds.md"), liteSds({ reqId: "FR-ARCH-999" }), "utf8");
    const cli = await validate(root);
    const server = createTestMcpServer({ root });
    registerReadTools(server, { root });
    const answer = (await server.callTool("validate_spec", {})) as { value: { errors: Diagnostic[]; warnings: Diagnostic[] } };
    expect(sdsCodes([...answer.value.errors, ...answer.value.warnings])).toEqual(sdsCodes([...cli.errors, ...cli.warnings]));
    expect(sdsCodes(answer.value.errors)).toContain("SDS-E062");
  });
});

describe("FR-NODE-209 AC-2 — the diagnostics run in every work-mode", () => {
  for (const mode of ["sdd", "vibe", "tdd", "wait", undefined]) {
    it(`FR-NODE-209 AC-2: reports the lite error when the work-mode is ${mode ?? "unset"}`, async () => {
      const root = await workspace(mode);
      await writeFile(path.join(root, "docs", "sds", "demo.sds.md"), liteSds({ reqId: "FR-ARCH-999" }), "utf8");
      const result = await validate(root);
      expect(sdsCodes(result.errors)).toEqual(["SDS-E062"]);
    });
  }
});

describe("FR-NODE-209 AC-3 — the full-profile step SDS checks are unchanged", () => {
  it("FR-NODE-209 AC-3: step validate reports its SDS-W051 and none of the lite codes, even beside a broken lite SDS", async () => {
    const root = await workspace();
    const stepsDir = path.join(root, "docs", "spec", "steps");
    await mkdir(path.join(stepsDir, "alpha"), { recursive: true });
    await writeFile(
      path.join(stepsDir, "state.md"),
      [
        "# Step State",
        "",
        "Mode: tdd",
        "Active Task: alpha",
        "",
        "| Step | Status | DependsOn | TouchesScope | TouchesReq | Created | Updated |",
        "| --- | --- | --- | --- | --- | --- | --- |",
        "| alpha | active | - | ARCH | - | 2026-09-27 | 2026-09-27 |",
        ""
      ].join("\n"),
      "utf8"
    );
    // Missing exactly one of the seven full-profile headings.
    await writeFile(
      path.join(stepsDir, "alpha", "design.md"),
      ["# SDS", "## Context & Scope", "-", "## Goals / Non-goals", "-", "## Architecture Decisions", "-", "## Interfaces", "-", "## Acceptance Contracts", "- SDS-AC-1: WHEN a THE SYSTEM SHALL b.", "## Test Plan", "| SDS-AC-1 | test/a.test.ts | a |", ""].join("\n"),
      "utf8"
    );
    await writeFile(path.join(root, "docs", "sds", "demo.sds.md"), liteSds({ reqId: "FR-ARCH-999" }), "utf8");

    const streams = io();
    await main(["--root", root, "step", "validate", "alpha", "--json"], streams);
    const output = JSON.parse(drain(streams.stdout)) as { diagnostics: Diagnostic[] };
    expect(sdsCodes(output.diagnostics)).toEqual(["SDS-W051"]);

    // And validate carries the lite codes without picking up the step's full-profile advisories. The
    // SDS names FR-ARCH-999 instead of FR-ARCH-001, so the in-target warning comes with the error.
    const result = await validate(root);
    expect(sdsCodes([...result.errors, ...result.warnings])).toEqual(["SDS-E062", "SDS-W068"]);
  });
});
