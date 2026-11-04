import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPrdCursor, isPrdLedgerLine, parsePrd, prdCursorItems, PRD_LEDGER_SCHEMA } from "../../../src/core/prd/index.js";
import { buildPrd } from "./prd-fixture.js";

const PRD_PATH = "docs/prd/2026-11-04.reset.prd.md";
let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "speckiwi-prd-ledger-schema-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 5 });
});

const doc = parsePrd(buildPrd(), PRD_PATH);
const cursor = (runId: string) => createPrdCursor({ root, runId, direction: "prd-to-srs", prd: doc.pointer, items: prdCursorItems(doc) });
const ledger = (runId: string) => path.join(root, "kiwi", "prd", `${runId}.jsonl`);

/** One verdict line and one reset line, exactly as the writer writes them. */
async function writtenLines(): Promise<{ verdict: Record<string, unknown>; reset: Record<string, unknown> }> {
  await cursor("base").next({ verdict: "deferred", refs: ["FR-AUTH-001"], note: "waits for the user" });
  await cursor("base").reset();
  const [verdict, reset] = (await readFile(ledger("base"), "utf8")).trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
  return { verdict: verdict!, reset: reset! };
}

async function opens(line: unknown): Promise<string> {
  await mkdir(path.dirname(ledger("probe")), { recursive: true });
  await writeFile(ledger("probe"), `${JSON.stringify(line)}\n`, "utf8");
  const result = await cursor("probe").current();
  return result.ok ? "ok" : result.error.code;
}

/** A value of a type no ledger field takes. */
const WRONG_TYPE = { wrong: true };

/** For each field, values of the right type that the schema still refuses. */
const WRONG_VALUES: Record<string, unknown[]> = {
  event: ["other"],
  direction: ["sideways"],
  round: [0, -1, 1.5],
  index: [0, -1, 2.5],
  item: [""],
  verdict: ["looks-fine", "grounded"],
  refs: [[1]],
  prd: [
    "",
    PRD_PATH,
    `${PRD_PATH}@sha256:`,
    `${PRD_PATH}@sha256:${"a".repeat(63)}`,
    `${PRD_PATH}@sha256:${"A".repeat(64)}`,
    `@sha256:${"a".repeat(64)}`
  ],
  ts: [""],
  note: []
};

describe("FR-NODE-241 ledger line schema", () => {
  // @req FR-NODE-241 AC-3
  it("names the exact fields the writer writes, and every line the writer writes passes it", async () => {
    const { verdict, reset } = await writtenLines();
    expect(Object.keys(verdict).sort()).toEqual(Object.keys(PRD_LEDGER_SCHEMA.verdict).sort());
    expect(Object.keys(reset).sort()).toEqual(Object.keys(PRD_LEDGER_SCHEMA.reset).sort());
    expect(isPrdLedgerLine(verdict)).toBe(true);
    expect(isPrdLedgerLine(reset)).toBe(true);
    expect(await opens(verdict)).toBe("ok");
  });

  // @req FR-NODE-241 AC-3, AC-4
  it.each(["\u2028", "\u2029"])("round-trips a ledger line for a PRD whose path holds %j", async (separator) => {
    const named = parsePrd(buildPrd(), `docs/prd/a${separator}b.prd.md`);
    const write = () => createPrdCursor({ root, runId: "sep", direction: "prd-to-srs", prd: named.pointer, items: prdCursorItems(named) });
    expect((await write().next({ verdict: "accepted" })).ok).toBe(true);
    const [line] = (await readFile(ledger("sep"), "utf8")).trim().split("\n").map((entry) => JSON.parse(entry) as unknown);
    expect(isPrdLedgerLine(line)).toBe(true);
    const resumed = await write().current();
    expect(resumed.ok && resumed.value).toMatchObject({ index: 2, prd: named.pointer });
  });

  // @req FR-NODE-241 AC-3
  it("refuses as a corrupt ledger every line with a field missing, of the wrong type, or with a value the writer never writes", async () => {
    const { verdict, reset } = await writtenLines();
    const failures: string[] = [];
    for (const [event, base] of [["verdict", verdict], ["reset", reset]] as const) {
      for (const field of Object.keys(base)) {
        const missing = { ...base };
        delete missing[field];
        const cases: Array<[string, unknown]> = [
          [`${event} without ${field}`, missing],
          [`${event} with ${field} of the wrong type`, { ...base, [field]: WRONG_TYPE }],
          ...(WRONG_VALUES[field] ?? []).map((value): [string, unknown] => [`${event} with ${field}=${JSON.stringify(value)}`, { ...base, [field]: value }])
        ];
        for (const [name, line] of cases) {
          expect(isPrdLedgerLine(line), name).toBe(false);
          const code = await opens(line);
          if (code !== "PRD_LEDGER_CORRUPT") failures.push(`${name}: ${code}`);
        }
      }
      expect(await opens({ ...base, extra: 1 })).toBe("PRD_LEDGER_CORRUPT");
      for (const field of Object.keys(base)) {
        const renamed: Record<string, unknown> = { ...base, [`${field}_`]: base[field] };
        delete renamed[field];
        expect(await opens(renamed), `${event} with ${field} renamed`).toBe("PRD_LEDGER_CORRUPT");
      }
    }
    expect(failures).toEqual([]);
    // Every field of the schema is covered by the rows above.
    expect(Object.keys(WRONG_VALUES).sort()).toEqual(Object.keys(PRD_LEDGER_SCHEMA.verdict).sort());
  });
});
