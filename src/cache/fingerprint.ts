import { lstat, readdir } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import type { WorkspaceRoot } from "../io/path.js";
import type { LoadedWorkspace } from "../validate/semantic.js";
import { sha256, sha256File } from "./hash.js";

export type SourceFileStat = {
  path: string;
  size: number;
  mtimeMs: number;
  ctimeMs: number;
};

export type SourceFileFingerprint = SourceFileStat & {
  sha256: string;
};

export async function statWorkspaceInputs(root: WorkspaceRoot): Promise<SourceFileStat[]> {
  const paths: SourceFileStat[] = [];

  await visitYamlInputs(root, async (absolutePath, storePath) => {
    const stats = await lstat(absolutePath);
    paths.push({
      path: storePath,
      size: stats.size,
      mtimeMs: stats.mtimeMs,
      ctimeMs: stats.ctimeMs
    });
  });

  return paths.sort(compareSourceFile);
}

export async function fingerprintWorkspace(root: WorkspaceRoot): Promise<SourceFileFingerprint[]> {
  const paths = await statWorkspaceInputs(root);
  const fingerprints = await Promise.all(
    paths.map(async (entry) => ({
      ...entry,
      sha256: await sha256File(resolve(root.speckiwiPath, entry.path))
    }))
  );
  return fingerprints.sort(compareSourceFile);
}

export async function fingerprintLoadedWorkspace(root: WorkspaceRoot, workspace: LoadedWorkspace): Promise<SourceFileFingerprint[]> {
  const rawByPath = new Map(workspace.documents.map((document) => [document.storePath, document.raw]));
  const paths = await statWorkspaceInputs(root);
  const fingerprints = await Promise.all(
    paths.map(async (entry) => {
      const raw = rawByPath.get(entry.path);
      return {
        ...entry,
        sha256: raw === undefined ? await sha256File(resolve(root.speckiwiPath, entry.path)) : `sha256:${sha256(raw)}`
      };
    })
  );
  return fingerprints.sort(compareSourceFile);
}

async function visitYamlInputs(
  root: WorkspaceRoot,
  visit: (absolutePath: string, storePath: string) => Promise<void>
): Promise<void> {
  async function walk(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = resolve(directory, entry.name);
      const storePath = toStorePath(root, absolutePath);
      if (isIgnoredStorePath(storePath) || entry.isSymbolicLink()) {
        continue;
      }
      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith(".yaml")) {
        await visit(absolutePath, storePath);
      }
    }
  }

  await walk(root.speckiwiPath);
}

function toStorePath(root: WorkspaceRoot, absolutePath: string): string {
  return relative(root.speckiwiPath, absolutePath).split(sep).join("/");
}

function isIgnoredStorePath(storePath: string): boolean {
  return storePath.startsWith("cache/") || storePath.startsWith("exports/") || storePath.startsWith("templates/");
}

function compareSourceFile(left: Pick<SourceFileStat, "path">, right: Pick<SourceFileStat, "path">): number {
  return left.path.localeCompare(right.path);
}
