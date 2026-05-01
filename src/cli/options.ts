import { resolve } from "node:path";
import type { Command } from "commander";
import type { CacheMode } from "../core/inputs.js";
import { fail } from "../core/result.js";
import { WorkspacePathError } from "../io/path.js";
import { findWorkspaceRoot, WorkspaceDiscoveryError } from "../io/workspace.js";
import { mapCoreResultToExitCode, type CliExitCode } from "./exit-code.js";
import { renderHuman, renderDiagnosticsForStderr } from "./human-renderer.js";
import { renderJson } from "./json-renderer.js";

export type CliContext = {
  root: string;
  cacheMode: CacheMode;
  json: boolean;
  verbose: boolean;
  quiet: boolean;
};

export type CliActionOptions = {
  resolveWorkspace?: boolean;
  exitCode?: (result: unknown) => CliExitCode;
};

export class CliExit extends Error {
  constructor(public readonly exitCode: CliExitCode) {
    super(`CLI exited with ${exitCode}`);
    this.name = "CliExit";
  }
}

export class CliUsageError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "CliUsageError";
  }
}

export function addCommonOptions(command: Command): Command {
  return command
    .option("--root <path>", "workspace root")
    .option("--json", "write a single Core DTO JSON object to stdout")
    .option("--no-cache", "bypass cache reads and writes")
    .option("--verbose", "write diagnostic detail to stderr")
    .option("--quiet", "minimize human-readable output");
}

export function addPaginationOptions(command: Command): Command {
  return command.option("--limit <n>", "maximum result count").option("--offset <n>", "pagination offset");
}

export async function executeCliCommand(
  command: Command,
  action: (context: CliContext) => Promise<unknown>,
  options: CliActionOptions = {}
): Promise<void> {
  const raw = command.optsWithGlobals() as Record<string, unknown>;
  const json = raw.json === true;

  try {
    const context = await buildContext(raw, options.resolveWorkspace ?? true);
    const result = await action(context);
    writeResult(result, json, context.quiet);
    const exitCode = (options.exitCode ?? mapCoreResultToExitCode)(result);
    if (exitCode !== 0) {
      throw new CliExit(exitCode);
    }
  } catch (error) {
    if (error instanceof CliExit) {
      throw error;
    }

    const result = errorResult(error);
    writeResult(result, json, raw.quiet === true);
    const exitCode = mapCoreResultToExitCode(result);
    throw new CliExit(exitCode);
  }
}

export function parseOptionalInteger(value: unknown, name: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    throw new CliUsageError("INVALID_ARGUMENT", `${name} must be a non-negative integer.`);
  }
  return Number.parseInt(value, 10);
}

export function splitComma(value: unknown): string[] | undefined {
  if (typeof value !== "string" || value.trim().length === 0) {
    return undefined;
  }
  return value.split(",").map((item) => item.trim()).filter((item) => item.length > 0);
}

export function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

async function buildContext(raw: Record<string, unknown>, resolveWorkspace: boolean): Promise<CliContext> {
  const rootOption = optionalString(raw.root);
  const root = resolveWorkspace
    ? await findWorkspaceRoot(process.cwd(), rootOption)
    : {
        rootPath: resolve(process.cwd(), rootOption ?? "."),
        speckiwiPath: resolve(process.cwd(), rootOption ?? ".", ".speckiwi"),
        explicit: rootOption !== undefined
      };

  const cacheMode: CacheMode = raw.cache === false ? "bypass" : "auto";
  return {
    root: root.rootPath,
    cacheMode,
    json: raw.json === true,
    verbose: raw.verbose === true,
    quiet: raw.quiet === true
  };
}

function writeResult(result: unknown, json: boolean, quiet: boolean): void {
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

function errorResult(error: unknown): ReturnType<typeof fail> {
  const code = errorCode(error);
  const message = error instanceof Error ? error.message : String(error);
  return fail({ code, message });
}

function errorCode(error: unknown): string {
  if (error instanceof WorkspaceDiscoveryError || error instanceof WorkspacePathError || error instanceof CliUsageError) {
    return error.code;
  }
  return "COMMAND_FAILED";
}

function isDiagnosticBag(value: unknown): value is Parameters<typeof renderDiagnosticsForStderr>[0] {
  return isObject(value) && isObject(value.summary) && typeof value.summary.errorCount === "number";
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
