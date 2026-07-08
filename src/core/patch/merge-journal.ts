import { createHash, randomUUID } from "node:crypto";
import { copyFile, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { assertFreshSnapshot } from "./apply-patch.js";
import { renderPatchedLines, type PatchPlan } from "./patch-plan.js";

// @req FR-NODE-047
// Net-new MultiFileCommit four-phase engine (Option A: net-new merge only) backed by a
// durable merge-journal. Commits a single-REQ change touching a step file and a body file in
// one atomic operation. The existing single-file applyPatchPlan path in apply-patch.ts is left
// untouched; this module reuses the export-promoted assertFreshSnapshot for the stale-check.

const JOURNAL_FILE = ".speckiwi-merge-journal.json";

export type MergePhase = "render" | "stale-check" | "write-tmp" | "rename";

export interface MergeCommitFile {
  plan: PatchPlan;
}

export interface MergeJournalRename {
  from: string;
  to: string;
  sha256: string;
  backup: string;
  // @req FR-NODE-048
  requirementId?: string | undefined;
  // @req FR-NODE-048
  applied?: boolean | undefined;
}

export interface MergeJournal {
  // "rolled-back" is a durable terminal marker: once written, recovery only ever rolls back,
  // never forward, so a retried recovery after a roll-back can never partially apply the merge.
  status: "half-applied" | "applied" | "rolled-back";
  renames: MergeJournalRename[];
  // @req FR-NODE-048
  requirementId?: string | undefined;
}

export interface MergeCommitOptions {
  onPhase?: (phase: MergePhase) => void | Promise<void>;
  onRename?: (to: string) => void | Promise<void>;
  // @req FR-NODE-048
  requirementId?: string | undefined;
}

export interface MergeCommitResult {
  committed: boolean;
}

export interface MergeRecoveryResult {
  recovered: boolean;
  outcome?: "rolled-forward" | "rolled-back";
}

function journalPath(root: string): string {
  return path.join(root, JOURNAL_FILE);
}

function renderFinalText(plan: PatchPlan): string {
  const lines = renderPatchedLines(plan);
  const trailing = plan.file.text.endsWith(plan.file.newline) ? plan.file.newline : "";
  return `${lines.join(plan.file.newline)}${trailing}`;
}

function sha256Of(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

// @req FR-NODE-047
async function writeJournal(root: string, journal: MergeJournal): Promise<void> {
  const tmp = path.join(root, `${JOURNAL_FILE}.${randomUUID()}.tmp`);
  await writeFile(tmp, JSON.stringify(journal), "utf8");
  await rename(tmp, journalPath(root));
}

// @req FR-NODE-047
export async function readMergeJournal(root: string): Promise<MergeJournal | null> {
  try {
    const raw = await readFile(journalPath(root), "utf8");
    return JSON.parse(raw) as MergeJournal;
  } catch {
    return null;
  }
}

async function clearJournal(root: string): Promise<void> {
  await rm(journalPath(root), { force: true });
}

// @req FR-NODE-047
export class MultiFileCommit {
  constructor(
    private readonly root: string,
    private readonly files: MergeCommitFile[]
  ) {}

  private static isStateFile(filePath: string): boolean {
    return path.basename(filePath) === "state.md";
  }

  // @req FR-NODE-047
  plannedPaths(): string[] {
    return this.files
      .map((file) => file.plan.file.path)
      .filter((filePath) => !MultiFileCommit.isStateFile(filePath));
  }

  private assertNoStateFile(): void {
    for (const file of this.files) {
      if (MultiFileCommit.isStateFile(file.plan.file.path)) {
        throw new Error(`state.md is excluded from a MultiFileCommit plan: ${file.plan.file.path}`);
      }
    }
  }

  // @req FR-NODE-047
  async commit(options: MergeCommitOptions): Promise<MergeCommitResult> {
    this.assertNoStateFile();

    // Phase 1: render all final contents up front (all-or-nothing).
    await options.onPhase?.("render");
    const rendered = this.files.map((file) => ({
      plan: file.plan,
      text: renderFinalText(file.plan)
    }));

    // Phase 2: stale-check every file before touching any of them.
    await options.onPhase?.("stale-check");
    for (const entry of rendered) {
      await assertFreshSnapshot(entry.plan);
    }

    // Phase 3: write tmp + backup originals, then persist a durable journal.
    await options.onPhase?.("write-tmp");
    const requirementId = options.requirementId;
    const renames: MergeJournalRename[] = [];
    for (const entry of rendered) {
      const finalPath = entry.plan.file.path;
      const dir = path.dirname(finalPath);
      const token = randomUUID();
      const tmp = path.join(dir, `.speckiwi-${token}.tmp`);
      const backup = path.join(dir, `.speckiwi-${token}.bak`);
      await copyFile(finalPath, backup);
      await writeFile(tmp, entry.text, "utf8");
      // @req FR-NODE-048
      renames.push({
        from: tmp,
        to: finalPath,
        sha256: sha256Of(entry.text),
        backup,
        requirementId,
        applied: false
      });
    }
    // @req FR-NODE-048
    const journal: MergeJournal = { status: "half-applied", renames, requirementId };
    await writeJournal(this.root, journal);

    // Phase 4: batch rename (the durable, final phase). Each entry is durably marked applied
    // after its rename succeeds, so a resuming merge can skip already-applied operations.
    await options.onPhase?.("rename");
    for (const entry of renames) {
      await options.onRename?.(entry.to);
      await rename(entry.from, entry.to);
      // @req FR-NODE-048
      entry.applied = true;
      await writeJournal(this.root, journal);
    }

    await clearJournal(this.root);
    for (const entry of renames) {
      await rm(entry.backup, { force: true });
    }
    return { committed: true };
  }

  // @req FR-NODE-048
  // Resume an interrupted merge: read the durable journal, skip any rename already recorded as
  // applied, replay only the outstanding renames (marking each applied durably), then clear it.
  async resume(options: MergeCommitOptions): Promise<MergeCommitResult> {
    const journal = await readMergeJournal(this.root);
    if (journal === null) {
      return { committed: true };
    }

    for (const entry of journal.renames) {
      if (entry.applied === true) {
        continue;
      }
      await options.onRename?.(entry.to);
      await rename(entry.from, entry.to);
      entry.applied = true;
      await writeJournal(this.root, journal);
    }

    await clearJournal(this.root);
    for (const entry of journal.renames) {
      await rm(entry.backup, { force: true });
    }
    return { committed: true };
  }
}

// @req FR-NODE-047
// Roll the whole merge back to its pre-merge state, TERMINALLY and IDEMPOTENTLY.
//
// Invariant: once a roll-back begins it must never be reversed into a partial forward apply.
// We guarantee this in two layers:
//   1. A durable "rolled-back" status marker is written FIRST. recoverMerge honours it on entry
//      and only ever rolls back (never forward) for that journal — so even if this function is
//      interrupted before finishing, the retried recovery resumes the roll-back.
//   2. Outstanding tmp ('from') files are removed, so there is nothing left for any path to
//      rename forward. Targets are then restored from their backups (copying a backup over an
//      already-correct target is a harmless no-op, keeping the whole operation idempotent).
// Finally the journal and backups are cleared, completing the terminal roll-back.
async function rollBackMerge(root: string, journal: MergeJournal): Promise<void> {
  if (journal.status !== "rolled-back") {
    journal.status = "rolled-back";
    await writeJournal(root, journal);
  }
  // Remove outstanding tmp files first so no retry can roll any entry forward.
  for (const entry of journal.renames) {
    await rm(entry.from, { force: true });
  }
  // Restore every target from its backup (idempotent; a target already at its original is a no-op).
  for (const entry of journal.renames) {
    await copyFile(entry.backup, entry.to);
  }
  // Terminal cleanup: drop the journal and backups now that the workspace is fully pre-merge.
  await clearJournal(root);
  for (const entry of journal.renames) {
    await rm(entry.backup, { force: true });
  }
}

// @req FR-NODE-047
export async function recoverMerge(root: string): Promise<MergeRecoveryResult> {
  const journal = await readMergeJournal(root);
  if (journal === null) {
    return { recovered: false };
  }

  // A previous recovery already began (or completed) a roll-back: honour the terminal marker and
  // never roll forward. Resuming the idempotent roll-back converges to the pre-merge state.
  if (journal.status === "rolled-back") {
    await rollBackMerge(root, journal);
    return { recovered: true, outcome: "rolled-back" };
  }

  // Roll forward: complete any renames that did not finish. A tmp file that was already
  // renamed away surfaces as ENOENT and is skipped, keeping recovery idempotent. Any OTHER
  // error is a real failure (permission, lock, disk-full, destination conflict): completing
  // the merge is impossible, so we must roll the whole operation BACK to the pre-merge state
  // instead of swallowing the error and discarding the journal/backups.
  for (const entry of journal.renames) {
    try {
      await rename(entry.from, entry.to);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        // Already renamed (tmp missing) — idempotent skip.
        continue;
      }
      await rollBackMerge(root, journal);
      return { recovered: true, outcome: "rolled-back" };
    }
  }

  await clearJournal(root);
  for (const entry of journal.renames) {
    await rm(entry.backup, { force: true });
  }
  return { recovered: true, outcome: "rolled-forward" };
}
