export function renderHuman(result) {
    if (!isObject(result)) {
        return `${String(result)}\n`;
    }
    if (result.ok === false && isObject(result.error)) {
        return `${String(result.error.code)}: ${String(result.error.message)}\n`;
    }
    if (result.ok === false && Array.isArray(result.writtenFiles) && typeof result.outputRoot === "string") {
        return "Markdown export failed\n";
    }
    if ("valid" in result && typeof result.valid === "boolean") {
        return renderValidation(result.valid, diagnosticBag(result.diagnostics));
    }
    if (Array.isArray(result.checks)) {
        return renderDoctor(result.checks.filter(isDoctorCheck));
    }
    if (isObject(result.overview) && isObject(result.project) && isObject(result.stats)) {
        return renderOverview(result);
    }
    if (Array.isArray(result.documents)) {
        return renderDocuments(result.documents.filter(isDocumentSummary));
    }
    if (Array.isArray(result.requirements)) {
        return renderRequirements(result.requirements.filter(isRequirementSummary));
    }
    if (Array.isArray(result.results)) {
        return renderSearchResults(result.results.filter(isSearchResultItem));
    }
    if (Array.isArray(result.writtenFiles) && typeof result.outputRoot === "string") {
        return renderExport(result.outputRoot, result.writtenFiles.filter(isExportedFile));
    }
    if (isObject(result.requirement)) {
        const relations = isObject(result.relations) ? result.relations : {};
        return renderRequirement(result.requirement, Array.isArray(relations.incoming), Array.isArray(relations.outgoing));
    }
    if (typeof result.graphType === "string" && Array.isArray(result.nodes) && Array.isArray(result.edges)) {
        return renderGraph(result.graphType, result.nodes.filter(isGraphNode), result.edges.filter(isGraphEdge));
    }
    if (Array.isArray(result.impacted)) {
        return renderImpact(String(result.requirementId ?? result.root ?? ""), result.impacted.filter(isImpactItem));
    }
    return "OK\n";
}
export function renderDiagnosticsForStderr(diagnostics) {
    if (diagnostics === undefined || diagnostics.summary.errorCount + diagnostics.summary.warningCount === 0) {
        return "";
    }
    return [
        ...diagnostics.errors.map((diagnostic) => formatDiagnostic("ERROR", diagnostic)),
        ...diagnostics.warnings.map((diagnostic) => formatDiagnostic("WARN", diagnostic))
    ].join("");
}
function renderValidation(valid, diagnostics) {
    if (valid) {
        return "SpecKiwi validation passed\n";
    }
    return `SpecKiwi validation failed\n${renderDiagnosticsForStderr(diagnostics)}`;
}
function renderDoctor(checks) {
    const lines = ["SpecKiwi doctor"];
    for (const check of checks) {
        lines.push(`${check.status.toUpperCase().padEnd(7)} ${check.id} ${check.message ?? check.title}`);
    }
    return `${lines.join("\n")}\n`;
}
function renderOverview(result) {
    const project = result.project;
    const overview = result.overview;
    const stats = result.stats;
    return [
        `${String(project.name ?? project.id ?? "SpecKiwi")}`,
        `${String(overview.title ?? overview.id ?? "overview")}`,
        typeof overview.summary === "string" ? overview.summary : "",
        `Documents: ${String(stats.documents ?? 0)}  Scopes: ${String(stats.scopes ?? 0)}  Requirements: ${String(stats.requirements ?? 0)}`
    ]
        .filter((line) => line.length > 0)
        .join("\n")
        .concat("\n");
}
function renderDocuments(documents) {
    return table(["ID", "TYPE", "SCOPE", "PATH"], documents.map((document) => [document.id, document.type, document.scope ?? "", document.path]));
}
function renderRequirements(requirements) {
    return table(["ID", "TYPE", "STATUS", "TITLE"], requirements.map((requirement) => [requirement.id, requirement.type, requirement.status, requirement.title]));
}
function renderSearchResults(results) {
    return table(["SCORE", "TYPE", "ID", "PATH"], results.map((result) => [result.score.toFixed(3), result.entityType, result.id, result.path]));
}
function renderRequirement(requirement, hasIncoming, hasOutgoing) {
    const lines = [
        String(requirement.id ?? ""),
        String(requirement.title ?? ""),
        String(requirement.statement ?? "")
    ].filter((line) => line.length > 0);
    if (hasIncoming || hasOutgoing) {
        lines.push("Relations included");
    }
    return `${lines.join("\n")}\n`;
}
function renderGraph(graphType, nodes, edges) {
    return `Graph ${graphType}\nNodes: ${nodes.length}\nEdges: ${edges.length}\n`;
}
function renderImpact(requirementId, impacted) {
    const lines = [`Impact ${requirementId}`, ...impacted.map((item) => `${item.id} depth=${item.depth} via=${item.via.join(" > ")}`)];
    return `${lines.join("\n")}\n`;
}
function renderExport(outputRoot, files) {
    const lines = ["Exported Markdown files:", ...files.map((file) => `  ${joinExportPath(outputRoot, file.path)}`)];
    return `${lines.join("\n")}\n`;
}
function joinExportPath(outputRoot, path) {
    const trimmed = outputRoot.endsWith("/") ? outputRoot.slice(0, -1) : outputRoot;
    return `${trimmed}/${path}`;
}
function table(headers, rows) {
    const widths = headers.map((header, index) => Math.max(header.length, ...rows.map((row) => row[index]?.length ?? 0)));
    const renderRow = (row) => row.map((cell, index) => cell.padEnd(widths[index] ?? 0)).join("  ").trimEnd();
    return `${[renderRow(headers), ...rows.map(renderRow)].join("\n")}\n`;
}
function formatDiagnostic(level, diagnostic) {
    const location = diagnostic.path === undefined ? "" : ` ${diagnostic.path}`;
    return `${level} ${diagnostic.code}${location}\n  ${diagnostic.message}\n`;
}
function diagnosticBag(value) {
    return isObject(value) && isObject(value.summary) && typeof value.summary.errorCount === "number" ? value : undefined;
}
function isDoctorCheck(value) {
    return isObject(value) && typeof value.id === "string" && (value.status === "ok" || value.status === "warning" || value.status === "error");
}
function isDocumentSummary(value) {
    return isObject(value) && typeof value.id === "string" && typeof value.type === "string" && typeof value.path === "string";
}
function isRequirementSummary(value) {
    return isObject(value) && typeof value.id === "string" && typeof value.type === "string" && typeof value.status === "string";
}
function isSearchResultItem(value) {
    return isObject(value) && typeof value.id === "string" && typeof value.entityType === "string" && typeof value.score === "number";
}
function isGraphNode(value) {
    return isObject(value) && typeof value.key === "string" && typeof value.id === "string";
}
function isGraphEdge(value) {
    return isObject(value) && typeof value.key === "string" && typeof value.source === "string" && typeof value.target === "string";
}
function isImpactItem(value) {
    return isObject(value) && typeof value.id === "string" && typeof value.depth === "number" && Array.isArray(value.via);
}
function isExportedFile(value) {
    return isObject(value) && typeof value.path === "string";
}
function isObject(value) {
    return typeof value === "object" && value !== null;
}
//# sourceMappingURL=human-renderer.js.map