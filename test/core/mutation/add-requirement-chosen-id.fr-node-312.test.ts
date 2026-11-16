import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../../src/cli/index.js";
import { addRequirement, promoteStepRequirement, type AddRequirementInput } from "../../../src/core/mutation/add-requirement.js";
import { applyRequirementIdCollisionRepair, diagnoseRequirementIdCollisions, planRequirementIdCollisionRepair } from "../../../src/core/mutation/repair-requirement-id.js";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { validateWorkspace } from "../../../src/core/validator/validate-workspace.js";
import { createMcpServer } from "../../../src/mcp/server.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";
import { snapshotTree } from "../../support/discarded-target-fixture.js";

// @req FR-NODE-312 — add_requirement takes a free Requirement ID the caller chose (parallel worktrees
// that pre-agreed their numbers), checked by one availability rule that promote and the collision
// repair's replacement id use too.

const SPEC_FILE = path.join("docs", "spec", "10.product-architecture.srs.md");
const HISTORY_FILE = path.join("docs", "spec", "91.completed-work-log.md");

function input(extra: Partial<AddRequirementInput> & Record<string, unknown> = {}): AddRequirementInput {
  return {
    type: "functional",
    scope: "ARCH",
    target: "v1.0.0",
    title: "Chosen id",
    statement: "SpecKiwi SHALL keep the requirement the lane reserved.",
    acceptanceCriteria: ["The requirement can be listed."],
    stability: "evolving",
    ...extra
  } as AddRequirementInput;
}

async function workspace(): Promise<string> {
  return copyFixtureWorkspace("mutation-target");
}

async function writeHistory(rootPath: string, id: string): Promise<void> {
  await writeFile(
    path.join(rootPath, HISTORY_FILE),
    ["# Completed Work Log", "", "| Date | Target | Scope | Requirement IDs | Summary | Reports |", "|---|---|---|---|---|---|", `| 2026-01-02 | v1.0.0 | ARCH | ${id} | an old row | |`, ""].join("\n"),
    "utf8"
  );
}

async function writeStep(rootPath: string, stepName: string, id: string): Promise<void> {
  const dir = path.join(rootPath, "docs", "spec", "steps", stepName);
  await mkdir(dir, { recursive: true });
  const block = [
    `### ${id} — Step requirement`,
    "",
    "| Field | Value |",
    "| --- | --- |",
    "| Type | functional |",
    "| Target | v1.0.0 |",
    "| Status | planned |",
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
    "- [ ] AC-1: The requirement can be listed.",
    "",
    "#### Verification Evidence",
    "",
    "| Evidence ID | Type | Reference | Covers | Notes |",
    "| --- | --- | --- | --- | --- |",
    "| VE-1 | test | docs/spec/00.index.md | AC-1 | - |",
    ""
  ];
  const text = ["# Step Architecture", "", "| Field | Value |", "|---|---|", "| Document Type | scope_srs |", "| Scope | ARCH |", "| Scope Name | Product Architecture |", "", "## 4. Requirements", "", ...block].join("\n");
  await writeFile(path.join(dir, "10.product-architecture.srs.md"), text, "utf8");
}

async function headings(rootPath: string): Promise<string[]> {
  return (await readFile(path.join(rootPath, SPEC_FILE), "utf8")).split(/\r?\n/).filter((line) => line.startsWith("### FR-"));
}

async function cli(rootPath: string, args: string[]): Promise<{ ok: boolean; error?: { code: string; message: string }; value?: Record<string, unknown> }> {
  const streams = { stdout: new PassThrough(), stderr: new PassThrough() };
  await main(["--root", rootPath, ...args, "--json"], streams);
  return JSON.parse(streams.stdout.read()?.toString() ?? "{}");
}

