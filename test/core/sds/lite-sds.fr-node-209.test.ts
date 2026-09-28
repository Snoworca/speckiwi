import { describe, expect, it } from "vitest";
import {
  LITE_SDS_DIAGNOSTICS,
  LITE_SDS_LINE_CAP,
  liteSdsCoverageDiagnostics,
  liteSdsReferenceDiagnostics,
  parseLiteSds,
  type LiteSdsRequirement
} from "../../../src/core/sds/lite-sds.js";

// FR-NODE-209 — the lite-profile SDS parser and its diagnostics, over text rather than disk.
//
// Every diagnostic case starts from one document that parses clean and changes exactly the thing the
// diagnostic is about. The clean baseline is asserted first, so a parser that reports nothing at all
// cannot pass the negative cases by accident, and each positive case names the code, the severity
// and the line it lands on.

const FILE = "docs/sds/todo-service.sds.md";

const BASE = [
  "# SDS: todo-service",
  "",
  "| Field | Value |",
  "|---|---|",
  "| Document Type | sds |",
  "| Profile | lite |",
  "| Target | v1.0.0 |",
  "| Status | draft |",
  "| Date | 2026-09-27 |",
  "",
  "## Interfaces",
  "",
  "### Depends",
  "",
  "- cli → service → store, validate",
  "- * → types",
  "",
  "### Files",
  "",
  "- `src/service.ts` — task lifecycle and version checks @req FR-ARCH-001",
  "  - `createTask(input: CreateTaskInput): Task` — creates a task at version 1 ← cli",
  "  - `class TaskService<T> extends Base` — holds the store",
  "    - `archive(id: string): void` — marks a task archived ← cli, worker @req FR-ARCH-002",
  "- `src/validate.ts` — argument validation",
  "  - `parseExpectedVersion(v: unknown): number` / `parsePatch(v: unknown): TaskPatch` — positive integer ← service",
  "",
  "## Acceptance Contracts",
  "",
  "- SDS-AC-1 (FR-ARCH-001 AC-2): WHEN expectedVersion is not a positive integer THE SYSTEM SHALL throw VALIDATION before any version comparison → `parseExpectedVersion`",
  "- SDS-AC-2 (FR-ARCH-002 AC-1): WHEN a task is archived twice THE SYSTEM SHALL keep the first archive time → `TaskService.archive`, `createTask`",
  "",
  "## Test Plan",
  "",
  "| SDS-AC | Test file | Case summary |",
  "|---|---|---|",
  "| SDS-AC-1 | `test/validate.test.ts` | 0, -1 and 1.5 are refused |",
  "| SDS-AC-2 | `test/service.test.ts` | archive twice |",
  ""
];

function text(lines: readonly string[]): string {
  return lines.join("\n");
}

/** BASE with the line equal to `from` replaced by `to` (or removed when `to` is null). */
function edit(from: string, to: string | readonly string[] | null): string[] {
  const index = BASE.indexOf(from);
  expect(index, `fixture line not found: ${from}`).toBeGreaterThanOrEqual(0);
  const replacement = to === null ? [] : typeof to === "string" ? [to] : [...to];
  return [...BASE.slice(0, index), ...replacement, ...BASE.slice(index + 1)];
}

function lineOf(lines: readonly string[], needle: string): number {
  const index = lines.findIndex((line) => line.includes(needle));
  expect(index, `line containing ${needle}`).toBeGreaterThanOrEqual(0);
  return index + 1;
}

const REQUIREMENTS: readonly LiteSdsRequirement[] = [
  { id: "FR-ARCH-001", target: "v1.0.0", status: "planned", acceptanceCriteria: [{ id: "AC-1" }, { id: "AC-2" }] },
  { id: "FR-ARCH-002", target: "v1.0.0", status: "in_progress", acceptanceCriteria: [{ id: "AC-1" }] }
];

function structural(lines: readonly string[]) {
  return parseLiteSds(text(lines), FILE).diagnostics;
}

function all(lines: readonly string[], requirements: readonly LiteSdsRequirement[] = REQUIREMENTS) {
  const parsed = parseLiteSds(text(lines), FILE);
  return [
    ...parsed.diagnostics,
    ...liteSdsReferenceDiagnostics(parsed.document, requirements),
    ...liteSdsCoverageDiagnostics([parsed.document], requirements)
  ];
}

function codesOf(diagnostics: ReadonlyArray<{ code: string }>): string[] {
  return diagnostics.map((item) => item.code);
}

