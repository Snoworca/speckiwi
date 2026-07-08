import { describe, expect, it } from "vitest";
import { computeSemanticSha } from "../../../src/core/mutation/records.js";
import type { RequirementRecord } from "../../../src/core/types.js";

// FR-NODE-020 — computeSemanticSha content-hash utility with fpv1 frozen vector.
//
// Red-phase suite (T-PH003-07): one test case per acceptance criterion
// (AC-1..AC-5). These cases describe the pure-function contract of
// computeSemanticSha before it is implemented in
// src/core/mutation/records.ts, so the whole suite fails (module/export
// missing) until the green task (T-PH003-08) introduces the function.
//
// Contract under test (from the requirement body):
//   computeSemanticSha is a pure function exported under the fpv=1 contract
//   that hashes sha1 over fpv1 joined with normalized requirement text, AC
//   text excluding checked state, status, stability, and metadata
//   (DENY={Status,Stability}, Scope included), excluding Trace Links,
//   Verification Evidence, and Change Notes, using norm = CRLF to LF,
//   per-line trailing-whitespace strip, whitespace runs collapsed to one
//   space, and outer trim.

const SHA1_HEX = /^[0-9a-f]{40}$/;

// Production-shape metadata: the parser emits no "Scope" metadata key — scope is
// stored only on the top-level `record.scope` field. Tests use this to avoid the
// previous false-confidence reliance on a synthetic `Scope` metadata key.
const METADATA_NO_SCOPE: Record<string, string> = {
  Type: "functional",
  Target: "v3.0.0",
  Status: "planned",
  Priority: "high",
  Risk: "medium",
  Stability: "evolving"
};

/** Builds a complete RequirementRecord with sensible defaults for hashing. */
function makeRecord(overrides: Partial<RequirementRecord> = {}): RequirementRecord {
  const base: RequirementRecord = {
    id: "FR-NODE-020",
    title: "computeSemanticSha content-hash utility",
    type: "functional",
    target: "v3.0.0",
    status: "planned",
    scope: "NODE",
    filePath: "docs/spec/50.nodejs-implementation.srs.md",
    headingLine: 1,
    metadata: { ...METADATA_NO_SCOPE },
    acceptanceCriteria: [
      { id: "AC-1", text: "first criterion text", checked: false, line: 10 },
      { id: "AC-2", text: "second criterion text", checked: false, line: 11 }
    ],
    verificationEvidence: [],
    traceLinks: [],
    changeNotes: [],
    tags: ["feasibility:high"],
    requirement: "computeSemanticSha hashes the semantic content of a requirement.",
    stability: "evolving"
  };
  return { ...base, ...overrides };
}