describe("FR-NODE-312 AC-1 — a free caller-chosen id is written as given", () => {
  // @req FR-NODE-312 AC-1
  it("writes FR-ARCH-076 above the series and reports the caller as the id source", async () => {
    const rootPath = await workspace();
    const result = await addRequirement(await resolveProjectRoot(rootPath), input({ requirementId: "FR-ARCH-076" }));
    expect(result.ok, JSON.stringify(result.error)).toBe(true);
    expect(result.value).toMatchObject({ requirementId: "FR-ARCH-076", written: true, idSource: "caller" });
    expect(await headings(rootPath)).toContain("### FR-ARCH-076 — Chosen id");
    const parsed = await parseWorkspace(await resolveProjectRoot(rootPath));
    expect(parsed.records.map((record) => record.id)).toContain("FR-ARCH-076");
  });

  // @req FR-NODE-312 AC-1
  it("accepts a number below the series maximum when no document has used it", async () => {
    const rootPath = await workspace();
    const root = await resolveProjectRoot(rootPath);
    expect((await addRequirement(root, input({ requirementId: "FR-ARCH-076" }))).ok).toBe(true);
    const lower = await addRequirement(root, input({ requirementId: "FR-ARCH-074", title: "Lane H" }));
    expect(lower.ok, JSON.stringify(lower.error)).toBe(true);
    expect(lower.value?.requirementId).toBe("FR-ARCH-074");
    // The generator keeps going from the maximum, so a reserved lower number is never handed out again.
    const generated = await addRequirement(root, input({ title: "Generated" }));
    expect(generated.value?.requirementId).toBe("FR-ARCH-077");
  });
});

describe("FR-NODE-312 AC-2 — an unusable id is refused, naming the check, and nothing changes", () => {
  const CASES: Array<{ label: string; id: string; check: string; seed?: (rootPath: string) => Promise<void>; where?: string }> = [
    { label: "a malformed id", id: "FR-ARCH-76", check: "format" },
    { label: "a prefix of another type", id: "NFR-ARCH-076", check: "type-prefix" },
    { label: "another scope's segment", id: "FR-OTHER-076", check: "scope" },
    { label: "an id a heading holds", id: "FR-ARCH-001", check: "in-use", where: "docs/spec/10.product-architecture.srs.md" },
    { label: "an id only the completed-work history file holds", id: "FR-ARCH-050", check: "in-use", seed: (rootPath) => writeHistory(rootPath, "FR-ARCH-050"), where: "docs/spec/91.completed-work-log.md" },
    { label: "an id only a step SRS document holds", id: "FR-ARCH-060", check: "in-use", seed: (rootPath) => writeStep(rootPath, "lane-g", "FR-ARCH-060"), where: "docs/spec/steps/lane-g/10.product-architecture.srs.md" }
  ];
  for (const dryRun of [false, true]) {
    for (const item of CASES) {
      // @req FR-NODE-312 AC-2 AC-6
      it(`refuses ${item.label}${dryRun ? " under a dry run" : ""} and leaves every file byte-identical`, async () => {
        const rootPath = await workspace();
        await item.seed?.(rootPath);
        const before = await snapshotTree(rootPath);
        const result = await addRequirement(await resolveProjectRoot(rootPath), input({ requirementId: item.id, dryRun }));
        expect(result.ok).toBe(false);
        expect(result.error?.message).toContain(item.id);
        expect(result.error?.message).toContain(`check: ${item.check}`);
        if (item.where) expect(result.error?.message).toContain(item.where);
        expect(await snapshotTree(rootPath)).toEqual(before);
      });
    }
  }
});

