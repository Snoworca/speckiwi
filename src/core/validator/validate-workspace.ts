import { splitDiagnostics } from "../diagnostic.js";
import type { ParsedWorkspace, ValidationResult } from "../types.js";
import { clearValidationRules, runValidationRules } from "./rule-registry.js";
import { registerDefaultRules } from "./rules.js";

export function validateWorkspace(workspace: ParsedWorkspace): ValidationResult {
  clearValidationRules();
  registerDefaultRules();
  return splitDiagnostics(runValidationRules(workspace));
}
