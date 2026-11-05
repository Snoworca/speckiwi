import type { Command } from "commander";
import { resolveProjectRoot } from "../../core/project-root.js";
import { workspaceReviewRoundSources } from "../../core/review/git-sources.js";
import { checkReviewRound, type ReviewRoundReport } from "../../core/review/review-round.js";
import type { CliContext } from "../command.js";
import { writeJson } from "../formatters.js";
import { failRead } from "./sds.js";

// @req FR-NODE-274 — `speckiwi review-round check --run-id <id> [--json]`: the verdict of a
// kiwi-review-fix-loop run's latest round, from the same core as MCP `check_review_round` (AC-8). An
// invalid state is refused with a non-zero exit (AC-5); a verdict, whichever it is, exits 0.

function formatReport(report: ReviewRoundReport): string {
  const { counts, scope } = report;
  return [
    `Round ${report.round} of ${report.statePath}: ${report.verdict}${report.reasons.length > 0 ? ` (${report.reasons.join(", ")})` : ""}`,
    `Blocking ${counts.block} (introduced by an earlier round ${counts.blockIntroducedEarlier}), record ${counts.record}, residual ${counts.residual}`,
    `Tokens ${counts.tokensUsed} of ${counts.tokenBudget ?? "no budget"}, round cap ${counts.roundCap}`,
    ...(scope.missingFiles.length > 0 ? [`Missing from the round's files: ${scope.missingFiles.join(", ")}`] : []),
    ...(scope.widenReasonMissing ? ["Full scope without a widen reason"] : [])
  ].join("\n");
}

export function registerReviewRoundCommands(command: Command, context: CliContext): void {
  const reviewRound = command.command("review-round").description("kiwi-review-fix-loop round records under .kiwi/sessions");
  reviewRound
    .command("check")
    .description("check the latest round of a review run: its scope, the earlier-round-fix majority and the verdict")
    .requiredOption("--run-id <id>", "the run whose .kiwi/sessions/<id>/state.json is read")
    .option("--json", "JSON output")
    .action(async (options: { runId: string; json?: boolean }) => {
      const json = Boolean(options.json) || Boolean(command.opts().json);
      const root = await resolveProjectRoot(process.cwd(), command.opts().root);
      const result = await checkReviewRound(options.runId, workspaceReviewRoundSources(root.root));
      if (!result.ok) {
        failRead(command, context, json, result.error);
        return;
      }
      if (json) writeJson(context.io, result.value);
      else context.io.stdout.write(`${formatReport(result.value)}\n`);
    });
}
