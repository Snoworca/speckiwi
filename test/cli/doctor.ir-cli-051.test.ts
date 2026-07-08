import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import {
  AGENT_INSTRUCTION_END_MARKER,
  AGENT_INSTRUCTION_HEADING_PREFIX,
  AGENT_INSTRUCTION_VERSION
} from "../../src/core/bootstrap/templates.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

// IR-CLI-051 — `speckiwi doctor` environment health command.
//
// Red-phase suite (T-PH004-45): one test case per acceptance criterion (AC-1..AC-4). These cases pin
// the future CLI contract before the green task (T-PH004-46) teaches the CLI a `doctor` command, so
// the whole suite fails today — commander rejects the unknown `doctor` command (non-zero usage exit,
// no diagnosis payload printed) — until the green task adds the command (reporting from the init
// scaffold SSOT, src/core/bootstrap/init-project.ts). Because `doctor` will itself be a read-only
// ToolSpec entry under the FR-ARCH-006 zero-drift contract, the green task must also register it in
// src/mcp/schemas.ts.
//
// Contract under test (SRS docs/spec/30.cli-interface.srs.md IR-CLI-051):
//
//   The speckiwi doctor command reports a consolidated health diagnosis covering docs spec presence
//   and parseability, agent workflow block version currency, bundled versus installed rules version
//   drift, Active Target set, scope and target consistency, and Node version, supports json, and with
//   fix re-runs the idempotent init upsert for missing or outdated workflow blocks only.
//
//   - AC-1: speckiwi doctor reports each checked item with an ok, warn, or fail state and a remediation
//           hint.
//   - AC-2: speckiwi doctor --json emits the structured diagnosis report.
//   - AC-3: speckiwi doctor without --fix writes no file.
//   - AC-4: speckiwi doctor --fix re-upserts only missing or outdated agent workflow blocks and changes
//           no Requirement Block data.

function io() {
  return { stdout: new PassThrough() as NodeJS.WriteStream, stderr: new PassThrough() as NodeJS.WriteStream };
}

/** Drains everything written to a finished run's stream. */
function drain(stream: NodeJS.WriteStream): string {
  return (stream as unknown as PassThrough).read()?.toString() ?? "";
}

const HEALTH_STATES = new Set(["ok", "warn", "fail"]);

/**
 * Walks parsed JSON for the first array of objects that each carry a health `state` in {ok, warn, fail}
 * and a non-empty string `remediation` hint — the doctor diagnosis-check entry shape. Lets the green
 * task choose the envelope wrapper (e.g. { ok, value: { checks } }) without coupling the red test to a
 * specific key path.
 */
function findCheckArray(parsed: unknown): Array<Record<string, unknown>> | undefined {
  const seen = new Set<unknown>();
  const stack: unknown[] = [parsed];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node || typeof node !== "object" || seen.has(node)) continue;
    seen.add(node);
    if (Array.isArray(node)) {
      if (
        node.length > 0 &&
        node.every(
          (item) =>
            item &&
            typeof item === "object" &&
            typeof (item as Record<string, unknown>).state === "string" &&
            HEALTH_STATES.has((item as Record<string, unknown>).state as string)
        )
      ) {
        return node as Array<Record<string, unknown>>;
      }
      for (const item of node) stack.push(item);
      continue;
    }
    for (const value of Object.values(node as Record<string, unknown>)) stack.push(value);
  }
  return undefined;
}

/** Parses `doctor --json` stdout into the array of diagnosis checks (fails the test if absent). */
function diagnosisChecks(out: string): Array<Record<string, unknown>> {
  let parsed: unknown;
  expect(() => {
    parsed = JSON.parse(out);
  }, "doctor --json must emit valid JSON").not.toThrow();
  const rows = findCheckArray(parsed);
  expect(rows, "doctor --json must expose an array of checks, each with a {ok,warn,fail} state").toBeDefined();
  return rows as Array<Record<string, unknown>>;
}

/** The remediation hint string for a check (label, state, remediation, message — all coalesced to text). */
function checkBlob(check: Record<string, unknown>): string {
  return JSON.stringify(check).toLowerCase();
}

/** Recursively snapshots every file's path → contents under a directory (for no-write assertions). */
async function snapshotTree(root: string): Promise<Map<string, string>> {
  const snapshot = new Map<string, string>();
  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) snapshot.set(path.relative(root, full), await readFile(full, "utf8"));
    }
  }
  await walk(root);
  return snapshot;
}

async function exists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

