import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../../src/cli/index.js";
import { editRequirementTableRows } from "../../../src/core/mutation/edit-requirement.js";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import { splitTableRow } from "../../../src/core/parser/table.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { validateWorkspace } from "../../../src/core/validator/validate-workspace.js";
import { createMcpServer, toolSchemas } from "../../../src/mcp/server.js";
import { renderToolNames } from "../../../src/mcp/schemas.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

/** FR-NODE-222 — a Change Notes row can be updated and deleted through the table-row edit tool. */

const ID = "FR-ARCH-001";
const SPEC = path.join("docs", "spec", "10.product-architecture.srs.md");
const ROWS = [
  "| 2026-05-08 | Created | Fixture |",
  "| 2026-10-01 | Edited | First edit |",
  "| 2026-10-20 | Status -> discarded | Discarded | split by a pipe |"
];

async function fixture(options: { status?: string; stability?: string } = {}): Promise<{ rootPath: string; specPath: string }> {
  const rootPath = await copyFixtureWorkspace("valid-basic");
  const specPath = path.join(rootPath, SPEC);
  let text = await readFile(specPath, "utf8");
  text = text.replace("| 2026-05-08 | Created | Fixture |", ROWS.join("\n"));
  if (options.status) text = text.replace("| Status | planned |", `| Status | ${options.status} |`);
  if (options.stability) text = text.replace("| Stability | stable |", `| Stability | ${options.stability} |`);
  await writeFile(specPath, text, "utf8");
  return { rootPath, specPath };
}

async function lines(file: string): Promise<string[]> {
  return (await readFile(file, "utf8")).split(/\r?\n/);
}

function edit(rootPath: string, operations: unknown[]) {
  return resolveProjectRoot(rootPath).then((root) => editRequirementTableRows(root, { id: ID, section: "change_notes" as never, operations: operations as never }));
}

/** Every line that changed, as [index, before, after]; a deletion shows as a shorter file. */
function changedLines(before: string[], after: string[]): Array<[number, string, string | undefined]> {
  return before.flatMap((line, index) => (after[index] === line ? [] : [[index, line, after[index]] as [number, string, string | undefined]]));
}

describe("FR-NODE-222 AC-1 — update and delete one Change Notes row; the rest of the block is byte-identical", () => {
  it("FR-NODE-222 AC-1: update rewrites only the given cells of row n and no other line", async () => {
    const { rootPath, specPath } = await fixture();
    const before = await lines(specPath);
    const result = await edit(rootPath, [{ kind: "update", rowIndex: 1, values: { reason: "Second thoughts" } }]);
    expect(result.ok, JSON.stringify(result.error)).toBe(true);
    const after = await lines(specPath);
    const changed = changedLines(before, after);
    expect(changed).toHaveLength(1);
    expect(changed[0]?.[1]).toBe(ROWS[1]);
    expect(splitTableRow(changed[0]?.[2] ?? "")).toEqual(["2026-10-01", "Edited", "Second thoughts"]);
  });

  it("FR-NODE-222 AC-1: delete removes row n and leaves every other line byte-identical", async () => {
    const { rootPath, specPath } = await fixture();
    const before = await lines(specPath);
    const result = await edit(rootPath, [{ kind: "delete", rowIndex: 1 }]);
    expect(result.ok, JSON.stringify(result.error)).toBe(true);
    const after = await lines(specPath);
    expect(after).toEqual(before.filter((line) => line !== ROWS[1]));
  });

  it("FR-NODE-222 AC-1: a column outside date, change and reason is refused with USAGE", async () => {
    const { rootPath, specPath } = await fixture();
    const before = await readFile(specPath, "utf8");
    const result = await edit(rootPath, [{ kind: "update", rowIndex: 0, values: { Reason: "capitalised" } }]);
    expect(result.error?.code).toBe("USAGE");
    expect(await readFile(specPath, "utf8")).toBe(before);
  });
});

describe("FR-NODE-222 AC-2 — a row split by a pipe is repaired", () => {
  it("FR-NODE-222 AC-2: updating the four-cell row writes a three-cell row the parser reads as written", async () => {
    const { rootPath, specPath } = await fixture();
    const root = await resolveProjectRoot(rootPath);
    expect(validateWorkspace(await parseWorkspace(root)).diagnostics.map((item) => item.code)).toContain("SRS-W075");

    const result = await edit(rootPath, [{ kind: "update", rowIndex: 2, values: { change: "Status -> discarded", reason: "Discarded - split by a pipe" } }]);
    expect(result.ok, JSON.stringify(result.error)).toBe(true);
    const row = (await lines(specPath)).find((line) => line.startsWith("| 2026-10-20 |")) ?? "";
    expect(splitTableRow(row)).toEqual(["2026-10-20", "Status -> discarded", "Discarded - split by a pipe"]);

    const parsed = await parseWorkspace(root);
    const record = parsed.records.find((item) => item.id === ID);
    expect(record?.changeNotes[2]).toMatchObject({ date: "2026-10-20", change: "Status -> discarded", reason: "Discarded - split by a pipe" });
    expect(validateWorkspace(parsed).diagnostics.map((item) => item.code)).not.toContain("SRS-W075");
  });
});

