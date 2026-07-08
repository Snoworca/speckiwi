import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

// IR-CLI-036 — release-readiness, coverage, and rtm read commands with verified-gate banner.
//
// Red-phase suite (T-PH004-15): one test case per acceptance criterion (AC-1..AC-5). These cases
// pin the future CLI contract before `src/cli/commands/read.ts` / `src/cli/index.ts` teach the CLI
// `release-readiness`, `coverage`, and `rtm` commands, so the whole suite fails today — commander
// rejects each unknown command (non-zero usage exit, no readiness/coverage/rtm payload printed) —
// until the green task (T-PH004-16) wires the read surface against the existing
// `summarizeReleaseReadiness` / `collectAcCoverageGaps` core module
// (src/core/workflow/release-readiness.ts).
//
// Contract under test (SRS docs/spec/30.cli-interface.srs.md IR-CLI-036):
//
//   SpecKiwi exposes read-only CLI commands that surface the existing core release readiness,
//   acceptance-criteria coverage, and traceability matrix computations for a target, defaulting to
//   the Active Target, and prints a per-requirement verification-evidence gate warning banner
//   whenever it lists requirements eligible for a verified transition.
//
//   - AC-1: `release-readiness` prints the release readiness summary for a target including blocked,
//           implemented-not-verified, missing-evidence, and stability blockers, defaulting to the
//           Active Target when no target is given.
//   - AC-2: `coverage` prints acceptance-criteria coverage gaps for verified requirements in the
//           selected target.
//   - AC-3: `rtm` prints a requirement-to-evidence traceability listing for the selected target.
//   - AC-4: Each command supports --json and emits a machine-readable object derived from the
//           existing core release readiness module.
//   - AC-5: When output lists requirements that are candidates for a verified transition, a warning
//           banner states that the verified transition requires per-requirement verification
//           evidence and is not auto-applied.
//
// Fixture pinning (deterministic — appended to the valid-basic workspace, Active Target v1.0.0):
//   - FR-ARCH-001  → planned/stable (pre-existing fixture requirement).
//   - FR-ARCH-010  → status=blocked, stability=stable          → AC-1 blocked.
//   - FR-ARCH-011  → status=implemented, stability=stable, NO   → AC-1 implementedNotVerified +
//                    verification evidence                         missingEvidence + AC-5 candidate.
//   - FR-ARCH-012  → status=planned, stability=draft            → AC-1 stabilityBlockers.
//   - FR-ARCH-013  → status=verified, stability=stable, evidence  → AC-3 rtm evidence mapping;
//                    VE covers AC-1 only while AC-2 is unchecked   → AC-2 coverage gap.

function io() {
  return { stdout: new PassThrough() as NodeJS.WriteStream, stderr: new PassThrough() as NodeJS.WriteStream };
}

/** Drains the output written to a finished run's stream. */
function drain(stream: NodeJS.WriteStream): string {
  return (stream as unknown as PassThrough).read()?.toString() ?? "";
}

const BLOCKED_ID = "FR-ARCH-010";
const IMPLEMENTED_ID = "FR-ARCH-011";
const DRAFT_ID = "FR-ARCH-012";
const VERIFIED_ID = "FR-ARCH-013";

/** A fully-formed requirement block for the ARCH scope, parameterized by status/stability/evidence. */
function requirementBlock(
  id: string,
  options: { status: string; stability: string; priority?: string; evidence?: string[]; acChecked: [boolean, boolean] }
): string {
  const evidenceRows = (options.evidence ?? []).join("\n");
  return [
    `### ${id} — Fixture ${id}`,
    "",
    "| Field | Value |",
    "| --- | --- |",
    "| Type | functional |",
    "| Target | v1.0.0 |",
    `| Status | ${options.status} |`,
    `| Priority | ${options.priority ?? "medium"} |`,
    "| Tags | fixture |",
    "| Risk | low |",
    `| Stability | ${options.stability} |`,
    "| Verification Method | test |",
    "| GitHub Issue | - |",
    "| Related Docs | - |",
    "",
    "#### Requirement",
    "",
    `Fixture requirement ${id}.`,
    "",
    "#### Rationale",
    "",
    "Fixture rationale.",
    "",
    "#### Acceptance Criteria",
    "",
    `- [${options.acChecked[0] ? "x" : " "}] AC-1: First criterion.`,
    `- [${options.acChecked[1] ? "x" : " "}] AC-2: Second criterion.`,
    "",
    "#### Verification Evidence",
    "",
    "| Evidence ID | Type | Reference | Covers | Notes |",
    "| --- | --- | --- | --- | --- |",
    evidenceRows,
    "",
    "#### Trace Links",
    "",
    "| Type | Reference | Relation | Notes |",
    "| --- | --- | --- | --- |",
    "",
    "#### Research / Analysis",
    "",
    "- -",
    "",
    "#### Implementation Notes",
    "",
    "- -",
    "",
    "#### Change Notes",
    "",
    "| Date | Change | Reason |",
    "| --- | --- | --- |",
    "| 2026-05-08 | Created | Fixture |"
  ].join("\n");
}

