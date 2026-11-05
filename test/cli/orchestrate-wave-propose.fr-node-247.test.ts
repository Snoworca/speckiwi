import { readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ORCHESTRATE_TOOL_BINDINGS, orchestrateVerbKind } from "../../src/cli/commands/orchestrate.js";
import { parseWorkGraph } from "../../src/core/orchestrator/wave-declaration.js";
import { rawGit } from "../core/orchestrator/support/git-fixture.js";
import { writeUnder } from "../core/orchestrator/sds-fixtures.js";
import { orchestrate, workGraphWorkspace, type RequirementSpec } from "./wave-graph-fixtures.js";

// FR-NODE-247 AC-1 AC-11 — `orchestrate wave propose` prints a draft 2.0.0 work graph computed from a
// requirement set and an expected-files map, writes no file, and refuses a wrong selection of scope.

const FILES = "files.json";

async function repository(requirements: readonly RequirementSpec[], files: Record<string, readonly string[]>, tracked: Record<string, string> = {}): Promise<string> {
  const { root } = await workGraphWorkspace({ requirements, noJournal: true, files: tracked });
  await rawGit(root, "init", "--initial-branch", "main");
  await rawGit(root, "config", "user.name", "Propose Fixture");
  await rawGit(root, "config", "user.email", "propose@example.invalid");
  await rawGit(root, "config", "commit.gpgsign", "false");
  await rawGit(root, "add", "--", ".");
  await rawGit(root, "commit", "-m", "base");
  await writeUnder(root, FILES, JSON.stringify(files));
  return root;
}

async function listing(root: string): Promise<string[]> {
  const entries = await readdir(root, { recursive: true });
  return entries.map((entry) => entry.split(path.sep).join("/")).filter((entry) => !entry.startsWith(".git/") && entry !== ".git").sort();
}

const A: RequirementSpec = { id: "FR-ARCH-001", acs: [{ n: 1 }, { n: 2 }] };
const B: RequirementSpec = { id: "FR-ARCH-002", acs: [{ n: 1 }], dependsOn: ["FR-ARCH-001"] };

describe("FR-NODE-247 AC-1 the draft on stdout", () => {
  // @req FR-NODE-247 AC-1
  it("FR-NODE-247 AC-1 prints a draft graph that passes the 2.0.0 parse and writes no file", async () => {
    const root = await repository([A, B], { "FR-ARCH-001": ["src/a.ts"], "FR-ARCH-002": ["src/b.ts"] });
    const before = await listing(root);
    for (const scope of [["--target", "v1.0.0"], ["--requirements", "FR-ARCH-002,FR-ARCH-001"]]) {
      const run = await orchestrate(root, ["wave", "propose", ...scope, "--files", FILES, "--run-id", "r9"]);
      expect(run.exit, JSON.stringify(run.payload)).toBe(0);
      const parsed = parseWorkGraph(run.payload.graph);
      expect(parsed.ok, JSON.stringify(run.payload.graph)).toBe(true);
      expect((run.payload.graph as Record<string, unknown>).run_id).toBe("r9");
      expect(run.payload.hubs).toEqual([]);
    }
    expect(await listing(root)).toEqual(before);
  });

  // @req FR-NODE-247 AC-1
  it("FR-NODE-247 AC-1 accepts exactly one of --target and --requirements, refusing the other cases at parse time with exit 1", async () => {
    const root = await repository([A], { "FR-ARCH-001": ["src/a.ts"] });
    for (const scope of [[], ["--target", "v1.0.0", "--requirements", "FR-ARCH-001"]]) {
      const run = await orchestrate(root, ["wave", "propose", ...scope, "--files", "missing.json", "--run-id", "r9"]);
      expect(run.exit, scope.join(" ")).toBe(1);
      expect(String(run.payload.error)).toMatch(/exactly one of --target or --requirements/);
    }
  });

  // @req FR-NODE-247 AC-1
  it("FR-NODE-247 AC-1 is a read verb", () => {
    expect(orchestrateVerbKind(["wave", "propose"])).toBe("read");
    const binding = ORCHESTRATE_TOOL_BINDINGS.find((entry) => entry.tool === "orchestrate_wave_propose");
    expect(binding?.kind).toBe("read");
    expect(binding?.options.map((option) => option.flag).sort()).toEqual(["--files", "--max-acs", "--max-files", "--max-requirements", "--requirements", "--run-id", "--target"]);
  });

  // @req FR-NODE-247 AC-2
  it("FR-NODE-247 AC-2 the MCP description states the grounding distance the refusal uses", () => {
    const description = ORCHESTRATE_TOOL_BINDINGS.find((entry) => entry.tool === "orchestrate_wave_propose")?.description ?? "";
    expect(description).toMatch(/within Levenshtein distance 2/);
    expect(description).not.toMatch(/one edit/);
  });

  // @req FR-NODE-247 AC-1 AC-6
  it("FR-NODE-247 AC-1 AC-6 the cap options reach the merge, and a cap that is not a positive integer is a usage error", async () => {
    const root = await repository([A, B], { "FR-ARCH-001": ["src/a.ts"], "FR-ARCH-002": ["src/b.ts"] });
    const merged = await orchestrate(root, ["wave", "propose", "--target", "v1.0.0", "--files", FILES, "--run-id", "r9"]);
    expect(((merged.payload.graph as Record<string, unknown>).nodes as unknown[]).length).toBe(1);
    const capped = await orchestrate(root, ["wave", "propose", "--target", "v1.0.0", "--files", FILES, "--run-id", "r9", "--max-requirements", "1"]);
    expect(capped.exit, JSON.stringify(capped.payload)).toBe(0);
    expect(((capped.payload.graph as Record<string, unknown>).nodes as unknown[]).length).toBe(2);
    for (const value of ["0", "two", "1.5"]) {
      const refused = await orchestrate(root, ["wave", "propose", "--target", "v1.0.0", "--files", FILES, "--run-id", "r9", "--max-acs", value]);
      expect(refused.exit, value).toBe(1);
      expect(String(refused.payload.error)).toMatch(/--max-acs/);
    }
  });
});

