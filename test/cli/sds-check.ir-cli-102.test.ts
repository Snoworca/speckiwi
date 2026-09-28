import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

// IR-CLI-102 — `speckiwi sds check <path> [--json]` prints one lite SDS file's diagnostics and parsed
// summary, and exits non-zero when an error-level diagnostic exists.
//
// valid-basic carries FR-ARCH-001 (AC-1, AC-2) in target v1.0.0; a second requirement FR-ARCH-002 is
// appended where a case needs two in-target requirements.

interface Diagnostic {
  code: string;
  severity: string;
  line?: number;
}

function io() {
  return { stdout: new PassThrough(), stderr: new PassThrough() };
}

function drain(stream: PassThrough): string {
  return stream.read()?.toString() ?? "";
}

function sds(options: { reqId?: string; ac?: string; profile?: string } = {}): string {
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
    "### Depends",
    "",
    "- cli → core",
    "",
    "### Files",
    "",
    `- \`src/demo.ts\` — lists requirements @req ${options.reqId ?? "FR-ARCH-001"}`,
    "  - `listRequirements(root: string): string[]` — returns ids ← cli",
    "",
    "## Acceptance Contracts",
    "",
    `- SDS-AC-1 (FR-ARCH-001 ${options.ac ?? "AC-1"}): WHEN the workspace holds one requirement THE SYSTEM SHALL list it → \`listRequirements\``,
    "",
    "## Test Plan",
    "",
    "| SDS-AC | Test file | Case summary |",
    "|---|---|---|",
    "| SDS-AC-1 | `test/demo.test.ts` | one requirement listed |",
    ""
  ].join("\n");
}

async function workspace(): Promise<string> {
  const root = await copyFixtureWorkspace("valid-basic");
  await mkdir(path.join(root, "docs", "sds"), { recursive: true });
  return root;
}

async function run(root: string, ...args: string[]): Promise<{ code: number; stdout: string }> {
  const streams = io();
  const code = await main(["--root", root, "sds", "check", ...args], streams);
  return { code, stdout: drain(streams.stdout) };
}

describe("IR-CLI-102 AC-1 — sds check prints the diagnostics and the parsed summary", () => {
  it("IR-CLI-102 AC-1: --json carries the FR-NODE-209 diagnostics and the summary of files, test files, requirement ids, SDS-ACs and depends", async () => {
    const root = await workspace();
    await writeFile(path.join(root, "docs", "sds", "demo.sds.md"), sds(), "utf8");
    const { code, stdout } = await run(root, "docs/sds/demo.sds.md", "--json");
    expect(code).toBe(0);
    const report = JSON.parse(stdout) as {
      path: string;
      passed: boolean;
      diagnostics: Diagnostic[];
      summary: Record<string, unknown>;
    };
    expect(report.path).toBe("docs/sds/demo.sds.md");
    expect(report.passed).toBe(true);
    expect(report.diagnostics).toEqual([]);
    expect(report.summary).toMatchObject({
      files: ["src/demo.ts"],
      testFiles: ["test/demo.test.ts"],
      requirementIds: ["FR-ARCH-001"],
      sdsAcs: [{ id: "SDS-AC-1", requirementId: "FR-ARCH-001", acId: "AC-1", targets: ["listRequirements"] }],
      depends: [[["cli"], ["core"]]]
    });
  });

  it("IR-CLI-102 AC-1: the human output names each diagnostic and each summary part", async () => {
    const root = await workspace();
    await writeFile(path.join(root, "docs", "sds", "demo.sds.md"), sds({ ac: "AC-7" }), "utf8");
    const { stdout } = await run(root, "docs/sds/demo.sds.md");
    expect(stdout).toContain("error SDS-E063 docs/sds/demo.sds.md:24");
    for (const part of ["Files: src/demo.ts", "Test files: test/demo.test.ts", "Requirements: FR-ARCH-001", "SDS-AC-1 (FR-ARCH-001 AC-7) → listRequirements", "Depends: cli → core"]) {
      expect(stdout, part).toContain(part);
    }
  });

  it("IR-CLI-102 AC-1: counts the @req of the other lite SDS files of the same target", async () => {
    const root = await workspace();
    const scope = path.join(root, "docs", "spec", "10.product-architecture.srs.md");
    const { readFile } = await import("node:fs/promises");
    const text = await readFile(scope, "utf8");
    const block = text.slice(text.indexOf("### FR-ARCH-001"));
    await writeFile(scope, `${text}\n${block.replace("FR-ARCH-001 — Fixture requirement", "FR-ARCH-002 — Second fixture requirement").replace("| Requirement | FR-ARCH-001 | self |", "| Requirement | FR-ARCH-002 | self |")}`, "utf8");
    await writeFile(path.join(root, "docs", "sds", "demo.sds.md"), sds(), "utf8");

    const alone = JSON.parse((await run(root, "docs/sds/demo.sds.md", "--json")).stdout) as { warnings: Array<Diagnostic & { requirementId?: string }> };
    expect(alone.warnings.filter((item) => item.code === "SDS-W068").map((item) => item.requirementId)).toEqual(["FR-ARCH-002"]);

    await writeFile(path.join(root, "docs", "sds", "demo-2.sds.md"), sds({ reqId: "FR-ARCH-002" }), "utf8");
    const split = JSON.parse((await run(root, "docs/sds/demo.sds.md", "--json")).stdout) as { warnings: Diagnostic[] };
    expect(split.warnings.filter((item) => item.code === "SDS-W068")).toEqual([]);
  });
});

