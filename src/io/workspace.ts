import { access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WORKSPACE_DIRECTORY, type WorkspaceRoot } from "./path.js";

export class WorkspaceDiscoveryError extends Error {
  constructor(
    public readonly code: "WORKSPACE_NOT_FOUND",
    message: string
  ) {
    super(message);
    this.name = "WorkspaceDiscoveryError";
  }
}

export async function findWorkspaceRoot(start: string, explicitRoot?: string): Promise<WorkspaceRoot> {
  const startPath = resolve(start);

  if (explicitRoot !== undefined) {
    const rootPath = resolve(startPath, explicitRoot);
    const root = buildWorkspaceRoot(rootPath, true);
    await assertWorkspaceExists(root);
    return root;
  }

  let current = startPath;
  for (;;) {
    const root = buildWorkspaceRoot(current, false);
    if (await workspaceExists(root)) {
      return root;
    }

    const parent = dirname(current);
    if (parent === current) {
      throw new WorkspaceDiscoveryError("WORKSPACE_NOT_FOUND", `Could not find ${WORKSPACE_DIRECTORY} from ${startPath}.`);
    }
    current = parent;
  }
}

export function workspaceRootFromPath(rootPath: string, explicit = true): WorkspaceRoot {
  return buildWorkspaceRoot(resolve(rootPath), explicit);
}

export function workspaceRootFromUrl(rootUrl: URL, explicit = true): WorkspaceRoot {
  return workspaceRootFromPath(fileURLToPath(rootUrl), explicit);
}

function buildWorkspaceRoot(rootPath: string, explicit: boolean): WorkspaceRoot {
  const absoluteRootPath = resolve(rootPath);

  return {
    rootPath: absoluteRootPath,
    speckiwiPath: resolve(absoluteRootPath, WORKSPACE_DIRECTORY),
    explicit
  };
}

async function assertWorkspaceExists(root: WorkspaceRoot): Promise<void> {
  if (!(await workspaceExists(root))) {
    throw new WorkspaceDiscoveryError("WORKSPACE_NOT_FOUND", `Could not find ${WORKSPACE_DIRECTORY} at ${root.rootPath}.`);
  }
}

async function workspaceExists(root: WorkspaceRoot): Promise<boolean> {
  try {
    await access(root.speckiwiPath);
    return true;
  } catch {
    return false;
  }
}
