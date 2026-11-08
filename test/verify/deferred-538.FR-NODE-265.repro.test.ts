import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { lexJsSource } from "../../src/core/orchestrator/js-source-lexer.js";
import { testCaseSurface } from "../../src/core/orchestrator/js-test-cases.js";

// FR-NODE-265 is deferred to 5.3.8 (5.3.7 triage, 2026-11-08): these are the triage reproductions, red by design
// until the requirement is taken up. They are skipped in the default suite and run with SPECKIWI_DEFERRED=1,
// as the stress suites run with SPECKIWI_STRESS. When the requirement is implemented, turn them into its
// failing tests and delete this gate.
const DEFERRED = process.env.SPECKIWI_DEFERRED === "1";

// Triage repro for FR-NODE-265 (5.3.7).

function surface(text: string) {
  const source = lexJsSource(text);
  if (source === null) throw new Error("lexer refused the source");
  return testCaseSurface(source);
}

describe.skipIf(!DEFERRED)("FR-NODE-265 AC-1 — a local binding named `test` used only as a value", () => {
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

describe.skipIf(!DEFERRED)("FR-NODE-265 AC-2 — a global `suite` beside a local `suite` binding", () => {
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

describe.skipIf(!DEFERRED)("FR-NODE-265 AC-3 — a context skip passed on through a variable or a helper", () => {
  it("through a local variable", () => {
    const text = ['import { it } from "vitest";', 'it("skips via a variable", (ctx) => {', "  const c = ctx;", "  c.skip();", "});", ""].join("\n");
    const result = surface(text);
    expect(result === null || result.cases[0]!.contextSkips > 0).toBe(true);
  });

  it("through a helper function", () => {
    const text = ['import { it } from "vitest";', "function bail(c) { c.skip(); }", 'it("skips via a helper", (ctx) => {', "  bail(ctx);", "});", ""].join("\n");
    const result = surface(text);
    expect(result === null || result.cases[0]!.contextSkips > 0).toBe(true);
  });

  it("control: a direct ctx.skip() is counted", () => {
    const text = ['import { it } from "vitest";', 'it("skips directly", (ctx) => {', "  ctx.skip();", "});", ""].join("\n");
    expect(surface(text)?.cases[0]!.contextSkips).toBe(1);
  });
});

describe.skipIf(!DEFERRED)("FR-NODE-265 AC-4 — `.each` callback's first parameter is a row, not a context", () => {
  it("row.skip() in an .each callback is not a context skip", () => {
    const text = ['import { it } from "vitest";', 'it.each([{ skip: () => 0 }])("row %#", (row) => {', "  row.skip();", "});", ""].join("\n");
    const result = surface(text);
    expect(result?.cases[0]!.contextSkips).toBe(0);
  });

  it("control: .for passes the context second and its skip is counted", () => {
    const text = ['import { it } from "vitest";', 'it.for([1])("row %#", (row, ctx) => {', "  ctx.skip();", "});", ""].join("\n");
    expect(surface(text)?.cases[0]!.contextSkips).toBe(1);
  });
});

describe.skipIf(!DEFERRED)("FR-NODE-265 — how often this repository's own tests hit the forms", () => {
  it("counts files the reader leaves unchecked and files with a local `test` binding", { timeout: 300_000 }, async () => {
    const files: string[] = [];
    async function walk(dir: string): Promise<void> {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === "fixtures" || entry.name === "node_modules") continue;
          await walk(full);
        } else if (/\.test\.ts$/.test(entry.name)) files.push(full);
      }
    }
    await walk("test");
    let unchecked = 0;
    const localTest: string[] = [];
    const eachSkip: string[] = [];
    for (const file of files) {
      const text = await readFile(file, "utf8");
      const source = lexJsSource(text);
      if (source === null || testCaseSurface(source) === null) {
        unchecked += 1;
        if (/\b(?:const|let|var)\s+test\b|function\s+test\b/.test(text)) localTest.push(file);
      }
      if (/\.each\([^)]*\)\([^,]+,\s*\(?\s*(\w+)[^)]*\)?\s*=>[\s\S]{0,400}?\1\.skip\(/.test(text)) eachSkip.push(file);
    }
    console.log(JSON.stringify({ files: files.length, unchecked, uncheckedWithLocalTest: localTest, eachSkip }));
    expect(files.length).toBeGreaterThan(0);
  });
});
