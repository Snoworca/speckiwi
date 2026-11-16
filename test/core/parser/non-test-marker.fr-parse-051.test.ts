import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../../src/cli/index.js";
import { promoteStepRequirement } from "../../../src/core/mutation/add-requirement.js";
import { updateStatus } from "../../../src/core/mutation/update-status.js";
import { parseWorkGraph, type WorkGraph } from "../../../src/core/orchestrator/wave-declaration.js";
import { deriveWorkGraphState, type StateRecord } from "../../../src/core/orchestrator/work-graph-state.js";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { checkTestSufficiency } from "../../../src/core/testing/test-sufficiency.js";
import type { RequirementRecord } from "../../../src/core/types.js";
import { collectAcCoverageGaps, namesNonTestCriterion } from "../../../src/core/workflow/release-readiness.js";
import { createMcpServer } from "../../../src/mcp/server.js";
import { acFixture, scopeText } from "../ac-expiry-fixture.js";

// @req FR-PARSE-051 — a criterion marked `[NON-TEST]` is checked by something other than this
// repository's automated tests, so the test-sufficiency check, the verified write and the work-graph
// state judge it by a non-test evidence row that names it, never by a citation or an `all` row.

const MANUAL_AC2 = "| VE-1 | manual | docs/checks/login.md | AC-2 | checked on a running server 2026-11-11 |";
const MANUAL_ALL = "| VE-2 | manual | docs/checks/all.md | all | everything at once |";

async function citeAc1(rootPath: string): Promise<void> {
  await mkdir(path.join(rootPath, "test"), { recursive: true });
  await writeFile(path.join(rootPath, "test", "arch.test.ts"), "// FR-ARCH-001 AC-1 is cited here\n", "utf8");
}

async function record(rootPath: string) {
  const workspace = await parseWorkspace({ root: rootPath });
  const found = workspace.records.find((entry) => entry.id === "FR-ARCH-001");
  if (!found) throw new Error("FR-ARCH-001 not parsed");
  return { workspace, found };
}

describe("FR-PARSE-051 AC-1 — the marker grammar", () => {
  // @req FR-PARSE-051 AC-1
  it("reads a numbered line ending in ` [NON-TEST]` as a live non-test criterion without the marker in its text", async () => {
    const rootPath = await acFixture({ acLines: ["- [x] AC-1: cited", "- [x] AC-2: checked on a running server [NON-TEST]"] });
    const { found } = await record(rootPath);
    expect(found.acceptanceCriteria.find((entry) => entry.id === "AC-2")).toMatchObject({ id: "AC-2", text: "checked on a running server", checked: true, nonTest: true });
    expect(found.acceptanceCriteria.find((entry) => entry.id === "AC-1")).not.toHaveProperty("nonTest");
  });

  // @req FR-PARSE-051 AC-1
  it("keeps every other spelling an ordinary criterion with its text as written", async () => {
    const lines = [
      "- [ ] AC-1: the marker [NON-TEST] sits in the middle",
      "- [ ] AC-2: [NON-TEST]",
      "- [ ] AC-3: lower case [non-test]",
      "- [ ] AC-4: no space before[NON-TEST]",
      "- [ ] an unnumbered line [NON-TEST]"
    ];
    const rootPath = await acFixture({ acLines: lines });
    const { found } = await record(rootPath);
    expect(found.acceptanceCriteria.map((entry) => [entry.text, "nonTest" in entry])).toEqual([
      ["the marker [NON-TEST] sits in the middle", false],
      ["[NON-TEST]", false],
      ["lower case [non-test]", false],
      ["no space before[NON-TEST]", false],
      ["an unnumbered line [NON-TEST]", false]
    ]);
  });

  // @req FR-PARSE-051 AC-1
  it("returns a line that is also expired as expired only", async () => {
    const rootPath = await acFixture({ acLines: ["- [x] AC-1: live", "- [x] AC-2: ~~gone~~ [EXPIRED 2026-01-02] [NON-TEST]"] });
    const { found } = await record(rootPath);
    expect(found.acceptanceCriteria.map((entry) => entry.id)).toEqual(["AC-1"]);
    expect(found.expiredAcceptanceCriteria?.map((entry) => entry.id)).toEqual(["AC-2"]);
  });
});

