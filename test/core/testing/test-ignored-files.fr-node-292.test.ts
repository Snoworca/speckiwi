import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterAll, describe, expect, it, vi } from "vitest";
import { main } from "../../../src/cli/index.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import * as rootFacts from "../../../src/core/root-facts.js";
import { createMcpServer } from "../../../src/mcp/server.js";
import { findTestFiles, listTestFiles } from "../../../src/core/testing/test-citations.js";
import { rawGitStdin } from "../orchestrator/support/git-fixture.js";
import { cleanupFixtures, gitWorkspaceRepo, linkedWorktree, rawGit } from "../../mcp/support/workspace-root-fixture.js";

// @req FR-NODE-292 — the test-file search leaves out what the workspace repository's git ignore rules
// exclude, keeps what git tracks, what is not added yet and what an `!` rule re-includes, and says how
// many it left out and whether the rules were applied.

vi.mock("../../../src/core/root-facts.js", async (importOriginal) => {
  const actual = await importOriginal<typeof rootFacts>();
  return { ...actual, git: vi.fn(actual.git) };
});

// Each case builds and commits one or two real repositories, which takes seconds on Windows.
vi.setConfig({ testTimeout: 60_000 });

afterAll(async () => {
  await cleanupFixtures();
});

/** A class file or a Gradle result: bytes around a NUL, with a citation inside them. */
const BINARY = Buffer.concat([Buffer.from([0xca, 0xfe, 0xba, 0xbe, 0x00]), Buffer.from("FR-ARCH-001 AC-1"), Buffer.from([0x00, 0x01])]);

interface Report {
  testFileCount: number;
  ignoredTestFileCount: number;
  ignoreRules: string;
  requirements: Array<{ requirementId: string; acs: Array<{ acId: string; cited: boolean; citations: Array<{ file: string; line: number }> }> }>;
  gaps: { requirements: Array<{ requirementId: string; acIds: string[] }> };
  passed: boolean;
}

async function put(root: string, relative: string, content: string | Buffer): Promise<void> {
  await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
  await writeFile(path.join(root, relative), content);
}

/** A committed git repository holding valid-basic, checked to be the root the search runs in. */
async function workspace(prefix: string): Promise<string> {
  const root = await gitWorkspaceRepo(prefix);
  expect(path.resolve((await resolveProjectRoot(root)).root)).toBe(path.resolve(root));
  expect(path.resolve(await rawGit(root, "rev-parse", "--show-toplevel"))).toBe(path.resolve(root));
  return root;
}

async function commit(root: string, ...paths: string[]): Promise<void> {
  await rawGit(root, "add", "-f", "--", ...paths);
  await rawGit(root, "commit", "-m", "test: fixture files");
}

async function coverage(root: string, ...args: string[]): Promise<{ code: number; stdout: string }> {
  const streams = { stdout: new PassThrough(), stderr: new PassThrough() };
  const code = await main(["--root", root, "coverage", "--tests", "--ids", "FR-ARCH-001", ...args], streams);
  return { code, stdout: streams.stdout.read()?.toString() ?? "" };
}

async function report(root: string, ...args: string[]): Promise<Report> {
  const { code, stdout } = await coverage(root, "--json", ...args);
  expect(code, stdout).toBe(0);
  return JSON.parse(stdout) as Report;
}

function citedFiles(value: Report, acId: string): string[] {
  return (value.requirements[0]?.acs.find((ac) => ac.acId === acId)?.citations ?? []).map((citation) => citation.file);
}

/** The reproduced false pass: AC-2 cited by a source test, AC-1 only by ignored build outputs. */
async function buildOutputWorkspace(prefix: string): Promise<string> {
  const root = await workspace(prefix);
  await put(root, ".gitignore", "build/\nbin/\n");
  await put(root, "src/test/java/com/x/FooTest.java", "// FR-ARCH-001 AC-2\nclass FooTest {}\n");
  await commit(root, ".gitignore", "src/test/java/com/x/FooTest.java");
  await put(root, "build/test-results/test/binary/results.bin", BINARY);
  await put(root, "bin/test/com/x/AuditRetentionScheduleTest.class", BINARY);
  return root;
}

