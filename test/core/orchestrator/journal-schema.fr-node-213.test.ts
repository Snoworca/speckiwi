import { describe, expect, it } from "vitest";
import {
  CURRENT_WAVES_SCHEMA_VERSION,
  VERBS,
  VERB_RECOVERY_CLASS,
  WAVES_EVENT_FIELDS,
  WAVES_SCHEMA_VERSIONS,
  WAVE_PHASES,
  compareSchemaVersions,
  isVerb
} from "../../../src/core/orchestrator/journal-schema.js";
import { parseWavesJournal } from "../../../src/core/orchestrator/waves-journal.js";
import { validateWavesJournal } from "../../../src/core/orchestrator/waves-validate.js";
import { journalRoot, type Json } from "./waves-fixtures.js";

// FR-NODE-213 AC-5 and AC-6 — the journal schema the validator reads: the verb vocabulary a wave
// worker run is journalled in, and the field set raised to a new schema version.

const WORKER_VERBS = ["dispatch-lane", "collect-lane", "verify-lane", "remediate-lane", "release-lane", "integrate-lane"] as const;

describe("FR-NODE-213 AC-5 the journal verb vocabulary", () => {
  it("FR-NODE-213 AC-5 renames plan-wave to sds-wave, keeping its recovery class", () => {
    expect(VERBS).toContain("sds-wave");
    expect(VERBS as readonly string[]).not.toContain("plan-wave");
    expect(VERB_RECOVERY_CLASS["sds-wave"]).toBe("externally-visible");
  });

  it("FR-NODE-213 AC-5 carries the six worker verbs in the closed vocabulary a resume card is checked against", () => {
    for (const verb of WORKER_VERBS) {
      expect(VERBS, verb).toContain(verb);
      expect(isVerb(verb), `${verb} is accepted as a card's next verb`).toBe(true);
    }
  });
});

describe("FR-FLOW-051 AC-6 the phase vocabulary names the stages a wave resumes between", () => {
  it("FR-FLOW-051 AC-6 carries sds and worker beside the earlier phases, which stay readable on old lines", () => {
    expect(WAVE_PHASES).toContain("sds");
    expect(WAVE_PHASES).toContain("worker");
    for (const kept of ["pipeline", "srs-authoring", "wave-verify", "final-verify"]) expect(WAVE_PHASES, kept).toContain(kept);
  });
});

describe("FR-NODE-213 AC-6 the waves journal field set under a raised schema version", () => {
  it("FR-NODE-213 AC-6 drops plan_run_id and coverage_residual and adds sds_id", () => {
    const declared = [...WAVES_EVENT_FIELDS.required, ...WAVES_EVENT_FIELDS.optional] as string[];
    expect(declared).not.toContain("plan_run_id");
    expect(declared).not.toContain("coverage_residual");
    expect(WAVES_EVENT_FIELDS.optional as readonly string[]).toContain("sds_id");
  });

  it("FR-NODE-213 AC-6 raises the schema version above every version the reader accepted before", () => {
    expect(CURRENT_WAVES_SCHEMA_VERSION).toBe("2.0.0");
    expect(WAVES_SCHEMA_VERSIONS).toContain(CURRENT_WAVES_SCHEMA_VERSION);
    for (const earlier of WAVES_SCHEMA_VERSIONS.filter((version) => version !== CURRENT_WAVES_SCHEMA_VERSION)) {
      expect(compareSchemaVersions(CURRENT_WAVES_SCHEMA_VERSION, earlier), earlier).toBeGreaterThan(0);
    }
  });

  it("FR-NODE-213 AC-6 reads an earlier-version line carrying the dropped fields without re-validating it, beside a raised-version line", async () => {
    const stamp = { engine: "kiwi-orchestrator", writer: "speckiwi-orchestrate/4.0.0", run_id: "run-a", ts: "2026-09-27T09:00:00.000Z" };
    const lines: Json[] = [
      {
        ...stamp,
        schema_version: "1.5.0",
        verb: "dispatch-route",
        event: "result",
        wave: "all",
        plan_run_id: "2026-09-01T00-00-00",
        coverage_residual: [{ req_id: "FR-NODE-001", reason: "left open", owner: "wave-2" }]
      },
      { ...stamp, schema_version: CURRENT_WAVES_SCHEMA_VERSION, verb: "sds-wave", event: "intent", wave: "wave-1", sds_id: "run-a-wave-1" },
      { ...stamp, schema_version: CURRENT_WAVES_SCHEMA_VERSION, verb: "sds-wave", event: "result", wave: "wave-1", sds_id: "run-a-wave-1" }
    ];
    const root = await journalRoot(lines);
    const view = await parseWavesJournal(root, { runId: "run-a", engine: "kiwi-orchestrator" });

    expect(view.lines).toHaveLength(3);
    expect(view.diagnostics.filter((entry) => entry.severity === "error")).toEqual([]);
    expect(validateWavesJournal(view).filter((entry) => entry.severity === "error")).toEqual([]);
  });
});