describe("IR-CLI-102 AC-1 — a scoped SDS reports its own scope only", () => {
  it("IR-CLI-102 AC-1: a Requirements-scoped SDS is not told about an unscoped sibling's missing requirement", async () => {
    const root = await workspace();
    const scope = path.join(root, "docs", "spec", "10.product-architecture.srs.md");
    const { readFile } = await import("node:fs/promises");
    const text = await readFile(scope, "utf8");
    const block = text.slice(text.indexOf("### FR-ARCH-001"));
    await writeFile(scope, `${text}\n${block.replace("FR-ARCH-001 — Fixture requirement", "FR-ARCH-002 — Second fixture requirement").replace("| Requirement | FR-ARCH-001 | self |", "| Requirement | FR-ARCH-002 | self |")}`, "utf8");
    await writeFile(path.join(root, "docs", "sds", "wave-1.sds.md"), sds().replace("| Date | 2026-09-27 |", "| Date | 2026-09-27 |\n| Requirements | FR-ARCH-001 |"), "utf8");
    await writeFile(path.join(root, "docs", "sds", "rest.sds.md"), sds(), "utf8");

    const scoped = JSON.parse((await run(root, "docs/sds/wave-1.sds.md", "--json")).stdout) as { warnings: Diagnostic[]; summary: { requirementScope: string[] | null } };
    expect(scoped.warnings).toEqual([]);
    expect(scoped.summary.requirementScope).toEqual(["FR-ARCH-001"]);
    const rest = JSON.parse((await run(root, "docs/sds/rest.sds.md", "--json")).stdout) as { warnings: Array<Diagnostic & { requirementId?: string }> };
    expect(rest.warnings.map((item) => [item.code, item.requirementId])).toEqual([["SDS-W068", "FR-ARCH-002"]]);
  });
});

describe("IR-CLI-102 AC-2 — a listed requirement no @req names fails the check", () => {
  it("IR-CLI-102 AC-2: exits 1 when the Requirements row lists a requirement no @req in the file names", async () => {
    const root = await workspace();
    const scope = path.join(root, "docs", "spec", "10.product-architecture.srs.md");
    const { readFile } = await import("node:fs/promises");
    const text = await readFile(scope, "utf8");
    const block = text.slice(text.indexOf("### FR-ARCH-001"));
    await writeFile(scope, `${text}\n${block.replace("FR-ARCH-001 — Fixture requirement", "FR-ARCH-002 — Second fixture requirement").replace("| Requirement | FR-ARCH-001 | self |", "| Requirement | FR-ARCH-002 | self |")}`, "utf8");
    await writeFile(path.join(root, "docs", "sds", "wave-1.sds.md"), sds().replace("| Date | 2026-09-27 |", "| Date | 2026-09-27 |\n| Requirements | FR-ARCH-001, FR-ARCH-002 |"), "utf8");
    const { code, stdout } = await run(root, "docs/sds/wave-1.sds.md", "--json");
    const report = JSON.parse(stdout) as { passed: boolean; errors: Array<Diagnostic & { requirementId?: string }> };
    expect(report.errors.map((item) => [item.code, item.requirementId])).toEqual([["SDS-E070", "FR-ARCH-002"]]);
    expect(report.passed).toBe(false);
    expect(code).toBe(1);
  });
});

