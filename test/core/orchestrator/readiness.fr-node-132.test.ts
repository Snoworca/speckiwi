import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertRequirementsReady,
  deriveCanonicalRequirementReadiness,
  parseRequirementSnapshot,
  REQUIREMENT_NOT_READY_GATE,
  RequirementNotReadyError,
  scopeRequirementDiagnostics,
  type SpecRequirementRecord
} from "../../../src/core/orchestrator/readiness.js";
import { cliPayload, content, dependsOn, mcpPayload, OTHER_TARGET, record, snapshotOf, TARGET } from "./support/readiness-fixture.js";

const READINESS_SOURCE = path.join(
  import.meta.dirname, "..", "..", "..", "src", "core", "orchestrator", "readiness.ts"
);
const READY_EVIDENCE = [{ id: "EV-1", type: "test", covers: "all", reference: "test/example.test.ts" }];

function ready(id: string): SpecRequirementRecord {
  return record({ id, verificationEvidence: READY_EVIDENCE });
}

/**
 * Splits the module source into its top-level function bodies. Every function in `readiness.ts`
 * starts at column zero, so the boundary is the next such declaration.
 */
function topLevelFunctions(source: string): { name: string; body: string }[] {
  const starts = [...source.matchAll(/^(?:export )?function (\w+)/gmu)];
  return starts.map((match, index) => ({
    name: match[1]!,
    body: source.slice(match.index!, starts[index + 1]?.index ?? source.length)
  }));
}

