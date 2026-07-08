import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import { computeSemanticSha } from "../../../src/core/mutation/records.js";
import type { ProjectRoot, RequirementStatus, Stability } from "../../../src/core/types.js";

// The green task (T-PH003-36) introduces the diffSteps read handler in
// src/core/query/diff-steps.ts. It does not exist yet, so this dynamic loader
// throws "Cannot find module" — failing each AC test individually (rather than
// only at suite collection) so every acceptance criterion is exercised against a
// valid on-disk fixture and stays red until the green task implements diffSteps.
interface StepDiffEntry {
  id: string;
  classification: "NEW" | "UPDATE" | "CONFLICT-PARTIAL" | "CONFLICT-FULL-GUARDED";
  stepSha?: string;
  bodySha?: string;
}

interface DiffStepsResult {
  entries: StepDiffEntry[];
}

interface DiffStepsOptions {
  stepName?: string;
}

async function diffSteps(root: ProjectRoot, options?: DiffStepsOptions): Promise<DiffStepsResult> {
  const mod = (await import("../../../src/core/query/diff-steps.js")) as {
    diffSteps: (root: ProjectRoot, options?: DiffStepsOptions) => Promise<DiffStepsResult>;
  };
  return mod.diffSteps(root, options);
}

// FR-NODE-049 — diff_steps four-way classification keyed on semanticSha.
//
// Red-phase suite (T-PH003-35): one test case per acceptance criterion
// (AC-1..AC-4). These cases describe the future contract of diffSteps before
// src/core/query/diff-steps.ts exports it, so the whole suite fails (missing
// module/export) until the green task (T-PH003-36) implements it.
//
// Contract under test (from the requirement body, AC, and the A1/A3
// incremental-contradiction-cache design doc §2.2):
//
//   diffSteps(root: ProjectRoot, options?: { stepName?: string }):
//     Promise<{ entries: StepDiffEntry[] }>
//
//   where each StepDiffEntry classifies one step requirement against its body
//   counterpart using computeSemanticSha as the equality key:
//
//     interface StepDiffEntry {
//       id: string;                       // bare REQ-ID
//       classification: "NEW" | "UPDATE" | "CONFLICT-PARTIAL" | "CONFLICT-FULL-GUARDED";
//       stepSha?: string;                 // computeSemanticSha of the step record
//       bodySha?: string;                 // computeSemanticSha of the body record (absent for NEW)
//     }
//
//   Classification (design §2.2 "4분류", key=computeSemanticSha):
//     - NEW: the id exists only in a step (no body counterpart). step-only id.
//     - UPDATE: the id exists in the body and the step's content differs
//       (computeSemanticSha(step) !== computeSemanticSha(body)) and the body
//       endpoint is NOT protected → a non-conflicting in-place body update.
//     - CONFLICT-PARTIAL: a conflicting change against an UNPROTECTED body endpoint.
//     - CONFLICT-FULL-GUARDED: a conflicting change against a PROTECTED body
//       endpoint (the updateStatus EXIT guard surface: verified / frozen / stable /
//       implemented-with-evidence). The merge is fully guarded behind the verified
//       back-transition guard.
//
//   When the step and body records hash equal (computeSemanticSha equal), the id
//   is unchanged and MUST NOT be reported as a difference (AC-1).
//
//   AC-4: for draft/evolving same-rank peers, the LATER step wins — when two
//   steps both touch the same id, the later step's content is the one diffed
//   against the body.

const SCOPE_DOC = "50.nodejs-implementation.srs.md";

type RequirementType = "functional";

interface BlockSpec {
  id: string;
  status?: RequirementStatus;
  stability?: Stability;
  /** Requirement statement — drives computeSemanticSha. */
  requirement?: string;
  /** Single acceptance-criterion text — also drives computeSemanticSha. */
  ac?: string;
  /** Verification Evidence rows (presence makes an implemented body protected). */
  evidence?: Array<{ id: string; type: string; reference: string }>;
}

