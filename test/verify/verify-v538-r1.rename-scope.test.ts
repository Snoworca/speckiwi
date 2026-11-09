import { readdir, readFile } from "node:fs/promises";
import type * as FsPromises from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renameScope } from "../../src/core/mutation/rename-scope.js";
import { resolveProjectRoot } from "../../src/core/project-root.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

// Verifier finding for FR-NODE-279 (5.3.8 round 1): rename-scope moves its document outside the
// file-level transaction, so when the index write fails AND the move-back fails, the document stays at its
// new name and the error is the bare move-back failure instead of a restore report naming it. Recorded,
// not fixed: it needs two failures in a row and predates 5.3.8; moving the rename into the transaction is
// FR-NODE-283 (5.3.9). The test asserts the wanted outcome and is expected to fail until then.

const fault = vi.hoisted(() => ({ on: false }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>();
  return {
    ...actual,
    rename: async (from: Parameters<typeof actual.rename>[0], to: Parameters<typeof actual.rename>[1]) => {
      if (fault.on && path.basename(String(to)) === "00.index.md") throw Object.assign(new Error("EPERM: index"), { code: "EPERM", syscall: "rename" });
      if (fault.on && path.basename(String(to)) === "10.product-architecture.srs.md") throw Object.assign(new Error("EPERM: move back"), { code: "EPERM", syscall: "rename" });
      return actual.rename(from, to);
    }
  };
});
afterEach(() => {
  fault.on = false;
});

describe("probe: rename-scope whose index write fails and whose move-back fails", () => {
  // declared limit, 5.3.8 lead decision (FR-NODE-283 in 5.3.9)
  it.fails("leaves every document as it was, or reports the document it could not put back", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");
    const specDir = path.join(rootPath, "docs", "spec");
    const before = (await readdir(specDir)).sort();
    fault.on = true;
    const error = await renameScope(await resolveProjectRoot(rootPath), { from: "10.product-architecture", to: "10.product-arch", apply: true }).then(
      () => undefined,
      (caught: unknown) => caught as Error
    );
    fault.on = false;
    const after = (await readdir(specDir)).sort();
    const indexText = await readFile(path.join(specDir, "00.index.md"), "utf8");
    expect({
      errorName: error?.name,
      errorMessage: error?.message,
      files: after,
      indexStillLinksOldName: indexText.includes("10.product-architecture.srs.md")
    }).toEqual({ errorName: "PlansRestoreError", errorMessage: expect.stringContaining("10.product-arch"), files: before, indexStillLinksOldName: true });
  });
});
