import { readdir } from "node:fs/promises";
import path from "node:path";
import { readUtf8File } from "../fs/read-text.js";
import { toPosixPath } from "../fs/safe-path.js";
import type { ProjectRoot, TextFile } from "../types.js";

export interface SrsFileSet {
  index: TextFile;
  scopeFiles: TextFile[];
}

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(full)));
    } else {
      files.push(full);
    }
  }
  return files;
}

export async function discoverSrsFiles(root: ProjectRoot): Promise<SrsFileSet> {
  const specDir = path.join(root.root, "docs", "spec");
  const indexPath = path.join(specDir, "00.index.md");
  const index = await readUtf8File(indexPath, root.root);
  const all = await walk(specDir);
  const scopeFiles = (
    await Promise.all(
      all
        .filter((file) => file.endsWith(".srs.md"))
        .filter((file) => !toPosixPath(file).includes("/docs/rule/"))
        .map((file) => readUtf8File(file, root.root))
    )
  ).sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return { index, scopeFiles };
}
