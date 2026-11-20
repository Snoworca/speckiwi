import { fail, ok, type Result } from "../result.js";
import { knownRequirements, loadSdsFile, readWorkspaceText } from "../sds/check-sds.js";
import type { LiteSdsDocument } from "../sds/lite-sds.js";
import type { ParsedWorkspace, RequirementRecord } from "../types.js";
import { resolveTargetSelection } from "../query/summary.js";
import { namesNonTestCriterion } from "../workflow/release-readiness.js";
import { DEFAULT_TEST_FILE_GLOBS, findTestFiles, indexTestCitations, type IgnoreRulesReason, type TestCitation } from "./test-citations.js";

// @req FR-NODE-210 AC-2 AC-4 AC-5 @req FR-MCP-066
//
// The tool-derived per-AC citation map the test-sufficiency check (FR-FLOW-186) reads. A criterion is
// covered when some test file has one line that cites both its requirement id and `AC-<n>`; an SDS
// contract is covered when the test file its Test Plan row names exists and cites `SDS-AC-<n>`.
// Citation is not verification: this answers "does a test name it", never "does the test prove it".

export interface TestSufficiencyScope {
  /** Every non-discarded requirement of this target. Defaults to the Active Target when `ids` is absent. */
  readonly target?: string;
  /** Exactly these requirements, body or not yet promoted step requirements. Contradicts `target`. */
  readonly ids?: readonly string[];
  /** A lite SDS whose contracts are checked against their Test Plan files. */
  readonly sds?: string;
  /** Replaces {@link DEFAULT_TEST_FILE_GLOBS}. */
  readonly testGlobs?: readonly string[];
}

export interface CriterionCoverage {
  readonly acId: string;
  readonly cited: boolean;
  readonly citations: TestCitation[];
  /** @req FR-PARSE-051 AC-3 — present only on a criterion marked non-test. */
  readonly nonTest?: true;
}

/** @req FR-PARSE-051 AC-3 — a marked criterion: judged by the non-test rows that name it, never a gap. */
export interface NonTestCriterion {
  readonly requirementId: string;
  readonly acId: string;
  /** Ids of the evidence rows that name it (Type not `test`, Covers lists the id; `all` does not). */
  readonly evidence: string[];
  readonly evidenced: boolean;
}

export interface RequirementCoverage {
  readonly requirementId: string;
  readonly acs: CriterionCoverage[];
}

export interface ContractCoverage {
  readonly sdsAcId: string;
  readonly requirementId: string | null;
  readonly acId: string | null;
  readonly cited: boolean;
  readonly testFiles: Array<{ path: string; exists: boolean; citations: TestCitation[] }>;
}

/** @req FR-PARSE-044 AC-3 — test lines naming an expired criterion: history to clean up, never coverage. */
export interface ExpiredCitation {
  readonly requirementId: string;
  readonly acId: string;
  readonly citations: TestCitation[];
}

export interface TestSufficiencyReport {
  readonly scope: { target: string | null; ids: string[] | null; sds: string | null; testGlobs: string[] };
  readonly testFileCount: number;
  /** @req FR-NODE-292 AC-3 — test files the repository's git ignore rules left out. */
  readonly ignoredTestFileCount: number;
  /** `git` when the ignore rules were applied; `none` when git could not answer and every candidate counts. */
  readonly ignoreRules: "git" | "none";
  /** @req FR-NODE-306 AC-1 — why git did not answer; `null` when the rules were applied. */
  readonly ignoreRulesReason: IgnoreRulesReason | null;
  readonly requirements: RequirementCoverage[];
  readonly sdsContracts: ContractCoverage[];
  /** Listed apart from `requirements` and never a gap or a pass. */
  readonly expiredCitations: ExpiredCitation[];
  /** Present only when a criterion in scope is marked non-test, so an unmarked scope answers as before. */
  readonly nonTest?: NonTestCriterion[];
  readonly gaps: {
    requirements: Array<{ requirementId: string; acIds: string[] }>;
    sdsContracts: Array<{ sdsAcId: string; reason: string }>;
  };
  /** True when no gap exists. */
  readonly passed: boolean;
}

