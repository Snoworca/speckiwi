import { describe, expect, it } from "vitest";
import { lexJsSource } from "../../../src/core/orchestrator/js-source-lexer.js";
import { testCaseSurface } from "../../../src/core/orchestrator/js-test-cases.js";
import { preservationRowsFor } from "../../../src/core/orchestrator/preservation.js";

// @req FR-NODE-282 AC-3 — every occurrence of a case's context is classified by a closed list into a
// skip, a hand-off or a read; any other form leaves the file unchecked.
//
// 5.3.8 tried three review rounds to recognise a context handed to a helper by open-ended examples;
// each round's fix flipped a neighbouring spelling (FR-NODE-265 Research). A closed list settles which
// spellings are judged at all: the reader counts what it can name and declines the rest visibly.

function caseFile(callback: string): string {
  return ['import { expect, it } from "vitest";', "function helper(c: unknown) { return c; }", `it("t", ${callback});`, ""].join("\n");
}

function only(callback: string) {
  const source = lexJsSource(caseFile(callback));
  if (source === null) throw new Error("lexer refused the source");
  const surface = testCaseSurface(source);
  return surface === null ? null : (surface.cases[0] ?? null);
}

/** The preservation outcome when `line` is added to an existing case whose callback takes `parameters`. */
function rowsWhenAdded(line: string, parameters = "(ctx)", before = "") {
  return preservationRowsFor({
    status: "modified",
    path: "test/p.test.ts",
    base: { text: caseFile(`${parameters} => { ${before} expect(1).toBe(1); }`) },
    head: { text: caseFile(`${parameters} => { ${before} ${line} expect(1).toBe(1); }`) }
  });
}

const SKIP_ADDED = { rows: [{ kind: "existing-test-weakened-or-deleted", path: "test/p.test.ts", case: "t", change: "skip-added", marker: "context.skip()" }], unchecked: [] };
const NO_ROWS = { rows: [], unchecked: [] };

describe("FR-NODE-282 AC-3 — a skip call through the context counts a skip", () => {
  it.each([
    ["(ctx)", "ctx.skip();"],
    ["(ctx)", "ctx?.skip();"],
    ["(ctx)", "ctx.skip?.();"],
    ["(ctx)", "ctx!.skip();"],
    ["(ctx)", "ctx?.skip?.();"],
    ["({ skip })", "skip();"],
    ["({ skip })", "skip?.();"],
    ["({ skip: stop })", "stop();"]
  ])("%s => %s", (parameters, line) => {
    expect(only(`${parameters} => { ${line} }`)).toMatchObject({ contextSkips: 1, handOffs: 0 });
    expect(rowsWhenAdded(line, parameters)).toEqual(SKIP_ADDED);
  });
});

describe("FR-NODE-282 AC-3 — the context passed on whole counts a hand-off", () => {
  it.each([
    ["(ctx)", "helper(ctx);"],
    ["(ctx)", "helper(1, ctx);"],
    ["(ctx)", "helper?.(ctx);"],
    ["(ctx)", "helper<unknown>(ctx);"],
    ["(ctx)", "new Helper(ctx);"],
    ["(ctx)", "const c = ctx;"],
    ["(ctx)", "let c; c = ctx;"],
    ["(ctx)", "if (flag) return ctx;"],
    ["(ctx)", "const { skip } = ctx;"],
    ["({ skip })", "setTimeout(skip);"],
    ["({ skip })", "const s = skip;"],
    ["({ skip: stop })", "helper(stop);"]
  ])("%s => %s", (parameters, line) => {
    expect(only(`${parameters} => { ${line} }`)).toMatchObject({ contextSkips: 0, handOffs: 1 });
    expect(rowsWhenAdded(line, parameters)).toEqual(SKIP_ADDED);
  });

  it("reads the second parameter of a .for callback as the context", () => {
    const source = lexJsSource(['import { it } from "vitest";', "function helper(c: unknown) { return c; }", 'it.for([1])("t %i", (row, ctx) => { helper(ctx); });', ""].join("\n"));
    expect(source === null ? null : testCaseSurface(source)?.cases[0]).toMatchObject({ handOffs: 1 });
  });

  it("passes an unchanged hand-off, and a new case that hands its context on", () => {
    expect(rowsWhenAdded("expect(2).toBe(2);", "(ctx)", "helper(ctx);")).toEqual(NO_ROWS);
    const added = preservationRowsFor({
      status: "modified",
      path: "test/p.test.ts",
      base: { text: caseFile("() => { expect(1).toBe(1); }") },
      head: { text: `${caseFile("() => { expect(1).toBe(1); }")}it("u", (ctx) => { helper(ctx); });\n` }
    });
    expect(added).toEqual(NO_ROWS);
  });

  it("reports a hand-off swapped for a direct skip, each count compared on its own", () => {
    const swapped = preservationRowsFor({
      status: "modified",
      path: "test/p.test.ts",
      base: { text: caseFile("(ctx) => { helper(ctx); }") },
      head: { text: caseFile("(ctx) => { ctx.skip(); }") }
    });
    expect(swapped).toEqual(SKIP_ADDED);
  });
});

