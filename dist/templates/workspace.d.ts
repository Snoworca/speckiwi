import type { InitInput } from "../core/inputs.js";
export declare const WORKSPACE_DIRECTORIES: readonly ["prd", "srs", "tech", "adr", "rules", "proposals", "templates", "cache", "exports"];
export type WorkspaceTemplateFile = {
    path: string;
    content: string;
};
export type WorkspaceTemplate = {
    directories: readonly string[];
    files: WorkspaceTemplateFile[];
};
export declare function createWorkspaceTemplate(input?: Pick<InitInput, "projectId" | "projectName" | "language">): WorkspaceTemplate;
//# sourceMappingURL=workspace.d.ts.map