import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterAll, describe, expect, it, vi } from "vitest";
import { ORCHESTRATE_TOOL_BINDINGS } from "../../../src/cli/commands/orchestrate.js";
import { main } from "../../../src/cli/index.js";
import {
  assertRequirementsReady,
  parseRequirementSnapshot,
  RequirementNotReadyError,
  type NotReadyRequirement,
  type SnapshotPayload
} from "../../../src/core/orchestrator/readiness.js";
import { createMcpServer } from "../../../src/mcp/server.js";
import { cleanupFixtures, gitWorkspaceRepo, rawGit } from "../../mcp/support/workspace-root-fixture.js";
import { content, mcpPayload, record } from "./support/readiness-fixture.js";

// @req FR-NODE-321 — a downstream session (2026-11-21) built the readiness snapshot of its product
// target only, so a dependency in another target was absent and refused with no cause; built from
// the whole repository it was refused instead for one empty Trace Links Reference cell; and an
// SRS-W002 on another target's requirement carried only a location, so it refused everything as an
// unowned warning.

vi.setConfig({ testTimeout: 120_000 });

afterAll(async () => {
  await cleanupFixtures();
});

const SCOPE = "docs/spec/10.product-architecture.srs.md";

interface BlockInput {
  readonly id: string;
  readonly target: string;
  readonly status: string;
  readonly evidence?: string;
  readonly trace?: readonly string[];
}

function block(input: BlockInput): string {
  return [
    "",
    `### ${input.id} — Readiness fixture ${input.id}`,
    "",
    "| Field | Value |",
    "| --- | --- |",
    "| Type | functional |",
    `| Target | ${input.target} |`,
    `| Status | ${input.status} |`,
    "| Priority | medium |",
    "| Tags | fixture |",
    "| Risk | low |",
    "| Stability | evolving |",
    "| Verification Method | test |",
    "| GitHub Issue | - |",
    "| Related Docs | - |",
    "",
    "#### Requirement",
    "",
    `The system SHALL keep ${input.id} for the readiness fixture.`,
    "",
    "#### Rationale",
    "",
    "A readiness fixture block.",
    "",
    "#### Acceptance Criteria",
    "",
    `- [${input.evidence ? "x" : " "}] AC-1: THE fixture SHALL hold.`,
    "",
    "#### Verification Evidence",
    "",
    "| Evidence ID | Type | Reference | Covers | Notes |",
    "| --- | --- | --- | --- | --- |",
    ...(input.evidence ? [input.evidence] : []),
    "",
    "#### Trace Links",
    "",
    "| Type | Reference | Relation | Notes |",
    "| --- | --- | --- | --- |",
    ...(input.trace ?? []),
    "",
    "#### Change Notes",
    "",
    "| Date | Change | Reason |",
    "| --- | --- | --- |",
    "| 2026-11-21 | Created | Fixture |",
    ""
  ].join("\n");
}

const EVIDENCE = "| VE-1 | test | test/example.test.ts | AC-1 | fixture |";
/** v1.0.0, implemented: the dependency of the checked requirement, with one empty Reference cell. */
const DEPENDENCY = block({ id: "FR-ARCH-002", target: "v1.0.0", status: "implemented", evidence: EVIDENCE, trace: ["| Code |  | implements | empty reference cell |"] });
/** v1.1.0, planned: the requirement the check names. */
const CHECKED = block({ id: "FR-ARCH-003", target: "v1.1.0", status: "planned", trace: ["| Requirement | FR-ARCH-002 | depends_on | another target |"] });
/** An unregistered target, as a merge that lost its Target Map row leaves it: SRS-W002. */
const UNREGISTERED = block({ id: "FR-ARCH-004", target: "9.9.9", status: "planned" });
/** A depends_on row whose Reference is empty: an intended dependency the cell lost. */
const LOST_DEPENDENCY = block({ id: "FR-ARCH-005", target: "v1.0.0", status: "planned", trace: ["| Requirement |  | depends_on | lost |"] });

async function workspace(...blocks: readonly string[]): Promise<string> {
  const root = await gitWorkspaceRepo("fr-node-321-", "mutation-target");
  expect(path.resolve(await rawGit(root, "rev-parse", "--show-toplevel"))).toBe(path.resolve(root));
  const file = path.join(root, SCOPE);
  await writeFile(file, `${(await readFile(file, "utf8")).trimEnd()}\n${blocks.join("")}`, "utf8");
  return root;
}

