// @req FR-NODE-141, FR-NODE-142, FR-NODE-143, FR-NODE-139, FR-NODE-152 — the journal validator.
//
// Every rule here is mechanical: it reads a recorded object and refuses a shape, never a judgment.
// The two rule tables it implements are declared as data in `journal-schema.ts` so the contract-parity
// class can enumerate them by measurement rather than against a count.
//
// The validator is hosted by `orchestrate journal append`, which validates on every write, so two
// exclusions are load-bearing (@req FR-NODE-139): an unmatched `intent` is never a diagnostic, and the
// v1.4.0 lane-terminality rule fires only on a wave `complete` or a `final-verify` line. Either one
// applied per line would refuse the very first write of every verb.
import type { Diagnostic, DiagnosticSeverity } from "../types.js";
import { GATE_IDS } from "./auto-gate.js";
import { isRoundRecord, type WavesJournalView } from "./waves-journal.js";
import {
  COMPLETION_STATUS,
  EVENT_STATUSES,
  EXCLUSION_CLASSES,
  EXTERNAL_PROOF_KINDS,
  REASON_CLASSES,
  VERIFICATION_VERDICTS,
  WRITER_REQUIRED_FROM,
  compareSchemaVersions,
  waveNumber,
  type EventStatus,
  type JournalProof,
  type WavesEvent,
  type WavesRuleCode
} from "./journal-schema.js";

/**
 * A journal diagnostic. `code` is the named violation code rather than an `SRS-*` registry code: the
 * registry catalogues SRS-document diagnostics, and these are journal-contract violations whose names
 * are themselves the contract (05 §10.1's two rule tables).
 */
export interface WavesDiagnostic extends Diagnostic {
  code: WavesRuleCode;
}

// ---------------------------------------------------------------------------------------------
// Reading helpers — every one is total, because a v1.0.0 line carries almost none of these fields.
// ---------------------------------------------------------------------------------------------

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function array(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null;
}

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function schemaVersionOf(event: WavesEvent): string {
  return text(event.schema_version) ?? "1.0.0";
}

/** The highest schema version anywhere in the run. Run-scoped, because the producer writes the field. */
function runSchemaVersion(view: WavesJournalView): string {
  let highest = "1.0.0";
  for (const event of view.lines) {
    const version = schemaVersionOf(event);
    if (compareSchemaVersions(version, highest) > 0) highest = version;
  }
  return highest;
}

function runIsAtLeast(view: WavesJournalView, version: string): boolean {
  return compareSchemaVersions(runSchemaVersion(view), version) >= 0;
}

function verificationOf(event: WavesEvent): Record<string, unknown> | null {
  return record(event.verification);
}

function verdictOf(event: WavesEvent): string | null {
  const verification = verificationOf(event);
  return verification ? text(verification.verdict) : null;
}

function proofsOf(event: WavesEvent): JournalProof[] {
  // 05 §4.3 writes `proof` singular; AC-2 of FR-NODE-152 requires "one additional proof". One field,
  // normalised in one place, rather than two fields that can disagree.
  const raw: unknown = event.proof;
  const candidates = Array.isArray(raw) ? raw : [raw];
  return candidates
    .map((item) => record(item))
    .filter((item): item is Record<string, unknown> => item !== null)
    .map((item) => ({ kind: String(item.kind ?? ""), ...(typeof item.ref === "string" ? { ref: item.ref } : {}) }));
}

function diagnosticFor(
  code: WavesRuleCode,
  severity: DiagnosticSeverity,
  message: string,
  event: WavesEvent | null,
  details?: unknown
): WavesDiagnostic {
  return {
    code,
    severity,
    message,
    ...(event ? { line: event.journalLine } : {}),
    ...(details !== undefined ? { details } : {})
  };
}

// ---------------------------------------------------------------------------------------------
// Round invariants — the eleven-code table, minus the two a journal line cannot express
// ---------------------------------------------------------------------------------------------

