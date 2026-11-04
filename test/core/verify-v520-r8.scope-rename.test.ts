import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { renameScope } from "../../src/core/mutation/rename-scope.js";
import { parseWorkspace } from "../../src/core/parser/workspace-parser.js";
import { resolveProjectRoot } from "../../src/core/project-root.js";
import { readFreshSrsStatusCache } from "../../src/core/status-cache.js";

const repo = path.resolve(__dirname, "../..");
const made: string[] = [];
afterEach(async () => {
  await Promise.all(made.splice(0).map((dir) => rm(dir, { recursive: true, force: true, maxRetries: 5 })));
});

async function realSpecCopy(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "speckiwi-r8-"));
  made.push(dir);
  await cp(path.join(repo, "docs", "spec"), path.join(dir, "docs", "spec"), { recursive: true });
  return dir;
}

describe("verify r8: an applied rename refreshes the SRS status cache like every other write (FR-NODE-232)", () => {
  it("leaves kiwi/.status.json fresh and unlocked after the rename", async () => {
    const dir = await realSpecCopy();
    const root = await resolveProjectRoot(dir);
    const result = await renameScope(root, { from: "10.product-architecture", to: "10.product-core", apply: true });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    const fresh = await readFreshSrsStatusCache(root, await parseWorkspace(root));
    expect(fresh.ok, JSON.stringify(fresh.diagnostics)).toBe(true);
    expect(fresh.ok && fresh.value.lock.active).toBe(false);
  });
});
