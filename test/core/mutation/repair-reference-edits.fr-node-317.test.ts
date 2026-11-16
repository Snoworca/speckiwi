import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { main } from "../../../src/cli/index.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import {
  applyRequirementIdCollisionRepair,
  diagnoseRequirementIdCollisions,
  planRequirementIdCollisionRepair,
  type RequirementIdCollisionRepairPlanInput
} from "../../../src/core/mutation/repair-requirement-id.js";
import { createMcpServer, createSdkServer } from "../../../src/mcp/server.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

// @req FR-NODE-317 — GitHub #17, OG lane B: a reference edit changed only the first match on its line
// and said ok, so a Change Notes row naming two criteria of the renamed requirement kept one under the
// old id, now pointing at the kept requirement. Two edits on one line passed plan and failed apply with
// an unstructured error, an edit could rewrite `| Status | planned |`, and the kept block's own lines
// had to be confirmed one by one.

const ARCH = "docs/spec/10.product-architecture.srs.md";
const DUP = "FR-ARCH-001";
const NEW = "FR-ARCH-020";

function block(title: string, extraTrace: string[], changeRows: string[]): string[] {
  return [
    `### ${DUP} — ${title}`,
    "",
    "| Field | Value |",
    "| --- | --- |",
    "| Type | functional |",
    "| Target | v1.0.0 |",
    "| Status | planned |",
    "",
    "#### Requirement",
    `${title}.`,
    "#### Acceptance Criteria",
    "- [ ] AC-1: one",
    "- [ ] AC-2: two",
    "#### Verification Evidence",
    "| Evidence ID | Type | Reference | Covers | Notes |",
    "| --- | --- | --- | --- | --- |",
    "#### Trace Links",
    "| Type | Reference | Relation | Notes |",
    "| --- | --- | --- | --- |",
    ...extraTrace,
    "#### Change Notes",
    "| Date | Change | Reason |",
    "| --- | --- | --- |",
    ...changeRows,
    ""
  ];
}

const ARCH_TEXT = [
  "# Product Architecture",
  "",
  "## 4. Requirements",
  "",
  ...block("First", [], [`| 2026-11-01 | KEEPROW ${DUP} AC-1 and ${DUP} AC-2 reworded | keep side |`]),
  ...block("Duplicate", [`| Requirement | ${DUP} | related_to | SELFROW |`], [`| 2026-11-02 | RENAMEROW ${DUP} AC-1 and ${DUP} AC-2 added | rename side |`]),
  "### FR-ARCH-010 — Third",
  "",
  "| Field | Value |",
  "| --- | --- |",
  "| Type | functional |",
  "| Target | v1.0.0 |",
  "| Status | planned |",
  "",
  "#### Requirement",
  "Third.",
  "#### Acceptance Criteria",
  "- [ ] AC-1: third",
  "#### Trace Links",
  "| Type | Reference | Relation | Notes |",
  "| --- | --- | --- | --- |",
  `| Requirement | ${DUP} | depends_on | OUTSIDEROW |`,
  "#### Change Notes",
  "| Date | Change | Reason |",
  "| --- | --- | --- |",
  `| 2026-11-03 | MIXEDROW ${DUP} AC-1 kept and ${DUP} AC-2 renamed | merged |`,
  ""
].join("\n");

interface Fixture {
  rootPath: string;
  base: Pick<RequirementIdCollisionRepairPlanInput, "duplicateId" | "keep" | "rename" | "replacementId">;
  line: (marker: string) => number;
  arch: () => Promise<string>;
}

async function fixture(): Promise<Fixture> {
  const rootPath = await copyFixtureWorkspace("duplicate-id");
  await writeFile(path.join(rootPath, ARCH), ARCH_TEXT, "utf8");
  const group = (await diagnoseRequirementIdCollisions(await resolveProjectRoot(rootPath))).value.groups.find((item) => item.duplicateId === DUP)!;
  const lines = ARCH_TEXT.split("\n");
  return {
    rootPath,
    base: { duplicateId: DUP, keep: group.occurrences[0]!, rename: group.occurrences[1]!, replacementId: NEW },
    line: (marker) => lines.findIndex((text) => text.includes(marker)) + 1,
    arch: () => readFile(path.join(rootPath, ARCH), "utf8")
  };
}

async function snapshot(rootPath: string): Promise<Record<string, string>> {
  const dir = path.join(rootPath, "docs", "spec");
  const out: Record<string, string> = {};
  for (const name of await readdir(dir)) if (name.endsWith(".md")) out[name] = await readFile(path.join(dir, name), "utf8");
  return out;
}

type Input = Omit<RequirementIdCollisionRepairPlanInput, "duplicateId" | "keep" | "rename" | "replacementId">;
const plan = async (f: Fixture, input: Input) => planRequirementIdCollisionRepair(await resolveProjectRoot(f.rootPath), { ...f.base, ...input });
const apply = async (f: Fixture, input: Input & { dryRun?: boolean }) => applyRequirementIdCollisionRepair(await resolveProjectRoot(f.rootPath), { ...f.base, ...input });

