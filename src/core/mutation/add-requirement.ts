import path from "node:path";
import { readUtf8File } from "../fs/read-text.js";
import { resolveInsideRoot } from "../fs/safe-path.js";
import { applyPatchPlan } from "../patch/apply-patch.js";
import { createPatchPlan } from "../patch/patch-plan.js";
import { summarizePatch } from "../patch/hunk-summary.js";
import { parseWorkspace } from "../parser/workspace-parser.js";
import { isRequirementType } from "../schema.js";
import type { MutationResult, ParsedWorkspace, Priority, ProjectRoot, RequirementRecord, RequirementType, Risk, Stability } from "../types.js";
import { mutationFail } from "./guards.js";
import { prefixForType, renderRequirementBlock, type RenderRequirementInput } from "./render-requirement.js";

export interface AddRequirementInput extends Omit<RenderRequirementInput, "id" | "type"> {
  type: RequirementType;
  scope: string;
  dryRun?: boolean;
}

export interface AddRequirementOutput {
  requirementId: string;
  filePath: string;
  written: boolean;
  record: RequirementRecord;
}

export function generateNextRequirementId(workspace: ParsedWorkspace, type: RequirementType, scopePrefix: string): string {
  const prefix = prefixForType(type);
  const used = workspace.records
    .map((record) => new RegExp(`^${prefix}-${scopePrefix}-(\\d{3,4})$`).exec(record.id)?.[1])
    .filter((value): value is string => Boolean(value))
    .map((value) => Number.parseInt(value, 10));
  return `${prefix}-${scopePrefix}-${String((Math.max(0, ...used) || 0) + 1).padStart(3, "0")}`;
}

function canBeVerified(input: AddRequirementInput): boolean {
  if (input.status !== "verified") return true;
  const acCount = input.acceptanceCriteria.length;
  const checked = new Set(input.checkedAcceptanceCriteria ?? []);
  return acCount > 0 && input.acceptanceCriteria.every((criterion, index) => checked.has(`AC-${index + 1}`) || checked.has(criterion)) && (input.evidence ?? []).some((row) => (row.reference ?? "").trim() !== "");
}

function findRequirementsAppendLine(lines: string[]): number {
  const heading = lines.findIndex((line) => line.trim() === "## 4. Requirements");
  if (heading < 0) return lines.length + 1;
  for (let index = heading + 1; index < lines.length; index += 1) {
    if (lines[index]?.startsWith("## ") && index !== heading) return index + 1;
  }
  return lines.length + 1;
}

async function resolveScopeDocumentPath(root: ProjectRoot, document: string): Promise<string> {
  const clean = document.replace(/^\.\//, "");
  const candidate = path.join("docs", "spec", clean);
  const resolved = await resolveInsideRoot(root.root, candidate);
  const specRoot = await resolveInsideRoot(root.root, path.join("docs", "spec"));
  const relative = path.relative(specRoot, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Scope document is outside docs/spec: ${document}`);
  }
  return resolved;
}

function buildOutputRecord(input: AddRequirementInput, id: string, filePath: string): RequirementRecord {
  const checked = new Set(input.checkedAcceptanceCriteria ?? []);
  const record: RequirementRecord = {
    id,
    title: input.title,
    type: input.type,
    target: input.target,
    status: input.status ?? "planned",
    scope: input.scope,
    filePath,
    headingLine: 0,
    metadata: {
      Type: input.type,
      Target: input.target,
      Status: input.status ?? "planned",
      Priority: input.priority ?? "medium",
      Tags: (input.tags ?? []).join(", ") || "-",
      Risk: input.risk ?? "medium",
      Stability: input.stability ?? "evolving",
      "Verification Method": input.verificationMethod ?? "test",
      "GitHub Issue": input.githubIssue ?? "-",
      "Related Docs": (input.relatedDocs ?? []).join(", ") || "-"
    },
    acceptanceCriteria: input.acceptanceCriteria.map((criterion, index) => ({
      id: `AC-${index + 1}`,
      text: criterion,
      checked: checked.has(`AC-${index + 1}`) || checked.has(criterion),
      line: 0
    })),
    verificationEvidence: (input.evidence ?? []).map((row, index) => ({
      id: row.id ?? `VE-${index + 1}`,
      type: row.type ?? "test",
      reference: row.reference ?? "",
      covers: row.covers ?? "all",
      notes: row.notes ?? "-"
    })),
    traceLinks: (input.trace ?? []).map((row) => ({
      type: row.type ?? "Requirement",
      reference: row.reference ?? "",
      relation: row.relation ?? "related_to",
      notes: row.notes ?? "-"
    })),
    tags: input.tags ?? [],
    requirement: input.statement
  };
  if (input.priority) record.priority = input.priority as Priority;
  if (input.risk) record.risk = input.risk as Risk;
  if (input.stability) record.stability = input.stability as Stability;
  if (input.rationale) record.rationale = input.rationale;
  return record;
}

export async function addRequirement(root: ProjectRoot, input: AddRequirementInput): Promise<MutationResult<AddRequirementOutput>> {
  if (!isRequirementType(input.type)) return mutationFail("USAGE", "Invalid requirement type");
  if (!input.scope || !input.target || !input.title || !input.statement || input.acceptanceCriteria.length === 0) {
    return mutationFail("USAGE", "type, scope, target, title, statement, and acceptanceCriteria are required");
  }
  if (!canBeVerified(input)) return mutationFail("MUTATION_DENIED", "verified requires all checked AC and evidence");

  const workspace = await parseWorkspace(root);
  const scope = workspace.index.scopes.find((candidate) => candidate.prefix === input.scope);
  if (!scope) return mutationFail("MUTATION_DENIED", `Unknown scope: ${input.scope}`);
  if (!workspace.index.targets.some((target) => target.target === input.target)) {
    return mutationFail("MUTATION_DENIED", `Unknown target: ${input.target}`);
  }
  for (const trace of input.trace ?? []) {
    if (trace.type === "Requirement" && trace.reference && !workspace.records.some((record: RequirementRecord) => record.id === trace.reference)) {
      return mutationFail("MUTATION_DENIED", `Trace target not found: ${trace.reference}`);
    }
  }
  const id = generateNextRequirementId(workspace, input.type, input.scope);
  let filePath: string;
  try {
    filePath = await resolveScopeDocumentPath(root, scope.document);
  } catch (error) {
    return mutationFail("MUTATION_DENIED", (error as Error).message);
  }
  const file = await readUtf8File(filePath, root.root);
  const block = renderRequirementBlock({ ...input, id });
  const insertLine = findRequirementsAppendLine(file.lines);
  const lines = insertLine > file.lines.length ? ["", ...block] : [...block, ""];
  const plan = createPatchPlan(file, [{ type: "insertLines", line: insertLine, lines }]);
  const applied = await applyPatchPlan(plan, { dryRun: input.dryRun ?? false });
  return {
    ok: true,
    value: {
      requirementId: id,
      filePath: file.relativePath,
      written: applied.written,
      record: buildOutputRecord(input, id, file.relativePath)
    },
    diagnostics: [],
    patch: summarizePatch(plan, input.dryRun ?? false)
  };
}