describe("FR-NODE-312 AC-3 — without requirementId the call is unchanged", () => {
  // @req FR-NODE-312 AC-3
  it("allocates the next id and answers without the caller-id fields, the same with the key absent or undefined", async () => {
    const left = await workspace();
    const right = await workspace();
    const absent = await addRequirement(await resolveProjectRoot(left), input());
    const undef = await addRequirement(await resolveProjectRoot(right), input({ requirementId: undefined }));
    expect(absent.value?.requirementId).toBe("FR-ARCH-002");
    expect(absent.value).not.toHaveProperty("idSource");
    expect(absent.value).not.toHaveProperty("idNotice");
    // kiwi/.status.json stamps the time it was written, so the SRS documents are what is compared.
    const docs = async (rootPath: string) => [...(await snapshotTree(rootPath))].filter(([file]) => file.startsWith("docs/"));
    expect(await docs(right)).toEqual(await docs(left));
    expect(JSON.stringify(undef.value)).toBe(JSON.stringify(absent.value));
  });
});

describe("FR-NODE-312 AC-4 — the result says only this checkout was consulted", () => {
  // @req FR-NODE-312 AC-4
  it("carries a notice naming this checkout and the branches and worktrees it did not see", async () => {
    const rootPath = await workspace();
    const result = await addRequirement(await resolveProjectRoot(rootPath), input({ requirementId: "FR-ARCH-076", dryRun: true }));
    expect(result.ok).toBe(true);
    expect(result.value).toMatchObject({ requirementId: "FR-ARCH-076", written: false, idSource: "caller" });
    const notice = String((result.value as Record<string, unknown>).idNotice);
    expect(notice).toMatch(/this checkout/);
    expect(notice).toMatch(/other branches and worktrees were not consulted/);
    expect(await headings(rootPath)).not.toContain("### FR-ARCH-076 — Chosen id");
  });
});