/** Every line outside both blocks that names the duplicate id, settled so apply can write. */
function settleOutside(f: Fixture) {
  return {
    keepReferences: [{ filePath: ARCH, line: f.line("OUTSIDEROW") }, { filePath: ARCH, line: f.line("MIXEDROW") }]
  };
}
const renameAll = (f: Fixture) => ({ filePath: ARCH, line: f.line("RENAMEROW"), from: DUP, to: NEW, occurrence: "all" as const });

describe("FR-NODE-317 AC-1 — a `from` that matches more than once needs an occurrence", () => {
  // @req FR-NODE-317 AC-1
  it("refuses plan and apply with AMBIGUOUS_REFERENCE naming the line and the count, writing nothing", async () => {
    const f = await fixture();
    const before = await snapshot(f.rootPath);
    const edit = { filePath: ARCH, line: f.line("RENAMEROW"), from: DUP, to: NEW };
    const planned = await plan(f, { referenceEdits: [edit], ...settleOutside(f) });
    expect(planned.ok).toBe(false);
    expect(planned.error?.code).toBe("AMBIGUOUS_REFERENCE");
    expect(planned.error?.message).toContain(`${ARCH}:${f.line("RENAMEROW")}`);
    expect(planned.error?.message).toContain("2 matches");
    const applied = await apply(f, { referenceEdits: [edit], ...settleOutside(f) });
    expect(applied.error?.code).toBe("AMBIGUOUS_REFERENCE");
    expect(await snapshot(f.rootPath)).toEqual(before);
  });

  // @req FR-NODE-317 AC-1
  it("an edit whose from equals to confirms the line as kept, whatever its count", async () => {
    const f = await fixture();
    const mixed = f.line("MIXEDROW");
    const result = await apply(f, {
      referenceEdits: [renameAll(f), { filePath: ARCH, line: mixed, from: DUP, to: DUP }],
      keepReferences: [{ filePath: ARCH, line: f.line("OUTSIDEROW") }]
    });
    expect(result.ok, JSON.stringify(result.error)).toBe(true);
    expect((await f.arch()).split("\n")[mixed - 1]).toBe(ARCH_TEXT.split("\n")[mixed - 1]);
  });
});

describe("FR-NODE-317 AC-2 — occurrence all or n", () => {
  // @req FR-NODE-317 AC-2
  it("occurrence all replaces every match on the line", async () => {
    const f = await fixture();
    const result = await apply(f, { referenceEdits: [renameAll(f)], ...settleOutside(f) });
    expect(result.ok, JSON.stringify(result.error)).toBe(true);
    expect((await f.arch()).split("\n")[f.line("RENAMEROW") - 1]).toBe(`| 2026-11-02 | RENAMEROW ${NEW} AC-1 and ${NEW} AC-2 added | rename side |`);
  });

  // @req FR-NODE-317 AC-2
  it("occurrence n replaces only the n-th match", async () => {
    const f = await fixture();
    const mixed = f.line("MIXEDROW");
    const result = await apply(f, {
      referenceEdits: [renameAll(f), { filePath: ARCH, line: mixed, from: DUP, to: NEW, occurrence: 2 }],
      keepReferences: [{ filePath: ARCH, line: f.line("OUTSIDEROW") }, { filePath: ARCH, line: mixed }]
    });
    expect(result.ok, JSON.stringify(result.error)).toBe(true);
    expect((await f.arch()).split("\n")[mixed - 1]).toBe(`| 2026-11-03 | MIXEDROW ${DUP} AC-1 kept and ${NEW} AC-2 renamed | merged |`);
  });

  // @req FR-NODE-317 AC-2
  it("occurrence beyond the line's matches is STALE_PATCH", async () => {
    const f = await fixture();
    const result = await plan(f, { referenceEdits: [{ filePath: ARCH, line: f.line("MIXEDROW"), from: DUP, to: NEW, occurrence: 3 }] });
    expect(result.error?.code).toBe("STALE_PATCH");
  });
});

