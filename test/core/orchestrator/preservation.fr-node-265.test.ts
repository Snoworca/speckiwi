import { describe, expect, it } from "vitest";
import { lexJsSource } from "../../../src/core/orchestrator/js-source-lexer.js";
import { testCaseSurface } from "../../../src/core/orchestrator/js-test-cases.js";
import { preservationRowsFor, type ChangedFile } from "../../../src/core/orchestrator/preservation.js";

// The preservation test-case reader against an `.each` callback's row parameter. FR-NODE-252 is the
// reader's original contract; its tests are in preservation-source.fr-node-252.test.ts, including the
// read of every file of this repository with none unchecked. The AC-3 hand-off reproductions are
// deferred to 5.3.9 in test/verify/deferred-539.FR-NODE-282.repro.test.ts.

function surface(text: string) {
  const source = lexJsSource(text);
  if (source === null) throw new Error("lexer refused the source");
  return testCaseSurface(source);
}

function caseFile(callback: string, call = 'it("t", '): string {
  return ['import { expect, it } from "vitest";', "function bail(c) { c.skip(); }", `${call}${callback});`, ""].join("\n");
}

function modified(file: string, base: string, head: string): ChangedFile {
  return { status: "modified", path: file, base: { text: base }, head: { text: head } };
}

describe("FR-NODE-265 AC-4 an .each callback's first parameter is a row, not the context", () => {
  // @req FR-NODE-265 AC-4
  it("does not count skip() on the first parameter of an .each callback, named or destructured", () => {
    for (const call of ['it.each([{ skip: () => 0 }])("row %#", ', 'test.each([{ skip: () => 0 }])("row %#", ', 'it.concurrent.each([{ skip: () => 0 }])("row %#", ', 'it.skip.each([{ skip: () => 0 }])("row %#", ']) {
      for (const callback of ["(row) => { row.skip(); expect(1).toBe(1); }", "({ skip }) => { skip(); expect(1).toBe(1); }"]) {
        const cases = surface(caseFile(callback, call))?.cases;
        expect(cases?.map((item) => item.contextSkips), `${call} ${callback}`).toEqual([0]);
      }
    }
  });

  // @req FR-NODE-265 AC-4
  it("reports no row when skip() on an .each row is added between base and head", () => {
    const base = caseFile("(row) => { expect(1).toBe(1); }", 'it.each([{ skip: () => 0 }])("row %#", ');
    const head = base.replace("expect(1)", "row.skip(); expect(1)");
    expect(preservationRowsFor(modified("test/e.test.ts", base, head))).toEqual({ rows: [], unchecked: [] });
  });

  // @req FR-NODE-265 AC-4
  it("control: .for reads its second parameter as the context and a plain case reads its first", () => {
    expect(surface(caseFile("(row, ctx) => { ctx.skip(); }", 'it.for([1])("row %i", '))?.cases[0]?.contextSkips).toBe(1);
    expect(surface(caseFile("(row) => { row.skip(); }", 'it.for([1])("row %i", '))?.cases[0]?.contextSkips).toBe(0);
    expect(surface(caseFile("(ctx) => { ctx.skip(); }"))?.cases[0]?.contextSkips).toBe(1);
  });

  // @req FR-NODE-265 AC-4
  it("control: a direct ctx.skip() added to an existing plain case is still a skip added", () => {
    const base = caseFile("(ctx) => { expect(1).toBe(1); }");
    expect(preservationRowsFor(modified("test/d.test.ts", base, base.replace("expect(1)", "ctx.skip(); expect(1)"))).rows).toEqual([
      { kind: "existing-test-weakened-or-deleted", path: "test/d.test.ts", case: "t", change: "skip-added", marker: "context.skip()" }
    ]);
  });
});
