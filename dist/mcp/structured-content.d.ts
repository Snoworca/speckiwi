import { z } from "zod";
import type { MachineResult } from "../core/dto.js";
export declare const diagnosticBagOutputSchema: z.ZodObject<{
    errors: z.ZodArray<z.ZodObject<{
        code: z.ZodString;
        message: z.ZodString;
        severity: z.ZodEnum<{
            error: "error";
            warning: "warning";
            info: "info";
        }>;
        path: z.ZodOptional<z.ZodString>;
        line: z.ZodOptional<z.ZodNumber>;
        column: z.ZodOptional<z.ZodNumber>;
        details: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodType<unknown, unknown, z.core.$ZodTypeInternals<unknown, unknown>>>>;
    }, z.core.$loose>>;
    warnings: z.ZodArray<z.ZodObject<{
        code: z.ZodString;
        message: z.ZodString;
        severity: z.ZodEnum<{
            error: "error";
            warning: "warning";
            info: "info";
        }>;
        path: z.ZodOptional<z.ZodString>;
        line: z.ZodOptional<z.ZodNumber>;
        column: z.ZodOptional<z.ZodNumber>;
        details: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodType<unknown, unknown, z.core.$ZodTypeInternals<unknown, unknown>>>>;
    }, z.core.$loose>>;
    infos: z.ZodArray<z.ZodObject<{
        code: z.ZodString;
        message: z.ZodString;
        severity: z.ZodEnum<{
            error: "error";
            warning: "warning";
            info: "info";
        }>;
        path: z.ZodOptional<z.ZodString>;
        line: z.ZodOptional<z.ZodNumber>;
        column: z.ZodOptional<z.ZodNumber>;
        details: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodType<unknown, unknown, z.core.$ZodTypeInternals<unknown, unknown>>>>;
    }, z.core.$loose>>;
    summary: z.ZodObject<{
        errorCount: z.ZodNumber;
        warningCount: z.ZodNumber;
        infoCount: z.ZodNumber;
    }, z.core.$loose>;
}, z.core.$loose>;
export declare const machineResultOutputSchema: z.ZodObject<{
    ok: z.ZodBoolean;
    diagnostics: z.ZodObject<{
        errors: z.ZodArray<z.ZodObject<{
            code: z.ZodString;
            message: z.ZodString;
            severity: z.ZodEnum<{
                error: "error";
                warning: "warning";
                info: "info";
            }>;
            path: z.ZodOptional<z.ZodString>;
            line: z.ZodOptional<z.ZodNumber>;
            column: z.ZodOptional<z.ZodNumber>;
            details: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodType<unknown, unknown, z.core.$ZodTypeInternals<unknown, unknown>>>>;
        }, z.core.$loose>>;
        warnings: z.ZodArray<z.ZodObject<{
            code: z.ZodString;
            message: z.ZodString;
            severity: z.ZodEnum<{
                error: "error";
                warning: "warning";
                info: "info";
            }>;
            path: z.ZodOptional<z.ZodString>;
            line: z.ZodOptional<z.ZodNumber>;
            column: z.ZodOptional<z.ZodNumber>;
            details: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodType<unknown, unknown, z.core.$ZodTypeInternals<unknown, unknown>>>>;
        }, z.core.$loose>>;
        infos: z.ZodArray<z.ZodObject<{
            code: z.ZodString;
            message: z.ZodString;
            severity: z.ZodEnum<{
                error: "error";
                warning: "warning";
                info: "info";
            }>;
            path: z.ZodOptional<z.ZodString>;
            line: z.ZodOptional<z.ZodNumber>;
            column: z.ZodOptional<z.ZodNumber>;
            details: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodType<unknown, unknown, z.core.$ZodTypeInternals<unknown, unknown>>>>;
        }, z.core.$loose>>;
        summary: z.ZodObject<{
            errorCount: z.ZodNumber;
            warningCount: z.ZodNumber;
            infoCount: z.ZodNumber;
        }, z.core.$loose>;
    }, z.core.$loose>;
}, z.core.$loose>;
export declare const machineErrorOutputSchema: z.ZodObject<{
    ok: z.ZodLiteral<false>;
    diagnostics: z.ZodObject<{
        errors: z.ZodArray<z.ZodObject<{
            code: z.ZodString;
            message: z.ZodString;
            severity: z.ZodEnum<{
                error: "error";
                warning: "warning";
                info: "info";
            }>;
            path: z.ZodOptional<z.ZodString>;
            line: z.ZodOptional<z.ZodNumber>;
            column: z.ZodOptional<z.ZodNumber>;
            details: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodType<unknown, unknown, z.core.$ZodTypeInternals<unknown, unknown>>>>;
        }, z.core.$loose>>;
        warnings: z.ZodArray<z.ZodObject<{
            code: z.ZodString;
            message: z.ZodString;
            severity: z.ZodEnum<{
                error: "error";
                warning: "warning";
                info: "info";
            }>;
            path: z.ZodOptional<z.ZodString>;
            line: z.ZodOptional<z.ZodNumber>;
            column: z.ZodOptional<z.ZodNumber>;
            details: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodType<unknown, unknown, z.core.$ZodTypeInternals<unknown, unknown>>>>;
        }, z.core.$loose>>;
        infos: z.ZodArray<z.ZodObject<{
            code: z.ZodString;
            message: z.ZodString;
            severity: z.ZodEnum<{
                error: "error";
                warning: "warning";
                info: "info";
            }>;
            path: z.ZodOptional<z.ZodString>;
            line: z.ZodOptional<z.ZodNumber>;
            column: z.ZodOptional<z.ZodNumber>;
            details: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodType<unknown, unknown, z.core.$ZodTypeInternals<unknown, unknown>>>>;
        }, z.core.$loose>>;
        summary: z.ZodObject<{
            errorCount: z.ZodNumber;
            warningCount: z.ZodNumber;
            infoCount: z.ZodNumber;
        }, z.core.$loose>;
    }, z.core.$loose>;
    error: z.ZodObject<{
        code: z.ZodString;
        message: z.ZodString;
        details: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodType<unknown, unknown, z.core.$ZodTypeInternals<unknown, unknown>>>>;
    }, z.core.$loose>;
}, z.core.$loose>;
export declare const overviewOutputSchema: z.ZodType<unknown, unknown, z.core.$ZodTypeInternals<unknown, unknown>>;
export declare const listDocumentsOutputSchema: z.ZodType<unknown, unknown, z.core.$ZodTypeInternals<unknown, unknown>>;
export declare const readDocumentOutputSchema: z.ZodType<unknown, unknown, z.core.$ZodTypeInternals<unknown, unknown>>;
export declare const searchOutputSchema: z.ZodType<unknown, unknown, z.core.$ZodTypeInternals<unknown, unknown>>;
export declare const getRequirementOutputSchema: z.ZodType<unknown, unknown, z.core.$ZodTypeInternals<unknown, unknown>>;
export declare const listRequirementsOutputSchema: z.ZodType<unknown, unknown, z.core.$ZodTypeInternals<unknown, unknown>>;
export declare const previewRequirementIdOutputSchema: z.ZodType<unknown, unknown, z.core.$ZodTypeInternals<unknown, unknown>>;
export declare const graphOutputSchema: z.ZodType<unknown, unknown, z.core.$ZodTypeInternals<unknown, unknown>>;
export declare const traceOutputSchema: z.ZodType<unknown, unknown, z.core.$ZodTypeInternals<unknown, unknown>>;
export declare const impactOutputSchema: z.ZodType<unknown, unknown, z.core.$ZodTypeInternals<unknown, unknown>>;
export declare const validateOutputSchema: z.ZodObject<{
    ok: z.ZodBoolean;
    valid: z.ZodOptional<z.ZodBoolean>;
    diagnostics: z.ZodObject<{
        errors: z.ZodArray<z.ZodObject<{
            code: z.ZodString;
            message: z.ZodString;
            severity: z.ZodEnum<{
                error: "error";
                warning: "warning";
                info: "info";
            }>;
            path: z.ZodOptional<z.ZodString>;
            line: z.ZodOptional<z.ZodNumber>;
            column: z.ZodOptional<z.ZodNumber>;
            details: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodType<unknown, unknown, z.core.$ZodTypeInternals<unknown, unknown>>>>;
        }, z.core.$loose>>;
        warnings: z.ZodArray<z.ZodObject<{
            code: z.ZodString;
            message: z.ZodString;
            severity: z.ZodEnum<{
                error: "error";
                warning: "warning";
                info: "info";
            }>;
            path: z.ZodOptional<z.ZodString>;
            line: z.ZodOptional<z.ZodNumber>;
            column: z.ZodOptional<z.ZodNumber>;
            details: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodType<unknown, unknown, z.core.$ZodTypeInternals<unknown, unknown>>>>;
        }, z.core.$loose>>;
        infos: z.ZodArray<z.ZodObject<{
            code: z.ZodString;
            message: z.ZodString;
            severity: z.ZodEnum<{
                error: "error";
                warning: "warning";
                info: "info";
            }>;
            path: z.ZodOptional<z.ZodString>;
            line: z.ZodOptional<z.ZodNumber>;
            column: z.ZodOptional<z.ZodNumber>;
            details: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodType<unknown, unknown, z.core.$ZodTypeInternals<unknown, unknown>>>>;
        }, z.core.$loose>>;
        summary: z.ZodObject<{
            errorCount: z.ZodNumber;
            warningCount: z.ZodNumber;
            infoCount: z.ZodNumber;
        }, z.core.$loose>;
    }, z.core.$loose>;
    error: z.ZodOptional<z.ZodObject<{
        code: z.ZodString;
        message: z.ZodString;
        details: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodType<unknown, unknown, z.core.$ZodTypeInternals<unknown, unknown>>>>;
    }, z.core.$loose>>;
}, z.core.$loose>;
export declare const proposeOutputSchema: z.ZodType<unknown, unknown, z.core.$ZodTypeInternals<unknown, unknown>>;
export declare const applyOutputSchema: z.ZodType<unknown, unknown, z.core.$ZodTypeInternals<unknown, unknown>>;
export declare function toolOutputSchemaFor(name: string): z.ZodTypeAny;
export type McpStructuredResult = {
    structuredContent: Record<string, unknown>;
    content: Array<{
        type: "text";
        text: string;
    }>;
    isError?: true;
};
export declare function toStructuredContent<T extends MachineResult>(result: T): Record<string, unknown>;
export declare function toMcpToolResult<T extends MachineResult>(result: T): McpStructuredResult;
//# sourceMappingURL=structured-content.d.ts.map