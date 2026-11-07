import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it, vi } from "vitest";
import { main } from "../../src/cli/index.js";
import { resolveProjectRoot } from "../../src/core/project-root.js";
import { parseWorkspace } from "../../src/core/parser/workspace-parser.js";
import { validateWorkspace } from "../../src/core/validator/validate-workspace.js";
import { addChangeNote } from "../../src/core/mutation/add-change-note.js";
import { addTraceLink, setSupersede } from "../../src/core/mutation/add-trace.js";
import { addVerificationEvidence } from "../../src/core/mutation/add-evidence.js";
import { updateStatus } from "../../src/core/mutation/update-status.js";
import { updateStability } from "../../src/core/mutation/update-stability.js";
import { expireAcceptanceCriterion } from "../../src/core/mutation/expire-ac.js";
import { retarget } from "../../src/core/mutation/retarget.js";
import { appendAcceptanceCriterion, editAcceptanceCriteria } from "../../src/core/mutation/check-ac.js";
import { replaceAcceptanceCriteria, editRequirementTableRows } from "../../src/core/mutation/edit-requirement.js";
import { createMcpServer, createSdkServer } from "../../src/mcp/server.js";
import type { ProjectRoot, RequirementRecord } from "../../src/core/types.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

// verify-v536-c-r1 — bundle C (FR-MCP-049, FR-MCP-072, FR-NODE-041 AC-4/AC-5, FR-NODE-278, FR-NODE-259).
// Independent cases: blocks in the middle of a file, several blocks per file, CRLF files, an OG-shaped
// block, reordered/extra/missing columns, atomicity of multi-op mutations, MCP over the SDK protocol.

vi.setConfig({ testTimeout: 120_000 });

const SPEC = path.join("docs", "spec", "10.product-architecture.srs.md");

const META = (id: string, status = "planned"): string[] => [
  `### ${id} — Block ${id}`,
  "",
  "| Field | Value |",
  "| --- | --- |",
  "| Type | functional |",
  "| Target | v1.0.0 |",
  `| Status | ${status} |`,
  "| Priority | high |",
  "| Tags | fixture |",
  "| Risk | low |",
  "| Stability | stable |",
  "| Verification Method | test |",
  "| GitHub Issue | - |",
  "| Related Docs | - |",
  "",
  "#### Requirement",
  "",
  `SpecKiwi must mutate ${id}.`,
  "",
  "#### Rationale",
  "",
  "Mutation tests need a target.",
  "",
  "#### Acceptance Criteria",
  "",
  "- [x] AC-1: The status can be updated.",
  "- [ ] AC-2: Evidence can be added.",
  "- [ ] AC-3: A third one.",
  ""
];

/** No Verification Evidence, Trace Links or Change Notes section at all. */
const NO_SECTIONS = (id: string): string[] => [...META(id), "#### Implementation Notes", "", "- src/core/mutation", ""];
/** All three headings present, no table under any of them. */
const HEADINGS_ONLY = (id: string): string[] => [
  ...META(id),
  "#### Verification Evidence",
  "",
  "#### Trace Links",
  "",
  "#### Implementation Notes",
  "",
  "- -",
  "",
  "#### Change Notes",
  ""
];
/** OG NFR-HTTP-005 shape: Requirement / Rationale / Acceptance Criteria / Verification Evidence only. */
const OG_SHAPE = (id: string): string[] => [
  ...META(id),
  "#### Verification Evidence",
  "",
  "| Evidence ID | Type | Reference | Covers | Notes |",
  "| --- | --- | --- | --- | --- |",
  "| VE-1 | test | test/a.test.ts | all | - |",
  ""
];

const HEAD = [
  "# Product Architecture",
  "",
  "| Field | Value |",
  "|---|---|",
  "| Document Type | scope_srs |",
  "| Scope | ARCH |",
  "| Scope Name | Product Architecture |",
  "",
  "## 1. Scope Overview",
  "",
  "Mutation architecture scope.",
  "",
  "## 2. Scope Boundaries",
  "",
  "### In Scope",
  "",
  "- Markdown requirements",
  "",
  "### Out of Scope",
  "",
  "- External database",
  "",
  "## 3. Assumptions and Constraints",
  "",
  "- None",
  "",
  "## 4. Requirements",
  ""
];
const TAIL = ["## 5. Cross-scope Dependencies", "", "- None", ""];

