// @req IR-CLI-118 — the input check a deferred mutation must pass before replay applies anything.
//
// A lane records its four SRS mutations into a queue instead of calling them (FR-FLOW-121), so no
// caller is alive to correct an input when the host replays it. Replay therefore runs, on every
// remaining call and before the first is applied, the same SRS-free refusals each mutation runs on
// itself — and, first, the shape check MCP enforces on a live call (FR-NODE-281 AC-7 refuses an
// undeclared argument there), because a queue is a file and its arguments arrive untyped.

import { completedWorkInputRefusal } from "../mutation/add-completed-work.js";
import { evidenceInputRefusal } from "../mutation/add-evidence.js";
import { traceLinkInputRefusal } from "../mutation/add-trace.js";
import { statusInputRefusal } from "../mutation/update-status.js";
import type { MutationResult } from "../types.js";
import type { DEFERRABLE_MUTATION_TOOLS } from "./replay-admission.js";

interface InputRule {
  readonly required: readonly string[];
  /** Text the mutation reads with `??`, so null means absent. */
  readonly optionalText: readonly string[];
  /** Text the mutation reads only when it is not `undefined`, so null would reach it. */
  readonly optionalStrictText: readonly string[];
  readonly optionalTextLists: readonly string[];
  readonly optionalFlags: readonly string[];
  readonly refusal: (input: never) => MutationResult | undefined;
}

const FLAGS = ["dryRun", "ignoreLock"] as const;

/** Keyed by the allowlist itself, so a fifth deferrable tool cannot be added without its rule. */
const RULES: Readonly<Record<(typeof DEFERRABLE_MUTATION_TOOLS)[number], InputRule>> = {
  add_trace_link: {
    required: ["id", "type", "reference", "relation"],
    optionalText: ["notes"],
    optionalStrictText: [],
    optionalTextLists: [],
    optionalFlags: FLAGS,
    refusal: traceLinkInputRefusal
  },
  add_verification_evidence: {
    required: ["id", "type", "reference"],
    optionalText: ["covers", "notes"],
    optionalStrictText: [],
    optionalTextLists: [],
    optionalFlags: FLAGS,
    refusal: evidenceInputRefusal
  },
  update_status: {
    required: ["id", "status"],
    optionalText: [],
    optionalStrictText: ["reason"],
    optionalTextLists: [],
    optionalFlags: FLAGS,
    refusal: statusInputRefusal
  },
  add_completed_work: {
    required: ["date", "summary"],
    optionalText: ["target", "scope"],
    optionalStrictText: [],
    optionalTextLists: ["requirementIds", "reportPaths"],
    optionalFlags: ["allowIncomplete", ...FLAGS],
    refusal: completedWorkInputRefusal
  }
};

function ruleOf(tool: string): InputRule | undefined {
  return (RULES as Readonly<Record<string, InputRule | undefined>>)[tool];
}

/** Every argument name the tool declares; a queued call naming another is refused. @req IR-CLI-118 AC-6 */
export function deferrableMutationArgumentNames(tool: string): readonly string[] {
  const rule = ruleOf(tool);
  if (rule === undefined) return [];
  return [...rule.required, ...rule.optionalText, ...rule.optionalStrictText, ...rule.optionalTextLists, ...rule.optionalFlags];
}

function shapeProblems(tool: string, rule: InputRule, args: Record<string, unknown>): string[] {
  const declared = new Set(deferrableMutationArgumentNames(tool));
  const problems = Object.keys(args)
    .filter((name) => !declared.has(name))
    .map((name) => `${name} is not an argument of ${tool}`);
  const present = (field: string): boolean => args[field] !== undefined && args[field] !== null;
  problems.push(...rule.required.filter((field) => typeof args[field] !== "string").map((field) => `${field} must be a string`));
  for (const field of rule.optionalText) {
    if (present(field) && typeof args[field] !== "string") problems.push(`${field} must be a string`);
  }
  for (const field of rule.optionalStrictText) {
    if (args[field] !== undefined && typeof args[field] !== "string") problems.push(`${field} must be a string`);
  }
  for (const field of rule.optionalTextLists) {
    const value = args[field];
    if (present(field) && !(Array.isArray(value) && value.every((item) => typeof item === "string"))) problems.push(`${field} must be a list of strings`);
  }
  for (const field of rule.optionalFlags) {
    if (present(field) && typeof args[field] !== "boolean") problems.push(`${field} must be true or false`);
  }
  return problems;
}

/**
 * The message the call's own mutation would refuse it with before reading the SRS, or null when it
 * would not. A tool with no rule here is not deferrable; admission refuses it, so it is not judged.
 */
export function deferrableMutationInputRefusal(tool: string, args: unknown): string | null {
  const rule = ruleOf(tool);
  if (rule === undefined) return null;
  if (typeof args !== "object" || args === null || Array.isArray(args)) return `${tool} arguments must be a JSON object`;
  const problems = shapeProblems(tool, rule, args as Record<string, unknown>);
  if (problems.length > 0) return `${tool} arguments: ${problems.join("; ")}`;
  const refused = rule.refusal(args as never);
  return refused === undefined || refused.ok ? null : (refused.error?.message ?? `${tool} input refused`);
}
