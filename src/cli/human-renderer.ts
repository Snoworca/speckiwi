import type {
  Diagnostic,
  DiagnosticBag,
  DoctorCheck,
  DocumentSummary,
  GraphEdge,
  GraphNode,
  ImpactItem,
  RequirementSummary,
  SearchResultItem
} from "../core/dto.js";

export function renderHuman(result: unknown): string {
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

export function renderDiagnosticsForStderr(diagnostics: DiagnosticBag | undefined): string {
  if (diagnostics === undefined || diagnostics.summary.errorCount + diagnostics.summary.warningCount === 0) {
    return "";
  }

  return [
    ...diagnostics.errors.map((diagnostic) => formatDiagnostic("ERROR", diagnostic)),
    ...diagnostics.warnings.map((diagnostic) => formatDiagnostic("WARN", diagnostic))
  ].join("");
}

function renderValidation(valid: boolean, diagnostics: DiagnosticBag | undefined): string {
  if (valid) {
    return "SpecKiwi validation passed\n";
  }

  return `SpecKiwi validation failed\n${renderDiagnosticsForStderr(diagnostics)}`;
}

function renderDoctor(checks: DoctorCheck[]): string {
  const lines = ["SpecKiwi doctor"];
  for (const check of checks) {
    lines.push(`${check.status.toUpperCase().padEnd(7)} ${check.id} ${check.message ?? check.title}`);
  }
  return `${lines.join("\n")}\n`;
}

function renderOverview(result: Record<string, unknown>): string {
  const project = result.project as Record<string, unknown>;
  const overview = result.overview as Record<string, unknown>;
  const stats = result.stats as Record<string, unknown>;
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

function renderDocuments(documents: DocumentSummary[]): string {
  return table(
    ["ID", "TYPE", "SCOPE", "PATH"],
    documents.map((document) => [document.id, document.type, document.scope ?? "", document.path])
  );
}

function renderRequirements(requirements: RequirementSummary[]): string {
  return table(
    ["ID", "TYPE", "STATUS", "TITLE"],
    requirements.map((requirement) => [requirement.id, requirement.type, requirement.status, requirement.title])
  );
}

function renderSearchResults(results: SearchResultItem[]): string {
  return table(
    ["SCORE", "TYPE", "ID", "PATH"],
    results.map((result) => [result.score.toFixed(3), result.entityType, result.id, result.path])
  );
}

function renderRequirement(requirement: Record<string, unknown>, hasIncoming: boolean, hasOutgoing: boolean): string {
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

function renderGraph(graphType: string, nodes: GraphNode[], edges: GraphEdge[]): string {
  return `Graph ${graphType}\nNodes: ${nodes.length}\nEdges: ${edges.length}\n`;
}

function renderImpact(requirementId: string, impacted: ImpactItem[]): string {
  const lines = [`Impact ${requirementId}`, ...impacted.map((item) => `${item.id} depth=${item.depth} via=${item.via.join(" > ")}`)];
  return `${lines.join("\n")}\n`;
}

function renderExport(outputRoot: string, files: Array<{ path: string }>): string {
  const lines = ["Exported Markdown files:", ...files.map((file) => `  ${joinExportPath(outputRoot, file.path)}`)];
  return `${lines.join("\n")}\n`;
}

function joinExportPath(outputRoot: string, path: string): string {
  const trimmed = outputRoot.endsWith("/") ? outputRoot.slice(0, -1) : outputRoot;
  return `${trimmed}/${path}`;
}

function table(headers: string[], rows: string[][]): string {
  const widths = headers.map((header, index) => Math.max(header.length, ...rows.map((row) => row[index]?.length ?? 0)));
  const renderRow = (row: string[]) => row.map((cell, index) => cell.padEnd(widths[index] ?? 0)).join("  ").trimEnd();
  return `${[renderRow(headers), ...rows.map(renderRow)].join("\n")}\n`;
}

function formatDiagnostic(level: string, diagnostic: Diagnostic): string {
  const location = diagnostic.path === undefined ? "" : ` ${diagnostic.path}`;
  return `${level} ${diagnostic.code}${location}\n  ${diagnostic.message}\n`;
}

function diagnosticBag(value: unknown): DiagnosticBag | undefined {
  return isObject(value) && isObject(value.summary) && typeof value.summary.errorCount === "number" ? (value as DiagnosticBag) : undefined;
}

function isDoctorCheck(value: unknown): value is DoctorCheck {
  return isObject(value) && typeof value.id === "string" && (value.status === "ok" || value.status === "warning" || value.status === "error");
}

function isDocumentSummary(value: unknown): value is DocumentSummary {
  return isObject(value) && typeof value.id === "string" && typeof value.type === "string" && typeof value.path === "string";
}

function isRequirementSummary(value: unknown): value is RequirementSummary {
  return isObject(value) && typeof value.id === "string" && typeof value.type === "string" && typeof value.status === "string";
}

function isSearchResultItem(value: unknown): value is SearchResultItem {
  return isObject(value) && typeof value.id === "string" && typeof value.entityType === "string" && typeof value.score === "number";
}

function isGraphNode(value: unknown): value is GraphNode {
  return isObject(value) && typeof value.key === "string" && typeof value.id === "string";
}

function isGraphEdge(value: unknown): value is GraphEdge {
  return isObject(value) && typeof value.key === "string" && typeof value.source === "string" && typeof value.target === "string";
}

function isImpactItem(value: unknown): value is ImpactItem {
  return isObject(value) && typeof value.id === "string" && typeof value.depth === "number" && Array.isArray(value.via);
}

function isExportedFile(value: unknown): value is { path: string } {
  return isObject(value) && typeof value.path === "string";
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