// Review r1 L5: a partial update must keep a split row's trailing fragments, and a placeholder row
// must be addressable for delete.
describe("FR-NODE-222 AC-1 AC-2 — partial updates of a split row and placeholder rows (review r1 L5)", () => {
  it("FR-NODE-222 AC-2: updating only the date of a pipe-split row keeps the trailing fragment joined into the reason", async () => {
    const { rootPath, specPath } = await fixture();
    const result = await edit(rootPath, [{ kind: "update", rowIndex: 2, values: { date: "2026-10-21" } }]);
    expect(result.ok, JSON.stringify(result.error)).toBe(true);
    const row = (await lines(specPath)).find((line) => line.startsWith("| 2026-10-21 |")) ?? "";
    expect(splitTableRow(row)).toEqual(["2026-10-21", "Status -> discarded", "Discarded / split by a pipe"]);
  });

  it("FR-NODE-222 AC-1: a row whose cells are all placeholders can be deleted by its position in the table", async () => {
    const { rootPath, specPath } = await fixture();
    await writeFile(specPath, (await readFile(specPath, "utf8")).replace(ROWS[0]!, `${ROWS[0]}\n| - | - | - |`), "utf8");
    const before = await lines(specPath);
    const result = await edit(rootPath, [{ kind: "delete", rowIndex: 1 }]);
    expect(result.ok, JSON.stringify(result.error)).toBe(true);
    expect(await lines(specPath)).toEqual(before.filter((line) => line !== "| - | - | - |"));
  });
});

describe("FR-NODE-222 AC-3 — the Status guard is the one the other tables use", () => {
  for (const kind of ["update", "delete"] as const) {
    it(`FR-NODE-222 AC-3: a ${kind} on a verified requirement is refused with MUTATION_DENIED and the document is byte-identical`, async () => {
      const { rootPath, specPath } = await fixture({ status: "verified" });
      const before = await readFile(specPath, "utf8");
      const result = await edit(rootPath, [{ kind, rowIndex: 0, ...(kind === "update" ? { values: { reason: "x" } } : {}) }]);
      expect(result.error?.code).toBe("MUTATION_DENIED");
      expect(await readFile(specPath, "utf8")).toBe(before);
      const evidence = await resolveProjectRoot(rootPath).then((root) =>
        editRequirementTableRows(root, { id: ID, section: "trace_links", operations: [{ kind: "delete", rowIndex: 0 }] })
      );
      expect(result.error?.message).toBe(evidence.error?.message);
    });
  }

  it("FR-NODE-222 AC-3: a frozen but unverified requirement is not refused (the guard is Status, not Stability)", async () => {
    const { rootPath } = await fixture({ stability: "frozen" });
    const result = await edit(rootPath, [{ kind: "update", rowIndex: 0, values: { reason: "Fixture, edited" } }]);
    expect(result.ok, JSON.stringify(result.error)).toBe(true);
  });
});

describe("FR-NODE-222 AC-4 — every cell goes through tableCellText", () => {
  it("FR-NODE-222 AC-4: a pipe becomes / and a line break one space, so the row keeps three cells", async () => {
    const { rootPath, specPath } = await fixture();
    const result = await edit(rootPath, [{ kind: "update", rowIndex: 0, values: { change: "Created | seeded", reason: "line one\r\nline two" } }]);
    expect(result.ok, JSON.stringify(result.error)).toBe(true);
    const row = (await lines(specPath)).find((line) => line.startsWith("| 2026-05-08 |")) ?? "";
    expect(splitTableRow(row)).toEqual(["2026-05-08", "Created / seeded", "line one line two"]);
  });
});

describe("FR-NODE-222 AC-5 — CLI and MCP reach the same core", () => {
  it("FR-NODE-222 AC-5: the CLI and MCP give the same file for the same input, the enum lists change_notes, the tool count is unchanged", async () => {
    const operations = [{ kind: "update", rowIndex: 1, values: { reason: "Through both surfaces" } }];
    const cli = await fixture();
    const streams = { stdout: new PassThrough(), stderr: new PassThrough() };
    const code = await main(["--root", cli.rootPath, "edit-requirement-table-rows", ID, "--section", "change_notes", "--operations", JSON.stringify(operations), "--json"], streams);
    expect(code).toBe(0);

    const mcp = await fixture();
    const answer = await createMcpServer({ root: mcp.rootPath }).callTool("edit_requirement_table_rows", { id: ID, section: "change_notes", operations });
    expect(answer).toMatchObject({ ok: true, value: { written: true } });

    expect(await readFile(mcp.specPath, "utf8")).toBe(await readFile(cli.specPath, "utf8"));
    expect(toolSchemas.edit_requirement_table_rows?.section?.safeParse("change_notes").success).toBe(true);
    expect(renderToolNames()).toHaveLength(89);
  });
});
