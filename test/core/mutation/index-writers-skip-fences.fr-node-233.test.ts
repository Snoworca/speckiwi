import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { addCompletedWork } from "../../../src/core/mutation/add-completed-work.js";
import { registerScopes } from "../../../src/core/mutation/register-scopes.js";
import { renameScope } from "../../../src/core/mutation/rename-scope.js";
import { renameTarget } from "../../../src/core/mutation/rename-target.js";
import { retarget } from "../../../src/core/mutation/retarget.js";
import { scaffoldScope } from "../../../src/core/mutation/scaffold-scope.js";
import { setActiveTarget } from "../../../src/core/mutation/set-active-target.js";
import { syncIndexRollups } from "../../../src/core/mutation/sync-index.js";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import type { MutationResult, ParsedWorkspace, ProjectRoot } from "../../../src/core/types.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

// The index parser reads a section heading only on a body line (classifyDocumentLines: not code, not
// inside an HTML comment). A writer that finds its table any other way edits an example of the index
// instead of the real table. Each index-table writer below runs on an index whose Purpose section shows
// every table it writes as an example, in each shape a reader does not take for the document: a fence,
// a fence opened on a list item's marker line, an HTML comment and an indented code block. The example
// must come back byte for byte, and the real table must carry the change.

const ARCH = "10.product-architecture.srs.md";

const TABLES = [
  "## 2. SRS Documents",
  "",
  "| Scope | Document | Prefix | Description |",
  "|---|---|---|---|",
  `| Product Architecture | [${ARCH}](./${ARCH}) | ARCH | Architecture |`,
  "",
  "## 3. Target Map",
  "",
  "| Target | Type | Status | Description |",
  "|---|---|---|---|",
  "| v1.0.0 | release | active | Fixture release |",
  "",
  "## 4. Scope Map",
  "",
  "| Scope | Document | Prefix | Description |",
  "|---|---|---|---|",
  `| Product Architecture | [${ARCH}](./${ARCH}) | ARCH | Architecture |`,
  "",
  "## 5. Status Summary",
  "",
  "| Status | Count |",
  "|---|---:|",
  "| planned | 9 |",
  "",
  "## 7. Completed Work Log",
  "",
  "| Date | Target | Scope | Requirement IDs | Summary |",
  "|---|---|---|---|---|",
  "| 2026-01-01 | v1.0.0 | ARCH | FR-ARCH-001 | Example row. |"
];

const indent = (prefix: string) => TABLES.map((line) => (line === "" ? "" : `${prefix}${line}`));

const SHAPES: Record<string, string[]> = {
  "a fence": ["```markdown", ...TABLES, "```"],
  "a top-level fence holding `>` lines": ["```text", "> quoted line", ">>> repl prompt", ...TABLES, "```"],
  "a fence opened on a list item marker line": ["- ```markdown", ...indent("  "), "  ```"],
  "an HTML comment": ["<!--", ...TABLES, "-->"],
  "an indented code block": indent("    "),
  "a tab-indented code block": indent("\t"),
  "a fence inside a block quote": ["> ```markdown", ...TABLES.map((line) => (line === "" ? ">" : `> ${line}`)), "> ```"],
  // Structures that never close hide nothing: the real tables after them stay the document's.
  "unclosed structures": [
    "Draft notes start with <!-- and are hidden by renderers.",
    "<!-->",
    "<!--->",
    "",
    "",
    "<!-- a comment block that is never closed",
    "",
    "- ```text",
    "  a list item fence that is never closed",
    "",
    "> ```text",
    "> a quoted fence that is never closed"
  ]
};

function indexPath(rootPath: string): string {
  return path.join(rootPath, "docs", "spec", "00.index.md");
}

