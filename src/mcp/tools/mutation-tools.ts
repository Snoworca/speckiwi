import { resolveProjectRoot } from "../../core/project-root.js";
import { updateStatus } from "../../core/mutation/update-status.js";
import { updateStability } from "../../core/mutation/update-stability.js";
import { appendSectionNote } from "../../core/mutation/append-section-note.js";
import { appendAcceptanceCriterion, editAcceptanceCriteria, setAcceptanceCriteriaChecked } from "../../core/mutation/check-ac.js";
import { addRelatedDoc } from "../../core/mutation/add-related-doc.js";
import { addChangeNote } from "../../core/mutation/add-change-note.js";
import { addVerificationEvidence } from "../../core/mutation/add-evidence.js";
import { addTraceLink } from "../../core/mutation/add-trace.js";
import { addRequirement, promoteStepRequirement } from "../../core/mutation/add-requirement.js";
import { addCompatibilityCheck, refreshCompatibilityCheck, revokeCompatibilityCheck } from "../../core/mutation/add-compatibility-check.js";
import { claimStep } from "../../core/mutation/claim-step.js";
import { updateStepState } from "../../core/mutation/update-step-state.js";
import { synthesizeStepSrs } from "../../core/mutation/synthesis.js";
import { scaffoldStep } from "../../core/mutation/scaffold-step.js";
import { setSdsStatus } from "../../core/mutation/set-sds-status.js";
import { setWorkMode } from "../../core/mutation/work-mode.js";
import { mutationFail } from "../../core/mutation/guards.js";
import type { RequirementType, StepStateMode } from "../../core/types.js";
import { supersedeRequirement } from "../../core/mutation/supersede-requirement.js";
import { setActiveTarget, setTargetDescription } from "../../core/mutation/set-active-target.js";
import { setTargetGoal } from "../../core/mutation/set-target-goal.js";
import { addCompletedWork } from "../../core/mutation/add-completed-work.js";
import { syncIndexRollups } from "../../core/mutation/sync-index.js";
import { scaffoldScope } from "../../core/mutation/scaffold-scope.js";
import { registerScopes } from "../../core/mutation/register-scopes.js";
import { renameScope } from "../../core/mutation/rename-scope.js";
import { retargetSelection } from "../../core/mutation/retarget.js";
import { expireAcceptanceCriterion } from "../../core/mutation/expire-ac.js";
import { initProject } from "../../core/bootstrap/init-project.js";
import { applyWorkflowMutation, defaultWorkflowOwner, type WorkflowMutationInput, type WorkflowMutationKind } from "../../core/workflow/mutation.js";
import { applyRequirementIdCollisionRepair, type RequirementIdCollisionRepairApplyInput, type RequirementOccurrenceIdentity } from "../../core/mutation/repair-requirement-id.js";
import { editRequirementTableRows, replaceAcceptanceCriteria, updateRequirementFields } from "../../core/mutation/edit-requirement.js";
import type { McpCallContext, McpDependencies, McpServerHandle } from "../adapter.js";
import { z } from "zod";
import { mcpFailure, resultToMcp } from "../errors.js";
import { missingRequiredArguments } from "../required-args.js";
import { registerOrchestrateTools } from "./read-tools.js";
import { registerRoadmapTools } from "./roadmap-tools.js";

/**
 * The root one mutation writes to. `input` is deliberately still ignored: this helper has 38 call
 * sites and only the `workflow_*` rows are worktree-local, so honouring `input.workspaceRoot`
 * here would open `update_status`, `supersede_requirement` and the rest of the SRS family. The
 * effective root arrives as `context`, decided by the registration gate. @req REL-MCP-005 AC-3
 */
async function root(deps: McpDependencies, input: Record<string, unknown>, context?: McpCallContext) {
  void input;
  return resolveProjectRoot(process.cwd(), context?.root ?? deps.root);
}

/** @req FR-MCP-058 AC-1 / AC-4 — the `workflow_*` mutation family declares itself worktree-local. */
const WORKTREE_LOCAL_MUTATION = { kind: "workspace", workspaceScope: "worktree-local" } as const;

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

function mutationOptions(input: Record<string, unknown>): { dryRun?: boolean; ignoreLock?: boolean } {
  return {
    ...(input.dryRun === true ? { dryRun: true } : {}),
    ...(input.ignoreLock === true ? { ignoreLock: true } : {})
  };
}

