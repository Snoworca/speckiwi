import { fail, ok, type Result } from "../result.js";
import type { RequirementRecord } from "../types.js";
import { appendPrdLedger, onLedger, PRD_CURSOR_VERDICTS, prdLedgerPath, readPrdLedger, type PrdCursorDirection, type PrdLedgerLine, type PrdVerdictLine } from "./ledger.js";
import type { PrdDocument } from "./model.js";
import { parsePrdPointer } from "./pointer.js";

// @req FR-NODE-241 — a cursor over the items one verification direction judges. It stores no
// position: every call reads the run's ledger and takes the index from it, so a session that lost
// its context resumes at the first item it has not judged, and the index can never disagree with
// the verdicts.

export { PRD_CURSOR_VERDICTS, type PrdCursorDirection } from "./ledger.js";

export interface PrdCursorItem {
  id: string;
  kind: string;
  title: string;
  quote: string;
  source: string[];
}

export interface PrdCursorOptions {
  /** Workspace root; the ledger is `<root>/kiwi/prd/<runId>.jsonl`. */
  root: string;
  runId: string;
  direction: PrdCursorDirection;
  /** The PRD pointer `<path>@sha256:<hex>` as the PRD reads now (`PrdDocument.pointer`). */
  prd: string;
  items: readonly PrdCursorItem[];
}

export interface PrdCursorPosition {
  index: number;
  total: number;
  round: number;
  direction: PrdCursorDirection;
  prd: string;
  /** Absent only when there is nothing to iterate. */
  item?: PrdCursorItem;
  /** The verdict already recorded for this item in this round (seek). */
  verdict?: string;
  /** Every item of the round has a verdict; `index` is then `total`. */
  done?: true;
  /** Verdict counts of the round, once done. */
  summary?: Record<string, number>;
  /** The round's lines written against another PRD hash, now void. */
  invalidated?: { previous: string; current: string; judged: number };
  /** The ledger ends in an append that was cut off; it counts as no verdict and the next append removes it. */
  tornTail?: true;
}

export interface PrdVerdictInput {
  verdict?: string;
  refs?: string[];
  /** Required for `deferred`: why the item is skipped. */
  note?: string;
}

export interface PrdCursor {
  count(): { total: number; prd: string };
  current(): Promise<Result<PrdCursorPosition>>;
  /** Records the verdict for the current item and moves to the next one. */
  next(input: PrdVerdictInput): Promise<Result<PrdCursorPosition>>;
  /** Shows item `index` (1-based) without changing any verdict or the current index. */
  seek(index: number): Promise<Result<PrdCursorPosition>>;
  /** Opens a new round of the same run at index 1. */
  reset(): Promise<Result<PrdCursorPosition>>;
}

export function prdCursorItems(doc: PrdDocument): PrdCursorItem[] {
  return doc.items.map((item) => ({ id: item.id, kind: item.kind, title: item.title, quote: item.quote, source: item.source }));
}

/** The requirements of `target` and their live criteria, in the given order, as `FR-X-001` and `FR-X-001#AC-2`. */
export function srsCursorItems(records: readonly RequirementRecord[], target: string): PrdCursorItem[] {
  return records
    .filter((record) => record.target === target && record.status !== "discarded")
    .flatMap((record) => [
      { id: record.id, kind: "requirement", title: record.title, quote: record.requirement ?? "", source: [] },
      ...record.acceptanceCriteria.map((criterion) => ({
        id: `${record.id}#${criterion.id}`,
        kind: "criterion",
        title: record.title,
        quote: criterion.text,
        source: []
      }))
    ]);
}

/** The hash of a pointer the cursor or the ledger schema has already checked; nothing else reaches it. */
function hashOf(pointer: string): string {
  return parsePrdPointer(pointer)!.sha256;
}

interface RoundState {
  round: number;
  /** 1-based index of the first item without a verdict; total + 1 when every item has one. */
  index: number;
  /** The round's valid verdict per item ID, the latest line winning. */
  verdicts: ReadonlyMap<string, PrdVerdictLine>;
  invalidated?: PrdCursorPosition["invalidated"];
  tornTail?: boolean;
}

/**
 * @req FR-NODE-241 AC-3, AC-4 — the position is a function of the ledger, the items and the PRD's
 * current hash. A verdict counts for the item whose ID it names, not for whatever item now sits at its
 * index, so an item list that changed under the same PRD (a requirement added to the target) resumes
 * at the first item nobody judged.
 *
 * One line of the round written against another PRD hash, the reset that opened it included, voids the
 * whole round (AC-4: "the hash on the ledger lines of the current round", restart at index 1). Only
 * the round's lines decide, never an earlier round's, so a PRD that returns to earlier bytes does not
 * revive verdicts made on them. `invalidated` and `index` come from this one judgment.
 */
function roundState(lines: readonly PrdLedgerLine[], direction: PrdCursorDirection, prd: string, items: readonly PrdCursorItem[]): RoundState {
  const own = lines.filter((line) => line.direction === direction);
  const round = own.reduce((highest, line) => Math.max(highest, line.round), 1);
  const ofRound = own.filter((line) => line.round === round);
  const judged = ofRound.filter((line): line is PrdVerdictLine => line.event === "verdict");
  const current = hashOf(prd);
  const stale = ofRound.filter((line) => hashOf(line.prd) !== current);
  if (stale.length > 0) {
    return { round, index: 1, verdicts: new Map(), invalidated: { previous: hashOf(stale[stale.length - 1]!.prd), current, judged: judged.length } };
  }
  const verdicts = new Map(judged.map((line) => [line.item, line]));
  const unjudged = items.findIndex((item) => !verdicts.has(item.id));
  return { round, index: unjudged < 0 ? items.length + 1 : unjudged + 1, verdicts };
}

