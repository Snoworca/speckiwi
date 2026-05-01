import { McpError } from "@modelcontextprotocol/sdk/types.js";
export type SpeckiwiResourceUri = {
    kind: "overview";
    uri: "speckiwi://overview";
} | {
    kind: "index";
    uri: "speckiwi://index";
} | {
    kind: "document";
    uri: string;
    id: string;
} | {
    kind: "requirement";
    uri: string;
    id: string;
} | {
    kind: "scope";
    uri: string;
    id: string;
};
export declare function parseSpeckiwiResourceUri(uri: string): SpeckiwiResourceUri;
export declare function malformedResourceUri(uri: string): McpError;
export declare function unknownResourceUri(uri: string): McpError;
//# sourceMappingURL=resource-uri.d.ts.map