describe("FR-NODE-132 readiness derived from a snapshot, transport-independently", () => {
  it("AC-1: both functions are pure over their arguments and reach no I/O", async () => {
    const source = await readFile(READINESS_SOURCE, "utf8");
    expect(source).toContain("export function deriveCanonicalRequirementReadiness");
    expect(source).toContain("export function scopeRequirementDiagnostics");
    expect(source).not.toMatch(/from\s+"node:/u);
    expect(source).not.toMatch(/\bDate\.now\b/u);
    expect(source).not.toMatch(/\bnew Date\b/u);
    expect(source).not.toMatch(/\bMath\.random\b/u);
    expect(source).not.toMatch(/\bprocess\./u);

    expect(deriveCanonicalRequirementReadiness).toHaveLength(3);
    expect(scopeRequirementDiagnostics.length).toBeGreaterThanOrEqual(3);

    const snapshot = snapshotOf(content([ready("FR-B-001")]));
    const first = deriveCanonicalRequirementReadiness(snapshot, TARGET, ["FR-B-001"]);
    const second = deriveCanonicalRequirementReadiness(snapshot, TARGET, ["FR-B-001"]);
    expect(second).toEqual(first);
    expect(snapshot).toEqual(snapshotOf(content([ready("FR-B-001")])));
  });

  it("AC-2: computes the three fields from the raw records, never from a summary field", async () => {
    const source = await readFile(READINESS_SOURCE, "utf8");
    expect(source).toContain("hardDependenciesSatisfied");

    // Every top-level function that reads a summary field, by name. The summary must be consulted
    // by exactly one — the fail-closed contradiction check AC-3 requires — because a function that
    // is never handed a summary field cannot have computed a readiness field from one.
    const blocks = topLevelFunctions(source);
    expect(blocks.length).toBeGreaterThan(10);
    expect(blocks.map((block) => block.name)).toContain("deriveCanonicalRequirementReadiness");
    const summaryReaders = blocks.filter((block) => /\bsummary\s*\.\s*\w/u.test(block.body)).map((block) => block.name);
    expect(summaryReaders).toEqual(["summaryContradictsRecords"]);

    // Flipping only a record field flips the verdict; the summary is regenerated consistently
    // around it, so nothing in the summary can be what produced the change.
    const withEvidence = snapshotOf(content([ready("FR-B-002")]));
    const withoutEvidence = snapshotOf(content([record({ id: "FR-B-002", verificationEvidence: [] })]));
    expect(deriveCanonicalRequirementReadiness(withEvidence, TARGET, ["FR-B-002"])[0]?.evidenceDrift).toBe(false);
    expect(deriveCanonicalRequirementReadiness(withoutEvidence, TARGET, ["FR-B-002"])[0]?.evidenceDrift).toBe(true);

    const withDependency = snapshotOf(content([
      record({ id: "FR-B-003", verificationEvidence: READY_EVIDENCE, traceLinks: dependsOn("FR-B-004") }),
      record({ id: "FR-B-004", status: "planned", verificationEvidence: [] })
    ]));
    expect(deriveCanonicalRequirementReadiness(withDependency, TARGET, ["FR-B-003"])[0]?.hardDependenciesSatisfied)
      .toBe(false);

    const foreign = snapshotOf(content([record({
      id: "FR-B-005",
      target: OTHER_TARGET,
      verificationEvidence: READY_EVIDENCE
    })]));
    expect(deriveCanonicalRequirementReadiness(foreign, TARGET, ["FR-B-005"])[0]?.ownershipVerified).toBe(false);
  });

  it("AC-3: each fail-closed fixture yields not-ready rather than ready", () => {
    const cycle = snapshotOf(content([
      record({ id: "FR-B-006", status: "planned", verificationEvidence: [], traceLinks: dependsOn("FR-B-007") }),
      record({ id: "FR-B-007", status: "planned", verificationEvidence: [], traceLinks: dependsOn("FR-B-006") })
    ]));
    expect(deriveCanonicalRequirementReadiness(cycle, TARGET, ["FR-B-006", "FR-B-007"])
      .every((entry) => entry.hardDependenciesSatisfied === false)).toBe(true);

    const duplicate = snapshotOf(content([ready("FR-B-008"), record({ id: "FR-B-008", target: OTHER_TARGET })]));
    expect(deriveCanonicalRequirementReadiness(duplicate, TARGET, ["FR-B-008"])[0]?.ownershipVerified).toBe(false);

    const contradicted = snapshotOf(content([ready("FR-B-009")], [], { countsByStatus: { verified: 7 } }));
    expect(deriveCanonicalRequirementReadiness(contradicted, TARGET, ["FR-B-009"])[0]).toMatchObject({
      hardDependenciesSatisfied: false,
      evidenceDrift: true,
      ownershipVerified: false
    });
  });

  it("AC-4: one content, two transports, identical readiness", () => {
    const built = content([
      ready("FR-B-010"),
      record({ id: "FR-B-011", status: "implemented", verificationEvidence: [] })
    ]);
    const viaCli = parseRequirementSnapshot(cliPayload(built));
    const viaMcp = parseRequirementSnapshot(mcpPayload(built));

    expect(viaCli).toEqual(viaMcp);
    const ids = ["FR-B-010", "FR-B-011"];
    const cliResult = deriveCanonicalRequirementReadiness(viaCli, TARGET, ids);
    expect(deriveCanonicalRequirementReadiness(viaMcp, TARGET, ids)).toEqual(cliResult);
    expect(cliResult.map((entry) => entry.evidenceDrift)).toEqual([false, true]);
  });

  it("AC-5: a record asserting its own readiness is reported not-ready when the derivation refutes it", () => {
    const selfAttesting = {
      ...record({ id: "FR-B-012", status: "implemented", verificationEvidence: [] }),
      hardDependenciesSatisfied: true,
      evidenceDrift: false,
      ownershipVerified: true,
      ready: true
    } as unknown as SpecRequirementRecord;

    const snapshot = parseRequirementSnapshot(cliPayload(content([selfAttesting])));
    expect(Object.keys(snapshot.records[0]!).sort()).toEqual([
      "acceptanceCriteria", "id", "stability", "status", "target", "traceLinks", "verificationEvidence"
    ]);
    expect(deriveCanonicalRequirementReadiness(snapshot, TARGET, ["FR-B-012"])[0]?.evidenceDrift).toBe(true);
  });

  it("AC-6: a not-ready result raises requirement-not-ready and refuses the dispatch", () => {
    const notReady = snapshotOf(content([record({ id: "FR-B-013", status: "implemented", verificationEvidence: [] })]));
    expect(REQUIREMENT_NOT_READY_GATE).toBe("requirement-not-ready");

    let raised: unknown;
    try {
      assertRequirementsReady(notReady, TARGET, ["FR-B-013"]);
    } catch (error) {
      raised = error;
    }
    expect(raised).toBeInstanceOf(RequirementNotReadyError);
    expect(raised).toMatchObject({ gate: "requirement-not-ready" });
    expect((raised as RequirementNotReadyError).notReady.map((entry) => entry.id)).toEqual(["FR-B-013"]);
    expect((raised as Error).message).toContain("FR-B-013");

    const satisfied = snapshotOf(content([ready("FR-B-014")]));
    expect(() => assertRequirementsReady(satisfied, TARGET, ["FR-B-014"])).not.toThrow();

    // A requirement id the snapshot does not carry has no derivation at all, so it fails closed
    // instead of being silently dropped from the result.
    expect(() => assertRequirementsReady(satisfied, TARGET, ["FR-B-014", "FR-B-404"]))
      .toThrow(RequirementNotReadyError);
  });
});
