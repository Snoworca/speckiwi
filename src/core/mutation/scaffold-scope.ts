import { writeFile } from "node:fs/promises";
import path from "node:path";
import {
  isScopeDocumentPath,
  nextScopeDocumentNumber,
  parseScopeOption,
  renderEmptyScopeTemplate,
  scopeDocumentName,
  type ScopeTemplateInfo
} from "../bootstrap/templates.js";
import { applyPatchPlan } from "../patch/apply-patch.js";
import { createPatchPlan, type PatchOperation } from "../patch/patch-plan.js";
import { parseWorkspace } from "../parser/workspace-parser.js";
import type {
  MutationResult,
  ProjectRoot,
  ScaffoldScopeInput,
  ScaffoldScopeOutput,
  TextFile
} from "../types.js";

export type { ScaffoldScopeInput, ScaffoldScopeOutput } from "../types.js";
import { mutationFail, mutationOk } from "./guards.js";
import { withSrsMutationLock } from "./srs-lock.js";

// @req FR-NODE-065

/**
 * FR-NODE-065 — render an index row for the new scope. Both the §2 SRS Documents and the §4
 * Scope Map sections share the `| Scope | Document | Prefix | Description |` shape, so the Document
 * cell is a markdown link to the bare file name (matching the init scaffold rows) and the row names
 * the document once with its prefix.
 * @req FR-NODE-065
 */
function renderScopeRow(scope: ScopeTemplateInfo, document: string): string {
  return `| ${scope.name} | [${document}](./${document}) | ${scope.prefix} | ${scope.name} |`;
}

/**
 * FR-NODE-065 — locate the line after the last table row of an index section so a new row is
 * appended without disturbing any existing line. Scans from the `## N. <heading>` line for the
 * table rows and returns the line just past the final consecutive table row.
 * @req FR-NODE-065
 */
function findSectionInsertionLine(file: TextFile, heading: RegExp): number | undefined {
  const headingLine = file.lines.findIndex((line) => heading.test(line.trim()));
  if (headingLine < 0) return undefined;
  let lastTableLine: number | undefined;
  for (let i = headingLine + 1; i < file.lines.length; i += 1) {
    const text = file.lines[i] ?? "";
    if (/^##\s/.test(text)) break;
    if (text.trim().startsWith("|")) lastTableLine = i + 1;
  }
  return lastTableLine === undefined ? undefined : lastTableLine + 1;
}

const SRS_DOCUMENTS_HEADING = /^##\s+\d+\.\s+SRS Documents$/;
const SCOPE_MAP_HEADING = /^##\s+\d+\.\s+Scope Map$/;

/**
 * FR-NODE-065 — scaffoldScope core mutation. Creates a new numbered scope srs.md file from the
 * scope template and registers it in the index in one operation: one row added to the §2 SRS
 * Documents section and one row to the §4 Scope Map section. It defaults to dry-run (no apply
 * flag), returning a preview of the file body and both index rows while writing nothing. A name
 * or prefix that collides with an already-registered scope returns ok false and writes no file.
 * Unlike registerScopes (FR-NODE-064), which only adds Scope Map rows for already-existing
 * unregistered documents, scaffoldScope creates a brand-new document and registers it in both
 * index sections.
 * @req FR-NODE-065
 */
export async function scaffoldScope(
  root: ProjectRoot,
  input: ScaffoldScopeInput
): Promise<MutationResult<ScaffoldScopeOutput>> {
  // @req FR-NODE-088 AC-6 — allocation reads the existing documents and then writes a new one, so
  // without the SRS mutation lock two concurrent calls both read the same highest number and both
  // claim it. The number the requirement says can never collide is exactly what collides.
  return withSrsMutationLock(root, { operation: "scaffold_scope", ignoreLock: input.ignoreLock }, () =>
    scaffoldScopeUnlocked(root, input)
  );
}

async function scaffoldScopeUnlocked(
  root: ProjectRoot,
  input: ScaffoldScopeInput
): Promise<MutationResult<ScaffoldScopeOutput>> {
  const dryRun = input.apply !== true;
  const workspace = await parseWorkspace(root);
  const indexFile: TextFile | undefined = workspace.files[0];
  if (!indexFile) return mutationFail("NOT_FOUND", "00.index.md not found");

  const scope = parseScopeOption(`${input.name}:${input.prefix}`);

  // Reject a name or prefix that collides with an already-registered scope.
  const nameKey = scope.name.trim().toLowerCase();
  const prefixKey = scope.prefix.trim().toUpperCase();
  const collides = workspace.index.scopes.some(
    (entry) => entry.scope.trim().toLowerCase() === nameKey || entry.prefix.trim().toUpperCase() === prefixKey
  );
  if (collides) {
    return mutationFail("MUTATION_DENIED", `Scope name "${scope.name}" or prefix "${scope.prefix}" already registered`);
  }

  // FR-NODE-088 AC-2/AC-6 — one above the highest number already on disk, so the new document never
  // claims a number an existing document uses and never skips ahead by a decade.
  // Only scope documents drive allocation. The tool's own sidecars sit in a reserved high band
  // (90.appendix.md, 91.completed-work-log.md); counting them would push a project's second scope
  // document to 92. A consumer sidecar that does collide is reported by SRS-W070 instead.
  const existingDocuments = workspace.files.map((file) => file.relativePath).filter(isScopeDocumentPath);
  const document = scopeDocumentName(scope.slug, nextScopeDocumentNumber(existingDocuments));
  const documentScope: ScopeTemplateInfo = { name: scope.name, prefix: scope.prefix, document };
  const filePreview = renderEmptyScopeTemplate(documentScope);
  const srsDocumentsRow = renderScopeRow(documentScope, document);
  const scopeMapRow = renderScopeRow(documentScope, document);

  const output: ScaffoldScopeOutput = { dryRun, document, filePreview, srsDocumentsRow, scopeMapRow };
  if (dryRun) return mutationOk(output);

  const documentsInsertLine = findSectionInsertionLine(indexFile, SRS_DOCUMENTS_HEADING);
  const scopeMapInsertLine = findSectionInsertionLine(indexFile, SCOPE_MAP_HEADING);
  if (documentsInsertLine === undefined || scopeMapInsertLine === undefined) {
    return mutationFail("MUTATION_DENIED", "SRS Documents or Scope Map table not found in 00.index.md");
  }

  const newDocumentPath = path.join(path.dirname(indexFile.path), document);
  // The template is joined with LF; write it in the workspace's own line ending so the new document
  // does not arrive with a body that disagrees with every file beside it.
  const body = filePreview.split("\n").join(indexFile.newline);
  await writeFile(newDocumentPath, `${body}${indexFile.newline}`, "utf8");

  // Both rows insert into the same index file. The patch planner applies operations in
  // descending line order, so the two insertions do not shift each other's target line.
  const operations: PatchOperation[] = [
    { type: "insertLines", line: documentsInsertLine, lines: [srsDocumentsRow] },
    { type: "insertLines", line: scopeMapInsertLine, lines: [scopeMapRow] }
  ];
  const plan = createPatchPlan(indexFile, operations);
  await applyPatchPlan(plan, { dryRun: false });

  return mutationOk(output);
}