/** Renders a single NODE-scope requirement block in the canonical SRS layout. */
function renderRequirementBlock(spec: BlockSpec): string {
  const status: RequirementStatus = spec.status ?? "planned";
  const stability: Stability = spec.stability ?? "evolving";
  const requirement = spec.requirement ?? `Requirement statement for ${spec.id}.`;
  const ac = spec.ac ?? "Generated criterion.";
  const type: RequirementType = "functional";
  const evidenceRows = (spec.evidence ?? []).map(
    (row) => `| ${row.id} | ${row.type} | ${row.reference} | all | - |`
  );
  return [
    `### ${spec.id} — Requirement ${spec.id}`,
    "",
    "| Field | Value |",
    "| --- | --- |",
    `| Type | ${type} |`,
    "| Target | v3.0.0 |",
    `| Status | ${status} |`,
    "| Priority | high |",
    "| Tags | fixture |",
    "| Risk | low |",
    `| Stability | ${stability} |`,
    "| Verification Method | test |",
    "| GitHub Issue | - |",
    "| Related Docs | - |",
    "",
    "#### Requirement",
    "",
    requirement,
    "",
    "#### Rationale",
    "",
    "-",
    "",
    "#### Acceptance Criteria",
    "",
    `- [ ] AC-1: ${ac}`,
    "",
    "#### Verification Evidence",
    "",
    "| Evidence ID | Type | Reference | Covers | Notes |",
    "| --- | --- | --- | --- | --- |",
    ...evidenceRows,
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
    "| 2026-06-04 | Created | Fixture |"
  ].join("\n");
}

function renderScopeDocument(blocks: string[], scopeName: string, overview: string): string {
  return [
    `# ${scopeName}`,
    "",
    "| Field | Value |",
    "|---|---|",
    "| Document Type | scope_srs |",
    "| Scope | NODE |",
    "| Scope Name | Node.js Implementation |",
    "",
    "## 1. Scope Overview",
    "",
    overview,
    "",
    "## 2. Scope Boundaries",
    "",
    "### In Scope",
    "",
    "- Markdown requirements",
    "",
    "### Out of Scope",
    "",
    "- None",
    "",
    "## 3. Assumptions and Constraints",
    "",
    "- None",
    "",
    "## 4. Requirements",
    "",
    blocks.join("\n\n"),
    ""
  ].join("\n");
}

function renderIndexDocument(): string {
  return [
    "# SpecKiwi diff_steps Fixture Index",
    "",
    "| Field | Value |",
    "|---|---|",
    "| Document Type | srs_index |",
    "| Product | SpecKiwi |",
    "| Product Version | 3.0.0 |",
    "| Active Target | v3.0.0 |",
    "| Status | baseline |",
    "",
    "## 1. Purpose",
    "",
    "diff_steps fixture index.",
    "",
    "## 2. SRS Documents",
    "",
    "| Scope | Document | Prefix | Description |",
    "|---|---|---|---|",
    `| Node.js Implementation | [${SCOPE_DOC}](./${SCOPE_DOC}) | NODE | Node |`,
    "",
    "## 3. Target Map",
    "",
    "| Target | Type | Status | Description |",
    "|---|---|---|---|",
    "| v3.0.0 | release | active | Fixture release |",
    "",
    "## 4. Scope Map",
    "",
    "| Scope | Document | Prefix | Description |",
    "|---|---|---|---|",
    `| Node.js Implementation | [${SCOPE_DOC}](./${SCOPE_DOC}) | NODE | Node |`,
    "",
    "## 5. Completed Work Log",
    "",
    "| Date | Target | Scope | Requirement IDs | Summary |",
    "|---|---|---|---|---|",
    ""
  ].join("\n");
}

interface StepFileSpec {
  /** Step directory segment under docs/spec/steps/<stepName>/. */
  stepName: string;
  blocks: BlockSpec[];
}

/**
 * Writes a self-contained NODE-scope workspace under a fresh temp directory.
 * `bodyBlocks` become the body scope file (docs/spec/50.*.srs.md); each entry in
 * `steps` becomes a step scope file under docs/spec/steps/<stepName>/ so the
 * parser flattens it into workspace.stepRecords (origin=step).
 */
