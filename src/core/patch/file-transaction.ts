import { existsSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import { retryBusy } from "../lock/busy-retry.js";
import { replaceFileAtomically } from "./apply-patch.js";

// @req FR-NODE-279 AC-1 AC-2 — the file-level transaction every multi-document write rests on. Before a
// file is first touched it records the file's original bytes, or that it did not exist; when the work
// fails, every file it wrote, created or removed is put back (a created file removed, a changed or
// removed one rewritten with its original bytes) and the failure is rethrown.

/** A failed change whose restore also failed: these documents still hold the partial change. */
export class PlansRestoreError extends Error {
  readonly unrestored: string[];

  constructor(unrestored: string[], cause: unknown) {
    super(`A multi-document change failed and these documents could not be restored: ${unrestored.join(", ")}`, { cause });
    this.name = "PlansRestoreError";
    this.unrestored = unrestored;
  }
}

export interface FileTransaction {
  /** Replaces the file with `text`, creating it when it does not exist. */
  write(filePath: string, text: string): Promise<void>;
  /** Removes the file. */
  remove(filePath: string): Promise<void>;
}

/** What a file held before the transaction first touched it; `undefined` when it did not exist. */
type OriginalContent = Buffer | undefined;

/**
 * Runs `work` with a transaction whose writes and removals are undone when `work` throws. Only a file
 * whose write or removal completed is put back: a write that failed never replaced its file.
 */
export async function runFileTransaction<T>(work: (transaction: FileTransaction) => Promise<T>): Promise<T> {
  const originals = new Map<string, OriginalContent>();
  const applied: string[] = [];
  const recordOriginal = async (filePath: string): Promise<void> => {
    if (originals.has(filePath)) return;
    originals.set(filePath, existsSync(filePath) ? await readFile(filePath) : undefined);
  };
  const transaction: FileTransaction = {
    async write(filePath, text) {
      await recordOriginal(filePath);
      await replaceFileAtomically(filePath, text);
      applied.push(filePath);
    },
    async remove(filePath) {
      await recordOriginal(filePath);
      await retryBusy(() => rm(filePath, { force: true }));
      applied.push(filePath);
    }
  };
  try {
    return await work(transaction);
  } catch (error) {
    const unrestored = await restore([...new Set(applied)].reverse(), originals);
    if (unrestored.length > 0) throw new PlansRestoreError(unrestored, error);
    throw error;
  }
}

/** Puts each file back to its original content and returns the files it could not put back. */
async function restore(filePaths: readonly string[], originals: ReadonlyMap<string, OriginalContent>): Promise<string[]> {
  const unrestored: string[] = [];
  for (const filePath of filePaths) {
    const original = originals.get(filePath);
    // Windows reports a document a scanner briefly holds as EPERM/EBUSY; the shared retry absorbs it.
    const putBack = original === undefined ? () => rm(filePath, { force: true }) : () => writeFile(filePath, original);
    await retryBusy(putBack).catch(() => unrestored.push(filePath));
  }
  return unrestored;
}
