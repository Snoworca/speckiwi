import { assertExplicitRequirementId, previewRequirementId } from "./requirements.js";
export function previewRequirementCreationId(input, registry) {
    return previewRequirementId(input, registry);
}
export function validateExplicitRequirementId(id, registry) {
    return assertExplicitRequirementId(id, registry);
}
//# sourceMappingURL=requirement-create.js.map