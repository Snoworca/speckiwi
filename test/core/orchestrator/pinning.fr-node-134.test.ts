import { createHash } from "node:crypto";
import { link, mkdir, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  assertPinned,
  HandoffPinError,
  PIN_LIMITS,
  pinHandoff,
  runGit
} from "../../../src/core/orchestrator/pinning.js";
import { cleanupFixtures, commitAll, initRepo, rawGit } from "./support/git-fixture.js";

const DOC = "handoff/lane-1.md";
const NESTED = "handoff/nested/lane-2.md";
const BODY = "# Lane 1 handoff\n\nThe orchestrator authored this.\n";

async function pinnedFixture(): Promise<{ root: string; head: string }> {
  const root = await initRepo("pin-e35");
  await mkdir(path.join(root, "handoff", "nested"), { recursive: true });
  await writeFile(path.join(root, DOC), BODY);
  await writeFile(path.join(root, NESTED), "# Lane 2 handoff\n");
  return { root, head: await commitAll(root, "test: seed handoff documents") };
}

/**
 * @req FR-NODE-134 AC-3 — the five substitution classes, asserted independently. The count is
 * load-bearing: the requirement names five and the table below is what the suite iterates.
 */
const SUBSTITUTION_CLASSES = [
  {
    name: "inode replacement",
    async substitute(root: string): Promise<void> {
      const leaf = path.join(root, NESTED);
      const replacement = `${leaf}.replacement`;
      await writeFile(replacement, await readFile(leaf));
      await rm(leaf);
      await rename(replacement, leaf);
    }
  },
  {
    name: "ancestor-directory replacement",
    async substitute(root: string): Promise<void> {
      const nested = path.join(root, "handoff", "nested");
      const replacement = path.join(root, "handoff", "nested-replacement");
      await mkdir(replacement);
      await writeFile(path.join(replacement, "lane-2.md"), await readFile(path.join(nested, "lane-2.md")));
      await rename(nested, path.join(root, "handoff", "nested-original"));
      await rename(replacement, nested);
    }
  },
  {
    name: "symlink substitution",
    async substitute(root: string): Promise<void> {
      const leaf = path.join(root, NESTED);
      await rm(leaf);
      await symlink(path.join(root, DOC), leaf, "file");
    }
  },
  {
    name: "hardlink substitution",
    async substitute(root: string): Promise<void> {
      const leaf = path.join(root, NESTED);
      await rm(leaf);
      await link(path.join(root, DOC), leaf);
    }
  },
  {
    name: "windows junction substitution",
    async substitute(root: string): Promise<void> {
      const nested = path.join(root, "handoff", "nested");
      const moved = path.join(root, "handoff", "nested-real");
      await rename(nested, moved);
      await symlink(moved, nested, process.platform === "win32" ? "junction" : "dir");
    }
  }
] as const;

afterAll(cleanupFixtures);

describe("FR-NODE-134 handoff pinning records a real blob oid and resists substitution", { timeout: 120_000 }, () => {
  it("AC-1: records a non-null git_blob_oid equal to git's object id, and a sha256 over the same content", async () => {
    const run = await pinnedFixture();
    const pinned = await pinHandoff({ root: run.root, expectedHead: run.head, documentPaths: [DOC] });
    const document = pinned.documents[0]!;

    const gitOid = await rawGit(run.root, "hash-object", "--", DOC);
    const blobOidFromTree = await rawGit(run.root, "rev-parse", `${run.head}:${DOC}`);
    expect(document.gitBlobOid).toBe(gitOid);
    expect(document.gitBlobOid).toBe(blobOidFromTree);
    expect(document.gitBlobOid).toMatch(/^[0-9a-f]{40}$|^[0-9a-f]{64}$/);

    const content = await readFile(path.join(run.root, DOC));
    expect(document.sha256).toBe(createHash("sha256").update(content).digest("hex"));
    expect(document.byteLength).toBe(content.byteLength);
  });

  it("AC-2: succeeds against an unchanged document and fails on a single changed byte", async () => {
    const run = await pinnedFixture();
    const pinned = await pinHandoff({ root: run.root, expectedHead: run.head, documentPaths: [DOC] });
    await expect(assertPinned(pinned)).resolves.toBeUndefined();

    const mutated = Buffer.from(BODY, "utf8");
    mutated[2] = mutated[2]! === 0x4c ? 0x4d : 0x4c;
    expect(mutated.byteLength).toBe(Buffer.byteLength(BODY, "utf8"));
    await writeFile(path.join(run.root, DOC), mutated);
    await expect(assertPinned(pinned)).rejects.toBeInstanceOf(HandoffPinError);
  });

  it("AC-3: names exactly five substitution classes", () => {
    expect(SUBSTITUTION_CLASSES).toHaveLength(5);
    expect(SUBSTITUTION_CLASSES.map((entry) => entry.name)).toEqual([
      "inode replacement",
      "ancestor-directory replacement",
      "symlink substitution",
      "hardlink substitution",
      "windows junction substitution"
    ]);
  });

  it.for(SUBSTITUTION_CLASSES)("AC-3: refuses the re-proof under $name", async ({ substitute }, { skip }) => {
    const run = await pinnedFixture();
    const pinned = await pinHandoff({ root: run.root, expectedHead: run.head, documentPaths: [DOC, NESTED] });
    try {
      await substitute(run.root);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? "unknown";
      skip(`this substitution class needs a filesystem privilege this process lacks: ${code}`);
      return;
    }
    await expect(assertPinned(pinned)).rejects.toBeInstanceOf(HandoffPinError);
  });

  it("AC-4: invokes plain git with an explicit working directory and never runTrustedGit", async () => {
    const run = await pinnedFixture();
    const seen: { cwd: string; args: readonly string[] }[] = [];
    await pinHandoff({ root: run.root, expectedHead: run.head, documentPaths: [DOC] }, (cwd, args, maxBuffer) => {
      seen.push({ cwd, args: [...args] });
      return runGit(cwd, args, maxBuffer);
    });

    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((call) => path.isAbsolute(call.cwd))).toBe(true);
    expect(seen.map((call) => call.args[0])).toEqual(expect.arrayContaining(["rev-parse", "ls-tree", "cat-file"]));

    const source = await readFile(
      path.join(import.meta.dirname, "..", "..", "..", "src", "core", "orchestrator", "pinning.ts"),
      "utf8"
    );
    expect(source).toContain("execFile");
    expect(source).not.toContain("runTrustedGit");
  });

  it("AC-5: refuses a document exceeding the declared size cap rather than pinning it", async () => {
    const root = await initRepo("pin-e35-cap");
    await mkdir(path.join(root, "handoff"), { recursive: true });
    await writeFile(path.join(root, DOC), Buffer.alloc(PIN_LIMITS.maxDocumentBytes + 1, 0x61));
    const head = await commitAll(root, "test: seed an oversized handoff document");

    await expect(pinHandoff({ root, expectedHead: head, documentPaths: [DOC] }))
      .rejects.toBeInstanceOf(HandoffPinError);

    const withinCap = await initRepo("pin-e35-cap-ok");
    await mkdir(path.join(withinCap, "handoff"), { recursive: true });
    await writeFile(path.join(withinCap, DOC), Buffer.alloc(PIN_LIMITS.maxDocumentBytes, 0x61));
    const okHead = await commitAll(withinCap, "test: seed a document exactly at the cap");
    const pinned = await pinHandoff({ root: withinCap, expectedHead: okHead, documentPaths: [DOC] });
    expect(pinned.documents[0]?.byteLength).toBe(PIN_LIMITS.maxDocumentBytes);
  });
});