describe("FR-NODE-209 AC-1 — the parser reads every lite construct", () => {
  const parsed = parseLiteSds(text(BASE), FILE);

  it("FR-NODE-209 AC-1: recognises Profile = lite and reads the metadata", () => {
    expect(parsed.isLite).toBe(true);
    expect(parsed.document.metadata).toMatchObject({ "Document Type": "sds", Profile: "lite", Target: "v1.0.0", Status: "draft" });
    expect(parsed.document.target).toBe("v1.0.0");
  });

  it("FR-NODE-209 AC-1: reads Files entries with path, responsibility and @req ids", () => {
    expect(parsed.document.files.map(({ path, responsibility, reqIds, line }) => ({ path, responsibility, reqIds, line }))).toEqual([
      { path: "src/service.ts", responsibility: "task lifecycle and version checks", reqIds: ["FR-ARCH-001"], line: lineOf(BASE, "`src/service.ts`") },
      { path: "src/validate.ts", responsibility: "argument validation", reqIds: [], line: lineOf(BASE, "`src/validate.ts`") }
    ]);
  });

  it("FR-NODE-209 AC-1: derives each Files entry's test files through the contracts that point at its symbols", () => {
    expect(parsed.document.files.map((file) => [file.path, file.testFiles])).toEqual([
      ["src/service.ts", ["test/service.test.ts"]],
      ["src/validate.ts", ["test/validate.test.ts"]]
    ]);
  });

  it("FR-NODE-209 AC-1: reads symbol and member lines — one declaration per span, callers and inherited @req", () => {
    expect(
      parsed.document.symbols.map(({ name, qualifiedName, signature, file, callers, reqIds }) => ({ name, qualifiedName, signature, file, callers, reqIds }))
    ).toEqual([
      { name: "createTask", qualifiedName: "createTask", signature: "createTask(input: CreateTaskInput): Task", file: "src/service.ts", callers: ["cli"], reqIds: ["FR-ARCH-001"] },
      { name: "TaskService", qualifiedName: "TaskService", signature: "class TaskService<T> extends Base", file: "src/service.ts", callers: [], reqIds: ["FR-ARCH-001"] },
      { name: "archive", qualifiedName: "TaskService.archive", signature: "archive(id: string): void", file: "src/service.ts", callers: ["cli", "worker"], reqIds: ["FR-ARCH-001", "FR-ARCH-002"] },
      { name: "parseExpectedVersion", qualifiedName: "parseExpectedVersion", signature: "parseExpectedVersion(v: unknown): number", file: "src/validate.ts", callers: ["service"], reqIds: [] },
      { name: "parsePatch", qualifiedName: "parsePatch", signature: "parsePatch(v: unknown): TaskPatch", file: "src/validate.ts", callers: ["service"], reqIds: [] }
    ]);
  });

  it("FR-NODE-209 AC-1: reads Depends chains as ordered layers", () => {
    expect(parsed.document.depends.map(({ layers, line }) => ({ layers, line }))).toEqual([
      { layers: [["cli"], ["service"], ["store", "validate"]], line: lineOf(BASE, "- cli →") },
      { layers: [["*"], ["types"]], line: lineOf(BASE, "- * →") }
    ]);
  });

  it("FR-NODE-209 AC-1: reads Acceptance Contracts with their (REQ AC) reference and → targets", () => {
    expect(parsed.document.contracts.map(({ id, requirementId, acId, targets }) => ({ id, requirementId, acId, targets }))).toEqual([
      { id: "SDS-AC-1", requirementId: "FR-ARCH-001", acId: "AC-2", targets: ["parseExpectedVersion"] },
      { id: "SDS-AC-2", requirementId: "FR-ARCH-002", acId: "AC-1", targets: ["TaskService.archive", "createTask"] }
    ]);
  });

  it("FR-NODE-209 AC-1: reads Test Plan rows", () => {
    expect(parsed.document.testPlan.map(({ sdsAcId, testFiles, summary }) => ({ sdsAcId, testFiles, summary }))).toEqual([
      { sdsAcId: "SDS-AC-1", testFiles: ["test/validate.test.ts"], summary: "0, -1 and 1.5 are refused" },
      { sdsAcId: "SDS-AC-2", testFiles: ["test/service.test.ts"], summary: "archive twice" }
    ]);
  });

  it("FR-NODE-209 AC-1: names a symbol by the identifier after a declaration keyword, else the last one before ( : or =", () => {
    const lines = edit("  - `createTask(input: CreateTaskInput): Task` — creates a task at version 1 ← cli", [
      "  - `export async function load<T>(key: string): Promise<T>` — loads",
      "  - `const MAX_RETRIES: number = 3` — retry cap",
      "  - `Task<int> RunAsync(CancellationToken token)` — runs",
      "  - `Store.touch(t: TaskRecord): void` — bumps the version"
    ]);
    const names = parseLiteSds(text(lines), FILE).document.symbols.map((symbol) => [symbol.name, symbol.qualifiedName]);
    expect(names.slice(0, 4)).toEqual([
      ["load", "load"],
      ["MAX_RETRIES", "MAX_RETRIES"],
      ["RunAsync", "RunAsync"],
      ["touch", "Store.touch"]
    ]);
  });

  it("FR-NODE-209 AC-1: does not read a non-lite document as lite", () => {
    const parsedFull = parseLiteSds(text(edit("| Profile | lite |", null)), FILE);
    expect(parsedFull.isLite).toBe(false);
    expect(codesOf(parsedFull.diagnostics)).toContain("SDS-E060");
  });
});

