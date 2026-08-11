import { execFile } from "node:child_process";
import { mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { promisify } from "node:util";
import type { Command } from "commander";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { buildCommand } from "../../src/cli/command.js";
import {
  FREEZE_TARGETS,
  ORCHESTRATE_DEFERRED_VERB_ROWS,
  ORCHESTRATE_MUTATION_VERB_ROWS,
  ORCHESTRATE_PHASE1_VERB_ROWS,
  ORCHESTRATE_PHASE2_VERB_ROWS,
  ORCHESTRATE_REGISTERED_VERB_ROWS,
  orchestrateVerbKind,
  orchestrateVerbRow,
  registerOrchestrateCommands
} from "../../src/cli/commands/orchestrate.js";

// @req IR-CLI-082 — the `speckiwi orchestrate` phase-1 verb surface.

function io() {
  return { stdout: new PassThrough(), stderr: new PassThrough() };
}

function drain(stream: PassThrough): string {
  return stream.read()?.toString() ?? "";
}

/** The built `orchestrate` command, from the real registrar rather than a rebuilt fixture tree. */
function orchestrateCommand(): Command {
  const pipes = io();
  const command = buildCommand({ io: pipes });
  registerOrchestrateCommands(command, { io: pipes });
  const found = command.commands.find((sub) => sub.name() === "orchestrate");
  expect(found, "the CLI must register an `orchestrate` namespace").toBeDefined();
  return found as Command;
}

/** Every leaf path under `orchestrate`, as segment arrays; a leaf is a command with no subcommands. */
function orchestrateLeafPaths(): string[][] {
  const leaves: string[][] = [];
  const walk = (cmd: Command, prefix: string[]): void => {
    if (cmd.commands.length === 0) {
      leaves.push(prefix);
      return;
    }
    for (const sub of cmd.commands) walk(sub, [...prefix, sub.name()]);
  };
  walk(orchestrateCommand(), []);
  return leaves;
}

function subcommandNames(...segments: string[]): string[] {
  let cursor: Command = orchestrateCommand();
  for (const segment of segments) {
    const next = cursor.commands.find((sub) => sub.name() === segment);
    expect(next, `orchestrate ${segments.join(" ")} must be registered`).toBeDefined();
    cursor = next as Command;
  }
  return cursor.commands.map((sub) => sub.name());
}

function leafCommand(segments: string[]): Command {
  let cursor: Command = orchestrateCommand();
  for (const segment of segments) {
    const next = cursor.commands.find((sub) => sub.name() === segment);
    expect(next, `orchestrate ${segments.join(" ")} must be registered`).toBeDefined();
    cursor = next as Command;
  }
  return cursor;
}

function longFlags(cmd: Command): string[] {
  return cmd.options.map((option) => option.long ?? option.short ?? "");
}

async function tempRoot(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "speckiwi-orchestrate-surface-"));
}

/** A throwaway git repository — a root the preflight can corroborate (FR-NODE-178). */
async function gitRepository(): Promise<string> {
  const root = await realpath(await tempRoot());
  await promisify(execFile)("git", ["init", "--quiet"], { cwd: root });
  return root;
}

/** A `routing/probe.json` document every declared producer field of which is readable (09 §3.6). */
const READABLE_PROBE_DOCUMENT = {
  fields: {
    S1: { value: { mode: "sdd", source: "mcp" } },
    S2: { value: { contract_ok: true, reject_reason: null, open_tasks: 3, req_ids: ["FR-ARCH-001"], target: "v2.6.0" } },
    S3: { value: { anchored_reqs: ["FR-ARCH-001"] } },
    S3c: { value: { anchor_coverage: 0.5 } },
    S4: { value: { scopes: ["ARCH"], scope_req_ids: ["FR-ARCH-001"] } },
    S5: { value: { external_paths: [] } },
    S6: { value: { ambiguities: 0 } },
    S7: { value: { ordered_sections: 1 } },
    S8: { value: { linked_sub_issues: 0, task_list_groups: 0 } },
    S9: { value: { activeTarget: "v2.6.0" } },
    S10: { value: { blocked_stability: [] } },
    S12: { value: { declared_existing_req_edit: false } }
  }
};

