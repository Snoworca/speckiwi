import { appendFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createPrdCursor,
  parsePrd,
  prdCursorItems,
  srsCursorItems,
  type PrdCursor
} from "../../../src/core/prd/index.js";
import type { RequirementRecord } from "../../../src/core/types.js";
import { buildPrd } from "./prd-fixture.js";

const PRD_PATH = "docs/prd/2026-11-04.reset.prd.md";
let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "speckiwi-fr-node-241-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 5 });
});

function cursorFor(text: string, runId = "run-a"): PrdCursor {
  const doc = parsePrd(text, PRD_PATH);
  return createPrdCursor({ root, runId, direction: "prd-to-srs", prd: doc.pointer, items: prdCursorItems(doc) });
}

function ledgerPath(runId: string): string {
  return path.join(root, "kiwi", "prd", `${runId}.jsonl`);
}

async function ledgerLines(runId: string): Promise<Array<Record<string, unknown>>> {
  const text = await readFile(ledgerPath(runId), "utf8");
  return text.trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe("FR-NODE-241 PRD cursor", () => {
  // @req FR-NODE-241 AC-1
  it("offers count, current, next, seek and reset, each response carrying index, total, item ID, quote and the PRD pointer", async () => {
    const cursor = cursorFor(buildPrd());
    const doc = parsePrd(buildPrd(), PRD_PATH);
    expect(cursor.count()).toEqual({ total: 4, prd: doc.pointer });

    const current = await cursor.current();
    expect(current.ok).toBe(true);
    if (!current.ok) return;
    expect(current.value).toMatchObject({ index: 1, total: 4, prd: doc.pointer, item: { id: "PRD-1", quote: "비밀번호 재설정 링크를 추가해" } });

    const next = await cursor.next({ verdict: "accepted", refs: ["FR-AUTH-001"] });
    expect(next.ok).toBe(true);
    if (!next.ok) return;
    expect(next.value).toMatchObject({ index: 2, total: 4, prd: doc.pointer, item: { id: "PRD-2", quote: "Password reset email must expire after one hour." } });

    const seek = await cursor.seek(4);
    expect(seek.ok).toBe(true);
    if (!seek.ok) return;
    expect(seek.value).toMatchObject({ index: 4, total: 4, prd: doc.pointer, item: { id: "PRD-4" } });
    const afterSeek = await cursor.current();
    expect(afterSeek.ok && afterSeek.value.index).toBe(2);
    const judged = await cursor.seek(1);
    expect(judged.ok && judged.value).toMatchObject({ index: 1, verdict: "accepted", item: { id: "PRD-1" } });

    const reset = await cursor.reset();
    expect(reset.ok).toBe(true);
    if (!reset.ok) return;
    expect(reset.value).toMatchObject({ index: 1, total: 4, round: 2, prd: doc.pointer, item: { id: "PRD-1" } });
  });

  // @req FR-NODE-241 AC-1
  it("refuses a seek outside 1..total", async () => {
    const cursor = cursorFor(buildPrd());
    expect((await cursor.seek(0)).ok).toBe(false);
    expect((await cursor.seek(5)).ok).toBe(false);
  });

  // @req FR-NODE-241 AC-2
  it("refuses next without a verdict, with an unknown verdict, and with deferred but no reason", async () => {
    const cursor = cursorFor(buildPrd());
    const missing = await cursor.next({});
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error.code).toBe("PRD_CURSOR_VERDICT_REQUIRED");
    const unknown = await cursor.next({ verdict: "looks-fine" });
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.error.code).toBe("PRD_CURSOR_VERDICT_INVALID");
    const deferredBare = await cursor.next({ verdict: "deferred" });
    expect(deferredBare.ok).toBe(false);
    if (!deferredBare.ok) expect(deferredBare.error.code).toBe("PRD_CURSOR_DEFER_REASON_REQUIRED");
    const current = await cursor.current();
    expect(current.ok && current.value.index).toBe(1);
  });

  // @req FR-NODE-241 AC-2
  it("skips an item only with the explicit verdict deferred and a reason", async () => {
    const cursor = cursorFor(buildPrd());
    const skipped = await cursor.next({ verdict: "deferred", note: "needs the user's answer" });
    expect(skipped.ok && skipped.value.index).toBe(2);
    expect((await ledgerLines("run-a"))[0]).toMatchObject({ item: "PRD-1", verdict: "deferred", note: "needs the user's answer" });
  });

  // @req FR-NODE-241 AC-2
  it("refuses next once every item is judged and reports done", async () => {
    const cursor = cursorFor(buildPrd());
    for (let i = 0; i < 3; i += 1) expect((await cursor.next({ verdict: "accepted" })).ok).toBe(true);
    const last = await cursor.next({ verdict: "respected" });
    expect(last.ok).toBe(true);
    if (last.ok) expect(last.value).toMatchObject({ index: 4, total: 4, done: true });
    const beyond = await cursor.next({ verdict: "accepted" });
    expect(beyond.ok).toBe(false);
    if (!beyond.ok) expect(beyond.error.code).toBe("PRD_CURSOR_DONE");
  });

  // @req FR-NODE-241 AC-2
  it("takes the srs-to-prd verdicts on requirement and criterion items and refuses the other direction's verdicts", async () => {
    const doc = parsePrd(buildPrd(), PRD_PATH);
    const record = {
      id: "FR-AUTH-001", title: "Reset", requirement: "Users reset passwords.", target: "1.0.0", status: "planned",
      acceptanceCriteria: [{ id: "AC-1", text: "link expires", checked: false }]
    } as unknown as RequirementRecord;
    const items = srsCursorItems([record], "1.0.0");
    expect(items.map((item) => item.id)).toEqual(["FR-AUTH-001", "FR-AUTH-001#AC-1"]);
    expect(items[1]!.quote).toBe("link expires");
    const cursor = createPrdCursor({ root, runId: "rev", direction: "srs-to-prd", prd: doc.pointer, items });
    expect((await cursor.next({ verdict: "accepted" })).ok).toBe(false);
    expect((await cursor.next({ verdict: "grounded", refs: ["PRD-2"] })).ok).toBe(true);
  });

  // @req FR-NODE-241 AC-3
  it("appends one verdict per line to kiwi/prd/<run_id>.jsonl and derives the index from it, so a fresh cursor resumes", async () => {
    const first = cursorFor(buildPrd());
    await first.next({ verdict: "accepted", refs: ["FR-AUTH-001"], note: "ok" });
    await first.next({ verdict: "fail" });
    const lines = await ledgerLines("run-a");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ direction: "prd-to-srs", round: 1, index: 1, item: "PRD-1", verdict: "accepted", refs: ["FR-AUTH-001"], note: "ok" });
    expect(String(lines[0]!.prd)).toMatch(/@sha256:[0-9a-f]{64}$/);
    const resumed = await cursorFor(buildPrd()).current();
    expect(resumed.ok && resumed.value.index).toBe(3);
  });

  // @req FR-NODE-241 AC-3
  it("follows a ledger line written by hand: the index is computed, not stored", async () => {
    const cursor = cursorFor(buildPrd());
    await cursor.next({ verdict: "accepted" });
    const [line] = await ledgerLines("run-a");
    await appendFile(ledgerPath("run-a"), `${JSON.stringify({ ...line, index: 2, item: "PRD-2" })}\n`, "utf8");
    const current = await cursorFor(buildPrd()).current();
    expect(current.ok && current.value.index).toBe(3);
  });

  // @req FR-NODE-241 AC-3
  it("keeps two run IDs apart and refuses a run ID that would leave kiwi/prd", async () => {
    await cursorFor(buildPrd(), "run-a").next({ verdict: "accepted" });
    const other = await cursorFor(buildPrd(), "run-b").current();
    expect(other.ok && other.value.index).toBe(1);
    await cursorFor(buildPrd(), "run-b").next({ verdict: "fail" });
    expect(await ledgerLines("run-a")).toHaveLength(1);
    expect(await ledgerLines("run-b")).toHaveLength(1);
    const escaped = await cursorFor(buildPrd(), "../run-a").current();
    expect(escaped.ok).toBe(false);
    if (!escaped.ok) expect(escaped.error.code).toBe("PRD_CURSOR_RUN_ID_INVALID");
  });

  // @req FR-NODE-241 AC-3
  it("refuses a run ID with capitals, since a case-insensitive file system would give two such IDs one ledger", async () => {
    const result = await cursorFor(buildPrd(), "Run1").current();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("PRD_CURSOR_RUN_ID_INVALID");
  });

  // @req FR-NODE-241 AC-3
  it.runIf(process.platform === "win32")("serialises next calls on one ledger reached through two spellings of the root", async () => {
    const doc = parsePrd(buildPrd(), PRD_PATH);
    const spelled = root.replace(/^[a-z]:/i, (drive) => (drive === drive.toUpperCase() ? drive.toLowerCase() : drive.toUpperCase()));
    const a = createPrdCursor({ root, runId: "x", direction: "prd-to-srs", prd: doc.pointer, items: prdCursorItems(doc) });
    const b = createPrdCursor({ root: spelled, runId: "x", direction: "prd-to-srs", prd: doc.pointer, items: prdCursorItems(doc) });
    await Promise.all([a.next({ verdict: "accepted" }), b.next({ verdict: "fail" })]);
    expect((await ledgerLines("x")).map((line) => line.index)).toEqual([1, 2]);
  });

  // @req FR-NODE-241 AC-3
  it("counts a verdict only for the item it names, so a changed item list resumes at the first item not judged", async () => {
    const doc = parsePrd(buildPrd(), PRD_PATH);
    const reqs = (ids: string[]) =>
      ids.map((id) => ({ id, title: id, requirement: `${id} statement`, target: "1.0.0", status: "planned", acceptanceCriteria: [{ id: "AC-1", text: `${id} criterion`, checked: false }] }) as unknown as RequirementRecord);
    const before = createPrdCursor({ root, runId: "s", direction: "srs-to-prd", prd: doc.pointer, items: srsCursorItems(reqs(["FR-AUTH-002"]), "1.0.0") });
    await before.next({ verdict: "grounded" });
    await before.next({ verdict: "grounded" });
    const after = createPrdCursor({ root, runId: "s", direction: "srs-to-prd", prd: doc.pointer, items: srsCursorItems(reqs(["FR-AUTH-001", "FR-AUTH-002"]), "1.0.0") });
    const current = await after.current();
    expect(current.ok && current.value).toMatchObject({ index: 1, item: { id: "FR-AUTH-001" } });
    const seek = await after.seek(1);
    expect(seek.ok && seek.value.verdict).toBeUndefined();
    await after.next({ verdict: "grounded" });
    const resumed = await after.next({ verdict: "grounded" });
    expect(resumed.ok && resumed.value).toMatchObject({ done: true, index: 4 });
  });

  // @req FR-NODE-241 AC-4
  it("refuses a PRD pointer that is not <path>@sha256:<64 lower-case hex>, since its hash decides invalidation", async () => {
    const doc = parsePrd(buildPrd(), PRD_PATH);
    for (const prd of [PRD_PATH, `${PRD_PATH}@sha256:`, `${PRD_PATH}@sha256:${"A".repeat(64)}`]) {
      const result = await createPrdCursor({ root, runId: "ptr", direction: "prd-to-srs", prd, items: prdCursorItems(doc) }).current();
      expect(!result.ok && result.error.code, prd).toBe("PRD_CURSOR_POINTER_INVALID");
    }
  });

  // @req FR-NODE-241 AC-3
  it("refuses items that share an ID, since a verdict names its item by ID", async () => {
    const doc = parsePrd(buildPrd(), PRD_PATH);
    const items = prdCursorItems(doc);
    const cursor = createPrdCursor({ root, runId: "dup", direction: "prd-to-srs", prd: doc.pointer, items: [...items, items[0]!] });
    const result = await cursor.current();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("PRD_CURSOR_DUPLICATE_ITEM");
  });

  // @req FR-NODE-241 AC-3
  it("refuses a ledger with a corrupt line instead of skipping it", async () => {
    const cursor = cursorFor(buildPrd());
    await cursor.next({ verdict: "accepted" });
    await appendFile(ledgerPath("run-a"), "{not json\n", "utf8");
    const current = await cursorFor(buildPrd()).current();
    expect(current.ok).toBe(false);
    if (!current.ok) expect(current.error.code).toBe("PRD_LEDGER_CORRUPT");
  });

  // @req FR-NODE-241 AC-3
  it("refuses an unparseable line in the middle, even when the file ends with a good line", async () => {
    const cursor = cursorFor(buildPrd());
    await cursor.next({ verdict: "accepted" });
    const [line] = await ledgerLines("run-a");
    await appendFile(ledgerPath("run-a"), `{not json\n${JSON.stringify({ ...line, index: 2, item: "PRD-2" })}\n`, "utf8");
    const current = await cursorFor(buildPrd()).current();
    expect(!current.ok && current.error.code).toBe("PRD_LEDGER_CORRUPT");
  });

  // @req FR-NODE-241 AC-3
  it("reads a torn last line left by an interrupted append as no verdict, reports it, and cuts it before the next append", async () => {
    const cursor = cursorFor(buildPrd());
    await cursor.next({ verdict: "accepted" });
    await appendFile(ledgerPath("run-a"), '{"event":"verdict","prd":"docs/prd/x', "utf8");
    const current = await cursorFor(buildPrd()).current();
    expect(current.ok && current.value).toMatchObject({ index: 2, tornTail: true });
    const next = await cursorFor(buildPrd()).next({ verdict: "fail" });
    expect(next.ok && next.value.index).toBe(3);
    expect(next.ok && next.value.tornTail).toBeUndefined();
    expect((await ledgerLines("run-a")).map((entry) => entry.item)).toEqual(["PRD-1", "PRD-2"]);
  });

  // @req FR-NODE-241 AC-3
  it("refuses a last line that parses as JSON but is no ledger entry, and does not cut it on append", async () => {
    const cursor = cursorFor(buildPrd());
    await cursor.next({ verdict: "accepted" });
    await appendFile(ledgerPath("run-a"), '{"note":"not an entry"}', "utf8");
    const current = await cursorFor(buildPrd()).current();
    expect(!current.ok && current.error.code).toBe("PRD_LEDGER_CORRUPT");
    const next = await cursorFor(buildPrd()).next({ verdict: "fail" });
    expect(!next.ok && next.error.code).toBe("PRD_LEDGER_CORRUPT");
    expect(await readFile(ledgerPath("run-a"), "utf8")).toMatch(/\{"note":"not an entry"\}$/);
  });

  // @req FR-NODE-241 AC-3
  it("starts a new line after a complete last line that lost its line break", async () => {
    const cursor = cursorFor(buildPrd());
    await cursor.next({ verdict: "accepted" });
    const text = await readFile(ledgerPath("run-a"), "utf8");
    await writeFile(ledgerPath("run-a"), text.replace(/\n$/, ""), "utf8");
    const current = await cursorFor(buildPrd()).current();
    expect(current.ok && current.value).toMatchObject({ index: 2 });
    expect(current.ok && current.value.tornTail).toBeUndefined();
    await cursorFor(buildPrd()).next({ verdict: "fail" });
    expect((await ledgerLines("run-a")).map((entry) => entry.item)).toEqual(["PRD-1", "PRD-2"]);
  });

  // @req FR-NODE-241 AC-4
  it("voids the current round's lines when the PRD hash changes, reports both hashes and restarts at index 1", async () => {
    const original = buildPrd();
    const before = cursorFor(original);
    await before.next({ verdict: "accepted" });
    await before.next({ verdict: "accepted" });
    const changed = original.replace("이대로 진행해 주세요.", "이대로 진행해 주세요. 추가 승인.");
    const after = cursorFor(changed);
    const current = await after.current();
    expect(current.ok).toBe(true);
    if (!current.ok) return;
    const previousHash = parsePrd(original, PRD_PATH).pointer.split("@sha256:")[1];
    const currentHash = parsePrd(changed, PRD_PATH).pointer.split("@sha256:")[1];
    expect(current.value.index).toBe(1);
    expect(current.value.invalidated).toEqual({ previous: previousHash, current: currentHash, judged: 2 });
    expect(after.count().prd).toBe(parsePrd(changed, PRD_PATH).pointer);
    const resumed = await after.next({ verdict: "accepted" });
    expect(resumed.ok && resumed.value.index).toBe(2);
  });

  // @req FR-NODE-241 AC-4
  it("does not void lines of an earlier round", async () => {
    const original = buildPrd();
    const cursor = cursorFor(original);
    await cursor.next({ verdict: "accepted" });
    await cursor.reset();
    await cursor.next({ verdict: "accepted" });
    const current = await cursorFor(original).current();
    expect(current.ok && current.value).toMatchObject({ index: 2, round: 2 });
    expect(current.ok && current.value.invalidated).toBeUndefined();
  });

  it("writes nothing on refused calls", async () => {
    const cursor = cursorFor(buildPrd());
    await cursor.next({});
    await expect(readFile(ledgerPath("run-a"), "utf8")).rejects.toThrow();
  });
});