function byId(a: RequirementRecord, b: RequirementRecord): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function scopeRequirements(workspace: ParsedWorkspace, scope: TestSufficiencyScope): Result<{ target: string | null; ids: string[] | null; records: RequirementRecord[] }> {
  if (scope.ids !== undefined) {
    const ids = [...new Set(scope.ids.map((id) => id.trim()).filter((id) => id !== ""))];
    if (ids.length === 0) return fail("USAGE", "The requirement id list names no requirement");
    // @req FR-NODE-210 AC-6 — a step requirement is checked before its promotion, while it still lives
    // under docs/spec/steps; a body requirement of the same id is the one read.
    const records = knownRequirements(workspace).filter((record) => ids.includes(record.id));
    const missing = ids.filter((id) => !records.some((record) => record.id === id));
    if (missing.length > 0) return fail("NOT_FOUND", `Requirement not found: ${missing.join(", ")}`);
    return ok({ target: null, ids, records: [...records].sort(byId) });
  }
  const { target } = resolveTargetSelection(workspace, scope.target !== undefined ? { target: scope.target } : {});
  if (target === "") return fail("USAGE", "No target given and no Active Target is set; name a target or requirement ids");
  if (!workspace.index.targets.some((entry) => entry.target === target)) return fail("TARGET_NOT_FOUND", `Target is not registered: ${target}`);
  const records = workspace.records.filter((record) => record.target === target && record.status !== "discarded");
  return ok({ target, ids: null, records: [...records].sort(byId) });
}

/** Reads at once: this repository's coverage --tests took 2,367 ms reading one at a time, 1,639 ms with 16. */
const READS_IN_FLIGHT = 16;

/**
 * @req FR-NODE-304 AC-1 AC-2 AC-4 — the text of each file, read with at most 16 in flight. A failed read
 * stops the others from taking more files and is thrown once those in flight have finished, the failure
 * of the earliest file in order winning, so the call fails as reading one by one does, naming the same
 * file, and leaves no read running behind its answer.
 */
async function readTexts(rootPath: string, files: readonly string[]): Promise<Map<string, string | null>> {
  const texts = new Map<string, string | null>();
  const state: { next: number; failure?: { index: number; error: unknown } } = { next: 0 };
  // The earliest file in order wins, whichever read failed first.
  const record = (index: number, error: unknown): void => {
    if (state.failure === undefined || index < state.failure.index) state.failure = { index, error };
  };
  const worker = async (): Promise<void> => {
    while (state.failure === undefined && state.next < files.length) {
      const index = state.next++;
      const file = files[index] as string;
      try {
        texts.set(file, await readWorkspaceText(rootPath, file));
      } catch (error) {
        record(index, error);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(READS_IN_FLIGHT, files.length) }, worker));
  if (state.failure !== undefined) throw state.failure.error;
  return texts;
}

