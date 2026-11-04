import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

// An SRS file the parser cannot read (EACCES) is simulated here; every other read passes through.
const unreadable = { fragment: "" };
vi.mock("../../../src/core/fs/read-text.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/core/fs/read-text.js")>();
  return {
    ...actual,
    readUtf8File: async (filePath: string, root?: string) => {
      if (unreadable.fragment !== "" && filePath.includes(unreadable.fragment)) {
        throw Object.assign(new Error(`EACCES: permission denied, open '${filePath}'`), { code: "EACCES", path: filePath });
      }
      return actual.readUtf8File(filePath, root);
    }
  };
});

const { initProject } = await import("../../../src/core/bootstrap/init-project.js");
const { upgradeProject } = await import("../../../src/core/bootstrap/upgrade-project.js");
const { diagnoseHealth } = await import("../../../src/core/health/doctor.js");
const { parseWorkspace } = await import("../../../src/core/parser/workspace-parser.js");
const { resolveProjectRoot } = await import("../../../src/core/project-root.js");

const NEW = "SRS-MD-Rules-v2.6.0.md";
const OLD_ROW = "| Rules | [SRS-MD Authoring Rules v2.5.0](../rule/SRS-MD-Rules-v2.5.0.md) |";

async function freshProject(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "speckiwi-r7-rules-"));
  await mkdir(path.join(root, ".git"), { recursive: true });
  const init = await initProject(await resolveProjectRoot(root), {});
  expect(init.ok).toBe(true);
  return root;
}

async function rulesDrift(root: string) {
  const report = await diagnoseHealth(await parseWorkspace({ root }));
  return report.checks.find((c) => c.label === "Rules version drift")!;
}

async function upgrade(root: string) {
  return upgradeProject(await resolveProjectRoot(root), { apply: true, installSkills: false, registerMcp: false });
}

function scopeDoc(rulesRow: string): string {
  return ["# Alpha SRS", "", "| Field | Value |", "| --- | --- |", "| Document Type | scope-srs |", rulesRow, "", "## 1. Scope", ""].join("\n");
}

describe("verify FR-NODE-091 upgrade early read, round 7", () => {
  // @req FR-NODE-091
  it("an upgrade that fails with UPGRADE_READ_FAILED has written nothing to the index", async () => {
    const root = await freshProject();
    const indexPath = path.join(root, "docs", "spec", "00.index.md");
    const withoutRules = (await readFile(indexPath, "utf8"))
      .split("\n")
      .filter((line) => !line.startsWith("| Rules |"))
      .join("\n");
    await writeFile(indexPath, withoutRules, "utf8");
    await writeFile(path.join(root, "docs", "spec", "02.locked.srs.md"), "# Locked\n", "utf8");
    unreadable.fragment = "02.locked.srs.md";
    const result = await upgrade(root).finally(() => {
      unreadable.fragment = "";
    });
    expect(result.ok ? undefined : result.error.code).toBe("UPGRADE_READ_FAILED");
    expect(await readFile(indexPath, "utf8")).toBe(withoutRules);
  });
});

describe("verify FR-PARSE-044 AC-6 pointer set, round 7", () => {
  // @req FR-PARSE-044 AC-6
  it("one upgrade of a project whose index is missing leaves no pointer doctor still warns about", async () => {
    const root = await freshProject();
    await writeFile(path.join(root, "docs", "spec", "01.alpha.srs.md"), scopeDoc(OLD_ROW), "utf8");
    await rm(path.join(root, "docs", "spec", "00.index.md"));
    expect((await upgrade(root)).ok).toBe(true);
    const drift = await rulesDrift(root);
    expect({ state: drift.state, message: drift.message }).toMatchObject({ state: "ok" });
  });

  // @req FR-PARSE-044 AC-6
  it("a current Rules row written as a reference-style link to the bundled file is not reported stale", async () => {
    const root = await freshProject();
    const doc = scopeDoc("| Rules | [SRS-MD Authoring Rules v2.6.0][rules] |") + `\n[rules]: ../rule/${NEW}\n`;
    await writeFile(path.join(root, "docs", "spec", "01.alpha.srs.md"), doc, "utf8");
    expect((await rulesDrift(root)).state).toBe("ok");
  });
});