async function cli(root: string, args: readonly string[]): Promise<{ exit: number; out: string }> {
  const streams = { stdout: new PassThrough(), stderr: new PassThrough() };
  const exit = await main(["--root", root, ...args], streams);
  return { exit, out: streams.stdout.read()?.toString() ?? "" };
}

type Answer = { ok?: boolean; gate?: string; error?: unknown; violations?: Array<Record<string, unknown>>; readiness?: unknown };

/** The snapshot the section builds: the whole repository's list written by the CLI, plus the target's summary. */
async function cliCheck(root: string, options: { readonly listArgs?: readonly string[] } = {}): Promise<{ exit: number; answer: Answer }> {
  const list = await cli(root, ["list", "--format", "full", ...(options.listArgs ?? []), "--json"]);
  const summary = await cli(root, ["summary", "--target", "v1.1.0", "--json"]);
  const snapshot = { transport: "speckiwi-list-json", target: "v1.1.0", list: JSON.parse(list.out), summary: JSON.parse(summary.out) };
  await writeFile(path.join(root, "snapshot.json"), JSON.stringify(snapshot), "utf8");
  const checked = await cli(root, ["orchestrate", "readiness", "check", "--target", "v1.1.0", "--snapshot", "snapshot.json", "--req", "FR-ARCH-003", "--json"]);
  return { exit: checked.exit, answer: JSON.parse(checked.out || "{}") as Answer };
}

function refusal(run: () => unknown): NotReadyRequirement[] {
  try {
    run();
  } catch (error) {
    if (error instanceof RequirementNotReadyError) return [...error.notReady];
    throw error;
  }
  throw new Error("readiness did not refuse");
}

describe("FR-NODE-321 AC-1 — requirement-level warnings name the block they are reported at", () => {
  // @req FR-NODE-321 AC-1
  it("gives SRS-W002 and SRS-W001 the requirementId of their block", async () => {
    const noRationale = block({ id: "FR-ARCH-006", target: "v1.0.0", status: "planned" }).replace("#### Rationale\n\nA readiness fixture block.\n\n", "");
    const root = await workspace(UNREGISTERED, noRationale);
    const { out } = await cli(root, ["validate", "--json"]);
    const diagnostics = (JSON.parse(out) as { diagnostics: Array<{ code: string; requirementId?: string; filePath?: string; line?: number }> }).diagnostics;
    const w002 = diagnostics.find((item) => item.code === "SRS-W002");
    expect(w002, JSON.stringify(diagnostics)).toMatchObject({ requirementId: "FR-ARCH-004", filePath: SCOPE });
    expect(typeof w002?.line).toBe("number");
    expect(diagnostics.find((item) => item.code === "SRS-W001")).toMatchObject({ requirementId: "FR-ARCH-006", filePath: SCOPE });
  });
});

describe("FR-NODE-321 AC-2 AC-4 — the whole-repository snapshot the section builds", () => {
  // @req FR-NODE-321 AC-2 AC-4
  it("is ready with another target's dependency, an empty trace Reference and another target's SRS-W002", async () => {
    const root = await workspace(DEPENDENCY, CHECKED, UNREGISTERED);
    const { exit, answer } = await cliCheck(root);
    expect(answer.ok, JSON.stringify(answer)).toBe(true);
    expect(exit).toBe(0);
  });

  // @req FR-NODE-321 AC-4 AC-5
  it("still refuses a depends_on row with an empty Reference, naming the requirement, its file and the row's line", async () => {
    const root = await workspace(DEPENDENCY, CHECKED, LOST_DEPENDENCY);
    const { answer } = await cliCheck(root);
    expect(answer.ok).toBe(false);
    const message = JSON.stringify(answer.error);
    expect(message).toContain("Malformed requirement snapshot");
    expect(message).toContain("FR-ARCH-005");
    expect(message).toContain(SCOPE);
    const lines = (await readFile(path.join(root, SCOPE), "utf8")).split(/\r?\n/u);
    const rowLine = lines.findIndex((line) => line === "| Requirement |  | depends_on | lost |") + 1;
    expect(rowLine).toBeGreaterThan(0);
    expect(message).toContain(`line ${rowLine}`);
    expect(message).toContain("depends_on");
  });
});

