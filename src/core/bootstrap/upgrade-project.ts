import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { MutationResult, ProjectRoot } from "../types.js";
import { mutationOk } from "../mutation/guards.js";
import { withSrsMutationLock } from "../mutation/srs-lock.js";
import { initProject, type InitProjectOutput } from "./init-project.js";
import { findMetadataTableRange, isRulesMetadataRow } from "./index-metadata.js";
import { BUNDLED_SDS_RULES_FILENAME, BUNDLED_SRS_RULES_FILENAME, renderIndexRulesRow } from "./templates.js";
import { bundledVersionFor, rewriteRulesReferences, scanRulesReferences } from "./rules-references.js";

// @req FR-NODE-091
//
// `speckiwi init` refreshes tool-owned artifacts and leaves author-owned ones alone. That boundary is
// not an oversight — it is what closed the defect where `--force` silently deleted requirements — so
// the two repairs an old project still needs after init cannot live inside init:
//
//   1. A reference to a rules document this release prunes is left dangling. This repository's own
//      CLAUDE.md and AGENTS.md carried exactly that line, as did three shipped skills.
//   2. An index with no `| Rules |` row never gets one: the pointer refresh only ever *replaces* a row,
//      so `doctor` warns forever and its own remediation admits it.
//
// So this is an explicit migration that writes only when its caller asks. The default belongs to the
// caller, not here: since IR-CLI-088 the CLI asks for the performed run unless given `--dry-run`.

const INDEX_RELATIVE_PATH = "docs/spec/00.index.md";

/** The hook files init manages, reported as they stood *before* the refresh. */
const MANAGED_HOOKS: readonly string[] = [".git/hooks/pre-commit", ".claude/settings.json", ".codex/hooks.json"];

/** What this command will not do, stated so a reader never assumes more than it performs. */
const BOUNDARIES: readonly string[] = [
  "Scope SRS documents are never renumbered; an existing numbering scheme is left as it is.",
  "No requirement body is edited — changing one is a governance mutation, not a migration. Under docs/spec/ this writes the index metadata Rules row, plus the tool-owned scaffolds the refresh creates when they are missing (90.appendix.md, steps/state.md).",
  "A hook that already exists is never overwritten; each one is reported as pre-existing so you can see what was left alone."
];

export interface UpgradeProjectInput {
  /**
   * Perform the plan. Absent or false plans and writes nothing. This is the operation's own default,
   * not the CLI's: `speckiwi upgrade` passes true unless `--dry-run` is given (IR-CLI-088).
   */
  apply?: boolean;
  ignoreLock?: boolean;
  /** Delegated to init; both default on, matching a plain `speckiwi init`. */
  installSkills?: boolean;
  registerMcp?: boolean;
}

export interface RulesReferenceFinding {
  filePath: string;
  line: number;
  /** `filePath:line`, so both the JSON and the human report locate the change. */
  location: string;
  from: string;
  to: string;
  /** `repair` for a managed agent file; `report` for a mention this command refuses to rewrite. */
  action: "repair" | "report";
}

export interface UpgradeProjectOutput {
  /** False for a plan: every finding below describes an intention, not a completed change. */
  applied: boolean;
  /** The tool-owned refresh, exactly as init reports it — including init's own warnings. */
  init: InitProjectOutput;
  /** Present only when the index metadata table had no Rules row. */
  rulesRowInsertion?: { filePath: string; line: number; row: string };
  references: RulesReferenceFinding[];
  /** Hook state before the refresh: a `pre-existing` file is one init leaves alone. */
  hooks: Array<{ filePath: string; state: "pre-existing" | "absent" }>;
  boundaries: readonly string[];
  /** This command's own warnings; init's are in `init.warnings`. */
  warnings: string[];
}