/** Appends the readiness fixture requirements to the valid-basic ARCH scope document. */
async function appendReadinessFixture(root: string): Promise<void> {
  const specPath = path.join(root, "docs", "spec", "10.product-architecture.srs.md");
  const text = await readFile(specPath, "utf8");
  const blocks = [
    requirementBlock(BLOCKED_ID, { status: "blocked", stability: "stable", acChecked: [false, false] }),
    requirementBlock(IMPLEMENTED_ID, { status: "implemented", stability: "stable", acChecked: [false, false] }),
    requirementBlock(DRAFT_ID, { status: "planned", stability: "draft", acChecked: [false, false] }),
    requirementBlock(VERIFIED_ID, {
      status: "verified",
      stability: "stable",
      // VE-1 covers AC-1 only; AC-2 is left unchecked and uncovered so a coverage gap exists.
      evidence: ["| VE-1 | test | docs/spec/00.index.md | AC-1 | Local evidence |"],
      acChecked: [true, false]
    })
  ];
  await writeFile(specPath, `${text.trimEnd()}\n\n${blocks.join("\n\n")}\n`, "utf8");
}

/** Walks a parsed JSON document for the first object carrying every named string-array key. */
function findReadinessPayload(parsed: unknown): Record<string, unknown> | undefined {
  const keys = ["blocked", "implementedNotVerified", "missingEvidence", "stabilityBlockers"];
  const seen = new Set<unknown>();
  const stack: unknown[] = [parsed];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node || typeof node !== "object" || seen.has(node)) continue;
    seen.add(node);
    const record = node as Record<string, unknown>;
    if (keys.every((key) => Array.isArray(record[key]))) return record;
    for (const value of Object.values(record)) stack.push(value);
  }
  return undefined;
}

