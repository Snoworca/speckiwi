import type { Command } from "commander";
import type { CacheMode } from "../core/inputs.js";
import { type CliExitCode } from "./exit-code.js";
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
export declare class CliExit extends Error {
    readonly exitCode: CliExitCode;
    constructor(exitCode: CliExitCode);
}
export declare class CliUsageError extends Error {
    readonly code: string;
    constructor(code: string, message: string);
}
export declare function addCommonOptions(command: Command): Command;
export declare function addPaginationOptions(command: Command): Command;
export declare function executeCliCommand(command: Command, action: (context: CliContext) => Promise<unknown>, options?: CliActionOptions): Promise<void>;
export declare function parseOptionalInteger(value: unknown, name: string): number | undefined;
export declare function splitComma(value: unknown): string[] | undefined;
export declare function optionalString(value: unknown): string | undefined;
//# sourceMappingURL=options.d.ts.map