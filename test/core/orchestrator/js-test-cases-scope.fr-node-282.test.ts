import { describe, expect, it } from "vitest";
import { lexJsSource } from "../../../src/core/orchestrator/js-source-lexer.js";
import { testCaseSurface } from "../../../src/core/orchestrator/js-test-cases.js";

// @req FR-NODE-282 AC-1, AC-2 — the preservation test-case reader binds a locally declared name by
// scope. On 5.3.8 one file-wide set decided it: a value named `test` hid the file's cases, and a local
// `suite` in one function hid the global `suite(…)` call elsewhere, whose inner cases were then read
// as top-level cases.

function keys(text: string): string[] | null {
  const source = lexJsSource(text);
  if (source === null) throw new Error("lexer refused the source");
  const surface = testCaseSurface(source);
  return surface === null ? null : surface.cases.map((entry) => entry.key);
}

const GLOBAL_SUITE = ['suite("outer", () => {', '  it("inner", () => { expect(1).toBe(1); });', "});"].join("\n");

describe("FR-NODE-282 AC-1 — a local `test` used only as a value does not hide the file's cases", () => {
  it("reads the case beside `const test = { … }`", () => {
    const text = ['import { it, expect } from "vitest";', "const test = { name: 'fixture' };", 'it("reads the fixture", () => {', "  expect(test.name).toBe('fixture');", "});"].join("\n");
    expect(keys(text)).toEqual(["reads the fixture"]);
  });

  it("reads the case when the value lives in a block", () => {
    const text = ['import { it, expect } from "vitest";', 'it("uses a block", () => {', "  { const test = 1; expect(test).toBe(1); }", "});"].join("\n");
    expect(keys(text)).toEqual(["uses a block"]);
  });

  it("still reads `test` outside the block that declares it as the case function", () => {
    const text = ['import { test, expect } from "vitest";', "function helper() { const test = 1; return test; }", 'test("a case", () => { expect(helper()).toBe(1); });'].join("\n");
    expect(keys(text)).toEqual(["a case"]);
  });
});

describe("FR-NODE-282 AC-2 — a local `suite` elsewhere does not hide a global `suite(…)` call", () => {
  it("control: the global call alone leaves the file unchecked", () => {
    expect(keys(GLOBAL_SUITE)).toBeNull();
  });

  it.each([
    ["a parameter", "function helper(suite) { return suite.file; }"],
    ["a const in another function", "function other() { const suite = 1; return suite; }"],
    ["a for-of binding in another function", "function each(list) { for (const suite of list) { use(suite); } }"],
    ["a top-level for-of binding", "for (const suite of list) { use(suite); }"],
    ["a top-level for-of binding with a one-statement body", "for (const suite of list) use(suite);"],
    ["a top-level for-await binding", "for await (const suite of list) { use(suite); }"],
    ["both", "function helper(suite) { return suite.file; }\nfunction other() { const suite = 1; return suite; }"]
  ])("is still unchecked beside %s", (_label, local) => {
    expect(keys(`${local}\n${GLOBAL_SUITE}`)).toBeNull();
  });

  it("reads a file whose only `suite` is a local binding", () => {
    const text = ['import { it, expect } from "vitest";', "function other() { const suite = 1; return suite; }", 'it("plain", () => { expect(other()).toBe(1); });'].join("\n");
    expect(keys(text)).toEqual(["plain"]);
  });
});
