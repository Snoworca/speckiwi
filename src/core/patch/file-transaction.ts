import { existsSync } from "node:fs";
import { lstat, readFile, readlink, realpath, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { retryBusy } from "../lock/busy-retry.js";
import { replaceFileAtomically } from "./apply-patch.js";

// @req FR-NODE-279 AC-1 AC-2 — the file-level transaction every multi-document write rests on. Before a
// file is first touched it records the file's original bytes, or that it did not exist; when the work
// fails, every file it wrote, created or removed is put back (a created file removed, a changed or
// removed one rewritten with its original bytes) and the failure is rethrown.
//
// @req FR-NODE-283 AC-3 — it also moves a file. The undo runs in reverse order of the steps, so a file
// written at the name it was moved to gets its moved bytes back before it is moved back; a move-back
// that fails leaves the file at its new name and is reported, never removed.

/** A failed change whose restore also failed: these documents still hold the partial change. */
export class PlansRestoreError extends Error {
  readonly unrestored: string[];

  constructor(unrestored: string[], cause: unknown, details: readonly string[] = unrestored) {
    super(`A multi-document change failed and these documents could not be restored: ${details.join(", ")}`, { cause });
    this.name = "PlansRestoreError";
    this.unrestored = unrestored;
  }
}

export interface FileTransaction {
  /** Replaces the file with `text`, creating it when it does not exist. */
  write(filePath: string, text: string): Promise<void>;
  /** Removes the file. */
  remove(filePath: string): Promise<void>;
  /** Renames `from` to `to`; the caller has made sure `to` does not exist. */
  move(from: string, to: string): Promise<void>;
}

/** What a file held before the transaction first touched it; `undefined` when it did not exist. */
type OriginalContent = Buffer | undefined;

type Step = { readonly kind: "content"; readonly filePath: string } | { readonly kind: "move"; readonly from: string; readonly to: string };

/**
 * Runs `work` with a transaction whose writes, removals and moves are undone when `work` throws. Only a
 * step that completed is undone: a write that failed never replaced its file.
 */
export async function runFileTransaction<T>(work: (transaction: FileTransaction) => Promise<T>): Promise<T> {
  const originals = new Map<string, OriginalContent>();
  const steps: Step[] = [];
  const recordOriginal = async (filePath: string): Promise<void> => {
    if (originals.has(filePath)) return;
    originals.set(filePath, existsSync(filePath) ? await readFile(filePath) : undefined);
  };
  const transaction: FileTransaction = {
    async write(filePath, text) {
      const target = await writeTarget(filePath);
      await recordOriginal(target);
      await replaceFileAtomically(target, text);
      steps.push({ kind: "content", filePath: target });
    },
    async remove(filePath) {
      await recordOriginal(filePath);
      await retryBusy(() => rm(filePath, { force: true }));
      steps.push({ kind: "content", filePath });
    },
    async move(from, to) {
      await retryBusy(() => rename(from, to));
      steps.push({ kind: "move", from, to });
    }
  };
  try {
    return await work(transaction);
  } catch (error) {
    const failed = await undo(steps, originals);
    if (failed.length > 0) {
      throw new PlansRestoreError(
        failed.map((entry) => entry.filePath),
        error,
        failed.map((entry) => (entry.leftAt === undefined ? entry.filePath : `${entry.filePath} (left at ${entry.leftAt})`))
      );
    }
    throw error;
  }
}

/**
 * The file a write lands on. @req FR-NODE-263 AC-4 — the atomic replace renames a temporary file onto
 * its target, and a rename replaces a symbolic link rather than following it: a CLAUDE.md that links
 * to AGENTS.md would become a separate copy and the two would drift apart. So a link is resolved to
 * the file it points at, which is then both written and, on a failure, restored; a link whose target
 * does not exist yet resolves to the path it names, which the write creates.
 */
async function writeTarget(filePath: string): Promise<string> {
  const entry = await lstat(filePath).catch(() => undefined);
  if (entry?.isSymbolicLink() !== true) return filePath;
  if (existsSync(filePath)) return realpath(filePath);
  return path.resolve(path.dirname(filePath), await readlink(filePath));
}

/** Undoes the completed steps, latest first, and returns the files it could not put back. */
async function undo(steps: readonly Step[], originals: ReadonlyMap<string, OriginalContent>): Promise<Array<{ filePath: string; leftAt?: string }>> {
  const failed: Array<{ filePath: string; leftAt?: string }> = [];
  const restored = new Set<string>();
  for (const step of [...steps].reverse()) {
    if (step.kind === "move") {
      await retryBusy(() => rename(step.to, step.from)).catch(() => failed.push({ filePath: step.from, leftAt: step.to }));
      continue;
    }
    // A file written several times holds one original: the bytes before its first write.
    if (restored.has(step.filePath)) continue;
    restored.add(step.filePath);
    const original = originals.get(step.filePath);
    // Windows reports a document a scanner briefly holds as EPERM/EBUSY; the shared retry absorbs it.
    const putBack = original === undefined ? () => rm(step.filePath, { force: true }) : () => writeFile(step.filePath, original);
    await retryBusy(putBack).catch(() => failed.push({ filePath: step.filePath }));
  }
  return failed;
}
