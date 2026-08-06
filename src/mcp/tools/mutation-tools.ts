import { resolveProjectRoot } from "../../core/project-root.js";
import { updateStatus } from "../../core/mutation/update-status.js";
import { updateStability } from "../../core/mutation/update-stability.js";
import { appendSectionNote } from "../../core/mutation/append-section-note.js";
import { setAcceptanceCriteriaChecked } from "../../core/mutation/check-ac.js";
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
import { setActiveTarget } from "../../core/mutation/set-active-target.js";
import { setTargetGoal } from "../../core/mutation/set-target-goal.js";
import { addCompletedWork } from "../../core/mutation/add-completed-work.js";
import { syncIndexRollups } from "../../core/mutation/sync-index.js";
import { scaffoldScope } from "../../core/mutation/scaffold-scope.js";
import { registerScopes } from "../../core/mutation/register-scopes.js";
import { initProject } from "../../core/bootstrap/init-project.js";
import { applyWorkflowMutation, type WorkflowMutationInput, type WorkflowMutationKind } from "../../core/workflow/mutation.js";
import { applyRequirementIdCollisionRepair, type RequirementIdCollisionRepairApplyInput, type RequirementOccurrenceIdentity } from "../../core/mutation/repair-requirement-id.js";
import { editRequirementTableRows, replaceAcceptanceCriteria, updateRequirementFields } from "../../core/mutation/edit-requirement.js";
import type { McpDependencies, McpServerHandle } from "../adapter.js";
import { mcpFailure, resultToMcp } from "../errors.js";
import { registerOrchestrateTools } from "./read-tools.js";

async function root(deps: McpDependencies, input: Record<string, unknown>) {
  void input;
  return resolveProjectRoot(process.cwd(), deps.root);
}

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
    owner: typeof input.owner === "string" ? input.owner : "kiwi-pm",
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

export function registerMutationTools(server: McpServerHandle, deps: McpDependencies): void {
  registerOrchestrateTools(server, deps, "mutation");
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
        ...(input.dryRun === true ? { dryRun: true } : {})
      })
    ),
    { kind: "workspace" }
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
      if (typeof optional.changeNotes === "string") Object.assign(addInput, { changeNotes: optional.changeNotes });
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
  server.registerTool("workflow_task_check", async (input) =>
    resultToMcp(
      await applyWorkflowMutation(await root(deps, input), {
        ...workflowBase("plan_checkbox_check", input),
        taskId: String(input.taskId),
        planPath: String(input.path ?? input.planPath)
      })
    ),
    { kind: "workspace" }
  );
  server.registerTool("workflow_task_uncheck", async (input) =>
    resultToMcp(
      await applyWorkflowMutation(await root(deps, input), {
        ...workflowBase("plan_checkbox_uncheck", input),
        taskId: String(input.taskId),
        planPath: String(input.path ?? input.planPath)
      })
    ),
    { kind: "workspace" }
  );
  server.registerTool("workflow_checklist_set", async (input) =>
    resultToMcp(
      await applyWorkflowMutation(await root(deps, input), {
        ...workflowBase("plan_checklist_item_update", input),
        taskId: String(input.taskId),
        planPath: String(input.path ?? input.planPath),
        checked: input.checked === true
      })
    ),
    { kind: "workspace" }
  );
  server.registerTool("workflow_task_status_set", async (input) =>
    resultToMcp(
      await applyWorkflowMutation(await root(deps, input), {
        ...workflowBase("pm_task_status_update", input),
        taskId: String(input.taskId),
        pmStatePath: String(input.pmStatePath),
        status: String(input.status)
      })
    ),
    { kind: "workspace" }
  );
  server.registerTool("workflow_pipeline_emit", async (input) =>
    resultToMcp(
      await applyWorkflowMutation(await root(deps, input), {
        ...workflowBase("pipeline_event_append", input),
        jsonlPath: typeof input.path === "string" ? input.path : "kiwi/pipeline.jsonl",
        event: workflowJsonEvent(input)
      })
    ),
    { kind: "workspace" }
  );
  server.registerTool("workflow_worklog_emit", async (input) =>
    resultToMcp(
      await applyWorkflowMutation(await root(deps, input), {
        ...workflowBase("worklog_event_append", input),
        jsonlPath: typeof input.path === "string" ? input.path : `.kiwi/sessions/${String(input.runId)}/worklog.jsonl`,
        event: workflowJsonEvent(input)
      })
    ),
    { kind: "workspace" }
  );
  server.registerTool("workflow_repair_record", async (input) =>
    resultToMcp(
      await applyWorkflowMutation(await root(deps, input), {
        ...workflowBase("workflow_repair_record", input),
        jsonlPath: typeof input.path === "string" ? input.path : `.kiwi/sessions/${String(input.runId)}/worklog.jsonl`,
        event: workflowJsonEvent(input)
      })
    ),
    { kind: "workspace" }
  );
  server.registerTool("workflow_logical_delete", async (input) =>
    resultToMcp(
      await applyWorkflowMutation(await root(deps, input), {
        ...workflowBase("workflow_logical_delete", input),
        jsonlPath: typeof input.path === "string" ? input.path : "kiwi/pipeline.jsonl",
        recordType: String(input.recordType),
        recordId: String(input.recordId)
      })
    ),
    { kind: "workspace" }
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
  // FR-NODE-080 — scaffold_step forwards to the writeIfMissing SDS/intent stub scaffold.
  server.registerTool("scaffold_step", async (input) =>
    resultToMcp(
      await scaffoldStep(await root(deps, input), {
        task: String(input.task),
        ...(typeof input.target === "string" ? { target: input.target } : {}),
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
