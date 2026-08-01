import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GATE_IDS } from "../../../src/core/orchestrator/auto-gate.js";
import { JOURNAL_RULES, JOURNAL_RULE_CODES, WAVES_EVENT_FIELDS } from "../../../src/core/orchestrator/journal-schema.js";
import { parseWavesJournal } from "../../../src/core/orchestrator/waves-journal.js";
import { validateWavesJournal } from "../../../src/core/orchestrator/waves-validate.js";
import { journalRoot, type Json } from "./waves-fixtures.js";

// @req FR-NODE-167 — `abort_gate` replaces the top-level `reason_class` an abort line wrote, and the
// value space is closed over `GateId`.
//
// The severity split is the load-bearing part. `appendWavesLine` validates the WHOLE resulting
// journal and refuses on any error, so a rule at error severity over history would refuse every
// append into a run holding one non-conforming line — `run abort` included, which would leave the
// run lock held with nothing able to release it. Error on the newest line, warning on the rest.

const COPIES = [
  "skills/claude/_shared/kiwi/waves-event.md",
  "skills/codex/_shared/kiwi/waves-event.md",
  "skills/etc/_shared/kiwi/waves-event.md",
  ".agents/skills/_shared/kiwi/waves-event.md"
];

const CODE = "abort-gate-outside-vocabulary";

/** A `GateId` member that a run really can end on, per the shipped skill's §V.abort-run. */
const LEGAL = "design-contradiction-at-wave-boundary";

/** A `reason_class` member, and precisely not a gate id — the drift that reached a fixture. */
const ILLEGAL = "budget-exhausted";

function line(extra: Record<string, unknown>): Json {
  return {
    ts: "2026-08-02T00:00:00Z",
    schema_version: "1.4.0",
    run_id: "run-a",
    engine: "kiwi-orchestrator",
    writer: "speckiwi-orchestrate/test",
    verb: "abort-run",
    event: "result",
    wave: "all",
    order: 0,
    target: "all",
    status: "in_progress",
    summary: "abort",
    ...extra
  } as unknown as Json;
}

async function diagnose(lines: Json[]): Promise<Array<{ code: string; severity: string; line?: number }>> {
  const root = await journalRoot(lines);
  const view = await parseWavesJournal(root, { runId: "run-a", engine: "kiwi-orchestrator" });
  return validateWavesJournal(view) as unknown as Array<{ code: string; severity: string; line?: number }>;
}

async function section22(copy: string): Promise<string[]> {
  const body = await readFile(path.join(process.cwd(), copy), "utf8");
  const lines = body.split("\n");
  const start = lines.findIndex((entry) => entry.startsWith("### 2.2"));
  if (start < 0) throw new Error(`${copy} has no "### 2.2" heading`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((entry) => entry.startsWith("### ") || entry.startsWith("## "));
  return end < 0 ? rest : rest.slice(0, end);
}

describe("FR-NODE-167 AC-2 — abort_gate is declared in all four copies and in the schema", () => {
  it("carries a §2.2 row with a type and a purpose in every copy", async () => {
    // Non-vacuity: four named paths, each read; a missing file throws rather than being skipped.
    expect(COPIES).toHaveLength(4);
    for (const copy of COPIES) {
      const row = (await section22(copy)).find((entry) => /^\s*\|\s*`abort_gate`\s*\|/.test(entry));
      expect(row, `${copy} declares no abort_gate row in §2.2`).toBeDefined();
      const cells = (row ?? "").split("|").map((cell) => cell.trim());
      // `| name | type | purpose |` splits to ["", name, type, purpose, ""].
      expect(cells[2], `${copy}: abort_gate has an empty type cell`).not.toBe("");
      expect(cells[3], `${copy}: abort_gate has an empty purpose cell`).not.toBe("");
    }
  });

  it("is a member of WAVES_EVENT_FIELDS.optional and not of required", () => {
    expect([...WAVES_EVENT_FIELDS.optional]).toContain("abort_gate");
    expect([...WAVES_EVENT_FIELDS.required]).not.toContain("abort_gate");
  });
});

describe("FR-NODE-167 AC-3 — the document version is not bumped", () => {
  it("still reads v1.4.0 in every copy", async () => {
    for (const copy of COPIES) {
      const first = (await readFile(path.join(process.cwd(), copy), "utf8")).split("\n")[0];
      expect(first, copy).toContain("v1.4.0");
    }
  });
});

describe("FR-NODE-167 AC-4 — the value space is GateId", () => {
  it("raises nothing for a GateId member and nothing for an absent field", async () => {
    expect(GATE_IDS as readonly string[]).toContain(LEGAL);
    expect(await diagnose([line({ abort_gate: LEGAL })])).toEqual([]);
    expect(await diagnose([line({})])).toEqual([]);
  });

  it("raises the code for a value outside the union", async () => {
    expect(GATE_IDS as readonly string[]).not.toContain(ILLEGAL);
    expect((await diagnose([line({ abort_gate: ILLEGAL })])).map((entry) => entry.code)).toEqual([CODE]);
  });
});

describe("FR-NODE-167 AC-5 — error on the newest line, warning on history", () => {
  it("reports error when the offending line is the newest", async () => {
    const found = (await diagnose([line({ abort_gate: ILLEGAL })])).filter((entry) => entry.code === CODE);
    expect(found).toHaveLength(1);
    expect(found[0]?.severity).toBe("error");
  });

  it("reports warning when a later line follows the offending one", async () => {
    const found = (await diagnose([line({ abort_gate: ILLEGAL }), line({ abort_gate: LEGAL })])).filter(
      (entry) => entry.code === CODE
    );
    expect(found, "only the bad line is reported").toHaveLength(1);
    expect(found[0]?.severity, "a historical line must not refuse the append that follows it").toBe("warning");
  });

  it("still reports error on the newest line when history also offends", async () => {
    const found = (await diagnose([line({ abort_gate: ILLEGAL }), line({ abort_gate: ILLEGAL })])).filter(
      (entry) => entry.code === CODE
    );
    expect(found).toHaveLength(2);
    expect(found.map((entry) => entry.severity)).toEqual(["warning", "error"]);
  });
});

describe("FR-NODE-167 AC-6 — the rule is registered in the rule tables", () => {
  it("is a JOURNAL_RULE_CODES member with a JOURNAL_RULES row naming its source", () => {
    expect([...JOURNAL_RULE_CODES]).toContain(CODE);
    const rule = JOURNAL_RULES.find((entry) => entry.code === CODE);
    expect(rule, "no JOURNAL_RULES row for the code").toBeDefined();
    expect(rule?.enforcement).toBe("diagnostic");
    expect(rule?.source.length ?? 0, "the row must name where the rule comes from").toBeGreaterThan(0);
  });
});
