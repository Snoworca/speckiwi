import { describe, expect, it } from "vitest";
import { parseWavesJournal } from "../../../src/core/orchestrator/waves-journal.js";
import { WAVES_SCHEMA_VERSIONS } from "../../../src/core/orchestrator/journal-schema.js";
import { complete, finalVerify, intent, journalRoot, result, waveVerify } from "./waves-fixtures.js";

// FR-NODE-140 — run-scoped, engine-filtered `waves.jsonl` parser over schema versions 1.0.0-1.4.0.

describe("FR-NODE-140 parseWavesJournal", () => {
  it("AC-1 restricts lines and latestPerWave to the requested run", async () => {
    const root = await journalRoot([
      waveVerify({ run_id: "run-a", wave: "wave-1" }),
      waveVerify({ run_id: "run-b", wave: "wave-1" }),
      complete({ run_id: "run-b", wave: "wave-1", summary: "run-b finished wave 1" }),
      complete({ run_id: "run-a", wave: "wave-1", summary: "run-a finished wave 1" })
    ]);

    const view = await parseWavesJournal(root, { runId: "run-a", engine: "kiwi-wave-master" });

    expect(view.runId).toBe("run-a");
    expect(view.lines).toHaveLength(2);
    expect(view.lines.every((line) => line.run_id === "run-a")).toBe(true);
    expect(view.latestPerWave.get(1)?.summary).toBe("run-a finished wave 1");
  });

  it("AC-2 treats a line with no engine field as kiwi-wave-master on both filters", async () => {
    const root = await journalRoot([
      waveVerify({ wave: "wave-1", summary: "no engine field" }),
      waveVerify({ wave: "wave-2", order: 2, target: "wave-2", engine: "kiwi-wave-master", summary: "explicit wave-master" }),
      waveVerify({ wave: "wave-3", order: 3, target: "wave-3", engine: "kiwi-orchestrator", summary: "orchestrator" })
    ]);

    const orchestrator = await parseWavesJournal(root, { runId: "run-a", engine: "kiwi-orchestrator" });
    expect(orchestrator.lines.map((line) => line.summary)).toEqual(["orchestrator"]);

    const waveMaster = await parseWavesJournal(root, { runId: "run-a", engine: "kiwi-wave-master" });
    expect(waveMaster.lines.map((line) => line.summary)).toEqual(["no engine field", "explicit wave-master"]);
  });

  it("AC-3 accepts the five supported schema versions and diagnoses one outside the set", async () => {
    expect(WAVES_SCHEMA_VERSIONS).toEqual(["1.0.0", "1.1.0", "1.2.0", "1.3.0", "1.4.0"]);

    const supported = await journalRoot(
      WAVES_SCHEMA_VERSIONS.map((version, index) =>
        waveVerify({ schema_version: version, wave: `wave-${index + 1}`, order: index + 1, target: `wave-${index + 1}` })
      )
    );
    const supportedView = await parseWavesJournal(supported, { runId: "run-a", engine: "kiwi-wave-master" });
    expect(supportedView.lines).toHaveLength(5);
    expect(supportedView.diagnostics.filter((item) => item.code === "SRS-W055")).toEqual([]);
    expect(supportedView.schemaVersions).toEqual(["1.0.0", "1.1.0", "1.2.0", "1.3.0", "1.4.0"]);

    const unsupported = await journalRoot([waveVerify({ schema_version: "2.0.0" })]);
    const unsupportedView = await parseWavesJournal(unsupported, { runId: "run-a", engine: "kiwi-wave-master" });
    const versionDiagnostics = unsupportedView.diagnostics.filter((item) => item.code === "SRS-W055");
    expect(versionDiagnostics).toHaveLength(1);
    expect(versionDiagnostics[0]?.line).toBe(1);
  });

  it("AC-4 exposes the seven declared fields and keys byVerb on verb|wave|stage|lane", async () => {
    const root = await journalRoot([
      result("execute-unit", { wave: "wave-2", order: 2, target: "wave-2", stage: 1, lane: "lane-1" }),
      result("execute-unit", { wave: "wave-2", order: 2, target: "wave-2", stage: 1, lane: "lane-2" }),
      result("execute-unit", { wave: "wave-2", order: 2, target: "wave-2", stage: 2, lane: "lane-1" })
    ]);

    const view = await parseWavesJournal(root, { runId: "run-a", engine: "kiwi-orchestrator" });

    expect(Object.keys(view).sort()).toEqual(
      ["byVerb", "diagnostics", "engine", "latestPerWave", "lines", "runId", "schemaVersions"].sort()
    );
    expect(view.engine).toBe("kiwi-orchestrator");
    // Two lines differing only in `lane` occupy different keys; likewise for `stage`.
    expect(view.byVerb.get("execute-unit|wave-2|1|lane-1")).toHaveLength(1);
    expect(view.byVerb.get("execute-unit|wave-2|1|lane-2")).toHaveLength(1);
    expect(view.byVerb.get("execute-unit|wave-2|2|lane-1")).toHaveLength(1);
    expect(view.byVerb.size).toBe(3);
  });

  it("AC-5 produces no duplicate-key diagnostic and resolves no correction chain over many lines of one run", async () => {
    const many = Array.from({ length: 40 }, (_unused, index) =>
      waveVerify({ summary: `round ${index + 1}`, verification: { rounds: index + 1 } })
    );
    const root = await journalRoot([
      ...many,
      // `status: "CORRECTION"` is the shared reader's correction marker. Under append-only keying it
      // must stay an ordinary line rather than superseding anything.
      waveVerify({ status: "CORRECTION", corrects_run_id: "run-a", summary: "not a correction here" })
    ]);

    const view = await parseWavesJournal(root, { runId: "run-a", engine: "kiwi-wave-master" });

    expect(view.diagnostics.filter((item) => item.code === "SRS-W053")).toEqual([]);
    expect(view.diagnostics.filter((item) => item.code === "SRS-W054")).toEqual([]);
    expect(view.lines).toHaveLength(41);
    expect(view.lines.at(-1)?.summary).toBe("not a correction here");
  });

  it("excludes wave=\"all\" run-scope events from latestPerWave", async () => {
    const root = await journalRoot([complete({ wave: "wave-1" }), finalVerify()]);

    const view = await parseWavesJournal(root, { runId: "run-a", engine: "kiwi-wave-master" });

    expect([...view.latestPerWave.keys()]).toEqual([1]);
    expect(view.lines).toHaveLength(2);
  });

  it("returns an empty view rather than throwing when the journal file is absent", async () => {
    const root = await journalRoot([waveVerify()], "kiwi/other.jsonl");

    const view = await parseWavesJournal(root, { runId: "run-a", engine: "kiwi-wave-master" });

    expect(view.lines).toEqual([]);
    expect(view.latestPerWave.size).toBe(0);
  });

  it("keeps an unmatched intent line in the view so computeResumeState can classify it", async () => {
    const root = await journalRoot([intent("execute-unit", { wave: "wave-1", stage: 1, lane: "lane-1" })]);

    const view = await parseWavesJournal(root, { runId: "run-a", engine: "kiwi-orchestrator" });

    expect(view.byVerb.get("execute-unit|wave-1|1|lane-1")).toHaveLength(1);
    expect(view.lines[0]?.event).toBe("intent");
  });
});
