import { resolveProjectRoot } from "../../core/project-root.js";
import { updateStatus } from "../../core/mutation/update-status.js";
import { updateStability } from "../../core/mutation/update-stability.js";
import { appendSectionNote } from "../../core/mutation/append-section-note.js";
import { setAcceptanceCriteriaChecked } from "../../core/mutation/check-ac.js";
import { addVerificationEvidence } from "../../core/mutation/add-evidence.js";
import { addTraceLink } from "../../core/mutation/add-trace.js";
import { addRequirement } from "../../core/mutation/add-requirement.js";
import { setActiveTarget } from "../../core/mutation/set-active-target.js";
import { setTargetGoal } from "../../core/mutation/set-target-goal.js";
import { addCompletedWork } from "../../core/mutation/add-completed-work.js";
import { initProject } from "../../core/bootstrap/init-project.js";
import type { McpDependencies, McpServerHandle } from "../adapter.js";
import { resultToMcp } from "../errors.js";

async function root(deps: McpDependencies, input: Record<string, unknown>) {
  void input;
  return resolveProjectRoot(process.cwd(), deps.root);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

export function registerMutationTools(server: McpServerHandle, deps: McpDependencies): void {
  server.registerTool("update_status", async (input) =>
    resultToMcp(
      await updateStatus(await root(deps, input), {
        id: String(input.id),
        status: input.status as never,
        ...(typeof input.reason === "string" ? { reason: input.reason } : {}),
        ...(input.dryRun === true ? { dryRun: true } : {})
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
        ...(input.dryRun === true ? { dryRun: true } : {})
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
        ...(input.dryRun === true ? { dryRun: true } : {})
      })
    ),
    { kind: "req-scoped" }
  );
  server.registerTool("check_acceptance_criteria", async (input) =>
    resultToMcp(await setAcceptanceCriteriaChecked(await root(deps, input), { id: String(input.id), acIds: Array.isArray(input.acIds) ? input.acIds.map(String) : [String(input.acIds)], checked: Boolean(input.checked) })),
    { kind: "req-scoped" }
  );
  server.registerTool("add_verification_evidence", async (input) =>
    resultToMcp(
      await addVerificationEvidence(await root(deps, input), {
        id: String(input.id),
        type: String(input.type),
        reference: String(input.reference),
        ...(typeof input.covers === "string" ? { covers: input.covers } : {})
      })
    ),
    { kind: "req-scoped" }
  );
  server.registerTool("add_trace_link", async (input) =>
    resultToMcp(await addTraceLink(await root(deps, input), { id: String(input.id), type: String(input.type), reference: String(input.reference), relation: String(input.relation) })),
    { kind: "req-scoped" }
  );
  server.registerTool("set_active_target", async (input) => resultToMcp(await setActiveTarget(await root(deps, input), { target: String(input.target), dryRun: Boolean(input.dryRun) })), { kind: "workspace" });
  server.registerTool(
    "set_target_goal",
    async (input) =>
      resultToMcp(
        await setTargetGoal(await root(deps, input), {
          target: String(input.target),
          goal: String(input.goal),
          ...(input.dryRun === true ? { dryRun: true } : {})
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
        dryRun: Boolean(input.dryRun)
      })
    ),
    { kind: "log-append" }
  );
  server.registerTool("add_requirement", async (input) =>
    {
      const addInput = {
        type: input.type as never,
        scope: String(input.scope),
        target: String(input.target),
        title: String(input.title),
        statement: "",
        acceptanceCriteria: stringArray(input.acceptanceCriteria),
        checkedAcceptanceCriteria: stringArray(input.checkedAcceptanceCriteria),
        tags: stringArray(input.tags),
        relatedDocs: stringArray(input.relatedDocs),
        evidence: Array.isArray(input.evidence) ? (input.evidence as never) : [],
        trace: Array.isArray(input.trace) ? (input.trace as never) : [],
        dryRun: Boolean(input.dryRun)
      };
      const optional = input as Record<string, unknown>;
      const statement = typeof optional.requirement === "string" ? optional.requirement : typeof optional.statement === "string" ? optional.statement : undefined;
      if (!statement) return { ok: false, error: { code: "USAGE", message: "add_requirement requires requirement" } };
      Object.assign(addInput, { statement });
      if (typeof optional.status === "string") Object.assign(addInput, { status: optional.status });
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
      const initInput = { force: Boolean(input.force) };
      if (typeof input.target === "string") Object.assign(initInput, { target: input.target });
      if (typeof input.scope === "string") Object.assign(initInput, { scope: input.scope });
      return resultToMcp(await initProject(await root(deps, input), initInput));
    },
    { kind: "workspace" }
  );
}