describe("FR-NODE-209 AC-2 — the optional Requirements metadata sets the scope of the no-@req check", () => {
  const scoped = (value: string): string[] => edit("| Date | 2026-09-27 |", ["| Date | 2026-09-27 |", `| Requirements | ${value} |`]);
  const requirements: LiteSdsRequirement[] = [
    ...REQUIREMENTS,
    { id: "FR-ARCH-003", target: "v1.0.0", status: "planned", acceptanceCriteria: [{ id: "AC-1" }] },
    { id: "FR-ARCH-004", target: "v2.0.0", status: "verified", acceptanceCriteria: [{ id: "AC-1" }] }
  ];

  it("FR-NODE-209 AC-1: reads the comma-separated Requirements list and where it is written", () => {
    const lines = scoped("FR-ARCH-001, FR-ARCH-004");
    expect(parseLiteSds(text(lines), FILE).document.requirementScope).toEqual({ line: lineOf(lines, "| Requirements |"), ids: ["FR-ARCH-001", "FR-ARCH-004"] });
    expect(parseLiteSds(text(BASE), FILE).document.requirementScope).toBeNull();
    expect(structural(lines)).toEqual([]);
  });

  it("FR-NODE-209 AC-2: with the field, every listed requirement no @req names is an error, whatever its target or status, and only those", () => {
    const found = all(scoped("FR-ARCH-001, FR-ARCH-004"), requirements).filter((item) => item.code === "SDS-E070" || item.code === "SDS-W068");
    // FR-ARCH-003 is an open requirement of the target, but the SDS scoped itself away from it. The
    // listed-but-unnamed requirement is an error — the SDS declared it in scope (FR-FLOW-182 AC-3) — and
    // it is not also reported at warning severity.
    expect(found.map(({ code, severity, requirementId, filePath }) => ({ code, severity, requirementId, filePath }))).toEqual([
      { code: "SDS-E070", severity: "error", requirementId: "FR-ARCH-004", filePath: FILE }
    ]);
  });

  it("FR-NODE-209 AC-2: without the field, an unnamed open requirement of the target stays a warning", () => {
    const found = all(BASE, requirements).filter((item) => item.code === "SDS-E070" || item.code === "SDS-W068");
    expect(found.map(({ code, severity }) => [code, severity])).toEqual([["SDS-W068", "warning"]]);
  });

  it("FR-NODE-209 AC-2: without the field, the scope is the target's open requirements", () => {
    expect(all(BASE, requirements).filter((item) => item.code === "SDS-W068").map((item) => item.requirementId)).toEqual(["FR-ARCH-003"]);
  });

  it("FR-NODE-209 AC-2: a listed id that names no requirement is an unresolved reference at the metadata row", () => {
    const lines = scoped("FR-ARCH-001, FR-NOPE-001"); // @req-lint: ignore
    const found = all(lines, requirements).filter((item) => item.code === "SDS-E062");
    expect(found.map(({ line, requirementId }) => ({ line, requirementId }))).toEqual([{ line: lineOf(lines, "| Requirements |"), requirementId: "FR-NOPE-001" }]);
  });

  it("FR-NODE-209 AC-2: a scoped SDS does not stand in for the target-wide check, and its @req still count toward it", () => {
    const scopedDocument = parseLiteSds(text(scoped("FR-ARCH-001, FR-ARCH-002")), "docs/sds/wave-1.sds.md").document;
    const targetDocument = parseLiteSds(text(BASE), "docs/sds/rest.sds.md").document;
    expect(liteSdsCoverageDiagnostics([scopedDocument], requirements)).toEqual([]);
    expect(liteSdsCoverageDiagnostics([scopedDocument, targetDocument], requirements).map(({ requirementId, filePath }) => ({ requirementId, filePath }))).toEqual([
      { requirementId: "FR-ARCH-003", filePath: "docs/sds/rest.sds.md" }
    ]);
  });
});

