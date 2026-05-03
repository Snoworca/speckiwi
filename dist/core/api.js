import { resolve } from "node:path";
import { applyChange } from "./apply-change.js";
import { cleanCache, rebuildCache } from "./cache.js";
import { listDocuments, readDocument } from "./documents.js";
import { doctor } from "./doctor.js";
import { exportMarkdown } from "./export-markdown.js";
import { initWorkspace } from "./init.js";
import { overview } from "./overview.js";
import { createProposal } from "./propose-change.js";
import { getRequirement, getRequirementFromReadModel, listRequirementsFromReadModel, loadRequirementRegistry, previewRequirementId } from "./requirements.js";
import { loadReadModel } from "./read-model.js";
import { searchWorkspace } from "./search.js";
import { validateWorkspace } from "./validate.js";
import { impactRequirement } from "../graph/impact.js";
import { traceRequirement } from "../graph/trace.js";
export function createSpecKiwiCore(input) {
    const root = resolve(input.root);
    const cacheMode = input.cacheMode ?? "auto";
    function bind(value) {
        return {
            ...stripUndefined(value ?? {}),
            root,
            cacheMode: value?.cacheMode ?? cacheMode
        };
    }
    async function graph(inputValue = {}) {
        const model = await loadReadModel({
            root,
            cacheMode: inputValue.cacheMode ?? cacheMode,
            sections: ["graph"]
        });
        return model.buildGraph(inputValue.graphType);
    }
    async function search(inputValue) {
        return searchWorkspace(bind(inputValue));
    }
    async function listRequirementsWithModel(inputValue = {}) {
        const model = await loadReadModel({
            root,
            cacheMode: inputValue.cacheMode ?? cacheMode,
            sections: ["entities", "relations"]
        });
        return listRequirementsFromReadModel(bind(inputValue), model);
    }
    return {
        root,
        cacheMode,
        init: (value = {}) => initWorkspace(bind(value)),
        doctor: (value = {}) => doctor(bind(value)),
        cacheRebuild: (value = {}) => rebuildCache(bind(value)),
        cacheClean: (value = {}) => cleanCache(bind(value)),
        exportMarkdown: (value = {}) => exportMarkdown(bind(value)),
        overview: (value = {}) => overview(bind(value)),
        listDocuments: (value = {}) => listDocuments(bind(value)),
        readDocument: (value) => readDocument(bind(value)),
        search,
        getRequirement: async (value) => {
            const bound = bind(value);
            if (bound.cacheMode === "bypass") {
                const model = await loadReadModel({
                    root,
                    cacheMode: bound.cacheMode,
                    sections: ["entities", "relations"]
                });
                return getRequirementFromReadModel(bound, model);
            }
            return getRequirement(bound);
        },
        listRequirements: listRequirementsWithModel,
        previewRequirementId: async (value) => previewRequirementId(bind(value), await loadRequirementRegistry({ root, cacheMode: value.cacheMode ?? cacheMode })),
        traceRequirement: async (value) => traceRequirement(bind(value), await graph({ graphType: "traceability", cacheMode: value.cacheMode ?? cacheMode })),
        graph,
        impact: async (value) => impactRequirement(bind(value), await graph({ graphType: "traceability", cacheMode: value.cacheMode ?? cacheMode })),
        validate: (value = {}) => validateWorkspace(bind(value)),
        proposeChange: (value) => createProposal(bind(value)),
        applyChange: (value) => applyChange(bind(value)),
        loadRequirementRegistry: async () => {
            const model = await loadReadModel({ root, cacheMode, sections: ["entities", "relations"] });
            return model.getRequirementRegistry();
        }
    };
}
function stripUndefined(value) {
    const output = {};
    for (const [key, entry] of Object.entries(value)) {
        if (entry !== undefined) {
            output[key] = entry;
        }
    }
    return output;
}
//# sourceMappingURL=api.js.map