function isSubset(subject: unknown[], of: unknown[]): boolean {
  const superset = new Set(of.map((item) => JSON.stringify(item)));
  return subject.every((item) => superset.has(JSON.stringify(item)));
}

/**
 * @req FR-NODE-141 — the mechanical round invariants of `waves-event.md` §2.3.
 *
 * `fix-in-clean-round` is absent by construction: no journal field records whether a fix was applied
 * in a round, so the rule is enforced by `evaluateRound`, which is given that flag. Recording the
 * absence here is what stops a test asserting a code the journal can never produce.
 */
function checkRoundInvariants(event: WavesEvent, diagnostics: WavesDiagnostic[]): void {
  const verification = verificationOf(event);

  if (event.status === COMPLETION_STATUS && !verification) {
    diagnostics.push(
      diagnosticFor(
        "complete-without-verification",
        "warning",
        "complete event carries no verification object and reads as unverified rather than clean",
        event
      )
    );
    return;
  }
  if (!verification) return;

  // `status` is the only positive completion signal; a verification-bearing line with no valid status
  // leaves `verification` as the sole readable signal, which is the second source of truth :101 refuses.
  const status = text(event.status);
  if (status === null || !(EVENT_STATUSES as readonly string[]).includes(status)) {
    diagnostics.push(
      diagnosticFor("verification-without-status", "error", "verification is evidence, not authority: the line records no valid status", event, {
        status: event.status
      })
    );
  }

  const verdict = verdictOf(event);
  const claimsPass = verdict === "pass";
  const rollUp = text(record(verification.axis_a)?.roll_up ?? null);
  const allMatch = rollUp === "ALL_MATCH";

  const designLayer = record(verification.design_layer);
  const unmapped = array(designLayer?.unmapped) ?? [];
  if (unmapped.length > 0 && allMatch) {
    diagnostics.push(
      diagnosticFor("unmapped-design-item", "error", "an unmapped design item forbids ALL_MATCH", event, { unmapped: unmapped.length })
    );
  }

  const constraintLayer = record(verification.constraint_layer);
  const violations = array(constraintLayer?.violations) ?? [];
  if (violations.length > 0 && allMatch) {
    diagnostics.push(
      diagnosticFor("constraint-violation", "error", "a constraint violation forbids ALL_MATCH", event, { violations: violations.length })
    );
  }

  const preservationRows = array(record(verification.preservation_layer)?.rows) ?? [];
  const damaged = preservationRows.filter((row) => text(record(row)?.verdict ?? null) === "unapproved-damage");
  if (damaged.length > 0 && claimsPass) {
    diagnostics.push(
      diagnosticFor("unapproved-damage", "error", "an unapproved-damage preservation row forbids a pass verdict", event, {
        rows: damaged.length
      })
    );
  }

  const regression = record(verification.regression);
  if (regression && claimsPass) {
    const failing = array(regression.failing_tests) ?? [];
    const baseline = array(regression.baseline_failing_tests);
    if (baseline === null) {
      // With no baseline a new failure cannot be separated from a pre-existing one, so the only
      // passing condition left is a zero exit code.
      if ((count(regression.exit_code) ?? 0) !== 0) {
        diagnostics.push(
          diagnosticFor("no-baseline-nonzero-exit", "error", "no regression baseline was captured and the exit code is not zero", event, {
            exit_code: regression.exit_code
          })
        );
      }
    } else if (!isSubset(failing, baseline)) {
      diagnostics.push(
        diagnosticFor("new-regression", "error", "failing tests are not a subset of the baseline failing tests", event, {
          failing_tests: failing
        })
      );
    }
  }

  // @req FR-NODE-170 — a line that declares its round void is not refused for the mismatch that
  // made it void; that record is the only honest one there is. Scoping to terminal verdicts instead
  // was rejected: the verdict map sends both `invalid` and `fail-residual` to `in-progress`, so a
  // terminal-only exemption exempts every non-terminating round line and the journal can no longer
  // tell a void round from a running one — the exact fact the exemption exists to preserve.
  const declaredVoid = verification.invalid_round === true;
  const frozen = record(verification.frozen_denominator);
  if (frozen && !declaredVoid) {
    // The round's declared denominators against the denominators frozen at round entry. The
    // enumerated *arrays* are checked by `truncated-residual` below, which is a different failure.
    const declared: Array<[string, number | null, number | null]> = [
      ["req_ac", count(record(verification.axis_a)?.checked ?? null), count(frozen.req_ac)],
      ["design_items", count(designLayer?.expected ?? null), count(frozen.design_items)],
      ["preservation", count(record(verification.preservation_layer)?.checked ?? null), count(frozen.preservation)],
      ["constraints", count(constraintLayer?.checked ?? null), count(frozen.constraints)]
    ];
    const mismatched = declared.filter(([, enumerated, fixed]) => enumerated !== null && fixed !== null && enumerated !== fixed);
    if (mismatched.length > 0) {
      diagnostics.push(
        diagnosticFor("denominator-mismatch", "error", "an enumerated row count differs from the frozen denominator", event, {
          layers: mismatched.map(([layer, enumerated, fixed]) => ({ layer, enumerated, frozen: fixed }))
        })
      );
    }
  }

  const truncated: string[] = [];
  const expectedDesign = count(designLayer?.expected ?? null);
  const mappedDesign = count(designLayer?.mapped ?? null);
  if (expectedDesign !== null && mappedDesign !== null && unmapped.length !== expectedDesign - mappedDesign) {
    truncated.push("design_layer.unmapped");
  }
  const open = record(record(verification.axis_b)?.open ?? null);
  const residual = array(verification.residual);
  const terminal = verdict !== null && verdict !== "in-progress";
  if (terminal && open && residual !== null) {
    const openTotal = ["critical", "high", "medium", "low"].reduce((sum, key) => sum + (count(open[key]) ?? 0), 0);
    if (residual.length !== openTotal) truncated.push("residual");
  }
  if (truncated.length > 0) {
    diagnostics.push(
      diagnosticFor("truncated-residual", "error", "an enumeration the contract requires in full was truncated", event, { truncated })
    );
  }

  // Rounds beyond the cap can never be a pass, and this needs no mode: it is arithmetic on two
  // recorded numbers. The mode-dependent unreachable-PASS rule stays in `evaluateRound`, which is
  // given the mode, because `cap` alone is ambiguous between `--max` and an explicit `--loops`.
  const rounds = count(verification.rounds);
  const cap = count(verification.cap);
  if (claimsPass && rounds !== null && cap !== null && rounds > cap) {
    diagnostics.push(diagnosticFor("cap-exhausted", "error", "the round cap was exhausted, which is not a pass", event, { rounds, cap }));
  }

  for (const item of residual ?? []) {
    const reasonClass = text(record(item)?.reason_class ?? null);
    if (reasonClass !== null && !(REASON_CLASSES as readonly string[]).includes(reasonClass)) {
      diagnostics.push(
        diagnosticFor("reason-class-outside-vocabulary", "error", "a residual reason_class is outside the closed vocabulary", event, {
          reason_class: reasonClass
        })
      );
    }
  }

  if (verdict !== null && !(VERIFICATION_VERDICTS as readonly string[]).includes(verdict)) {
    diagnostics.push(
      diagnosticFor("verification-without-status", "error", "the verification verdict is outside the closed vocabulary", event, { verdict })
    );
  }
}

