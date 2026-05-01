import type { DiagnosticBag } from "./dto.js";
import type { RequirementRegistry } from "./requirements.js";
import type { GenerateRequirementIdInput } from "./inputs.js";
export declare function previewRequirementCreationId(input: GenerateRequirementIdInput, registry: RequirementRegistry): import("./dto.js").RequirementIdPreviewResult;
export declare function validateExplicitRequirementId(id: string, registry: RequirementRegistry): DiagnosticBag;
//# sourceMappingURL=requirement-create.d.ts.map