describe("FR-PARSE-051 AC-2 — which evidence row names a non-test criterion", () => {
  const row = (type: string, covers: string) => ({ id: "VE-1", type, reference: "r", covers, notes: "" });

  // @req FR-PARSE-051 AC-2
  it.each([
    ["manual", "AC-2", true],
    ["inspection", "AC-1, AC-2", true],
    [" Manual ", "ac-2", true],
    ["manual", "all", false],
    ["test", "AC-2", false],
    [" TEST ", "AC-2", false],
    ["manual", "AC-21", false],
    ["manual", "AC-1", false]
  ])("type %j with covers %j names AC-2: %s", (type, covers, expected) => {
    expect(namesNonTestCriterion(row(type, covers), "AC-2")).toBe(expected);
  });
});

describe("FR-PARSE-051 AC-3 — the test-sufficiency check lists marked criteria apart", () => {
  // @req FR-PARSE-051 AC-3
  it("leaves marked criteria out of gaps, lists them with the rows that name them, and passes on gaps alone", async () => {
    const rootPath = await acFixture({
      acLines: ["- [x] AC-1: cited", "- [x] AC-2: login on a running server [NON-TEST]", "- [ ] AC-3: only an all row [NON-TEST]"],
      evidenceRows: [MANUAL_AC2, MANUAL_ALL]
    });
    await citeAc1(rootPath);
    const { workspace } = await record(rootPath);
    const result = await checkTestSufficiency(workspace, { ids: ["FR-ARCH-001"] });
    expect(result.ok).toBe(true);
    const report = result.value!;
    expect(report.gaps.requirements).toEqual([]);
    expect(report.passed).toBe(true);
    expect(report.nonTest).toEqual([
      { requirementId: "FR-ARCH-001", acId: "AC-2", evidence: ["VE-1"], evidenced: true },
      { requirementId: "FR-ARCH-001", acId: "AC-3", evidence: [], evidenced: false }
    ]);
    const acs = report.requirements[0]!.acs;
    expect(acs.find((ac) => ac.acId === "AC-2")).toMatchObject({ nonTest: true });
    expect(acs.find((ac) => ac.acId === "AC-1")).not.toHaveProperty("nonTest");
  });

  // @req FR-PARSE-051 AC-3
  it("still reports an uncited unmarked criterion as a gap beside a marked one", async () => {
    const rootPath = await acFixture({ acLines: ["- [x] AC-1: uncited", "- [x] AC-2: manual [NON-TEST]"], evidenceRows: [MANUAL_AC2] });
    const { workspace } = await record(rootPath);
    const report = (await checkTestSufficiency(workspace, { ids: ["FR-ARCH-001"] })).value!;
    expect(report.gaps.requirements).toEqual([{ requirementId: "FR-ARCH-001", acIds: ["AC-1"] }]);
    expect(report.passed).toBe(false);
  });

  // @req FR-PARSE-051 AC-3
  it("adds no field at all when nothing in scope is marked", async () => {
    const rootPath = await acFixture({ acLines: ["- [x] AC-1: cited", "- [ ] AC-2: uncited"], evidenceRows: [MANUAL_AC2] });
    await citeAc1(rootPath);
    const { workspace } = await record(rootPath);
    const report = (await checkTestSufficiency(workspace, { ids: ["FR-ARCH-001"] })).value!;
    expect(Object.keys(report)).not.toContain("nonTest");
    expect(JSON.stringify(report)).not.toContain("nonTest");
    expect(report.gaps.requirements).toEqual([{ requirementId: "FR-ARCH-001", acIds: ["AC-2"] }]);
  });

  // @req FR-PARSE-051 AC-3
  it("answers the same through MCP check_test_sufficiency", async () => {
    const rootPath = await acFixture({ acLines: ["- [x] AC-1: cited", "- [x] AC-2: manual [NON-TEST]"], evidenceRows: [MANUAL_AC2] });
    await citeAc1(rootPath);
    const result = (await createMcpServer({ root: rootPath }).callTool("check_test_sufficiency", { ids: ["FR-ARCH-001"] })) as { ok: boolean; value?: { nonTest?: unknown; passed?: boolean } };
    expect(result.ok).toBe(true);
    expect(result.value?.nonTest).toEqual([{ requirementId: "FR-ARCH-001", acId: "AC-2", evidence: ["VE-1"], evidenced: true }]);
    expect(result.value?.passed).toBe(true);
  });
});

