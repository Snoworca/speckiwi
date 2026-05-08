import { readFile } from "node:fs/promises";
import path from "node:path";
import { detectNewline, splitLines } from "./newline.js";
import type { TextFile } from "../types.js";

export async function readUtf8File(filePath: string, root?: string): Promise<TextFile> {
  const text = await readFile(filePath, "utf8");
  return {
    path: filePath,
    relativePath: root ? path.relative(root, filePath).replace(/\\/g, "/") : path.basename(filePath),
    text,
    lines: splitLines(text),
    newline: detectNewline(text)
  };
}