describe("FR-NODE-292 AC-1 — an ignored build output covers nothing", () => {
  it("FR-NODE-292 AC-1: a criterion cited only in ignored build outputs is a gap, not a pass", async () => {
    const root = await buildOutputWorkspace("fr-node-292-ac1");
    const value = await report(root);
    expect(value.passed).toBe(false);
    expect(value.gaps.requirements).toEqual([{ requirementId: "FR-ARCH-001", acIds: ["AC-1"] }]);
    expect(citedFiles(value, "AC-1")).toEqual([]);
    expect(citedFiles(value, "AC-2")).toEqual(["src/test/java/com/x/FooTest.java"]);
  });

  it("FR-NODE-292 AC-1: .git/info/exclude is an ignore rule too", async () => {
    const root = await workspace("fr-node-292-ac1-exclude");
    await put(root, path.join(".git", "info", "exclude"), "out/\n");
    await put(root, "out/test/mod/FooTest.class", BINARY);
    const value = await report(root);
    expect(citedFiles(value, "AC-1")).toEqual([]);
    expect(value.ignoredTestFileCount).toBe(1);
  });

  it("FR-NODE-292 AC-1 AC-6: one listing answers, and no candidate is sent to check-ignore", async () => {
    const root = await buildOutputWorkspace("fr-node-292-ac1-once");
    await put(root, "test/a.test.ts", "// FR-ARCH-001 AC-2\n");
    await put(root, "test/b.test.ts", "// FR-ARCH-001 AC-2\n");
    const runner = vi.mocked(rootFacts.git);
    runner.mockClear();
    const value = await report(root);
    expect(value.ignoreRules).toBe("git");
    expect(value.ignoredTestFileCount).toBe(2);
    const listings = runner.mock.calls.filter(([, args]) => args.includes("ls-files"));
    expect(listings).toHaveLength(1);
    expect(listings[0]?.[1]).toEqual(["ls-files", "-z", "--cached", "--others", "--exclude-standard"]);
    // check-ignore costs candidates times index entries; asked about every candidate it ran past the
    // runner's 10 s limit at OG scale (36,956 candidates, 42,007 index entries).
    expect(runner.mock.calls.filter(([, args]) => args.includes("check-ignore"))).toEqual([]);
  });
});

describe("FR-NODE-292 AC-2 — tracked, not yet added and re-included tests stay", () => {
  it("FR-NODE-292 AC-2: keeps a tracked file under an ignored path, an unadded test, a re-included path and plain build-named segments", async () => {
    const root = await workspace("fr-node-292-ac2");
    await put(root, ".gitignore", "build/\n!**/src/test/**/build/\n");
    const cite = "// FR-ARCH-001 AC-1\n";
    await put(root, "build/tracked/KeptTest.java", cite);
    await put(root, "src/test/java/com/x/build/BuildTest.java", cite);
    await commit(root, ".gitignore", "build/tracked/KeptTest.java", "src/test/java/com/x/build/BuildTest.java");
    await put(root, "src/test/java/NewTest.java", cite);
    await put(root, "out/test/OutTest.java", cite);
    await put(root, "target/test/TargetTest.java", cite);
    await put(root, "bin/test/BinTest.java", cite);
    await put(root, "build/untracked/GoneTest.java", cite);
    const value = await report(root);
    expect(citedFiles(value, "AC-1")).toEqual([
      "bin/test/BinTest.java",
      "build/tracked/KeptTest.java",
      "out/test/OutTest.java",
      "src/test/java/NewTest.java",
      "src/test/java/com/x/build/BuildTest.java",
      "target/test/TargetTest.java"
    ]);
    expect(value.ignoreRules).toBe("git");
    expect(value.ignoredTestFileCount).toBe(1);
  });
});

