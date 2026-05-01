import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
export async function atomicWriteText(path, text) {
    const directory = dirname(path);
    const tempPath = join(directory, `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);
    await mkdir(directory, { recursive: true });
    try {
        await writeFile(tempPath, text, "utf8");
        await rename(tempPath, path);
    }
    catch (error) {
        await removeIfPresent(tempPath);
        throw error;
    }
}
async function removeIfPresent(path) {
    try {
        await unlink(path);
    }
    catch (error) {
        if (!isNodeError(error) || error.code !== "ENOENT") {
            throw error;
        }
    }
}
function isNodeError(error) {
    return error instanceof Error && "code" in error;
}
//# sourceMappingURL=file-store.js.map