describe("IR-CLI-082 AC-1 — exactly the registered rows", () => {
  it("declares twenty-one phase-1 rows and folds every registered leaf into a registered row", () => {
    // The count literal stays a literal. It is the tripwire that forces an author who changes the
    // surface to come here and say so, and phase 1's own row count is a historical fact that does
    // not move when a phase-2 row lands — that lands in ORCHESTRATE_REGISTERED_VERB_ROWS instead.
    expect(ORCHESTRATE_PHASE1_VERB_ROWS).toHaveLength(21);

    const leaves = orchestrateLeafPaths();
    expect(leaves.length, "the namespace must register leaves").toBeGreaterThan(0);

    const unfolded = leaves.filter((leaf) => orchestrateVerbRow(leaf) === null);
    expect(unfolded.map((leaf) => leaf.join(" ")), "every leaf must belong to a declared registered row").toEqual([]);

    const covered = new Set(leaves.map((leaf) => orchestrateVerbRow(leaf) as string));
    expect([...covered].sort()).toEqual([...ORCHESTRATE_REGISTERED_VERB_ROWS].sort());
  });

  it("registers none of the phase-2 rows still listed as deferred", () => {
    const covered = new Set(orchestrateLeafPaths().map((leaf) => orchestrateVerbRow(leaf) as string));
    for (const row of ORCHESTRATE_DEFERRED_VERB_ROWS) {
      expect(covered.has(row), `deferred row '${row}' must not be registered`).toBe(false);
    }
    // Phase membership is fixed at six by 05 §10.6; how many of them are still deferred is not.
    // @req IR-CLI-092 — six once `replay apply` joined the design table's phase-2 rows.
    expect(ORCHESTRATE_PHASE2_VERB_ROWS).toHaveLength(6);
    expect(ORCHESTRATE_DEFERRED_VERB_ROWS).toHaveLength(4);
    for (const row of ORCHESTRATE_DEFERRED_VERB_ROWS) expect(ORCHESTRATE_PHASE2_VERB_ROWS).toContain(row);
  });
});

describe("IR-CLI-082 AC-2 — freeze accepts exactly six targets", () => {
  it("registers the six named targets and no seventh", () => {
    expect([...FREEZE_TARGETS]).toEqual(["design", "waves", "lanes", "handoff", "issues", "postmortem"]);
    expect(subcommandNames("freeze").sort()).toEqual([...FREEZE_TARGETS].sort());
  });

  it("rejects a seventh target value", async () => {
    const pipes = io();
    const exit = await main(["orchestrate", "freeze", "convergence", "--json"], pipes);

    expect(exit).not.toBe(0);
    expect(`${drain(pipes.stdout)}${drain(pipes.stderr)}`).toMatch(/convergence/);
  });
});

describe("IR-CLI-082 AC-3 — run, route, issue and schedule subcommand sets", () => {
  it("registers exactly the declared subcommands of each container", () => {
    expect(subcommandNames("run").sort()).toEqual(["abort", "lock", "status", "unlock"]);
    expect(subcommandNames("route").sort()).toEqual(["freeze", "probe", "show"]);
    expect(subcommandNames("issue").sort()).toEqual(["defer", "list", "open", "plan", "resolve"]);
    expect(subcommandNames("schedule").sort()).toEqual(["plan", "show"]);
  });
});

describe("IR-CLI-082 AC-4 — the deferred rows are unregistered", () => {
  it("registers no leaf for a deferred row", () => {
    // Derived from the deferred list rather than hard-coded, so a row leaving that list is not
    // silently still asserted absent here — which is how this case would have gone stale when
    // `replay plan` landed. @req IR-CLI-091
    //
    // The subject is the LEAF, not the container. Asserting the container absent only holds while
    // every row under it is deferred: the day `lane audit` lands with the other three still
    // deferred, `lane` must be both registered and absent, and this case would demand a
    // contradiction. The container check below is therefore conditioned on that being true.
    expect(ORCHESTRATE_DEFERRED_VERB_ROWS.length, "the deferred list must name at least one row").toBeGreaterThan(0);
    const registeredLeaves = new Set(orchestrateLeafPaths().map((leaf) => leaf.join(" ")));
    for (const row of ORCHESTRATE_DEFERRED_VERB_ROWS) {
      expect(registeredLeaves.has(row), `deferred row '${row}' must have no registered leaf`).toBe(false);
    }

    const topLevel = orchestrateCommand().commands.map((sub) => sub.name());
    const containerOf = (row: string): string => row.split(" ")[0] as string;
    const deferred = new Set<string>(ORCHESTRATE_DEFERRED_VERB_ROWS);
    for (const container of new Set(ORCHESTRATE_DEFERRED_VERB_ROWS.map(containerOf))) {
      const siblings = ORCHESTRATE_REGISTERED_VERB_ROWS.filter((row) => containerOf(row) === container);
      if (siblings.length > 0) continue; // partially landed: the container legitimately exists
      expect(deferred.size, `${container} is wholly deferred`).toBeGreaterThan(0);
      expect(topLevel, `no leaf under '${container}' has landed, so the container must be absent`).not.toContain(container);
    }
  });

  it("exits with an unknown-command error rather than a stub", async () => {
    for (const argv of ORCHESTRATE_DEFERRED_VERB_ROWS.map((row) => ["orchestrate", ...row.split(" "), "--json"])) {
      const pipes = io();
      const exit = await main(argv, pipes);
      const text = `${drain(pipes.stdout)}${drain(pipes.stderr)}`;

      expect(exit, `${argv.join(" ")} must not succeed`).not.toBe(0);
      expect(text, `${argv.join(" ")} must report an unknown command`).toMatch(/unknown command/i);
    }
  });
});