// @req FR-NODE-210 AC-2 AC-4 AC-5 — `coverage --tests` and `check_test_sufficiency` both answer from here.
export async function checkTestSufficiency(workspace: ParsedWorkspace, scope: TestSufficiencyScope): Promise<Result<TestSufficiencyReport>> {
  if (scope.target !== undefined && scope.ids !== undefined) return fail("USAGE", "Name either a target or requirement ids, not both");
  const rootPath = workspace.root.root;
  const resolved = scopeRequirements(workspace, scope);
  if (!resolved.ok) return resolved;

  let contracts: LiteSdsDocument | null = null;
  if (scope.sds !== undefined) {
    const loaded = await loadSdsFile(rootPath, scope.sds);
    if (!loaded.ok) return loaded;
    // @req FR-NODE-210 AC-6 — the contracts and the Test Plan table are read the same way in both
    // profiles, so a full-profile step design.md is checked as well as a lite SDS.
    contracts = loaded.value.document;
  }

  const globs = scope.testGlobs !== undefined && scope.testGlobs.length > 0 ? [...scope.testGlobs] : [...DEFAULT_TEST_FILE_GLOBS];
  const search = await findTestFiles(rootPath, globs);
  const testFiles = search.files;
  const planned = contracts === null ? [] : [...new Set(contracts.testPlan.flatMap((row) => row.testFiles))];
  const texts = await readTexts(rootPath, [...new Set([...testFiles, ...planned])]);
  const scanned = testFiles.flatMap((file) => {
    const text = texts.get(file);
    return typeof text === "string" ? [{ path: file, text }] : [];
  });
  const index = indexTestCitations(scanned);
  const plannedIndex = indexTestCitations(
    planned.flatMap((file) => {
      const text = texts.get(file);
      return typeof text === "string" ? [{ path: file, text }] : [];
    })
  );

  const requirements: RequirementCoverage[] = resolved.value.records.map((record) => ({
    requirementId: record.id,
    acs: record.acceptanceCriteria.map((criterion) => {
      const citations = index.acCitations(record.id, criterion.id);
      return { acId: criterion.id, cited: citations.length > 0, citations, ...(criterion.nonTest === true ? { nonTest: true as const } : {}) };
    })
  }));

  const nonTest: NonTestCriterion[] = resolved.value.records.flatMap((record) =>
    record.acceptanceCriteria
      .filter((criterion) => criterion.nonTest === true)
      .map((criterion) => {
        const evidence = record.verificationEvidence.filter((row) => namesNonTestCriterion(row, criterion.id)).map((row) => row.id);
        return { requirementId: record.id, acId: criterion.id, evidence, evidenced: evidence.length > 0 };
      })
  );

  const expiredCitations: ExpiredCitation[] = resolved.value.records.flatMap((record) =>
    (record.expiredAcceptanceCriteria ?? []).flatMap((criterion) => {
      const citations = index.acCitations(record.id, criterion.id);
      return citations.length > 0 ? [{ requirementId: record.id, acId: criterion.id, citations }] : [];
    })
  );

  const sdsContracts: ContractCoverage[] = (contracts?.contracts ?? []).map((contract) => {
    const files = [...new Set(contracts?.testPlan.filter((row) => row.sdsAcId === contract.id).flatMap((row) => row.testFiles) ?? [])];
    const testFileCoverage = files.map((file) => {
      const exists = typeof texts.get(file) === "string";
      return { path: file, exists, citations: exists ? plannedIndex.sdsCitations(file, contract.id) : [] };
    });
    return {
      sdsAcId: contract.id,
      requirementId: contract.requirementId,
      acId: contract.acId,
      cited: testFileCoverage.some((file) => file.citations.length > 0),
      testFiles: testFileCoverage
    };
  });

  const requirementGaps = requirements
    .map((item) => ({ requirementId: item.requirementId, acIds: item.acs.filter((ac) => !ac.cited && ac.nonTest !== true).map((ac) => ac.acId) }))
    .filter((gap) => gap.acIds.length > 0);
  const contractGaps = sdsContracts
    .filter((item) => !item.cited)
    .map((item) => ({
      sdsAcId: item.sdsAcId,
      reason:
        item.testFiles.length === 0
          ? "no Test Plan row names a test file"
          : item.testFiles.every((file) => !file.exists)
            ? `planned test file missing: ${item.testFiles.map((file) => file.path).join(", ")}`
            : `planned test file does not cite ${item.sdsAcId}: ${item.testFiles.filter((file) => file.exists).map((file) => file.path).join(", ")}`
    }));

  return ok({
    scope: { target: resolved.value.target, ids: resolved.value.ids, sds: contracts?.path ?? null, testGlobs: globs },
    testFileCount: testFiles.length,
    ignoredTestFileCount: search.ignoredCount,
    ignoreRules: search.ignoreRules,
    ignoreRulesReason: search.ignoreRulesReason,
    requirements,
    sdsContracts,
    expiredCitations,
    ...(nonTest.length > 0 ? { nonTest } : {}),
    gaps: { requirements: requirementGaps, sdsContracts: contractGaps },
    passed: requirementGaps.length === 0 && contractGaps.length === 0
  });
}
