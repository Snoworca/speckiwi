import { execFileSync } from "node:child_process";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import type * as FsPromises from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";

/** Reads of code files under `src/many-` in flight at once, and the most seen together. */
const reads = vi.hoisted(() => ({ inFlight: 0, most: 0 }));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>();
  return {
    ...actual,
    readFile: (async (...args: Parameters<typeof actual.readFile>) => {
      if (!String(args[0]).replace(/\\/g, "/").includes("/src/many-")) return actual.readFile(...args);
      reads.inFlight += 1;
      reads.most = Math.max(reads.most, reads.inFlight);
      try {
        return await actual.readFile(...args);
      } finally {
        reads.inFlight -= 1;
      }
    }) as typeof actual.readFile
  };
});
import { main } from "../../../src/cli/index.js";
import { diagnoseRequirementIdCollisions } from "../../../src/core/mutation/repair-requirement-id.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { createMcpServer } from "../../../src/mcp/server.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

// @req FR-NODE-313 — after two lanes minted the same id, diagnose listed no code or test citation of
// it, and once the repair renamed one lane's requirement that lane's tests went on counting as
// coverage of the other lane's requirement, with no diagnostic anywhere (judgments R3, R4).

const DUP = "FR-ARCH-001";

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_DIR: undefined, GIT_WORK_TREE: undefined } as NodeJS.ProcessEnv }).trim();
}

async function put(rootPath: string, relative: string, text: string): Promise<void> {
  await mkdir(path.dirname(path.join(rootPath, relative)), { recursive: true });
  await writeFile(path.join(rootPath, relative), text, "utf8");
}

/** The duplicate-id fixture as a git repository whose root is the fixture itself, with code and tests citing the id. */
async function repository(): Promise<string> {
  const rootPath = await copyFixtureWorkspace("duplicate-id");
  git(rootPath, "init", "-q");
  expect(path.resolve(git(rootPath, "rev-parse", "--show-toplevel"))).toBe(path.resolve(rootPath));
  await put(rootPath, ".gitignore", "build/\n");
  await put(rootPath, "src/lane-a.ts", `export const a = 1;\n// @req ${DUP} AC-1 — lane A's own requirement\n`);
  await put(rootPath, "test/lane-b.test.ts", `import { it } from "vitest";\nit("${DUP} AC-1 lane B", () => {});\n`);
  await put(rootPath, "src/other.ts", "// @req FR-ARCH-0010 and NFR-ARCH-001 are other requirements\n"); // @req-lint: ignore — fixture text, not a citation
  await put(rootPath, "build/lane-a.test.ts", `// @req ${DUP} built copy, ignored\n`);
  return rootPath;
}

async function group(rootPath: string) {
  const result = await diagnoseRequirementIdCollisions(await resolveProjectRoot(rootPath));
  return { value: result.value as typeof result.value & { codeSearch?: Record<string, unknown> }, group: result.value.groups.find((item) => item.duplicateId === DUP) as (typeof result.value.groups)[number] & Record<string, unknown> };
}

describe("FR-NODE-313 AC-1 AC-2 — code and test lines naming the duplicate id", () => {
  // @req FR-NODE-313 AC-1
  it("lists every code and test line that names the duplicate id", async () => {
    const rootPath = await repository();
    const { group: found } = await group(rootPath);
    expect(found.codeReferences).toEqual([
      { filePath: "src/lane-a.ts", line: 2, excerpt: `// @req ${DUP} AC-1 — lane A's own requirement` },
      { filePath: "test/lane-b.test.ts", line: 2, excerpt: `it("${DUP} AC-1 lane B", () => {});` }
    ]);
  });

  // @req FR-NODE-313 AC-2
  it("leaves out files the repository's ignore rules exclude, and says the rules were applied", async () => {
    const rootPath = await repository();
    const { value, group: found } = await group(rootPath);
    expect((found.codeReferences as Array<{ filePath: string }>).map((item) => item.filePath)).not.toContain("build/lane-a.test.ts");
    expect(value.codeSearch).toMatchObject({ ignoreRules: "git", ignoreRulesReason: null });
  });

  // @req FR-NODE-313 AC-2
  it("reads the code files one at a time, so a large repository does not run out of open files", async () => {
    // Opening every file at once failed with EMFILE past about 8,190 files, where the same repository's
    // diagnose had answered before; the test-sufficiency check reads its files one at a time.
    const rootPath = await repository();
    for (let index = 0; index < 40; index += 1) await put(rootPath, `src/many-${index}.ts`, `// @req ${DUP}\n`);
    reads.most = 0;
    const { group: found } = await group(rootPath);
    expect((found.codeReferences as unknown[]).length).toBe(42);
    expect(reads.most).toBe(1);
  });

  // @req FR-NODE-313 AC-2
  it("says why when git could not apply the ignore rules", async () => {
    // Not a git repository: the listing fails, every candidate is searched and the reason is given.
    const rootPath = await copyFixtureWorkspace("duplicate-id");
    expect(() => git(rootPath, "rev-parse", "--show-toplevel")).toThrow();
    await put(rootPath, "src/lane-a.ts", `// @req ${DUP}\n`);
    const { value, group: found } = await group(rootPath);
    expect(value.codeSearch).toMatchObject({ ignoreRules: "none" });
    expect((value.codeSearch as { ignoreRulesReason: unknown }).ignoreRulesReason).not.toBeNull();
    expect((found.codeReferences as unknown[]).length).toBe(1);
  });
});

