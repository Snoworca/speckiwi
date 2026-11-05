import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";

import { main } from "../../src/cli/index.js";
import { digestOf, orchestrate, workGraphWorkspace } from "../cli/wave-graph-fixtures.js";
import { writeUnder } from "../core/orchestrator/sds-fixtures.js";

// Final round 6 — skills bundle (FR-FLOW-208 .. FR-FLOW-223). Each test runs the commands a skill writes,
// as written, in a temporary workspace and checks the result an AC promises.

const REPO = path.resolve(import.meta.dirname, "../..");
const read = (relative: string): string => readFileSync(path.join(REPO, relative), "utf8");

// The PRD and the Rationale citation form are the repository's own: docs/prd/ holds this PRD, and the
// 5.3.0 requirements of docs/spec/60.workflow-release.srs.md cite it as "PRD: <path>. AC-1 ← PRD-<n>".
const PRD = "docs/prd/2026-11-04.v530-wave-master-work-graph-roadmap.prd.md";
const ARTIFACT_ROOT = "docs/analysis/kiwi-wave-master-r1/";
const GRAPH_PATH = `${ARTIFACT_ROOT}waves/waves.json`;

async function cli(root: string, argv: readonly string[]): Promise<{ exit: number; payload: Record<string, unknown> }> {
  const pipes = { stdout: new PassThrough(), stderr: new PassThrough() };
  const exit = await main(["--root", root, ...argv, "--json"], pipes);
  const text = pipes.stdout.read()?.toString() ?? "";
  return { exit, payload: text.length > 0 ? (JSON.parse(text) as Record<string, unknown>) : {} };
}

function git(root: string, ...args: string[]): void {
  const run = spawnSync("git", ["-C", root, "-c", "user.email=v@v", "-c", "user.name=v", "-c", "core.autocrlf=false", ...args], { encoding: "utf8" });
  if (run.status !== 0) throw new Error(`git ${args.join(" ")}: ${run.stderr}`);
}

/** A skill command written in backticks, with the placeholders of a wave-master run filled in. */
function argvOf(command: string): string[] {
  return command
    .replaceAll("{artifact_root}", ARTIFACT_ROOT)
    .replaceAll("{run_id}", "r1")
    .replaceAll("<제품 target>", "v1.0.0")
    .replaceAll("<product target>", "v1.0.0")
    .split(/\s+/)
    .filter((token) => token.length > 0 && token !== "--json");
}

/** A wave-master `in_progress` line of run r1 for wave-1; `extra` may carry the graph reference. */
function wmLine(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema_version: "2.0.0",
    ts: "2026-11-05T01:00:00.000Z",
    run_id: "r1",
    engine: "kiwi-wave-master",
    wave: "wave-1",
    order: 1,
    target: "v1.0.0",
    status: "in_progress",
    phase: "worker",
    lane: "lane-r1-wave-1",
    stage: 1,
    sds_id: "r1-wave-1",
    summary: "wave-1 dispatched",
    ...extra
  };
}

const prdIds = (items: unknown): string[] =>
  Array.isArray(items) ? items.map((item) => (typeof item === "string" ? item : String((item as { id?: unknown }).id))) : [];