describe("FR-NODE-292 AC-3 — the report says how many were left out", () => {
  it("FR-NODE-292 AC-3: the JSON carries ignoredTestFileCount and ignoreRules, and testFileCount counts the kept files", async () => {
    const root = await buildOutputWorkspace("fr-node-292-ac3-json");
    const value = await report(root);
    expect(value.ignoreRules).toBe("git");
    expect(value.ignoredTestFileCount).toBe(2);
    expect(value.testFileCount).toBe(1);
  });

  it("FR-NODE-292 AC-3: a repository whose rules ignore no candidate still reports the rules as applied", async () => {
    const root = await workspace("fr-node-292-ac3-none-ignored");
    await put(root, "src/test/java/com/x/FooTest.java", "// FR-ARCH-001 AC-1 AC-2\n");
    const value = await report(root);
    expect(value.ignoreRules).toBe("git");
    expect(value.ignoredTestFileCount).toBe(0);
    expect(value.testFileCount).toBe(1);
    expect(value.passed).toBe(true);
  });

  it("FR-NODE-292 AC-3: the text header reads (<n> test files, <m> ignored)", async () => {
    const root = await buildOutputWorkspace("fr-node-292-ac3-text");
    const { code, stdout } = await coverage(root);
    expect(code).toBe(0);
    expect(stdout.split("\n")[0]).toContain("(ids FR-ARCH-001, 1 test files, 2 ignored)");
  });

  it("FR-NODE-292 AC-3: check_test_sufficiency answers the same", async () => {
    const root = await buildOutputWorkspace("fr-node-292-ac3-mcp");
    const answer = (await createMcpServer({ root, rootSource: "server-cwd-discovery" }).callTool("check_test_sufficiency", { ids: ["FR-ARCH-001"] })) as {
      ok: boolean;
      value: Report;
      mcpWorkspace: { workspaceRoot: string };
    };
    expect(answer.ok, JSON.stringify(answer)).toBe(true);
    expect(path.resolve(answer.mcpWorkspace.workspaceRoot)).toBe(path.resolve(root));
    expect(answer.value.ignoreRules).toBe("git");
    expect(answer.value.ignoredTestFileCount).toBe(2);
    expect(answer.value.testFileCount).toBe(1);
    expect(answer.value.passed).toBe(false);
  });

  it("FR-NODE-292 AC-3: files matched by --test-glob pass through the same filter", async () => {
    const root = await buildOutputWorkspace("fr-node-292-ac3-glob");
    const value = await report(root, "--test-glob", "**/*.bin", "--test-glob", "**/*.class");
    expect(value.testFileCount).toBe(0);
    expect(value.ignoredTestFileCount).toBe(2);
    expect(citedFiles(value, "AC-1")).toEqual([]);
  });
});

describe("FR-NODE-292 AC-4 — without git the search counts as before and says so", () => {
  it("FR-NODE-292 AC-4: git that cannot be run leaves every candidate counted and reports none", async () => {
    const root = await buildOutputWorkspace("fr-node-292-ac4-nogit");
    const saved = process.env.PATH;
    process.env.PATH = "";
    try {
      const value = await report(root);
      expect(value.ignoreRules).toBe("none");
      expect(value.ignoredTestFileCount).toBe(0);
      expect(value.testFileCount).toBe(3);
      expect(citedFiles(value, "AC-1")).toEqual(["bin/test/com/x/AuditRetentionScheduleTest.class", "build/test-results/test/binary/results.bin"]);
      const { code, stdout } = await coverage(root);
      expect(code).toBe(0);
      expect(stdout.split("\n")[0]).toContain("(ids FR-ARCH-001, 3 test files, git ignore rules not applied: unavailable)");
    } finally {
      process.env.PATH = saved;
    }
  });

  it("FR-NODE-292 AC-4: git that fails for the root leaves every candidate counted and reports none", async () => {
    const root = await buildOutputWorkspace("fr-node-292-ac4-fail");
    // A `.git` file naming a missing directory: the root still holds `.git`, and git refuses it.
    await rm(path.join(root, ".git"), { recursive: true, force: true, maxRetries: 5 });
    await writeFile(path.join(root, ".git"), "gitdir: ./missing-git-dir\n");
    expect(path.resolve((await resolveProjectRoot(root)).root)).toBe(path.resolve(root));
    const value = await report(root);
    expect(value.ignoreRules).toBe("none");
    expect(value.ignoredTestFileCount).toBe(0);
    expect(value.testFileCount).toBe(3);
  });

  it("FR-NODE-292 AC-4: git that refuses the root before reading a large candidate list does not fail the call", async () => {
    const root = await workspace("fr-node-292-ac4-large");
    // More candidate bytes than a pipe holds, so git exits while the list is still being written.
    const names = Array.from({ length: 3000 }, (_, index) => `test/many/candidate-${String(index).padStart(4, "0")}-padding.test.ts`);
    for (let start = 0; start < names.length; start += 200) {
      await Promise.all(names.slice(start, start + 200).map((name) => put(root, name, "x\n")));
    }
    await rm(path.join(root, ".git"), { recursive: true, force: true, maxRetries: 5 });
    await writeFile(path.join(root, ".git"), "gitdir: ./missing-git-dir\n");
    expect(path.resolve((await resolveProjectRoot(root)).root)).toBe(path.resolve(root));
    const value = await report(root);
    expect(value.ignoreRules).toBe("none");
    expect(value.testFileCount).toBe(3000);
  });
});

