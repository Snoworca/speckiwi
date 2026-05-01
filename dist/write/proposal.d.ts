import type { JsonObject, ProposalOperation, ProposalResult, ProposalTarget } from "../core/dto.js";
import type { JsonPatchOperation, ProposeChangeInput } from "../core/inputs.js";
import { type StorePath, type WorkspaceRoot } from "../io/path.js";
import { type LoadedYamlDocument } from "../io/yaml-loader.js";
export type ValidWorkspace = WorkspaceRoot;
export type ProposalStatus = "proposed" | "accepted" | "applied" | "rejected" | "superseded";
export type ProposalBaseTarget = {
    entityType: "requirement" | "document" | "manifest";
    jsonPointer: string;
    id?: string;
};
export type ProposalBase = {
    documentPath: string;
    target: ProposalBaseTarget;
    documentHash: string;
    targetHash: string;
    schemaVersion: string;
    generatedAt: string;
    documentId?: string;
};
export type ProposalDocument = {
    schemaVersion: "speckiwi/proposal/v1";
    id: string;
    type: "proposal";
    status: ProposalStatus;
    operation: ProposalOperation;
    target: ProposalTarget;
    base: ProposalBase;
    changes: JsonPatchOperation[];
    reason: string;
    metadata?: JsonObject;
};
export declare function createProposal(input: ProposeChangeInput, workspace?: ValidWorkspace): Promise<ProposalResult>;
export declare function buildProposalDocument(input: ProposeChangeInput, workspace: ValidWorkspace, options?: {
    generatedAt?: string;
}): Promise<ProposalDocument>;
export declare function readProposalAt(root: WorkspaceRoot, storePath: StorePath): Promise<ProposalDocument>;
export declare function loadTargetDocument(root: WorkspaceRoot, storePath: string): Promise<LoadedYamlDocument>;
export declare function currentTargetHash(root: WorkspaceRoot, proposal: ProposalDocument): Promise<string>;
export declare function currentDocumentHash(root: WorkspaceRoot, proposal: ProposalDocument): Promise<string>;
//# sourceMappingURL=proposal.d.ts.map