describe("FR-PARSE-051 AC-4 — the CLI prints one line per marked criterion", () => {
  // @req FR-PARSE-051 AC-4
  it("prints evidenced and unevidenced lines", async () => {
    const rootPath = await acFixture({
      acLines: ["- [x] AC-1: cited", "- [x] AC-2: manual [NON-TEST]", "- [ ] AC-3: unnamed [NON-TEST]"],
      evidenceRows: [MANUAL_AC2, MANUAL_ALL]
    });
    await citeAc1(rootPath);
    const streams = { stdout: new PassThrough(), stderr: new PassThrough() };
    await main(["--root", rootPath, "coverage", "--tests", "--ids", "FR-ARCH-001"], streams);
    const text = streams.stdout.read()?.toString() ?? "";
    expect(text.split("\n")).toEqual(expect.arrayContaining(["non-test FR-ARCH-001 AC-2 evidenced", "non-test FR-ARCH-001 AC-3 unevidenced"]));
    expect(text).not.toContain("gap FR-ARCH-001 AC-3");
  });
});

describe("FR-PARSE-051 AC-5 — verified needs a row that names each marked criterion", () => {
  // @req FR-PARSE-051 AC-5
  it("refuses verified without writing, naming the criterion only an `all` row covers", async () => {
    const rootPath = await acFixture({
      acLines: ["- [x] AC-1: cited", "- [x] AC-2: manual [NON-TEST]", "- [x] AC-3: covered by all only [NON-TEST]"],
      status: "implemented",
      evidenceRows: [MANUAL_AC2, MANUAL_ALL, "| VE-3 | test | test/arch.test.ts | AC-1 | cited |"]
    });
    await citeAc1(rootPath);
    await mkdir(path.join(rootPath, "docs", "checks"), { recursive: true });
    await writeFile(path.join(rootPath, "docs", "checks", "login.md"), "checked\n", "utf8");
    await writeFile(path.join(rootPath, "docs", "checks", "all.md"), "checked\n", "utf8");
    const before = await scopeText(rootPath);
    const result = await updateStatus(await resolveProjectRoot(rootPath), { id: "FR-ARCH-001", status: "verified" });
    expect(result.ok).toBe(false);
    expect(result.error?.message).toContain("AC-3");
    expect(result.error?.message).not.toContain("AC-2");
    expect(await scopeText(rootPath)).toBe(before);
  });

  // @req FR-PARSE-051 AC-5
  it("writes verified once every marked criterion is named", async () => {
    const rootPath = await acFixture({
      acLines: ["- [x] AC-1: cited", "- [x] AC-2: manual [NON-TEST]"],
      status: "implemented",
      evidenceRows: [MANUAL_AC2, "| VE-3 | test | test/arch.test.ts | AC-1 | cited |"]
    });
    await citeAc1(rootPath);
    await mkdir(path.join(rootPath, "docs", "checks"), { recursive: true });
    await writeFile(path.join(rootPath, "docs", "checks", "login.md"), "checked\n", "utf8");
    const result = await updateStatus(await resolveProjectRoot(rootPath), { id: "FR-ARCH-001", status: "verified" });
    expect(result.ok, JSON.stringify(result.error)).toBe(true);
  });
});

