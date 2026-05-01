import type { DiagnosticBag, JsonValue } from "../core/dto.js";
import { type WorkspacePath } from "./path.js";
export type LoadedYamlDocument = {
    path: string;
    raw: string;
    value: JsonValue | undefined;
    diagnostics: DiagnosticBag;
};
export declare function loadYamlDocument(path: WorkspacePath): Promise<LoadedYamlDocument>;
//# sourceMappingURL=yaml-loader.d.ts.map