describe("FR-NODE-020 computeSemanticSha content-hash utility", () => {
  // AC-1: excludes the Trace Links, Verification Evidence, and Change Notes
  // sections from the hash input. Mutating any of those sections must leave
  // the semantic hash unchanged.
  it("FR-NODE-020 AC-1: excludes Trace Links, Verification Evidence, and Change Notes", () => {
    const baseline = makeRecord();
    const withSections = makeRecord({
      traceLinks: [
        { type: "Code", reference: "src/core/mutation/records.ts:142", relation: "addition_site", notes: "-" }
      ],
      verificationEvidence: [
        { id: "VE-1", type: "test", reference: "test/x.test.ts", covers: "all", notes: "-" }
      ],
      changeNotes: [{ date: "2026-06-04", change: "Created", reason: "add-requirement" }]
    });
    expect(computeSemanticSha(withSections)).toBe(computeSemanticSha(baseline));
  });

  // AC-2: excludes Status and Stability metadata keys while including Scope.
  //
  // Scope is the canonical top-level `record.scope` derived field — the parser
  // does NOT emit a "Scope" metadata key in production records (scope is derived
  // from `metadata.Scope || block.heading.id.split("-")[1]` and stored only at
  // top level). So this case asserts scope sensitivity via `record.scope` alone,
  // without a synthetic `Scope` metadata key, matching real parsed records.
  it("FR-NODE-020 AC-2: excludes Status/Stability, includes Scope", () => {
    const baseline = makeRecord({ metadata: { ...METADATA_NO_SCOPE } });

    // Changing Status (record field + metadata key) must not change the hash.
    const differentStatus = makeRecord({
      status: "implemented",
      metadata: { ...METADATA_NO_SCOPE, Status: "implemented" }
    });
    expect(computeSemanticSha(differentStatus)).toBe(computeSemanticSha(baseline));

    // Changing Stability (record field + metadata key) must not change the hash.
    const differentStability = makeRecord({
      stability: "stable",
      metadata: { ...METADATA_NO_SCOPE, Stability: "stable" }
    });
    expect(computeSemanticSha(differentStability)).toBe(computeSemanticSha(baseline));

    // Changing the top-level Scope must change the hash, even though there is no
    // "Scope" metadata key — i.e. scope sensitivity must come from record.scope
    // exactly as a real parsed production record carries it.
    const differentScope = makeRecord({
      scope: "PARSE",
      metadata: { ...METADATA_NO_SCOPE }
    });
    expect(computeSemanticSha(differentScope)).not.toBe(computeSemanticSha(baseline));
  });

  // AC-3: AC checked/unchecked state does not change the hash; AC text does.
  it("FR-NODE-020 AC-3: AC checked state ignored, AC text significant", () => {
    const baseline = makeRecord();

    // Flipping checked must not change the hash.
    const checkedFlipped = makeRecord({
      acceptanceCriteria: baseline.acceptanceCriteria.map((ac) => ({ ...ac, checked: true }))
    });
    expect(computeSemanticSha(checkedFlipped)).toBe(computeSemanticSha(baseline));

    // Changing AC text must change the hash.
    const textChanged = makeRecord({
      acceptanceCriteria: [
        { id: "AC-1", text: "first criterion text CHANGED", checked: false, line: 10 },
        { id: "AC-2", text: "second criterion text", checked: false, line: 11 }
      ]
    });
    expect(computeSemanticSha(textChanged)).not.toBe(computeSemanticSha(baseline));
  });

  // AC-4: normalization applies CRLF->LF, per-line trailing-whitespace strip,
  // whitespace-run collapse, and outer trim before hashing. Two records that
  // differ only by these normalizable forms must hash identically.
  it("FR-NODE-020 AC-4: normalization collapses CRLF/trailing/whitespace/trim differences", () => {
    const normalized = makeRecord({
      requirement: "alpha beta gamma",
      acceptanceCriteria: [{ id: "AC-1", text: "criterion one", checked: false, line: 10 }]
    });
    const denormalized = makeRecord({
      // CRLF line endings, per-line trailing whitespace, internal whitespace
      // runs, and outer leading/trailing whitespace that must all normalize away.
      requirement: "  alpha   beta\t \r\ngamma   \r\n",
      acceptanceCriteria: [{ id: "AC-1", text: "  criterion    one  ", checked: false, line: 10 }]
    });
    expect(computeSemanticSha(denormalized)).toBe(computeSemanticSha(normalized));
  });

  // AC-5: a frozen fpv1 test vector produces a stable documented hash asserted
  // by an automated test. The function is exported under the fpv=1 contract and
  // is pure: the same frozen vector yields the same 40-char lowercase sha1 hex
  // on every call, and the hash is sensitive to the requirement text.
  it("FR-NODE-020 AC-5: frozen fpv1 vector produces a stable, deterministic sha1", () => {
    const frozen = makeRecord({
      id: "FR-NODE-020",
      requirement: "frozen fpv1 vector requirement text",
      acceptanceCriteria: [
        { id: "AC-1", text: "frozen ac one", checked: false, line: 10 },
        { id: "AC-2", text: "frozen ac two", checked: true, line: 11 }
      ]
    });

    // Documented hash for the frozen fpv=1 vector above. This literal pins the
    // algorithm: any intentional change to the fpv=1 hashing contract MUST bump
    // the protocol to fpv=2 and add a NEW frozen vector rather than editing this
    // value, so algorithm drift is caught by a failing assertion here.
    const FROZEN_FPV1_HASH = "b9206c826e1975cc676bdc96610548cfd0121c3d";

    const first = computeSemanticSha(frozen);
    const second = computeSemanticSha(frozen);

    expect(first).toMatch(SHA1_HEX);
    expect(first).toBe(FROZEN_FPV1_HASH);
    expect(second).toBe(first);

    // The frozen vector's hash must differ from a vector differing only in the
    // requirement text, demonstrating the fpv1 hash binds the semantic content.
    const mutated = makeRecord({
      id: "FR-NODE-020",
      requirement: "frozen fpv1 vector requirement text MUTATED",
      acceptanceCriteria: [
        { id: "AC-1", text: "frozen ac one", checked: false, line: 10 },
        { id: "AC-2", text: "frozen ac two", checked: true, line: 11 }
      ]
    });
    expect(computeSemanticSha(mutated)).not.toBe(first);
  });
});
