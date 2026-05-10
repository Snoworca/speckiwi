import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { initProject } from "../../../src/core/bootstrap/init-project.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";

async function emptyRepo() {
  const root = await mkdtemp(path.join(tmpdir(), "speckiwi-init-"));
  await mkdir(path.join(root, ".git"));
  return root;
}

describe("project init bootstrap", () => {
  it("creates docs/spec, docs/rule, canonical rules, index, appendix, and both agent snippets", async () => {
    const rootPath = await emptyRepo();
    const externalCwd = await mkdtemp(path.join(tmpdir(), "speckiwi-init-cwd-"));
    const originalCwd = process.cwd();
    let result: Awaited<ReturnType<typeof initProject>>;
    try {
      process.chdir(externalCwd);
      result = await initProject(await resolveProjectRoot(rootPath), {});
    } finally {
      process.chdir(originalCwd);
    }
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.created).toContain(path.join(rootPath, "AGENTS.md"));
    expect(result.value.created).toContain(path.join(rootPath, "CLAUDE.md"));
    const rules = await readFile(path.join(rootPath, "docs", "rule", "SRS-MD-Rules-v1.0.0.md"), "utf8");
    expect(rules).toContain("SRS-MD Authoring Rules v1.0.0");
    expect(rules).toContain("| Document ID | SRS-MD-RULES |");
    const index = await readFile(path.join(rootPath, "docs", "spec", "00.index.md"), "utf8");
    expect(index).toContain("Target Map");
    expect(index).toContain("| Active Target |  |");
    expect(index).toContain("## 5. Status Summary");
    expect(index).toContain("## 6. Requirement Type Summary");
    expect(index).toContain("## 7. Completed Work Log");
    expect(index).toContain("## 8. Cross-scope Dependencies");
    expect(index).toContain("| Date | Target | Scope | Requirement IDs | Summary |");
    expect(index).not.toContain("| v1.0.0 | release | active | Initial target |");
    expect(await readFile(path.join(rootPath, "AGENTS.md"), "utf8")).toContain("# SpecKiwi SRS 워크플로 v1.1");
    expect(await readFile(path.join(rootPath, "AGENTS.md"), "utf8")).toContain("<!-- /SpecKiwi SRS 워크플로 -->");
    expect(await readFile(path.join(rootPath, "CLAUDE.md"), "utf8")).toContain("# SpecKiwi SRS 워크플로 v1.1");
    expect(await readFile(path.join(rootPath, "CLAUDE.md"), "utf8")).toContain("This repository uses `docs/spec/` as the required source of truth for requirements.");
    expect(await readFile(path.join(rootPath, "CLAUDE.md"), "utf8")).toContain("Current work status workflow:");
  });

  it("is idempotent and skips duplicate agent snippets", async () => {
    const rootPath = await emptyRepo();
    const root = await resolveProjectRoot(rootPath);
    await initProject(root, {});
    const second = await initProject(root, {});
    expect(second.ok).toBe(true);
    const agents = await readFile(path.join(rootPath, "AGENTS.md"), "utf8");
    const claude = await readFile(path.join(rootPath, "CLAUDE.md"), "utf8");
    expect(agents.match(/# SpecKiwi SRS 워크플로 v1\.1/g)).toHaveLength(1);
    expect(agents.match(/<!-- \/SpecKiwi SRS 워크플로 -->/g)).toHaveLength(1);
    expect(claude.match(/# SpecKiwi SRS 워크플로 v1\.1/g)).toHaveLength(1);
    expect(claude.match(/<!-- \/SpecKiwi SRS 워크플로 -->/g)).toHaveLength(1);
  });

  it("replaces stale versioned and legacy agent instruction blocks", async () => {
    const rootPath = await emptyRepo();
    const root = await resolveProjectRoot(rootPath);
    await writeFile(
      path.join(rootPath, "AGENTS.md"),
      [
        "# Existing Agent Notes",
        "",
        "# SpecKiwi SRS 워크플로 v1.0",
        "",
        "Old managed instructions.",
        "",
        "<!-- /SpecKiwi SRS 워크플로 -->",
        "",
        "# Local Section",
        "",
        "Keep this section."
      ].join("\n"),
      "utf8"
    );
    await writeFile(
      path.join(rootPath, "CLAUDE.md"),
      [
        "# Claude Notes",
        "",
        "# SpecKiwi SRS workflow",
        "",
        "Legacy unversioned instructions."
      ].join("\n"),
      "utf8"
    );

    const result = await initProject(root, {});
    expect(result.ok).toBe(true);
    const agents = await readFile(path.join(rootPath, "AGENTS.md"), "utf8");
    const claude = await readFile(path.join(rootPath, "CLAUDE.md"), "utf8");
    expect(agents).toContain("# SpecKiwi SRS 워크플로 v1.1");
    expect(agents).not.toContain("# SpecKiwi SRS 워크플로 v1.0");
    expect(agents).not.toContain("Old managed instructions.");
    expect(agents).toContain("# Local Section");
    expect(claude).toContain("# SpecKiwi SRS 워크플로 v1.1");
    expect(claude).not.toContain("# SpecKiwi SRS workflow");
    expect(claude).not.toContain("Legacy unversioned instructions.");
  });

  it("does not replace prefix mentions or versioned headings without a suffix marker", async () => {
    const rootPath = await emptyRepo();
    const root = await resolveProjectRoot(rootPath);
    await writeFile(
      path.join(rootPath, "AGENTS.md"),
      "Keep this prose mention: `# SpecKiwi SRS 워크플로 v0.9`.\n",
      "utf8"
    );
    await writeFile(
      path.join(rootPath, "CLAUDE.md"),
      ["# SpecKiwi SRS 워크플로 v0.9", "", "No suffix marker, so this is not a safe managed block."].join("\n"),
      "utf8"
    );

    const result = await initProject(root, {});
    expect(result.ok).toBe(true);
    const agents = await readFile(path.join(rootPath, "AGENTS.md"), "utf8");
    const claude = await readFile(path.join(rootPath, "CLAUDE.md"), "utf8");
    expect(agents).toContain("Keep this prose mention: `# SpecKiwi SRS 워크플로 v0.9`.");
    expect(agents).toContain("# SpecKiwi SRS 워크플로 v1.1");
    expect(claude).toContain("# SpecKiwi SRS 워크플로 v0.9");
    expect(claude).toContain("No suffix marker, so this is not a safe managed block.");
    expect(claude).toContain("# SpecKiwi SRS 워크플로 v1.1");
  });

  it("does not pair a malformed heading with a later block marker", async () => {
    const rootPath = await emptyRepo();
    const root = await resolveProjectRoot(rootPath);
    await writeFile(
      path.join(rootPath, "AGENTS.md"),
      [
        "# SpecKiwi SRS 워크플로 v0.9",
        "",
        "Malformed block without marker.",
        "",
        "# Local Section",
        "",
        "This local section must survive.",
        "",
        "# SpecKiwi SRS 워크플로 v0.8",
        "",
        "Old managed block.",
        "",
        "<!-- /SpecKiwi SRS 워크플로 -->",
        "",
        "# Tail Section",
        "",
        "Keep this too."
      ].join("\n"),
      "utf8"
    );

    const result = await initProject(root, {});
    expect(result.ok).toBe(true);
    const agents = await readFile(path.join(rootPath, "AGENTS.md"), "utf8");
    expect(agents).toContain("# SpecKiwi SRS 워크플로 v0.9");
    expect(agents).toContain("Malformed block without marker.");
    expect(agents).toContain("# Local Section");
    expect(agents).toContain("This local section must survive.");
    expect(agents).not.toContain("# SpecKiwi SRS 워크플로 v0.8");
    expect(agents).not.toContain("Old managed block.");
    expect(agents).toContain("# SpecKiwi SRS 워크플로 v1.1");
    expect(agents).toContain("# Tail Section");
    expect(agents).toContain("Keep this too.");
  });

  it("uses target and scope input in generated index and scope document", async () => {
    const rootPath = await emptyRepo();
    const result = await initProject(await resolveProjectRoot(rootPath), { target: "v2.0.0", scope: "Payments:PAY" });
    expect(result.ok).toBe(true);
    const index = await readFile(path.join(rootPath, "docs", "spec", "00.index.md"), "utf8");
    expect(index).toContain("| Active Target |  |");
    expect(index).toContain("| v2.0.0 | release | planned | Initial target |");
    expect(index).toContain("| Date | Target | Scope | Requirement IDs | Summary |");
    expect(index).toContain("| Payments | [10.payments.srs.md](./10.payments.srs.md) | PAY | Payments |");
    const scope = await readFile(path.join(rootPath, "docs", "spec", "10.payments.srs.md"), "utf8");
    expect(scope).toContain("| Scope | PAY |");
  });
});
