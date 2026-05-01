import { resolve } from "node:path";
import { validationResult } from "./result.js";
import { workspaceRootFromPath } from "../io/workspace.js";
import { loadWorkspaceForValidation, validateRegistry } from "../validate/semantic.js";
import { mergeDiagnosticBags } from "../validate/diagnostics.js";
export async function validateWorkspace(input = {}) {
    const root = workspaceRootFromPath(resolve(input.root ?? process.cwd()));
    const workspace = await loadWorkspaceForValidation(root);
    const registryDiagnostics = validateRegistry(workspace);
    return validationResult(mergeDiagnosticBags(workspace.diagnostics, registryDiagnostics));
}
//# sourceMappingURL=validate.js.map