// ---------------------------------------------------------------------------------------------
// Journal-level rules
// ---------------------------------------------------------------------------------------------

/** The latest `phase="wave-verify"` record for `wave`, at or before `beforeIndex`. */
function latestWaveVerify(view: WavesJournalView, wave: string, beforeIndex: number): WavesEvent | null {
  for (let index = beforeIndex - 1; index >= 0; index -= 1) {
    const candidate = view.lines[index];
    if (!candidate) continue;
    if (candidate.phase !== "wave-verify") continue;
    if (candidate.wave !== wave) continue;
    return candidate;
  }
  return null;
}

/**
 * @req FR-NODE-142 — the wave completion gate. The 1.1.0 exemption is evaluated per run rather than
 * per line: the schema version is written by the producer being policed, so a per-line exemption is a
 * downgrade bypass. `wave="all"` is exempt because a run-scope line has no wave-verify record of its
 * own and would always be refused.
 */
function checkCompletionGate(view: WavesJournalView, diagnostics: WavesDiagnostic[]): void {
  if (!runIsAtLeast(view, "1.1.0")) return;

  view.lines.forEach((event, index) => {
    if (event.status !== COMPLETION_STATUS) return;
    if (waveNumber(event.wave) === null) return;

    const latest = latestWaveVerify(view, event.wave as string, index);
    if (latest && verdictOf(latest) === "pass") return;

    diagnostics.push(
      diagnosticFor("complete-without-latest-pass", "error", "complete is not preceded by a passing wave-verify record for this run and wave", event, {
        wave: event.wave,
        latestVerdict: latest ? verdictOf(latest) : null
      })
    );
  });
}

