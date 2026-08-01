// Fixture builders for the `kiwi/waves.jsonl` journal, shared by the FR-NODE-139..144 and
// FR-NODE-150..152 suites.
//
// Every builder starts from a *legal* payload and takes overrides, because the composite fixture
// FR-NODE-141 AC-2 requires is "satisfies every other rule and violates exactly one" — which is only
// constructible when the legal baseline is a single named thing rather than re-typed per test.
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

export type Json = Record<string, unknown>;

/**
 * `overrides` minus its `verification` key. The three round fixtures below take their `verification`
 * from an explicit argument, so an override carrying one would silently win over the value the test
 * is asserting about. Written as a helper rather than an omitting destructure because the discarded
 * binding trips `no-unused-vars` under this repository's `--max-warnings=0` lint.
 */
function withoutVerification(overrides: Json): Json {
  const rest: Json = { ...overrides };
  delete rest["verification"];
  return rest;
}

export const WAVES_RELATIVE_PATH = "kiwi/waves.jsonl";

/** The §2.3 `verification` object, at its v1.3.0 maximum and internally consistent. */
export function verification(overrides: Json = {}): Json {
  return {
    rounds: 2,
    cap: 5,
    verdict: "pass",
    axis_a: { roll_up: "ALL_MATCH", expected: 8, checked: 8 },
    axis_b: { substantive_clean: true, open: { critical: 0, high: 0, medium: 0, low: 0 } },
    design_layer: { expected: 6, mapped: 6, unmapped: [] },
    constraint_layer: { expected: 3, checked: 3, violations: [] },
    preservation_layer: { expected: 3, checked: 3, rows: [] },
    regression: { command: "npm test", exit_code: 0, failing_tests: [], baseline_failing_tests: [] },
    frozen_denominator: { round: 2, req_ac: 8, design_items: 6, preservation: 3, constraints: 3 },
    residual: [],
    report_path: "docs/analysis/report.md",
    ...overrides
  };
}

/**
 * Merges a `verification` override into the legal object, or omits the field entirely when the
 * caller passed the key explicitly as `undefined` — which is how the "complete with no verification"
 * fixtures are built. Without this an explicit `undefined` silently rebuilds the full legal object.
 */
function verificationField(overrides: Json): Json {
  if ("verification" in overrides && overrides.verification === undefined) return {};
  return { verification: verification((overrides.verification as Json) ?? {}) };
}

function baseLine(overrides: Json): Json {
  return {
    ts: "2026-08-02T09:12:44.201Z",
    schema_version: "1.3.0",
    run_id: "run-a",
    wave: "wave-1",
    order: 1,
    target: "wave-1",
    status: "in_progress",
    summary: "one-liner",
    ...overrides
  };
}

/** A `phase="wave-verify"` round record — §3's prerequisite pass record. */
export function waveVerify(overrides: Json = {}): Json {
  const rest = withoutVerification(overrides);
  return baseLine({
    status: "in_progress",
    phase: "wave-verify",
    pipeline_run_id: "prid-1",
    pipeline_run_ids: ["prid-1"],
    diff_window: { base_sha: "aaa", head_sha: "bbb" },
    ...verificationField(overrides),
    ...rest
  });
}

/** A wave `complete` line. */
export function complete(overrides: Json = {}): Json {
  const rest = withoutVerification(overrides);
  return baseLine({
    status: "complete",
    pipeline_run_id: "prid-1",
    pipeline_run_ids: ["prid-1"],
    diff_window: { base_sha: "aaa", head_sha: "bbb" },
    ...verificationField(overrides),
    ...rest
  });
}

/** The run-scope `phase="final-verify"` line: wave `"all"`, order 0, target `"all"`. */
export function finalVerify(overrides: Json = {}): Json {
  const rest = withoutVerification(overrides);
  return baseLine({
    schema_version: "1.2.0",
    wave: "all",
    order: 0,
    target: "all",
    status: "complete",
    phase: "final-verify",
    run_diff_window: { base_sha: "aaa", head_sha: "ccc" },
    ...verificationField(overrides),
    ...rest
  });
}

/** A v1.4.0 write-ahead intent line (§4.3 write 1). */
export function intent(verb: string, overrides: Json = {}): Json {
  return baseLine({
    schema_version: "1.4.0",
    engine: "kiwi-orchestrator",
    writer: "speckiwi-orchestrate/2.4.1",
    event: "intent",
    verb,
    inputs_digest: "sha256:1111",
    ...overrides
  });
}

/** A v1.4.0 write-behind result line (§4.3 write 3). */
export function result(verb: string, overrides: Json = {}): Json {
  return baseLine({
    schema_version: "1.4.0",
    engine: "kiwi-orchestrator",
    writer: "speckiwi-orchestrate/2.4.1",
    event: "result",
    verb,
    inputs_digest: "sha256:1111",
    card_digest: "sha256:2222",
    ...overrides
  });
}

export function toJournal(lines: Json[]): string {
  return `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`;
}

/**
 * Writes a journal into a fresh temp root and returns the `ProjectRoot`-shaped value the parser
 * takes. The suite never writes into the repository working tree (test/support/hermeticity-guard).
 */
export async function journalRoot(lines: Json[], relativePath = WAVES_RELATIVE_PATH): Promise<{ root: string }> {
  const root = await mkdtemp(path.join(tmpdir(), "speckiwi-waves-"));
  const absolute = path.join(root, relativePath);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, toJournal(lines), "utf8");
  return { root };
}
