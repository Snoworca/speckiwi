import { resolve } from "node:path";
import { fail } from "../core/result.js";
import { WorkspacePathError } from "../io/path.js";
import { findWorkspaceRoot, WorkspaceDiscoveryError } from "../io/workspace.js";
import { mapCoreResultToExitCode } from "./exit-code.js";
import { renderHuman, renderDiagnosticsForStderr } from "./human-renderer.js";
import { renderJson } from "./json-renderer.js";
export class CliExit extends Error {
    exitCode;
    constructor(exitCode) {
        super(`CLI exited with ${exitCode}`);
        this.exitCode = exitCode;
        this.name = "CliExit";
    }
}
export class CliUsageError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = "CliUsageError";
    }
}
export function addCommonOptions(command) {
    return command
        .option("--root <path>", "workspace root")
        .option("--json", "write a single Core DTO JSON object to stdout")
        .option("--no-cache", "bypass cache reads and writes")
        .option("--verbose", "write diagnostic detail to stderr")
        .option("--quiet", "minimize human-readable output");
}
export function addPaginationOptions(command) {
    return command.option("--limit <n>", "maximum result count").option("--offset <n>", "pagination offset");
}
export async function executeCliCommand(command, action, options = {}) {
    const raw = command.optsWithGlobals();
    const json = raw.json === true;
    try {
        const context = await buildContext(raw, options.resolveWorkspace ?? true);
        const result = await action(context);
        writeResult(result, json, context.quiet);
        const exitCode = (options.exitCode ?? mapCoreResultToExitCode)(result);
        if (exitCode !== 0) {
            throw new CliExit(exitCode);
        }
    }
    catch (error) {
        if (error instanceof CliExit) {
            throw error;
        }
        const result = errorResult(error);
        writeResult(result, json, raw.quiet === true);
        const exitCode = mapCoreResultToExitCode(result);
        throw new CliExit(exitCode);
    }
}
export function parseOptionalInteger(value, name) {
    if (value === undefined) {
        return undefined;
    }
    if (typeof value !== "string" || !/^\d+$/.test(value)) {
        throw new CliUsageError("INVALID_ARGUMENT", `${name} must be a non-negative integer.`);
    }
    return Number.parseInt(value, 10);
}
export function splitComma(value) {
    if (typeof value !== "string" || value.trim().length === 0) {
        return undefined;
    }
    return value.split(",").map((item) => item.trim()).filter((item) => item.length > 0);
}
export function optionalString(value) {
    return typeof value === "string" && value.length > 0 ? value : undefined;
}
async function buildContext(raw, resolveWorkspace) {
    const rootOption = optionalString(raw.root);
    const root = resolveWorkspace
        ? await findWorkspaceRoot(process.cwd(), rootOption)
        : {
            rootPath: resolve(process.cwd(), rootOption ?? "."),
            speckiwiPath: resolve(process.cwd(), rootOption ?? ".", ".speckiwi"),
            explicit: rootOption !== undefined
        };
    const cacheMode = raw.cache === false ? "bypass" : "auto";
    return {
        root: root.rootPath,
        cacheMode,
        json: raw.json === true,
        verbose: raw.verbose === true,
        quiet: raw.quiet === true
    };
}
function writeResult(result, json, quiet) {
    if (json) {
        process.stdout.write(renderJson(result));
        return;
    }
    if (!quiet) {
        process.stdout.write(renderHuman(result));
    }
    const diagnostics = isObject(result) && isDiagnosticBag(result.diagnostics) ? result.diagnostics : undefined;
    const stderr = renderDiagnosticsForStderr(diagnostics);
    if (stderr.length > 0) {
        process.stderr.write(stderr);
    }
}
function errorResult(error) {
    const code = errorCode(error);
    const message = error instanceof Error ? error.message : String(error);
    return fail({ code, message });
}
function errorCode(error) {
    if (error instanceof WorkspaceDiscoveryError || error instanceof WorkspacePathError || error instanceof CliUsageError) {
        return error.code;
    }
    return "COMMAND_FAILED";
}
function isDiagnosticBag(value) {
    return isObject(value) && isObject(value.summary) && typeof value.summary.errorCount === "number";
}
function isObject(value) {
    return typeof value === "object" && value !== null;
}
//# sourceMappingURL=options.js.map