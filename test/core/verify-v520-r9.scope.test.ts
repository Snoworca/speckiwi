import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { registerScopes } from "../../src/core/mutation/register-scopes.js";
import { renameScope } from "../../src/core/mutation/rename-scope.js";
import { scaffoldScope } from "../../src/core/mutation/scaffold-scope.js";
import { parseWorkspace } from "../../src/core/parser/workspace-parser.js";
import { resolveProjectRoot } from "../../src/core/project-root.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

const ARCH = "10.product-architecture.srs.md";

function specPath(rootPath: string, name: string): string {
  return path.join(rootPath, "docs", "spec", name);
}
async function editIndex(rootPath: string, edit: (lines: string[]) => void): Promise<void> {
  const file = specPath(rootPath, "00.index.md");
  const lines = (await readFile(file, "utf8")).split(/\r?\n/);
  edit(lines);
  await writeFile(file, lines.join("\n"), "utf8");
}
function insertAfterPurpose(lines: string[], block: string[]): void {
  const purpose = lines.findIndex((line) => /^## 1\. Purpose/.test(line));
  lines.splice(purpose + 3, 0, ...block, "");
}
/** An example of the index layout, shown in a fence: the parser ignores it, as it ignores all code. */
const FENCED_EXAMPLE = [
  "```markdown",
  "## 2. SRS Documents",
  "",
  "| Scope | Document | Prefix | Description |",
  "|---|---|---|---|",
  `| Product Architecture | [${ARCH}](./${ARCH}) | ARCH | Architecture |`,
  "",
  "## 4. Scope Map",
  "",
  "| Scope | Document | Prefix | Description |",
  "|---|---|---|---|",
  `| Product Architecture | [${ARCH}](./${ARCH}) | ARCH | Architecture |`,
  "```"
];

describe("verify r9: scope-row writers find the same Scope Map the index parser reads (FR-NODE-233 AC-1)", () => {
  it("scaffold-scope registers the new scope in the real Scope Map, not in a fenced example of it", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");
    await editIndex(rootPath, (lines) => insertAfterPurpose(lines, FENCED_EXAMPLE));
    const root = await resolveProjectRoot(rootPath);
    const result = await scaffoldScope(root, { name: "Billing", prefix: "BILL", apply: true });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    const workspace = await parseWorkspace(root);
    expect(workspace.index.scopes.map((scope) => scope.prefix)).toContain("BILL");
  });

  it("register-scopes registers an unregistered document in the real Scope Map, not in a fenced example of it", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");
    await editIndex(rootPath, (lines) => insertAfterPurpose(lines, FENCED_EXAMPLE));
    const archBody = await readFile(specPath(rootPath, ARCH), "utf8");
    await writeFile(specPath(rootPath, "11.extra.srs.md"), archBody.replace(/FR-ARCH-/g, "FR-EXTRA-").replace(/\| Scope \| ARCH \|/, "| Scope | EXTRA |"), "utf8");
    const root = await resolveProjectRoot(rootPath);
    const result = await registerScopes(root, { apply: true });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    const workspace = await parseWorkspace(root);
    expect(workspace.index.scopes.map((scope) => scope.prefix)).toContain("EXTRA");
  });
});

describe("verify r9: renameScope rewrites links only, not code (FR-NODE-232 AC-1)", () => {
  it("leaves a fenced example of the scope tables unchanged", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");
    await editIndex(rootPath, (lines) => insertAfterPurpose(lines, FENCED_EXAMPLE));
    const root = await resolveProjectRoot(rootPath);
    const result = await renameScope(root, { from: "10.product-architecture", to: "10.platform-architecture", apply: true });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    const index = await readFile(specPath(rootPath, "00.index.md"), "utf8");
    const fence = index.slice(index.indexOf("```markdown"), index.indexOf("```", index.indexOf("```markdown") + 3));
    expect(fence).toContain(ARCH);
    expect(fence).not.toContain("10.platform-architecture.srs.md");
    const workspace = await parseWorkspace(root);
    expect(workspace.index.scopes.find((scope) => scope.prefix === "ARCH")?.document).toBe("./10.platform-architecture.srs.md");
  });
});
