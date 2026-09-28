import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { MAX_LANE_CAP } from "../../src/cli/commands/orchestrate.js";
import { ORCHESTRATOR_VARIANTS, readVariant } from "../support/critical-gate-table.js";
import { sdsPath, sdsWorkspace } from "../core/orchestrator/sds-fixtures.js";

// @req IR-CLI-098 — `--lanes` is validated where `orchestrate schedule waves` reads it, so a typo is
// refused naming the option and the value instead of clamping silently inside the planner.

function drain(stream: PassThrough): string {
  return stream.read()?.toString() ?? "";
}

interface Run {
  readonly exit: number;
  readonly text: string;
  readonly payload: Record<string, unknown>;
}

/** `count` independent waves with disjoint write sets — the shape whose stage count the cap decides. */
async function plan(count: number, lanes?: string): Promise<Run> {
  const ids = Array.from({ length: count }, (_unused, index) => `cap-wave-${index + 1}`);
  const root = await sdsWorkspace(ids.map((id) => ({ id, files: [`src/${id}.ts`] })));
  const pipes = { stdout: new PassThrough(), stderr: new PassThrough() };
  const exit = await main(
    [
      "--root", root, "orchestrate", "schedule", "waves",
      "--sds", ...ids.map(sdsPath),
      "--depends", JSON.stringify(Object.fromEntries(ids.map((id) => [id, []]))),
      ...(lanes === undefined ? [] : ["--lanes", lanes]),
      "--json"
    ],
    pipes
  );
  const text = `${drain(pipes.stdout)}${drain(pipes.stderr)}`;
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(text) as Record<string, unknown>;
  } catch {
    payload = {};
  }
  return { exit, text, payload };
}

function stageCount(run: Run): number | undefined {
  return (run.payload.lock as { stage_count?: number } | undefined)?.stage_count;
}

/** A usage refusal, as distinct from an orchestration gate or a partition diagnostic. */
function refusedAsUsage(run: Run): boolean {
  return run.exit !== 0 && /--lanes/.test(run.text);
}

describe("IR-CLI-098 the lane cap is validated where it is read", () => {
  it("IR-CLI-098 AC-1 rejects a non-numeric cap before any plan is computed, naming option and value", async () => {
    const run = await plan(2, "abc");

    expect(refusedAsUsage(run), run.text).toBe(true);
    expect(run.text, "the received value must appear so the operator sees their own typo").toContain("abc");
    expect(run.payload.lock, "no lanes lock may be computed from a rejected cap").toBeUndefined();
    expect(run.text).not.toContain("lane-plan-incomplete");
  });

  it("IR-CLI-098 AC-2 rejects zero and a negative cap", async () => {
    const zero = await plan(2, "0");
    const negative = await plan(2, "-3");

    expect(refusedAsUsage(zero), zero.text).toBe(true);
    expect(refusedAsUsage(negative), negative.text).toBe(true);
  });

  it("IR-CLI-098 AC-3 rejects a cap above the declared maximum, and that maximum is the skill's", () => {
    // The criterion says "matching the maximum the skill body declares", so the bound is held against
    // the body rather than against a literal. Widening `MAX_LANE_CAP` alone refuses nothing, so a
    // hardcoded 9999 case would stay green while the two sides drifted apart.
    for (const variant of ORCHESTRATOR_VARIANTS) {
      const row = readVariant(variant)
        .split("\n")
        .find((line) => line.trimStart().startsWith("| `--lanes"));
      expect(row, `${variant} must declare --lanes`).toBeTruthy();
      expect(row, `${variant} must state the cap the code enforces`).toContain(String(MAX_LANE_CAP));
    }
  });

  it("IR-CLI-098 AC-3 rejects a cap one above the maximum, and far above it", async () => {
    const above = await plan(2, String(MAX_LANE_CAP + 1));
    expect(refusedAsUsage(above), above.text).toBe(true);
    expect(above.payload.lock).toBeUndefined();

    const far = await plan(2, "9999");
    expect(refusedAsUsage(far), far.text).toBe(true);
  });

  it("IR-CLI-098 AC-4 rejects a fractional cap rather than truncating it", async () => {
    const run = await plan(2, "2.5");

    expect(refusedAsUsage(run), run.text).toBe(true);
  });

  it("IR-CLI-098 AC-6 accepts 1 and 8, and omitting the option keeps the cap at 4", async () => {
    const one = await plan(2, "1");
    expect(one.exit, one.text).toBe(0);
    expect(stageCount(one)).toBe(2);

    // Five lanes against a cap of 8 fit in one stage; against the default 4 they do not. The stage
    // count is what makes the accepted value observable rather than merely non-refused.
    const eight = await plan(5, "8");
    expect(eight.exit, eight.text).toBe(0);
    expect(stageCount(eight)).toBe(1);

    const defaulted = await plan(5);
    expect(defaulted.exit, defaulted.text).toBe(0);
    expect(stageCount(defaulted), "the default cap of 4 must still split five lanes").toBe(2);
  });
});
