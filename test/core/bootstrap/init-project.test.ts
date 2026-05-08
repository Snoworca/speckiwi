import { mkdir, readFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
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
  it("creates docs/spec, docs/rule, canonical rules, index, appendix, and agent snippets", async () => {
    const rootPath = await emptyRepo();
    const result = await initProject(await resolveProjectRoot(rootPath), { agentFiles: ["AGENTS.md", "CLAUDE.md"] });
    expect(result.ok).toBe(true);
    const rules = await readFile(path.join(rootPath, "docs", "rule", "SRS-MD-Rules-v1.0.0.md"), "utf8");
    expect(rules).toContain("SRS-MD Authoring Rules v1.0.0");
    expect(await readFile(path.join(rootPath, "docs", "spec", "00.index.md"), "utf8")).toContain("Target Map");
    expect(await readFile(path.join(rootPath, "AGENTS.md"), "utf8")).toContain("docs/rule/SRS-MD-Rules-v1.0.0.md");
  });

  it("is idempotent and skips duplicate agent snippets", async () => {
    const rootPath = await emptyRepo();
    const root = await resolveProjectRoot(rootPath);
    await initProject(root, { agentFiles: ["AGENTS.md"] });
    const second = await initProject(root, { agentFiles: ["AGENTS.md"] });
    expect(second.ok).toBe(true);
    const text = await readFile(path.join(rootPath, "AGENTS.md"), "utf8");
    expect(text.match(/SRS-MD-Rules-v1\.0\.0\.md/g)).toHaveLength(1);
  });

  it("uses target and scope input in generated index and scope document", async () => {
    const rootPath = await emptyRepo();
    const result = await initProject(await resolveProjectRoot(rootPath), { target: "v2.0.0", scope: "Payments:PAY" });
    expect(result.ok).toBe(true);
    const index = await readFile(path.join(rootPath, "docs", "spec", "00.index.md"), "utf8");
    expect(index).toContain("| v2.0.0 | release | active | Initial target |");
    expect(index).toContain("| Payments | [10.payments.srs.md](./10.payments.srs.md) | PAY | Payments |");
    const scope = await readFile(path.join(rootPath, "docs", "spec", "10.payments.srs.md"), "utf8");
    expect(scope).toContain("| Scope | PAY |");
  });
});
