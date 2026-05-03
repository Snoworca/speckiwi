import type { DocumentSummary, JsonObject, RequirementSummary } from "../core/dto.js";
import type { RegisteredScope, RequirementRegistry } from "../core/requirements.js";
declare const ENTITY_INDEX_FORMAT = "speckiwi/entities/v1";
declare const REQUIREMENT_PAYLOAD_SHARD_FORMAT = "speckiwi/requirements-shard/v1";
export type EntityDocumentSummary = DocumentSummary & {
    index: number;
};
export type EntityRequirementSummary = RequirementSummary & {
    ordinal: number;
    documentHash?: string;
};
export type RequirementLookupEntry = [requirementId: string, ordinal: number];
export type DocumentLookupEntry = [documentId: string, ordinal: number];
export type RequirementPayloadShardRef = {
    documentId: string;
    documentPath: string;
    documentHash: string;
    requirementIds: string[];
};
export type RequirementPayloadShardV1 = {
    format: typeof REQUIREMENT_PAYLOAD_SHARD_FORMAT;
    documentId: string;
    documentPath: string;
    documentHash: string;
    requirements: Array<{
        id: string;
        ordinal: number;
        requirement: JsonObject;
    }>;
};
export type EntityIndexV1 = {
    format: typeof ENTITY_INDEX_FORMAT;
    project: RequirementRegistry["project"];
    documents: EntityDocumentSummary[];
    scopes: RegisteredScope[];
    requirements: EntityRequirementSummary[];
    requirementLookup: RequirementLookupEntry[];
    documentLookup: DocumentLookupEntry[];
    requirementPayloadShards: RequirementPayloadShardRef[];
};
export type RuntimeEntityIndex = EntityIndexV1 & {
    documentsById: Map<string, EntityDocumentSummary>;
    requirementsById: Map<string, EntityRequirementSummary>;
    scopesById: Map<string, RegisteredScope>;
    requirementShardsById: Map<string, RequirementPayloadShardRef>;
};
export declare function buildEntityIndex(registry: RequirementRegistry): EntityIndexV1;
export declare function bindRequirementPayloadShards(index: EntityIndexV1, shardRefs: RequirementPayloadShardRef[]): EntityIndexV1;
export declare function buildRequirementPayloadShardRefs(shards: RequirementPayloadShardV1[]): RequirementPayloadShardRef[];
export declare function buildRequirementPayloadShards(registry: RequirementRegistry, documentHashes: Map<string, string>): RequirementPayloadShardV1[];
export declare function deserializeEntityIndex(value: unknown): RuntimeEntityIndex | undefined;
export declare function deserializeRequirementPayloadShard(value: unknown): RequirementPayloadShardV1 | undefined;
export declare function requirementPayloadShardStorePath(documentHash: string): string;
export {};
//# sourceMappingURL=entities.d.ts.map