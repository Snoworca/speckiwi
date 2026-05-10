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

export async function readUtf8File(filePath: string, root?: string): Promise<TextFile> {
  const [text, stats] = await Promise.all([readFile(filePath, "utf8"), stat(filePath)]);
  return {
    path: filePath,
    relativePath: root ? path.relative(root, filePath).replace(/\\/g, "/") : path.basename(filePath),
    text,
    lines: splitLines(text),
    newline: detectNewline(text),
    snapshot: createTextFileSnapshot(text, stats)
  };
}