/** @req FR-NODE-143 — a final verification that did not pass is `failed`, never `complete`. */
function checkFinalVerify(view: WavesJournalView, diagnostics: WavesDiagnostic[]): void {
  for (const event of view.lines) {
    if (event.phase !== "final-verify") continue;
    if (event.status !== COMPLETION_STATUS) continue;
    if (verdictOf(event) === "pass") continue;

    diagnostics.push(
      diagnosticFor("final-verify-not-passed-complete", "error", "a final-verify that did not pass is recorded as complete", event, {
        verdict: verdictOf(event)
      })
    );
  }
}

function checkExclusionClasses(view: WavesJournalView, diagnostics: WavesDiagnostic[]): void {
  for (const event of view.lines) {
    const outOfScope = array(record(event.design_baseline)?.out_of_scope ?? null) ?? [];
    for (const row of outOfScope) {
      const value = text(record(row)?.exclusion_class ?? null);
      if (value !== null && !(EXCLUSION_CLASSES as readonly string[]).includes(value)) {
        diagnostics.push(
          diagnosticFor("exclusion-class-outside-vocabulary", "error", "an out_of_scope exclusion_class is outside the closed vocabulary", event, {
            exclusion_class: value
          })
        );
      }
    }
  }
}

/**
 * The writer stamp is required at 1.4.0 and above only; an older line reports as unstamped in the run
 * report and never fails, so it raises no diagnostic here. The downgrade guard closes the obvious
 * bypass — writing 1.3.0 after a 1.4.0 line in the same run.
 */
function checkWriterStamp(view: WavesJournalView, diagnostics: WavesDiagnostic[]): void {
  let seenV14 = false;
  for (const event of view.lines) {
    const version = schemaVersionOf(event);
    const atLeastV14 = compareSchemaVersions(version, WRITER_REQUIRED_FROM) >= 0;

    if (atLeastV14 && text(event.writer) === null) {
      diagnostics.push(diagnosticFor("unstamped-writer", "error", "a 1.4.0 or higher line carries no writer stamp", event));
    }
    if (seenV14 && !atLeastV14) {
      diagnostics.push(
        diagnosticFor("journal-version-downgrade", "error", "a lower schema_version follows a 1.4.0 line in the same run", event, {
          schema_version: version
        })
      );
    }
    if (atLeastV14) seenV14 = true;
  }
}

/**
 * @req FR-NODE-139 — lane terminality, evaluated only on a wave `complete` or a `final-verify` line.
 * A lane is terminal when it carries a `lane_disposition` (every kind is terminal) or an
 * `isolation.merge_sha`. Applied per line this rule would refuse every append made while a unit runs.
 */
