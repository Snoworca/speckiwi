import { resolve } from "node:path";
import type { ValidateInput } from "./inputs.js";
import type { Diagnostic, ValidateResult } from "./dto.js";
import { createDiagnosticBag, validationResult } from "./result.js";
import { WorkspacePathError } from "../io/path.js";
import { workspaceRootFromPath } from "../io/workspace.js";
import { loadWorkspaceForValidation, validateRegistry } from "../validate/semantic.js";
import { mergeDiagnosticBags } from "../validate/diagnostics.js";

export async function validateWorkspace(input: ValidateInput = {}): Promise<ValidateResult> {
  const root = workspaceRootFromPath(resolve(input.root ?? process.cwd()));
  try {
    const workspace = await loadWorkspaceForValidation(root);
    const registryDiagnostics = validateRegistry(workspace);

    return validationResult(mergeDiagnosticBags(workspace.diagnostics, registryDiagnostics));
  } catch (error) {
    if (error instanceof WorkspacePathError) {
      return validationResult(createDiagnosticBag([workspacePathDiagnostic(error)]));
    }
    throw error;
  }
}

function workspacePathDiagnostic(error: WorkspacePathError): Diagnostic {
  return {
    severity: "error",
    code: error.code,
    message: error.message,
    details: { boundary: "workspace" }
  };
}
