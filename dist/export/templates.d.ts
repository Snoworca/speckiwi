import type { DiagnosticBag, DocumentSummary, JsonObject } from "../core/dto.js";
export type ContentDocument = DocumentSummary & {
    value: JsonObject;
};
export declare function renderDocumentMarkdown(document: ContentDocument): string;
export declare function renderExportIndex(documents: DocumentSummary[]): string;
export declare function renderDiagnosticsSummary(diagnostics: DiagnosticBag): string;
export declare function exportPathForDocument(document: Pick<DocumentSummary, "type" | "path">): string;
//# sourceMappingURL=templates.d.ts.map