import { createHash } from "node:crypto";

// @req FR-NODE-240 AC-3, FR-NODE-241 AC-4 — the PRD pointer `<path>@sha256:<hex>`, defined once: the
// writer builds it here and the ledger schema and the cursor read it here, so a pointer the writer
// could not have made is refused rather than read as some other hash.

// `s`: a path is any character run, line and paragraph separators included (U+2028, U+2029 and line
// breaks are legal in file names), so every pointer formatPrdPointer writes parses back.
const POINTER_RE = /^(.+)@sha256:([0-9a-f]{64})$/s;

/** `<path>@sha256:<hex>` over `bytes`, the hex in lower case as sha256 digests are written. */
export function formatPrdPointer(path: string, bytes: Uint8Array): string {
  return `${path}@sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

/** The path and hash of a pointer in the form `formatPrdPointer` writes; undefined for anything else. */
export function parsePrdPointer(pointer: string): { path: string; sha256: string } | undefined {
  const match = POINTER_RE.exec(pointer);
  return match ? { path: match[1]!, sha256: match[2]! } : undefined;
}
