import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { initWorkspace } from "../../src/core/init.js";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("initWorkspace", () => {
  it("returns deterministic CoreResult created and skipped lists", async () => {
    const root = await tempRoot();

    const result = await initWorkspace({ root, projectName: "SpecKiwi" });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.created).toEqual([...result.created].sort());
      expect(result.skipped).toEqual([]);
      expect(result.diagnostics.summary).toEqual({ errorCount: 0, warningCount: 0, infoCount: 0 });
    }
  });
});

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "speckiwi-init-"));
  tempRoots.push(root);
  return root;
}