async function workspace(blocks: string[][], options: { tail?: boolean; crlf?: boolean } = {}): Promise<{ rootPath: string; root: ProjectRoot; specPath: string }> {
  const rootPath = await copyFixtureWorkspace("mutation-target");
  const specPath = path.join(rootPath, SPEC);
  const lines = [...HEAD, ...blocks.flat(), ...(options.tail === false ? [] : TAIL)];
  const text = lines.join("\n");
  await writeFile(specPath, options.crlf ? text.replace(/\n/g, "\r\n") : text, "utf8");
  return { rootPath, root: await resolveProjectRoot(rootPath), specPath };
}

async function records(root: ProjectRoot): Promise<Map<string, RequirementRecord>> {
  return new Map((await parseWorkspace(root)).records.map((record) => [record.id, record]));
}

async function errors(root: ProjectRoot): Promise<string[]> {
  const parsed = await parseWorkspace(root);
  return [...parsed.diagnostics, ...validateWorkspace(parsed).diagnostics]
    .filter((item) => item.severity === "error")
    .map((item) => `${item.code}:${item.requirementId ?? ""}:${item.message}`);
}

/** The comparable content of a record, without line numbers. */
function content(record: RequirementRecord | undefined): unknown {
  if (!record) return undefined;
  const strip = (rows: Array<Record<string, unknown>>): unknown[] =>
    rows.map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => key !== "line")));
  return {
    status: record.status,
    target: record.metadata.Target,
    ac: strip(record.acceptanceCriteria as unknown as Array<Record<string, unknown>>),
    ve: strip(record.verificationEvidence as unknown as Array<Record<string, unknown>>),
    tl: strip(record.traceLinks as unknown as Array<Record<string, unknown>>),
    cn: strip(record.changeNotes as unknown as Array<Record<string, unknown>>)
  };
}

async function cli(root: string, args: string[]): Promise<{ code: number; stdout: string }> {
  const streams = { stdout: new PassThrough(), stderr: new PassThrough() };
  const code = await main(["--root", root, ...args], streams);
  return { code, stdout: streams.stdout.read()?.toString() ?? "" };
}

async function show(root: string, id: string): Promise<{ traceLinks: unknown[]; changeNotes: unknown[]; verificationEvidence: unknown[] }> {
  const out = await cli(root, ["show", id, "--json"]);
  expect(out.code, out.stdout).toBe(0);
  const parsed = JSON.parse(out.stdout) as Record<string, unknown>;
  const body = (parsed.value ?? parsed) as { traceLinks: unknown[]; changeNotes: unknown[]; verificationEvidence: unknown[] };
  return body;
}

interface RowCase {
  name: string;
  run: (root: ProjectRoot, id: string) => Promise<{ ok: boolean; error?: { message: string } }>;
  read: (record: RequirementRecord) => unknown[];
}

const ROW_CASES: RowCase[] = [
  { name: "add-trace", run: (root, id) => addTraceLink(root, { id, type: "Issue", reference: "https://example.com/1", relation: "tracks" }), read: (r) => r.traceLinks },
  { name: "add-change-note", run: (root, id) => addChangeNote(root, { id, change: "Reworded AC-2", reason: "repro" }), read: (r) => r.changeNotes },
  { name: "add-evidence", run: (root, id) => addVerificationEvidence(root, { id, type: "test", reference: "docs/spec/00.index.md", covers: "AC-1" }), read: (r) => r.verificationEvidence },
  { name: "update-status reason", run: (root, id) => updateStatus(root, { id, status: "in_progress", reason: "start" }), read: (r) => r.changeNotes },
  { name: "update-stability reason", run: (root, id) => updateStability(root, { id, stability: "evolving", reason: "reopened" }), read: (r) => r.changeNotes },
  { name: "expire-ac", run: (root, id) => expireAcceptanceCriterion(root, { id, acId: "AC-2", reason: "obsolete" }), read: (r) => r.changeNotes },
  { name: "retarget", run: (root, id) => retarget(root, { ids: [id], toTarget: "v1.1.0", reason: "next release", dryRun: false }), read: (r) => r.changeNotes }
];