async function prepare(rootPath: string, example: readonly string[]): Promise<void> {
  const text = await readFile(indexPath(rootPath), "utf8");
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  const purpose = lines.findIndex((line) => /^## 1\. Purpose/.test(line));
  lines.splice(purpose + 3, 0, ...example, "");
  // A second registered target, in the real Target Map only, for retarget to move to.
  const row = "| v1.0.0 | release | active | Fixture release |";
  const realRow = lines.lastIndexOf(row);
  lines.splice(realRow + 1, 0, "| v1.1.0 | release | planned | Next release |");
  await writeFile(indexPath(rootPath), lines.join(newline), "utf8");
  // An unregistered scope document for register-scopes.
  const arch = await readFile(path.join(rootPath, "docs", "spec", ARCH), "utf8");
  await writeFile(path.join(rootPath, "docs", "spec", "11.extra.srs.md"), arch.replace(/FR-ARCH-/g, "FR-EXTRA-").replace(/\| Scope \| ARCH \|/, "| Scope | EXTRA |"), "utf8");
}

function lines(text: string): string[] {
  return text.split(/\r?\n/);
}

/** Whether the example block appears in the text exactly, line for line. */
function containsBlock(text: string, block: readonly string[]): boolean {
  const all = lines(text);
  return all.some((_, start) => block.every((line, offset) => all[start + offset] === line));
}

const HISTORY_LOG = path.join("docs", "spec", "91.completed-work-log.md");

let currentExample: readonly string[] = [];

/** A history log whose example (the current shape) comes before its real Completed Work Log table. */
async function writeHistoryLog(rootPath: string): Promise<void> {
  const log = [
    "> This file is an append-only Completed Work Log summary.",
    "",
    ...currentExample,
    "",
    "## 7. Completed Work Log",
    "",
    "| Date | Target | Scope | Requirement IDs | Summary |",
    "|---|---|---|---|---|",
    "| 2026-05-11 | v1.0.0 | ARCH | FR-ARCH-001 | History row. |",
    ""
  ];
  await writeFile(path.join(rootPath, HISTORY_LOG), log.join("\n"), "utf8");
}

const CASES: Array<{
  tool: string;
  /** Where the example sits for this writer; the index unless the writer writes another file. */
  exampleFile?: string;
  run: (root: ProjectRoot) => Promise<MutationResult<unknown>>;
  changed: (workspace: ParsedWorkspace) => boolean;
}> = [
  {
    tool: "scaffold_scope",
    run: (root) => scaffoldScope(root, { name: "Billing", prefix: "BILL", apply: true }),
    changed: (workspace) => workspace.index.scopes.some((scope) => scope.prefix === "BILL")
  },
  {
    tool: "register_scopes",
    run: (root) => registerScopes(root, { apply: true }),
    changed: (workspace) => workspace.index.scopes.some((scope) => scope.prefix === "EXTRA")
  },
  {
    tool: "rename_scope",
    run: (root) => renameScope(root, { from: "10.product-architecture", to: "10.platform-architecture", apply: true }),
    changed: (workspace) => workspace.index.scopes.some((scope) => scope.document === "./10.platform-architecture.srs.md")
  },
  {
    tool: "rename_target",
    run: (root) => renameTarget(root, { from: "v1.0.0", to: "v1.0.1", dryRun: false }),
    changed: (workspace) => workspace.index.targets.some((target) => target.target === "v1.0.1")
  },
  {
    tool: "retarget",
    run: (root) => retarget(root, { ids: ["FR-ARCH-001"], toTarget: "v1.1.0", reason: "moved", dryRun: false }),
    changed: (workspace) => workspace.records.find((record) => record.id === "FR-ARCH-001")?.target === "v1.1.0"
  },
  {
    tool: "set_active_target",
    run: (root) => setActiveTarget(root, { target: "v1.2.0", create: true }),
    changed: (workspace) => workspace.index.targets.some((target) => target.target === "v1.2.0") && workspace.index.activeTarget === "v1.2.0"
  },
  {
    tool: "sync_index_rollups",
    run: (root) => syncIndexRollups(root, { dryRun: false }),
    changed: (workspace) => workspace.index.statusSummary?.find((entry) => entry.status === "planned")?.count === 2
  },
  {
    tool: "add_completed_work",
    run: (root) => addCompletedWork(root, { date: "2026-11-04", summary: "Fence matrix row.", target: "v1.0.0", allowIncomplete: true }),
    changed: (workspace) => workspace.index.completedWork.some((entry) => entry.summary === "Fence matrix row.")
  },
  // add_completed_work writes docs/spec/91.completed-work-log.md, so the example goes there too.
  {
    tool: "add_completed_work into a history log holding the example",
    exampleFile: HISTORY_LOG,
    run: async (root) => {
      await writeHistoryLog(root.root);
      return addCompletedWork(root, { date: "2026-11-04", summary: "Fence matrix row.", target: "v1.0.0", allowIncomplete: true });
    },
    changed: (workspace) => workspace.index.completedWork.some((entry) => entry.summary === "Fence matrix row.")
  },
  // With rows present, sync appends after the last parsed row; only an empty table makes it look the
  // section heading up, which is the lookup an example could capture.
  {
    tool: "sync_index_rollups on an empty summary",
    run: async (root) => {
      await emptyRealTable(root.root, "## 5. Status Summary");
      return syncIndexRollups(root, { dryRun: false });
    },
    changed: (workspace) => workspace.index.statusSummary?.find((entry) => entry.status === "planned")?.count === 2
  }
];

/** Removes the data rows of the real (last) table under `heading`, keeping its header and separator. */
async function emptyRealTable(rootPath: string, heading: string): Promise<void> {
  const text = await readFile(indexPath(rootPath), "utf8");
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  const all = lines(text);
  const at = all.lastIndexOf(heading);
  expect(at).toBeGreaterThan(0);
  let end = at + 4;
  while ((all[end] ?? "").startsWith("|")) end += 1;
  all.splice(at + 4, end - (at + 4));
  await writeFile(indexPath(rootPath), all.join(newline), "utf8");
}

describe("FR-NODE-233 index-table writers edit the real table and leave an example of it byte for byte", () => {
  for (const [shape, example] of Object.entries(SHAPES)) {
    for (const { tool, exampleFile, run, changed } of CASES) {
      // @req FR-NODE-233 AC-1
      it(`${tool}, example in ${shape}`, async () => {
        const rootPath = await copyFixtureWorkspace("valid-basic");
        await prepare(rootPath, example);
        currentExample = example;
        const examplePath = exampleFile ? path.join(rootPath, exampleFile) : indexPath(rootPath);
        const root = await resolveProjectRoot(rootPath);

        const result = await run(root);

        expect(result.ok, JSON.stringify(result.error)).toBe(true);
        expect(containsBlock(await readFile(examplePath, "utf8"), example), "the example was edited").toBe(true);
        expect(changed(await parseWorkspace(root))).toBe(true);
      });
    }
  }
});