describe("FR-NODE-317 AC-3 — several edits on one line", () => {
  // @req FR-NODE-317 AC-3
  it("non-overlapping edits on one line apply as one rewrite", async () => {
    const f = await fixture();
    const row = f.line("RENAMEROW");
    const result = await apply(f, {
      referenceEdits: [
        { filePath: ARCH, line: row, from: `${DUP} AC-1`, to: `${NEW} AC-1` },
        { filePath: ARCH, line: row, from: `${DUP} AC-2`, to: `${NEW} AC-2` }
      ],
      ...settleOutside(f)
    });
    expect(result.ok, JSON.stringify(result.error)).toBe(true);
    expect((await f.arch()).split("\n")[row - 1]).toBe(`| 2026-11-02 | RENAMEROW ${NEW} AC-1 and ${NEW} AC-2 added | rename side |`);
  });

  // @req FR-NODE-317 AC-3
  it("overlapping edits are refused at plan time, and apply answers the same structured refusal", async () => {
    const f = await fixture();
    const row = f.line("RENAMEROW");
    const edits = [
      { filePath: ARCH, line: row, from: `${DUP} AC-1`, to: `${NEW} AC-1` },
      { filePath: ARCH, line: row, from: DUP, to: NEW, occurrence: 1 }
    ];
    const planned = await plan(f, { referenceEdits: edits, ...settleOutside(f) });
    expect(planned.error?.code).toBe("MUTATION_DENIED");
    expect(planned.error?.message).toContain(`${ARCH}:${row}`);
    const before = await snapshot(f.rootPath);
    const applied = await apply(f, { referenceEdits: edits, ...settleOutside(f), dryRun: true });
    expect(applied.error?.code).toBe("MUTATION_DENIED");
    expect(await snapshot(f.rootPath)).toEqual(before);
  });
});

describe("FR-NODE-317 AC-4 — a reference edit swaps the duplicate id and nothing else", () => {
  const refused = async (edit: (f: Fixture) => { filePath: string; line: number; from: string; to: string }) => {
    const f = await fixture();
    const before = await snapshot(f.rootPath);
    const result = await apply(f, { referenceEdits: [renameAll(f), edit(f)], ...settleOutside(f) });
    expect(await snapshot(f.rootPath)).toEqual(before);
    return result;
  };

  // @req FR-NODE-317 AC-4
  it("refuses an edit that would promote a Status", async () => {
    const result = await refused((f) => ({ filePath: ARCH, line: f.line("| Status | planned |"), from: "planned", to: "verified" }));
    expect(result.error?.code).toBe("MUTATION_DENIED");
  });

  // @req FR-NODE-317 AC-4
  it("refuses an empty from", async () => {
    const result = await refused((f) => ({ filePath: ARCH, line: f.line("KEEPROW"), from: "", to: "" }));
    expect(result.error?.code).toBe("MUTATION_DENIED");
  });

  // @req FR-NODE-317 AC-4
  it("refuses a to that changes more than the id", async () => {
    const result = await refused((f) => ({ filePath: ARCH, line: f.line("OUTSIDEROW"), from: `| ${DUP} | depends_on`, to: `| ${NEW} | supersedes` }));
    expect(result.error?.code).toBe("MUTATION_DENIED");
  });

  // @req FR-NODE-317 AC-4
  it("refuses an edit on a line the rename rewrites by itself", async () => {
    const result = await refused((f) => ({ filePath: ARCH, line: f.line("SELFROW"), from: DUP, to: NEW }));
    expect(result.error?.code).toBe("MUTATION_DENIED");
  });

  // @req FR-NODE-317 AC-4
  it("keeps STALE_PATCH for a from the line does not hold", async () => {
    const f = await fixture();
    const result = await plan(f, { referenceEdits: [{ filePath: ARCH, line: f.line("OUTSIDEROW"), from: "FR-ARCH-999", to: NEW }] });
    expect(result.error?.code).toBe("STALE_PATCH");
  });
});

describe("FR-NODE-317 AC-5 — the kept block's own mentions are kept", () => {
  // @req FR-NODE-317 AC-5
  it("plan lists the kept block's line under keptReferences, not ambiguousReferences", async () => {
    const f = await fixture();
    const result = await plan(f, {});
    expect(result.ok, JSON.stringify(result.error)).toBe(true);
    const keep = f.line("KEEPROW");
    expect(result.value?.ambiguousReferences.map((item) => item.line)).not.toContain(keep);
    expect(result.value?.keptReferences).toEqual([expect.objectContaining({ filePath: ARCH, line: keep, source: "kept-block" })]);
  });

  // @req FR-NODE-317 AC-5
  it("diagnose lists each occurrence's own lines under blockReferences and leaves ambiguousReferences as it was", async () => {
    const f = await fixture();
    const group = (await diagnoseRequirementIdCollisions(await resolveProjectRoot(f.rootPath))).value.groups.find((item) => item.duplicateId === DUP)!;
    expect(group.blockReferences).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ filePath: ARCH, line: f.line("KEEPROW"), headingLine: f.base.keep.headingLine }),
        expect.objectContaining({ filePath: ARCH, line: f.line("RENAMEROW"), headingLine: f.base.rename.headingLine })
      ])
    );
    expect(group.ambiguousReferences.map((item) => item.line)).toEqual(
      expect.arrayContaining([f.line("KEEPROW"), f.line("RENAMEROW"), f.line("OUTSIDEROW"), f.line("MIXEDROW")])
    );
  });
});

