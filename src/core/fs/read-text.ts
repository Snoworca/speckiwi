import { createHash } from "node:crypto";
import type { Stats } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { detectNewline, splitLines } from "./newline.js";
import type { TextFile, TextFileSnapshot } from "../types.js";

export function createTextFileSnapshot(text: string, stats?: Pick<Stats, "mtimeMs" | "size">): TextFileSnapshot {
  const snapshot: TextFileSnapshot = {
    sha256: createHash("sha256").update(text, "utf8").digest("hex"),
    size: Buffer.byteLength(text, "utf8")
  };
  if (stats?.mtimeMs !== undefined) snapshot.mtimeMs = stats.mtimeMs;
  return snapshot;
}

/**
 * @req FR-NODE-091 — a read failure can name its file. Node's error for reading a directory carries
 * no path ("EISDIR: illegal operation on a directory, read"), so the file is attached as `path` when
 * the error has none. The message and the code stay exactly what Node wrote: the CLI boundary
 * classifies an unhandled failure by them, and rewording the message moved a failure to another class.
 */
function withFilePath(filePath: string): (error: NodeJS.ErrnoException) => never {
  return (error) => {
    if (error.path === undefined) error.path = filePath;
    throw error;
  };
}

export async function readUtf8File(filePath: string, root?: string): Promise<TextFile> {
  const [text, stats] = await Promise.all([readFile(filePath, "utf8"), stat(filePath)]).catch(withFilePath(filePath));
  return {
    path: filePath,
    relativePath: root ? path.relative(root, filePath).replace(/\\/g, "/") : path.basename(filePath),
    text,
    lines: splitLines(text),
    newline: detectNewline(text),
    snapshot: createTextFileSnapshot(text, stats)
  };
}
