import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { GATE_IDS } from "../../src/core/orchestrator/auto-gate.js";
import { LANE_PLAN_ERROR_CODES } from "../../src/core/orchestrator/lane-plan.js";
import { HandoffPinError } from "../../src/core/orchestrator/pinning.js";
import { defaultCatalog, defaultLane, defaultRoot } from "../core/orchestrator/handoff-fixtures.js";

// @req FR-NODE-166 — the vocabulary the CLI EMITS is closed over `GateId`, not only the vocabulary
// the shipped skills DECLARE. `FR-NODE-122` asserts declared ⊆ union; nothing asserted the other
// direction statically, and two live emitters carried identifiers the union omitted.
//
// Every CLI assertion below pins the identifier rather than only asserting union membership: a
// refusal on some earlier gate would satisfy "is a GATE_IDS member" while never reaching the path
// under test.

const GATES: readonly string[] = GATE_IDS;

/** The three `HandoffViolationCode` members that are findings rather than gates. @req FR-NODE-166 AC-5 */
const NON_GATE_VIOLATION_CODES = ["handoff-schema-invalid", "handoff-task-field-count", "handoff-set-inequality"];

const ORCHESTRATOR_SKILL_ROOTS = ["skills/claude", "skills/codex", "skills/etc", ".agents/skills"];

function io() {
  return { stdout: new PassThrough(), stderr: new PassThrough() };
}

function drain(stream: PassThrough): string {
  return stream.read()?.toString() ?? "";
}

interface Run {
  readonly exit: number;
  readonly payload: Record<string, unknown>;
}

async function run(argv: string[]): Promise<Run> {
  const pipes = io();
  const exit = await main([...argv, "--json"], pipes);
  const text = drain(pipes.stdout);
  return { exit, payload: text.length > 0 ? (JSON.parse(text) as Record<string, unknown>) : {} };
}

async function tempRoot(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "speckiwi-orchestrate-vocab-"));
}

async function write(root: string, relativePath: string, text: string): Promise<void> {
  const absolute = path.join(root, relativePath);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, text, "utf8");
}

/** A sidecar whose task ids are exactly `ids`; repeating one breaks the plan's partition invariant. */
function sidecar(ids: string[]): string {
  return JSON.stringify({
    schema_version: "1.1.0",
    plan_contract: "1.2.0",
    tasks: ids.map((id, index) => ({
      id,
      type: "code",
      action: `implement ${id} (${index})`,
      req_ids: ["FR-ARCH-001"],
      files: [{ path: `src/${id}-${index}.ts` }],
      test_files: [],
      covers_ac: ["AC-1"],
      depends_on_task: []
    }))
  });
}

describe("FR-NODE-166 AC-1 — refuse() takes GateId alone", () => {
  it("declares no `| string` widening on the gate parameter", async () => {
    const source = await readFile(path.join(process.cwd(), "src/cli/commands/orchestrate.ts"), "utf8");
    const declaration = source.split("\n").find((line) => line.startsWith("function refuse("));

    expect(declaration, "refuse() is declared at module scope in orchestrate.ts").toBeDefined();
    expect(declaration).toMatch(/^function refuse\(gate: GateId,/);
    expect(declaration).not.toContain("| string");
  });
});

describe("FR-NODE-166 AC-2 — every error type that feeds refuse() carries a declared gate", () => {
  it("HandoffPinError's gate is a GATE_IDS member", () => {
    expect(GATES).toContain(new HandoffPinError("probe").gate);
  });

  it("every lane-plan error code is a GATE_IDS member", () => {
    // Non-vacuity: the list is the one the type is derived from, so it cannot silently empty.
    expect(LANE_PLAN_ERROR_CODES.length).toBeGreaterThanOrEqual(2);
    for (const code of LANE_PLAN_ERROR_CODES) expect(GATES, code).toContain(code);
  });
});

describe("FR-NODE-166 AC-3 — `freeze design` reports handoff-pin-untrusted", () => {
  it("exits 2 with the pinned identifier when the pin cannot be established", async () => {
    const root = await tempRoot();
    await write(root, "body.json", JSON.stringify({ kind: "design" }));
    await write(root, "design.md", "# design\n");

    const refused = await run([
      "--root", root, "orchestrate", "freeze", "design",
      "--body", "body.json", "--document", "design.md",
      "--head", "not-a-canonical-object-id", "--run-id", "run-a"
    ]);

    expect(refused.exit, JSON.stringify(refused.payload)).toBe(2);
    expect(refused.payload.gate).toBe("handoff-pin-untrusted");
    expect(GATES).toContain(refused.payload.gate);
  });
});

describe("FR-NODE-166 AC-4 — `schedule plan` reports lane-plan-incomplete", () => {
  it("exits 2 with the pinned identifier when the plan is not a partition of the catalogue", async () => {
    const root = await tempRoot();
    await write(root, "plan.sidecar.json", sidecar(["T-A", "T-A", "T-B"]));

    const refused = await run([
      "--root", root, "orchestrate", "schedule", "plan",
      "--plan", "plan.sidecar.json", "--out", "lanes.lock.json"
    ]);

    expect(refused.exit, JSON.stringify(refused.payload)).toBe(2);
    expect(refused.payload.gate).toBe("lane-plan-incomplete");
    expect(GATES).toContain(refused.payload.gate);
  });
});

describe("FR-NODE-166 AC-5 — the three non-gate violation codes stay outside the union", () => {
  it("keeps them out of GATE_IDS", () => {
    for (const code of NON_GATE_VIOLATION_CODES) expect(GATES, code).not.toContain(code);
  });

  it("still collapses a violation of one of them to the umbrella gate", async () => {
    const root = await tempRoot();
    await write(root, "lane.json", JSON.stringify(defaultLane()));
    await write(root, "catalog.json", JSON.stringify(defaultCatalog()));
    await write(root, "base.json", JSON.stringify(defaultRoot()));
    await write(root, "bad.md", "# not a handoff\n");

    const refused = await run([
      "--root", root, "orchestrate", "handoff", "validate",
      "--lane", "lane.json", "--path", "bad.md", "--catalog", "catalog.json", "--base", "base.json"
    ]);

    expect(refused.exit, JSON.stringify(refused.payload)).toBe(2);
    const violations = refused.payload.violations as Array<{ code: string }>;
    expect(violations.length, "the fixture must actually violate something").toBeGreaterThan(0);
    // The collapse is only observed if the leading violation is one of the three non-gate codes.
    expect(NON_GATE_VIOLATION_CODES, JSON.stringify(violations[0])).toContain(violations[0]?.code);
    expect(refused.payload.gate).toBe("handoff-verify-failed");
  });
});

describe("FR-NODE-166 AC-6 — admission leaves the --auto classification untouched", () => {
  it("declares neither identifier in any bundled kiwi-orchestrator variant", async () => {
    const bodies: Array<{ file: string; body: string }> = [];
    for (const root of ORCHESTRATOR_SKILL_ROOTS) {
      const candidate = path.join(process.cwd(), root, "kiwi-orchestrator", "SKILL.md");
      bodies.push({ file: root, body: await readFile(candidate, "utf8") });
    }

    // Non-vacuity: an empty or short list would pass the loop below on nothing.
    expect(bodies.length, "the variant roots resolved to nothing").toBeGreaterThanOrEqual(3);
    for (const variant of bodies) {
      expect(variant.body, `${variant.file} declares handoff-pin-untrusted`).not.toContain("handoff-pin-untrusted");
      expect(variant.body, `${variant.file} declares lane-plan-incomplete`).not.toContain("lane-plan-incomplete");
    }
  });
});