describe("FR-NODE-282 AC-3 — a read of the context is neither", () => {
  it.each([
    ["(ctx)", "expect(ctx.task.name).toBe('t');"],
    ["(ctx)", "expect(ctx?.task.name).toBe('t');"],
    ["(ctx)", "expect(ctx!.task.name).toBe('t');"],
    ["(ctx)", "expect(typeof ctx.skip).toBe('function');"],
    ["(ctx)", "expect(ctx).toBeDefined();"],
    ["(ctx)", "if (ctx) expect(1).toBe(1);"],
    ["(ctx)", "while (ctx) break;"],
    ["(ctx)", "const { task } = ctx; expect(task.name).toBe('t');"],
    ["(ctx)", "const row = { ctx: 1 }; expect(row.ctx).toBe(1);"],
    ["(ctx)", "[1].forEach((ctx) => { helper(ctx); });"],
    ["(ctx)", "expect.soft(ctx).toBeDefined();"],
    ["(done)", "done();"],
    ["(done)", "done?.();"],
    ["({ skip })", "const pick = (skip) => skip; expect(pick(1)).toBe(1);"]
  ])("%s => %s", (parameters, line) => {
    expect(only(`${parameters} => { ${line} }`)).toMatchObject({ contextSkips: 0, handOffs: 0 });
    expect(rowsWhenAdded(line, parameters)).toEqual(NO_ROWS);
  });
});

describe("FR-NODE-282 AC-3 — an occurrence outside the list leaves the file unchecked", () => {
  it.each([
    ["(ctx)", "ctx['skip']();"],
    ["(ctx)", "ctx[key]();"],
    ["(ctx)", "(ctx).skip();"],
    ["(ctx)", "(ctx as TestContext).skip();"],
    ["(ctx)", "helper(ctx as TestContext);"],
    ["(ctx)", "helper(...[ctx]);"],
    ["(ctx)", "helper(flag ? ctx : undefined);"],
    ["(ctx)", "helper({ c: ctx });"],
    ["(ctx)", "helper([ctx]);"],
    ["(ctx)", "const s = ctx.skip; s();"],
    ["({ skip })", "helper({ skip });"]
  ])("%s => %s", (parameters, line) => {
    expect(only(`${parameters} => { ${line} }`)).toBeNull();
    const rows = rowsWhenAdded(line, parameters);
    expect(rows.rows).toEqual([]);
    expect(rows.unchecked).toHaveLength(1);
  });
});

describe("FR-NODE-282 AC-3 — no direct-skip detection of the 5.3.7 reader is lost", () => {
  it.each([
    ["(ctx)", "ctx.skip();"],
    ["({ skip })", "skip();"]
  ])("%s => %s added is still a skip added", (parameters, line) => {
    expect(rowsWhenAdded(line, parameters)).toEqual(SKIP_ADDED);
  });
});
