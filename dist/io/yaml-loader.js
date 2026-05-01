import { readFile } from "node:fs/promises";
import { LineCounter, isAlias, isPair, isScalar, parseDocument, visit } from "yaml";
import { createDiagnosticBag } from "../core/result.js";
import { assertRealPathInsideWorkspace } from "./path.js";
export async function loadYamlDocument(path) {
    await assertRealPathInsideWorkspace(path);
    const raw = await readFile(path.absolutePath, "utf8");
    const lineCounter = new LineCounter();
    const document = parseDocument(raw, {
        version: "1.2",
        schema: "core",
        merge: false,
        strict: true,
        uniqueKeys: true,
        stringKeys: true,
        prettyErrors: true,
        lineCounter,
        logLevel: "silent"
    });
    const diagnostics = [
        ...document.errors.map((error) => ({
            severity: "error",
            code: `YAML_${error.code}`,
            message: error.message,
            path: path.storePath,
            ...positionFromYamlError(error)
        })),
        ...document.warnings.map((warning) => ({
            severity: "warning",
            code: `YAML_${warning.code}`,
            message: warning.message,
            path: path.storePath,
            ...positionFromYamlError(warning)
        })),
        ...findSubsetDiagnostics(document.contents, path.storePath, lineCounter)
    ];
    const bag = createDiagnosticBag(diagnostics);
    return {
        path: path.storePath,
        raw,
        value: bag.summary.errorCount === 0 ? toJsonValue(document.toJS({ maxAliasCount: 0 })) : undefined,
        diagnostics: bag
    };
}
function findSubsetDiagnostics(contents, path, lineCounter) {
    const diagnostics = [];
    visit(contents, {
        Node(_key, node) {
            if ("anchor" in node && typeof node.anchor === "string" && node.anchor.length > 0) {
                diagnostics.push({
                    severity: "error",
                    code: "YAML_ANCHOR_FORBIDDEN",
                    message: "YAML anchors are not allowed in SpecKiwi documents.",
                    path,
                    ...positionFromNode(node, lineCounter)
                });
            }
        },
        Alias(_key, node) {
            if (isAlias(node)) {
                diagnostics.push({
                    severity: "error",
                    code: "YAML_ALIAS_FORBIDDEN",
                    message: "YAML aliases are not allowed in SpecKiwi documents.",
                    path,
                    ...positionFromNode(node, lineCounter)
                });
            }
        },
        Pair(_key, pair) {
            if (isPair(pair) && isScalar(pair.key) && pair.key.value === "<<") {
                diagnostics.push({
                    severity: "error",
                    code: "YAML_MERGE_KEY_FORBIDDEN",
                    message: "YAML merge keys are not allowed in SpecKiwi documents.",
                    path,
                    ...positionFromNode(pair.key, lineCounter)
                });
            }
        }
    });
    return diagnostics;
}
function positionFromYamlError(error) {
    const firstPosition = error.linePos?.[0];
    return firstPosition === undefined ? {} : { line: firstPosition.line, column: firstPosition.col };
}
function positionFromNode(node, lineCounter) {
    const range = "range" in node ? node.range : undefined;
    if (range === undefined || range === null) {
        return {};
    }
    const position = lineCounter.linePos(range[0]);
    return position.line === 0 ? {} : { line: position.line, column: position.col };
}
function toJsonValue(value) {
    if (value === null ||
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean") {
        return value;
    }
    if (Array.isArray(value)) {
        return value.map((item) => toJsonValue(item));
    }
    if (typeof value === "object" && value !== null) {
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, toJsonValue(item)]));
    }
    return null;
}
//# sourceMappingURL=yaml-loader.js.map