async function buildWorkspace(bodyBlocks: BlockSpec[], steps: StepFileSpec[] = []) {
  const root = await mkdtemp(path.join(tmpdir(), "speckiwi-fr-node-034-"));
  const specDir = path.join(root, "docs", "spec");
  await mkdir(specDir, { recursive: true });
  await writeFile(path.join(specDir, "00.index.md"), renderIndexDocument(), "utf8");
  await writeFile(
    path.join(specDir, SCOPE_DOC),
    renderScopeDocument(
      bodyBlocks.map(renderRequirementBlock),
      "Node.js Implementation",
      "diff_steps body fixture."
    ),
    "utf8"
  );
  for (const step of steps) {
    const stepDir = path.join(specDir, "steps", step.stepName);
    await mkdir(stepDir, { recursive: true });
    await writeFile(
      path.join(stepDir, SCOPE_DOC),
      renderScopeDocument(
        step.blocks.map(renderRequirementBlock),
        "Node.js Implementation",
        `diff_steps step fixture for ${step.stepName}.`
      ),
      "utf8"
    );
  }
  return resolveProjectRoot(root);
}

type RootHandle = Awaited<ReturnType<typeof resolveProjectRoot>>;

/** Returns the single step record matching `id`, failing if absent/ambiguous. */
async function stepSha(root: RootHandle, id: string): Promise<string> {
  const workspace = await parseWorkspace(root);
  const matches = (workspace.stepRecords ?? []).filter((record) => record.id === id);
  expect(matches).toHaveLength(1);
  return computeSemanticSha(matches[0] as (typeof matches)[number]);
}

/** Returns the single body record matching `id`, failing if absent/ambiguous. */
async function bodySha(root: RootHandle, id: string): Promise<string> {
  const workspace = await parseWorkspace(root);
  const matches = workspace.records.filter((record) => record.id === id);
  expect(matches).toHaveLength(1);
  return computeSemanticSha(matches[0] as (typeof matches)[number]);
}

/** Returns the single diff entry for `id`, failing if absent/ambiguous. */
function entryFor(
  entries: ReadonlyArray<{ id: string; classification: string }>,
  id: string
) {
  const matches = entries.filter((entry) => entry.id === id);
  expect(matches).toHaveLength(1);
  return matches[0] as (typeof matches)[number];
}

