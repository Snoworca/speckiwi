import { loadRequirementRegistry } from "./requirements.js";
import { ok } from "./result.js";
export async function overview(input = {}) {
    const registry = await loadRequirementRegistry(input);
    const overviewDocument = registry.documentsById.get("overview") ?? registry.documents.find((document) => document.type === "overview");
    const value = overviewDocument?.value;
    const project = {
        id: registry.project.id,
        name: registry.project.name ?? registry.project.id
    };
    if (registry.project.language !== undefined) {
        project.language = registry.project.language;
    }
    const overviewPayload = {
        id: overviewDocument?.id ?? "overview",
        title: stringValue(value?.title) ?? overviewDocument?.title ?? "Overview"
    };
    const summary = stringValue(value?.summary);
    if (summary !== undefined) {
        overviewPayload.summary = summary;
    }
    return ok({
        project,
        overview: overviewPayload,
        stats: {
            documents: registry.documents.length,
            scopes: registry.scopes.length,
            requirements: registry.requirements.length
        }
    });
}
function stringValue(value) {
    return typeof value === "string" ? value : undefined;
}
//# sourceMappingURL=overview.js.map