describe("FR-NODE-247 AC-11 an unknown or discarded named requirement", () => {
  // @req FR-NODE-247 AC-11
  it("FR-NODE-247 AC-11 is a usage error naming each ID, and nothing is written", async () => {
    const root = await repository([A, { id: "FR-ARCH-003", acs: [{ n: 1 }], status: "discarded" }], { "FR-ARCH-001": ["src/a.ts"] });
    const before = await listing(root);
    const run = await orchestrate(root, ["wave", "propose", "--requirements", "FR-ARCH-001,FR-ARCH-003,FR-ARCH-009", "--files", FILES, "--run-id", "r9"]);
    expect(run.exit).toBe(1);
    expect(run.payload).not.toHaveProperty("gate");
    expect(String(run.payload.error)).toMatch(/FR-ARCH-003.*FR-ARCH-009/);
    expect(await listing(root)).toEqual(before);
  });
});

describe("FR-NODE-247 the computed refusals are gate refusals", () => {
  // @req FR-NODE-247 AC-12
  it("FR-NODE-247 AC-12 a requirement with no live criterion refuses with requirement-without-live-ac at exit 2", async () => {
    const root = await repository([A, { id: "FR-ARCH-004", acs: [] }], { "FR-ARCH-001": ["src/a.ts"] });
    const run = await orchestrate(root, ["wave", "propose", "--target", "v1.0.0", "--files", FILES, "--run-id", "r9"]);
    expect(run.exit, JSON.stringify(run.payload)).toBe(2);
    expect(run.payload.gate).toBe("requirement-without-live-ac");
    expect(run.payload.violations).toEqual([{ requirement: "FR-ARCH-004" }]);
  });

  // @req FR-NODE-247 AC-4
  it("FR-NODE-247 AC-4 a dependency cycle over a cap refuses with requirement-cycle-over-cap at exit 2 and prints no graph", async () => {
    const cyclic = [{ ...A, dependsOn: ["FR-ARCH-002"] }, B];
    const root = await repository(cyclic, {});
    const run = await orchestrate(root, ["wave", "propose", "--target", "v1.0.0", "--files", FILES, "--run-id", "r9", "--max-requirements", "1"]);
    expect(run.exit, JSON.stringify(run.payload)).toBe(2);
    expect(run.payload.gate).toBe("requirement-cycle-over-cap");
    expect(run.payload).not.toHaveProperty("graph");
  });

  // @req FR-NODE-247 AC-2
  it("FR-NODE-247 AC-2 an expected path one edit from a tracked path refuses with files-not-grounded at exit 2, naming that neighbour", async () => {
    const root = await repository([A], { "FR-ARCH-001": ["src/abd.ts"] }, { "src/abc.ts": "export {};\n" });
    const run = await orchestrate(root, ["wave", "propose", "--target", "v1.0.0", "--files", FILES, "--run-id", "r9"]);
    expect(run.exit, JSON.stringify(run.payload)).toBe(2);
    expect(run.payload.gate).toBe("files-not-grounded");
    expect(JSON.stringify(run.payload.violations)).toContain("src/abc.ts");
  });
});