describe("FR-NODE-278 — row writers on a block in the middle of a file", () => {
  for (const shape of [
    { label: "no sections", make: NO_SECTIONS },
    { label: "headings only", make: HEADINGS_ONLY },
    { label: "OG shape", make: OG_SHAPE }
  ]) {
    for (const rowCase of ROW_CASES) {
      it(`${shape.label} / ${rowCase.name}: succeeds, show reads one new row, neighbours are untouched, validate has no error`, async () => {
        const { rootPath, root } = await workspace([NO_SECTIONS("FR-ARCH-001"), shape.make("FR-ARCH-002"), HEADINGS_ONLY("FR-ARCH-003")]);
        const before = await records(root);
        const baseErrors = await errors(root);
        const result = await rowCase.run(root, "FR-ARCH-002");
        expect(result.ok, result.error?.message).toBe(true);
        const after = await records(root);
        const target = after.get("FR-ARCH-002");
        expect(target).toBeDefined();
        expect(rowCase.read(target as RequirementRecord).length).toBe(rowCase.read(before.get("FR-ARCH-002") as RequirementRecord).length + 1);
        expect(content(after.get("FR-ARCH-001"))).toEqual(content(before.get("FR-ARCH-001")));
        expect(content(after.get("FR-ARCH-003"))).toEqual(content(before.get("FR-ARCH-003")));
        expect(await errors(root)).toEqual(baseErrors);
        const shown = await show(rootPath, "FR-ARCH-002");
        expect(shown.traceLinks.length + shown.changeNotes.length + shown.verificationEvidence.length).toBeGreaterThan(0);
      });
    }
  }

  it("a block last in the file with no trailing scope section: add-change-note then add-trace both read back", async () => {
    const { root } = await workspace([NO_SECTIONS("FR-ARCH-001"), OG_SHAPE("FR-ARCH-002")], { tail: false });
    expect((await addChangeNote(root, { id: "FR-ARCH-002", change: "c", reason: "r" })).ok).toBe(true);
    expect((await addTraceLink(root, { id: "FR-ARCH-002", type: "Issue", reference: "https://example.com/2", relation: "tracks" })).ok).toBe(true);
    const record = (await records(root)).get("FR-ARCH-002") as RequirementRecord;
    expect(record.changeNotes).toHaveLength(1);
    expect(record.traceLinks).toHaveLength(1);
    const order = Object.entries(record.sectionLines ?? {}).sort(([, a], [, b]) => a - b).map(([name]) => name);
    expect(order.indexOf("Trace Links")).toBeLessThan(order.indexOf("Change Notes"));
    expect(await errors(root)).toEqual([]);
  });

  it("retarget of two blocks in the same file, both without Change Notes, writes a readable row in each", async () => {
    const { root } = await workspace([NO_SECTIONS("FR-ARCH-001"), NO_SECTIONS("FR-ARCH-002"), OG_SHAPE("FR-ARCH-003")]);
    const result = await retarget(root, { ids: ["FR-ARCH-001", "FR-ARCH-002", "FR-ARCH-003"], toTarget: "v1.1.0", reason: "next", dryRun: false });
    expect(result.ok, result.error?.message).toBe(true);
    const after = await records(root);
    for (const id of ["FR-ARCH-001", "FR-ARCH-002", "FR-ARCH-003"]) {
      expect(after.get(id)?.metadata.Target, id).toBe("v1.1.0");
      expect(after.get(id)?.changeNotes, id).toEqual([expect.objectContaining({ change: "Target v1.0.0 -> v1.1.0", reason: "next" })]);
    }
    expect(await errors(root)).toEqual([]);
  });

  it("CRLF file: creating a missing Change Notes section keeps the file's line endings uniform", async () => {
    const { root, specPath } = await workspace([NO_SECTIONS("FR-ARCH-001"), NO_SECTIONS("FR-ARCH-002")], { crlf: true });
    expect((await addChangeNote(root, { id: "FR-ARCH-001", change: "c", reason: "r" })).ok).toBe(true);
    expect((await addTraceLink(root, { id: "FR-ARCH-001", type: "Issue", reference: "https://example.com/3", relation: "tracks" })).ok).toBe(true);
    const text = await readFile(specPath, "utf8");
    expect(text.match(/(?<!\r)\n/g) ?? []).toEqual([]);
    const record = (await records(root)).get("FR-ARCH-001") as RequirementRecord;
    expect(record.changeNotes).toHaveLength(1);
    expect(record.traceLinks).toHaveLength(1);
  });

  it("atomicity: update-status with a reason on a Change Notes section that starts with prose writes nothing", async () => {
    const prose = [...META("FR-ARCH-001"), "#### Change Notes", "", "Some prose first.", "", "| Date | Change | Reason |", "| --- | --- | --- |", ""];
    const { root, specPath } = await workspace([prose, NO_SECTIONS("FR-ARCH-002")]);
    const before = await readFile(specPath, "utf8");
    const result = await updateStatus(root, { id: "FR-ARCH-001", status: "in_progress", reason: "start" });
    expect(result.ok).toBe(false);
    expect(await readFile(specPath, "utf8")).toBe(before);
  });

  it("atomicity: retarget refused for one id leaves the other id's block untouched", async () => {
    const prose = [...META("FR-ARCH-002"), "#### Change Notes", "", "Some prose first.", ""];
    const { root, specPath } = await workspace([NO_SECTIONS("FR-ARCH-001"), prose]);
    const before = await readFile(specPath, "utf8");
    const result = await retarget(root, { ids: ["FR-ARCH-001", "FR-ARCH-002"], toTarget: "v1.1.0", reason: "next", dryRun: false });
    expect(result.ok).toBe(false);
    expect(await readFile(specPath, "utf8")).toBe(before);
  });

  it("supersede with syncTrace on a block without Trace Links writes readable Requirement rows", async () => {
    const { root } = await workspace([NO_SECTIONS("FR-ARCH-001"), OG_SHAPE("FR-ARCH-002")]);
    const result = await setSupersede(root, { id: "FR-ARCH-002", supersedes: "FR-ARCH-001", syncTrace: true });
    expect(result.ok, result.error?.message).toBe(true);
    const record = (await records(root)).get("FR-ARCH-002") as RequirementRecord;
    expect(record.traceLinks).toEqual([expect.objectContaining({ type: "Requirement", reference: "FR-ARCH-001" })]);
  });
});