describe("IR-CLI-036 — release-readiness, coverage, and rtm read commands with verified-gate banner", () => {
  // AC-1: `release-readiness` prints the readiness summary (blocked, implemented-not-verified,
  //       missing-evidence, stability blockers), defaulting to the Active Target.
  it("IR-CLI-036 AC-1: release-readiness prints blocked/implemented-not-verified/missing-evidence/stability blockers for the Active Target", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    await appendReadinessFixture(root);

    // No --target given: it must default to the Active Target (v1.0.0) from the index.
    const streams = io();
    const code = await main(["--root", root, "release-readiness"], streams);
    const text = drain(streams.stdout);

    expect(code).toBe(0);
    // The selected (Active) target is surfaced.
    expect(text).toContain("v1.0.0");
    // Each readiness bucket lists its concrete requirement id.
    expect(text).toContain(BLOCKED_ID); // blocked
    expect(text).toContain(IMPLEMENTED_ID); // implemented-not-verified + missing-evidence
    expect(text).toContain(DRAFT_ID); // stability blocker
    expect(text).not.toContain("undefined");
  });

  // AC-2: `coverage` prints acceptance-criteria coverage gaps for verified requirements.
  it("IR-CLI-036 AC-2: coverage prints acceptance-criteria coverage gaps for verified requirements", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    await appendReadinessFixture(root);

    const streams = io();
    const code = await main(["--root", root, "coverage"], streams);
    const text = drain(streams.stdout);

    expect(code).toBe(0);
    // FR-ARCH-013 is verified but its AC-2 is uncovered/unchecked → a coverage gap on AC-2.
    expect(text).toContain(VERIFIED_ID);
    expect(text).toContain("AC-2");
    // A merely planned/implemented requirement is not a verified-coverage gap.
    expect(text).not.toContain(IMPLEMENTED_ID);
    expect(text).not.toContain("undefined");
  });

  // AC-3: `rtm` prints a requirement-to-evidence traceability listing for the selected target.
  it("IR-CLI-036 AC-3: rtm prints a requirement-to-evidence traceability listing", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    await appendReadinessFixture(root);

    const streams = io();
    const code = await main(["--root", root, "rtm"], streams);
    const text = drain(streams.stdout);

    expect(code).toBe(0);
    // The matrix lists requirements and their evidence reference. FR-ARCH-013 carries VE-1 →
    // docs/spec/00.index.md; the listing must surface both the requirement and its evidence anchor.
    expect(text).toContain(VERIFIED_ID);
    expect(text).toContain("docs/spec/00.index.md");
    // A requirement with no evidence (FR-ARCH-011) is still listed in the matrix.
    expect(text).toContain(IMPLEMENTED_ID);
    expect(text).not.toContain("undefined");
  });

  // AC-4: Each command supports --json and emits a machine-readable object derived from the existing
  //       core release readiness module.
  it("IR-CLI-036 AC-4: release-readiness/coverage/rtm support --json emitting machine-readable objects", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    await appendReadinessFixture(root);

    // release-readiness --json: parseable, with the core readiness buckets recoverable.
    const readiness = io();
    expect(await main(["--root", root, "release-readiness", "--json"], readiness)).toBe(0);
    const readinessParsed: unknown = JSON.parse(drain(readiness.stdout));
    const payload = findReadinessPayload(readinessParsed);
    expect(payload, "release-readiness --json must expose core readiness buckets").toBeDefined();
    const view = payload as Record<string, unknown>;
    expect(view.blocked).toContain(BLOCKED_ID);
    expect(view.implementedNotVerified).toContain(IMPLEMENTED_ID);
    expect(view.missingEvidence).toContain(IMPLEMENTED_ID);
    expect(view.stabilityBlockers).toContain(DRAFT_ID);

    // coverage --json: parseable machine-readable object.
    const coverage = io();
    expect(await main(["--root", root, "coverage", "--json"], coverage)).toBe(0);
    const coverageParsed: unknown = JSON.parse(drain(coverage.stdout));
    expect(coverageParsed).not.toBeNull();
    expect(typeof coverageParsed).toBe("object");
    expect(JSON.stringify(coverageParsed)).toContain(VERIFIED_ID);

    // rtm --json: parseable machine-readable object.
    const rtm = io();
    expect(await main(["--root", root, "rtm", "--json"], rtm)).toBe(0);
    const rtmParsed: unknown = JSON.parse(drain(rtm.stdout));
    expect(rtmParsed).not.toBeNull();
    expect(typeof rtmParsed).toBe("object");
    expect(JSON.stringify(rtmParsed)).toContain(VERIFIED_ID);
  });

  // AC-5: When output lists requirements that are candidates for a verified transition, a warning
  //       banner states that the verified transition requires per-requirement verification evidence
  //       and is not auto-applied.
  it("IR-CLI-036 AC-5: a verified-transition candidate triggers a per-requirement evidence-gate banner", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    await appendReadinessFixture(root);

    // FR-ARCH-011 is implemented (not yet verified) → a candidate for a verified transition, so the
    // readiness output must carry the evidence-gate warning banner.
    const streams = io();
    const code = await main(["--root", root, "release-readiness"], streams);
    const out = drain(streams.stdout);
    const err = drain(streams.stderr);
    const combined = `${out}${err}`;

    expect(code).toBe(0);
    // The implemented candidate is listed, which is the trigger condition for the banner.
    expect(combined).toContain(IMPLEMENTED_ID);
    // The banner states that verified requires per-requirement evidence and is not auto-applied.
    expect(combined.toLowerCase()).toContain("verified");
    expect(combined.toLowerCase()).toContain("evidence");
    expect(combined.toLowerCase()).toMatch(/not auto|not automatically|manual|requires/);
  });
});