function workflowBase(kind: WorkflowMutationKind, input: Record<string, unknown>): WorkflowMutationInput {
  return {
    kind,
    owner: typeof input.owner === "string" ? input.owner : defaultWorkflowOwner(input.event),
    runId: String(input.runId),
    ...(typeof input.taskId === "string" ? { taskId: input.taskId } : {}),
    ...(typeof input.reqId === "string" ? { reqId: input.reqId } : {}),
    ...(typeof input.reason === "string" ? { reason: input.reason } : {}),
    ...(typeof input.expectedSha256 === "string" ? { expectedSha256: input.expectedSha256 } : {}),
    ...(typeof input.idempotencyKey === "string" ? { idempotencyKey: input.idempotencyKey } : {}),
    ...(input.dryRun === true ? { dryRun: true } : {})
  };
}

function workflowJsonEvent(input: Record<string, unknown>): Record<string, unknown> {
  return typeof input.event === "object" && input.event !== null && !Array.isArray(input.event) ? (input.event as Record<string, unknown>) : {};
}

function workflowRecordReclassificationInput(input: Record<string, unknown>): WorkflowMutationInput | null {
  const recordType = input.recordType;
  const valid =
    input.event === undefined &&
    typeof input.runId === "string" && input.runId.trim().length > 0 &&
    (input.path === undefined || (typeof input.path === "string" && input.path.trim().length > 0)) &&
    (recordType === "pipeline" || recordType === "worklog") &&
    typeof input.line === "number" && Number.isInteger(input.line) && input.line > 0 &&
    typeof input.byteOffset === "number" && Number.isInteger(input.byteOffset) && input.byteOffset >= 0 &&
    typeof input.rawSha256 === "string" && input.rawSha256.length > 0 &&
    typeof input.eventKey === "string" && input.eventKey.length > 0 &&
    typeof input.targetRunId === "string" && input.targetRunId.length > 0 &&
    typeof input.preimagePrefixSha256 === "string" && input.preimagePrefixSha256.length > 0 &&
    typeof input.expectedSha256 === "string" && input.expectedSha256.length > 0 &&
    typeof input.owner === "string" && input.owner.trim().length > 0 &&
    typeof input.reason === "string" && input.reason.trim().length > 0 &&
    (input.taskId === undefined || (typeof input.taskId === "string" && input.taskId.length > 0)) &&
    (input.reqId === undefined || (typeof input.reqId === "string" && input.reqId.length > 0)) &&
    (input.idempotencyKey === undefined || (typeof input.idempotencyKey === "string" && input.idempotencyKey.length > 0)) &&
    (input.repairToken === undefined || (typeof input.repairToken === "string" && input.repairToken.length > 0)) &&
    typeof input.dryRun === "boolean" &&
    (input.dryRun || (typeof input.repairToken === "string" && input.repairToken.length > 0));
  if (!valid) return null;
  return {
    kind: "workflow_record_reclassification",
    runId: input.runId as string,
    ...(typeof input.path === "string" ? { jsonlPath: input.path } : {}),
    recordType: recordType as "pipeline" | "worklog",
    line: input.line as number,
    byteOffset: input.byteOffset as number,
    rawSha256: input.rawSha256 as string,
    eventKey: input.eventKey as string,
    targetRunId: input.targetRunId as string,
    preimagePrefixSha256: input.preimagePrefixSha256 as string,
    expectedSha256: input.expectedSha256 as string,
    owner: input.owner as string,
    reason: input.reason as string,
    ...(typeof input.taskId === "string" ? { taskId: input.taskId } : {}),
    ...(typeof input.reqId === "string" ? { reqId: input.reqId } : {}),
    ...(typeof input.idempotencyKey === "string" ? { idempotencyKey: input.idempotencyKey } : {}),
    ...(typeof input.repairToken === "string" ? { repairToken: input.repairToken } : {}),
    dryRun: input.dryRun as boolean
  };
}

function workflowRecordReclassificationUsageFailure(input: Record<string, unknown>): unknown {
  return mcpFailure(
    "USAGE",
    "workflow_record_reclassification requires typed target identity, expectedSha256, owner, reason, dryRun, and repairToken when dryRun is false",
    {
      recovery: { tool: "workflow_record_reclassification", message: "Run a complete dry-run first, then apply its repairToken without changing the typed request." },
      metadata: {
        mutation: {
          kind: "workflow_record_reclassification",
          filePath: typeof input.path === "string" ? input.path : "-",
          dryRun: input.dryRun === true,
          written: false,
          operations: [],
          preview: [],
          journalState: "failed",
          completedOperations: [],
          pendingOperations: [],
          pendingRepair: null,
          targetRecord: {},
          staleGuards: []
        }
      }
    }
  );
}

