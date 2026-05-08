import { access, realpath } from "node:fs/promises";
import path from "node:path";
import type { ProjectRoot } from "./types.js";

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function resolveProjectRoot(start: string, explicitRoot?: string): Promise<ProjectRoot> {
  if (explicitRoot) {
    return { root: await realpath(explicitRoot).catch(() => path.resolve(explicitRoot)) };
  }

  let current = path.resolve(start);
  for (;;) {
    if ((await exists(path.join(current, ".git"))) || (await exists(path.join(current, "docs", "spec", "00.index.md")))) {
      return { root: await realpath(current).catch(() => current) };
    }
    const parent = path.dirname(current);
    if (parent === current) {
      throw new Error(`Could not resolve SpecKiwi project root from ${start}`);
    }
    current = parent;
  }
}
