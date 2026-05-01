import { resolve } from "node:path";
import type { ValidateInput } from "./inputs.js";
import type { ValidateResult } from "./dto.js";
import { validationResult } from "./result.js";
import { workspaceRootFromPath } from "../io/workspace.js";
import { loadWorkspaceForValidation, validateRegistry } from "../validate/semantic.js";
import { mergeDiagnosticBags } from "../validate/diagnostics.js";

export async function validateWorkspace(input: ValidateInput = {}): Promise<ValidateResult> {
  const root = workspaceRootFromPath(resolve(input.root ?? process.cwd()));
  const workspace = await loadWorkspaceForValidation(root);
  const registryDiagnostics = validateRegistry(workspace);

  return validationResult(mergeDiagnosticBags(workspace.diagnostics, registryDiagnostics));
}