describe("FR-PARSE-051 AC-6 — a marked criterion is done by the row that names it", () => {
  const graph = (): WorkGraph => {
    const parsed = parseWorkGraph({
      schema_version: "2.0.0",
      run_id: "run-a",
      title: "g",
      scope: { target: "5.5.2" },
      nodes: [{ wave: "wave-1", title: "n", purpose: "p", acs: ["FR-A-001 AC-1", "FR-A-001 AC-2"], done_when: [], files: ["src/a.ts"] }],
      edges: []
    });
    if (!parsed.ok) throw new Error(parsed.message);
    return parsed.graph;
  };
  const records = (covers: string): StateRecord[] => [
    {
      id: "FR-A-001",
      status: "implemented",
      acceptanceCriteria: [
        { id: "AC-1", text: "cited", checked: true, line: 1 },
        { id: "AC-2", text: "manual", checked: true, line: 2, nonTest: true }
      ],
      verificationEvidence: [
        { id: "VE-1", type: "test", reference: "t", covers: "AC-1", notes: "" },
        { id: "VE-2", type: "manual", reference: "m", covers, notes: "" }
      ]
    }
  ];
  const doneOf = (covers: string) =>
    deriveWorkGraphState({ graph: graph(), records: records(covers), cited: new Set(["FR-A-001 AC-1"]), journal: [] }).nodes[0]!.acs.map((ac) => [ac.ref, ac.done]);

  // @req FR-PARSE-051 AC-6
  it("counts the marked criterion done without a citation when a non-test row names it", () => {
    expect(doneOf("AC-2")).toEqual([["FR-A-001 AC-1", true], ["FR-A-001 AC-2", true]]);
  });

  // @req FR-PARSE-051 AC-6
  it("does not let an `all` row stand in for the naming row", () => {
    expect(doneOf("all")).toEqual([["FR-A-001 AC-1", true], ["FR-A-001 AC-2", false]]);
  });
});

