import type { RequirementRelation } from "../core/dto.js";
import type { RequirementRegistry } from "../core/requirements.js";

const RELATION_INDEX_FORMAT = "speckiwi/relations/v1";

export type RelationIndexV1 = {
  format: typeof RELATION_INDEX_FORMAT;
  incoming: Array<[requirementId: string, relations: RequirementRelation[]]>;
  outgoing: Array<[requirementId: string, relations: RequirementRelation[]]>;
};

export type RuntimeRelationIndex = RelationIndexV1 & {
  incomingById: Map<string, RequirementRelation[]>;
  outgoingById: Map<string, RequirementRelation[]>;
};

export function buildRelationIndex(registry: RequirementRegistry): RelationIndexV1 {
  return {
    format: RELATION_INDEX_FORMAT,
    incoming: [...registry.incomingRelationsById.entries()]
      .map(([id, relations]) => [id, relations.map(cloneRelation)] as [string, RequirementRelation[]])
      .sort(compareRelationEntry),
    outgoing: [...registry.outgoingRelationsById.entries()]
      .map(([id, relations]) => [id, relations.map(cloneRelation)] as [string, RequirementRelation[]])
      .sort(compareRelationEntry)
  };
}

export function deserializeRelationIndex(value: unknown): RuntimeRelationIndex | undefined {
  const index = objectValue(value);
  if (index?.format !== RELATION_INDEX_FORMAT || !relationEntryArray(index.incoming) || !relationEntryArray(index.outgoing)) {
    return undefined;
  }

  const incoming = index.incoming.map(([id, relations]) => [id, relations.map(cloneRelation)] as [string, RequirementRelation[]]);
  const outgoing = index.outgoing.map(([id, relations]) => [id, relations.map(cloneRelation)] as [string, RequirementRelation[]]);

  return {
    format: RELATION_INDEX_FORMAT,
    incoming,
    outgoing,
    incomingById: new Map(incoming),
    outgoingById: new Map(outgoing)
  };
}

function relationEntryArray(value: unknown): value is Array<[string, RequirementRelation[]]> {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        Array.isArray(item) &&
        item.length === 2 &&
        typeof item[0] === "string" &&
        Array.isArray(item[1]) &&
        item[1].every(isRelation)
    )
  );
}

function isRelation(value: unknown): value is RequirementRelation {
  const item = objectValue(value);
  return (
    typeof item?.type === "string" &&
    typeof item.target === "string" &&
    (item.source === undefined || typeof item.source === "string") &&
    (item.description === undefined || typeof item.description === "string")
  );
}

function cloneRelation(relation: RequirementRelation): RequirementRelation {
  return {
    type: relation.type,
    target: relation.target,
    ...(relation.source === undefined ? {} : { source: relation.source }),
    ...(relation.description === undefined ? {} : { description: relation.description })
  };
}

function compareRelationEntry(left: [string, RequirementRelation[]], right: [string, RequirementRelation[]]): number {
  return left[0].localeCompare(right[0]);
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}
