import { summarizeDiagnostics } from "../core/diagnostic.js";
import type { Diagnostic } from "../core/types.js";
import type { CliIo } from "./index.js";
import { writeJson } from "./formatters.js";

export interface CliRecoveryHint {
  command: string;
  message?: string;
}

export interface CliStructuredError {
  ok: false;
  error: {
    code: string;
    message: string;
  };
  diagnostics: Diagnostic[];
  diagnosticsSummary: ReturnType<typeof summarizeDiagnostics>;
  recovery?: CliRecoveryHint;
}

export function cliStructuredError(code: string, message: string, options: { diagnostics?: Diagnostic[]; recovery?: CliRecoveryHint } = {}): CliStructuredError {
  const diagnostics = options.diagnostics ?? [];
  return {
    ok: false,
    error: { code, message },
    diagnostics,
    diagnosticsSummary: summarizeDiagnostics(diagnostics),
    ...(options.recovery ? { recovery: options.recovery } : {})
  };
}

export function writeCliStructuredError(io: CliIo, code: string, message: string, options: { diagnostics?: Diagnostic[]; recovery?: CliRecoveryHint } = {}): void {
  writeJson(io, cliStructuredError(code, message, options));
}

export function readRecoveryForCommand(commandName: string): CliRecoveryHint {
  if (commandName === "show") return { command: "search", message: "Search for the requirement ID or title, then retry show with the exact ID." };
  if (commandName === "summary") return { command: "targets", message: "List registered targets before requesting a target summary." };
  if (commandName === "search") return { command: "search", message: "Retry search with valid filters and pagination options." };
  if (commandName === "active-target") return { command: "active-target", message: "Inspect the active target before selecting target-scoped work." };
  return { command: "list", message: "List requirements with valid filters before retrying the read command." };
}
