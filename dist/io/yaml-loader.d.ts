import type { DiagnosticBag, JsonValue } from "../core/dto.js";
import { type RealPathGuard, type WorkspacePath } from "./path.js";
export type LoadedYamlDocument = {
    path: string;
    raw: string;
    value: JsonValue | undefined;
    diagnostics: DiagnosticBag;
};
export declare function loadYamlDocument(path: WorkspacePath, guard?: RealPathGuard): Promise<LoadedYamlDocument>;
//# sourceMappingURL=yaml-loader.d.ts.map