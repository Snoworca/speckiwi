import { link, mkdir, readFile, readdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  assertPinned,
  PIN_LIMITS,
  pinHandoff,
  runGit,
  type GitRunner,
  type PinnedHandoff
} from "../../../src/core/orchestrator/pinning.js";
import { cleanupFixtures, commitAll, initRepo, rawGit, rawGitStdin } from "./support/git-fixture.js";
import { recordHarvestCwd } from "./support/harvest-cwd.js";

recordHarvestCwd("HV-1");

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const PINNING_SOURCE = path.join(REPO_ROOT, "src", "core", "orchestrator", "pinning.ts");

const ROOT_DOC = "handoff/lane-1.md";
const NESTED_DOC = "handoff/nested/lane-2.md";

/**
 * Every `git` invocation made by the module under test, in order. `pinHandoff` and `assertPinned`
 * take an injected `GitRunner`; this one delegates to the exported production runner, so the cases
 * exercise the real spawn path while still being able to prove what was spawned and from where.
 *
 * @req FR-NODE-101 AC-2 — no invocation may be spawned without an explicit `cwd`.
 */
const invocations: { cwd: string; args: readonly string[] }[] = [];
const recordingGit: GitRunner = (cwd, args, maxBuffer) => {
  invocations.push({ cwd, args: [...args] });
  return runGit(cwd, args, maxBuffer);
};

async function handoffRepo(input?: {
  root?: string | Uint8Array;
  nested?: string | Uint8Array | false;
}): Promise<{ root: string; head: string }> {
  const root = await initRepo("pinning");
  await mkdir(path.join(root, "handoff", "nested"), { recursive: true });
  await writeFile(path.join(root, ROOT_DOC), input?.root ?? "# Lane 1 handoff\n\nAuthored by the orchestrator.\n");
  if (input?.nested !== false) {
    await writeFile(path.join(root, NESTED_DOC), input?.nested ?? "# Lane 2 handoff\n\n중첩 범위 지침.\n");
  }
  const head = await commitAll(root, "test: seed orchestrator handoff documents");
  return { root, head };
}

function paths(nested = true): string[] {
  return nested ? [NESTED_DOC, ROOT_DOC] : [ROOT_DOC];
}

async function replaceHeadWithTree(
  root: string,
  treeInput: string,
  nestedTreeInputs: readonly { token: string; input: string }[] = []
): Promise<string> {
  let resolved = treeInput;
  for (const nested of nestedTreeInputs) {
    const tree = await rawGitStdin(root, ["mktree"], nested.input);
    resolved = resolved.replaceAll(nested.token, tree);
  }
  const tree = await rawGitStdin(root, ["mktree"], resolved);
  const parent = await rawGit(root, "rev-parse", "HEAD");
  const commit = await rawGitStdin(root, ["commit-tree", tree, "-p", parent], "test: synthetic handoff tree\n");
  await rawGit(root, "update-ref", "HEAD", commit);
  return commit;
}

function expectPinRefusal(value: Promise<unknown>): Promise<unknown> {
  return expect(value).rejects.toMatchObject({ gate: "handoff-pin-untrusted" });
}

/** A tracked, currently clean repository file, so case 3 pins the real checkout without a dirty read. */
async function cleanTrackedRepositoryFile(): Promise<string | null> {
  const porcelain = await rawGit(REPO_ROOT, "status", "--porcelain=v1");
  const dirty = new Set(
    porcelain.split("\n").map((line) => line.slice(3).trim().replaceAll("\\", "/")).filter(Boolean)
  );
  for (const candidate of ["package.json", "tsconfig.json", "README.md", "LICENSE", "CLAUDE.md"]) {
    if (dirty.has(candidate)) continue;
    const tracked = await rawGit(REPO_ROOT, "ls-files", "--", candidate);
    if (tracked === candidate) return candidate;
  }
  return null;
}

afterAll(cleanupFixtures);

