import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createDiagnosticBag, ok } from "./result.js";
import { workspaceRootFromPath } from "../io/workspace.js";
import { loadWorkspaceForValidation, validateRegistry } from "../validate/semantic.js";
import { buildCacheInputs, isCacheStale, readCacheManifest } from "../cache/manifest.js";
import { mergeDiagnosticBags } from "../validate/diagnostics.js";
export async function doctor(input = {}) {
    const root = workspaceRootFromPath(resolve(input.root ?? process.cwd()));
    const checks = [];
    checks.push(nodeVersionCheck());
    checks.push(await packageVersionCheck(root.rootPath));
    const workspaceExists = await pathExists(root.speckiwiPath);
    checks.push({
        id: "workspace",
        title: ".speckiwi workspace",
        status: workspaceExists ? "ok" : "error",
        message: workspaceExists ? `.speckiwi found at ${root.speckiwiPath}.` : `.speckiwi not found at ${root.rootPath}.`,
        diagnostics: workspaceExists ? [] : [diagnostic("MISSING_WORKSPACE", "Missing .speckiwi directory.")]
    });
    checks.push(await requiredFilesCheck(root.speckiwiPath));
    if (!workspaceExists) {
        checks.push({
            id: "yaml_parse",
            title: "YAML parse",
            status: "error",
            message: "YAML parsing skipped because the .speckiwi workspace is missing.",
            diagnostics: [diagnostic("MISSING_WORKSPACE", "Cannot parse YAML without a .speckiwi workspace.")]
        });
        checks.push({
            id: "schema_validation",
            title: "Schema and semantic validation",
            status: "error",
            message: "Schema validation skipped because the .speckiwi workspace is missing.",
            diagnostics: [diagnostic("MISSING_WORKSPACE", "Cannot validate schemas without a .speckiwi workspace.")]
        });
        checks.push({
            id: "cache_state",
            title: "Cache state",
            status: "warning",
            message: "Cache check skipped because the .speckiwi workspace is missing.",
            diagnostics: [diagnostic("CACHE_CHECK_SKIPPED", "Cache check skipped because the workspace is missing.", "warning")]
        });
        checks.push(await mcpBinaryCheck());
        checks.push({
            id: "stdout_policy",
            title: "stdout policy",
            status: "ok",
            message: "CLI JSON output is routed through the single-object JSON renderer.",
            diagnostics: []
        });
        checks.push(stdioPolicyCheck());
        return ok({ checks }, createDiagnosticBag(checks.flatMap((check) => check.diagnostics)));
    }
    const workspace = await loadWorkspaceForValidation(root);
    const registryDiagnostics = validateRegistry(workspace);
    const diagnostics = mergeDiagnosticBags(workspace.diagnostics, registryDiagnostics);
    const yamlDiagnostics = [...diagnostics.errors, ...diagnostics.warnings].filter((item) => item.code.startsWith("YAML_"));
    const semanticErrors = diagnostics.errors.filter((item) => !item.code.startsWith("YAML_"));
    checks.push({
        id: "yaml_parse",
        title: "YAML parse",
        status: yamlDiagnostics.some((item) => item.severity === "error") ? "error" : "ok",
        message: yamlDiagnostics.length === 0 ? "YAML files parsed successfully." : "YAML diagnostics were found.",
        diagnostics: yamlDiagnostics
    });
    checks.push({
        id: "schema_validation",
        title: "Schema and semantic validation",
        status: semanticErrors.length > 0 ? "error" : diagnostics.warnings.length > 0 ? "warning" : "ok",
        message: semanticErrors.length > 0 ? "Validation errors were found." : "Schema and semantic validation completed.",
        diagnostics: [...semanticErrors, ...diagnostics.warnings]
    });
    checks.push(await cacheCheck(root, workspace));
    checks.push(await mcpBinaryCheck());
    checks.push({
        id: "stdout_policy",
        title: "stdout policy",
        status: "ok",
        message: "CLI JSON output is routed through the single-object JSON renderer.",
        diagnostics: []
    });
    checks.push(stdioPolicyCheck());
    return ok({ checks }, createDiagnosticBag(checks.flatMap((check) => check.diagnostics)));
}
function nodeVersionCheck() {
    const major = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
    const okVersion = major >= 20;
    return {
        id: "node_version",
        title: "Node.js version",
        status: okVersion ? "ok" : "error",
        message: `Node.js ${process.versions.node}.`,
        diagnostics: okVersion ? [] : [diagnostic("NODE_VERSION_UNSUPPORTED", "Node.js >=20 is required.")]
    };
}
async function packageVersionCheck(rootPath) {
    for (const path of [resolve(rootPath, "package.json"), resolve(process.cwd(), "package.json")]) {
        try {
            const parsed = JSON.parse(await readFile(path, "utf8"));
            if (typeof parsed.version === "string") {
                return {
                    id: "package_version",
                    title: "Package version",
                    status: "ok",
                    message: `speckiwi ${parsed.version}.`,
                    diagnostics: []
                };
            }
        }
        catch {
            continue;
        }
    }
    return {
        id: "package_version",
        title: "Package version",
        status: "warning",
        message: "package.json version could not be read.",
        diagnostics: [diagnostic("PACKAGE_VERSION_MISSING", "package.json version could not be read.", "warning")]
    };
}
async function requiredFilesCheck(speckiwiPath) {
    const missing = [];
    for (const file of ["index.yaml", "overview.yaml"]) {
        if (!(await pathExists(resolve(speckiwiPath, file)))) {
            missing.push(diagnostic("MISSING_REQUIRED_FILE", `Missing .speckiwi/${file}.`, "error", `.speckiwi/${file}`));
        }
    }
    return {
        id: "required_files",
        title: "Required workspace files",
        status: missing.length === 0 ? "ok" : "error",
        message: missing.length === 0 ? "Required workspace files are present." : "Required workspace files are missing.",
        diagnostics: missing
    };
}
async function cacheCheck(root, workspace) {
    const manifest = await readCacheManifest(root);
    const stale = isCacheStale(manifest, await buildCacheInputs(root, workspace));
    return {
        id: "cache_state",
        title: "Cache state",
        status: stale ? "warning" : "ok",
        message: manifest === undefined ? "Cache manifest is missing." : stale ? "Cache is stale." : "Cache is current.",
        diagnostics: stale ? [diagnostic("CACHE_STALE", "Cache manifest is missing or stale.", "warning")] : []
    };
}
async function mcpBinaryCheck() {
    const exists = await pathExists(resolve(process.cwd(), "bin", "speckiwi"));
    return {
        id: "mcp_binary",
        title: "MCP binary path",
        status: exists ? "ok" : "warning",
        message: exists ? "bin/speckiwi is present." : "bin/speckiwi was not found from the package root.",
        diagnostics: exists ? [] : [diagnostic("MCP_BINARY_MISSING", "bin/speckiwi was not found.", "warning")]
    };
}
function stdioPolicyCheck() {
    return {
        id: "stdio_policy",
        title: "stdout/stderr policy",
        status: "ok",
        message: "MCP stdio reserves stdout for protocol frames; CLI diagnostics are rendered on stderr.",
        diagnostics: []
    };
}
async function pathExists(path) {
    try {
        await access(path);
        return true;
    }
    catch {
        return false;
    }
}
function diagnostic(code, message, severity = "error", path) {
    const output = { code, message, severity };
    if (path !== undefined) {
        output.path = path;
    }
    return output;
}
//# sourceMappingURL=doctor.js.map