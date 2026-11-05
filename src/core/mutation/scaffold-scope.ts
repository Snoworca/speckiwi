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
import { assertSingleLine } from "./block-prose.js";
import { mutationFail, mutationOk } from "./guards.js";
import { readScopeIndexTable, renderScopeIndexRow, type ScopeRowFields } from "./scope-index-table.js";
import { withSrsMutationLock } from "./srs-lock.js";

// @req FR-NODE-065

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
  // @req FR-NODE-271 AC-1 AC-2 AC-3 — a preview takes no lock: a real one writes the status cache
  // saying it is held and, since the preview writes nothing, never refreshes it after release.
  // The CLI folds --dry-run into apply, so `apply` alone covers every preview form.
  return withSrsMutationLock(root, { operation: "scaffold_scope", dryRun: input.apply !== true, ignoreLock: input.ignoreLock }, () =>
    scaffoldScopeUnlocked(root, input)
  );
}

async function scaffoldScopeUnlocked(
  root: ProjectRoot,
  input: ScaffoldScopeInput
): Promise<MutationResult<ScaffoldScopeOutput>> {
  const dryRun = input.apply !== true;
  // The name is interpolated into `# ${name}` and into two index table rows, so a newline in it
  // lands document structure at column zero. Measured: a name carrying a `### FR-ZZZ-001` block with
  // `| Status | verified |` minted the same forged record twice, once per interpolation site.
  const nameOnOneLine = assertSingleLine<ScaffoldScopeOutput>("scope name", input.name);
  if (nameOnOneLine) return nameOnOneLine;
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
  // FR-NODE-097 — only scope documents raise the starting candidate, but every document in docs/spec
  // can push it forward. Counting the sidecars as the highest would send a project's second scope
  // document to 92; landing on one of their numbers would produce a document SRS-W072 reports.
  const existingDocuments = workspace.files.map((file) => file.relativePath).filter(isScopeDocumentPath);
  const document = scopeDocumentName(
    scope.slug,
    nextScopeDocumentNumber(existingDocuments, workspace.specDocuments ?? existingDocuments)
  );
  const documentScope: ScopeTemplateInfo = { name: scope.name, prefix: scope.prefix, document };
  const filePreview = renderEmptyScopeTemplate(documentScope);
  const documentsTable = readScopeIndexTable(indexFile, "srs-documents");
  const scopeMapTable = readScopeIndexTable(indexFile, "scope-map");
  if (documentsTable === undefined || scopeMapTable === undefined) {
    return mutationFail("MUTATION_DENIED", "SRS Documents or Scope Map table not found in 00.index.md");
  }
  // @req FR-NODE-233 AC-1 — each section's row follows that section's own header.
  const fields: ScopeRowFields = { scope: scope.name, document: `[${document}](./${document})`, prefix: scope.prefix, description: scope.name };
  const srsDocumentsRow = renderScopeIndexRow(documentsTable.headers, fields);
  const scopeMapRow = renderScopeIndexRow(scopeMapTable.headers, fields);
  if (!srsDocumentsRow.ok) return mutationFail("MUTATION_DENIED", `SRS Documents row: ${srsDocumentsRow.error.message}`);
  if (!scopeMapRow.ok) return mutationFail("MUTATION_DENIED", `Scope Map row: ${scopeMapRow.error.message}`);

  const output: ScaffoldScopeOutput = {
    dryRun,
    document,
    filePreview,
    srsDocumentsRow: srsDocumentsRow.value,
    scopeMapRow: scopeMapRow.value,
    written: false
  };
  if (dryRun) return mutationOk(output);

  const newDocumentPath = path.join(path.dirname(indexFile.path), document);
  // The template is joined with LF; write it in the workspace's own line ending so the new document
  // does not arrive with a body that disagrees with every file beside it.
  const body = filePreview.split("\n").join(indexFile.newline);
  await writeFile(newDocumentPath, `${body}${indexFile.newline}`, "utf8");

  // Both rows insert into the same index file. The patch planner applies operations in
  // descending line order, so the two insertions do not shift each other's target line.
  const operations: PatchOperation[] = [
    { type: "insertLines", line: documentsTable.insertLine, lines: [srsDocumentsRow.value] },
    { type: "insertLines", line: scopeMapTable.insertLine, lines: [scopeMapRow.value] }
  ];
  const plan = createPatchPlan(indexFile, operations);
  await applyPatchPlan(plan, { dryRun: false });

  return mutationOk({ ...output, written: true });
}