describe("FR-NODE-313 AC-3 — report only", () => {
  // @req FR-NODE-313 AC-3
  it("writes nothing and tells a person to decide each line", async () => {
    const rootPath = await repository();
    const before = await Promise.all(["src/lane-a.ts", "test/lane-b.test.ts"].map((file) => readFile(path.join(rootPath, file), "utf8")));
    const specBefore = await readdir(path.join(rootPath, "docs", "spec"));
    const { value } = await group(rootPath);
    expect(String((value.codeSearch as { note?: string }).note)).toMatch(/person|decide/i);
    expect(await Promise.all(["src/lane-a.ts", "test/lane-b.test.ts"].map((file) => readFile(path.join(rootPath, file), "utf8")))).toEqual(before);
    expect(await readdir(path.join(rootPath, "docs", "spec"))).toEqual(specBefore);
  });
});

describe("FR-NODE-313 AC-4 — completed-work history lines", () => {
  // @req FR-NODE-313 AC-4
  it("lists lines of the history file that name the duplicate id", async () => {
    const rootPath = await repository();
    await put(
      rootPath,
      "docs/spec/91.completed-work-log.md",
      ["# Completed Work Log", "", "| Date | Target | Scope | Requirement IDs | Summary | Reports |", "|---|---|---|---|---|---|", `| 2026-01-02 | v1.0.0 | ARCH | ${DUP} | an old row | |`, "| 2026-01-03 | v1.0.0 | ARCH | FR-ARCH-0010 | another id | |", ""].join("\n")
    );
    const { group: found } = await group(rootPath);
    expect(found.historyReferences).toEqual([{ filePath: "docs/spec/91.completed-work-log.md", line: 5, excerpt: `| 2026-01-02 | v1.0.0 | ARCH | ${DUP} | an old row | |` }]);
  });
});

describe("FR-NODE-313 AC-5 — nothing changes without a duplicate", () => {
  // @req FR-NODE-313 AC-5
  it("a workspace with no duplicate id gets the same result as before, without a code search", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    await put(rootPath, "src/a.ts", "// @req FR-ARCH-001\n");
    const result = await diagnoseRequirementIdCollisions(await resolveProjectRoot(rootPath));
    expect(result.value).toEqual({ groups: [], written: false });
  });

  // @req FR-NODE-313 AC-5
  it("MCP and CLI return the same groups", async () => {
    const rootPath = await repository();
    const viaMcp = (await createMcpServer({ root: rootPath }).callTool("diagnose_requirement_id_collisions", {})) as { value?: Record<string, unknown> };
    const streams = { stdout: new PassThrough(), stderr: new PassThrough() };
    await main(["--root", rootPath, "repair", "requirement-id-collisions", "diagnose", "--json"], streams);
    const viaCli = JSON.parse(streams.stdout.read()?.toString() ?? "{}") as { value?: Record<string, unknown> };
    // MCP leaves each group's diagnostic out of its answer (smaller MCP read diagnostics); the rest is the same.
    const withoutDiagnostic = (groups: unknown) => (groups as Array<Record<string, unknown>>).map(({ diagnostic: _diagnostic, ...rest }) => rest);
    expect(withoutDiagnostic(viaCli.value?.groups)).toEqual(withoutDiagnostic(viaMcp.value?.groups));
    expect(viaCli.value?.codeSearch).toEqual(viaMcp.value?.codeSearch);
    expect(((viaMcp.value?.groups as Array<{ codeReferences?: unknown[] }>)[0]?.codeReferences ?? []).length).toBe(2);
  });
});
