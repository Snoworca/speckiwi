import { access, readdir } from "node:fs/promises";
import path from "node:path";
import { readUtf8File } from "../fs/read-text.js";
import { toPosixPath } from "../fs/safe-path.js";
import type { ProjectRoot, TextFile } from "../types.js";

export interface SrsFileSet {
  index: TextFile;
  scopeFiles: TextFile[];
  stepFiles: TextFile[];
  stateFile?: TextFile;
  completedWork?: TextFile;
  completedWorkLog?: TextFile;
  appendix?: TextFile;
  /**
   * FR-PARSE-037 — the Markdown documents that sit directly in docs/spec, as workspace-relative
   * POSIX paths. The rest of this set is resolved by known name; this is the directory as it is, so a
   * document nobody named is still visible.
   */
  specDocuments: string[];
}

// A .srs.md file is an origin-isolated step file only when it lives under a
// docs/spec/steps/<name>/ subdirectory. A .srs.md directly under docs/spec/steps/
// (no <name> segment) is not a step file and falls back to scope files (FND-008).
function stepNameFromPosix(posixPath: string): string | undefined {
  const marker = "/docs/spec/steps/";
  const idx = posixPath.indexOf(marker);
  if (idx < 0) return undefined;
  const segments = posixPath.slice(idx + marker.length).split("/");
  return segments.length >= 2 ? segments[0] : undefined;
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
  const srsFiles = all
    .filter((file) => file.endsWith(".srs.md"))
    .filter((file) => !toPosixPath(file).includes("/docs/rule/"));
  const scopeFiles = (
    await Promise.all(
      srsFiles
        .filter((file) => stepNameFromPosix(toPosixPath(file)) === undefined)
        .map((file) => readUtf8File(file, root.root))
    )
  ).sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  const stepFiles = (
    await Promise.all(
      srsFiles
        .filter((file) => stepNameFromPosix(toPosixPath(file)) !== undefined)
        .map((file) => readUtf8File(file, root.root))
    )
  ).sort((a, b) => a.relativePath.localeCompare(b.relativePath));

  const stateFilePath = path.join(specDir, "steps", "state.md");
  const stateFile = (await access(stateFilePath).then(() => true).catch(() => false))
    ? await readUtf8File(stateFilePath, root.root)
    : undefined;

  const appendixPath = path.join(specDir, "90.appendix.md");
  const appendix = (await access(appendixPath).then(() => true).catch(() => false))
    ? await readUtf8File(appendixPath, root.root)
    : undefined;
  const completedWorkPath = path.join(specDir, "05.completed-work.md");
  const completedWork = (await access(completedWorkPath).then(() => true).catch(() => false))
    ? await readUtf8File(completedWorkPath, root.root)
    : undefined;
  // FR-PARSE-029: the history file docs/spec/91.completed-work-log.md is read like the
  // appendix (a non-.srs.md sidecar), excluded from scope/step files and parsed records.
  const completedWorkLogPath = path.join(specDir, "91.completed-work-log.md");
  const completedWorkLog = (await access(completedWorkLogPath).then(() => true).catch(() => false))
    ? await readUtf8File(completedWorkLogPath, root.root)
    : undefined;
  // FR-PARSE-037 — only the top level of docs/spec holds an ordering position, so a document in a
  // subdirectory is not listed: two files with the same leading number in different directories are
  // not a collision.
  const specDirPosix = `${toPosixPath(specDir)}/`;
  const specDocuments = all
    .map((file) => toPosixPath(file))
    .filter((file) => file.startsWith(specDirPosix) && !file.slice(specDirPosix.length).includes("/"))
    .filter((file) => file.endsWith(".md"))
    .map((file) => `docs/spec/${file.slice(specDirPosix.length)}`)
    .sort();

  return {
    index,
    scopeFiles,
    stepFiles,
    specDocuments,
    ...(stateFile ? { stateFile } : {}),
    ...(completedWork ? { completedWork } : {}),
    ...(completedWorkLog ? { completedWorkLog } : {}),
    ...(appendix ? { appendix } : {})
  };
}
