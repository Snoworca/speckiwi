export declare const exitCodes: {
    readonly success: 0;
    readonly error: 1;
    readonly validation: 2;
    readonly workspaceNotFound: 3;
    readonly invalidArgument: 4;
    readonly applyRejected: 5;
};
export type CliExitCode = (typeof exitCodes)[keyof typeof exitCodes];
export declare function mapCoreResultToExitCode(result: unknown): CliExitCode;
export declare function mapErrorCode(code: string): CliExitCode;
export declare function validationExitCode(result: unknown): CliExitCode;
export declare function doctorExitCode(result: unknown): CliExitCode;
//# sourceMappingURL=exit-code.d.ts.map