function checkLaneTerminality(view: WavesJournalView, diagnostics: WavesDiagnostic[]): void {
  if (!runIsAtLeast(view, "1.4.0")) return;

  const terminalLanes = new Set<string>();
  const integratedLanes = new Map<string, WavesEvent>();
  for (const event of view.lines) {
    const lane = text(event.lane);
    if (lane === null) continue;
    const integrated = event.verb === "integrate-lane" && event.event === "result";
    // Terminal and merge-stamped are two different facts, and conflating them would make one rule
    // fire for the other's fixture: a lane is terminal when it integrated or when a disposition says
    // it never will; whether an integrated lane carries its merge_sha is the rule below.
    if (record(event.lane_disposition) !== null || integrated || text(record(event.isolation)?.merge_sha ?? null) !== null) {
      terminalLanes.add(lane);
    }
    if (integrated) integratedLanes.set(lane, event);
  }

  for (const event of view.lines) {
    const isWaveComplete = event.status === COMPLETION_STATUS && waveNumber(event.wave) !== null;
    if (!isWaveComplete && event.phase !== "final-verify") continue;

    const lanePlan = record(event.lane_plan);
    if (!lanePlan) continue;

    const laneCount = count(lanePlan.lane_count);
    if (laneCount !== null && terminalLanes.size < laneCount) {
      diagnostics.push(
        diagnosticFor("lane-not-terminal", "error", "a lane of the frozen lane plan has no terminal state", event, {
          lane_count: laneCount,
          terminal: terminalLanes.size
        })
      );
    }

    for (const [lane, integration] of integratedLanes) {
      if (text(record(integration.isolation)?.merge_sha ?? null) !== null) continue;
      diagnostics.push(
        diagnosticFor("integrated-lane-without-merge-sha", "error", "an integrated lane carries no merge_sha", event, { lane })
      );
    }
  }
}

/**
 * @req FR-NODE-152 — a verdict-bearing line whose proofs are all of kind `journal` is refused.
 *
 * The rule's subject is a line that *carries* proofs: `journal` is the only proof with no external
 * witness, so a verdict resting on it alone is a claim nothing can recompute. A verdict-bearing line
 * that carries no proof at all is outside this rule's stated subject and is not refused here.
 */
function checkJournalOnlyProofs(view: WavesJournalView, diagnostics: WavesDiagnostic[]): void {
  for (const event of view.lines) {
    const proofs = proofsOf(event);
    if (proofs.length === 0) continue;

    const bearsVerdict =
      verificationOf(event) !== null ||
      event.status === COMPLETION_STATUS ||
      (event.verb === "integrate-lane" && event.event === "result");
    if (!bearsVerdict) continue;

    if (proofs.some((proof) => (EXTERNAL_PROOF_KINDS as readonly string[]).includes(String(proof.kind)))) continue;

    diagnostics.push(
      diagnosticFor("journal-only-verdict", "error", "a verdict-bearing line carries no externally recomputable proof", event, {
        kinds: proofs.map((proof) => proof.kind)
      })
    );
  }
}

// ---------------------------------------------------------------------------------------------
// The public surface
// ---------------------------------------------------------------------------------------------

/**
 * `abort_gate` names the gate that ended the run and is closed over `GateId`. @req FR-NODE-167
 *
 * The severity is positional, and that is the whole point. `appendWavesLine` validates the entire
 * resulting journal and refuses on any error, so an error over history would refuse every append
 * into a run holding one non-conforming line — `run abort` included, which would leave the run lock
 * held with nothing able to release it. During an append the newest line IS the candidate, so error
 * there and warning everywhere else refuses the write being attempted and nothing else.
 */
function checkAbortGate(view: WavesJournalView, diagnostics: WavesDiagnostic[]): void {
  const newest = view.lines[view.lines.length - 1];
  for (const event of view.lines) {
    // Absent is legal; present-but-not-a-string is not. Reading the field through `text()` alone
    // conflated the two, because `text()` returns null for a number, a boolean or an object — so a
    // numeric `abort_gate` was as far outside `GateId` as a wrong string and raised nothing.
    const raw = event.abort_gate;
    if (raw === undefined || raw === null) continue;
    const gate = text(raw);
    if (gate !== null && (GATE_IDS as readonly string[]).includes(gate)) continue;
    const severity: DiagnosticSeverity = event === newest ? "error" : "warning";
    diagnostics.push(
      diagnosticFor("abort-gate-outside-vocabulary", severity, "an abort_gate is outside the GateId vocabulary", event, {
        abort_gate: gate ?? raw
      })
    );
  }
}

