import { mkdir, realpath } from "node:fs/promises";
import path from "node:path";

export async function resolveInsideRoot(root: string, candidate: string): Promise<string> {
  await mkdir(root, { recursive: true });
  const rootReal = await realpath(root);
  const resolved = path.isAbsolute(candidate) ? candidate : path.resolve(rootReal, candidate);
  let targetReal: string;
  try {
    targetReal = await realpath(resolved);
  } catch {
    targetReal = path.resolve(resolved);
  }
  const relative = path.relative(rootReal, targetReal);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    return targetReal;
  }
  throw new Error(`Path is outside project root: ${candidate}`);
}

export function toPosixPath(value: string): string {
  return value.replace(/\\/g, "/");
}