describe("FR-NODE-209 AC-4 — the parse result exposes the write set and the @req set", () => {
  it("FR-NODE-209 AC-4: write set is the Files paths plus the Test Plan test files, sorted and unique", () => {
    const { document } = parseLiteSds(text(BASE), FILE);
    expect(document.writeSet).toEqual(["src/service.ts", "src/validate.ts", "test/service.test.ts", "test/validate.test.ts"]);
  });

  it("FR-NODE-209 AC-4: the @req set collects file and symbol citations, not the contract references", () => {
    const lines = edit("- `src/validate.ts` — argument validation", "- `src/validate.ts` — argument validation @req FR-ARCH-003");
    expect(parseLiteSds(text(lines), FILE).document.reqIds).toEqual(["FR-ARCH-001", "FR-ARCH-002", "FR-ARCH-003"]);
    // SDS-AC-2 references FR-ARCH-002 AC-1, but FR-ARCH-002 is in the set only through the @req on archive.
    const withoutMemberReq = edit(
      "    - `archive(id: string): void` — marks a task archived ← cli, worker @req FR-ARCH-002",
      "    - `archive(id: string): void` — marks a task archived ← cli, worker"
    );
    expect(parseLiteSds(text(withoutMemberReq), FILE).document.reqIds).toEqual(["FR-ARCH-001"]);
  });
});

