import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

// FR-NODE-091 — a failed upgrade leaves the project as it found it. Every read the migration needs
// happens before its first write, so a document it cannot read stops it with nothing written; the
// lock is taken before any of it. (Init's own failure branch has no live trigger — see
// upgrade-refresh-failure.fr-node-091.test.ts — so it is not driven here.)

const unreadable = { fragment: "" };
vi.mock("../../../src/core/fs/read-text.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/core/fs/read-text.js")>();
  return {
    ...actual,
    readUtf8File: async (filePath: string, root?: string) => {
      if (unreadable.fragment !== "" && filePath.includes(unreadable.fragment)) {
        throw Object.assign(new Error("EACCES: permission denied, read"), { code: "EACCES", path: filePath });
      }
      return actual.readUtf8File(filePath, root);
    }
  };
});

const { initProject } = await import("../../../src/core/bootstrap/init-project.js");
const { upgradeProject } = await import("../../../src/core/bootstrap/upgrade-project.js");
const { renderAgentInstructionSnippet } = await import("../../../src/core/bootstrap/templates.js");
const { resolveProjectRoot } = await import("../../../src/core/project-root.js");

/** A project with work for every repair: a missing index Rules row, a stale agent block, a stale scope row. */
async function projectNeedingRepairs(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "speckiwi-upgrade-atomic-"));
  await mkdir(path.join(root, ".git"), { recursive: true });
  expect((await initProject(await resolveProjectRoot(root), { installSkills: false, registerMcp: false })).ok).toBe(true);
  const indexPath = path.join(root, "docs", "spec", "00.index.md");
  const index = await readFile(indexPath, "utf8");
  await writeFile(indexPath, index.split("\n").filter((line) => !line.startsWith("| Rules |")).join("\n"), "utf8");
  const stale = "SRS-MD-Rules-v2.5.0.md";
  await writeFile(path.join(root, "CLAUDE.md"), `# Notes\n\n${renderAgentInstructionSnippet().replace(/SRS-MD-Rules-v\d+\.\d+\.\d+\.md/g, stale)}\n`, "utf8");
  await writeFile(
    path.join(root, "docs", "spec", "01.alpha.srs.md"),
    ["# Alpha", "", "| Field | Value |", "|---|---|", `| Rules | [SRS-MD Authoring Rules v2.5.0](../rule/${stale}) |`, ""].join("\n"),
    "utf8"
  );
  await writeFile(path.join(root, "docs", "spec", "02.locked.srs.md"), "# Locked\n", "utf8");
  return root;
}

/** Every file's bytes, except the lock directory the command itself owns while it runs. */
async function snapshot(root: string): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  async function walk(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const relative = path.relative(root, full).replace(/\\/g, "/");
      if (relative === "kiwi" || relative === ".git") continue;
      if (entry.isDirectory()) await walk(full);
      else files.set(relative, await readFile(full, "utf8"));
    }
  }
  await walk(root);
  return files;
}

async function upgrade(root: string) {
  return upgradeProject(await resolveProjectRoot(root), { apply: true, installSkills: false, registerMcp: false });
}

describe("FR-NODE-091 — a failed upgrade writes nothing", () => {
  // @req FR-NODE-091
  it("an SRS document it cannot read stops it before the first write", async () => {
    const root = await projectNeedingRepairs();
    const before = await snapshot(root);

    unreadable.fragment = "02.locked.srs.md";
    const result = await upgrade(root).finally(() => {
      unreadable.fragment = "";
    });

    expect(result.ok ? undefined : result.error?.code).toBe("UPGRADE_READ_FAILED");
    expect(Object.fromEntries(await snapshot(root))).toEqual(Object.fromEntries(before));
  });

  // @req FR-NODE-091
  it("a lock held by another session stops it before the first write", async () => {
    const root = await projectNeedingRepairs();
    await mkdir(path.join(root, "kiwi"), { recursive: true });
    await writeFile(
      path.join(root, "kiwi", ".srs.lock"),
      `${JSON.stringify({
        schemaVersion: "1.0.0",
        owner: "another-session",
        operation: "add_requirement",
        requestId: "held",
        acquiredAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 600_000).toISOString()
      })}\n`,
      "utf8"
    );
    const before = await snapshot(root);

    const result = await upgrade(root);

    expect(result.ok ? undefined : result.error?.code).toBe("SRS_LOCKED");
    expect(Object.fromEntries(await snapshot(root))).toEqual(Object.fromEntries(before));
  });
});