function occurrenceInput(value: unknown): RequirementOccurrenceIdentity | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Partial<RequirementOccurrenceIdentity>;
  if (typeof record.filePath !== "string" || typeof record.headingLine !== "number" || typeof record.blockHash !== "string") return null;
  return { filePath: record.filePath, headingLine: record.headingLine, blockHash: record.blockHash };
}

function referenceEditsInput(value: unknown): Array<{ filePath: string; line: number; from: string; to: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) return [];
    const record = item as Partial<{ filePath: string; line: number; from: string; to: string }>;
    if (typeof record.filePath !== "string" || typeof record.line !== "number" || typeof record.from !== "string" || typeof record.to !== "string") return [];
    return [{ filePath: record.filePath, line: record.line, from: record.from, to: record.to }];
  });
}

function repairApplyInput(input: Record<string, unknown>): RequirementIdCollisionRepairApplyInput | null {
  const keep = occurrenceInput(input.keep);
  const rename = occurrenceInput(input.rename);
  if (typeof input.duplicateId !== "string" || !keep || !rename) return null;
  if (typeof input.replacementId !== "string" && input.allocationStrategy !== "next_available") return null;
  return {
    duplicateId: input.duplicateId,
    keep,
    rename,
    ...(typeof input.replacementId === "string" ? { replacementId: input.replacementId } : { allocationStrategy: "next_available" as const }),
    referenceEdits: referenceEditsInput(input.referenceEdits),
    ...mutationOptions(input)
  };
}

/** @req IR-MCP-006 — the inputs of the `rename-scope` CLI command; server.ts lists it, the handler checks it. */
export const RENAME_SCOPE_SCHEMA = {
  from: z.string().describe("scope document file name under docs/spec, `.srs.md` optional"),
  to: z.string().describe("new name as NN.slug, `.srs.md` optional"),
  apply: z.boolean().optional(),
  dryRun: z.boolean().optional(),
  ignoreLock: z.boolean().optional()
};

/** @req FR-MCP-073 — the retarget selection, with `apply` as the CLI's `--apply`. */
export const RETARGET_REQUIREMENTS_SCHEMA = {
  from: z.string().describe("source target whose requirements are moved; required unless ids names them").optional(),
  to: z.string().describe("destination target, registered in the Target Map"),
  reason: z.string(),
  scope: z.string().describe("limit the move set to a scope prefix").optional(),
  status: z.string().describe("limit the move set to a status").optional(),
  type: z.string().describe("limit the move set to a requirement type").optional(),
  ids: z.array(z.string()).describe("requirement ids to move; each must lie in the from/scope/status/type selection").optional(),
  exclude: z.array(z.string()).describe("requirement ids to leave where they are").optional(),
  apply: z.boolean().optional(),
  dryRun: z.boolean().optional(),
  ignoreLock: z.boolean().optional()
};

/** @req FR-NODE-243 AC-6 — server.ts lists it, the handler checks it. */
export const EXPIRE_ACCEPTANCE_CRITERION_SCHEMA = {
  id: z.string(),
  acId: z.string().describe("the live criterion to expire, e.g. AC-2"),
  reason: z.string(),
  successor: z.string().optional(),
  dryRun: z.boolean().optional(),
  ignoreLock: z.boolean().optional()
};

/** @req FR-MCP-072 AC-1 — server.ts lists it, the handler checks it. */
export const EDIT_ACCEPTANCE_CRITERION_SCHEMA = {
  id: z.string(),
  acId: z.string().describe("the live criterion to reword, e.g. AC-2"),
  text: z.string(),
  dryRun: z.boolean().optional(),
  ignoreLock: z.boolean().optional()
};

/** @req FR-MCP-072 AC-2 — server.ts lists it, the handler checks it. */
export const APPEND_ACCEPTANCE_CRITERION_SCHEMA = {
  id: z.string(),
  text: z.string(),
  dryRun: z.boolean().optional(),
  ignoreLock: z.boolean().optional()
};

/** @req FR-MCP-049 AC-1 AC-3 — one id, never a list; server.ts lists it, the handler checks it. */
export const ADD_RELATED_DOC_SCHEMA = {
  id: z.string(),
  link: z.string().describe("the document reference to append, e.g. a path or URL"),
  dryRun: z.boolean().optional(),
  ignoreLock: z.boolean().optional()
};