describe("FR-NODE-317 AC-6 — keepReferences confirms a line by position", () => {
  // @req FR-NODE-317 AC-6
  it("a keepReferences line stays as it was and is listed as kept", async () => {
    const f = await fixture();
    const outside = f.line("OUTSIDEROW");
    const planned = await plan(f, { referenceEdits: [renameAll(f)], ...settleOutside(f) });
    expect(planned.value?.keptReferences).toEqual(expect.arrayContaining([expect.objectContaining({ line: outside, source: "keepReferences" })]));
    expect(planned.value?.ambiguousReferences).toEqual([]);
    const applied = await apply(f, { referenceEdits: [renameAll(f)], ...settleOutside(f) });
    expect(applied.ok, JSON.stringify(applied.error)).toBe(true);
    expect((await f.arch()).split("\n")[outside - 1]).toBe(ARCH_TEXT.split("\n")[outside - 1]);
  });

  // @req FR-NODE-317 AC-6
  it("a keepReferences line without the duplicate id is STALE_PATCH", async () => {
    const f = await fixture();
    const result = await plan(f, { keepReferences: [{ filePath: ARCH, line: f.line("| Status | planned |") }] });
    expect(result.error?.code).toBe("STALE_PATCH");
  });

  // @req FR-NODE-317 AC-6
  it("a keepReferences line the rename rewrites by itself is MUTATION_DENIED", async () => {
    const f = await fixture();
    const result = await plan(f, { keepReferences: [{ filePath: ARCH, line: f.line("SELFROW") }] });
    expect(result.error?.code).toBe("MUTATION_DENIED");
  });
});

describe("FR-NODE-317 AC-7 — a rewritten line that still names the duplicate id is reported", () => {
  // @req FR-NODE-317 AC-7
  it("plan and apply list the line and its remaining count under remainingReferences", async () => {
    const f = await fixture();
    const row = f.line("RENAMEROW");
    const edit = { filePath: ARCH, line: row, from: DUP, to: NEW, occurrence: 1 };
    const planned = await plan(f, { referenceEdits: [edit], ...settleOutside(f) });
    expect(planned.value?.remainingReferences).toEqual([expect.objectContaining({ filePath: ARCH, line: row, matches: 1 })]);
    const applied = await apply(f, { referenceEdits: [edit], ...settleOutside(f) });
    expect(applied.ok, JSON.stringify(applied.error)).toBe(true);
    expect(applied.value?.remainingReferences).toEqual([expect.objectContaining({ filePath: ARCH, line: row, matches: 1 })]);
  });

  // @req FR-NODE-317 AC-7
  it("a line confirmed under keepReferences is not reported", async () => {
    const f = await fixture();
    const row = f.line("RENAMEROW");
    const planned = await plan(f, {
      referenceEdits: [{ filePath: ARCH, line: row, from: DUP, to: NEW, occurrence: 1 }],
      keepReferences: [...settleOutside(f).keepReferences, { filePath: ARCH, line: row }]
    });
    expect(planned.value?.remainingReferences).toEqual([]);
  });
});