export async function upgradeProject(root: ProjectRoot, input: UpgradeProjectInput): Promise<MutationResult<UpgradeProjectOutput>> {
  const apply = input.apply === true;
  return withSrsMutationLock(
    root,
    { operation: "upgrade_project", ignoreLock: input.ignoreLock, dryRun: !apply },
    () => upgradeUnlocked(root, input, apply)
  );
}

async function upgradeUnlocked(root: ProjectRoot, input: UpgradeProjectInput, apply: boolean): Promise<MutationResult<UpgradeProjectOutput>> {
  const warnings: string[] = [];

  // Order matters, and it is the opposite of the obvious one. The author-owned repairs run BEFORE the
  // refresh so a plan and an apply report the same thing. Init replaces the managed agent block in
  // place, and that block cites the rules documents itself: with the refresh first, an apply would scan
  // an already-repaired file and report different lines — or none — where the plan reported two. Every
  // project an older speckiwi initialised carries such a block, so that is the normal case, not an edge.
  const hooks = await reportHooks(root.root);
  const insertion = await insertMissingRulesRow(root.root, apply, warnings);
  const references = await repairRulesReferences(root.root, apply);

  const initResult = await initProject(root, {
    dryRun: !apply,
    // This command already holds the lock; init must not try to take it again.
    skipLock: true,
    installSkills: input.installSkills !== false,
    registerMcp: input.registerMcp !== false
  });
  if (!initResult.ok || !initResult.value) {
    // The refresh failure is the whole command's failure, reported verbatim rather than re-worded.
    // No input reaches this: initProject returns only a success result, and the lock it would otherwise
    // fail on is skipped above because this command already holds it. The check stays because
    // MutationResult is a union — it is a type obligation, not a live path, and adding a seam to drive
    // it would put test-only indirection in the command. A genuine filesystem failure escapes as a
    // rejection and is reported at the CLI boundary instead; both facts are pinned by
    // test/core/bootstrap/upgrade-refresh-failure.fr-node-091.test.ts.
    return {
      ok: false,
      error: initResult.error ?? { code: "UPGRADE_REFRESH_FAILED", message: "the init refresh returned no result" },
      diagnostics: initResult.diagnostics,
      diagnosticsSummary: initResult.diagnosticsSummary
    };
  }

  return mutationOk({
    applied: apply,
    init: initResult.value,
    ...(insertion ? { rulesRowInsertion: insertion } : {}),
    references,
    hooks,
    boundaries: BOUNDARIES,
    warnings
  });
}

/**
 * Adds the bundled Rules pointer to the index metadata table when it has none.
 *
 * Anchored to the `| Field | Value |` table — not to "the first table in the file", and not to a
 * whole-file search for the row. An index that opens with a summary table would otherwise get the row
 * in that table while the real one still lacked it, and a `| Rules |`-prefixed row anywhere else (a
 * glossary entry, or a scope literally named `Rules`) would make this repair a silent no-op while
 * doctor kept warning forever.
 */
async function insertMissingRulesRow(
  rootPath: string,
  apply: boolean,
  warnings: string[]
): Promise<{ filePath: string; line: number; row: string } | undefined> {
  const absolutePath = path.join(rootPath, ...INDEX_RELATIVE_PATH.split("/"));
  const existing = await readFile(absolutePath, "utf8").catch(() => undefined);
  if (existing === undefined) return undefined; // No index; init scaffolds one with the row included.

  // Alternating content/terminator parts, so an insertion leaves every other line ending byte-identical.
  const parts = existing.split(/(\r\n|\n)/);
  const lines = parts.filter((_, index) => index % 2 === 0);
  const range = findMetadataTableRange(lines);
  if (range === undefined) {
    warnings.push(`${INDEX_RELATIVE_PATH}: no \`| Field | Value |\` metadata table found, so no Rules row was inserted.`);
    return undefined;
  }
  if (lines.slice(range.first, range.last + 1).some((line) => isRulesMetadataRow(line))) return undefined;

  const row = renderIndexRulesRow();
  if (apply) {
    // The new row borrows the terminator of the row it follows, so a CRLF index stays CRLF and a file
    // with mixed endings is not renormalised.
    const terminatorSlot = range.last * 2 + 1;
    const terminator = parts[terminatorSlot];
    const next =
      terminator === undefined
        ? // The metadata table ends at EOF with no final terminator. The new row needs one BEFORE it,
          // not after: appending `row + eol` welded the row onto the end of the previous one, turning a
          // two-cell metadata row into a four-cell row and leaving no Rules row at all.
          [...parts, parts.find((_, index) => index % 2 === 1) ?? "\n", row]
        : [...parts.slice(0, terminatorSlot + 1), row, terminator, ...parts.slice(terminatorSlot + 1)];
    await writeFile(absolutePath, next.join(""), "utf8");
  }
  return { filePath: INDEX_RELATIVE_PATH, line: range.last + 2, row };
}