describe("FR-FLOW-219 AC-1 — a wave's PRD items, read through orchestrate wave show, after the decomposition the skills write", () => {
  // Corpus: skills/{claude,codex,etc}/_shared/kiwi/wave-decomposition.md §2 steps 5–8 and §4 (and the .agents mirror),
  // skills/*/kiwi-wave-master/SKILL.md §3 (the `--engine kiwi-wave-master` on wave show); the SRS citation form of
  // docs/spec/60.workflow-release.srs.md; the PRD docs/prd/2026-11-04.v530-wave-master-work-graph-roadmap.prd.md.
  for (const root of ["skills/claude", "skills/codex", "skills/etc", ".agents/skills"]) {
    // @req FR-FLOW-219 AC-1
    it(`${root}: wave show reports the PRD item a node's requirement cites in its Rationale`, async () => {
      const contract = read(`${root}/_shared/kiwi/wave-decomposition.md`);
      const companions = ["_shared/kiwi/parallel-waves.md", "kiwi-wave-master/SKILL.md", "kiwi-orchestrator/SKILL.md"]
        .map((file) => path.join(REPO, root, file))
        .filter((file) => { try { readFileSync(file); return true; } catch { return false; } })
        .map((file) => readFileSync(file, "utf8"));

      const { root: ws } = await workGraphWorkspace({
        requirements: [{ id: "FR-ARCH-001", acs: [{ n: 1 }], rationale: `PRD: ${PRD}. AC-1 ← PRD-9.` }],
        noJournal: true,
        files: { [PRD]: read(PRD), "src/a.ts": "export const a = 1;\n" }
      });
      git(ws, "init", "-q");
      git(ws, "add", "-A");
      git(ws, "commit", "-qm", "base");

      // Control: the requirement does cite PRD-9 as speckiwi prd coverage resolves citations.
      const coverage = await cli(ws, ["prd", "coverage", PRD, "--target", "v1.0.0"]);
      expect(coverage.exit, JSON.stringify(coverage.payload)).toBe(0);
      expect(prdIds(coverage.payload.uncitedItems)).not.toContain("PRD-9");

      // Step 5: the impact analysis writes the expected-files map.
      await writeUnder(ws, `${ARTIFACT_ROOT}waves/expected-files.json`, JSON.stringify({ "FR-ARCH-001": ["src/a.ts"] }));
      // Step 6: the draft, by the command the contract writes.
      const propose = /`speckiwi orchestrate (wave propose [^`]+)`/.exec(contract)?.[1] ?? "";
      expect(propose, `${root}: §2 step 6 command`).not.toBe("");
      const drafted = await orchestrate(ws, argvOf(propose));
      expect(drafted.exit, JSON.stringify(drafted.payload)).toBe(0);
      const graph = { ...(drafted.payload.graph as Record<string, unknown>) };
      // Step 7: the node metadata the contract lists. A graph-level `prd` is set only if a rendering says so.
      const step7 = contract.split("\n").find((line) => /^7\. /.test(line)) ?? "";
      expect(step7, `${root}: §2 step 7`).not.toBe("");
      graph.nodes = (graph.nodes as Record<string, unknown>[]).map((entry) => ({
        ...entry,
        ...(step7.includes("`description`") ? { description: "node one" } : {}),
        ...(step7.includes("`cautions`") ? { cautions: [] } : {}),
        ...(step7.includes("`on_complete`") ? { on_complete: [] } : {}),
        ...(step7.includes("`github_issues`") ? { github_issues: [] } : {})
      }));
      if ([contract, ...companions].some((text) => /`prd`/.test(text))) graph.prd = PRD;
      // Step 8: written as 2.0.0, wave check passes, committed, and the first graph line references it.
      const graphText = `${JSON.stringify(graph, null, 2)}\n`;
      await writeUnder(ws, GRAPH_PATH, graphText);
      const check = await orchestrate(ws, ["wave", "check", "--waves", GRAPH_PATH, "--run-id", "r1", "--engine", "kiwi-wave-master"]);
      expect(check.exit, JSON.stringify(check.payload)).toBe(0);
      git(ws, "add", "-A");
      git(ws, "commit", "-qm", "graph");
      const first = await orchestrate(ws, ["journal", "append", "--run-id", "r1", "--payload", JSON.stringify(wmLine({ graph: { path: GRAPH_PATH, digest: digestOf(graphText) } }))]);
      expect(first.exit, JSON.stringify(first.payload)).toBe(0);

      // Control: the same node read from a copy of the graph that names the run's PRD reports PRD-9.
      await writeUnder(ws, "control/waves.json", `${JSON.stringify({ ...graph, prd: PRD }, null, 2)}\n`);
      const control = await orchestrate(ws, ["wave", "show", "--wave", "wave-1", "--waves", "control/waves.json", "--run-id", "r1", "--engine", "kiwi-wave-master"]);
      expect(control.exit, JSON.stringify(control.payload)).toBe(0);
      expect(prdIds((control.payload.nodes as Array<Record<string, unknown>>)[0]?.prd_items)).toEqual(["PRD-9"]);

      // §4: the node's PRD items are read with wave show (§3's form, with wave-master's engine argument).
      const shown = await orchestrate(ws, ["wave", "show", "--wave", "wave-1", "--run-id", "r1", "--engine", "kiwi-wave-master"]);
      expect(shown.exit, JSON.stringify(shown.payload)).toBe(0);
      expect(prdIds((shown.payload.nodes as Array<Record<string, unknown>>)[0]?.prd_items), `${root}: prd_items of wave-1`).toEqual(["PRD-9"]);
    });
  }
});

describe("FR-FLOW-222 AC-5 — a fresh wave-master run reads its first ready set through orchestrate wave status", () => {
  // Corpus: skills/{claude,codex,etc}/_shared/kiwi/wave-decomposition.md §2 step 8 (the first graph line is the first
  // journal line written after the graph is committed), parallel-waves.md §3 · PW-4 (the ready set is read with
  // `wave status`, before the lock and before PW-5's dispatch), skills/{claude,codex,etc}/kiwi-wave-master/SKILL.md
  // §5 (`--engine kiwi-wave-master` on wave status) and §5.5.6 (the first lines it writes: `phase="sds"` under --sds,
  // `phase="worker"` at dispatch).
  for (const root of ["skills/claude", "skills/codex", "skills/etc"]) {
    // @req FR-FLOW-222 AC-5
    it(`${root}: after decomposition step 8, PW-4's wave status read reports wave-1 ready`, async () => {
      const contract = read(`${root}/_shared/kiwi/parallel-waves.md`);
      const status = /`speckiwi orchestrate (wave status --waves \{artifact_root\}waves\/waves\.json[^`]*)`/.exec(contract)?.[1] ?? "";
      expect(status, `${root}: §3 wave status command`).not.toBe("");
      const argv = [...argvOf(status), "--engine", "kiwi-wave-master"];

      const graph = {
        schema_version: "2.0.0",
        run_id: "r1",
        title: "graph",
        scope: { target: "v1.0.0" },
        nodes: [{ wave: "wave-1", title: "node 1", purpose: "purpose 1", acs: ["FR-ARCH-001 AC-1"], done_when: [], files: ["src/a.ts"] }],
        edges: []
      };
      const graphText = `${JSON.stringify(graph, null, 2)}\n`;
      // The repository journal holds a line of an earlier run; the new run r1 has written nothing yet.
      const earlier = { ...wmLine(), run_id: "r0", sds_id: "r0-wave-1", status: "pending", phase: undefined, lane: undefined, stage: undefined };
      const { root: ws } = await workGraphWorkspace({
        requirements: [{ id: "FR-ARCH-001", acs: [{ n: 1 }] }],
        noJournal: true,
        files: { [GRAPH_PATH]: graphText, "kiwi/waves.jsonl": `${JSON.stringify(earlier)}\n`, "src/a.ts": "export const a = 1;\n" }
      });

      // Step 8's own check passes on the committed graph before any line of the run exists.
      const check = await orchestrate(ws, ["wave", "check", "--waves", GRAPH_PATH, "--run-id", "r1", "--engine", "kiwi-wave-master"]);
      expect(check.exit, JSON.stringify(check.payload)).toBe(0);

      const fresh = await orchestrate(ws, argv);

      // Control: once a line of r1 carries the graph reference, the same command reports wave-1 ready.
      const { root: control } = await workGraphWorkspace({
        requirements: [{ id: "FR-ARCH-001", acs: [{ n: 1 }] }],
        noJournal: true,
        files: { [GRAPH_PATH]: graphText, "kiwi/waves.jsonl": `${JSON.stringify(earlier)}\n`, "src/a.ts": "export const a = 1;\n" }
      });
      const appended = await orchestrate(control, ["journal", "append", "--run-id", "r1", "--payload", JSON.stringify({ ...wmLine({ graph: { path: GRAPH_PATH, digest: digestOf(graphText) } }), status: "pending", phase: undefined, lane: undefined, stage: undefined, sds_id: undefined })]);
      expect(appended.exit, JSON.stringify(appended.payload)).toBe(0);
      const after = await orchestrate(control, argv);
      expect(after.exit, JSON.stringify(after.payload)).toBe(0);
      expect(after.payload.ready).toEqual(["wave-1"]);

      expect(fresh.exit, `${root}: ${argv.join(" ")} -> ${JSON.stringify(fresh.payload)}`).toBe(0);
      expect(fresh.payload.ready).toEqual(["wave-1"]);
    });
  }
});
