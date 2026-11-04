import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { renameScope } from "../../src/core/mutation/rename-scope.js";
import { scaffoldScope } from "../../src/core/mutation/scaffold-scope.js";
import { setActiveTarget } from "../../src/core/mutation/set-active-target.js";
import { parseWorkspace } from "../../src/core/parser/workspace-parser.js";
import { resolveProjectRoot } from "../../src/core/project-root.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

const ARCH = "10.product-architecture.srs.md";
const ROW = `| Product Architecture | [${ARCH}](./${ARCH}) | ARCH | Architecture |`;

function indexPath(rootPath: string): string {
  return path.join(rootPath, "docs", "spec", "00.index.md");
}
async function insertAfterPurpose(rootPath: string, block: string[]): Promise<void> {
  const lines = (await readFile(indexPath(rootPath), "utf8")).split(/\r?\n/);
  const purpose = lines.findIndex((line) => /^## 1\. Purpose/.test(line));
  lines.splice(purpose + 3, 0, ...block, "");
  await writeFile(indexPath(rootPath), lines.join("\n"), "utf8");
}

const SCOPE_TABLES = ["## 2. SRS Documents", "", "| Scope | Document | Prefix | Description |", "|---|---|---|---|", ROW, "", "## 4. Scope Map", "", "| Scope | Document | Prefix | Description |", "|---|---|---|---|", ROW];

/** A fenced example opened on a list item's marker line; its content and closing fence are indented by the item. */
const LIST_FENCE_ON_MARKER = ["- ```markdown", ...SCOPE_TABLES.map((line) => (line === "" ? "" : `  ${line}`)), "  ```"];
const HTML_COMMENT = ["<!--", ...SCOPE_TABLES, "-->"];
const INDENTED_CODE = SCOPE_TABLES.map((line) => (line === "" ? "" : `    ${line}`));

const SHAPES: Record<string, string[]> = {
  "a fence opened on a list item's marker line": LIST_FENCE_ON_MARKER,
  "an HTML comment": HTML_COMMENT,
  "an indented (4-space) code block": INDENTED_CODE
};

describe("verify r10: scaffold-scope writes the Scope Map a reader sees, not an example of it", () => {
  for (const [shape, block] of Object.entries(SHAPES)) {
    it(`leaves the scope tables shown in ${shape} unchanged and registers the scope in the real table`, async () => {
      const rootPath = await copyFixtureWorkspace("valid-basic");
      await insertAfterPurpose(rootPath, block);
      const before = await readFile(indexPath(rootPath), "utf8");
      const exampleText = block.join("\n");
      const root = await resolveProjectRoot(rootPath);
      const result = await scaffoldScope(root, { name: "Billing", prefix: "BILL", apply: true });
      expect(result.ok, JSON.stringify(result)).toBe(true);
      const after = await readFile(indexPath(rootPath), "utf8");
      expect(before).toContain(exampleText);
      expect(after, "the example block was edited").toContain(exampleText);
      const realScopeMap = after.slice(after.lastIndexOf("## 4. Scope Map"));
      expect(realScopeMap).toContain("| BILL |");
    });
  }
});

describe("verify r10: renameScope rewrites links only, not code or comments (FR-NODE-232 AC-1)", () => {
  for (const [shape, block] of Object.entries({ "an HTML comment": HTML_COMMENT })) {
    it(`leaves the scope tables shown in ${shape} unchanged`, async () => {
      const rootPath = await copyFixtureWorkspace("valid-basic");
      await insertAfterPurpose(rootPath, block);
      const exampleText = block.join("\n");
      const root = await resolveProjectRoot(rootPath);
      const result = await renameScope(root, { from: "10.product-architecture", to: "10.platform-architecture", apply: true });
      expect(result.ok, JSON.stringify(result)).toBe(true);
      const after = await readFile(indexPath(rootPath), "utf8");
      expect(after, "the example block was edited").toContain(exampleText);
      const realScopeMap = after.slice(after.lastIndexOf("## 4. Scope Map"));
      expect(realScopeMap).toContain("./10.platform-architecture.srs.md");
    });
  }
});

describe("verify r10: set-active-target edits the Target Map the parser reads", () => {
  it("leaves a fenced example of the Target Map unchanged and registers the target in the real one", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");
    const fence = ["```markdown", "## 3. Target Map", "", "| Target | Type | Status | Description |", "|---|---|---|---|", "| v1.0.0 | release | active | Fixture release |", "```"];
    await insertAfterPurpose(rootPath, fence);
    const root = await resolveProjectRoot(rootPath);
    const result = await setActiveTarget(root, { target: "v1.2.0", create: true });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    const after = await readFile(indexPath(rootPath), "utf8");
    expect(after, "the fenced example was edited").toContain(fence.join("\n"));
    const workspace = await parseWorkspace(root);
    expect(workspace.index.targets.map((target) => target.target)).toContain("v1.2.0");
  });
});