describe("FR-NODE-317 AC-8 — what stays as before", () => {
  // @req FR-NODE-317 AC-8
  it("an unnamed line outside the blocks still refuses the apply", async () => {
    const f = await fixture();
    const result = await apply(f, { referenceEdits: [renameAll(f)], keepReferences: [{ filePath: ARCH, line: f.line("MIXEDROW") }] });
    expect(result.error?.code).toBe("AMBIGUOUS_REFERENCE");
  });

  // @req FR-NODE-317 AC-8
  it("a single-match repair writes the bytes it wrote before", async () => {
    const rootPath = await copyFixtureWorkspace("duplicate-id");
    const indexPath = path.join(rootPath, "docs/spec/00.index.md");
    await writeFile(
      indexPath,
      `${await readFile(indexPath, "utf8")}\n\n## 7. Completed Work Log\n\n| Date | Target | Scope | Requirement IDs | Summary | Report Paths |\n|---|---|---|---|---|---|\n| 2026-06-30 | v1.0.0 | ARCH | ${DUP} | Row. | - |\n`,
      "utf8"
    );
    const root = await resolveProjectRoot(rootPath);
    const group = (await diagnoseRequirementIdCollisions(root)).value.groups.find((item) => item.duplicateId === DUP)!;
    const indexBefore = await readFile(indexPath, "utf8");
    const archBefore = await readFile(path.join(rootPath, ARCH), "utf8");
    const rowLine = indexBefore.split("\n").findIndex((line) => line.includes("| Row. |")) + 1;
    const result = await applyRequirementIdCollisionRepair(root, {
      duplicateId: DUP,
      keep: group.occurrences[0]!,
      rename: group.occurrences[1]!,
      replacementId: "FR-ARCH-002",
      referenceEdits: [{ filePath: "docs/spec/00.index.md", line: rowLine, from: DUP, to: "FR-ARCH-002" }]
    });
    expect(result.ok, JSON.stringify(result.error)).toBe(true);
    expect(await readFile(indexPath, "utf8")).toBe(indexBefore.replace(`| ARCH | ${DUP} | Row.`, "| ARCH | FR-ARCH-002 | Row."));
    expect(await readFile(path.join(rootPath, ARCH), "utf8")).toBe(archBefore.replace(`### ${DUP} — Duplicate`, "### FR-ARCH-002 — Duplicate"));
  });

  // @req FR-NODE-317 AC-8
  it("CLI apply refuses a plan file whose recorded lines have moved", async () => {
    const f = await fixture();
    const occurrence = (o: { filePath: string; headingLine: number; blockHash: string }) => `${o.filePath}:${o.headingLine}:${o.blockHash}`;
    const planArgs = [
      "repair", "requirement-id-collisions", "plan",
      "--duplicate-id", DUP, "--keep", occurrence(f.base.keep), "--rename", occurrence(f.base.rename), "--replacement-id", NEW,
      "--reference-edit", JSON.stringify(renameAll(f)),
      "--reference-edit", JSON.stringify({ filePath: ARCH, line: f.line("OUTSIDEROW"), from: DUP, to: NEW }),
      "--keep-reference", JSON.stringify({ filePath: ARCH, line: f.line("MIXEDROW") }),
      "--write-plan", "kiwi/repair-plan.json"
    ];
    expect((await cli(f.rootPath, planArgs)).envelope.ok).toBe(true);
    // The trace table was re-sorted: another row now sits on the recorded line, still naming the id, so
    // the edit would match it and rewrite the wrong row. Only the original the plan recorded can tell.
    const outside = f.line("OUTSIDEROW") - 1;
    const lines = (await f.arch()).split("\n");
    lines[outside] = `| Requirement | ${DUP} | related_to | SWAPPEDROW |`;
    await writeFile(path.join(f.rootPath, ARCH), lines.join("\n"), "utf8");
    const before = await snapshot(f.rootPath);
    const applied = await cli(f.rootPath, ["repair", "requirement-id-collisions", "apply", "--plan", "kiwi/repair-plan.json"]);
    expect(applied.envelope.error?.code).toBe("STALE_PATCH");
    expect(await snapshot(f.rootPath)).toEqual(before);
  });

  // @req FR-NODE-317 AC-8
  it("control: the same plan file applies when the documents still read as recorded", async () => {
    const f = await fixture();
    const occurrence = (o: { filePath: string; headingLine: number; blockHash: string }) => `${o.filePath}:${o.headingLine}:${o.blockHash}`;
    expect(
      (
        await cli(f.rootPath, [
          "repair", "requirement-id-collisions", "plan",
          "--duplicate-id", DUP, "--keep", occurrence(f.base.keep), "--rename", occurrence(f.base.rename), "--replacement-id", NEW,
          "--reference-edit", JSON.stringify(renameAll(f)),
          "--reference-edit", JSON.stringify({ filePath: ARCH, line: f.line("OUTSIDEROW"), from: DUP, to: NEW }),
          "--keep-reference", JSON.stringify({ filePath: ARCH, line: f.line("MIXEDROW") }),
          "--write-plan", "kiwi/repair-plan.json"
        ])
      ).envelope.ok
    ).toBe(true);
    const applied = await cli(f.rootPath, ["repair", "requirement-id-collisions", "apply", "--plan", "kiwi/repair-plan.json"]);
    expect(applied.envelope.ok, JSON.stringify(applied.envelope.error)).toBe(true);
    expect((await f.arch()).split("\n")[f.line("OUTSIDEROW") - 1]).toBe(`| Requirement | ${NEW} | depends_on | OUTSIDEROW |`);
  });
});

type Envelope = { ok: boolean; value?: Record<string, unknown>; error?: { code: string; message: string } };

async function cli(rootPath: string, args: string[]): Promise<{ code: number; envelope: Envelope }> {
  const streams = { stdout: new PassThrough(), stderr: new PassThrough() };
  const code = await main(["--root", rootPath, ...args, "--json"], streams);
  const text = streams.stdout.read()?.toString() ?? "";
  return { code, envelope: (text ? JSON.parse(text) : {}) as Envelope };
}

async function mcp(rootPath: string, name: string, args: Record<string, unknown>): Promise<Envelope> {
  const sdk = createSdkServer(createMcpServer({ root: rootPath, rootSource: "server-cwd-discovery" }));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await sdk.connect(serverTransport);
  const client = new Client({ name: "fr-node-317", version: "1.0.0" }, { capabilities: {} });
  await client.connect(clientTransport);
  const result = (await client.callTool({ name, arguments: args })) as { content: Array<{ type: string; text: string }> };
  await client.close();
  return JSON.parse(result.content.find((item) => item.type === "text")?.text ?? "{}") as Envelope;
}