export function validateWavesJournal(view: WavesJournalView): WavesDiagnostic[] {
  const diagnostics: WavesDiagnostic[] = [];
  for (const event of view.lines) checkRoundInvariants(event, diagnostics);
  checkAbortGate(view, diagnostics);
  checkCompletionGate(view, diagnostics);
  checkFinalVerify(view, diagnostics);
  checkExclusionClasses(view, diagnostics);
  checkWriterStamp(view, diagnostics);
  checkLaneTerminality(view, diagnostics);
  checkJournalOnlyProofs(view, diagnostics);
  return diagnostics;
}

export interface RunProgress {
  /** Every wave of the run and its latest recorded status. `wave="all"` is excluded. */
  waveStatuses: Map<number, EventStatus>;
  /** The first wave whose latest status is not `complete`, in ascending wave order. */
  firstIncompleteWave: number | null;
  /** True when the run must resume at the final verification rather than reporting itself done. */
  needsFinalVerify: boolean;
  runComplete: boolean;
}

/**
 * @req FR-NODE-143 — the run-completion predicate: every wave is `complete` **and** the latest
 * `final-verify` verdict is `pass`.
 *
 * Run scoping carries no version exemption at all — the view is scoped to one `run_id`, so another
 * run's `complete` is not reachable from here — while the `final-verify` conjunct keeps its 1.2.0
 * exemption, evaluated per run for the same downgrade-bypass reason as the wave gate.
 */
export function computeRunProgress(view: WavesJournalView): RunProgress {
  const waveStatuses = new Map<number, EventStatus>();
  for (const [wave, event] of view.latestPerWave) {
    const status = text(event.status);
    if (status !== null && (EVENT_STATUSES as readonly string[]).includes(status)) waveStatuses.set(wave, status as EventStatus);
  }

  const waves = [...waveStatuses.keys()].sort((a, b) => a - b);
  const firstIncompleteWave = waves.find((wave) => waveStatuses.get(wave) !== COMPLETION_STATUS) ?? null;
  const allWavesComplete = waves.length > 0 && firstIncompleteWave === null;

  // @req FR-NODE-161 — the sibling of FR-NODE-159, and the half that repair left open. A loop-F round
  // record carries `phase: "final-verify"` and a passing verdict while asserting only that a verb ran,
  // so filtering on the phase alone let a program counter discharge the run's final verification —
  // measured: `needsFinalVerify` true → false and `runComplete` false → true on a run whose run-scope
  // line was never written. Same discriminator as FR-NODE-159, for the same reason: `kiwi-wave-master`
  // writes no `event` field, so no already-recorded line reads differently.
  //
  // @req FR-NODE-168 — the `assertsStatus` half stopped discriminating once a round record had to
  // carry a status, so a loop-F round record is now excluded by name. Both readers call the one
  // predicate, which is what keeps them from disagreeing about what a round record is.
  let latestFinalVerify: WavesEvent | null = null;
  for (const event of view.lines) {
    const assertsStatus = typeof event.status === "string" && (EVENT_STATUSES as readonly string[]).includes(event.status);
    if (event.phase === "final-verify" && assertsStatus && !isRoundRecord(event)) latestFinalVerify = event;
  }

  const conjunctApplies = runIsAtLeast(view, "1.2.0");
  const finalVerifyPassed = verdictOf(latestFinalVerify ?? ({ journalLine: 0 } as WavesEvent)) === "pass";
  const needsFinalVerify = allWavesComplete && conjunctApplies && !finalVerifyPassed;

  return {
    waveStatuses,
    firstIncompleteWave,
    needsFinalVerify,
    runComplete: allWavesComplete && (!conjunctApplies || finalVerifyPassed)
  };
}