describe("FR-NODE-312 AC-5 — a racing writer of the same id is refused, never renumbered", () => {
  // @req FR-NODE-312 AC-5
  it("lands the id once when four callers race for it, and no caller gets another number", async () => {
    const rootPath = await workspace();
    const root = await resolveProjectRoot(rootPath);
    const results = await Promise.all([0, 1, 2, 3].map((n) => addRequirement(root, input({ requirementId: "FR-ARCH-076", title: `Racer ${n}`, skipLock: true }))));
    const landed = results.filter((result) => result.ok);
    expect(landed.length).toBeGreaterThanOrEqual(1);
    for (const result of results) {
      if (result.ok) expect(result.value?.requirementId).toBe("FR-ARCH-076");
    }
    expect((await headings(rootPath)).filter((line) => line.startsWith("### FR-ARCH-076 "))).toHaveLength(1);
    expect((await headings(rootPath)).filter((line) => /^### FR-ARCH-0(0[2-9]|[1-9]\d) /.test(line) && !line.startsWith("### FR-ARCH-076 "))).toEqual([]);
  });

  // @req FR-NODE-312 AC-5
  it("under the lock, the second caller of a taken id is refused with in-use", async () => {
    const rootPath = await workspace();
    const root = await resolveProjectRoot(rootPath);
    const [first, second] = await Promise.all([
      addRequirement(root, input({ requirementId: "FR-ARCH-076", title: "First" })),
      addRequirement(root, input({ requirementId: "FR-ARCH-076", title: "Second" }))
    ]);
    const outcomes = [first, second].map((result) => (result.ok ? "ok" : result.error?.code ?? "?"));
    expect(outcomes.filter((outcome) => outcome === "ok")).toHaveLength(1);
    const refused = [first, second].find((result) => !result.ok);
    expect(refused?.error?.message ?? "").toMatch(/check: in-use|lock/i);
    expect((await headings(rootPath)).filter((line) => line.startsWith("### FR-ARCH-076 "))).toHaveLength(1);
  });
});

describe("FR-NODE-312 AC-7 — promote and the collision repair use the same availability check", () => {
  // @req FR-NODE-312 AC-7
  it("promote refuses a step id whose scope segment is not the target scope", async () => {
    const rootPath = await workspace();
    await writeStep(rootPath, "lane-x", "FR-OTHER-007");
    const before = await readFile(path.join(rootPath, SPEC_FILE), "utf8");
    const result = await promoteStepRequirement(await resolveProjectRoot(rootPath), { id: "FR-OTHER-007", fromStep: "lane-x", toScope: "ARCH" });
    expect(result.ok).toBe(false);
    expect(result.error?.message).toContain("check: scope");
    expect(await readFile(path.join(rootPath, SPEC_FILE), "utf8")).toBe(before);
  });

  // @req FR-NODE-312 AC-7
  it("promote refuses a step id the completed-work history file already names", async () => {
    const rootPath = await workspace();
    await writeStep(rootPath, "lane-y", "FR-ARCH-050");
    await writeHistory(rootPath, "FR-ARCH-050");
    const result = await promoteStepRequirement(await resolveProjectRoot(rootPath), { id: "FR-ARCH-050", fromStep: "lane-y", toScope: "ARCH" });
    expect(result.ok).toBe(false);
    expect(result.error?.message).toContain("check: in-use");
    expect(result.error?.message).toContain("docs/spec/91.completed-work-log.md");
  });

  // @req FR-NODE-312 AC-7
  it("promote still lands a free step id of the target scope, its own step document aside", async () => {
    const rootPath = await workspace();
    await writeStep(rootPath, "lane-z", "FR-ARCH-050");
    const result = await promoteStepRequirement(await resolveProjectRoot(rootPath), { id: "FR-ARCH-050", fromStep: "lane-z", toScope: "ARCH" });
    expect(result.ok, JSON.stringify(result.error)).toBe(true);
    expect(await headings(rootPath)).toContain("### FR-ARCH-050 — Step requirement");
  });

  async function duplicateGroup(rootPath: string) {
    const groups = (await diagnoseRequirementIdCollisions(await resolveProjectRoot(rootPath))).value.groups;
    const group = groups.find((item) => item.duplicateId === "FR-ARCH-001");
    if (!group) throw new Error("duplicate group not found");
    return group;
  }

  for (const item of [
    { label: "another scope's segment", id: "FR-OTHER-002", check: "scope" },
    { label: "a prefix of another type", id: "NFR-ARCH-002", check: "type-prefix" },
    { label: "an id the history file names", id: "FR-ARCH-040", check: "in-use", seed: (rootPath: string) => writeHistory(rootPath, "FR-ARCH-040") }
  ]) {
    // @req FR-NODE-312 AC-7
    it(`the repair refuses a replacement id with ${item.label}, in plan and in apply`, async () => {
      const rootPath = await copyFixtureWorkspace("duplicate-id");
      await item.seed?.(rootPath);
      const group = await duplicateGroup(rootPath);
      const root = await resolveProjectRoot(rootPath);
      const before = await snapshotTree(rootPath);
      const request = { duplicateId: group.duplicateId, keep: group.occurrences[0]!, rename: group.occurrences[1]!, replacementId: item.id };
      const planned = await planRequirementIdCollisionRepair(root, request);
      expect(planned.ok).toBe(false);
      expect(planned.error?.message).toContain(`check: ${item.check}`);
      const applied = await applyRequirementIdCollisionRepair(root, request);
      expect(applied.ok).toBe(false);
      // The repair takes the mutation lock, which refreshes kiwi/.status.json (FR-NODE-273); the documents are what must not change.
      const docs = (tree: Map<string, string>) => [...tree].filter(([file]) => file.startsWith("docs/"));
      expect(docs(await snapshotTree(rootPath))).toEqual(docs(before));
    });
  }

  // @req FR-NODE-312 AC-7
  it("the repair still takes a free replacement id of the same series", async () => {
    const rootPath = await copyFixtureWorkspace("duplicate-id");
    const group = await duplicateGroup(rootPath);
    const applied = await applyRequirementIdCollisionRepair(await resolveProjectRoot(rootPath), { duplicateId: group.duplicateId, keep: group.occurrences[0]!, rename: group.occurrences[1]!, replacementId: "FR-ARCH-040" });
    expect(applied.ok, JSON.stringify(applied.error)).toBe(true);
  });
});

describe("FR-NODE-312 AC-2 AC-7 — review round 1", () => {
  // @req FR-NODE-312 AC-2
  // A zero-padded four-digit spelling names the number a three-digit id already holds; the generator and
  // the status cache count both as the same number, so it is in use however it is padded.
  it("refuses a zero-padded spelling of a number already used", async () => {
    const rootPath = await workspace();
    const before = await snapshotTree(rootPath);
    const result = await addRequirement(await resolveProjectRoot(rootPath), input({ requirementId: "FR-ARCH-0001" }));
    expect(result.ok).toBe(false);
    expect(result.error?.message).toContain("check: in-use");
    expect(await snapshotTree(rootPath)).toEqual(before);
  });

  // @req FR-NODE-312 AC-7 — a block whose Type cell is not a known type still gets the format and in-use
  // checks; only the type-prefix check needs a type.
  it("the repair still refuses a replacement already in use when the renamed block's Type is not a known type", async () => {
    const rootPath = await copyFixtureWorkspace("duplicate-id");
    const spec = path.join(rootPath, SPEC_FILE);
    const lines = (await readFile(spec, "utf8")).split("\n");
    const second = lines.findIndex((line, index) => index > lines.findIndex((l) => l === "| Type | functional |") && line === "| Type | functional |");
    lines[second] = "| Type | feature |";
    await writeFile(spec, lines.join("\n"), "utf8");
    await writeHistory(rootPath, "FR-ARCH-040");
    const group = await duplicateGroup(rootPath);
    const planned = await planRequirementIdCollisionRepair(await resolveProjectRoot(rootPath), { duplicateId: group.duplicateId, keep: group.occurrences[0]!, rename: group.occurrences[1]!, replacementId: "FR-ARCH-040" });
    expect(planned.ok).toBe(false);
    expect(planned.error?.message).toContain("check: in-use");
  });

  // @req FR-NODE-312 AC-7 — next_available and diagnose's candidate skip a number an SRS document already
  // names, so the candidate diagnose offers is one plan accepts.
  it("next_available and the diagnose candidate skip a number only the history file names", async () => {
    const rootPath = await copyFixtureWorkspace("duplicate-id");
    await writeHistory(rootPath, "FR-ARCH-002");
    const group = await duplicateGroup(rootPath);
    expect(group.candidateReplacementIds).toEqual(["FR-ARCH-003"]);
    const planned = await planRequirementIdCollisionRepair(await resolveProjectRoot(rootPath), { duplicateId: group.duplicateId, keep: group.occurrences[0]!, rename: group.occurrences[1]!, allocationStrategy: "next_available" });
    expect(planned.ok, JSON.stringify(planned.error)).toBe(true);
    expect(JSON.stringify(planned.value)).toContain("FR-ARCH-003");
  });
});

describe("FR-NODE-312 AC-7 — review round 2", () => {
  // @req FR-NODE-312 AC-7 — the next free number is looked for only up to the last four-digit number; a
  // series that already holds 9999 has none, so diagnose offers no candidate and next_available is refused
  // instead of searching forever.
  it("diagnose and next_available end when the series already holds the last number", async () => {
    const rootPath = await copyFixtureWorkspace("duplicate-id");
    const spec = path.join(rootPath, SPEC_FILE);
    const text = await readFile(spec, "utf8");
    const first = text.indexOf("### FR-ARCH-001 ");
    const block = text.slice(first, text.indexOf("### FR-ARCH-001 ", first + 1)).replace("### FR-ARCH-001 ", "### FR-ARCH-9999 ");
    await writeFile(spec, text.trimEnd() + "\n\n" + block.trimEnd() + "\n", "utf8");
    const group = await duplicateGroup(rootPath);
    expect(group.candidateReplacementIds).toEqual([]);
    const planned = await planRequirementIdCollisionRepair(await resolveProjectRoot(rootPath), { duplicateId: group.duplicateId, keep: group.occurrences[0]!, rename: group.occurrences[1]!, allocationStrategy: "next_available" });
    expect(planned.ok).toBe(false);
  }, 20000);
});

async function duplicateGroup(rootPath: string) {
  const groups = (await diagnoseRequirementIdCollisions(await resolveProjectRoot(rootPath))).value.groups;
  const group = groups.find((item) => item.duplicateId === "FR-ARCH-001");
  if (!group) throw new Error("duplicate group not found");
  return group;
}

describe("FR-NODE-312 AC-8 — unused numbers between ids are valid", () => {
  // @req FR-NODE-312 AC-8
  it("validate reports nothing about the numbers left free below a chosen id", async () => {
    const rootPath = await workspace();
    const root = await resolveProjectRoot(rootPath);
    const before = validateWorkspace(await parseWorkspace(root)).diagnostics.map((item) => item.code).sort();
    expect((await addRequirement(root, input({ requirementId: "FR-ARCH-076" }))).ok).toBe(true);
    const parsed = await parseWorkspace(root);
    expect(parsed.records.map((record) => record.id)).toContain("FR-ARCH-076");
    const after = validateWorkspace(parsed).diagnostics;
    expect(after.filter((item) => item.message.includes("FR-ARCH-076"))).toEqual([]);
    expect(after.map((item) => item.code).sort()).toEqual(before);
  });
});

describe("FR-NODE-312 — MCP and CLI take the argument", () => {
  // @req FR-NODE-312 AC-1
  it("MCP add_requirement accepts requirementId and writes that id", async () => {
    const rootPath = await workspace();
    const result = (await createMcpServer({ root: rootPath }).callTool("add_requirement", {
      type: "functional",
      scope: "ARCH",
      target: "v1.0.0",
      title: "Via MCP",
      requirement: "SpecKiwi SHALL keep the MCP requirement.",
      acceptanceCriteria: ["The requirement can be listed."],
      requirementId: "FR-ARCH-076"
    })) as { ok: boolean; value?: Record<string, unknown>; error?: { message: string } };
    expect(result.ok, JSON.stringify(result.error)).toBe(true);
    expect(result.value).toMatchObject({ requirementId: "FR-ARCH-076", idSource: "caller" });
  });

  // @req FR-NODE-312 AC-2
  it("MCP add_requirement refuses a taken requirementId with the check named", async () => {
    const rootPath = await workspace();
    const result = (await createMcpServer({ root: rootPath }).callTool("add_requirement", {
      type: "functional",
      scope: "ARCH",
      target: "v1.0.0",
      title: "Via MCP",
      requirement: "SpecKiwi SHALL keep the MCP requirement.",
      acceptanceCriteria: ["The requirement can be listed."],
      requirementId: "FR-ARCH-001"
    })) as { ok: boolean; error?: { message: string } };
    expect(result.ok).toBe(false);
    expect(result.error?.message).toContain("check: in-use");
  });

  // @req FR-NODE-312 AC-1 AC-2
  it("CLI add-requirement --requirement-id writes a free id and refuses a taken one", async () => {
    const rootPath = await workspace();
    const base = ["add-requirement", "--type", "functional", "--scope", "ARCH", "--target", "v1.0.0", "--title", "Via CLI", "--statement", "SpecKiwi SHALL keep the CLI requirement.", "--ac", "The requirement can be listed."];
    const written = await cli(rootPath, [...base, "--requirement-id", "FR-ARCH-076"]);
    expect(written.ok, JSON.stringify(written.error)).toBe(true);
    expect(written.value).toMatchObject({ requirementId: "FR-ARCH-076", idSource: "caller" });
    const refused = await cli(rootPath, [...base, "--requirement-id", "FR-ARCH-076"]);
    expect(refused.ok).toBe(false);
    expect(refused.error?.message).toContain("check: in-use");
  });
});
