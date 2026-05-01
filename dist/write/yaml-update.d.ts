import type { JsonValue } from "../core/dto.js";
import type { LoadedYamlDocument } from "../io/yaml-loader.js";
import type { ProposalDocument } from "./proposal.js";
export type UpdatedYamlDocument = {
    path: string;
    value: JsonValue;
    raw: string;
};
export declare function applyProposalToDocument(document: LoadedYamlDocument, proposal: ProposalDocument): UpdatedYamlDocument;
//# sourceMappingURL=yaml-update.d.ts.map