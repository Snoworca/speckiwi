import type { Command } from "commander";
import { checkTestSufficiency, type TestSufficiencyReport, type TestSufficiencyScope } from "../../core/testing/test-sufficiency.js";
import type { ParsedWorkspace } from "../../core/types.js";
import type { CliContext } from "../command.js";
import { writeJson } from "../formatters.js";
import { failRead } from "./sds.js";

// @req FR-NODE-210 AC-2 AC-4 AC-5 — `speckiwi coverage --tests`: which test lines cite each acceptance
// criterion of a requirement scope, and whether each SDS contract's planned test file cites it.

export interface CoverageTestsOptions {
  readonly target?: string;
  readonly ids?: string;
  readonly sds?: string;
  readonly testGlob?: readonly string[];
  readonly failOnGap?: boolean;
}

/** The options that only mean something beside `--tests`, as the flag a user typed. */
export function testsOnlyFlagsGiven(options: CoverageTestsOptions): string[] {
  return [
    ...(options.ids !== undefined ? ["--ids"] : []),
    ...(options.sds !== undefined ? ["--sds"] : []),
    ...((options.testGlob ?? []).length > 0 ? ["--test-glob"] : []),
    ...(options.failOnGap === true ? ["--fail-on-gap"] : [])
  ];
}

function scopeOf(options: CoverageTestsOptions): TestSufficiencyScope {
  return {
    ...(options.target !== undefined ? { target: options.target } : {}),
    ...(options.ids !== undefined ? { ids: options.ids.split(",") } : {}),
    ...(options.sds !== undefined ? { sds: options.sds } : {}),
    ...((options.testGlob ?? []).length > 0 ? { testGlobs: options.testGlob } : {})
  };
}

function formatReport(report: TestSufficiencyReport): string {
  const criteria = report.requirements.flatMap((item) => item.acs);
  const subject = report.scope.ids !== null ? `ids ${report.scope.ids.join(", ")}` : `target ${report.scope.target ?? "-"}`;
  const lines = [
    `Test sufficiency (${subject}, ${report.testFileCount} test files): ${criteria.filter((ac) => ac.cited).length} of ${criteria.length} acceptance criteria cited` +
      (report.scope.sds !== null ? `; ${report.sdsContracts.filter((ac) => ac.cited).length} of ${report.sdsContracts.length} contracts of ${report.scope.sds} cited` : "")
  ];
  for (const gap of report.gaps.requirements) for (const acId of gap.acIds) lines.push(`gap ${gap.requirementId} ${acId}`);
  for (const gap of report.gaps.sdsContracts) lines.push(`gap ${gap.sdsAcId} ${gap.reason}`);
  return lines.join("\n");
}

export async function runCoverageTests(
  command: Command,
  context: CliContext,
  workspace: ParsedWorkspace,
  options: CoverageTestsOptions,
  json: boolean
): Promise<void> {
  const result = await checkTestSufficiency(workspace, scopeOf(options));
  if (!result.ok) {
    failRead(command, context, json, result.error);
    return;
  }
  if (json) writeJson(context.io, result.value);
  else context.io.stdout.write(`${formatReport(result.value)}\n`);
  if (options.failOnGap === true && !result.value.passed) command.setOptionValue("exitCode", 1);
}