describe("IR-CLI-102 AC-2 — the exit code follows the error-level diagnostics", () => {
  it("IR-CLI-102 AC-2: exits 1 when an error-level diagnostic exists", async () => {
    const root = await workspace();
    await writeFile(path.join(root, "docs", "sds", "demo.sds.md"), sds({ reqId: "FR-ARCH-999" }), "utf8");
    const { code, stdout } = await run(root, "docs/sds/demo.sds.md", "--json");
    expect(code).toBe(1);
    const report = JSON.parse(stdout) as { passed: boolean; errors: Diagnostic[] };
    expect(report.passed).toBe(false);
    expect(report.errors.map((item) => item.code)).toContain("SDS-E062");
  });

  it("IR-CLI-102 AC-2: exits 0 when only warnings remain", async () => {
    const root = await workspace();
    const scope = path.join(root, "docs", "spec", "10.product-architecture.srs.md");
    const { readFile } = await import("node:fs/promises");
    const text = await readFile(scope, "utf8");
    const block = text.slice(text.indexOf("### FR-ARCH-001"));
    await writeFile(scope, `${text}\n${block.replace("FR-ARCH-001 — Fixture requirement", "FR-ARCH-002 — Second fixture requirement").replace("| Requirement | FR-ARCH-001 | self |", "| Requirement | FR-ARCH-002 | self |")}`, "utf8");
    await writeFile(path.join(root, "docs", "sds", "demo.sds.md"), sds(), "utf8");
    const { code, stdout } = await run(root, "docs/sds/demo.sds.md", "--json");
    const report = JSON.parse(stdout) as { warnings: Diagnostic[]; errors: Diagnostic[] };
    expect(report.errors).toEqual([]);
    expect(report.warnings.map((item) => item.code)).toEqual(["SDS-W068"]);
    expect(code).toBe(0);
  });

  it("IR-CLI-102 AC-2: a file that is not lite profile is an error, not a pass", async () => {
    const root = await workspace();
    await writeFile(path.join(root, "docs", "sds", "demo.sds.md"), sds({ profile: "full" }), "utf8");
    const { code, stdout } = await run(root, "docs/sds/demo.sds.md", "--json");
    expect(code).toBe(1);
    expect((JSON.parse(stdout) as { errors: Diagnostic[] }).errors.map((item) => item.code)).toEqual(["SDS-E060"]);
  });

  it("IR-CLI-102 AC-1: a path that reaches outside the workspace through a link is refused, not read", async () => {
    const root = await workspace();
    const { mkdtemp, symlink } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const outside = await mkdtemp(path.join(tmpdir(), "speckiwi-sds-outside-"));
    await writeFile(path.join(outside, "secret.sds.md"), sds({ profile: "SECRET-PROFILE" }), "utf8");
    await symlink(outside, path.join(root, "docs", "sds", "link"), process.platform === "win32" ? "junction" : "dir");
    const { code, stdout } = await run(root, "docs/sds/link/secret.sds.md", "--json");
    expect(code).toBe(2);
    expect(stdout).not.toContain("SECRET-PROFILE");
    expect((JSON.parse(stdout) as { error: { code: string } }).error.code).toBe("USAGE");
  });

  it("IR-CLI-102 AC-1: a file whose name merely begins with two dots is inside the workspace", async () => {
    const root = await workspace();
    await writeFile(path.join(root, "..odd.sds.md"), sds(), "utf8");
    const { code, stdout } = await run(root, "..odd.sds.md", "--json");
    expect(code).toBe(0);
    expect((JSON.parse(stdout) as { path: string }).path).toBe("..odd.sds.md");
  });

  it("IR-CLI-102 AC-2: a missing file and a path outside the workspace fail with a structured error", async () => {
    const root = await workspace();
    const missing = await run(root, "docs/sds/none.sds.md", "--json");
    expect(missing.code).toBe(5);
    expect((JSON.parse(missing.stdout) as { error: { code: string } }).error.code).toBe("NOT_FOUND");
    const outside = await run(root, "../elsewhere.sds.md", "--json");
    expect(outside.code).toBe(2);
    expect((JSON.parse(outside.stdout) as { error: { code: string } }).error.code).toBe("USAGE");
  });
});
