import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

export async function atomicWriteText(path: string, text: string): Promise<void> {
  const directory = dirname(path);
  const tempPath = join(directory, `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);

  await mkdir(directory, { recursive: true });

  try {
    await writeFile(tempPath, text, "utf8");
    await rename(tempPath, path);
  } catch (error) {
    await removeIfPresent(tempPath);
    throw error;
  }
}

async function removeIfPresent(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    if (!isNodeError(error) || error.code !== "ENOENT") {
      throw error;
    }
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