describe("FR-NODE-209 AC-2 — the diagnostics", () => {
  it("FR-NODE-209 AC-2: the baseline document produces no diagnostic at all", () => {
    expect(all(BASE)).toEqual([]);
  });

  it("FR-NODE-209 AC-2: a missing lite section is an error naming the section", () => {
    for (const [removed, section] of [
      ["## Test Plan", "Test Plan"],
      ["## Acceptance Contracts", "Acceptance Contracts"],
      ["## Interfaces", "Interfaces"],
      ["### Files", "Files"]
    ] as const) {
      const found = structural(edit(removed, null)).filter((item) => item.code === "SDS-E060");
      expect(found.map((item) => item.message).join("\n"), `removing ${removed}`).toContain(section);
      expect(found.every((item) => item.severity === "error" && item.filePath === FILE)).toBe(true);
    }
  });

  it("FR-NODE-209 AC-2: a missing metadata field is reported with the lite sections", () => {
    const found = structural(edit("| Target | v1.0.0 |", null)).filter((item) => item.code === "SDS-E060");
    expect(found.map((item) => item.message).join("\n")).toContain("Target");
  });

  it("FR-NODE-209 AC-2: a file over the line cap is an error; one at the cap is not", () => {
    const filler = (count: number) => Array.from({ length: count }, (_, index) => `<!-- filler ${index} -->`);
    const atCap = [...BASE.slice(0, -1), ...filler(LITE_SDS_LINE_CAP - (BASE.length - 1))];
    expect(atCap.length).toBe(LITE_SDS_LINE_CAP);
    expect(codesOf(structural(atCap))).not.toContain("SDS-E061");
    const overCap = [...atCap, "<!-- one more -->"];
    const found = structural(overCap).filter((item) => item.code === "SDS-E061");
    expect(found).toHaveLength(1);
    expect(found[0]?.severity).toBe("error");
    expect(found[0]?.message).toContain(String(LITE_SDS_LINE_CAP));
  });

  it("FR-NODE-209 AC-2: a trailing newline is not counted as a line", () => {
    expect(LITE_SDS_LINE_CAP).toBe(100);
    const lines = [...BASE.slice(0, -1), ...Array.from({ length: LITE_SDS_LINE_CAP - (BASE.length - 1) }, () => "-")];
    expect(codesOf(structural(lines)).includes("SDS-E061")).toBe(false);
    expect(codesOf(parseLiteSds(`${text(lines)}\n`, FILE).diagnostics)).not.toContain("SDS-E061");
  });

  it("FR-NODE-209 AC-2: an @req that names no existing requirement is an error at its line", () => {
    const lines = edit("- `src/validate.ts` — argument validation", "- `src/validate.ts` — argument validation @req FR-ARCH-999"); // @req-lint: ignore
    const found = all(lines).filter((item) => item.code === "SDS-E062");
    expect(found.map(({ severity, line, message }) => ({ severity, line, cites: message.includes("FR-ARCH-999") }))).toEqual([
      { severity: "error", line: lineOf(lines, "@req FR-ARCH-999"), cites: true } // @req-lint: ignore
    ]);
  });

  it("FR-NODE-209 AC-2: an unresolved @req on a symbol line is reported at that line, once, not at its file", () => {
    const lines = edit(
      "  - `parseExpectedVersion(v: unknown): number` / `parsePatch(v: unknown): TaskPatch` — positive integer ← service",
      "  - `parseExpectedVersion(v: unknown): number` / `parsePatch(v: unknown): TaskPatch` — positive integer ← service @req FR-ARCH-998" // @req-lint: ignore
    );
    const found = all(lines).filter((item) => item.code === "SDS-E062");
    expect(found.map(({ line, requirementId }) => ({ line, requirementId }))).toEqual([{ line: lineOf(lines, "FR-ARCH-998"), requirementId: "FR-ARCH-998" }]);
  });

  it("FR-NODE-209 AC-2: a (REQ AC) that does not resolve is an error — unknown requirement, unknown AC, or no reference", () => {
    const cases = [
      "- SDS-AC-1 (FR-NOPE-001 AC-1): WHEN x THE SYSTEM SHALL y → `parseExpectedVersion`",
      "- SDS-AC-1 (FR-ARCH-001 AC-9): WHEN x THE SYSTEM SHALL y → `parseExpectedVersion`",
      "- SDS-AC-1: WHEN x THE SYSTEM SHALL y → `parseExpectedVersion`"
    ];
    for (const replacement of cases) {
      const lines = edit(BASE.find((line) => line.startsWith("- SDS-AC-1 ")) as string, replacement);
      const found = all(lines).filter((item) => item.code === "SDS-E063");
      expect(found.map((item) => [item.severity, item.line]), replacement).toEqual([["error", lineOf(lines, "- SDS-AC-1")]]);
    }
  });

  it("FR-NODE-209 AC-2: an SDS-AC without a Test Plan row naming a test file is an error", () => {
    for (const lines of [
      edit("| SDS-AC-2 | `test/service.test.ts` | archive twice |", null),
      edit("| SDS-AC-2 | `test/service.test.ts` | archive twice |", "| SDS-AC-2 | - | archive twice |")
    ]) {
      const found = structural(lines).filter((item) => item.code === "SDS-E064");
      expect(found.map((item) => [item.severity, item.message.includes("SDS-AC-2")])).toEqual([["error", true]]);
    }
  });

  it("FR-NODE-209 AC-2: a → symbol that no Interfaces line declares is an error", () => {
    const lines = edit(
      BASE.find((line) => line.startsWith("- SDS-AC-2 ")) as string,
      "- SDS-AC-2 (FR-ARCH-002 AC-1): WHEN a task is archived twice THE SYSTEM SHALL keep the first archive time → `archiveTwice`"
    );
    const found = structural(lines).filter((item) => item.code === "SDS-E065");
    expect(found.map((item) => [item.severity, item.line, item.message.includes("archiveTwice")])).toEqual([["error", lineOf(lines, "- SDS-AC-2"), true]]);
  });

  it("FR-NODE-209 AC-2: a member resolves by its qualified name and by its bare name", () => {
    const lines = edit(
      BASE.find((line) => line.startsWith("- SDS-AC-2 ")) as string,
      "- SDS-AC-2 (FR-ARCH-002 AC-1): WHEN a task is archived twice THE SYSTEM SHALL keep the first archive time → `archive`"
    );
    expect(codesOf(structural(lines))).not.toContain("SDS-E065");
  });

  it("FR-NODE-209 AC-2: a qualified → target naming a member its parent does not declare is an error", () => {
    const lines = edit(
      BASE.find((line) => line.startsWith("- SDS-AC-2 ")) as string,
      "- SDS-AC-2 (FR-ARCH-002 AC-1): WHEN a task is archived twice THE SYSTEM SHALL keep the first archive time → `TaskService.nope`"
    );
    const found = structural(lines).filter((item) => item.code === "SDS-E065");
    expect(found.map((item) => [item.severity, item.line, item.message.includes("TaskService.nope")])).toEqual([["error", lineOf(lines, "- SDS-AC-2"), true]]);
  });

  it("FR-NODE-209 AC-2: a malformed Depends line is an error", () => {
    for (const malformed of ["- cli -> service", "- {store, validate → recurrence}", "- cli →", "- cli → service → , store", "- cli → * → store"]) {
      const found = structural(edit("- cli → service → store, validate", malformed)).filter((item) => item.code === "SDS-E066");
      expect(found.map((item) => [item.severity, item.line]), malformed).toEqual([["error", lineOf(BASE, "- cli →")]]);
    }
  });

  it("FR-NODE-209 AC-2: a Files line with no path span, or a path that leaves the root, is an error", () => {
    for (const malformed of ["- src/service.ts — no backticks", "- `../outside.ts` — escapes", "- `/abs/path.ts` — absolute"]) {
      const lines = edit("- `src/validate.ts` — argument validation", malformed);
      expect(codesOf(structural(lines)), malformed).toContain("SDS-E067");
    }
  });

  it("FR-NODE-209 AC-2: an in-target requirement that no @req names is a warning; verified, discarded and other targets are not", () => {
    const requirements: LiteSdsRequirement[] = [
      ...REQUIREMENTS,
      { id: "FR-ARCH-003", target: "v1.0.0", status: "planned", acceptanceCriteria: [{ id: "AC-1" }] },
      { id: "FR-ARCH-004", target: "v1.0.0", status: "verified", acceptanceCriteria: [{ id: "AC-1" }] },
      { id: "FR-ARCH-005", target: "v1.0.0", status: "discarded", acceptanceCriteria: [{ id: "AC-1" }] },
      { id: "FR-ARCH-006", target: "v2.0.0", status: "planned", acceptanceCriteria: [{ id: "AC-1" }] }
    ];
    const found = all(BASE, requirements).filter((item) => item.code === "SDS-W068");
    expect(found.map(({ severity, requirementId }) => ({ severity, requirementId }))).toEqual([{ severity: "warning", requirementId: "FR-ARCH-003" }]);
  });

  it("FR-NODE-209 AC-2: the in-target check counts @req across every lite SDS of the target, so a split SDS is not reported", () => {
    const first = parseLiteSds(text(BASE), FILE).document;
    const second = parseLiteSds(
      text(edit("- `src/validate.ts` — argument validation", "- `src/validate.ts` — argument validation @req FR-ARCH-003")),
      "docs/sds/todo-service-2.sds.md"
    ).document;
    const requirements: LiteSdsRequirement[] = [...REQUIREMENTS, { id: "FR-ARCH-003", target: "v1.0.0", status: "planned", acceptanceCriteria: [{ id: "AC-1" }] }];
    expect(liteSdsCoverageDiagnostics([first], requirements).map((item) => item.requirementId)).toEqual(["FR-ARCH-003"]);
    expect(liteSdsCoverageDiagnostics([first, second], requirements)).toEqual([]);
  });

  it("FR-NODE-209 AC-1: reads ids whose scope segment starts with a digit or has several parts", () => {
    const lines = edit(
      BASE.find((line) => line.startsWith("- SDS-AC-1 ")) as string,
      "- SDS-AC-1 (FR-AUTH-2-001 AC-1): WHEN expectedVersion is not a positive integer THE SYSTEM SHALL throw VALIDATION → `parseExpectedVersion`"
    ).map((line) => (line === "- `src/validate.ts` — argument validation" ? "- `src/validate.ts` — argument validation @req FR-2FA-001" : line)); // @req-lint: ignore
    const requirements: LiteSdsRequirement[] = [
      ...REQUIREMENTS,
      { id: "FR-2FA-001", target: "v1.0.0", status: "planned", acceptanceCriteria: [{ id: "AC-1" }] },
      { id: "FR-AUTH-2-001", target: "v1.0.0", status: "verified", acceptanceCriteria: [{ id: "AC-1" }] }
    ];
    const parsed = parseLiteSds(text(lines), FILE);
    expect(parsed.document.reqIds).toEqual(["FR-2FA-001", "FR-ARCH-001", "FR-ARCH-002"]);
    expect(parsed.document.contracts[0]).toMatchObject({ requirementId: "FR-AUTH-2-001", acId: "AC-1" });
    expect(all(lines, requirements)).toEqual([]);
  });

  it("FR-NODE-209 AC-2: an ordered-list contract is read, and a contract line in no list form is an error", () => {
    const numbered = edit(BASE.find((line) => line.startsWith("- SDS-AC-1 ")) as string, (BASE.find((line) => line.startsWith("- SDS-AC-1 ")) as string).replace(/^- /, "1. "));
    expect(parseLiteSds(text(numbered), FILE).document.contracts.map((contract) => contract.id)).toEqual(["SDS-AC-1", "SDS-AC-2"]);
    expect(structural(numbered)).toEqual([]);
    const prose = edit(BASE.find((line) => line.startsWith("- SDS-AC-1 ")) as string, (BASE.find((line) => line.startsWith("- SDS-AC-1 ")) as string).replace(/^- /, ""));
    // The contract is still read, so its Test Plan row and its → target keep their meaning.
    expect(structural(prose).map((item) => [item.code, item.line])).toEqual([["SDS-E063", lineOf(prose, "SDS-AC-1 (FR-ARCH-001")]]);
    expect(parseLiteSds(text(prose), FILE).document.contracts.map((contract) => contract.id)).toEqual(["SDS-AC-1", "SDS-AC-2"]);
  });

  it("FR-NODE-209 AC-1: a contract the grammar cannot read is still declared, so no SDS-AC drops out of the Test Plan check", () => {
    const first = BASE.find((line) => line.startsWith("- SDS-AC-1 ")) as string;
    for (const variant of [
      "- **SDS-AC-1** (FR-ARCH-001 AC-2): WHEN x THE SYSTEM SHALL y → `parseExpectedVersion`",
      "- SDS-AC-1 — WHEN x THE SYSTEM SHALL y",
      "SDS-AC-1: WHEN x THE SYSTEM SHALL y."
    ]) {
      const lines = edit(first, variant);
      const parsed = parseLiteSds(text(lines), FILE);
      expect(parsed.document.contracts.map((contract) => contract.id), variant).toEqual(["SDS-AC-1", "SDS-AC-2"]);
    }
    const bold = parseLiteSds(text(edit(first, "- **SDS-AC-1** (FR-ARCH-001 AC-2): WHEN x THE SYSTEM SHALL y → `parseExpectedVersion`")), FILE);
    expect(bold.diagnostics).toEqual([]);
    expect(bold.document.contracts[0]).toMatchObject({ requirementId: "FR-ARCH-001", acId: "AC-2", targets: ["parseExpectedVersion"] });
    const dashed = parseLiteSds(text(edit(first, "- SDS-AC-1 — WHEN x THE SYSTEM SHALL y")), FILE);
    expect(dashed.diagnostics.map((item) => item.code)).toEqual(["SDS-E063"]);
  });

  it("FR-NODE-209 AC-4: a Files list indented as a whole is read, and a symbol with no file above it is an error", () => {
    const shifted = BASE.map((line, index) => {
      const files = BASE.indexOf("### Files");
      const contracts = BASE.indexOf("## Acceptance Contracts");
      return index > files && index < contracts && line.trim() !== "" ? `  ${line}` : line;
    });
    const parsed = parseLiteSds(text(shifted), FILE);
    expect(parsed.document.files.map((file) => file.path)).toEqual(["src/service.ts", "src/validate.ts"]);
    expect(parsed.diagnostics).toEqual([]);
    const orphan = edit("### Files", ["### Files", "", "  - `helper(): void` — no file above it"]);
    expect(structural(orphan).map((item) => [item.code, item.line])).toEqual([["SDS-E067", lineOf(orphan, "helper(): void")]]);
  });

  it("FR-NODE-209 AC-4: an SDS-AC mentioned after @req is not read as a requirement id", () => {
    const lines = edit(
      "  - `createTask(input: CreateTaskInput): Task` — creates a task at version 1 ← cli",
      "  - `createTask(input: CreateTaskInput): Task` — creates a task at version 1 ← cli @req FR-ARCH-001 (see SDS-AC-2)"
    );
    expect(parseLiteSds(text(lines), FILE).document.reqIds).toEqual(["FR-ARCH-001", "FR-ARCH-002"]);
    expect(all(lines)).toEqual([]);
  });

  it("FR-NODE-209 AC-2: a requirement id carried by both a body and a step requirement resolves to the body one", () => {
    const lines = edit(
      BASE.find((line) => line.startsWith("- SDS-AC-1 ")) as string,
      "- SDS-AC-1 (FR-ARCH-001 AC-2): WHEN expectedVersion is not a positive integer THE SYSTEM SHALL throw VALIDATION → `parseExpectedVersion`"
    );
    // The step copy of FR-ARCH-001 carries AC-1 only; listed after the body record, as the workspace lists them.
    const shadowed: LiteSdsRequirement[] = [...REQUIREMENTS, { id: "FR-ARCH-001", target: "v1.0.0", status: "planned", acceptanceCriteria: [{ id: "AC-1" }] }];
    expect(liteSdsReferenceDiagnostics(parseLiteSds(text(lines), FILE).document, shadowed)).toEqual([]);
  });

  it("FR-NODE-209 AC-2: a duplicated SDS-AC id is an error", () => {
    const lines = edit("- SDS-AC-2 (FR-ARCH-002 AC-1): WHEN a task is archived twice THE SYSTEM SHALL keep the first archive time → `TaskService.archive`, `createTask`", [
      "- SDS-AC-2 (FR-ARCH-002 AC-1): WHEN a task is archived twice THE SYSTEM SHALL keep the first archive time → `TaskService.archive`, `createTask`",
      "- SDS-AC-2 (FR-ARCH-002 AC-1): WHEN a task is archived again THE SYSTEM SHALL keep the first archive time → `createTask`"
    ]);
    expect(structural(lines).map((item) => [item.code, item.line])).toEqual([["SDS-E063", lineOf(lines, "archived again")]]);
  });

  it("FR-NODE-209 AC-2: a Test Plan row for a contract that does not exist is an error", () => {
    const lines = edit("| SDS-AC-2 | `test/service.test.ts` | archive twice |", ["| SDS-AC-2 | `test/service.test.ts` | archive twice |", "| SDS-AC-9 | `test/ghost.test.ts` | nothing |"]);
    expect(structural(lines).map((item) => [item.code, item.line, item.message.includes("SDS-AC-9")])).toEqual([["SDS-E064", lineOf(lines, "SDS-AC-9"), true]]);
  });

  it("FR-NODE-209 AC-4: a Test Plan cell keeps every file it names, ticked or not, and an invalid one is named as invalid", () => {
    const mixed = edit("| SDS-AC-2 | `test/service.test.ts` | archive twice |", "| SDS-AC-2 | `test/service.test.ts`, test/archive.test.ts | archive twice |");
    expect(parseLiteSds(text(mixed), FILE).document.writeSet).toContain("test/archive.test.ts");
    const invalid = edit("| SDS-AC-2 | `test/service.test.ts` | archive twice |", "| SDS-AC-2 | `../outside.test.ts` | archive twice |");
    const found = structural(invalid).filter((item) => item.code === "SDS-E064");
    expect(found.map((item) => item.message)).toEqual([expect.stringContaining("invalid")]);
  });

  it("FR-NODE-209 AC-4: a Files path is normalised — no trailing slash, no ./ segment", () => {
    const lines = edit("- `src/validate.ts` — argument validation", "- `./src/dir/./` — a directory the work creates");
    expect(parseLiteSds(text(lines), FILE).document.writeSet).toContain("src/dir");
  });

  it("FR-NODE-209 AC-1: lines inside a fenced code block are not read as structure", () => {
    const lines = edit("### Files", ["### Files", "", "```markdown", "## Test Plan", "- `fake/path.ts` — inside a fence", "```"]);
    const parsed = parseLiteSds(text(lines), FILE);
    expect(parsed.document.files.map((file) => file.path)).toEqual(["src/service.ts", "src/validate.ts"]);
    expect(parsed.diagnostics).toEqual([]);
  });

  it("FR-NODE-209 AC-2: every code the checks emit is declared once with its severity", () => {
    const declared = Object.entries(LITE_SDS_DIAGNOSTICS).map(([code, definition]) => [code, definition.severity]);
    expect(declared).toEqual([
      ["SDS-E060", "error"],
      ["SDS-E061", "error"],
      ["SDS-E062", "error"],
      ["SDS-E063", "error"],
      ["SDS-E064", "error"],
      ["SDS-E065", "error"],
      ["SDS-E066", "error"],
      ["SDS-E067", "error"],
      ["SDS-W068", "warning"],
      ["SDS-W069", "warning"],
      ["SDS-E070", "error"]
    ]);
  });
});
