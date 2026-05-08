import type { Diagnostic, ParsedWorkspace } from "../types.js";

export type ValidationRule = (workspace: ParsedWorkspace) => Diagnostic[];

const rules: ValidationRule[] = [];

export function registerValidationRule(rule: ValidationRule): void {
  rules.push(rule);
}

export function clearValidationRules(): void {
  rules.length = 0;
}

export function runValidationRules(workspace: ParsedWorkspace): Diagnostic[] {
  return rules.flatMap((rule) => rule(workspace));
}