describe("FR-NODE-241 invalidation by any line of the current round", () => {
  const original = parsePrd(buildPrd(), PRD_PATH);
  const other = parsePrd(buildPrd({ approval: "다른 승인 문장" }), PRD_PATH);
  const hash = (pointer: string) => pointer.split("@sha256:")[1];
  // Ledger: [0] round-1 verdict, [1] reset opening round 2, [2..4] round-2 verdicts for PRD-1..PRD-3.
  // One line of another hash voids the whole round (AC-4: restart at index 1); `judged` counts the
  // round's verdicts made void, here all three. A reset line is no verdict.
  const rows: Array<{ name: string; line: number; invalidated: boolean; index: number; judged?: number }> = [
    { name: "the reset line that opened the round", line: 1, invalidated: true, index: 1, judged: 3 },
    { name: "the round's first verdict", line: 2, invalidated: true, index: 1, judged: 3 },
    { name: "a middle verdict", line: 3, invalidated: true, index: 1, judged: 3 },
    { name: "the round's last verdict", line: 4, invalidated: true, index: 1, judged: 3 },
    { name: "a line of the previous round only", line: 0, invalidated: false, index: 4 }
  ];

  // @req FR-NODE-241 AC-4
  it.each(rows)("reports invalidated exactly when a line of the current round carries another PRD hash: $name", async ({ line, invalidated, index, judged }) => {
    const writer = createPrdCursor({ root, runId: "m", direction: "prd-to-srs", prd: original.pointer, items: prdCursorItems(original) });
    await writer.next({ verdict: "accepted" });
    await writer.reset();
    for (let i = 0; i < 3; i += 1) await writer.next({ verdict: "accepted" });
    const lines = (await readFile(ledgerPath("m"), "utf8")).trim().split("\n");
    lines[line] = JSON.stringify({ ...(JSON.parse(lines[line]!) as Record<string, unknown>), prd: other.pointer });
    await writeFile(ledgerPath("m"), `${lines.join("\n")}\n`, "utf8");
    const position = await createPrdCursor({ root, runId: "m", direction: "prd-to-srs", prd: original.pointer, items: prdCursorItems(original) }).current();
    expect(position.ok).toBe(true);
    if (!position.ok) return;
    expect(position.value.round).toBe(2);
    expect(position.value.index).toBe(index);
    if (invalidated) expect(position.value.invalidated).toEqual({ previous: hash(other.pointer), current: hash(original.pointer), judged });
    else expect(position.value.invalidated).toBeUndefined();
  });
});

