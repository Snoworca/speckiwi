import { describe, expect, it } from "vitest";
import { lexJsSource } from "../../src/core/orchestrator/js-source-lexer.js";
import { testCaseSurface } from "../../src/core/orchestrator/js-test-cases.js";
import { preservationRowsFor } from "../../src/core/orchestrator/preservation.js";

// FR-NODE-282 is deferred to 5.3.9 (split from FR-NODE-265 AC-1 and AC-2 by the 5.3.8 scope decision,
// 2026-11-09): these are the 5.3.7 triage reproductions, red by design until the requirement is taken up.
// They are skipped in the default suite and run with SPECKIWI_DEFERRED=1, as the stress suites run with
// SPECKIWI_STRESS. When the requirement is implemented, turn them into its failing tests and delete this gate.
//
// The second half holds FR-NODE-265 AC-3 (a context handed on), withdrawn from 5.3.8 after three review
// rounds (2026-11-09): the 5.3.8 rounds' cases, kept as reproductions of the outcome the review rounds
// asked for. A red one is a gap at 5.3.7 behaviour; a green one is a control the fix must keep green.
const DEFERRED = process.env.SPECKIWI_DEFERRED === "1";

function surface(text: string) {
  const source = lexJsSource(text);
  if (source === null) throw new Error("lexer refused the source");
  return testCaseSurface(source);
}

describe.skipIf(!DEFERRED)("FR-NODE-282 AC-1 — a local binding named `test` used only as a value", () => {
  it("returns the file's cases instead of null", () => {
    const text = [
      'import { it, expect } from "vitest";',
      "const test = { name: 'fixture' };",
      'it("reads the fixture", () => {',
      "  expect(test.name).toBe('fixture');",
      "});",
      ""
    ].join("\n");
    const result = surface(text);
    expect(result?.cases.map((c) => c.key)).toEqual(["reads the fixture"]);
  });

  it("control: the same file without the local `test` binding is read", () => {
    const text = ['import { it, expect } from "vitest";', "const fx = { name: 'fixture' };", 'it("reads the fixture", () => {', "  expect(fx.name).toBe('fixture');", "});", ""].join("\n");
    expect(surface(text)?.cases.map((c) => c.key)).toEqual(["reads the fixture"]);
  });
});

describe.skipIf(!DEFERRED)("FR-NODE-282 AC-2 — a global `suite` beside a local `suite` binding", () => {
  const globalSuite = ['suite("outer", () => {', '  it("inner", () => { expect(1).toBe(1); });', "});", ""].join("\n");

  it("control: a file calling the global suite(…) is unchecked (null)", () => {
    expect(surface(globalSuite)).toBeNull();
  });

  it("the same file plus a local `suite` binding in another function is still null", () => {
    const text = ["function helper(suite) { return suite.file; }", "function other() { const suite = 1; return suite; }", globalSuite].join("\n");
    const result = surface(text);
    expect(result === null ? null : result.cases.map((c) => c.key)).toBeNull();
  });
});

// --- FR-NODE-265 AC-3 (deferred to 5.3.9): a context handed on ------------------------------------

function caseFile(callback: string): string {
  return ['import { expect, it } from "vitest";', "function helper(c: unknown) { return c; }", `it("t", ${callback});`, ""].join("\n");
}

/** The preservation rows of one test file whose only case changes from `base` to `head`. */
function rowsBetween(base: string, head: string) {
  return preservationRowsFor({ status: "modified", path: "test/p.test.ts", base: { text: caseFile(base) }, head: { text: caseFile(head) } });
}

/** The rows when `line` is added to an existing case whose callback takes `parameters`. */
function rowsWhenAdded(line: string, parameters = "(ctx)") {
  return rowsBetween(`${parameters} => { expect(1).toBe(1); }`, `${parameters} => { ${line} expect(1).toBe(1); }`);
}