describe("FR-NODE-292 AC-5 — the root's own repository answers", () => {
  it("FR-NODE-292 AC-5: an inherited GIT_DIR naming another repository does not answer the query", async () => {
    const root = await buildOutputWorkspace("fr-node-292-ac5");
    // Another repository whose index tracks the very path the root ignores: asked there, git would
    // report it as tracked and so not ignored.
    const other = await workspace("fr-node-292-ac5-other");
    await put(other, "build/test-results/test/binary/results.bin", BINARY);
    await commit(other, "build/test-results/test/binary/results.bin");
    await put(other, "bin/test/com/x/AuditRetentionScheduleTest.class", BINARY);
    await commit(other, "bin/test/com/x/AuditRetentionScheduleTest.class");
    const saved = process.env.GIT_DIR;
    process.env.GIT_DIR = path.join(other, ".git");
    try {
      const value = await report(root);
      expect(value.ignoreRules).toBe("git");
      expect(value.ignoredTestFileCount).toBe(2);
      expect(citedFiles(value, "AC-1")).toEqual([]);
    } finally {
      if (saved === undefined) delete process.env.GIT_DIR;
      else process.env.GIT_DIR = saved;
    }
  });

  it("FR-NODE-292 AC-5: the query goes through the root-facts git runner", async () => {
    const root = await buildOutputWorkspace("fr-node-292-ac5-runner");
    const runner = vi.mocked(rootFacts.git);
    runner.mockClear();
    const saved = process.env.GIT_DIR;
    process.env.GIT_DIR = path.join(root, "no-such-git-dir");
    try {
      await report(root);
    } finally {
      if (saved === undefined) delete process.env.GIT_DIR;
      else process.env.GIT_DIR = saved;
    }
    const ask = runner.mock.calls.find(([, args]) => args.includes("ls-files"));
    expect(ask?.[0]).toBe(root);
    expect(ask?.[2], "the runner is given an environment of its own").toBeDefined();
    expect(Object.keys(ask?.[2] ?? {}).filter((name) => /^GIT_(DIR|WORK_TREE|INDEX_FILE|COMMON_DIR|OBJECT_DIRECTORY)$/i.test(name))).toEqual([]);
  });
});

/**
 * What `git check-ignore` keeps today, asked about the candidates it can judge: the search of this
 * requirement before 5.5.2, kept as the oracle the listing must match. Candidates inside a submodule
 * are left to the caller, since check-ignore refuses them.
 */
async function checkIgnoreKeeps(root: string, candidates: readonly string[]): Promise<string[]> {
  if (candidates.length === 0) return [];
  const out = await rawGitStdin(root, ["check-ignore", "-z", "--stdin"], candidates.map((file) => `${file}\0`).join("")).catch((error: { code?: number; stdout?: string }) => {
    if (error.code === 1) return "";
    throw error;
  });
  const ignored = new Set(out.split("\0").filter((file) => file !== ""));
  return candidates.filter((file) => !ignored.has(file));
}