describe("FR-NODE-317 AC-2 AC-6 — MCP over the SDK and the CLI take occurrence and keepReferences alike", () => {
  // @req FR-NODE-317 AC-2
  // @req FR-NODE-317 AC-6
  it("plan answers the same over both surfaces", async () => {
    const f = await fixture();
    const occurrence = (o: { filePath: string; headingLine: number; blockHash: string }) => `${o.filePath}:${o.headingLine}:${o.blockHash}`;
    const viaMcp = await mcp(f.rootPath, "plan_requirement_id_collision_repair", { ...f.base, referenceEdits: [renameAll(f)], ...settleOutside(f) });
    const viaCli = await cli(f.rootPath, [
      "repair", "requirement-id-collisions", "plan",
      "--duplicate-id", DUP, "--keep", occurrence(f.base.keep), "--rename", occurrence(f.base.rename), "--replacement-id", NEW,
      "--reference-edit", JSON.stringify(renameAll(f)),
      ...settleOutside(f).keepReferences.flatMap((item) => ["--keep-reference", JSON.stringify(item)])
    ]);
    expect(viaMcp.ok, JSON.stringify(viaMcp.error)).toBe(true);
    expect(viaCli.envelope.value?.operations).toEqual(viaMcp.value?.operations);
    expect(viaCli.envelope.value?.keptReferences).toEqual(viaMcp.value?.keptReferences);
    expect((viaMcp.value?.operations as Array<{ replacement: string }>).map((op) => op.replacement)).toContain(`| 2026-11-02 | RENAMEROW ${NEW} AC-1 and ${NEW} AC-2 added | rename side |`);
  });

  // @req FR-NODE-317 AC-1
  it("apply over MCP refuses a two-match edit without occurrence as the core does", async () => {
    const f = await fixture();
    const result = await mcp(f.rootPath, "apply_requirement_id_collision_repair", {
      ...f.base,
      referenceEdits: [{ filePath: ARCH, line: f.line("RENAMEROW"), from: DUP, to: NEW }],
      ...settleOutside(f),
      dryRun: true
    });
    expect(result.error?.code).toBe("AMBIGUOUS_REFERENCE");
  });
});

