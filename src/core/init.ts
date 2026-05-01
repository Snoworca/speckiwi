import { access, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import type { InitInput } from "./inputs.js";
import type { InitResult } from "./dto.js";
import { createDiagnosticBag, fail, ok } from "./result.js";
import { atomicWriteText } from "../io/file-store.js";
import { WORKSPACE_DIRECTORY, normalizeStorePath, resolveStorePath } from "../io/path.js";
import { workspaceRootFromPath } from "../io/workspace.js";
import { createWorkspaceTemplate } from "../templates/workspace.js";

export async function initWorkspace(input: InitInput): Promise<InitResult> {
  const rootPath = resolve(input.root ?? process.cwd());
  const root = workspaceRootFromPath(rootPath);
  const workspaceExists = await pathExists(root.speckiwiPath);

  if (workspaceExists && input.force !== true) {
    return fail(
      { code: "WORKSPACE_ALREADY_EXISTS", message: `${WORKSPACE_DIRECTORY} already exists at ${root.rootPath}.` },
      createDiagnosticBag([
        {
          severity: "error",
          code: "WORKSPACE_ALREADY_EXISTS",
          message: "Refusing to overwrite an existing SpecKiwi workspace.",
          path: WORKSPACE_DIRECTORY
        }
      ])
    );
  }

  const created: string[] = [];
  const skipped: string[] = [];
  const template = createWorkspaceTemplate(input);

  await mkdir(root.speckiwiPath, { recursive: true });
  if (workspaceExists) {
    skipped.push(WORKSPACE_DIRECTORY);
  } else {
    created.push(WORKSPACE_DIRECTORY);
  }

  for (const directory of template.directories) {
    const workspacePath = resolveStorePath(root, normalizeStorePath(directory));
    if (await pathExists(workspacePath.absolutePath)) {
      skipped.push(`${WORKSPACE_DIRECTORY}/${directory}`);
    } else {
      await mkdir(workspacePath.absolutePath, { recursive: true });
      created.push(`${WORKSPACE_DIRECTORY}/${directory}`);
    }
  }

  for (const file of template.files) {
    const workspacePath = resolveStorePath(root, normalizeStorePath(file.path));
    if ((await pathExists(workspacePath.absolutePath)) && input.force === true) {
      skipped.push(`${WORKSPACE_DIRECTORY}/${file.path}`);
    } else {
      await atomicWriteText(workspacePath.absolutePath, file.content);
      created.push(`${WORKSPACE_DIRECTORY}/${file.path}`);
    }
  }

  return ok({
    created: created.sort(),
    skipped: skipped.sort()
  });
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