describe("FR-NODE-101 handoff pinning harvested without trusted-git", { timeout: 120_000 }, () => {
  // -- AC-1: the branch's 15 behavioural cases, re-run against the replaced dependency. ------------

  it("case 1: pins the requested documents in deterministic order with real blob oids", async () => {
    const run = await handoffRepo();
    const pinned = await pinHandoff({ root: run.root, expectedHead: run.head, documentPaths: paths() }, recordingGit);

    expect(pinned.schemaVersion).toBe(1);
    expect(pinned.documents.map((document) => document.path)).toEqual([ROOT_DOC, NESTED_DOC]);
    expect(pinned.documents[1]?.text).toContain("중첩 범위");
    expect(pinned.documents.every((document) => /^[0-9a-f]{40}$|^[0-9a-f]{64}$/.test(document.gitBlobOid))).toBe(true);
    expect(pinned.documents.every((document) => /^[0-9a-f]{64}$/.test(document.sha256))).toBe(true);
    expect(/^[0-9a-f]{64}$/.test(pinned.topologySha256)).toBe(true);
    expect(Object.isFrozen(pinned)).toBe(true);
    expect(Object.isFrozen(pinned.documents)).toBe(true);
    expect(pinned.documents.every(Object.isFrozen)).toBe(true);
    await expect(assertPinned(pinned, recordingGit)).resolves.toBeUndefined();
  });

  it("case 2: accepts a clean CRLF checkout while recording the LF git blob text", async () => {
    const run = await handoffRepo({ nested: false });
    await writeFile(path.join(run.root, ".gitattributes"), "handoff/lane-1.md text eol=crlf\n", "utf8");
    await rawGit(run.root, "config", "core.autocrlf", "true");
    const head = await commitAll(run.root, "test: require a CRLF checkout");
    const absolute = path.join(run.root, ROOT_DOC);
    await rm(absolute);
    await rawGit(run.root, "checkout", head, "--", ROOT_DOC);
    expect(await readFile(absolute, "utf8")).toContain("\r\n");

    const pinned = await pinHandoff({ root: run.root, expectedHead: head, documentPaths: paths(false) }, recordingGit);
    expect(pinned.documents).toHaveLength(1);
    expect(pinned.documents[0]?.text).not.toContain("\r\n");
    expect(pinned.documents[0]?.text).toContain("Lane 1 handoff");
    await expect(assertPinned(pinned, recordingGit)).resolves.toBeUndefined();
  });

  it("case 3: pins a document from the actual repository checkout under its configured EOL policy", async ({ skip }) => {
    const candidate = await cleanTrackedRepositoryFile();
    if (candidate === null) {
      skip("no tracked repository file among the candidate set is currently clean in this working tree");
      return;
    }
    const head = await rawGit(REPO_ROOT, "rev-parse", "HEAD");
    const pinned = await pinHandoff(
      { root: REPO_ROOT, expectedHead: head, documentPaths: [candidate] },
      recordingGit
    );
    expect(pinned.documents.map((document) => document.path)).toEqual([candidate]);
    expect(pinned.documents[0]?.byteLength).toBeGreaterThan(0);
    await expect(assertPinned(pinned, recordingGit)).resolves.toBeUndefined();
  });

  it("case 4: refuses a worktree byte mutation while HEAD remains pinned", async () => {
    const run = await handoffRepo();
    const pinned = await pinHandoff({ root: run.root, expectedHead: run.head, documentPaths: paths() }, recordingGit);
    await writeFile(path.join(run.root, NESTED_DOC), "# tampered\n", "utf8");
    await expectPinRefusal(assertPinned(pinned, recordingGit));
  });

  it("case 5: refuses a same-byte leaf inode replacement", async () => {
    const run = await handoffRepo();
    const pinned = await pinHandoff({ root: run.root, expectedHead: run.head, documentPaths: paths() }, recordingGit);
    const leaf = path.join(run.root, NESTED_DOC);
    const replacement = `${leaf}.replacement`;
    await writeFile(replacement, await readFile(leaf));
    await rm(leaf);
    await rename(replacement, leaf);
    await expectPinRefusal(assertPinned(pinned, recordingGit));
  });

  it("case 6: refuses a same-byte ancestor directory replacement", async () => {
    const run = await handoffRepo();
    const pinned = await pinHandoff({ root: run.root, expectedHead: run.head, documentPaths: paths() }, recordingGit);
    const nestedDir = path.join(run.root, "handoff", "nested");
    const replacement = path.join(run.root, "handoff", "nested-replacement");
    await mkdir(replacement);
    await writeFile(path.join(replacement, "lane-2.md"), await readFile(path.join(nestedDir, "lane-2.md")));
    await rename(nestedDir, path.join(run.root, "handoff", "nested-original"));
    await rename(replacement, nestedDir);
    await expectPinRefusal(assertPinned(pinned, recordingGit));
  });

  it("case 7: refuses a leaf symlink substitution", async ({ skip }) => {
    const run = await handoffRepo();
    const pinned = await pinHandoff({ root: run.root, expectedHead: run.head, documentPaths: paths() }, recordingGit);
    const leaf = path.join(run.root, NESTED_DOC);
    await rm(leaf);
    try {
      await symlink(path.join(run.root, ROOT_DOC), leaf, "file");
    } catch (error) {
      skip(`file symlink creation is not permitted for this process: ${(error as NodeJS.ErrnoException).code}`);
      return;
    }
    await expectPinRefusal(assertPinned(pinned, recordingGit));
  });

  it("case 8: refuses a hardlinked leaf", async ({ skip }) => {
    const run = await handoffRepo();
    const pinned = await pinHandoff({ root: run.root, expectedHead: run.head, documentPaths: paths() }, recordingGit);
    const leaf = path.join(run.root, NESTED_DOC);
    await rm(leaf);
    try {
      await link(path.join(run.root, ROOT_DOC), leaf);
    } catch (error) {
      skip(`hardlink creation is not permitted on this filesystem: ${(error as NodeJS.ErrnoException).code}`);
      return;
    }
    await expectPinRefusal(assertPinned(pinned, recordingGit));
  });

  it("case 9: refuses an ancestor junction or directory symlink", async ({ skip }) => {
    const run = await handoffRepo();
    const pinned = await pinHandoff({ root: run.root, expectedHead: run.head, documentPaths: paths() }, recordingGit);
    const nestedDir = path.join(run.root, "handoff", "nested");
    const moved = path.join(run.root, "handoff", "nested-real");
    await rename(nestedDir, moved);
    try {
      await symlink(moved, nestedDir, process.platform === "win32" ? "junction" : "dir");
    } catch (error) {
      skip(`directory reparse point creation is not permitted for this process: ${(error as NodeJS.ErrnoException).code}`);
      return;
    }
    await expectPinRefusal(assertPinned(pinned, recordingGit));
  });

  it("case 10: refuses invalid UTF-8, an embedded NUL and an oversized blob", async () => {
    const invalid = await handoffRepo({ root: Buffer.from([0xc3, 0x28]), nested: false });
    await expectPinRefusal(
      pinHandoff({ root: invalid.root, expectedHead: invalid.head, documentPaths: paths(false) }, recordingGit)
    );

    const nul = await handoffRepo({ root: Buffer.from("# valid prefix\n\0hidden\n", "utf8"), nested: false });
    await expectPinRefusal(
      pinHandoff({ root: nul.root, expectedHead: nul.head, documentPaths: paths(false) }, recordingGit)
    );

    const oversized = await handoffRepo({
      root: Buffer.alloc(PIN_LIMITS.maxDocumentBytes + 1, 0x61),
      nested: false
    });
    await expectPinRefusal(
      pinHandoff({ root: oversized.root, expectedHead: oversized.head, documentPaths: paths(false) }, recordingGit)
    );
  });

  it("case 11: refuses more requested documents than the fixed count bound", async () => {
    const run = await handoffRepo({ nested: false });
    const requested: string[] = [ROOT_DOC];
    for (let index = 0; index < PIN_LIMITS.maxDocuments; index += 1) {
      const relative = `handoff/extra-${String(index).padStart(2, "0")}.md`;
      await writeFile(path.join(run.root, ...relative.split("/")), `# ${index}\n`, "utf8");
      requested.push(relative);
    }
    const head = await commitAll(run.root, "test: exceed the handoff document count bound");
    expect(requested.length).toBeGreaterThan(PIN_LIMITS.maxDocuments);
    await expectPinRefusal(pinHandoff({ root: run.root, expectedHead: head, documentPaths: requested }, recordingGit));
  });

  it("case 12: refuses case-colliding and noncanonical requested paths", async () => {
    const run = await handoffRepo({ nested: false });
    await expectPinRefusal(
      pinHandoff({ root: run.root, expectedHead: run.head, documentPaths: [ROOT_DOC, "handoff/Lane-1.md"] }, recordingGit)
    );
    for (const noncanonical of ["/handoff/lane-1.md", "handoff\\lane-1.md", "handoff/../handoff/lane-1.md", "handoff/./lane-1.md", ""]) {
      await expectPinRefusal(
        pinHandoff({ root: run.root, expectedHead: run.head, documentPaths: [noncanonical] }, recordingGit)
      );
    }
  });

  it("case 13: refuses a requested path below a case-insensitive .git administration segment", async () => {
    const run = await handoffRepo({ nested: false });
    for (const forbidden of [".git/config", ".GIT/handoff.md", "handoff/.Git/lane.md"]) {
      await expectPinRefusal(
        pinHandoff({ root: run.root, expectedHead: run.head, documentPaths: [forbidden] }, recordingGit)
      );
    }
  });

  it("case 14: refuses a non-regular git mode for a requested document", async () => {
    const run = await handoffRepo({ nested: false });
    const blob = await rawGit(run.root, "rev-parse", "HEAD:handoff/lane-1.md");
    const head = await replaceHeadWithTree(
      run.root,
      `040000 tree __HANDOFF__\thandoff\n`,
      [{ token: "__HANDOFF__", input: `120000 blob ${blob}\tlane-1.md\n` }]
    );
    await expectPinRefusal(pinHandoff({ root: run.root, expectedHead: head, documentPaths: paths(false) }, recordingGit));
  });

  it("case 15: refuses a forged snapshot and a HEAD moved after the pin", async () => {
    const run = await handoffRepo();
    const pinned = await pinHandoff({ root: run.root, expectedHead: run.head, documentPaths: paths() }, recordingGit);
    const forged = { ...pinned, expectedHead: "0".repeat(run.head.length) } as PinnedHandoff;
    await expectPinRefusal(assertPinned(forged, recordingGit));

    await writeFile(path.join(run.root, "handoff", "extra.txt"), "new commit\n", "utf8");
    await commitAll(run.root, "test: move HEAD after the pin");
    await expectPinRefusal(assertPinned(pinned, recordingGit));
  });

  // -- AC-3: the 16th case, and the absence of the AGENTS.md discovery half. ----------------------

  it("case 16: pins and re-proves the orchestrator's own authored handoff, not AGENTS.md", async () => {
    const run = await initRepo("pinning-authored");
    await mkdir(path.join(run, ".kiwi", "orchestrator", "handoff"), { recursive: true });
    const authored = ".kiwi/orchestrator/handoff/wave-1-lane-1.md";
    await writeFile(path.join(run, ...authored.split("/")), "# Wave 1 / lane 1\n\nAuthored by the orchestrator.\n");
    await writeFile(path.join(run, "AGENTS.md"), "# repository agent notes, which must NOT be discovered\n");
    const head = await commitAll(run, "test: seed an authored handoff beside AGENTS.md");

    const pinned = await pinHandoff({ root: run, expectedHead: head, documentPaths: [authored] }, recordingGit);
    expect(pinned.documents.map((document) => document.path)).toEqual([authored]);
    expect(pinned.documents.some((document) => document.path.toLowerCase().endsWith("agents.md"))).toBe(false);
    await expect(assertPinned(pinned, recordingGit)).resolves.toBeUndefined();
  });

  it("exposes no AGENTS.md discovery entry point", async () => {
    const module = await import("../../../src/core/orchestrator/pinning.js");
    const source = await readFile(PINNING_SOURCE, "utf8");

    expect(source).toContain("cat-file");
    expect(Object.keys(module).sort()).toEqual(["HandoffPinError", "PIN_LIMITS", "assertPinned", "pinHandoff", "runGit"]);
    expect(source.toLowerCase()).not.toContain("agents.md");
    expect(source).not.toMatch(/\bdiscover/i);
  });

  // -- AC-1 second half and AC-2: no trusted-git, and never a cwd-less spawn. ---------------------

  it("reaches no trusted-git.ts export from the pinning module or its import graph", async () => {
    const source = await readFile(PINNING_SOURCE, "utf8");
    expect(source).toContain("ls-tree");
    expect(source).not.toContain("trusted-git");
    expect(source).not.toContain("runTrustedGit");
    expect(source).not.toContain("trustedGitInvocation");

    const localImports = [...source.matchAll(/^import[^;]*?from\s+"(\.[^"]+)"/gmu)].map((match) => match[1]!);
    expect(localImports).toEqual([]);

    const orchestratorFiles = await readdir(path.join(REPO_ROOT, "src", "core", "orchestrator"));
    expect(orchestratorFiles).toContain("pinning.ts");
  });

  /**
   * The discriminator `06` §5.1 Defect B used: the same guard accepted from a cwd outside any
   * repository and rejected from inside a worktree, because the spawn inherited the caller's
   * directory. A runner bound to its `cwd` argument reads the repository it was handed, and the
   * process's own repository — the SpecKiwi checkout this suite runs in — cannot influence it.
   */
  it("binds each git invocation to its cwd argument rather than to the calling process", async () => {
    const run = await handoffRepo({ nested: false });
    const processHead = await rawGit(REPO_ROOT, "rev-parse", "HEAD");
    expect(run.head).not.toBe(processHead);

    const observed = (await runGit(run.root, ["rev-parse", "--verify", "HEAD^{commit}"], 64 * 1024))
      .toString("utf8")
      .trim();
    expect(observed).toBe(run.head);
  });

  it("passes an explicit absolute cwd on every git invocation the harvested path makes", () => {
    expect(invocations.length).toBeGreaterThan(20);
    for (const invocation of invocations) {
      expect(typeof invocation.cwd).toBe("string");
      expect(invocation.cwd.length).toBeGreaterThan(0);
      expect(path.isAbsolute(invocation.cwd)).toBe(true);
    }
    expect(invocations.some((invocation) => invocation.args[0] === "cat-file")).toBe(true);
    expect(invocations.some((invocation) => invocation.args[0] === "ls-tree")).toBe(true);
  });
});