const SKIP_ADDED = { rows: [{ kind: "existing-test-weakened-or-deleted", path: "test/p.test.ts", case: "t", change: "skip-added", marker: "context.skip()" }], unchecked: [] };
const NO_ROWS = { rows: [], unchecked: [] };

describe.skipIf(!DEFERRED)("FR-NODE-265 AC-3 — the required outcome (a)(b)(c)", () => {
  it("(a) a new case that hands its context to a helper passes", () => {
    const base = 'it("a", () => { expect(1).toBe(1); });';
    const head = `${base}\nit("b", (ctx) => { helper(ctx); expect(1).toBe(1); });`;
    expect(preservationRowsFor({ status: "modified", path: "test/p.test.ts", base: { text: caseFile("() => {}") + base }, head: { text: caseFile("() => {}") + head } })).toEqual(NO_ROWS);
  });

  it("(b) helper(ctx) added to an existing case is a skip added", () => {
    expect(rowsWhenAdded("helper(ctx);")).toEqual(SKIP_ADDED);
  });

  it("(c) an unchanged helper(ctx) in an existing case passes", () => {
    expect(rowsBetween("(ctx) => { helper(ctx); expect(1).toBe(1); }", "(ctx) => { helper(ctx); expect(1).toBe(1); expect(2).toBe(2); }")).toEqual(NO_ROWS);
  });
});

describe.skipIf(!DEFERRED)("FR-NODE-265 AC-3 — a hand-off added to an existing case is a skip added", () => {
  // Round 1–2: the context, or its destructured skip, written whole as an argument, a right-hand side or a returned value.
  it.each([
    ["(ctx)", "const c = ctx; c.skip();"],
    ["(ctx)", "let c; c = ctx; c.skip();"],
    ["(ctx)", "const c = ctx\n  c.skip();"],
    ["(ctx)", "helper(1, ctx);"],
    ["(ctx)", "helper?.(ctx);"],
    ["(ctx)", "helper(ctx).then(() => 0);"],
    ["(ctx)", "if (flag) return ctx;"],
    ["(ctx)", "const { skip } = ctx; skip();"],
    ["({ skip })", "const s = skip; s();"],
    ["({ skip })", "setTimeout(skip);"],
    ["({ skip: stop })", "helper(stop);"]
  ])("%s %s", (parameters, line) => {
    expect(rowsWhenAdded(line, parameters)).toEqual(SKIP_ADDED);
  });

  it("from the second parameter of a .for callback", () => {
    const at = (body: string) => preservationRowsFor({
      status: "modified",
      path: "test/p.test.ts",
      base: { text: caseFile("() => {}") + 'it.for([1])("t", (row, ctx) => { expect(row).toBe(1); });\n' },
      head: { text: caseFile("() => {}") + `it.for([1])("t", (row, ctx) => { ${body}expect(row).toBe(1); });\n` }
    });
    expect(at("helper(ctx); ").rows).toEqual(SKIP_ADDED.rows);
  });

  // R3-1: a call with type arguments; round 2 read the group after `>` as no call.
  it.each(["helper<unknown>(ctx);", "new Helper<unknown>(ctx);"])("R3-1 %s", (line) => {
    expect(rowsWhenAdded(line)).toEqual(SKIP_ADDED);
  });

  // R3-3, and the two forms round 2 declared as limits: the context handed to a call inside a wider expression.
  it.each([
    ["(ctx)", "helper({ c: ctx });"],
    ["(ctx)", "helper([ctx]);"],
    ["(ctx)", "helper((ctx));"],
    ["(ctx)", "helper(flag ? ctx : undefined);"],
    ["(ctx)", "helper(ctx ?? other);"],
    ["(ctx)", "helper(ctx!);"],
    ["(ctx)", "helper(...[ctx]);"],
    ["(ctx)", "helper(ctx as TestContext);"],
    ["({ skip })", "helper({ skip });"]
  ])("R3-3 %s %s", (parameters, line) => {
    expect(rowsWhenAdded(line, parameters)).toEqual(SKIP_ADDED);
  });
});

