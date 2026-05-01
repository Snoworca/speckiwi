const exportDirectories = {
    overview: "",
    srs: "srs",
    prd: "prd",
    technical: "tech",
    adr: "adr"
};
export function renderDocumentMarkdown(document) {
    switch (document.type) {
        case "overview":
            return renderOverview(document);
        case "srs":
            return renderSrs(document);
        case "prd":
            return renderPrd(document);
        case "technical":
            return renderTechnical(document);
        case "adr":
            return renderAdr(document);
        default:
            throw new TypeError(`Document type is not exportable: ${document.type}`);
    }
}
export function renderExportIndex(documents) {
    const groups = [
        { title: "Overview", types: ["overview"] },
        { title: "SRS", types: ["srs"] },
        { title: "PRD", types: ["prd"] },
        { title: "Technical Documents", types: ["technical"] },
        { title: "ADR", types: ["adr"] }
    ];
    const blocks = ["# SpecKiwi Documentation Index"];
    for (const group of groups) {
        const items = documents
            .filter((document) => group.types.includes(document.type))
            .sort(compareDocuments)
            .map((document) => `- [${plainText(document.title ?? document.id)}](${exportPathForDocument(document)})`);
        if (items.length > 0) {
            blocks.push(`## ${group.title}\n\n${items.join("\n")}`);
        }
    }
    if (blocks.length === 1) {
        blocks.push("No exportable documents.");
    }
    return `${blocks.join("\n\n")}\n`;
}
export function renderDiagnosticsSummary(diagnostics) {
    return [
        "<!-- diagnostics-summary",
        `errors: ${diagnostics.summary.errorCount}`,
        `warnings: ${diagnostics.summary.warningCount}`,
        `infos: ${diagnostics.summary.infoCount}`,
        "-->"
    ].join("\n");
}
export function exportPathForDocument(document) {
    if (document.type === "overview") {
        return "overview.md";
    }
    if (document.type !== "srs" && document.type !== "prd" && document.type !== "technical" && document.type !== "adr") {
        throw new TypeError(`Document type is not exportable: ${document.type}`);
    }
    const directory = exportDirectories[document.type];
    const fileName = fileStem(document.path);
    return `${directory}/${fileName}.md`;
}
function renderOverview(document) {
    const value = document.value;
    return joinBlocks([
        `# ${heading(value.title, document.id)}`,
        optionalSection("Summary", stringValue(value.summary)),
        listSection("Goals", arrayObjects(value.goals).map((goal) => `- **${plainText(stringValue(goal.id) ?? "")}** - ${plainText(stringValue(goal.statement) ?? "")}`)),
        listSection("Non-goals", arrayObjects(value.nonGoals).map((goal) => `- **${plainText(stringValue(goal.id) ?? "")}** - ${plainText(stringValue(goal.statement) ?? "")}`)),
        glossarySection(arrayObjects(value.glossary))
    ]);
}
function renderSrs(document) {
    const value = document.value;
    const requirements = arrayObjects(value.requirements).map(renderRequirement).join("\n\n");
    return joinBlocks([
        `# ${heading(value.title, document.id)}`,
        metadataList([
            ["Document ID", document.id],
            ["Scope", stringValue(value.scope)],
            ["Status", stringValue(value.status)]
        ]),
        requirements.length > 0 ? `## Requirements\n\n${requirements}` : "## Requirements\n\nNo requirements."
    ]);
}
function renderPrd(document) {
    const value = document.value;
    const items = arrayObjects(value.items).map(renderPrdItem).join("\n\n");
    return joinBlocks([
        `# ${heading(value.title, document.id)}`,
        metadataList([
            ["Document ID", document.id],
            ["Status", stringValue(value.status)]
        ]),
        items.length > 0 ? `## Items\n\n${items}` : "## Items\n\nNo items."
    ]);
}
function renderTechnical(document) {
    const value = document.value;
    const sections = arrayObjects(value.sections).map(renderTechnicalSection).join("\n\n");
    return joinBlocks([
        `# ${heading(value.title, document.id)}`,
        metadataList([
            ["Document ID", document.id],
            ["Scope", stringValue(value.scope)],
            ["Status", stringValue(value.status)]
        ]),
        listSection("Implements", stringArray(value.implements).map((id) => `- \`${id}\``)),
        sections.length > 0 ? `## Sections\n\n${sections}` : "## Sections\n\nNo sections."
    ]);
}
function renderAdr(document) {
    const value = document.value;
    return joinBlocks([
        `# ${heading(value.title, document.id)}`,
        metadataList([
            ["Document ID", document.id],
            ["Status", stringValue(value.status)],
            ["Date", stringValue(value.date)]
        ]),
        optionalSection("Context", stringValue(value.context)),
        optionalSection("Decision", stringValue(value.decision)),
        listSection("Consequences", stringArray(value.consequences).map((item) => `- ${plainText(item)}`)),
        listSection("Supersedes", stringArray(value.supersedes).map((item) => `- \`${item}\``))
    ]);
}
function renderRequirement(requirement) {
    const lines = [
        `### ${heading(requirement.id, "Requirement")} - ${heading(requirement.title, "Untitled")}`,
        metadataList([
            ["Type", stringValue(requirement.type)],
            ["Status", stringValue(requirement.status)],
            ["Priority", stringValue(requirement.priority)],
            ["Tags", stringArray(requirement.tags).join(", ")]
        ]),
        optionalSection("Statement", stringValue(requirement.statement), 4),
        optionalSection("Rationale", stringValue(requirement.rationale), 4),
        optionalSection("Description", stringValue(requirement.description), 4),
        acceptanceCriteriaSection(arrayObjects(requirement.acceptanceCriteria)),
        relationsSection(arrayObjects(requirement.relations))
    ];
    return joinBlocks(lines);
}
function renderPrdItem(item) {
    return joinBlocks([
        `### ${heading(item.id, "Item")} - ${heading(item.title, "Untitled")}`,
        metadataList([["Type", stringValue(item.type)], ["Tags", stringArray(item.tags).join(", ")]]),
        stringValue(item.body),
        linksSection(arrayObjects(item.links))
    ]);
}
function renderTechnicalSection(section) {
    return joinBlocks([`### ${heading(section.id, "Section")} - ${heading(section.title, "Untitled")}`, stringValue(section.body)]);
}
function optionalSection(title, body, level = 2) {
    return body === undefined || body.length === 0 ? undefined : `${"#".repeat(level)} ${title}\n\n${plainText(body)}`;
}
function listSection(title, items) {
    return items.length === 0 ? undefined : `## ${title}\n\n${items.join("\n")}`;
}
function glossarySection(glossary) {
    if (glossary.length === 0) {
        return undefined;
    }
    return [
        "## Glossary",
        "",
        "| Term | Definition |",
        "|---|---|",
        ...glossary.map((item) => `| ${tableText(stringValue(item.term) ?? "")} | ${tableText(stringValue(item.definition) ?? "")} |`)
    ].join("\n");
}
function acceptanceCriteriaSection(criteria) {
    if (criteria.length === 0) {
        return undefined;
    }
    return [
        "#### Acceptance Criteria",
        "",
        ...criteria.map((criterion, index) => {
            const id = stringValue(criterion.id) ?? `AC-${String(index + 1).padStart(3, "0")}`;
            const method = stringValue(criterion.method);
            const methodText = method === undefined ? "" : ` \`[${method}]\``;
            return `${index + 1}. **${plainText(id)}**${methodText} ${plainText(stringValue(criterion.description) ?? "")}`;
        })
    ].join("\n");
}
function relationsSection(relations) {
    if (relations.length === 0) {
        return undefined;
    }
    return [
        "#### Relations",
        "",
        ...relations.map((relation) => {
            const description = stringValue(relation.description);
            const suffix = description === undefined ? "" : ` - ${plainText(description)}`;
            return `- \`${stringValue(relation.type) ?? "relation"}\`: \`${stringValue(relation.target) ?? ""}\`${suffix}`;
        })
    ].join("\n");
}
function linksSection(links) {
    if (links.length === 0) {
        return undefined;
    }
    return [
        "#### Links",
        "",
        ...links.map((link) => {
            const description = stringValue(link.description);
            const suffix = description === undefined ? "" : ` - ${plainText(description)}`;
            return `- \`${stringValue(link.type) ?? "link"}\`: \`${stringValue(link.target) ?? ""}\`${suffix}`;
        })
    ].join("\n");
}
function metadataList(items) {
    const lines = items.filter((item) => item[1] !== undefined && item[1].length > 0).map(([name, value]) => `- ${name}: \`${value}\``);
    return lines.length === 0 ? undefined : lines.join("\n");
}
function joinBlocks(blocks) {
    return `${blocks.filter((block) => block !== undefined && block.trim().length > 0).join("\n\n")}\n`;
}
function heading(value, fallback) {
    return plainText(typeof value === "string" && value.length > 0 ? value : fallback);
}
function plainText(value) {
    return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
}
function tableText(value) {
    return plainText(value).replace(/\|/g, "\\|").replace(/\n/g, "<br>");
}
function fileStem(storePath) {
    const fileName = storePath.split("/").at(-1) ?? storePath;
    return fileName.replace(/\.[^.]+$/, "");
}
function compareDocuments(left, right) {
    return exportPathForDocument(left).localeCompare(exportPathForDocument(right)) || left.id.localeCompare(right.id);
}
function stringValue(value) {
    return typeof value === "string" ? value : undefined;
}
function stringArray(value) {
    return Array.isArray(value) ? value.filter((item) => typeof item === "string").sort() : [];
}
function arrayObjects(value) {
    return Array.isArray(value) ? value.filter(isJsonObject) : [];
}
function isJsonObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
//# sourceMappingURL=templates.js.map