/** @req FR-MCP-049 AC-2 AC-3 AC-4 · FR-NODE-205 AC-7 — the date is optional; the core defaults it. */
export const ADD_CHANGE_NOTE_SCHEMA = {
  id: z.string(),
  change: z.string(),
  reason: z.string(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("YYYY-MM-DD; omitted, the writer's local date"),
  dryRun: z.boolean().optional(),
  ignoreLock: z.boolean().optional()
};

export function registerMutationTools(server: McpServerHandle, deps: McpDependencies): void {
  registerOrchestrateTools(server, deps, "mutation");
  // @req IR-MCP-009 AC-2 — the roadmap writers are workspace mutations and refuse a per-call root.
  registerRoadmapTools(server, deps, "mutation", () => ({ kind: "workspace" }));
  server.registerTool("sync_index", async (input) =>
    resultToMcp(
      await syncIndexRollups(await root(deps, input), {
        ...(typeof input.expectedSha256 === "string" ? { expectedSha256: input.expectedSha256 } : {}),
        ...mutationOptions(input)
      })
    ),
    { kind: "workspace" }
  );
  // FR-MCP-056 — scope creation and registration. `apply` and `dryRun` combine exactly as the CLI
  // combines them, so an explicit dry run supersedes apply rather than racing it.
  server.registerTool("scaffold_scope", async (input) =>
    resultToMcp(
      await scaffoldScope(await root(deps, input), {
        name: String(input.name ?? ""),
        prefix: String(input.prefix ?? ""),
        apply: input.apply === true && input.dryRun !== true,
        ...(input.ignoreLock === true ? { ignoreLock: true } : {})
      })
    ),
    { kind: "workspace" }
  );
  server.registerTool("register_scopes", async (input) =>
    resultToMcp(
      await registerScopes(await root(deps, input), {
        apply: input.apply === true,
        ...(input.dryRun === true ? { dryRun: true } : {}),
        ...(input.ignoreLock === true ? { ignoreLock: true } : {})
      })
    ),
    { kind: "workspace" }
  );
  // @req IR-MCP-006 — the CLI refuses `--apply` with `--dry-run` at parse time; the tool refuses the
  // same pair, so one input never means a write on one surface and a preview on the other.
  server.registerTool("rename_scope", async (input) =>
    missingRequiredArguments("rename_scope", RENAME_SCOPE_SCHEMA, input) ??
    (input.apply === true && input.dryRun === true
      ? mcpFailure("USAGE", "apply and dryRun contradict each other; pass one of them")
      : resultToMcp(
          await renameScope(await root(deps, input), {
            from: String(input.from ?? ""),
            to: String(input.to ?? ""),
            apply: input.apply === true,
            ...(input.ignoreLock === true ? { ignoreLock: true } : {})
          })
        )),
    { kind: "workspace" }
  );
  // @req FR-MCP-073 — preview unless `apply`, as the CLI; the selection is the core function both call.
  server.registerTool("retarget_requirements", async (input) =>
    missingRequiredArguments("retarget_requirements", RETARGET_REQUIREMENTS_SCHEMA, input) ??
    (input.apply === true && input.dryRun === true
      ? mcpFailure("USAGE", "apply and dryRun contradict each other; pass one of them")
      : resultToMcp(
          await retargetSelection(await root(deps, input), {
            ...(typeof input.from === "string" ? { from: input.from } : {}),
            to: String(input.to ?? ""),
            reason: String(input.reason ?? ""),
            ...(typeof input.scope === "string" ? { scope: input.scope } : {}),
            ...(typeof input.status === "string" ? { status: input.status } : {}),
            ...(typeof input.type === "string" ? { type: input.type } : {}),
            ids: Array.isArray(input.ids) ? input.ids.map(String) : [],
            exclude: Array.isArray(input.exclude) ? input.exclude.map(String) : [],
            dryRun: input.apply !== true,
            ...(input.ignoreLock === true ? { ignoreLock: true } : {})
          })
        )),
    { kind: "workspace" }
  );
  // @req FR-NODE-243 AC-6
  server.registerTool("expire_acceptance_criterion", async (input) =>
    missingRequiredArguments("expire_acceptance_criterion", EXPIRE_ACCEPTANCE_CRITERION_SCHEMA, input) ??
    resultToMcp(
      await expireAcceptanceCriterion(await root(deps, input), {
        id: String(input.id),
        acId: String(input.acId),
        reason: typeof input.reason === "string" ? input.reason : "",
        ...(typeof input.successor === "string" ? { successor: input.successor } : {}),
        ...mutationOptions(input)
      })
    ),
    { kind: "req-scoped" }
  );
  // @req FR-MCP-072 AC-1 AC-3
  server.registerTool("edit_acceptance_criterion", async (input) =>
    missingRequiredArguments("edit_acceptance_criterion", EDIT_ACCEPTANCE_CRITERION_SCHEMA, input) ??
    resultToMcp(
      await editAcceptanceCriteria(await root(deps, input), {
        id: String(input.id),
        acId: String(input.acId),
        text: typeof input.text === "string" ? input.text : "",
        ...mutationOptions(input)
      })
    ),
    { kind: "req-scoped" }
  );
  // @req FR-MCP-072 AC-2 AC-3
  server.registerTool("append_acceptance_criterion", async (input) =>
    missingRequiredArguments("append_acceptance_criterion", APPEND_ACCEPTANCE_CRITERION_SCHEMA, input) ??
    resultToMcp(
      await appendAcceptanceCriterion(await root(deps, input), {
        id: String(input.id),
        text: typeof input.text === "string" ? input.text : "",
        ...mutationOptions(input)
      })
    ),
    { kind: "req-scoped" }
  );
  // @req FR-MCP-049 AC-1 AC-5 AC-6
  server.registerTool("add_related_doc", async (input) =>
    missingRequiredArguments("add_related_doc", ADD_RELATED_DOC_SCHEMA, input) ??
    resultToMcp(
      await addRelatedDoc(await root(deps, input), {
        id: String(input.id),
        reference: String(input.link),
        ...mutationOptions(input)
      })
    ),
    { kind: "req-scoped" }
  );
  // @req FR-MCP-049 AC-2 AC-4 AC-5 AC-6
  server.registerTool("add_change_note", async (input) =>
    missingRequiredArguments("add_change_note", ADD_CHANGE_NOTE_SCHEMA, input) ??
    resultToMcp(
      await addChangeNote(await root(deps, input), {
        id: String(input.id),
        change: String(input.change),
        reason: String(input.reason),
        ...(typeof input.date === "string" ? { date: input.date } : {}),
        ...mutationOptions(input)
      })
    ),
    { kind: "req-scoped" }
  );
  server.registerTool("update_status", async (input) =>
    resultToMcp(
      await updateStatus(await root(deps, input), {
        id: String(input.id),
        status: input.status as never,
        ...(typeof input.reason === "string" ? { reason: input.reason } : {}),
        ...mutationOptions(input)
      })
    ),
    { kind: "req-scoped" }
  );
  server.registerTool("update_stability", async (input) =>
    resultToMcp(
      await updateStability(await root(deps, input), {
        id: String(input.id),
        stability: input.stability as never,
        ...(typeof input.reason === "string" ? { reason: input.reason } : {}),
        ...mutationOptions(input)
      })
    ),
    { kind: "req-scoped" }
  );
  server.registerTool("append_section_note", async (input) =>
    resultToMcp(
      await appendSectionNote(await root(deps, input), {
        id: String(input.id),
        section: String(input.section),
        text: String(input.text),
        ...(typeof input.mode === "string" ? { mode: input.mode as "append" | "replace" } : {}),
        ...(input.confirmReplace === true ? { confirmReplace: true } : {}),
        ...mutationOptions(input)
      })
    ),
    { kind: "req-scoped" }
  );
  server.registerTool("edit_requirement_fields", async (input) =>
    resultToMcp(
      await updateRequirementFields(await root(deps, input), {
        id: String(input.id),
        ...(typeof input.title === "string" ? { title: input.title } : {}),
        ...(typeof input.statement === "string" ? { statement: input.statement } : {}),
        ...(typeof input.priority === "string" ? { priority: input.priority } : {}),
        ...(typeof input.risk === "string" ? { risk: input.risk } : {}),
        ...(Array.isArray(input.tags) ? { tags: input.tags.map(String) } : {}),
        ...(Array.isArray(input.relatedDocs) ? { relatedDocs: input.relatedDocs.map(String) } : {}),
        ...(typeof input.verificationMethod === "string" ? { verificationMethod: input.verificationMethod } : {}),
        ...(typeof input.githubIssue === "string" ? { githubIssue: input.githubIssue } : {}),
        ...mutationOptions(input)
      })
    ),
    { kind: "req-scoped" }
  );
  server.registerTool("replace_acceptance_criteria", async (input) =>
    resultToMcp(
      await replaceAcceptanceCriteria(await root(deps, input), {
        id: String(input.id),
        items: Array.isArray(input.items) ? (input.items as Array<{ text: string; checked?: boolean }>) : [],
        ...mutationOptions(input)
      })
    ),
    { kind: "req-scoped" }
  );
  server.registerTool("edit_requirement_table_rows", async (input) =>
    resultToMcp(
      await editRequirementTableRows(await root(deps, input), {
        id: String(input.id),
        section: input.section as never,
        operations: Array.isArray(input.operations) ? (input.operations as never) : [],
        ...mutationOptions(input)
      })
    ),
    { kind: "req-scoped" }
  );
  server.registerTool("check_acceptance_criteria", async (input) =>
    resultToMcp(
      await setAcceptanceCriteriaChecked(await root(deps, input), {
        id: String(input.id),
        acIds: Array.isArray(input.acIds) ? input.acIds.map(String) : [String(input.acIds)],
        checked: Boolean(input.checked),
        ...mutationOptions(input)
      })
    ),
    { kind: "req-scoped" }
  );
  server.registerTool("add_verification_evidence", async (input) =>
    resultToMcp(
      await addVerificationEvidence(await root(deps, input), {
        id: String(input.id),
        type: String(input.type),
        reference: String(input.reference),
        ...(typeof input.covers === "string" ? { covers: input.covers } : {}),
        ...(typeof input.notes === "string" ? { notes: input.notes } : {}),
        ...mutationOptions(input)
      })
    ),
    { kind: "req-scoped" }
  );
  server.registerTool("add_trace_link", async (input) =>
    resultToMcp(
      await addTraceLink(await root(deps, input), {
        id: String(input.id),
        type: String(input.type),
        reference: String(input.reference),
        relation: String(input.relation),
        ...(typeof input.notes === "string" ? { notes: input.notes } : {}),
        ...mutationOptions(input)
      })
    ),
    { kind: "req-scoped" }
  );
  server.registerTool(
    "set_active_target",
    async (input) =>
      resultToMcp(
        await setActiveTarget(await root(deps, input), {
          target: String(input.target),
          create: input.create === true,
          ...(typeof input.type === "string" ? { targetType: input.type } : {}),
          ...(typeof input.description === "string" ? { description: input.description } : {}),
          ...mutationOptions(input)
        })
      ),
    { kind: "workspace" }
  );
  // @req FR-NODE-276 AC-2
  server.registerTool(
    "set_target_description",
    async (input) =>
      resultToMcp(
        await setTargetDescription(await root(deps, input), {
          target: String(input.target),
          description: String(input.description),
          ...mutationOptions(input)
        })
      ),
    { kind: "workspace" }
  );
  server.registerTool(
    "set_target_goal",
    async (input) =>
      resultToMcp(
        await setTargetGoal(await root(deps, input), {
          target: String(input.target),
          goal: String(input.goal),
          ...mutationOptions(input)
        })
      ),
    { kind: "workspace" }
  );
  server.registerTool("add_completed_work", async (input) =>
    resultToMcp(
      await addCompletedWork(await root(deps, input), {
        date: String(input.date),
        summary: String(input.summary),
        ...(typeof input.target === "string" ? { target: input.target } : {}),
        ...(typeof input.scope === "string" ? { scope: input.scope } : {}),
        requirementIds: stringArray(input.requirementIds),
        reportPaths: stringArray(input.reportPaths),
        allowIncomplete: Boolean(input.allowIncomplete),
        ...mutationOptions(input)
      })
    ),
    { kind: "log-append" }
  );
  server.registerTool("add_requirement", async (input) =>
    {
      const addInput = {
        type: input.type as never,
        scope: String(input.scope),
        title: String(input.title),
        statement: "",
        acceptanceCriteria: stringArray(input.acceptanceCriteria),
        checkedAcceptanceCriteria: stringArray(input.checkedAcceptanceCriteria),
        tags: stringArray(input.tags),
        relatedDocs: stringArray(input.relatedDocs),
        evidence: Array.isArray(input.evidence) ? (input.evidence as never) : [],
        trace: Array.isArray(input.trace) ? (input.trace as never) : [],
        ...mutationOptions(input)
      };
      const optional = input as Record<string, unknown>;
      const statement = typeof optional.requirement === "string" ? optional.requirement : typeof optional.statement === "string" ? optional.statement : undefined;
      if (!statement) {
        return mcpFailure("USAGE", "add_requirement requires requirement", {
          recovery: { tool: "add_requirement", message: "Provide a requirement or statement field before retrying." }
        });
      }
      Object.assign(addInput, { statement });
      if (typeof optional.status === "string") Object.assign(addInput, { status: optional.status });
      if (typeof optional.target === "string") Object.assign(addInput, { target: optional.target });
      if (typeof optional.priority === "string") Object.assign(addInput, { priority: optional.priority });
      if (typeof optional.risk === "string") Object.assign(addInput, { risk: optional.risk });
      if (typeof optional.stability === "string") Object.assign(addInput, { stability: optional.stability });
      if (typeof optional.verificationMethod === "string") Object.assign(addInput, { verificationMethod: optional.verificationMethod });
      if (typeof optional.githubIssue === "string") Object.assign(addInput, { githubIssue: optional.githubIssue });
      if (typeof optional.rationale === "string") Object.assign(addInput, { rationale: optional.rationale });
      if (typeof optional.implementationNotes === "string") Object.assign(addInput, { implementationNotes: optional.implementationNotes });
      if (typeof optional.research === "string") Object.assign(addInput, { research: optional.research });
      if (optional.changeNotes !== undefined) Object.assign(addInput, { changeNotes: optional.changeNotes });
      return resultToMcp(await addRequirement(await root(deps, input), addInput));
    },
    { kind: "workspace" }
  );
  server.registerTool("init_project", async (input) =>
    {
      const initInput = { force: Boolean(input.force), ...(input.ignoreLock === true ? { ignoreLock: true } : {}) };
      if (typeof input.target === "string") Object.assign(initInput, { target: input.target });
      if (typeof input.scope === "string") Object.assign(initInput, { scope: input.scope });
      return resultToMcp(await initProject(await root(deps, input), initInput));
    },
    { kind: "workspace" }
  );
  server.registerTool("workflow_pipeline_emit", async (input, context) =>
    resultToMcp(
      await applyWorkflowMutation(await root(deps, input, context), {
        ...workflowBase("pipeline_event_append", input),
        jsonlPath: typeof input.path === "string" ? input.path : "kiwi/pipeline.jsonl",
        event: workflowJsonEvent(input)
      })
    ),
    WORKTREE_LOCAL_MUTATION
  );
  server.registerTool("workflow_worklog_emit", async (input, context) =>
    resultToMcp(
      await applyWorkflowMutation(await root(deps, input, context), {
        ...workflowBase("worklog_event_append", input),
        jsonlPath: typeof input.path === "string" ? input.path : `.kiwi/sessions/${String(input.runId)}/worklog.jsonl`,
        event: workflowJsonEvent(input)
      })
    ),
    WORKTREE_LOCAL_MUTATION
  );
  server.registerTool("workflow_repair_record", async (input, context) =>
    resultToMcp(
      await applyWorkflowMutation(await root(deps, input, context), {
        ...workflowBase("workflow_repair_record", input),
        jsonlPath: typeof input.path === "string" ? input.path : `.kiwi/sessions/${String(input.runId)}/worklog.jsonl`,
        event: workflowJsonEvent(input)
      })
    ),
    WORKTREE_LOCAL_MUTATION
  );
  server.registerTool(
    "workflow_record_reclassification",
    async (input, context) => {
      const parsed = workflowRecordReclassificationInput(input);
      if (!parsed) return workflowRecordReclassificationUsageFailure(input);
      return resultToMcp(await applyWorkflowMutation(await root(deps, input, context), parsed));
    },
    WORKTREE_LOCAL_MUTATION
  );
  server.registerTool("workflow_logical_delete", async (input, context) =>
    resultToMcp(
      await applyWorkflowMutation(await root(deps, input, context), {
        ...workflowBase("workflow_logical_delete", input),
        jsonlPath: typeof input.path === "string" ? input.path : "kiwi/pipeline.jsonl",
        recordType: String(input.recordType),
        recordId: String(input.recordId)
      })
    ),
    WORKTREE_LOCAL_MUTATION
  );
  server.registerTool(
    "apply_requirement_id_collision_repair",
    async (input) => {
      const parsed = repairApplyInput(input);
      if (!parsed) {
        return mcpFailure("USAGE", "apply_requirement_id_collision_repair requires duplicateId, keep, rename, and replacementId or allocationStrategy=next_available", {
          recovery: { tool: "diagnose_requirement_id_collisions", message: "Run diagnose first and pass exact occurrence identities to apply." }
        });
      }
      return resultToMcp(await applyRequirementIdCollisionRepair(await root(deps, input), parsed));
    },
    { kind: "workspace" }
  );

  // FR-MCP-040..043 — step / compatibility / supersede mutation tools. These forward to the already
  // implemented core services. Their kind is carried by the ToolSpec registry (schemas.ts) as the
  // zero-drift SSOT; they are intentionally registered without adapter kind metadata so the pinned
  // FR-ARCH-005 mutation-kind adapter contract (a fixed 24-tool set) is not disturbed by this wiring
  // step — the registry step reconciles the adapter kind table together with the CLI mirror.
  server.registerTool("add_compatibility_check", async (input) =>
    resultToMcp(
      await addCompatibilityCheck(await root(deps, input), {
        aReqId: String(input.aReqId),
        bReqId: String(input.bReqId),
        ...(input.dryRun === true ? { dryRun: true } : {})
      })
    )
  );
  server.registerTool("refresh_compatibility_check", async (input) =>
    resultToMcp(
      await refreshCompatibilityCheck(await root(deps, input), {
        aReqId: String(input.aReqId),
        bReqId: String(input.bReqId),
        ...(input.dryRun === true ? { dryRun: true } : {})
      })
    )
  );
  server.registerTool("revoke_compatibility_check", async (input) =>
    resultToMcp(
      await revokeCompatibilityCheck(await root(deps, input), {
        aReqId: String(input.aReqId),
        bReqId: String(input.bReqId),
        ...(input.dryRun === true ? { dryRun: true } : {})
      })
    )
  );
  server.registerTool("claim_step", async (input) =>
    resultToMcp(
      await claimStep(await root(deps, input), {
        step: String(input.step),
        touchesScope: String(input.touchesScope),
        touchesReq: stringArray(input.touchesReq),
        ...(input.force === true ? { force: true } : {}),
        ...(typeof input.supersede === "string" ? { supersede: input.supersede } : {}),
        ...(input.dryRun === true ? { dryRun: true } : {})
      })
    )
  );
  server.registerTool("update_step_state", async (input) =>
    resultToMcp(
      await updateStepState(await root(deps, input), {
        step: String(input.step),
        ...(typeof input.status === "string" ? { status: input.status } : {}),
        ...(typeof input.dependsOn === "string" ? { dependsOn: input.dependsOn } : {}),
        // FR-NODE-078 — completion-gate override for the merged transition.
        ...(input.acknowledged === true ? { acknowledged: true } : {}),
        ...(input.dryRun === true ? { dryRun: true } : {})
      })
    )
  );
  // FR-MCP-053 — synthesize_step_srs forwards to the idempotent core synthesis engine.
  server.registerTool("synthesize_step_srs", async (input) =>
    resultToMcp(
      await synthesizeStepSrs(await root(deps, input), {
        task: String(input.task),
        ...(input.dryRun === true ? { dryRun: true } : {})
      })
    )
  );
  // FR-NODE-080 — scaffold_step forwards to the writeIfMissing intent (and, with sds, SDS) stub scaffold.
  server.registerTool("scaffold_step", async (input) =>
    resultToMcp(
      await scaffoldStep(await root(deps, input), {
        task: String(input.task),
        ...(typeof input.target === "string" ? { target: input.target } : {}),
        ...(input.sds === true ? { sds: true } : {}),
        ...(input.dryRun === true ? { dryRun: true } : {})
      })
    )
  );
  // FR-NODE-081 — set_sds_status forwards to the forward-only SDS lifecycle mutation.
  server.registerTool("set_sds_status", async (input) =>
    resultToMcp(
      await setSdsStatus(await root(deps, input), {
        task: String(input.task),
        status: String(input.status),
        ...(input.dryRun === true ? { dryRun: true } : {})
      })
    )
  );
  // FR-MCP-052 — set_work_mode mirrors `speckiwi mode <value>` (IR-CLI-048/071 enum guard included).
  server.registerTool("set_work_mode", async (input) => {
    const mode = String(input.mode);
    if (!["sdd", "vibe", "wait", "tdd"].includes(mode)) {
      return resultToMcp(mutationFail("INVALID_MODE", `Invalid mode: ${mode} (expected sdd, vibe, wait, or tdd)`));
    }
    return resultToMcp(
      await setWorkMode(await root(deps, input), {
        mode: mode as StepStateMode,
        ...(typeof input.activeTask === "string" ? { activeTask: input.activeTask } : {}),
        ...(input.dryRun === true ? { dryRun: true } : {})
      })
    );
  });
  server.registerTool("supersede_requirement", async (input) =>
    resultToMcp(
      await supersedeRequirement(await root(deps, input), {
        oldId: String(input.oldId),
        scope: String(input.scope),
        target: String(input.target),
        title: String(input.title),
        statement: String(input.statement ?? ""),
        acceptanceCriteria: stringArray(input.acceptanceCriteria),
        confirmDiscardVerified: true,
        // @req FR-NODE-176 — the agent's type, so the MCP and CLI surfaces mint the same successor.
        ...(typeof input.type === "string" ? { type: input.type as RequirementType } : {}),
        ...(typeof input.successorId === "string" ? { successorId: input.successorId } : {}),
        ...(typeof input.reason === "string" ? { reason: input.reason } : {}),
        ...(input.dryRun === true ? { dryRun: true } : {})
      })
    )
  );
  server.registerTool("promote_step_requirement", async (input) =>
    resultToMcp(
      await promoteStepRequirement(await root(deps, input), {
        id: String(input.id),
        fromStep: String(input.fromStep),
        toScope: String(input.toScope),
        ...(input.dryRun === true ? { dryRun: true } : {}),
        ...(input.ignoreLock === true ? { ignoreLock: true } : {})
      })
    )
  );
}