describe.skipIf(!DEFERRED)("FR-NODE-265 AC-3 — a skip call through the context in any spelling is a skip added", () => {
  // Round 1–2 spellings; 5.3.7 counts only `ctx.skip()` and a destructured `skip()`.
  it.each([
    ["(ctx)", "ctx?.skip();"],
    ["(ctx)", "ctx.skip?.();"],
    ["(ctx)", "ctx!.skip();"],
    ["(ctx)", "ctx['skip']();"],
    ["(ctx)", "ctx?.['skip']();"],
    ["(ctx)", "(ctx).skip();"],
    ["(ctx)", "(ctx as TestContext).skip();"],
    ["(ctx)", "(ctx satisfies TestContext).skip();"],
    // R3-2: the cast after a braceless `if`, read by round 2 as a call `if (flag)(…)`.
    ["(ctx)", "if (flag) (ctx as any).skip();"],
    ["({ skip })", "skip?.();"],
    // Round 2 declared limits: the skip read into a variable, and a computed key that is not a literal.
    ["(ctx)", "const s = ctx.skip; s();"],
    ["(ctx)", "ctx[key]();"]
  ])("%s %s", (parameters, line) => {
    expect(rowsWhenAdded(line, parameters)).toEqual(SKIP_ADDED);
  });
});

describe.skipIf(!DEFERRED)("FR-NODE-265 AC-3 — R2-1 a hand-off swapped for a direct skip is a skip added", () => {
  it.each(["ctx.skip();", "helper(ctx.task); ctx.skip();"])("helper(ctx) → %s", (head) => {
    expect(rowsBetween("(ctx) => { helper(ctx); expect(1).toBe(1); }", `(ctx) => { ${head} expect(1).toBe(1); }`)).toEqual(SKIP_ADDED);
  });
});

describe.skipIf(!DEFERRED)("FR-NODE-265 AC-3 — a read of the context added to an existing case passes", () => {
  it.each([
    // R2-2
    ["(ctx)", "const { task } = ctx; expect(task.name).toBe('t');"],
    ["(ctx)", "expect((ctx).task.name).toBe('t');"],
    ["(ctx)", "expect((ctx satisfies object).task).toBeTruthy();"],
    // Round 1 member spellings (F2)
    ["(ctx)", "expect(ctx['task'].name).toBe('t');"],
    ["(ctx)", "expect(ctx?.['task'].name).toBe('t');"],
    ["(ctx)", "expect(ctx!.task.name).toBe('t');"],
    ["(ctx)", "expect((ctx as TestContext).task.name).toBe('t');"],
    ["(ctx)", "expect(typeof ctx.skip).toBe('function');"],
    ["(ctx)", "if (ctx) expect(1).toBe(1);"],
    ["(ctx)", "const row = { ctx: { skip: () => 0 } }; row.ctx.skip();"],
    // R3-4: the context handed to `expect` is read, not handed on; this conflicts with counting every whole call argument.
    ["(ctx)", "expect(ctx).toBeDefined();"],
    // Round 1 declared limit: an inner binding of the same name is not the context.
    ["(ctx)", "[1].forEach((ctx) => { expect(ctx).toBe(1); });"],
    ["({ skip })", "const pick = (skip) => skip; expect(pick(1)).toBe(1);"]
  ])("%s %s", (parameters, line) => {
    expect(rowsWhenAdded(line, parameters)).toEqual(NO_ROWS);
  });

  // R3-4: dropping a cast from a hand-off that is already there changes nothing.
  it("helper(ctx as unknown) → helper(ctx) passes", () => {
    expect(rowsBetween("(ctx) => { helper(ctx as unknown); expect(1).toBe(1); }", "(ctx) => { helper(ctx); expect(1).toBe(1); }")).toEqual(NO_ROWS);
  });
});