describe("FR-NODE-049 diff_steps four-way classification keyed on semanticSha", () => {
  // AC-1: diff_steps uses computeSemanticSha as the equality key. A step record
  // whose content is byte-for-byte different in formatting but normalizes to the
  // SAME semanticSha as the body record is NOT a difference and MUST NOT appear
  // as a changed entry; a step record whose semanticSha actually differs DOES.
  it("FR-NODE-049 AC-1: uses computeSemanticSha as the equality key when comparing step and body", async () => {
    const EQUAL_ID = "FR-NODE-100";
    const CHANGED_ID = "FR-NODE-101";

    // EQUAL_ID: identical requirement text but with extra surrounding whitespace
    // in the step copy. normalize() collapses whitespace, so both sides produce
    // the same semanticSha — an equality-key comparison treats them as unchanged.
    // CHANGED_ID: the step copy has materially different requirement text, so the
    // semanticSha differs.
    const root = await buildWorkspace(
      [
        { id: EQUAL_ID, requirement: "Shared statement for the equal id." },
        { id: CHANGED_ID, requirement: "Original body statement." }
      ],
      [
        {
          stepName: "s1",
          blocks: [
            { id: EQUAL_ID, requirement: "Shared    statement   for the equal id." },
            { id: CHANGED_ID, requirement: "Rewritten step statement that differs." }
          ]
        }
      ]
    );

    // Sanity: confirm the equality key really is equal for EQUAL_ID and differs
    // for CHANGED_ID, so the assertions below test the classifier, not the fixture.
    expect(await stepSha(root, EQUAL_ID)).toBe(await bodySha(root, EQUAL_ID));
    expect(await stepSha(root, CHANGED_ID)).not.toBe(await bodySha(root, CHANGED_ID));

    const result = await diffSteps(root);

    // The semanticSha-equal id is unchanged: it must NOT be reported as a diff.
    expect(result.entries.some((entry) => entry.id === EQUAL_ID)).toBe(false);
    // The semanticSha-different id IS reported (a non-NEW change, since a body
    // counterpart exists).
    const changed = entryFor(result.entries, CHANGED_ID);
    expect(changed.classification).not.toBe("NEW");
  });

  // AC-2: a step-only id (no body counterpart) is NEW; an id whose body exists
  // but whose step content differs is UPDATE (non-conflicting body update).
  it("FR-NODE-049 AC-2: classifies a step-only id as NEW and a changed-body id as UPDATE", async () => {
    const NEW_ID = "FR-NODE-110"; // exists only in the step
    const UPDATE_ID = "FR-NODE-111"; // body exists, step changes it

    const root = await buildWorkspace(
      [{ id: UPDATE_ID, requirement: "Body statement to be updated.", status: "planned" }],
      [
        {
          stepName: "s1",
          blocks: [
            { id: NEW_ID, requirement: "Brand-new step-only requirement." },
            { id: UPDATE_ID, requirement: "Updated step statement." }
          ]
        }
      ]
    );

    const result = await diffSteps(root);

    expect(entryFor(result.entries, NEW_ID).classification).toBe("NEW");
    expect(entryFor(result.entries, UPDATE_ID).classification).toBe("UPDATE");
  });

  // AC-3: a conflicting change is classified CONFLICT-PARTIAL when the body
  // endpoint is unprotected, and CONFLICT-FULL-GUARDED when the body endpoint is
  // protected (verified/frozen/stable — the updateStatus EXIT guard surface).
  it("FR-NODE-049 AC-3: classifies conflicting changes as CONFLICT-PARTIAL or CONFLICT-FULL-GUARDED", async () => {
    const PARTIAL_ID = "FR-NODE-120"; // unprotected body conflict
    const GUARDED_ID = "FR-NODE-121"; // verified/frozen body conflict

    const root = await buildWorkspace(
      [
        // Unprotected: implemented but no verification evidence → not guarded.
        { id: PARTIAL_ID, requirement: "Unprotected body.", status: "implemented", stability: "evolving" },
        // Protected: verified + frozen → the body endpoint is fully guarded.
        { id: GUARDED_ID, requirement: "Protected body.", status: "verified", stability: "frozen" }
      ],
      [
        {
          stepName: "s1",
          blocks: [
            // Both step copies conflict with the body: they discard/replace the
            // body content (a contradicting rewrite), not a clean additive update.
            { id: PARTIAL_ID, requirement: "Contradicting rewrite of the unprotected body.", status: "discarded" },
            { id: GUARDED_ID, requirement: "Contradicting rewrite of the protected body.", status: "discarded" }
          ]
        }
      ]
    );

    const result = await diffSteps(root);

    expect(entryFor(result.entries, PARTIAL_ID).classification).toBe("CONFLICT-PARTIAL");
    expect(entryFor(result.entries, GUARDED_ID).classification).toBe("CONFLICT-FULL-GUARDED");
  });

  // AC-4: for draft/evolving same-rank peers, the later step takes precedence.
  // Two steps (s1 earlier, s2 later) both touch the same id with different
  // content; the diff against the body reflects the LATER step (s2), so the
  // entry's stepSha equals s2's semanticSha, not s1's.
  it("FR-NODE-049 AC-4: lets the later step win for draft/evolving same-rank peers", async () => {
    const PEER_ID = "FR-NODE-130";

    const root = await buildWorkspace(
      [{ id: PEER_ID, requirement: "Body statement.", stability: "evolving" }],
      [
        {
          stepName: "s1-earlier",
          blocks: [{ id: PEER_ID, requirement: "Earlier step statement.", stability: "evolving" }]
        },
        {
          stepName: "s2-later",
          blocks: [{ id: PEER_ID, requirement: "Later step statement wins.", stability: "evolving" }]
        }
      ]
    );

    // Resolve each step copy's semanticSha directly from its origin step file so
    // the assertion pins to the LATER step rather than the earlier one.
    const workspace = await parseWorkspace(root);
    const stepCopies = (workspace.stepRecords ?? []).filter((record) => record.id === PEER_ID);
    expect(stepCopies).toHaveLength(2);
    const laterCopy = stepCopies.find((record) => record.stepName === "s2-later");
    const earlierCopy = stepCopies.find((record) => record.stepName === "s1-earlier");
    expect(laterCopy).toBeDefined();
    expect(earlierCopy).toBeDefined();
    const laterSha = computeSemanticSha(laterCopy as NonNullable<typeof laterCopy>);
    const earlierSha = computeSemanticSha(earlierCopy as NonNullable<typeof earlierCopy>);
    expect(laterSha).not.toBe(earlierSha);

    const result = await diffSteps(root);
    const entry = entryFor(result.entries, PEER_ID);

    // The later step wins: the reported step-side sha is the later step's sha.
    expect(entry.stepSha).toBe(laterSha);
    expect(entry.stepSha).not.toBe(earlierSha);
  });
});
