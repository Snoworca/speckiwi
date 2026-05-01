import type { DiagnosticBag, DocumentType, JsonObject } from "../core/dto.js";
import { type WorkspaceRoot } from "../io/path.js";
import { type SchemaKind } from "../schema/compile.js";
export type ManifestDocumentEntry = {
    id: string;
    type: DocumentType;
    path: string;
    index: number;
};
export type LoadedSpecDocument = {
    storePath: string;
    raw: string;
    value: JsonObject | undefined;
    schemaKind: SchemaKind | undefined;
    schemaValid: boolean;
    yamlValid: boolean;
};
export type LoadedWorkspace = {
    root: WorkspaceRoot;
    documents: LoadedSpecDocument[];
    manifestEntries: ManifestDocumentEntry[];
    diagnostics: DiagnosticBag;
};
export declare function loadWorkspaceForValidation(root: WorkspaceRoot): Promise<LoadedWorkspace>;
export declare function validateRegistry(workspace: LoadedWorkspace): DiagnosticBag;
//# sourceMappingURL=semantic.d.ts.map