import path from "node:path";
import type { RequirementRecord, TraceLink } from "../types.js";
import { maskInlineComments } from "./document-lines.js";
import { classifyLinkDestination, findMarkdownLinks, resolveRelatedDocsLink } from "./markdown-links.js";

// @req FR-NODE-232 AC-6 — what counts as a file reference of a requirement, in one place: `links
// check` verifies exactly these and renameScope rewrites exactly these, so the two cannot diverge.

export interface FileReference {
  requirementId: string;
  source: "related-docs" | "trace";
  /** As written: a Related Docs link destination, or a Trace Link reference cell. */
  reference: string;
  /** The repository-relative path it names, or the absolute path an absolute link names. */
  path: string;
}

/**
 * Whether the platform's default file system ignores case (Windows, macOS). `links check` asks the
 * file system whether a reference exists, so a path comparison has to ignore case exactly when it does.
 */
const CASE_INSENSITIVE_FILE_SYSTEM = process.platform === "win32" || process.platform === "darwin";

/** Whether two repository-relative paths name the same file. */
export function sameRepositoryPath(
  a: string | undefined,
  b: string | undefined,
  options: { caseInsensitive?: boolean } = {}
): boolean {
  if (a === undefined || b === undefined) return false;
  const left = path.posix.normalize(a);
  const right = path.posix.normalize(b);
  return (options.caseInsensitive ?? CASE_INSENSITIVE_FILE_SYSTEM) ? left.toLowerCase() === right.toLowerCase() : left === right;
}

/**
 * Every inline link destination in the requirement's Related Docs cell, external ones included. A cell
 * is inline content, so only a closed inline comment in it is skipped.
 */
export function relatedDocsDestinations(record: RequirementRecord): string[] {
  return findMarkdownLinks(maskInlineComments(record.metadata["Related Docs"] ?? ""))
    .flatMap((link) => (link.kind === "inline" ? [link.destination.value] : []));
}

/**
 * The file a Related Docs destination names: repository relative, or absolute for an absolute link
 * (`/x`, `C:/x`). External and same-document links name no file.
 */
export function relatedDocsPath(destination: string): string | undefined {
  const classified = classifyLinkDestination(destination);
  if (classified.kind !== "local") return undefined;
  return resolveRelatedDocsLink(destination) ?? classified.path;
}

/** A trailing line designation, in either the dash-range or the colon-column spelling. */
const LINE_SUFFIX = /:\d+(?:[-:]\d+)?$/;
/** A reference that names a file: one token, an extension, no whitespace. */
const REPOSITORY_PATH = /^[A-Za-z0-9_.@/-]+\.[A-Za-z0-9]+$/;

/**
 * FR-NODE-206 — the file one `;`-separated part of a Trace Link reference names, repository relative.
 *
 * Those rows went unread by `links check` whatever they said, which is how a source edit could move a
 * line out from under a designation with nothing reddening. They were not unread altogether: the
 * `traceReference` filter keys on the cell whole, suffix and all, so a suffixed row answered its own
 * exact spelling and nothing else — dropping the suffix put 73 requirements within reach of the path
 * they always named, and cost no row the reference it had. The reference field is not always a path:
 * it also holds a task id, a requirement id and a sentence, so a candidate has to look like a file
 * before it is resolved as one — an extension is what separates `read.ts` from `T-PH001-02`.
 *
 * The line suffix goes before the path does, following what release readiness does with the
 * Verification Evidence reference — a different field, so a precedent rather than a second reader of
 * this one — because what this reports is whether the path resolves and not whether the line still
 * holds what the row describes. Resolution is exact from the workspace root and never by basename:
 * falling back to a basename search silently resolved twenty designations at a path no branch has
 * ever held onto a different file and scored them fresh.
 */
export function traceReferencePath(part: string): string | undefined {
  const candidate = part.trim().replace(/#.*$/, "").replace(LINE_SUFFIX, "");
  return REPOSITORY_PATH.test(candidate) ? candidate : undefined;
}

/** The files a Trace Link of a type other than Requirement names. */
export function traceLinkPaths(trace: TraceLink): string[] {
  if (trace.type === "Requirement") return [];
  return trace.reference.split(";").flatMap((part) => {
    const referenced = traceReferencePath(part);
    return referenced === undefined ? [] : [referenced];
  });
}

/** Every file reference of the requirement: its Related Docs files and its Trace Link paths. */
export function fileReferences(record: RequirementRecord): FileReference[] {
  const related = relatedDocsDestinations(record).flatMap((destination) => {
    const target = relatedDocsPath(destination);
    return target === undefined ? [] : [{ requirementId: record.id, source: "related-docs" as const, reference: destination, path: target }];
  });
  const traced = record.traceLinks.flatMap((trace) =>
    traceLinkPaths(trace).map((target) => ({
      requirementId: record.id,
      source: "trace" as const,
      reference: trace.reference,
      path: path.posix.normalize(target)
    }))
  );
  return [...related, ...traced];
}