describe("FR-PARSE-051 AC-7 — the bundled rules state the marker and the authoring rules around it", () => {
  const rules = () => readFileSync(path.resolve(import.meta.dirname, "../../../docs/rule/SRS-MD-Rules-v2.7.0.md"), "utf8");
  const sectionOf = (text: string, heading: string) => {
    const start = text.indexOf(`\n${heading}`);
    if (start < 0) return "";
    const next = text.slice(start + 1).search(/\n#{2,3} /);
    return next < 0 ? text.slice(start) : text.slice(start, start + 1 + next);
  };

  // @req FR-PARSE-051 AC-7
  it.each([
    ["### 21.8 Non-test Acceptance Criteria", "2. The grammar is `AC-{N}: <text> [NON-TEST]`: one or more spaces and `[NON-TEST]` closing a line with text before it. Any other spelling is part of an ordinary criterion's text. A line that is also expired (§21.7) is expired only."],
    ["### 21.8 Non-test Acceptance Criteria", "1. The marker is written and removed only by the tool: `mark_acceptance_criterion_non_test` (CLI `speckiwi mark-ac-non-test <id> <acId> --reason <text>`) appends it and a Change Notes row `Marked AC-{N} non-test` carrying the required reason in the same patch"],
    ["### 21.8 Non-test Acceptance Criteria", "3. Mark only a check this repository's automated tests cannot reproduce."],
    ["### 21.8 Non-test Acceptance Criteria", "A row names it when its `Type` is not `Test` and its `Covers` lists the criterion; `all` does not name it (§22.3)."],
    ["### 22.3 Evidence ID Rules", "5. `all` does not cover a criterion marked `[NON-TEST]` (§21.8): name it in `Covers` of a non-test row."],
    ["### 14.4 verified Conditions", "8. Every live criterion marked `[NON-TEST]` is named by an evidence row whose `Type` is not `Test` and whose `Covers` lists that criterion; `all` does not name it. The tool refuses `verified` otherwise and names the criterion."],
    ["### 21.3 Authoring Rules", "8. An AC judges a result this repository produces. Another system's behaviour belongs to that system's requirement: move it there and expire the original criterion naming that requirement as successor (§21.7)."],
    ["### 21.3 Authoring Rules", "9. A declared limitation or a scope statement is not an AC: write it in `Rationale` or `Implementation Notes`, or in the scope document's `Out of Scope`."]
  ])("%s states: %s", (heading, sentence) => {
    expect(sectionOf(rules(), heading)).toContain(sentence);
  });
});

describe("FR-PARSE-051 AC-5 — a verified step promotion is held to the same rule", () => {
  async function stepWith(rootPath: string, evidenceRows: string[]): Promise<void> {
    const dir = path.join(rootPath, "docs", "spec", "steps", "lane-n");
    await mkdir(dir, { recursive: true });
    const block = [
      "### FR-ARCH-061 — Step requirement",
      "",
      "| Field | Value |",
      "| --- | --- |",
      "| Type | functional |",
      "| Target | v1.0.0 |",
      "| Status | verified |",
      "| Priority | medium |",
      "| Tags | - |",
      "| Risk | medium |",
      "| Stability | evolving |",
      "| Verification Method | test |",
      "| GitHub Issue | - |",
      "| Related Docs | - |",
      "",
      "#### Requirement",
      "",
      "The step SHALL hold one requirement.",
      "",
      "#### Acceptance Criteria",
      "",
      "- [x] AC-1: The requirement can be listed.",
      "- [x] AC-2: Checked on a running server. [NON-TEST]",
      "",
      "#### Verification Evidence",
      "",
      "| Evidence ID | Type | Reference | Covers | Notes |",
      "| --- | --- | --- | --- | --- |",
      ...evidenceRows,
      ""
    ];
    const text = ["# Step Architecture", "", "| Field | Value |", "|---|---|", "| Document Type | scope_srs |", "| Scope | ARCH |", "| Scope Name | Product Architecture |", "", "## 4. Requirements", "", ...block].join("\n");
    await writeFile(path.join(dir, "10.product-architecture.srs.md"), text, "utf8");
  }

  // @req FR-PARSE-051 AC-5
  it("refuses to promote a verified step requirement whose marked criterion only an `all` row covers", async () => {
    const rootPath = await acFixture({ acLines: ["- [ ] AC-1: first"] });
    await stepWith(rootPath, ["| VE-1 | test | docs/spec/00.index.md | all | - |"]);
    const before = await scopeText(rootPath);
    const result = await promoteStepRequirement(await resolveProjectRoot(rootPath), { id: "FR-ARCH-061", fromStep: "lane-n", toScope: "ARCH" });
    expect(result.ok).toBe(false);
    expect(result.error?.message).toContain("AC-2");
    expect(await scopeText(rootPath)).toBe(before);
  });

  // @req FR-PARSE-051 AC-5
  it("promotes it once a non-test row names the criterion", async () => {
    const rootPath = await acFixture({ acLines: ["- [ ] AC-1: first"] });
    await stepWith(rootPath, ["| VE-1 | test | docs/spec/00.index.md | AC-1 | - |", "| VE-2 | manual | docs/spec/00.index.md | AC-2 | checked |"]);
    const result = await promoteStepRequirement(await resolveProjectRoot(rootPath), { id: "FR-ARCH-061", fromStep: "lane-n", toScope: "ARCH" });
    expect(result.ok, JSON.stringify(result.error)).toBe(true);
  });
});

describe("FR-PARSE-051 AC-2 — release readiness reads the same naming rule", () => {
  const verified = (covers: string) =>
    ({
      id: "FR-A-001",
      status: "verified",
      acceptanceCriteria: [
        { id: "AC-1", text: "cited", checked: true, line: 1 },
        { id: "AC-2", text: "manual", checked: true, line: 2, nonTest: true }
      ],
      verificationEvidence: [
        { id: "VE-1", type: "test", reference: "t", covers: "all", notes: "" },
        { id: "VE-2", type: "manual", reference: "m", covers, notes: "" }
      ]
    }) as unknown as RequirementRecord;

  // @req FR-PARSE-051 AC-2
  it("reports a marked criterion that only an `all` row covers as an AC coverage gap", () => {
    expect(collectAcCoverageGaps([verified("all")])).toEqual([{ requirementId: "FR-A-001", missingAcIds: ["AC-2"] }]);
  });

  // @req FR-PARSE-051 AC-2
  it("reports none once a non-test row names it", () => {
    expect(collectAcCoverageGaps([verified("AC-2")])).toEqual([]);
  });
});