describe("IR-CLI-082 AC-5 — --json everywhere, --dry-run and an envelope on every mutation", () => {
  it("gives every leaf a --json option", () => {
    const missing = orchestrateLeafPaths().filter((leaf) => !longFlags(leafCommand(leaf)).includes("--json"));
    expect(missing.map((leaf) => leaf.join(" "))).toEqual([]);
  });

  it("gives every mutation leaf a --dry-run option, and no read leaf one", () => {
    const leaves = orchestrateLeafPaths();
    const mutationLeaves = leaves.filter((leaf) => orchestrateVerbKind(leaf) === "mutation");
    expect(mutationLeaves.length, "the namespace must carry mutation verbs").toBeGreaterThan(0);
    // Every mutation row of the design table is reached by at least one registered leaf.
    expect(
      [...new Set(mutationLeaves.map((leaf) => orchestrateVerbRow(leaf) as string))].sort()
    ).toEqual([...ORCHESTRATE_MUTATION_VERB_ROWS].sort());

    const missing = mutationLeaves.filter((leaf) => !longFlags(leafCommand(leaf)).includes("--dry-run"));
    expect(missing.map((leaf) => leaf.join(" "))).toEqual([]);

    const readsWithDryRun = leaves
      .filter((leaf) => orchestrateVerbKind(leaf) === "read")
      .filter((leaf) => longFlags(leafCommand(leaf)).includes("--dry-run"));
    expect(readsWithDryRun.map((leaf) => leaf.join(" "))).toEqual([]);
  });

  it("returns a MutationEnvelope carrying `applied` from a mutation verb", async () => {
    const root = await tempRoot();
    const pipes = io();
    const exit = await main(
      ["--root", root, "orchestrate", "journal", "append", "--run-id", "run-a", "--payload", JSON.stringify({ schema_version: "1.4.0", run_id: "run-a", verb: "author-design", event: "intent", wave: "wave-1" }), "--dry-run", "--json"],
      pipes
    );
    const payload = JSON.parse(drain(pipes.stdout)) as Record<string, unknown>;

    expect(exit).toBe(0);
    expect(payload).toHaveProperty("applied");
    expect(payload.dryRun).toBe(true);
  });
});

describe("IR-CLI-082 AC-6 — preflight takes both roots as arguments", () => {
  it("requires --mcp-root and --git-root", () => {
    const preflight = leafCommand(["preflight"]);
    const required = preflight.options.filter((option) => option.mandatory).map((option) => option.long);

    expect(required).toContain("--mcp-root");
    expect(required).toContain("--git-root");
  });

  it("compares the two passed values, reading neither from the process working directory", async () => {
    // Both fixtures are real repositories since FR-NODE-178: the preflight now corroborates the
    // passed `--git-root` against the repository that path names, so a bare temp directory refuses
    // on that condition and would no longer exercise the claim this case exists to make. The claim
    // itself is unchanged — the arguments alone decide, and cwd is neither of them.
    const one = await gitRepository();
    const other = await gitRepository();

    // cwd is this repository, which is neither of the two roots; the mismatch must still be found,
    // and passing the same value twice must still match — both are decided by the arguments alone.
    const mismatch = io();
    const mismatchExit = await main(["orchestrate", "preflight", "--mcp-root", one, "--git-root", other, "--json"], mismatch);
    const mismatchPayload = JSON.parse(drain(mismatch.stdout)) as Record<string, unknown>;

    const match = io();
    const matchExit = await main(["orchestrate", "preflight", "--mcp-root", one, "--git-root", one, "--json"], match);
    const matchPayload = JSON.parse(drain(match.stdout)) as Record<string, unknown>;

    expect(mismatchExit).toBe(2);
    expect(mismatchPayload.gate).toBe("run-root-preflight-mismatch");
    expect(matchExit).toBe(0);
    expect(matchPayload.ok).toBe(true);
  });
});

describe("IR-CLI-082 AC-7 — route probe refuses a schema-invalid probe", () => {
  it("exits non-zero and writes no defaulted probe", async () => {
    const root = await tempRoot();
    const out = "routing/probe.json";
    const pipes = io();

    // A probe missing required fields: the tool must refuse rather than fill them in.
    const exit = await main(
      ["--root", root, "orchestrate", "route", "probe", "--payload", JSON.stringify({ S1: "not-a-number" }), "--out", out, "--json"],
      pipes
    );
    const payload = JSON.parse(drain(pipes.stdout)) as Record<string, unknown>;

    expect(exit).not.toBe(0);
    expect(payload.applied).toBe(false);
    await expect(readFile(path.join(root, out), "utf8")).rejects.toThrow();
  });

  it("writes the probe when it is schema-valid", async () => {
    const root = await tempRoot();
    const probePath = path.join(root, "valid-probe.json");
    await writeFile(probePath, JSON.stringify(READABLE_PROBE_DOCUMENT), "utf8");

    const pipes = io();
    const exit = await main(["--root", root, "orchestrate", "route", "probe", "--probe", probePath, "--out", "routing/probe.json", "--json"], pipes);

    expect(exit, drain(pipes.stderr)).toBe(0);
    await expect(readFile(path.join(root, "routing", "probe.json"), "utf8")).resolves.toContain("S1");
  });
});
