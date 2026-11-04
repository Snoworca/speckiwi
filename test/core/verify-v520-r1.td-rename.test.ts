import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveProjectRoot } from "../../src/core/project-root.js";
import { renameTarget } from "../../src/core/mutation/rename-target.js";
import { retarget } from "../../src/core/mutation/retarget.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

const INDEX = path.join("docs", "spec", "00.index.md");
const SPEC = path.join("docs", "spec", "10.product-architecture.srs.md");

async function edit(rootPath: string, relative: string, change: (text: string) => string): Promise<void> {
  const file = path.join(rootPath, relative);
  const text = await readFile(file, "utf8");
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  await writeFile(file, change(text.replace(/\r\n/g, "\n")).replace(/\n/g, newline), "utf8");
}

async function readLf(rootPath: string, relative: string): Promise<string> {
  return (await readFile(path.join(rootPath, relative), "utf8")).replace(/\r\n/g, "\n");
}

async function snapshotSpec(rootPath: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else out[path.relative(rootPath, full)] = await readFile(full, "utf8");
    }
  };
  await walk(path.join(rootPath, "docs", "spec"));
  return out;
}

async function residueFixture(register: string): Promise<string> {
  const rootPath = await copyFixtureWorkspace("mutation-target");
  await edit(rootPath, INDEX, (text) =>
    text
      .replace("| Active Target | v1.0.0 |", "| Active Target | 5.2 |")
      .replace("| v1.0.0 | release | active | Fixture release |", "| 5.2 | release | active | Short |")
      .concat(register)
  );
  await edit(rootPath, SPEC, (text) => text.replace("| Target | v1.0.0 |", "| Target | 5.2 |"));
  return rootPath;
}

describe("verify v5.2.0 r1: renameTarget residue register as release readiness reads it", () => {
  // @req IR-CLI-112 AC-5
  it("renames the real register, not a fenced example of it placed earlier in the index", async () => {
    const fenced =
      "\n## 6. Notes\n\n```markdown\n## 12. Release Residue\n\n| Target | Requirement | Criterion | Reason |\n| --- | --- | --- | --- |\n| 5.2 | FR-X-001 | AC-1 | Example row only. |\n```\n";
    const real =
      "\n## 7. Release Residue\n\n| Target | Requirement | Criterion | Reason |\n| --- | --- | --- | --- |\n| 5.2 | FR-ARCH-001 | AC-2 | Deferred from the release. |\n";
    const rootPath = await residueFixture(fenced + real);
    const result = await renameTarget(await resolveProjectRoot(rootPath), { from: "5.2", to: "5.3", dryRun: false });
    expect(result.ok).toBe(true);
    const index = await readLf(rootPath, INDEX);
    expect(index).toContain("| 5.3 | FR-ARCH-001 | AC-2 | Deferred from the release. |");
    expect(index).toContain("| 5.2 | FR-X-001 | AC-1 | Example row only. |");
  });

  // @req IR-CLI-112 AC-5
  it("renames a setext-headed register, which release readiness honours", async () => {
    const real =
      "\nRelease Residue\n---------------\n\n| Target | Requirement | Criterion | Reason |\n| --- | --- | --- | --- |\n| 5.2 | FR-ARCH-001 | AC-2 | Deferred from the release. |\n";
    const rootPath = await residueFixture(real);
    const result = await renameTarget(await resolveProjectRoot(rootPath), { from: "5.2", to: "5.3", dryRun: false });
    expect(result.ok).toBe(true);
    expect(await readLf(rootPath, INDEX)).toContain("| 5.3 | FR-ARCH-001 | AC-2 | Deferred from the release. |");
  });
});

describe("verify v5.2.0 r1: retarget duplicate ids", () => {
  // @req IR-CLI-112 AC-3
  it("a repeated id retargets once and records one Change Notes row", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const root = await resolveProjectRoot(rootPath);
    const before = await snapshotSpec(rootPath);
    const result = await retarget(root, { ids: ["FR-ARCH-001", "FR-ARCH-001"], toTarget: "v1.1.0", dryRun: false });
    const after = await readLf(rootPath, SPEC);
    const rows = after.match(/\| Target v1\.0\.0 -> v1\.1\.0 \|/g) ?? [];
    if (result.ok) {
      expect(rows).toHaveLength(1);
    } else {
      // A refusal must write nothing.
      expect(await snapshotSpec(rootPath)).toEqual(before);
    }
  });
});
