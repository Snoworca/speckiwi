import type { RequirementRelation } from "../core/dto.js";
import type { RequirementRegistry } from "../core/requirements.js";
declare const RELATION_INDEX_FORMAT = "speckiwi/relations/v1";
export type RelationIndexV1 = {
    format: typeof RELATION_INDEX_FORMAT;
    incoming: Array<[requirementId: string, relations: RequirementRelation[]]>;
    outgoing: Array<[requirementId: string, relations: RequirementRelation[]]>;
};
export type RuntimeRelationIndex = RelationIndexV1 & {
    incomingById: Map<string, RequirementRelation[]>;
    outgoingById: Map<string, RequirementRelation[]>;
};
export declare function buildRelationIndex(registry: RequirementRegistry): RelationIndexV1;
export declare function deserializeRelationIndex(value: unknown): RuntimeRelationIndex | undefined;
export {};
//# sourceMappingURL=relations.d.ts.map