describe("FR-NODE-321 AC-1 AC-6 AC-8 — a snapshot of the product target only", () => {
  // @req FR-NODE-321 AC-1 AC-6
  it("names the dependency it lacks and is not refused for another target's SRS-W002", async () => {
    const root = await workspace(DEPENDENCY, CHECKED, UNREGISTERED);
    const { answer } = await cliCheck(root, { listArgs: ["--target", "v1.1.0"] });
    expect(answer.gate).toBe("requirement-not-ready");
    const [entry] = answer.violations ?? [];
    expect(entry).toMatchObject({ id: "FR-ARCH-003", hardDependenciesSatisfied: false, missingDependencies: ["FR-ARCH-002"] });
    expect(entry, "a snapshot that lacks a dependency is incomplete, not invalid").not.toHaveProperty("invalidBecause");
  });

  // @req FR-NODE-321 AC-8
  it("answers the same through MCP orchestrate_readiness_check", async () => {
    const root = await workspace(DEPENDENCY, CHECKED, UNREGISTERED);
    const { answer: viaCli } = await cliCheck(root, { listArgs: ["--target", "v1.1.0"] });
    const handle = createMcpServer({ root });
    const list = (await handle.callTool("list_requirements", { target: "v1.1.0", projection: "full", includeAllDiagnostics: true })) as { value: Record<string, unknown> };
    const summary = (await handle.callTool("summarize_target", { target: "v1.1.0" })) as { value: unknown };
    const snapshot = { transport: "mcp-list-requirements", target: "v1.1.0", records: list.value.records, diagnostics: list.value.diagnostics, summary: summary.value };
    await writeFile(path.join(root, "mcp-snapshot.json"), JSON.stringify(snapshot), "utf8");
    const viaMcp = (await handle.callTool("orchestrate_readiness_check", { target: "v1.1.0", snapshot: "mcp-snapshot.json", req: ["FR-ARCH-003"] })) as Answer;
    expect(viaMcp.violations, JSON.stringify(viaMcp)).toEqual(viaCli.violations);
  });
});

describe("FR-NODE-321 AC-6 — missing dependencies, unit cases", () => {
  // @req FR-NODE-321 AC-6
  it("lists an id missing behind a dependency the snapshot holds, and nothing when every dependency is present", () => {
    const top = record({ id: "FR-A-001", status: "planned", traceLinks: [{ type: "Requirement", reference: "FR-A-002", relation: "depends_on" }] });
    const middle = record({ id: "FR-A-002", status: "implemented", traceLinks: [{ type: "Requirement", reference: "FR-Z-009", relation: "depends_on" }] });
    const lacking = parseRequirementSnapshot(mcpPayload(content([top, middle])));
    const [entry] = refusal(() => assertRequirementsReady(lacking, lacking.target, ["FR-A-001"]));
    expect(entry).toMatchObject({ id: "FR-A-001", missingDependencies: ["FR-Z-009"] });

    const blocked = record({ id: "FR-A-002", status: "planned" });
    const complete = parseRequirementSnapshot(mcpPayload(content([top, blocked])));
    const [other] = refusal(() => assertRequirementsReady(complete, complete.target, ["FR-A-001"]));
    expect(other, "the dependency is present but not implemented").not.toHaveProperty("missingDependencies");
  });
});

describe("FR-NODE-321 AC-3 — an unowned warning names where it points", () => {
  // @req FR-NODE-321 AC-3
  it("carries the file path, line and a hint that the snapshot has no record there", () => {
    const ready = record({ id: "FR-A-001", filePath: "docs/spec/a.srs.md", headingLine: 10, blockEndLine: 40 });
    const diagnostics = [
      { code: "SRS-W002", severity: "warning" as const, message: "Target is not registered: 9.9.9", filePath: "docs/spec/b.srs.md", line: 186 },
      { code: "SRS-W002", severity: "warning" as const, message: "Target is not registered: 9.9.8", filePath: "docs/spec/b.srs.md", line: 300 }
    ];
    const snapshot = parseRequirementSnapshot(mcpPayload(content([ready], diagnostics)));
    const [entry] = refusal(() => assertRequirementsReady(snapshot, snapshot.target, ["FR-A-001"]));
    const [cause] = entry?.invalidBecause ?? [];
    expect(cause).toMatchObject({ cause: "unowned-warning", code: "SRS-W002", count: 2, message: "Target is not registered: 9.9.9", filePath: "docs/spec/b.srs.md", line: 186 });
    expect(cause?.hint).toMatch(/no record/u);
    expect(cause?.hint).toContain("docs/spec/b.srs.md:186");
    // An index warning sits in no requirement block, so the hint does not send the reader to rebuild only.
    expect(cause?.hint).toContain("otherwise fix the warning there");
  });
});

