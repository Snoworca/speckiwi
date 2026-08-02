import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../../src/cli/index.js";
import { WAVES_EVENT_FIELDS } from "../../../src/core/orchestrator/journal-schema.js";
import { defaultCatalog, defaultHandoff, defaultLane, defaultRoot } from "./handoff-fixtures.js";

// @req FR-NODE-172 — a field the tool writes and the contract does not declare is enforced nowhere.
//
// `untested_allowance` is the last of the three found this way. `abort_gate` and `round` were both
// declared as they were found; this one was written by `handoff validate` and declared in neither
// half of `WAVES_EVENT_FIELDS`, so nothing read it and nothing could refuse a wrong value.

const COPIES = [
  "skills/claude/_shared/kiwi/waves-event.md",
  "skills/codex/_shared/kiwi/waves-event.md",
  "skills/etc/_shared/kiwi/waves-event.md",
  ".agents/skills/_shared/kiwi/waves-event.md"
];

const FIELD = "untested_allowance";

async function section22(copy: string): Promise<string[]> {
  const body = await readFile(path.join(process.cwd(), copy), "utf8");
  const lines = body.split("\n");
  const start = lines.findIndex((entry) => entry.startsWith("### 2.2"));
  if (start < 0) throw new Error(`${copy} has no "### 2.2" heading`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((entry) => entry.startsWith("### ") || entry.startsWith("## "));
  return end < 0 ? rest : rest.slice(0, end);
}

async function write(root: string, relativePath: string, text: string): Promise<void> {
  const absolute = path.join(root, relativePath);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, text, "utf8");
}

/** Runs `handoff validate` over a base declaring an allowance, and returns the line it wrote. */
async function writtenLine(): Promise<Record<string, unknown>> {
  const root = await mkdtemp(path.join(tmpdir(), "fr-node-172-"));
  await write(root, "kiwi/waves.jsonl", "");
  await write(root, "lane.json", JSON.stringify(defaultLane()));
  await write(root, "catalog.json", JSON.stringify(defaultCatalog()));
  await write(root, "base.json", JSON.stringify({ ...defaultRoot(), allowUntestedAc: 2 }));
  await write(root, "handoff.md", defaultHandoff());

  const pipes = { stdout: new PassThrough(), stderr: new PassThrough() };
  const exit = await main(
    [
      "--root", root, "orchestrate", "handoff", "validate",
      "--lane", "lane.json", "--path", "handoff.md", "--catalog", "catalog.json", "--base", "base.json",
      "--run-id", "run-a", "--json"
    ],
    pipes
  );
  expect(exit, pipes.stdout.read()?.toString() ?? "").toBe(0);

  const journal = await readFile(path.join(root, "kiwi/waves.jsonl"), "utf8");
  const lines = journal
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  expect(lines, "handoff validate must have written its line").toHaveLength(1);
  return lines[0] as Record<string, unknown>;
}

describe("FR-NODE-172 AC-1 — the allowance field is declared", () => {
  it("carries a §2.2 row in every copy and is in WAVES_EVENT_FIELDS.optional", async () => {
    expect(COPIES).toHaveLength(4);
    for (const copy of COPIES) {
      const row = (await section22(copy)).find((entry) => new RegExp(`^\\s*\\|\\s*\`${FIELD}\`\\s*\\|`).test(entry));
      expect(row, `${copy} declares no ${FIELD} row in §2.2`).toBeDefined();
      const cells = (row ?? "").split("|").map((cell) => cell.trim());
      expect(cells[2], `${copy}: ${FIELD} has an empty type cell`).not.toBe("");
      expect(cells[3], `${copy}: ${FIELD} has an empty purpose cell`).not.toBe("");
    }
    expect([...WAVES_EVENT_FIELDS.optional]).toContain(FIELD);
    expect([...WAVES_EVENT_FIELDS.required]).not.toContain(FIELD);
  });
});

describe("FR-NODE-172 AC-2 / AC-3 — every key the writer emits is declared", () => {
  it("writes no top-level key outside WAVES_EVENT_FIELDS", async () => {
    const line = await writtenLine();
    const declared = new Set<string>([...WAVES_EVENT_FIELDS.required, ...WAVES_EVENT_FIELDS.optional]);

    // AC-3. Asserted before the census, because a line that failed to parse or came back empty would
    // otherwise satisfy "no undeclared key" by having no keys at all.
    expect(Object.keys(line).length, "the line read back carries no keys").toBeGreaterThan(1);
    expect(line[FIELD], "the field this requirement is about must really be on the line").toBe(2);
    expect(declared, "`writer` is the stamp the append helper adds, so it must be declared too").toContain("writer");

    const undeclared = Object.keys(line).filter((key) => !declared.has(key));
    expect(undeclared, "every top-level key the tool writes must be a declared field").toEqual([]);
  });
});