describe("FR-NODE-241 a round voided by another hash", () => {
  const a = buildPrd();
  const b = buildPrd({ approval: "바뀐 승인 문장" });
  const hash = (text: string) => parsePrd(text, PRD_PATH).pointer.split("@sha256:")[1];

  // @req FR-NODE-241 AC-4
  it("restarts at index 1 when the PRD returns to earlier bytes after a verdict on other bytes", async () => {
    await cursorFor(a).next({ verdict: "accepted" });
    await cursorFor(a).next({ verdict: "accepted" });
    await cursorFor(b).next({ verdict: "violated" });
    const back = await cursorFor(a).current();
    expect(back.ok && back.value).toMatchObject({ index: 1, round: 2, invalidated: { previous: hash(b), current: hash(a), judged: 1 } });
    // The answer is computed, not stored: asking again gives the same.
    const again = await cursorFor(a).current();
    expect(again.ok && again.value).toMatchObject({ index: 1, invalidated: { previous: hash(b) } });
  });

  // @req FR-NODE-241 AC-3, AC-4
  it("records the new round in the ledger before the next verdict, so the restart is computed from the ledger alone", async () => {
    await cursorFor(a).next({ verdict: "accepted" });
    await cursorFor(b).next({ verdict: "fail" });
    const next = await cursorFor(a).next({ verdict: "respected" });
    expect(next.ok && next.value).toMatchObject({ index: 2, round: 3 });
    expect(next.ok && next.value.invalidated).toBeUndefined();
    const lines = await ledgerLines("run-a");
    expect(lines.map((line) => [line.event, line.round, line.item ?? null])).toEqual([
      ["verdict", 1, "PRD-1"],
      ["reset", 2, null],
      ["verdict", 2, "PRD-1"],
      ["reset", 3, null],
      ["verdict", 3, "PRD-1"]
    ]);
  });
});