describe("FR-NODE-321 AC-3 — an unowned warning with a file and no line", () => {
  // @req FR-NODE-321 AC-3
  it("names the file and gives the hint, as an index warning without a line is reported", () => {
    const ready = record({ id: "FR-A-001", filePath: "docs/spec/a.srs.md", headingLine: 10, blockEndLine: 40 });
    const diagnostics = [{ code: "SRS-W018", severity: "warning" as const, message: "Scope SRS document is not registered in Scope Map: docs/spec/20.extra.srs.md", filePath: "docs/spec/00.index.md" }];
    const snapshot = parseRequirementSnapshot(mcpPayload(content([ready], diagnostics)));
    const [entry] = refusal(() => assertRequirementsReady(snapshot, snapshot.target, ["FR-A-001"]));
    const [cause] = entry?.invalidBecause ?? [];
    expect(cause).toMatchObject({ cause: "unowned-warning", code: "SRS-W018", filePath: "docs/spec/00.index.md" });
    expect(cause).not.toHaveProperty("line");
    expect(cause?.hint).toContain("no record at docs/spec/00.index.md,");
  });
});

describe("FR-NODE-321 AC-4 AC-5 — the parser, unit cases", () => {
  // @req FR-NODE-321 AC-4
  it("accepts empty type, reference and relation strings on a row that is not a dependency", () => {
    const loose = record({ id: "FR-A-001", traceLinks: [{ type: "", reference: "", relation: "" }, { type: "Code", reference: "", relation: "implements" }] });
    expect(parseRequirementSnapshot(mcpPayload(content([loose]))).records[0]?.traceLinks).toHaveLength(2);
  });

  // @req FR-NODE-321 AC-4
  it("accepts blank Type and Notes cells of a verification evidence row", () => {
    const blank = record({ id: "FR-A-001", verificationEvidence: [{ id: "VE-1", type: "", covers: "all", reference: "test/x.test.ts", notes: "" }] });
    expect(parseRequirementSnapshot(mcpPayload(content([blank]))).records[0]?.verificationEvidence).toHaveLength(1);
  });

  // @req FR-NODE-321 AC-5
  it("names the record's position, file and heading line when a record has no id", () => {
    const anonymous = { ...record({ id: "FR-A-001", filePath: "docs/spec/a.srs.md", headingLine: 12 }), id: undefined } as unknown as ReturnType<typeof record>;
    const payload = mcpPayload(content([record({ id: "FR-A-000" }), anonymous])) as SnapshotPayload;
    expect(() => parseRequirementSnapshot(payload)).toThrow(/record 2 \(docs\/spec\/a\.srs\.md:12\)/u);
  });

  // @req FR-NODE-321 AC-5
  it("names the requirement id, file and heading line for any field it refuses", () => {
    const bad = { ...record({ id: "FR-A-001", filePath: "docs/spec/a.srs.md", headingLine: 12 }), status: "nonsense" } as unknown as ReturnType<typeof record>;
    expect(() => parseRequirementSnapshot(mcpPayload(content([bad])))).toThrow(/FR-A-001 \(docs\/spec\/a\.srs\.md:12\)/u);
  });
});

describe("FR-NODE-321 AC-7 — the help and the description say what the snapshot has to hold", () => {
  const PHRASE = "every requirement they depend on";

  // @req FR-NODE-321 AC-7
  it("CLI --snapshot help", async () => {
    const root = await workspace();
    const streams = { stdout: new PassThrough(), stderr: new PassThrough() };
    await main(["--root", root, "orchestrate", "readiness", "check", "--help"], streams);
    const help = `${streams.stdout.read()?.toString() ?? ""}${streams.stderr.read()?.toString() ?? ""}`.replace(/\s+/gu, " ");
    expect(help).toContain(PHRASE);
    expect(help).toContain("whole repository");
  });

  // @req FR-NODE-321 AC-7
  it("MCP orchestrate_readiness_check description", () => {
    const description = ORCHESTRATE_TOOL_BINDINGS.find((binding) => binding.tool === "orchestrate_readiness_check")?.description ?? "";
    expect(description).toContain(PHRASE);
    expect(description).toContain("whole repository");
  });
});
