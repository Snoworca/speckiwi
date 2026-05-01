import type { ValidateFunction } from "ajv";
import type { Diagnostic, DiagnosticBag, DocumentType } from "../core/dto.js";
export type SchemaKind = DocumentType | "index" | "proposal";
export type SchemaRegistry = Record<SchemaKind, ValidateFunction>;
export declare function compileSchemas(): SchemaRegistry;
export declare function validateAgainstSchema(kind: SchemaKind, value: unknown): DiagnosticBag;
export declare function validateAgainstSchemaDiagnostics(kind: SchemaKind, value: unknown, path?: string): Diagnostic[];
export declare function schemaKindFromVersion(schemaVersion: unknown): SchemaKind | undefined;
export declare function isSchemaKind(value: unknown): value is SchemaKind;
//# sourceMappingURL=compile.d.ts.map