// The six health topics the SRS body enumerates for the consolidated diagnosis. Each topic must surface
// as at least one diagnosis check; the matcher tolerates the green task's label wording by matching on
// any of the listed keyword alternates within the serialized check entry.
const REQUIRED_HEALTH_TOPICS: ReadonlyArray<{ topic: string; keywords: readonly string[] }> = [
  { topic: "docs spec presence and parseability", keywords: ["spec", "parse", "docs"] },
  { topic: "agent workflow block version currency", keywords: ["workflow", "agent"] },
  { topic: "bundled versus installed rules version drift", keywords: ["rule", "drift", "bundled"] },
  { topic: "Active Target set", keywords: ["active target", "target"] },
  { topic: "scope and target consistency", keywords: ["scope", "consistency"] },
  { topic: "Node version", keywords: ["node"] }
];

describe("IR-CLI-051 — speckiwi doctor environment health command", () => {
  // AC-1: speckiwi doctor reports each checked item with an ok/warn/fail state and a remediation hint.
  it("IR-CLI-051 AC-1: doctor reports each checked item with an ok/warn/fail state and a remediation hint", async () => {
    const root = await copyFixtureWorkspace("valid-basic");

    const streams = io();
    const code = await main(["--root", root, "doctor", "--json"], streams);
    const out = drain(streams.stdout);

    // A consolidated diagnosis is a successful run (exit 0): a doctor that merely *reports* health does
    // not itself fail the process; the per-check states carry the verdict.
    expect(code).toBe(0);
    const checks = diagnosisChecks(out);

    // Every check advertises a state in the closed {ok, warn, fail} set and a non-empty remediation hint
    // (a doctor with no actionable hint is useless). This is the literal AC-1 contract per check.
    for (const check of checks) {
      expect(HEALTH_STATES.has(check.state as string), `check ${JSON.stringify(check)} must carry an ok/warn/fail state`).toBe(
        true
      );
      const remediation = check.remediation;
      expect(typeof remediation, `check ${String(check.state)} must carry a string remediation hint`).toBe("string");
      expect((remediation as string).trim().length, "remediation hint must be non-empty").toBeGreaterThan(0);
    }

    // The diagnosis is *consolidated*: every health topic the SRS enumerates surfaces as at least one
    // check. This pins doctor as a real multi-facet diagnosis rather than a single stub check.
    for (const { topic, keywords } of REQUIRED_HEALTH_TOPICS) {
      const matched = checks.some((check) => {
        const blob = checkBlob(check);
        return keywords.some((keyword) => blob.includes(keyword.toLowerCase()));
      });
      expect(matched, `doctor diagnosis must include a check for "${topic}"`).toBe(true);
    }
  });

  // AC-2: speckiwi doctor --json emits the structured diagnosis report.
  it("IR-CLI-051 AC-2: doctor --json emits the structured diagnosis report", async () => {
    const root = await copyFixtureWorkspace("valid-basic");

    const streams = io();
    const code = await main(["--root", root, "doctor", "--json"], streams);
    const out = drain(streams.stdout);

    expect(code).toBe(0);

    // The output is machine-readable JSON (not human text), and it deserializes to a structured report
    // exposing the checks array — the structured diagnosis the SRS requires.
    let parsed: unknown;
    expect(() => {
      parsed = JSON.parse(out);
    }, "doctor --json must emit a single valid JSON document").not.toThrow();
    expect(parsed, "doctor --json must emit a JSON object/array, not a bare scalar").toBeTypeOf("object");

    const checks = findCheckArray(parsed);
    expect(checks, "the structured report must expose the diagnosis checks array").toBeDefined();
    expect((checks as Array<Record<string, unknown>>).length, "the diagnosis must carry at least one check").toBeGreaterThan(
      0
    );
  });

  // AC-3: speckiwi doctor without --fix writes no file.
  it("IR-CLI-051 AC-3: doctor without --fix writes no file", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    const before = await snapshotTree(root);

    const streams = io();
    // A pure read-only diagnosis (no --fix): exits 0 and leaves the tree untouched.
    expect(await main(["--root", root, "doctor", "--json"], streams)).toBe(0);

    // The workspace tree is byte-identical before and after the run — no file added, removed, or modified.
    const after = await snapshotTree(root);
    expect([...after.keys()].sort(), "doctor must not add or remove any file").toEqual([...before.keys()].sort());
    for (const [rel, content] of after) {
      expect(content, `doctor must not modify ${rel}`).toBe(before.get(rel));
    }
  });

  // AC-4: speckiwi doctor --fix re-upserts only missing or outdated agent workflow blocks and changes
  //       no Requirement Block data.
  it("IR-CLI-051 AC-4: doctor --fix re-upserts only the workflow blocks and leaves Requirement Block data unchanged", async () => {
    const root = await copyFixtureWorkspace("valid-basic");

    // The fixture ships no agent files, so the SpecKiwi workflow block is MISSING — exactly the
    // "missing or outdated" condition --fix is contracted to repair.
    const claudeFile = path.join(root, "CLAUDE.md");
    const agentsFile = path.join(root, "AGENTS.md");
    expect(await exists(claudeFile), "fixture precondition: CLAUDE.md absent before --fix").toBe(false);
    expect(await exists(agentsFile), "fixture precondition: AGENTS.md absent before --fix").toBe(false);

    // Capture the Requirement Block document (the source of truth for requirement data) byte-for-byte so
    // we can prove --fix never touches Requirement Block data.
    const specFile = path.join(root, "docs", "spec", "10.product-architecture.srs.md");
    const specBefore = await readFile(specFile, "utf8");
    const indexFile = path.join(root, "docs", "spec", "00.index.md");
    const indexBefore = await readFile(indexFile, "utf8");

    const streams = io();
    const code = await main(["--root", root, "doctor", "--fix", "--json"], streams);
    expect(code).toBe(0);

    // The missing workflow blocks are now upserted into the agent files, carrying the CURRENT workflow
    // version heading and the end marker (the idempotent init upsert result, AGENT_INSTRUCTION_VERSION).
    const expectedHeading = `${AGENT_INSTRUCTION_HEADING_PREFIX}${AGENT_INSTRUCTION_VERSION}`;
    for (const agentFile of [claudeFile, agentsFile]) {
      expect(await exists(agentFile), `--fix must upsert the workflow block into ${path.basename(agentFile)}`).toBe(true);
      const body = await readFile(agentFile, "utf8");
      expect(body, `${path.basename(agentFile)} must carry the current workflow version heading`).toContain(expectedHeading);
      expect(body, `${path.basename(agentFile)} must carry the workflow end marker`).toContain(AGENT_INSTRUCTION_END_MARKER);
    }

    // Requirement Block data is untouched: the scope SRS document and the index are byte-identical. --fix
    // re-runs the init upsert for workflow blocks ONLY — it never edits Requirement Block data.
    expect(await readFile(specFile, "utf8"), "--fix must not change Requirement Block data in the scope SRS").toBe(specBefore);
    expect(await readFile(indexFile, "utf8"), "--fix must not change the SRS index Requirement Block data").toBe(indexBefore);
  });

  // AC-4 (idempotent branch): running --fix twice must be a fixed point. The first run upserts the
  // missing workflow blocks; the second run finds them already current and changes nothing — the agent
  // files are byte-identical across runs and no other file is added, removed, or modified.
  it("IR-CLI-051 AC-4: doctor --fix is idempotent — a second run leaves the agent files byte-identical and touches no other file", async () => {
    const root = await copyFixtureWorkspace("valid-basic");

    // First --fix: upserts the missing CLAUDE.md / AGENTS.md workflow blocks.
    const first = io();
    expect(await main(["--root", root, "doctor", "--fix", "--json"], first)).toBe(0);

    // Snapshot the whole tree after the first fix (the post-upsert fixed point).
    const afterFirst = await snapshotTree(root);
    const claudeAfterFirst = afterFirst.get("CLAUDE.md");
    const agentsAfterFirst = afterFirst.get("AGENTS.md");
    expect(claudeAfterFirst, "first --fix must upsert CLAUDE.md").toBeDefined();
    expect(agentsAfterFirst, "first --fix must upsert AGENTS.md").toBeDefined();

    // Second --fix on the already-fixed workspace.
    const second = io();
    expect(await main(["--root", root, "doctor", "--fix", "--json"], second)).toBe(0);

    const afterSecond = await snapshotTree(root);

    // The agent files are byte-identical across the two runs (the idempotent fixed point).
    expect(afterSecond.get("CLAUDE.md"), "second --fix must leave CLAUDE.md byte-identical").toBe(claudeAfterFirst);
    expect(afterSecond.get("AGENTS.md"), "second --fix must leave AGENTS.md byte-identical").toBe(agentsAfterFirst);

    // No other file is added, removed, or modified by the second run.
    expect([...afterSecond.keys()].sort(), "second --fix must not add or remove any file").toEqual(
      [...afterFirst.keys()].sort()
    );
    for (const [rel, content] of afterSecond) {
      expect(content, `second --fix must not modify ${rel}`).toBe(afterFirst.get(rel));
    }
  });
});
