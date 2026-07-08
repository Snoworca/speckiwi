import { applyPatchPlan } from "../patch/apply-patch.js";
import { createPatchPlan, type PatchOperation } from "../patch/patch-plan.js";
import { parseWorkspace } from "../parser/workspace-parser.js";
import { normalizeScopeDocument } from "../validator/rules.js";
import type {
  MutationResult,
  ProjectRoot,
  RegisterScopesInput,
  RegisterScopesItemPlan,
  RegisterScopesOutput,
  RegisterScopesSkipReason,
  RequirementRecord,
  TextFile
} from "../types.js";

export type { RegisterScopesInput, RegisterScopesItemPlan, RegisterScopesOutput } from "../types.js";
import { mutationFail, mutationOk } from "./guards.js";

// @req FR-NODE-064

/**
 * FR-NODE-064 — infer a scope document's prefix from the requirement id prefixes it holds.
 * The prefix is the middle token of a requirement id (FR-EXTRA-001 -> EXTRA), mirroring the
 * record scope derivation in query/records.ts. Returns undefined when the document has no
 * requirement to infer from, so the caller skips it with `cannot-infer-prefix`.
 * @req FR-NODE-064
 */
function inferPrefix(records: readonly RequirementRecord[]): string | undefined {
  for (const record of records) {
    const token = record.id.split("-")[1];
    if (token) return token;
  }
  return undefined;
}

/**
 * FR-NODE-064 — render the Scope Map row for a newly registered scope document. The Document
 * cell is the bare relative file name (the basename of the docs/spec-relative path), which the
 * index parser's extractLinkTarget accepts as-is, so the row names the document exactly once
 * with its inferred prefix.
 * @req FR-NODE-064
 */
function renderScopeMapRow(relativePath: string, prefix: string): string {
  const fileName = relativePath.slice(relativePath.lastIndexOf("/") + 1);
  return `| ${prefix} | ./${fileName} | ${prefix} | - |`;
}

/**
 * FR-NODE-064 — locate the line after the last Scope Map table row so a new row is appended
 * without disturbing any existing line. Scans from the `## N. Scope Map` heading for the
 * table header + separator, then returns the line just past the final consecutive table row.
 * @req FR-NODE-064
 */
function findScopeMapInsertionLine(file: TextFile): number | undefined {
  const headingLine = file.lines.findIndex((line) => /^##\s+\d+\.\s+Scope Map$/.test(line.trim()));
  if (headingLine < 0) return undefined;
  let lastTableLine: number | undefined;
  for (let i = headingLine + 1; i < file.lines.length; i += 1) {
    const text = file.lines[i] ?? "";
    if (/^##\s/.test(text)) break;
    if (text.trim().startsWith("|")) lastTableLine = i + 1;
  }
  return lastTableLine === undefined ? undefined : lastTableLine + 1;
}

/**
 * FR-NODE-064 — registerScopes core mutation. Adds every discovered srs.md scope document
 * missing from the index Scope Map (the SRS-W018 set) as a Scope Map row, inferring each
 * document's prefix from its requirement id prefixes. It defaults to dry-run (no apply flag),
 * listing the documents it would add and writing no file. An inferred prefix that collides
 * with an already-registered Scope Map prefix is skipped with the `prefix-conflict` reason and
 * not added; a document with no requirement to infer from is skipped with `cannot-infer-prefix`.
 * The mutation never touches a Requirement Block nor any Status / Type summary count — it only
 * inserts Scope Map rows for the non-skipped unregistered documents.
 * @req FR-NODE-064
 */
export async function registerScopes(
  root: ProjectRoot,
  input: RegisterScopesInput = {}
): Promise<MutationResult<RegisterScopesOutput>> {
  // An explicit dryRun supersedes apply, so `--apply --dry-run` previews without writing.
  const dryRun = input.dryRun === true || input.apply !== true;
  const workspace = await parseWorkspace(root);
  const indexFile: TextFile | undefined = workspace.files[0];
  if (!indexFile) return mutationFail("NOT_FOUND", "00.index.md not found");

  // SRS-W018 set: discovered .srs.md scope documents absent from the Scope Map registration.
  const registered = new Set(
    workspace.index.scopes.map((scope) => normalizeScopeDocument(scope.document)).filter(Boolean)
  );
  const registeredPrefixes = new Set(
    workspace.index.scopes.map((scope) => scope.prefix.trim()).filter(Boolean)
  );

  const unregistered = workspace.files.filter(
    (file) => file.relativePath.endsWith(".srs.md") && !registered.has(file.relativePath)
  );

  const items: RegisterScopesItemPlan[] = [];
  const insertions: string[] = [];
  // Track prefixes claimed within this run so a second non-colliding document cannot reuse a
  // prefix that an earlier document in the same run already registered.
  const claimedPrefixes = new Set(registeredPrefixes);

  for (const file of unregistered) {
    const records = workspace.records.filter((record) => record.filePath === file.relativePath);
    const prefix = inferPrefix(records);
    if (prefix === undefined) {
      items.push({ document: file.relativePath, skipReason: "cannot-infer-prefix" satisfies RegisterScopesSkipReason });
      continue;
    }
    if (claimedPrefixes.has(prefix)) {
      items.push({ document: file.relativePath, prefix, skipReason: "prefix-conflict" satisfies RegisterScopesSkipReason });
      continue;
    }
    claimedPrefixes.add(prefix);
    items.push({ document: file.relativePath, prefix });
    insertions.push(renderScopeMapRow(file.relativePath, prefix));
  }

  if (dryRun || insertions.length === 0) {
    return mutationOk({ dryRun, items });
  }

  const insertLine = findScopeMapInsertionLine(indexFile);
  if (insertLine === undefined) return mutationFail("MUTATION_DENIED", "Scope Map table not found in 00.index.md");

  const operations: PatchOperation[] = [{ type: "insertLines", line: insertLine, lines: insertions }];
  const plan = createPatchPlan(indexFile, operations);
  await applyPatchPlan(plan, { dryRun: false });

  return mutationOk({ dryRun, items });
}