describe("FR-NODE-259 — values under the table's own header", () => {
  const reordered = (id: string): string[] => [
    ...META(id),
    "#### Verification Evidence",
    "",
    "| Covers | Evidence ID | Notes | Type | Reference |",
    "| --- | --- | --- | --- | --- |",
    "| all | VE-1 | n1 | test | test/a.test.ts |",
    "",
    "#### Trace Links",
    "",
    "| Relation | Notes | Reference | Type |",
    "| --- | --- | --- | --- |",
    "| tracks | - | https://example.com/0 | Issue |",
    "",
    "#### Change Notes",
    "",
    "| Reason | Date | Change | Author |",
    "| --- | --- | --- | --- |",
    "| Fixture | 2026-05-08 | Created | me |",
    ""
  ];

  for (const rowCase of ROW_CASES) {
    it(`${rowCase.name}: every value of the new row reads back under its own column; the extra column gets -`, async () => {
      const { root, specPath } = await workspace([reordered("FR-ARCH-001"), NO_SECTIONS("FR-ARCH-002")]);
      const result = await rowCase.run(root, "FR-ARCH-001");
      expect(result.ok, result.error?.message).toBe(true);
      const record = (await records(root)).get("FR-ARCH-001") as RequirementRecord;
      const text = await readFile(specPath, "utf8");
      if (rowCase.name === "add-trace") {
        expect(record.traceLinks.at(-1)).toEqual(expect.objectContaining({ type: "Issue", reference: "https://example.com/1", relation: "tracks" }));
      } else if (rowCase.name === "add-evidence") {
        expect(record.verificationEvidence.at(-1)).toEqual(expect.objectContaining({ id: "VE-2", type: "test", reference: "docs/spec/00.index.md", covers: "AC-1" }));
      } else {
        const note = record.changeNotes.at(-1);
        expect(note?.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(note?.change.length).toBeGreaterThan(0);
        expect(text).toMatch(/\n\| [^|]+ \| \d{4}-\d{2}-\d{2} \| [^|]+ \| - \|\n/);
      }
    });
  }

  it("edit_requirement_table_rows on a reordered Trace Links row keeps every value under its header", async () => {
    const { root } = await workspace([reordered("FR-ARCH-001")]);
    const result = await editRequirementTableRows(root, { id: "FR-ARCH-001", section: "trace_links", operations: [{ kind: "update", rowIndex: 0, values: { relation: "implements" } }] });
    expect(result.ok, result.error?.message).toBe(true);
    const record = (await records(root)).get("FR-ARCH-001") as RequirementRecord;
    expect(record.traceLinks[0]).toEqual(expect.objectContaining({ type: "Issue", reference: "https://example.com/0", relation: "implements" }));
  });

  it("a table lacking a column the mutation fills is refused, naming it, and the file is byte-identical", async () => {
    const lacking = [...META("FR-ARCH-001"), "#### Change Notes", "", "| Date | Change |", "| --- | --- |", "| 2026-05-08 | Created |", ""];
    const { root, specPath } = await workspace([lacking]);
    const before = await readFile(specPath, "utf8");
    const result = await addChangeNote(root, { id: "FR-ARCH-001", change: "c", reason: "r" });
    expect(result.ok).toBe(false);
    expect(result.error?.message).toContain("Reason");
    expect(await readFile(specPath, "utf8")).toBe(before);
  });
});

describe("FR-MCP-072 / FR-NODE-041 — single-criterion tools", () => {
  it("append numbers above an expired top criterion and keeps checked states", async () => {
    const { root } = await workspace([NO_SECTIONS("FR-ARCH-001"), NO_SECTIONS("FR-ARCH-002")]);
    expect((await expireAcceptanceCriterion(root, { id: "FR-ARCH-001", acId: "AC-3", reason: "gone" })).ok).toBe(true);
    const result = await appendAcceptanceCriterion(root, { id: "FR-ARCH-001", text: "Fourth." });
    expect(result.ok, result.error?.message).toBe(true);
    const record = (await records(root)).get("FR-ARCH-001") as RequirementRecord;
    expect(record.acceptanceCriteria.map((c) => [c.id, c.checked])).toEqual([["AC-1", true], ["AC-2", false], ["AC-4", false]]);
    expect(await errors(root)).toEqual([]);
  });

  // OG docs/spec/17.workflow.srs.md FR-WORKFLOW-077 AC-13 (develop 9ce0af739e) carries nine nested
  // `  - ` detail bullets under its last criterion; validate reports nothing for that shape.
  it("append after a last criterion with nested detail bullets keeps those bullets under their own criterion", async () => {
    const nested = [
      ...META("FR-ARCH-001").slice(0, -1),
      "  - detail one of AC-3",
      "  - detail two of AC-3",
      ""
    ];
    const { root, specPath } = await workspace([nested, NO_SECTIONS("FR-ARCH-002")]);
    expect(await errors(root)).toEqual([]);
    const result = await appendAcceptanceCriterion(root, { id: "FR-ARCH-001", text: "Fourth." });
    expect(result.ok, result.error?.message).toBe(true);
    const lines = (await readFile(specPath, "utf8")).split("\n");
    const ac3 = lines.indexOf("- [ ] AC-3: A third one.");
    expect(lines.slice(ac3, ac3 + 4)).toEqual(["- [ ] AC-3: A third one.", "  - detail one of AC-3", "  - detail two of AC-3", "- [ ] AC-4: Fourth."]);
  });

  it("append numbers above AC-10 numerically, not lexically", async () => {
    const many = [...META("FR-ARCH-001").slice(0, -4), ...Array.from({ length: 10 }, (_, i) => `- [ ] AC-${i + 1}: c${i + 1}.`), ""];
    const { root } = await workspace([many, NO_SECTIONS("FR-ARCH-002")]);
    const result = (await appendAcceptanceCriterion(root, { id: "FR-ARCH-001", text: "Eleventh." })) as { ok: boolean; value?: { acId?: string } };
    expect(result.ok).toBe(true);
    expect(result.value?.acId).toBe("AC-11");
  });

  for (const op of ["edit", "append"] as const) {
    it(`${op}: 16384 code units accepted and read back whole; 16385 refused with USAGE and no write`, async () => {
      const { root, specPath } = await workspace([NO_SECTIONS("FR-ARCH-001"), NO_SECTIONS("FR-ARCH-002")]);
      const call = (text: string) =>
        op === "edit" ? editAcceptanceCriteria(root, { id: "FR-ARCH-001", acId: "AC-2", text }) : appendAcceptanceCriterion(root, { id: "FR-ARCH-001", text });
      const before = await readFile(specPath, "utf8");
      const over = await call("y".repeat(16385));
      expect(over.ok).toBe(false);
      expect(over.error?.code).toBe("USAGE");
      expect(await readFile(specPath, "utf8")).toBe(before);
      const exact = await call("x".repeat(16384));
      expect(exact.ok, exact.error?.message).toBe(true);
      const record = (await records(root)).get("FR-ARCH-001") as RequirementRecord;
      expect(record.acceptanceCriteria.some((c) => c.text === "x".repeat(16384))).toBe(true);
      expect(await errors(root)).toEqual([]);
    });
  }

  it("verified block: edit and append give exactly replace_acceptance_criteria's refusal and write nothing", async () => {
    const { root, specPath } = await workspace([META("FR-ARCH-001", "verified")]);
    const before = await readFile(specPath, "utf8");
    const replace = await replaceAcceptanceCriteria(root, { id: "FR-ARCH-001", items: [{ text: "a" }] });
    const edit = await editAcceptanceCriteria(root, { id: "FR-ARCH-001", acId: "AC-2", text: "b" });
    const append = await appendAcceptanceCriterion(root, { id: "FR-ARCH-001", text: "c" });
    expect(replace.ok).toBe(false);
    expect({ code: edit.error?.code, message: edit.error?.message }).toEqual({ code: replace.error?.code, message: replace.error?.message });
    expect({ code: append.error?.code, message: append.error?.message }).toEqual({ code: replace.error?.code, message: replace.error?.message });
    expect(await readFile(specPath, "utf8")).toBe(before);
  });

  it("CLI add-change-note without --date stamps the local date (default moved into the core)", async () => {
    const { rootPath, root } = await workspace([NO_SECTIONS("FR-ARCH-001")]);
    const out = await cli(rootPath, ["add-change-note", "FR-ARCH-001", "--change", "Via CLI", "--reason", "no date", "--json"]);
    expect(out.code, out.stdout).toBe(0);
    const now = new Date();
    const local = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    expect((await records(root)).get("FR-ARCH-001")?.changeNotes).toEqual([expect.objectContaining({ date: local, change: "Via CLI", reason: "no date" })]);
  });

  it("CLI append-ac --json appends and show reads it", async () => {
    const { rootPath, root } = await workspace([NO_SECTIONS("FR-ARCH-001")]);
    const out = await cli(rootPath, ["append-ac", "FR-ARCH-001", "--text", "Via CLI.", "--json"]);
    expect(out.code, out.stdout).toBe(0);
    const record = (await records(root)).get("FR-ARCH-001") as RequirementRecord;
    expect(record.acceptanceCriteria.at(-1)).toEqual(expect.objectContaining({ id: "AC-4", text: "Via CLI.", checked: false }));
  });
});

describe("FR-MCP-049 / FR-MCP-072 AC-3 — the four new MCP tools over the SDK protocol", () => {
  async function client(root: string): Promise<Client> {
    const sdk = createSdkServer(createMcpServer({ root, rootSource: "server-cwd-discovery" }));
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await sdk.connect(serverTransport);
    const c = new Client({ name: "verify-v536-c", version: "1.0.0" }, { capabilities: {} });
    await c.connect(clientTransport);
    return c;
  }
  function payload(result: unknown): { ok?: boolean; error?: { code?: string } } {
    const content = (result as { content?: Array<{ text?: string }> }).content ?? [];
    try {
      return JSON.parse(content[0]?.text ?? "{}") as { ok?: boolean; error?: { code?: string } };
    } catch {
      return { ok: false, error: { code: `non-json: ${content[0]?.text ?? ""}` } };
    }
  }
  async function holdLock(root: string): Promise<void> {
    await mkdir(path.join(root, "kiwi"), { recursive: true });
    await writeFile(
      path.join(root, "kiwi", ".srs.lock"),
      `${JSON.stringify({ schemaVersion: "1.0.0", owner: "another-session", operation: "add_requirement", requestId: "held", acquiredAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 600_000).toISOString() })}\n`,
      "utf8"
    );
  }
  const CALLS: Array<{ name: string; args: Record<string, unknown> }> = [
    { name: "add_related_doc", args: { id: "FR-ARCH-001", link: "docs/x.md" } },
    { name: "add_change_note", args: { id: "FR-ARCH-001", change: "c", reason: "r" } },
    { name: "edit_acceptance_criterion", args: { id: "FR-ARCH-001", acId: "AC-2", text: "reworded" } },
    { name: "append_acceptance_criterion", args: { id: "FR-ARCH-001", text: "new" } }
  ];

  for (const call of CALLS) {
    it(`${call.name}: refused under a held lock, written with ignoreLock, dryRun writes nothing, an id array is refused`, async () => {
      const { rootPath, specPath } = await workspace([NO_SECTIONS("FR-ARCH-001")]);
      const c = await client(rootPath);
      try {
        const before = await readFile(specPath, "utf8");
        const dry = payload(await c.callTool({ name: call.name, arguments: { ...call.args, dryRun: true } }));
        expect(dry.ok, JSON.stringify(dry)).toBe(true);
        expect(await readFile(specPath, "utf8")).toBe(before);

        const arrayId = await c.callTool({ name: call.name, arguments: { ...call.args, id: ["FR-ARCH-001"] } });
        expect((arrayId as { isError?: boolean }).isError === true || payload(arrayId).ok === false).toBe(true);
        expect(await readFile(specPath, "utf8")).toBe(before);

        await holdLock(rootPath);
        const locked = payload(await c.callTool({ name: call.name, arguments: call.args }));
        expect(locked.ok).toBe(false);
        expect(await readFile(specPath, "utf8")).toBe(before);

        const forced = payload(await c.callTool({ name: call.name, arguments: { ...call.args, ignoreLock: true } }));
        expect(forced.ok, JSON.stringify(forced)).toBe(true);
        expect(await readFile(specPath, "utf8")).not.toBe(before);
      } finally {
        await c.close();
      }
    });
  }

  it("add_change_note over the protocol on a block without Change Notes: today's local date, readable row", async () => {
    const { rootPath, root } = await workspace([NO_SECTIONS("FR-ARCH-001"), NO_SECTIONS("FR-ARCH-002")]);
    const c = await client(rootPath);
    try {
      const answer = payload(await c.callTool({ name: "add_change_note", arguments: { id: "FR-ARCH-001", change: "Reworded AC-2", reason: "og" } }));
      expect(answer.ok, JSON.stringify(answer)).toBe(true);
      const bad = await c.callTool({ name: "add_change_note", arguments: { id: "FR-ARCH-001", change: "x", reason: "y", date: "2026/11/08" } });
      expect((bad as { isError?: boolean }).isError === true || payload(bad).ok === false).toBe(true);
    } finally {
      await c.close();
    }
    const now = new Date();
    const local = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const record = (await records(root)).get("FR-ARCH-001") as RequirementRecord;
    expect(record.changeNotes).toEqual([expect.objectContaining({ date: local, change: "Reworded AC-2", reason: "og" })]);
  });
});
