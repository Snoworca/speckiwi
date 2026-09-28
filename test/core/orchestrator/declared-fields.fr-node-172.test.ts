import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../../src/cli/index.js";
import { WAVES_EVENT_FIELDS } from "../../../src/core/orchestrator/journal-schema.js";

// @req FR-NODE-172 — a field the tool writes and the contract does not declare is enforced nowhere.
//
// 4.0.0 removed `handoff validate`, the only writer of `untested_allowance`, so the field leaves the
// contract and the declared-key census moves to a writer that survives, `orchestrate round record`.

const COPIES = [
  "skills/claude/_shared/kiwi/waves-event.md",
  "skills/codex/_shared/kiwi/waves-event.md",
  "skills/etc/_shared/kiwi/waves-event.md",
  ".agents/skills/_shared/kiwi/waves-event.md"
];

const RETIRED_FIELD = "untested_allowance";

async function section22(copy: string): Promise<string[]> {
  const body = await readFile(path.join(process.cwd(), copy), "utf8");
  const lines = body.split("\n");
  const start = lines.findIndex((entry) => entry.startsWith("### 2.2"));
  if (start < 0) throw new Error(`${copy} has no "### 2.2" heading`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((entry) => entry.startsWith("### ") || entry.startsWith("## "));
  return end < 0 ? rest : rest.slice(0, end);
}

/** Runs `orchestrate round record` naming a run, and returns the line it wrote. */
async function writtenLine(): Promise<Record<string, unknown>> {
  const root = await mkdtemp(path.join(tmpdir(), "fr-node-172-"));
  await mkdir(path.join(root, "kiwi"), { recursive: true });
  await writeFile(path.join(root, "kiwi/waves.jsonl"), "", "utf8");
  const round = {
    loop: "P",
    scope: "wave-1-post",
    roundIndex: 1,
    mode: "normal",
    cap: 5,
    streakBefore: 0,
    frozenDenominator: 1,
    rows: [{ id: "R-1", verdict: "pass", severity: "MEDIUM" }],
    fixAppliedThisRound: false,
    regression: { failingTests: [], baselineFailingTests: [], exitCode: 0 },
    residual: []
  };

  const pipes = { stdout: new PassThrough(), stderr: new PassThrough() };
  const exit = await main(
    [
      "--root", root, "orchestrate", "round", "record",
      "--run-id", "run-a",
      "--payload", JSON.stringify(round),
      "--proof", JSON.stringify({ kind: "digest", ref: "sha256:0123456789abcdef" }),
      "--json"
    ],
    pipes
  );
  expect(exit, pipes.stdout.read()?.toString() ?? "").toBe(0);

  const journal = await readFile(path.join(root, "kiwi/waves.jsonl"), "utf8");
  const lines = journal
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  expect(lines, "round record must have written its line").toHaveLength(1);
  return lines[0] as Record<string, unknown>;
}

describe("FR-NODE-172 AC-1 — the retired allowance field is declared nowhere", () => {
  it("FR-NODE-172 AC-1 is absent from WAVES_EVENT_FIELDS and from the §2.2 table of every copy", async () => {
    expect([...WAVES_EVENT_FIELDS.optional]).not.toContain(RETIRED_FIELD);
    expect([...WAVES_EVENT_FIELDS.required]).not.toContain(RETIRED_FIELD);
    expect(COPIES).toHaveLength(4);
    for (const copy of COPIES) {
      const rows = await section22(copy);
      expect(rows.length, `${copy} has an empty §2.2`).toBeGreaterThan(0);
      expect(rows.some((entry) => new RegExp(`^\\s*\\|\\s*\`${RETIRED_FIELD}\`\\s*\\|`).test(entry)), `${copy} still declares ${RETIRED_FIELD}`).toBe(false);
    }
  });
});

describe("FR-NODE-172 AC-2 / AC-3 — every key the writer emits is declared", () => {
  it("FR-NODE-172 AC-2 AC-3 writes no top-level key outside WAVES_EVENT_FIELDS on a round record", async () => {
    const line = await writtenLine();
    const declared = new Set<string>([...WAVES_EVENT_FIELDS.required, ...WAVES_EVENT_FIELDS.optional]);

    // AC-3. Asserted before the census, because a line that failed to parse or came back empty would
    // otherwise satisfy "no undeclared key" by having no keys at all.
    expect(Object.keys(line).length, "the line read back carries no keys").toBeGreaterThan(1);
    expect(line.round, "the round index must really be on the line").toBe(1);
    expect(declared, "`writer` is the stamp the append helper adds, so it must be declared too").toContain("writer");

    const undeclared = Object.keys(line).filter((key) => !declared.has(key));
    expect(undeclared, "every top-level key the tool writes must be a declared field").toEqual([]);
  });
});