/**
 * Every case the listing has to judge as check-ignore does, in one repository: tracked under an
 * ignored path, unadded, `!` re-included, ignored by `.git/info/exclude`, an untracked nested
 * repository with an outer rule reaching into it, an ignored nested repository, and a submodule.
 */
async function equivalenceWorkspace(root: string): Promise<void> {
  const cite = "// FR-ARCH-001 AC-1\n";
  await put(root, ".gitignore", "build/\n!**/src/test/**/build/\n*.gen.test.ts\nvendor-ignored/\n");
  await put(root, "build/tracked/KeptTest.java", cite);
  await put(root, "src/test/java/build/BuildTest.java", cite);
  await commit(root, ".gitignore", "build/tracked/KeptTest.java", "src/test/java/build/BuildTest.java");
  await put(root, path.join(".git", "info", "exclude"), "out/\n");
  await put(root, "src/test/java/NewTest.java", cite);
  await put(root, "src/test/java/build/AlsoBuildTest.java", cite);
  await put(root, "build/untracked/GoneTest.java", BINARY);
  await put(root, "out/test/OutTest.class", BINARY);
  await put(root, "test/a.gen.test.ts", cite);
  await put(root, "test/plain.test.ts", cite);
  // An untracked nested repository: the listing shows only `nested/`.
  await put(root, "nested/test/kept.test.ts", cite);
  await put(root, "nested/test/dropped.gen.test.ts", cite);
  await rawGit(path.join(root, "nested"), "init", "--initial-branch", "main");
  // An ignored nested repository: absent from the listing, ignored by check-ignore.
  await put(root, "vendor-ignored/test/v.test.ts", cite);
  await rawGit(path.join(root, "vendor-ignored"), "init", "--initial-branch", "main");
}

describe("FR-NODE-292 AC-2 AC-7 — the listing keeps exactly what check-ignore keeps", () => {
  it("FR-NODE-292 AC-2 AC-7: tracked, unadded, re-included, excluded, nested-repository and ignored-nested cases match check-ignore", async () => {
    const root = await workspace("fr-node-292-equivalence");
    await equivalenceWorkspace(root);
    const candidates = await listTestFiles(root);
    const expected = await checkIgnoreKeeps(root, candidates);
    const search = await findTestFiles(root);
    expect(search.ignoreRules).toBe("git");
    expect(search.files).toEqual(expected);
    expect(search.ignoredCount).toBe(candidates.length - expected.length);
    // The table the oracle produced, spelled out so a change in git's own answer shows here too.
    expect(search.files).toEqual([
      "build/tracked/KeptTest.java",
      "nested/test/kept.test.ts",
      "src/test/java/NewTest.java",
      "src/test/java/build/AlsoBuildTest.java",
      "src/test/java/build/BuildTest.java",
      "test/plain.test.ts"
    ]);
  });

  it("FR-NODE-292 AC-7: only the candidates inside an untracked nested repository are sent to check-ignore", async () => {
    const root = await workspace("fr-node-292-nested-ask");
    await equivalenceWorkspace(root);
    const runner = vi.mocked(rootFacts.git);
    runner.mockClear();
    await findTestFiles(root);
    const asks = runner.mock.calls.filter(([, args]) => args.includes("check-ignore"));
    expect(asks).toHaveLength(1);
    expect((asks[0]?.[3] ?? "").split("\0").filter((file) => file !== "")).toEqual(["nested/test/dropped.gen.test.ts", "nested/test/kept.test.ts"]);
  });

  it("FR-NODE-292 AC-7: a failing check-ignore for the nested candidates reports the rules as not applied", async () => {
    const root = await workspace("fr-node-292-nested-fail");
    await equivalenceWorkspace(root);
    const runner = vi.mocked(rootFacts.git);
    const actual = await vi.importActual<typeof rootFacts>("../../../src/core/root-facts.js");
    runner.mockImplementation(async (cwd, args, env, input, timeoutMs) =>
      args.includes("check-ignore") ? { code: 128, stdout: "", stderr: "fatal: refused\n" } : actual.git(cwd, args, env, input, timeoutMs)
    );
    try {
      const search = await findTestFiles(root);
      expect(search.ignoreRules).toBe("none");
      expect(search.ignoredCount).toBe(0);
      expect(search.files).toEqual(await listTestFiles(root));
      expect(search.ignoreRulesReason).toEqual({ kind: "exit", status: 128, stderr: "fatal: refused" });
    } finally {
      runner.mockReset();
      runner.mockImplementation(actual.git);
    }
  });

  it("FR-NODE-292 AC-7: a submodule candidate is kept and the rules still apply to every other candidate", async () => {
    const root = await buildOutputWorkspace("fr-node-292-submodule");
    await put(root, "sub/test/c.test.ts", "// FR-ARCH-001 AC-1\n");
    const sub = path.join(root, "sub");
    await rawGit(sub, "init", "--initial-branch", "main");
    await rawGit(sub, "config", "user.name", "t");
    await rawGit(sub, "config", "user.email", "t@example.invalid");
    await rawGit(sub, "config", "commit.gpgsign", "false");
    await rawGit(sub, "add", "--", ".");
    await rawGit(sub, "commit", "-m", "sub");
    await rawGit(root, "update-index", "--add", "--cacheinfo", `160000,${await rawGit(sub, "rev-parse", "HEAD")},sub`);
    // check-ignore refuses a path inside a submodule, which used to turn the whole search to none.
    await expect(rawGitStdin(root, ["check-ignore", "-z", "--stdin"], "sub/test/c.test.ts\0")).rejects.toMatchObject({ code: 128 });
    const value = await report(root);
    expect(value.ignoreRules).toBe("git");
    expect(value.ignoredTestFileCount).toBe(2);
    expect(citedFiles(value, "AC-1")).toEqual(["sub/test/c.test.ts"]);
  });
});

