import type { DiagnosticBag } from "./dto.js";
import type { RequirementRegistry } from "./requirements.js";
import { assertExplicitRequirementId, previewRequirementId } from "./requirements.js";
import type { GenerateRequirementIdInput } from "./inputs.js";

export function previewRequirementCreationId(input: GenerateRequirementIdInput, registry: RequirementRegistry) {
  return previewRequirementId(input, registry);
}

export function validateExplicitRequirementId(id: string, registry: RequirementRegistry): DiagnosticBag {
  return assertExplicitRequirementId(id, registry);
}
