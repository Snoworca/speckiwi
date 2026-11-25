import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { ROW_OPERATIONS_SHAPE, SETTABLE_ROW_COLUMNS_RULE } from "../../src/core/mutation/edit-requirement.js";
import { renderToolDescriptions } from "../../src/mcp/schemas.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";
import { snapshotTree } from "../support/discarded-target-fixture.js";

// @req IR-CLI-122 AC-1 AC-2 AC-3 — the help says the JSON shape an option takes, and append-note says
// that --mode replace rewrites a whole section.

async function run(argv: string[]): Promise<{ exit: number; stdout: string; stderr: string }> {
  const pipes = { stdout: new PassThrough(), stderr: new PassThrough() };
  const exit = await main(argv, pipes);
  return { exit, stdout: pipes.stdout.read()?.toString() ?? "", stderr: pipes.stderr.read()?.toString() ?? "" };
}

const flat = (text: string) => text.replace(/\s+/g, " ");

describe("IR-CLI-122 AC-1 — --operations help and the MCP description share one shape text", () => {
  it("IR-CLI-122 AC-1: the constant names the fields, the column rule and the example", () => {
    for (const part of ["`kind`", "update", "delete", "`rowId`", "`rowIndex`", "`values`", SETTABLE_ROW_COLUMNS_RULE, `[{"kind":"update","rowId":"VE-1","values":{"notes":"..."}}]`]) {
      expect(ROW_OPERATIONS_SHAPE).toContain(part);
    }
  });

  it("IR-CLI-122 AC-1: edit-requirement-table-rows --help prints the constant", async () => {
    const { stdout } = await run(["edit-requirement-table-rows", "--help"]);
    expect(flat(stdout)).toContain(flat(ROW_OPERATIONS_SHAPE));
  });

  it("IR-CLI-122 AC-1: the MCP description carries the same constant", () => {
    expect(renderToolDescriptions().edit_requirement_table_rows ?? "").toContain(ROW_OPERATIONS_SHAPE);
  });
});

describe("IR-CLI-122 AC-2 — a JSON-encoded string in --input-json is refused with the way to pass it", () => {
  it.each([
    ["edit-requirement-table-rows", "operations", { section: "verification_evidence", operations: JSON.stringify([{ kind: "delete", rowIndex: 0 }]) }],
    ["replace-acceptance-criteria", "items", { items: JSON.stringify([{ text: "THE SYSTEM SHALL work." }]) }]
  ])("IR-CLI-122 AC-2: %s with %s as a string", async (command, field, payload) => {
    const rootPath = await copyFixtureWorkspace("valid-basic");
    const before = await snapshotTree(rootPath);
    const { exit, stdout } = await run(["--root", rootPath, command, "--input-json", JSON.stringify({ id: "FR-ARCH-001", ...payload }), "--json"]);
    expect(exit).toBe(2);
    const answer = JSON.parse(stdout) as { error?: { code: string; message: string } };
    expect(answer.error?.code).toBe("CLI_USAGE_ERROR");
    expect(answer.error?.message).toContain(field);
    expect(answer.error?.message).toMatch(/array itself/);
    expect(answer.error?.message).toMatch(/not a JSON-encoded string/);
    expect(await snapshotTree(rootPath)).toEqual(before);
  });
});

describe("IR-CLI-122 AC-3 — append-note says it can replace a whole section", () => {
  it("IR-CLI-122 AC-3: the top-level help lists append-note with its description", async () => {
    const { stdout } = await run(["--help"]);
    const line = stdout.split("\n").find((entry) => /^\s+append-note\b/.test(entry)) ?? "";
    expect(line).toMatch(/replace/);
  });

  it("IR-CLI-122 AC-3: append-note --help names --section rationale --mode replace", async () => {
    const { stdout } = await run(["append-note", "--help"]);
    expect(flat(stdout)).toContain("--section rationale --mode replace");
  });
});
