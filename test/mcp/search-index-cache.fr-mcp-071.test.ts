import { createHash } from "node:crypto";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseWorkspace } from "../../src/core/parser/workspace-parser.js";
import { resolveProjectRoot } from "../../src/core/project-root.js";
import { buildRequirementSearchIndex } from "../../src/core/query/search-index.js";
import type { RequirementRecord } from "../../src/core/types.js";
import { createTestMcpServer } from "../../src/mcp/adapter.js";
import { createSearchIndexCache } from "../../src/mcp/search-index-cache.js";
import { registerReadTools } from "../../src/mcp/tools/read-tools.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

// @req FR-MCP-071 — the MCP server keeps one search index per workspace root and reuses it while the
// SRS files are unchanged. The core builder is wrapped in a spy so a test can count real builds made
// through the registered tool, not only through the cache in isolation.

const builds = vi.hoisted(() => ({ count: 0 }));

vi.mock("../../src/core/query/search-index.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/core/query/search-index.js")>();
  return {
    ...original,
    buildRequirementSearchIndex: (records: readonly RequirementRecord[]) => {
      builds.count += 1;
      return original.buildRequirementSearchIndex(records);
    }
  };
});

const SPEC_FILE = path.join("docs", "spec", "10.product-architecture.srs.md");
const ORIGINAL_SENTENCE = "The parser needs a small valid workspace.";

async function workspaceAt(root: string) {
  return parseWorkspace(await resolveProjectRoot(process.cwd(), root));
}

function search(root: string) {
  const server = createTestMcpServer({ root });
  registerReadTools(server, { root });
  return async (query: string, extra: Record<string, unknown> = {}) => {
    const response = (await server.callTool("search_requirements", { query, ...extra })) as { ok: boolean; value: { records: Array<{ id: string }> } };
    expect(response.ok).toBe(true);
    return response.value.records.map((record) => record.id);
  };
}

/** Every file under the root with its content hash and modification time. */
async function tree(root: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  async function walk(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        out.set(path.relative(root, full), "dir");
        await walk(full);
      } else {
        const info = await stat(full);
        out.set(path.relative(root, full), `${createHash("sha256").update(await readFile(full)).digest("hex")}@${info.mtimeMs}`);
      }
    }
  }
  await walk(root);
  return out;
}

beforeEach(() => {
  builds.count = 0;
});

describe("FR-MCP-071 — search_requirements reuses its index", () => {
  // @req FR-MCP-071 AC-1
  it("AC-1: a second call for the same root with unchanged SRS files answers from the index already built", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    const call = search(root);
    const first = await call("small valid workspace");
    const second = await call("small valid workspace");
    expect(first.length).toBeGreaterThan(0);
    expect(second).toEqual(first);
    expect(builds.count).toBe(1);
  });

  // @req FR-MCP-071 AC-2
  it("AC-2: a change to a file under docs/spec between two calls rebuilds the index before answering", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    const call = search(root);
    expect(await call("zephyrine")).toEqual([]);
    const specPath = path.join(root, SPEC_FILE);
    const text = await readFile(specPath, "utf8");
    expect(text).toContain(ORIGINAL_SENTENCE);
    await writeFile(specPath, text.replace(ORIGINAL_SENTENCE, "The parser needs a small valid zephyrine workspace."), "utf8");
    expect(await call("zephyrine")).toEqual(["FR-ARCH-001"]);
    expect(builds.count).toBe(2);
  });

  // @req FR-MCP-071 AC-3
  it("AC-3: concurrent calls for the same key build the index once", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    const call = search(root);
    const answers = await Promise.all([call("small valid workspace"), call("small valid workspace"), call("parser")]);
    expect(answers[0]).toEqual(answers[1]);
    expect(builds.count).toBe(1);
  });

  // @req FR-MCP-071 AC-3
  it("AC-3: the cache hands concurrent requests for one key the same pending build", async () => {
    const workspace = await workspaceAt(await copyFixtureWorkspace("valid-basic"));
    let calls = 0;
    const cache = createSearchIndexCache({
      build: (records) => {
        calls += 1;
        return buildRequirementSearchIndex(records);
      }
    });
    const pending = [cache.index(workspace), cache.index(workspace), cache.index(workspace)];
    const [a, b, c] = await Promise.all(pending);
    expect(calls).toBe(1);
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  // @req FR-MCP-071 AC-1
  it("AC-1: the cache keeps a small bounded number of roots and rebuilds an evicted one", async () => {
    const roots = await Promise.all([1, 2, 3].map(() => copyFixtureWorkspace("valid-basic")));
    const workspaces = await Promise.all(roots.map((root) => workspaceAt(root)));
    let calls = 0;
    const cache = createSearchIndexCache({
      maxRoots: 2,
      build: (records) => {
        calls += 1;
        return buildRequirementSearchIndex(records);
      }
    });
    const [w1, w2, w3] = workspaces as [typeof workspaces[0], typeof workspaces[0], typeof workspaces[0]];
    const first = await cache.index(w1);
    await cache.index(w2);
    expect(await cache.index(w1)).toBe(first);
    expect(calls).toBe(2);
    await cache.index(w3); // evicts w2, the least recently used
    expect(await cache.index(w1)).toBe(first);
    expect(calls).toBe(3);
    await cache.index(w2);
    expect(calls).toBe(4);
  });

  it("refuses a bound below one at construction", () => {
    expect(() => createSearchIndexCache({ maxRoots: 0 })).toThrow(RangeError);
  });

  // @req FR-MCP-071 AC-1
  it("exact mode needs no index and builds none", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    const call = search(root);
    await call("small valid workspace", { match: "exact" });
    expect(builds.count).toBe(0);
  });

  // @req FR-MCP-071 AC-4
  it("AC-4: building and keeping the index creates and modifies no file", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    const before = await tree(root);
    const call = search(root);
    await call("small valid workspace");
    await call("parser");
    await Promise.all([call("workspace"), call("valid")]);
    expect(builds.count).toBe(1);
    expect(await tree(root)).toEqual(before);
  });
});