describe("FR-NODE-317 review round 1 — keep confirmations, mixed lines, other ids", () => {
  // @req FR-NODE-317 AC-1
  // @req FR-NODE-317 AC-5
  it("a kept-block line confirmed with from equal to to is still listed as kept", async () => {
    const f = await fixture();
    const keep = f.line("KEEPROW");
    const result = await plan(f, { referenceEdits: [renameAll(f), { filePath: ARCH, line: keep, from: DUP, to: DUP }], ...settleOutside(f) });
    expect(result.ok, JSON.stringify(result.error)).toBe(true);
    expect(result.value?.keptReferences).toEqual(expect.arrayContaining([expect.objectContaining({ line: keep, source: "kept-block" })]));
  });

  // @req FR-NODE-317 AC-1
  it("a line outside the blocks confirmed with from equal to to is listed as kept", async () => {
    const f = await fixture();
    const outside = f.line("OUTSIDEROW");
    const result = await plan(f, { referenceEdits: [renameAll(f), { filePath: ARCH, line: outside, from: DUP, to: DUP }], keepReferences: [{ filePath: ARCH, line: f.line("MIXEDROW") }] });
    expect(result.ok, JSON.stringify(result.error)).toBe(true);
    expect(result.value?.keptReferences).toEqual(expect.arrayContaining([expect.objectContaining({ line: outside, source: "keepReferences" })]));
  });

  // @req FR-NODE-317 AC-3
  it("a keep span and a rewrite of all matches on one line overlap and are refused", async () => {
    const f = await fixture();
    const mixed = f.line("MIXEDROW");
    const before = await snapshot(f.rootPath);
    const result = await apply(f, {
      referenceEdits: [renameAll(f), { filePath: ARCH, line: mixed, from: `${DUP} AC-1 kept`, to: `${DUP} AC-1 kept` }, { filePath: ARCH, line: mixed, from: DUP, to: NEW, occurrence: "all" }],
      keepReferences: [{ filePath: ARCH, line: f.line("OUTSIDEROW") }]
    });
    expect(result.error?.code).toBe("MUTATION_DENIED");
    expect(result.error?.message).toContain(`${ARCH}:${mixed}`);
    expect(await snapshot(f.rootPath)).toEqual(before);
  });

  // @req FR-NODE-317 AC-3
  it("a keep span and a rewrite of the other match on one line apply together", async () => {
    const f = await fixture();
    const mixed = f.line("MIXEDROW");
    const result = await apply(f, {
      referenceEdits: [renameAll(f), { filePath: ARCH, line: mixed, from: `${DUP} AC-1 kept`, to: `${DUP} AC-1 kept` }, { filePath: ARCH, line: mixed, from: DUP, to: NEW, occurrence: 2 }],
      keepReferences: [{ filePath: ARCH, line: f.line("OUTSIDEROW") }]
    });
    expect(result.ok, JSON.stringify(result.error)).toBe(true);
    expect(result.value?.remainingReferences).toEqual([]);
    expect((await f.arch()).split("\n")[mixed - 1]).toBe(`| 2026-11-03 | MIXEDROW ${DUP} AC-1 kept and ${NEW} AC-2 renamed | merged |`);
  });

  // @req FR-NODE-317 AC-2
  it("an occurrence that is neither all nor a whole number is refused, not dropped, on every surface", async () => {
    const f = await fixture();
    const occurrence = (o: { filePath: string; headingLine: number; blockHash: string }) => `${o.filePath}:${o.headingLine}:${o.blockHash}`;
    const viaCli = await cli(f.rootPath, [
      "repair", "requirement-id-collisions", "plan",
      "--duplicate-id", DUP, "--keep", occurrence(f.base.keep), "--rename", occurrence(f.base.rename), "--replacement-id", NEW,
      "--reference-edit", JSON.stringify({ filePath: ARCH, line: f.line("MIXEDROW"), from: DUP, to: NEW, occurrence: "2" })
    ]);
    expect(viaCli.envelope.error?.code).toBe("MUTATION_DENIED");
    const viaCore = await plan(f, { referenceEdits: [{ filePath: ARCH, line: f.line("MIXEDROW"), from: DUP, to: NEW, occurrence: 0 }] });
    expect(viaCore.error?.code).toBe("MUTATION_DENIED");
  });

  // @req FR-NODE-317 AC-2
  it("a keep confirmation's occurrence is checked like any other", async () => {
    const f = await fixture();
    const result = await plan(f, { referenceEdits: [{ filePath: ARCH, line: f.line("MIXEDROW"), from: DUP, to: DUP, occurrence: 9 }] });
    expect(result.error?.code).toBe("STALE_PATCH");
  });

  // @req FR-NODE-317 AC-1
  // @req FR-NODE-317 AC-2
  it("a longer id that starts with the duplicate id is neither counted nor rewritten", async () => {
    const f = await fixture();
    const outside = f.line("OUTSIDEROW");
    const lines = ARCH_TEXT.split("\n");
    lines[outside - 1] = `| Requirement | ${DUP} | depends_on | OUTSIDEROW also FR-ARCH-0010 and NFR-ARCH-001 |`;
    await writeFile(path.join(f.rootPath, ARCH), lines.join("\n"), "utf8");
    const result = await apply(f, {
      referenceEdits: [renameAll(f), { filePath: ARCH, line: outside, from: DUP, to: NEW, occurrence: "all" }],
      keepReferences: [{ filePath: ARCH, line: f.line("MIXEDROW") }]
    });
    expect(result.ok, JSON.stringify(result.error)).toBe(true);
    expect((await f.arch()).split("\n")[outside - 1]).toBe(`| Requirement | ${NEW} | depends_on | OUTSIDEROW also FR-ARCH-0010 and NFR-ARCH-001 |`);
    expect(result.value?.remainingReferences).toEqual([]);
  });

  // @req FR-NODE-317 AC-1
  it("a single real match beside a longer id needs no occurrence", async () => {
    const f = await fixture();
    const outside = f.line("OUTSIDEROW");
    const lines = ARCH_TEXT.split("\n");
    lines[outside - 1] = `| Requirement | ${DUP} | depends_on | OUTSIDEROW and FR-ARCH-0010 |`;
    await writeFile(path.join(f.rootPath, ARCH), lines.join("\n"), "utf8");
    const result = await plan(f, { referenceEdits: [renameAll(f), { filePath: ARCH, line: outside, from: DUP, to: NEW }], keepReferences: [{ filePath: ARCH, line: f.line("MIXEDROW") }] });
    expect(result.ok, JSON.stringify(result.error)).toBe(true);
  });
});

describe("FR-NODE-317 AC-8 — the tool descriptions say what the tools do", () => {
  // @req FR-NODE-317 AC-8
  it("apply's description excepts the rename's own lines, and plan's names only kept-block lines no edit names", async () => {
    const sdk = createSdkServer(createMcpServer({ root: process.cwd(), rootSource: "server-cwd-discovery" }));
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await sdk.connect(serverTransport);
    const client = new Client({ name: "fr-node-317", version: "1.0.0" }, { capabilities: {} });
    await client.connect(clientTransport);
    const tools = await client.listTools();
    await client.close();
    const describe = (name: string) => tools.tools.find((tool) => tool.name === name)?.description ?? "";
    expect(describe("apply_requirement_id_collision_repair")).toContain("the rename's own lines");
    expect(describe("plan_requirement_id_collision_repair")).toContain("that no edit names");
  });
});

