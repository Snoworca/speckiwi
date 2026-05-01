import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";

export type SpeckiwiResourceUri =
  | { kind: "overview"; uri: "speckiwi://overview" }
  | { kind: "index"; uri: "speckiwi://index" }
  | { kind: "document"; uri: string; id: string }
  | { kind: "requirement"; uri: string; id: string }
  | { kind: "scope"; uri: string; id: string };

export function parseSpeckiwiResourceUri(uri: string): SpeckiwiResourceUri {
  const match = /^speckiwi:\/\/([^/?#]+)(?:\/([^?#]*))?$/.exec(uri);
  if (match === null) {
    throw malformedResourceUri(uri);
  }

  const authority = match[1];
  const rawId = match[2];

  if ((authority === "overview" || authority === "index") && (rawId === undefined || rawId === "")) {
    return authority === "overview" ? { kind: "overview", uri: "speckiwi://overview" } : { kind: "index", uri: "speckiwi://index" };
  }

  if (authority === "documents" || authority === "requirements" || authority === "scopes") {
    const id = decodeAndValidateId(rawId, uri);
    if (authority === "documents") {
      return { kind: "document", uri, id };
    }
    if (authority === "requirements") {
      return { kind: "requirement", uri, id };
    }
    return { kind: "scope", uri, id };
  }

  throw unknownResourceUri(uri);
}

export function malformedResourceUri(uri: string): McpError {
  return new McpError(ErrorCode.InvalidParams, `Malformed SpecKiwi resource URI: ${uri}`, { uri });
}

export function unknownResourceUri(uri: string): McpError {
  return new McpError(-32002, `Unknown SpecKiwi resource URI: ${uri}`, { uri });
}

function decodeAndValidateId(rawId: string | undefined, uri: string): string {
  if (rawId === undefined || rawId.length === 0) {
    throw malformedResourceUri(uri);
  }

  let decoded: string;
  try {
    decoded = decodeURIComponent(rawId);
  } catch {
    throw malformedResourceUri(uri);
  }

  if (
    decoded.length === 0 ||
    decoded.includes("/") ||
    decoded.includes("\\") ||
    decoded.includes("\0") ||
    decoded.includes("..")
  ) {
    throw malformedResourceUri(uri);
  }

  return decoded;
}