export function createPrdCursor(options: PrdCursorOptions): PrdCursor {
  const total = options.items.length;
  const ids = options.items.map((item) => item.id);
  const duplicate = ids.find((id, position) => ids.indexOf(id) !== position);
  const ledger: Result<string> =
    parsePrdPointer(options.prd) === undefined
      ? fail("PRD_CURSOR_POINTER_INVALID", `PRD pointer "${options.prd}" is not <path>@sha256:<64 lower-case hex>; pass PrdDocument.pointer`)
      : duplicate !== undefined
        ? fail("PRD_CURSOR_DUPLICATE_ITEM", `Item ${duplicate} appears twice; a verdict names its item by ID, so the IDs must be unique (run prd check)`)
        : prdLedgerPath(options.root, options.runId);

  function position(state: RoundState, index: number): PrdCursorPosition {
    const done = index > total;
    const shown = done ? total : index;
    const result: PrdCursorPosition = { index: shown, total, round: state.round, direction: options.direction, prd: options.prd };
    const item = options.items[shown - 1];
    if (item) result.item = item;
    const recorded = item ? state.verdicts.get(item.id) : undefined;
    if (!done && recorded) result.verdict = recorded.verdict;
    if (done) {
      result.done = true;
      result.summary = {};
      for (const { id } of options.items) {
        const verdict = state.verdicts.get(id)?.verdict;
        if (verdict !== undefined) result.summary[verdict] = (result.summary[verdict] ?? 0) + 1;
      }
    }
    if (state.invalidated) result.invalidated = state.invalidated;
    if (state.tornTail) result.tornTail = true;
    return result;
  }

  async function load(): Promise<Result<{ file: string; state: RoundState }>> {
    if (!ledger.ok) return ledger;
    const lines = await readPrdLedger(ledger.value);
    if (!lines.ok) return lines;
    return ok({ file: ledger.value, state: { ...roundState(lines.value.lines, options.direction, options.prd, options.items), tornTail: lines.value.tornTail } });
  }

  function validate(input: PrdVerdictInput): Result<{ verdict: string; note: string }> {
    const verdict = input.verdict?.trim() ?? "";
    const note = input.note?.trim() ?? "";
    const allowed = PRD_CURSOR_VERDICTS[options.direction];
    if (verdict === "") return fail("PRD_CURSOR_VERDICT_REQUIRED", "next records a verdict for the current item; skip an item only with verdict \"deferred\" and a note");
    if (!allowed.includes(verdict)) return fail("PRD_CURSOR_VERDICT_INVALID", `Verdict "${verdict}" is not one of ${allowed.join(", ")} for ${options.direction}`);
    if (verdict === "deferred" && note === "") return fail("PRD_CURSOR_DEFER_REASON_REQUIRED", "A deferred item needs a note saying why it is skipped");
    return ok({ verdict, note });
  }

  async function current(): Promise<Result<PrdCursorPosition>> {
    const loaded = await load();
    return loaded.ok ? ok(position(loaded.value.state, loaded.value.state.index)) : loaded;
  }

  async function next(input: PrdVerdictInput): Promise<Result<PrdCursorPosition>> {
    const checked = validate(input);
    if (!checked.ok) return checked;
    if (!ledger.ok) return ledger;
    return onLedger(ledger.value, async () => {
      const loaded = await load();
      if (!loaded.ok) return loaded;
      const { file, state } = loaded.value;
      if (state.index > total) return fail("PRD_CURSOR_DONE", `Every item of round ${state.round} has a verdict; reset opens a new round`);
      // A voided round is closed in the ledger before the first verdict of the next one, so the restart
      // is read back from the ledger rather than held anywhere.
      const round = state.invalidated ? state.round + 1 : state.round;
      if (state.invalidated) {
        await appendPrdLedger(file, { event: "reset", prd: options.prd, direction: options.direction, round, ts: new Date().toISOString() });
      }
      await appendPrdLedger(file, {
        event: "verdict",
        prd: options.prd,
        direction: options.direction,
        round,
        index: state.index,
        item: options.items[state.index - 1]!.id,
        verdict: checked.value.verdict,
        refs: input.refs ?? [],
        note: checked.value.note,
        ts: new Date().toISOString()
      });
      return current();
    });
  }

  async function seek(index: number): Promise<Result<PrdCursorPosition>> {
    if (!Number.isInteger(index) || index < 1 || index > total) return fail("PRD_CURSOR_INDEX_OUT_OF_RANGE", `Index ${index} is outside 1..${total}`);
    const loaded = await load();
    return loaded.ok ? ok(position(loaded.value.state, index)) : loaded;
  }

  async function reset(): Promise<Result<PrdCursorPosition>> {
    if (!ledger.ok) return ledger;
    return onLedger(ledger.value, async () => {
      const loaded = await load();
      if (!loaded.ok) return loaded;
      const round = loaded.value.state.round + 1;
      await appendPrdLedger(loaded.value.file, { event: "reset", prd: options.prd, direction: options.direction, round, ts: new Date().toISOString() });
      return current();
    });
  }

  return { count: () => ({ total, prd: options.prd }), current, next, seek, reset };
}