describe("FR-NODE-292 AC-2 — a tracked test whose directory differs from the index only in case stays", () => {
  // On a case-insensitive filesystem git treats `Tests/b.test.ts` on disk as the tracked
  // `tests/b.test.ts`; the listing spells it as the index does. A clone of a history holding both
  // `Tests/` and `tests/` lands this way with a clean status.
  it("FR-NODE-292 AC-2: keeps a tracked test whose directory was renamed only in case, as check-ignore does", async () => {
    const root = await workspace("fr-node-292-case");
    await put(root, "tests/b.test.ts", "// FR-ARCH-001 AC-1\n");
    await commit(root, "tests/b.test.ts");
    const { rename } = await import("node:fs/promises");
    await rename(path.join(root, "tests"), path.join(root, "tests-renaming"));
    await rename(path.join(root, "tests-renaming"), path.join(root, "Tests"));
    const candidates = await listTestFiles(root);
    expect(candidates).toEqual(["Tests/b.test.ts"]);
    const search = await findTestFiles(root);
    expect(search.ignoreRules).toBe("git");
    expect(search.files).toEqual(await checkIgnoreKeeps(root, candidates));
    expect(search.files).toEqual(["Tests/b.test.ts"]);
  });
});

describe("FR-NODE-292 AC-8 — a linked worktree applies the rules as the main work tree does", () => {
  it("FR-NODE-292 AC-8: a worktree whose .git is a file keeps what check-ignore keeps there", async () => {
    const host = await workspace("fr-node-292-wt-host");
    await put(host, ".gitignore", "build/\nbin/\n");
    await commit(host, ".gitignore");
    const tree = await linkedWorktree(host, "fr-node-292-wt", "lane");
    expect(path.resolve(await rawGit(tree, "rev-parse", "--show-toplevel"))).toBe(path.resolve(tree));
    const cite = "// FR-ARCH-001 AC-1\n";
    await put(tree, "src/test/java/FooTest.java", cite);
    await put(tree, "build/test-results/test/binary/results.bin", BINARY);
    await put(tree, "bin/test/X.class", BINARY);
    const candidates = await listTestFiles(tree);
    const search = await findTestFiles(tree);
    expect(search.ignoreRules).toBe("git");
    expect(search.files).toEqual(await checkIgnoreKeeps(tree, candidates));
    expect(search.files).toEqual(["src/test/java/FooTest.java"]);
    expect(search.ignoredCount).toBe(2);
  });
});