describe("FR-NODE-317 review round 2 — one matching rule, remaining matches counted per match", () => {
  async function withOutside(text: string): Promise<{ f: Fixture; outside: number }> {
    const f = await fixture();
    const outside = f.line("OUTSIDEROW");
    const lines = ARCH_TEXT.split("\n");
    lines[outside - 1] = text;
    await writeFile(path.join(f.rootPath, ARCH), lines.join("\n"), "utf8");
    return { f, outside };
  }

  // @req FR-NODE-317 AC-7
  it("a match neither confirmed nor rewritten on a named line is reported", async () => {
    const { f, outside } = await withOutside(`| Requirement | ${DUP} | depends_on | OUTSIDEROW ${DUP} AC-2 and ${DUP} AC-3 |`);
    const result = await plan(f, {
      referenceEdits: [renameAll(f), { filePath: ARCH, line: outside, from: DUP, to: DUP, occurrence: 1 }, { filePath: ARCH, line: outside, from: DUP, to: NEW, occurrence: 2 }],
      keepReferences: [{ filePath: ARCH, line: f.line("MIXEDROW") }]
    });
    expect(result.ok, JSON.stringify(result.error)).toBe(true);
    expect(result.value?.remainingReferences).toEqual([expect.objectContaining({ line: outside, matches: 1 })]);
  });

  // @req FR-NODE-317 AC-7
  it("a confirmation of one match on an otherwise untouched line reports the other", async () => {
    const f = await fixture();
    const mixed = f.line("MIXEDROW");
    const result = await plan(f, { referenceEdits: [renameAll(f), { filePath: ARCH, line: mixed, from: DUP, to: DUP, occurrence: 1 }], keepReferences: [{ filePath: ARCH, line: f.line("OUTSIDEROW") }] });
    expect(result.ok, JSON.stringify(result.error)).toBe(true);
    expect(result.value?.remainingReferences).toEqual([expect.objectContaining({ line: mixed, matches: 1 })]);
  });

  // @req FR-NODE-317 AC-1
  it("a line that both confirms and rewrites is listed as kept", async () => {
    const f = await fixture();
    const mixed = f.line("MIXEDROW");
    const result = await plan(f, {
      referenceEdits: [renameAll(f), { filePath: ARCH, line: mixed, from: DUP, to: DUP, occurrence: 1 }, { filePath: ARCH, line: mixed, from: DUP, to: NEW, occurrence: 2 }],
      keepReferences: [{ filePath: ARCH, line: f.line("OUTSIDEROW") }]
    });
    expect(result.value?.keptReferences).toEqual(expect.arrayContaining([expect.objectContaining({ line: mixed, source: "keepReferences" })]));
    expect(result.value?.remainingReferences).toEqual([]);
  });

  // @req FR-NODE-317 AC-4
  it("a to that rewrites a longer id inside from is refused", async () => {
    const { f, outside } = await withOutside(`| Requirement | ${DUP} | depends_on | OUTSIDEROW also FR-ARCH-0010 |`);
    const result = await plan(f, {
      referenceEdits: [renameAll(f), { filePath: ARCH, line: outside, from: `${DUP} | depends_on | OUTSIDEROW also FR-ARCH-0010`, to: `${NEW} | depends_on | OUTSIDEROW also FR-ARCH-0200` }],
      keepReferences: [{ filePath: ARCH, line: f.line("MIXEDROW") }]
    });
    expect(result.error?.code).toBe("MUTATION_DENIED");
  });

  // @req FR-NODE-317 AC-1
  it("an underscore-wrapped mention is a match, counted and rewritten", async () => {
    const { f, outside } = await withOutside(`| Requirement | ${DUP} | depends_on | OUTSIDEROW and _${DUP}_ |`);
    const result = await apply(f, {
      referenceEdits: [renameAll(f), { filePath: ARCH, line: outside, from: DUP, to: NEW, occurrence: "all" }],
      keepReferences: [{ filePath: ARCH, line: f.line("MIXEDROW") }]
    });
    expect(result.ok, JSON.stringify(result.error)).toBe(true);
    expect((await f.arch()).split("\n")[outside - 1]).toBe(`| Requirement | ${NEW} | depends_on | OUTSIDEROW and _${NEW}_ |`);
  });

  // @req FR-NODE-317 AC-5
  // @req FR-NODE-317 AC-8
  it("a line naming only a longer id is not a reference to the duplicate id anywhere", async () => {
    const { f, outside } = await withOutside(`| Requirement | FR-ARCH-0010 | depends_on | OUTSIDEROW |`);
    const planned = await plan(f, { referenceEdits: [renameAll(f)], keepReferences: [{ filePath: ARCH, line: f.line("MIXEDROW") }] });
    expect(planned.ok, JSON.stringify(planned.error)).toBe(true);
    expect(planned.value?.ambiguousReferences.map((item) => item.line)).not.toContain(outside);
    const group = (await diagnoseRequirementIdCollisions(await resolveProjectRoot(f.rootPath))).value.groups.find((item) => item.duplicateId === DUP)!;
    expect(group.ambiguousReferences.map((item) => item.line)).not.toContain(outside);
  });
});