/**
 * Repairs dangling references in the managed agent files and reports — without touching — the ones
 * found elsewhere under `docs/`. A note recording which rules version a project used to follow is a
 * record, not a defect, and rewriting it would corrupt the history it exists to keep.
 */
async function repairRulesReferences(rootPath: string, apply: boolean): Promise<RulesReferenceFinding[]> {
  const scan = await scanRulesReferences(rootPath);
  const isBroken = (document: string): boolean => !survivesRefresh(document);
  const findings: RulesReferenceFinding[] = [];

  for (const filePath of [...new Set(scan.agentFiles.map((match) => match.filePath))]) {
    const absolutePath = path.join(rootPath, filePath);
    const text = await readFile(absolutePath, "utf8").catch(() => undefined);
    if (text === undefined) continue;
    const rewritten = rewriteRulesReferences(text, isBroken);
    if (rewritten.changes.length === 0) continue;
    if (apply) await writeFile(absolutePath, rewritten.next, "utf8");
    for (const change of rewritten.changes) {
      findings.push({
        filePath,
        line: change.line,
        location: `${filePath}:${change.line}`,
        from: change.from,
        to: change.to,
        action: "repair"
      });
    }
  }

  for (const match of scan.otherDocs) {
    if (!isBroken(match.document)) continue;
    findings.push({
      filePath: match.filePath,
      line: match.line,
      location: match.location,
      from: match.token,
      to: match.token.replace(match.version, bundledVersionFor(match.family)),
      action: "report"
    });
  }

  return findings;
}

/**
 * Whether a rules document will still be installed once init has refreshed `docs/rule`.
 *
 * This is deliberately the *post*-refresh set rather than what is on disk now. Init prunes every rules
 * document whose name is not the bundled one, so judging by the current directory would make a plan
 * report nothing while the apply repaired two files — a plan that lies about the apply. The two bundled
 * names are the whole answer: a reference can only name a `<family>-MD-Rules-v<x.y.z>.md` document, and
 * init's prune pattern matches exactly that shape.
 */
function survivesRefresh(document: string): boolean {
  return document === BUNDLED_SRS_RULES_FILENAME || document === BUNDLED_SDS_RULES_FILENAME;
}

/**
 * Hook state as it stood before the refresh. Observed first on purpose: read afterwards, a hook init
 * had just created would be indistinguishable from a consumer hook the migration refused to touch, and
 * the report would carry no information at all.
 */
async function reportHooks(rootPath: string): Promise<Array<{ filePath: string; state: "pre-existing" | "absent" }>> {
  const reported: Array<{ filePath: string; state: "pre-existing" | "absent" }> = [];
  for (const relativePath of MANAGED_HOOKS) {
    const present = await stat(path.join(rootPath, ...relativePath.split("/")))
      .then((entry) => entry.isFile())
      .catch(() => false);
    reported.push({ filePath: relativePath, state: present ? "pre-existing" : "absent" });
  }
  return reported;
}
