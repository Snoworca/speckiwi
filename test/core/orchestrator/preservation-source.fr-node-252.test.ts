import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { preservationRowsFor, type ChangedFile } from "../../../src/core/orchestrator/preservation.js";

// The per-file half of `speckiwi orchestrate preservation check`: given the bytes of one file at base
// and at head, which preservation rows it produces and whether it lands in `unchecked`. The git half
// (which files changed, reading their blobs) is in preservation.fr-node-252.test.ts.

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..");

function modified(path: string, base: string, head: string): ChangedFile {
  return { status: "modified", path, base: { text: base }, head: { text: head } };
}

describe("FR-NODE-252 AC-3 exported names of a JavaScript or TypeScript file", () => {
  // @req FR-NODE-252 AC-3
  it("reports an exported function that is gone at head, naming the file and symbol", () => {
    const result = preservationRowsFor(
      modified("src/a.ts", "export function keep(): void {}\nexport function gone(a: number): number { return a; }\n", "export function keep(): void {}\n")
    );
    expect(result.rows).toEqual([{ kind: "existing-public-contract-change", path: "src/a.ts", symbol: "gone", change: "removed" }]);
    expect(result.unchecked).toEqual([]);
  });

  // @req FR-NODE-252 AC-3
  it("reports a changed parameter list and a changed return type, but not a changed body", () => {
    const base = [
      "export function params(a: number): number { return a; }",
      "export function returns(a: number): number { return a; }",
      "export function body(a: number): number { return a; }",
      "export async function* gen<T>(items: T[]): AsyncGenerator<T> { yield* items; }"
    ].join("\n");
    const head = [
      "export function params(a: number, b: number): number { return a + b; }",
      "export function returns(a: number): string { return String(a); }",
      "export function body(a: number): number { return a * 2; }",
      "export async function* gen<T>(items: readonly T[]): AsyncGenerator<T> { yield* items; }"
    ].join("\n");
    const rows = preservationRowsFor(modified("src/f.ts", base, head)).rows;
    expect(rows.map((row) => (row.kind === "existing-public-contract-change" ? `${row.symbol}:${row.change}` : row.kind))).toEqual([
      "params:signature-changed",
      "returns:signature-changed",
      "gen:signature-changed"
    ]);
  });

  // @req FR-NODE-252 AC-3
  it("reports changed type text of an interface, a type alias, an enum, a class header and an annotated const", () => {
    const base = [
      "export interface Shape { readonly id: string; }",
      "export type Kind = \"a\" | \"b\";",
      "export enum Level { Low, High }",
      "export class Box<T> extends Base<{ a: T }> implements Thing { size = 1; }",
      "export const limit: number = 3;",
      "export const handler = (input: string): number => input.length;"
    ].join("\n");
    const head = [
      "export interface Shape { readonly id: number; }",
      "export type Kind = \"a\" | \"b\" | \"c\";",
      "export enum Level { Low, Mid, High }",
      "export class Box<T> extends Base<{ a: T; b: T }> implements Thing { size = 2; }",
      "export const limit: string = \"3\";",
      "export const handler = (input: string, flag: boolean): number => input.length;"
    ].join("\n");
    const rows = preservationRowsFor(modified("src/t.ts", base, head)).rows;
    expect(rows.map((row) => (row.kind === "existing-public-contract-change" ? `${row.symbol}:${row.change}` : row.kind))).toEqual([
      "Shape:signature-changed",
      "Kind:signature-changed",
      "Level:signature-changed",
      "Box:signature-changed",
      "limit:signature-changed",
      "handler:signature-changed"
    ]);
  });

  // @req FR-NODE-252 AC-3
  it("does not report a changed value, a reformatted declaration, a non-exported function or text in comments and strings", () => {
    const base = [
      "export const value = 1;",
      "export function spaced(a: number, b: string): void {}",
      "function internal(a: number): void {}",
      "// export function commented(a: number): void {}",
      "const text = \"export function inString(a: number) {}\";"
    ].join("\n");
    const head = [
      "export const value = 2;",
      "export function spaced(",
      "  a: number,",
      "  b: string",
      "): void {}",
      "function internal(a: string): void {}",
      "const text = \"\";"
    ].join("\n");
    expect(preservationRowsFor(modified("src/v.ts", base, head))).toEqual({ rows: [], unchecked: [] });
  });

  // @req FR-NODE-252 AC-3
  it("keeps a comma inside type arguments within one declarator", () => {
    const base = [
      "export const table: Map<string, number> = new Map();",
      "export const codes = { a: 1 } as const satisfies Record<string, { level: number }>;",
      "export const next = 1, last = 2;"
    ].join("\n");
    const head = [
      "export const table: Map<string, string> = new Map();",
      "export const codes = { a: 1 } as const satisfies Record<string, { level: number }>;",
      "export const next = 1;"
    ].join("\n");
    expect(preservationRowsFor(modified("src/c.ts", base, head))).toEqual({
      rows: [
        { kind: "existing-public-contract-change", path: "src/c.ts", symbol: "table", change: "signature-changed" },
        { kind: "existing-public-contract-change", path: "src/c.ts", symbol: "last", change: "removed" }
      ],
      unchecked: []
    });
  });

  // @req FR-NODE-252 AC-3
  it("reads export lists, renamed exports, re-exports and default exports", () => {
    const base = [
      "function local(a: number): void {}",
      "export { local, local as alias };",
      "export { thing } from \"./thing.js\";",
      "export * from \"./all.js\";",
      "export default function (a: number): void {}"
    ].join("\n");
    const head = [
      "function local(a: string): void {}",
      "export { local };",
      "export default function (a: number, b: number): void {}"
    ].join("\n");
    const rows = preservationRowsFor(modified("src/l.ts", base, head)).rows;
    expect(rows.map((row) => (row.kind === "existing-public-contract-change" ? `${row.symbol}:${row.change}` : row.kind))).toEqual([
      "local:signature-changed",
      "alias:removed",
      "thing:removed",
      "* from \"./all.js\":removed",
      "default:signature-changed"
    ]);
  });

  // @req FR-NODE-252 AC-3
  it("reads CommonJS exports of a .cjs file", () => {
    const base = "exports.run = function (a) { return a; };\nmodule.exports.stop = (a) => a;\n";
    const head = "exports.run = function (a, b) { return a; };\n";
    const rows = preservationRowsFor(modified("lib/x.cjs", base, head)).rows;
    expect(rows.map((row) => (row.kind === "existing-public-contract-change" ? `${row.symbol}:${row.change}` : row.kind))).toEqual([
      "run:signature-changed",
      "stop:removed"
    ]);
  });

  // @req FR-NODE-252 AC-3
  it("reads every listed extension and lists a changed file in any other language under unchecked", () => {
    for (const extension of ["ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs"]) {
      const rows = preservationRowsFor(modified(`src/m.${extension}`, "export const a = 1;\n", "\n")).rows;
      expect(rows, extension).toEqual([{ kind: "existing-public-contract-change", path: `src/m.${extension}`, symbol: "a", change: "removed" }]);
    }
    expect(preservationRowsFor(modified("tool/run.py", "def run(a):\n  pass\n", "def run(a, b):\n  pass\n"))).toEqual({
      rows: [],
      unchecked: [{ path: "tool/run.py", reason: "language-not-parsed" }]
    });
  });

  // @req FR-NODE-252 AC-3
  it("neither lists a changed documentation or data file under unchecked nor counts it against passing", () => {
    for (const extension of ["md", "json", "jsonl", "yaml", "yml", "txt", "csv", "svg"]) {
      expect(preservationRowsFor(modified(`docs/notes.${extension}`, "one\n", "two\n")), extension).toEqual({ rows: [], unchecked: [] });
    }
    expect(preservationRowsFor({ status: "deleted", path: "docs/old.md", base: { text: "# old\n" }, head: null })).toEqual({
      rows: [{ kind: "existing-file-deleted-or-moved", path: "docs/old.md", change: "deleted" }],
      unchecked: []
    });
    expect(preservationRowsFor(modified("scripts/run.sh", "echo a\n", "echo b\n")).unchecked).toEqual([
      { path: "scripts/run.sh", reason: "language-not-parsed" }
    ]);
  });

  // @req FR-NODE-252 AC-3
  it("lists a JavaScript file it cannot parse, or cannot read, under unchecked instead of reading it as preserved", () => {
    expect(preservationRowsFor(modified("src/broken.ts", "export function a(): void {}\n", "export function a(: void {\n")).unchecked).toEqual([
      { path: "src/broken.ts", reason: "unparsable-source" }
    ]);
    expect(
      preservationRowsFor({ status: "modified", path: "src/big.ts", base: { unreadable: "oversize" }, head: { text: "" } }).unchecked
    ).toEqual([{ path: "src/big.ts", reason: "oversize" }]);
  });

  // @req FR-NODE-252 AC-3
  it("reports every export of a deleted file as removed and compares a renamed file under its new path", () => {
    const deleted = preservationRowsFor({ status: "deleted", path: "src/old.ts", base: { text: "export const a = 1;\n" }, head: null });
    expect(deleted.rows).toContainEqual({ kind: "existing-public-contract-change", path: "src/old.ts", symbol: "a", change: "removed" });
    const renamed = preservationRowsFor({
      status: "renamed",
      path: "src/from.ts",
      newPath: "src/to.ts",
      base: { text: "export const a = 1;\nexport const b = 2;\n" },
      head: { text: "export const a = 1;\n" }
    });
    expect(renamed.rows).toContainEqual({ kind: "existing-public-contract-change", path: "src/from.ts", newPath: "src/to.ts", symbol: "b", change: "removed" });
    expect(renamed.rows).not.toContainEqual(expect.objectContaining({ kind: "existing-public-contract-change", symbol: "a" }));
  });
});

describe("FR-NODE-252 AC-4 weakened or deleted test cases", () => {
  const base = [
    "import { describe, expect, it } from \"vitest\";",
    "describe(\"group\", () => {",
    "  it(\"keeps\", () => {",
    "    expect(1).toBe(1);",
    "    expect(2).toBe(2);",
    "  });",
    "  it(\"removed\", () => { expect(1).toBe(1); });",
    "  it(\"skipped\", () => { expect(1).toBe(1); });",
    "  it(\"focused\", () => { expect(1).toBe(1); });",
    "  it(\"x-ed\", () => { expect(1).toBe(1); });",
    "  it(\"commented\", () => { expect(1).toBe(1); });",
    "  it(\"replaced\", () => { expect(compute()).toBe(3); });",
    "});",
    "describe(\"other\", () => {",
    "  it(\"keeps\", () => { expect(1).toBe(1); });",
    "});",
    "describe(\"parked\", () => { it(\"inner\", () => { expect(1).toBe(1); }); });"
  ].join("\n");

  const head = [
    "import { describe, expect, it } from \"vitest\";",
    "describe(\"group\", () => {",
    "  it(\"keeps\", () => {",
    "    expect(1).toBe(1);",
    "  });",
    "  it.skip(\"skipped\", () => { expect(1).toBe(1); });",
    "  it.only(\"focused\", () => { expect(1).toBe(1); });",
    "  xit(\"x-ed\", () => { expect(1).toBe(1); });",
    "  // it(\"commented\", () => { expect(1).toBe(1); });",
    "  it(\"replaced\", () => { expect(compute()).toBe(4); });",
    "  it(\"added\", () => { expect(1).toBe(1); });",
    "});",
    "describe(\"other\", () => {",
    "  it(\"keeps\", () => { expect(1).toBe(1); expect(2).toBe(2); });",
    "});",
    "xdescribe(\"parked\", () => { it(\"inner\", () => { expect(1).toBe(1); }); });"
  ].join("\n");

  // @req FR-NODE-252 AC-4
  it("reports each removal, added skip or focus marker and commented-out case, naming the file and case", () => {
    const rows = preservationRowsFor(modified("test/a.test.ts", base, head)).rows.filter((row) => row.kind === "existing-test-weakened-or-deleted");
    expect(rows).toEqual([
      { kind: "existing-test-weakened-or-deleted", path: "test/a.test.ts", case: "group > keeps", change: "assertion-removed", baseAssertions: 2, headAssertions: 1 },
      { kind: "existing-test-weakened-or-deleted", path: "test/a.test.ts", case: "group > removed", change: "case-removed" },
      { kind: "existing-test-weakened-or-deleted", path: "test/a.test.ts", case: "group > skipped", change: "skip-added", marker: ".skip" },
      { kind: "existing-test-weakened-or-deleted", path: "test/a.test.ts", case: "group > focused", change: "only-added", marker: ".only" },
      { kind: "existing-test-weakened-or-deleted", path: "test/a.test.ts", case: "group > x-ed", change: "skip-added", marker: "xit" },
      { kind: "existing-test-weakened-or-deleted", path: "test/a.test.ts", case: "group > commented", change: "case-commented-out" },
      { kind: "existing-test-weakened-or-deleted", path: "test/a.test.ts", case: "parked", change: "skip-added", marker: "xdescribe" }
    ]);
  });

  // @req FR-NODE-252 AC-4
  it("does not report a replaced expected value, an added case or an added assertion", () => {
    const rows = preservationRowsFor(modified("test/a.test.ts", base, head)).rows;
    const cases = rows.flatMap((row) => (row.kind === "existing-test-weakened-or-deleted" ? [row.case] : []));
    expect(cases).not.toContain("group > replaced");
    expect(cases).not.toContain("group > added");
    expect(cases).not.toContain("other > keeps");
  });

  // @req FR-NODE-252 AC-4
  it("applies the test rule only to files the coverage test-file rule counts as tests", () => {
    const rows = preservationRowsFor(modified("src/helper.ts", base, head)).rows;
    expect(rows.filter((row) => row.kind === "existing-test-weakened-or-deleted")).toEqual([]);
    const underTestDir = preservationRowsFor(modified("test/support/cases.ts", base, head)).rows;
    expect(underTestDir.some((row) => row.kind === "existing-test-weakened-or-deleted")).toBe(true);
  });

  // @req FR-NODE-252 AC-4
  it("reports a deleted test file once as a deleted test file, in any language, beside the deleted-file row", () => {
    expect(preservationRowsFor({ status: "deleted", path: "test/b.test.ts", base: { text: base }, head: null }).rows).toEqual([
      { kind: "existing-file-deleted-or-moved", path: "test/b.test.ts", change: "deleted" },
      { kind: "existing-test-weakened-or-deleted", path: "test/b.test.ts", case: null, change: "test-file-deleted" }
    ]);
    expect(preservationRowsFor({ status: "deleted", path: "tool/test_run.py", base: { text: "def test_a():\n  assert 1\n" }, head: null }).rows).toEqual([
      { kind: "existing-file-deleted-or-moved", path: "tool/test_run.py", change: "deleted" },
      { kind: "existing-test-weakened-or-deleted", path: "tool/test_run.py", case: null, change: "test-file-deleted" }
    ]);
  });
});

describe("FR-NODE-252 AC-3 JSX, class members and the real repository sources", () => {
  const view = [
    "import { useState } from \"react\";",
    "export function Card({ title }: { title: string }) {",
    "  const [open] = useState(false);",
    "  return (",
    "    <div className=\"card a/b\" data-x='1'>",
    "      <h2>{title}</h2>",
    "      <>it's a fragment</>",
    "      {open && <Body items={[1, 2].map((item) => <li key={item}>{item / 2}</li>)} />}",
    "      <br/>",
    "    </div>",
    "  );",
    "}",
    "export const pick = <T,>(items: T[]): T | undefined => items[0];",
    "export function Body(props: { items: unknown[] }) { return <ul>{props.items}</ul>; }"
  ].join("\n");

  // @req FR-NODE-252 AC-3
  it("reads a .tsx or .jsx file with closing tags, fragments, attributes and nested elements", () => {
    for (const extension of ["tsx", "jsx"]) {
      const head = view.replace("export function Body(props: { items: unknown[] })", "export function Body(props: { items: unknown[]; dense: boolean })");
      expect(preservationRowsFor(modified(`src/view.${extension}`, view, head)), extension).toEqual({
        rows: [{ kind: "existing-public-contract-change", path: `src/view.${extension}`, symbol: "Body", change: "signature-changed" }],
        unchecked: []
      });
    }
  });

  // @req FR-NODE-252 AC-3
  it("keeps a type assertion in a .ts file out of the JSX reading", () => {
    const base = "export const size = <number>value / 2;\nexport function f(a: number): number { return a; }\n";
    const head = "export const size = <number>value / 2;\nexport function f(a: string): number { return 1; }\n";
    expect(preservationRowsFor(modified("src/cast.ts", base, head))).toEqual({
      rows: [{ kind: "existing-public-contract-change", path: "src/cast.ts", symbol: "f", change: "signature-changed" }],
      unchecked: []
    });
  });

  // @req FR-NODE-252 AC-3
  it("reads a division after a non-null assertion as division, not as a regular expression", () => {
    const base = "export const ratio = totals.get(field)! / (count || 1);\nexport function f(a: number): void {}\n";
    const head = "export const ratio = totals.get(field)! / (count || 1);\nexport function f(a: string): void {}\n";
    expect(preservationRowsFor(modified("src/ratio.ts", base, head))).toEqual({
      rows: [{ kind: "existing-public-contract-change", path: "src/ratio.ts", symbol: "f", change: "signature-changed" }],
      unchecked: []
    });
  });

  // @req FR-NODE-252 AC-3
  it("compares an exported class by its header, constructor parameters and public member signatures", () => {
    const base = [
      "export class Store<T> extends Base {",
      "  static readonly kind: string = \"store\";",
      "  label?: string;",
      "  private secret = 1;",
      "  protected cache: Map<string, T> = new Map();",
      "  #hidden = 2;",
      "  constructor(private readonly root: string, size: number) { super(); }",
      "  get size(): number { return 1; }",
      "  read(key: string): T | undefined { return undefined; }",
      "  async write(key: string, value: T): Promise<void> {}",
      "  private helper(a: number): void {}",
      "  protected guard(a: number): void {}",
      "  #inner(a: number): void {}",
      "}"
    ].join("\n");
    const unchangedContract = base
      .replace("private secret = 1;", "private secret: string = \"x\";")
      .replace("protected cache: Map<string, T>", "protected cache: Map<number, T>")
      .replace("#hidden = 2;", "#hidden = \"two\";")
      .replace("private helper(a: number)", "private helper(a: string)")
      .replace("protected guard(a: number)", "protected guard(a: string)")
      .replace("#inner(a: number)", "#inner(a: string)")
      .replace("{ return undefined; }", "{ return this.cache.get(key); }")
      .replace("static readonly kind: string = \"store\";", "static readonly kind: string = \"other\";");
    expect(preservationRowsFor(modified("src/store.ts", base, unchangedContract))).toEqual({ rows: [], unchecked: [] });
    for (const [label, from, to] of [
      ["constructor", "size: number) { super(); }", "size: number, extra: number) { super(); }"],
      ["method", "read(key: string)", "read(key: number)"],
      ["return type", "Promise<void> {}", "Promise<boolean> {}"],
      ["property", "label?: string;", "label: string;"],
      ["accessor", "get size(): number", "get size(): string"],
      ["static", "static readonly kind: string", "static kind: string"],
      ["removed member", "  async write(key: string, value: T): Promise<void> {}\n", ""]
    ] as const) {
      expect(preservationRowsFor(modified("src/store.ts", base, base.replace(from, to))).rows, label).toEqual([
        { kind: "existing-public-contract-change", path: "src/store.ts", symbol: "Store", change: "signature-changed" }
      ]);
    }
  });

  // @req FR-NODE-252 AC-4
  it("counts an assertion that renders JSX in a .tsx test file", () => {
    const base = "it(\"renders\", () => { expect(<div>hi</div>).toBeTruthy(); expect(<p/>).toBeTruthy(); });\n";
    const head = "it(\"renders\", () => { expect(<div>hi</div>).toBeTruthy(); });\n";
    expect(preservationRowsFor(modified("test/view.test.tsx", base, head)).rows).toEqual([
      { kind: "existing-test-weakened-or-deleted", path: "test/view.test.tsx", case: "renders", change: "assertion-removed", baseAssertions: 2, headAssertions: 1 }
    ]);
  });

  // @req FR-NODE-252 AC-3
  it("parses every JavaScript and TypeScript file of this repository, tracked or not ignored", () => {
    const files = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
      .split("\0")
      .filter((file) => /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(file) && existsSync(path.join(REPO_ROOT, file)));
    expect(files.length).toBeGreaterThan(500);
    const unchecked = files.flatMap((file) => {
      const text = readFileSync(path.join(REPO_ROOT, file), "utf8");
      return preservationRowsFor(modified(file, text, text)).unchecked;
    });
    expect(unchecked).toEqual([]);
  });
});

describe("FR-NODE-252 AC-3 AC-4 forms outside the reader's list never pass", () => {
  // @req FR-NODE-252 AC-3
  it("compares a default-exported arrow function and a default-exported local binding by their signatures", () => {
    expect(preservationRowsFor(modified("src/d.ts", "export default (a: string): string => a;\n", "export default (a: string, b: number): string => a;\n")).rows).toEqual([
      { kind: "existing-public-contract-change", path: "src/d.ts", symbol: "default", change: "signature-changed" }
    ]);
    const base = "function App(props: { a: string }): void {}\nexport default App;\n";
    const head = "function App(props: { a: string }, extra: number): void {}\nexport default App;\n";
    expect(preservationRowsFor(modified("src/app.ts", base, head)).rows).toEqual([
      { kind: "existing-public-contract-change", path: "src/app.ts", symbol: "default", change: "signature-changed" }
    ]);
    expect(preservationRowsFor(modified("vitest.config.ts", "export default defineConfig({ a: 1 });\n", "export default defineConfig({ a: 2 });\n"))).toEqual({ rows: [], unchecked: [] });
  });

  // @req FR-NODE-252 AC-3
  it("lists a file under unchecked when it has an export form the reader does not know", () => {
    const forms = [
      "export namespace N { export function f(a: number): void {} }",
      "export const Box = class { constructor(value: string) {} };",
      "module.exports = class { constructor(value) {} };",
      "exports[name] = function (a) {};",
      "function wrap() { module.exports.run = (a) => a; }",
      "declare module \"lib\" { export function f(a: number): void; }",
      "const hidden = class {};\nexport { hidden };",
      "export { notDeclaredHere };"
    ];
    for (const form of forms) {
      const text = `export function keep(a: number): void {}\n${form}\n`;
      expect(preservationRowsFor(modified("src/f.ts", text, text)), form).toEqual({ rows: [], unchecked: [{ path: "src/f.ts", reason: "unrecognized-export-form" }] });
    }
  });

  // @req FR-NODE-252 AC-4
  it("lists a test file under unchecked when it has a case call the reader does not know", () => {
    const forms = [
      "it.each`\n  a | b\n  ${1} | ${2}\n`(\"adds $a and $b\", ({ a, b }) => { expect(a + b).toBe(3); });",
      "it(prefix + name, () => { expect(1).toBe(1); });",
      "describe(makeName(), () => {});"
    ];
    for (const form of forms) {
      const text = `it("plain", () => { expect(1).toBe(1); });\n${form}\n`;
      expect(preservationRowsFor(modified("test/f.test.ts", text, text)), form).toEqual({ rows: [], unchecked: [{ path: "test/f.test.ts", reason: "unrecognized-test-form" }] });
    }
    const imports = "import { describe, expect, it, test } from \"vitest\";\nconst ok = /x/.test(\"x\");\nit.each([[1, 2]])(\"adds %i\", (a) => { expect(a).toBe(a); });\n";
    expect(preservationRowsFor(modified("test/g.test.ts", imports, imports))).toEqual({ rows: [], unchecked: [] });
  });

  // @req FR-NODE-252 AC-4
  it("reads the case forms this repository uses: a title held in a variable or property, and an alias of it", () => {
    const base = [
      "const onFencedPlatform = process.platform === \"win32\" ? it : it.skip;",
      "for (const fixture of fixtures) {",
      "  it(fixture.name, () => { expect(1).toBe(1); expect(2).toBe(2); });",
      "}",
      "for (const skill of skills) describe(skill, () => { it(\"names\", () => { expect(skill).toBeTruthy(); }); });",
      "onFencedPlatform(\"reads a sentinel\", () => { expect(1).toBe(1); });",
      "onFencedPlatform(\"drops later\", () => { expect(1).toBe(1); });"
    ].join("\n");
    const head = [
      "const onFencedPlatform = process.platform === \"win32\" ? it : it.skip;",
      "for (const fixture of fixtures) {",
      "  it(fixture.name, () => { expect(1).toBe(1); });",
      "}",
      "onFencedPlatform(\"reads a sentinel\", () => { expect(1).toBe(1); });"
    ].join("\n");
    expect(preservationRowsFor(modified("test/h.test.ts", base, head))).toEqual({
      rows: [
        { kind: "existing-test-weakened-or-deleted", path: "test/h.test.ts", case: "${fixture.name}", change: "assertion-removed", baseAssertions: 2, headAssertions: 1 },
        { kind: "existing-test-weakened-or-deleted", path: "test/h.test.ts", case: "${skill}", change: "case-removed" },
        { kind: "existing-test-weakened-or-deleted", path: "test/h.test.ts", case: "${skill} > names", change: "case-removed" },
        { kind: "existing-test-weakened-or-deleted", path: "test/h.test.ts", case: "drops later", change: "case-removed" }
      ],
      unchecked: []
    });
  });

  // @req FR-NODE-252 AC-4
  it("lists a test file under unchecked when it hands a case function to another function", () => {
    for (const form of ["wrap(it);", "const cases = [it, test];", "register(onFencedPlatform);"]) {
      const text = `const onFencedPlatform = flag ? it : it.skip;\nit("plain", () => { expect(1).toBe(1); });\n${form}\n`;
      expect(preservationRowsFor(modified("test/w.test.ts", text, text)), form).toEqual({ rows: [], unchecked: [{ path: "test/w.test.ts", reason: "unrecognized-test-form" }] });
    }
  });

  // @req FR-NODE-252 AC-4
  it("does not read a property named like a case function, or an optional-chained one, as a case function", () => {
    const text = [
      "type Pkg = { default: { test?: string }; scripts?: Record<string, string> };",
      "const rules = [{ why: \"a\", test: (line: string) => line === \"\" }];",
      "it(\"reads\", () => { expect(pkg.scripts?.test).toContain(\"vitest\"); });"
    ].join("\n");
    expect(preservationRowsFor(modified("test/k.test.ts", text, text))).toEqual({ rows: [], unchecked: [] });
  });

  // @req FR-NODE-252 AC-4
  it("reports each case of an alias whose definition stops pointing at a running case function", () => {
    const cases = "onFencedPlatform(\"reads\", () => { expect(1).toBe(1); });\nonFencedPlatform(\"writes\", () => { expect(1).toBe(1); });\nit(\"other\", () => { expect(1).toBe(1); });\n";
    const base = `const onFencedPlatform = process.platform === "win32" ? it : it.skip;\n${cases}`;
    const rows = (definition: string) => preservationRowsFor(modified("test/a.test.ts", base, `const onFencedPlatform = ${definition};\n${cases}`)).rows;
    expect(rows("it.skip")).toEqual([
      { kind: "existing-test-weakened-or-deleted", path: "test/a.test.ts", case: "reads", change: "skip-added", marker: ".skip" },
      { kind: "existing-test-weakened-or-deleted", path: "test/a.test.ts", case: "writes", change: "skip-added", marker: ".skip" }
    ]);
    expect(rows("process.platform === \"win32\" ? it.only : it.skip")).toEqual([
      { kind: "existing-test-weakened-or-deleted", path: "test/a.test.ts", case: "reads", change: "only-added", marker: ".only" },
      { kind: "existing-test-weakened-or-deleted", path: "test/a.test.ts", case: "writes", change: "only-added", marker: ".only" }
    ]);
    expect(rows("process.platform === \"win32\" ? xit : it.skip").map((row) => (row.kind === "existing-test-weakened-or-deleted" && "marker" in row ? `${row.case}:${row.marker}` : ""))).toEqual([
      "reads:xit",
      "writes:xit"
    ]);
    expect(rows("process.platform === \"linux\" ? it : it.skip")).toEqual([]);
  });

  // @req FR-NODE-252 AC-3
  it("reads `exports` as an optional property key of a type literal, not as a CommonJS export", () => {
    const text = "const pkg = JSON.parse(raw) as { name: string; exports?: Record<string, unknown> };\nexport function f(a: number): void {}\n";
    expect(preservationRowsFor(modified("test/p.test.ts", text, text))).toEqual({ rows: [], unchecked: [] });
  });
});

describe("FR-NODE-252 AC-4 the parameterized and conditional case forms this repository uses", () => {
  const rows = (base: string, head: string) => preservationRowsFor(modified("test/e.test.ts", base, head)).rows;

  // @req FR-NODE-252 AC-4
  it("names an it.each(ROWS) case by its title and puts its assertions on it", () => {
    const base = [
      "const ROWS = [{ name: \"a\" }];",
      "describe(\"d\", () => {",
      "  it.each(ROWS)(\"first $name\", (row) => { expect(row).toBeTruthy(); });",
      "  it.each(ROWS)(\"checks $name\", (row) => { expect(row).toBeTruthy(); expect(row.name).toBe(\"a\"); });",
      "});"
    ].join("\n");
    const head = [
      "const ROWS = [{ name: \"a\" }];",
      "describe(\"d\", () => {",
      "  it.each(ROWS)(\"checks $name\", (row) => { expect(row).toBeTruthy(); });",
      "});"
    ].join("\n");
    expect(rows(base, head)).toEqual([
      { kind: "existing-test-weakened-or-deleted", path: "test/e.test.ts", case: "d > first $name", change: "case-removed" },
      { kind: "existing-test-weakened-or-deleted", path: "test/e.test.ts", case: "d > checks $name", change: "assertion-removed", baseAssertions: 2, headAssertions: 1 }
    ]);
  });

  // @req FR-NODE-252 AC-4
  it("counts the assertions of an it.runIf(cond) case and an expect.soft( as an assertion", () => {
    const base = "it.runIf(WIN32)(\"holds the fence\", () => { expect(1).toBe(1); expect.soft(2).toBe(2); });\n";
    const head = "it.runIf(WIN32)(\"holds the fence\", () => { expect(1).toBe(1); });\n";
    expect(rows(base, head)).toEqual([
      { kind: "existing-test-weakened-or-deleted", path: "test/e.test.ts", case: "holds the fence", change: "assertion-removed", baseAssertions: 2, headAssertions: 1 }
    ]);
  });

  // @req FR-NODE-252 AC-4
  it("reports a .skipIf(cond) added to an existing case as a skip added", () => {
    const base = "it(\"reads the lock\", () => { expect(1).toBe(1); });\ndescribe(\"group\", () => {});\n";
    const head = "it.skipIf(process.platform !== \"win32\")(\"reads the lock\", () => { expect(1).toBe(1); });\ndescribe.skipIf(CI)(\"group\", () => {});\n";
    expect(rows(base, head)).toEqual([
      { kind: "existing-test-weakened-or-deleted", path: "test/e.test.ts", case: "reads the lock", change: "skip-added", marker: ".skipIf" },
      { kind: "existing-test-weakened-or-deleted", path: "test/e.test.ts", case: "group", change: "skip-added", marker: ".skipIf" }
    ]);
  });
});

describe("FR-NODE-252 AC-3 AC-4 a token the recognizers did not consume never passes", () => {
  // @req FR-NODE-252 AC-4
  it("lists a test file under unchecked when a test API name is used in a form no recognizer consumed", () => {
    const forms = [
      "import { it as spec } from \"vitest\";\nspec(\"x\", () => { expect(1).toBe(1); });",
      "import * as v from \"vitest\";\nv.it(\"x\", () => { expect(1).toBe(1); });",
      "suite(\"x\", () => {});",
      "suite.skip(\"x\", () => {});",
      "bench(\"x\", () => {});",
      "fit(\"x\", () => {});",
      "it.extend({ a: 1 })(\"x\", () => {});",
      "await expect.poll(() => 1).toBe(1);",
      "const check = expect;",
      "import { onTestFinished } from \"vitest\";\nonTestFinished(() => {});"
    ];
    for (const form of forms) {
      const text = `it("plain", () => { expect(1).toBe(1); });\n${form}\n`;
      expect(preservationRowsFor(modified("test/u.test.ts", text, text)), form).toEqual({ rows: [], unchecked: [{ path: "test/u.test.ts", reason: "unrecognized-test-form" }] });
    }
  });

  // @req FR-NODE-252 AC-4
  it("consumes the hooks, vi and expect helpers this repository uses", () => {
    const text = [
      "import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, expectTypeOf, it, vi, type Mock } from \"vitest\";",
      "beforeAll(() => {}); afterAll(() => {}); beforeEach(() => {}); afterEach(() => {});",
      "const spy: Mock = vi.fn();",
      "describe(\"d\", () => {",
      "  it(\"x\", () => {",
      "    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ a: expect.any(String) }), expect.arrayContaining([1]));",
      "    expect(\"s\").toEqual(expect.stringContaining(\"s\")); expect(\"s\").toEqual(expect.stringMatching(/s/));",
      "    expect(expect.getState().currentTestName).toBe(\"x\"); expect(1).toEqual(expect.anything());",
      "    expectTypeOf(spy).toBeFunction();",
      "  });",
      "});"
    ].join("\n");
    expect(preservationRowsFor(modified("test/hooks.test.ts", text, text))).toEqual({ rows: [], unchecked: [] });
  });

  // @req FR-NODE-252 AC-4
  it("reads a generic expectTypeOf call and a local binding named like a test API as consumed", () => {
    const text = [
      "import { describe, expectTypeOf, it } from \"vitest\";",
      "expectTypeOf<RetargetInput>().toHaveProperty(\"ids\");",
      "const names = suites.map((suite) => suite.file);",
      "function collect(suite: Suite): string[] { return suite.tasks.map((task) => task.name); }",
      "for (const suite of SUITES) { it(suite.id, () => { expect(suite).toBeTruthy(); }); }"
    ].join("\n");
    expect(preservationRowsFor(modified("test/l.test.ts", text, text))).toEqual({ rows: [], unchecked: [] });
  });

  // @req FR-NODE-252 AC-3
  it("lists a source file under unchecked when an export, module or exports token is used in a form no recognizer consumed", () => {
    for (const form of ["export default interface Props { a: string }", "module[\"exports\"] = { a, b };", "const m = module;"]) {
      const text = `export function keep(a: number): void {}\n${form}\n`;
      expect(preservationRowsFor(modified("src/m.ts", text, text)), form).toEqual({ rows: [], unchecked: [{ path: "src/m.ts", reason: "unrecognized-export-form" }] });
    }
    const keys = "export interface Literal { readonly module: string; exports?: string }\nexport const x = { module: \"a\" };\n";
    expect(preservationRowsFor(modified("src/k.ts", keys, keys))).toEqual({ rows: [], unchecked: [] });
    const local = "for (const module of NAMES) use(module);\nconst found = list.filter((module) => module.ok);\nexport function f(a: number): void {}\n";
    expect(preservationRowsFor(modified("src/local.ts", local, local))).toEqual({ rows: [], unchecked: [] });
  });
});

describe("FR-NODE-252 AC-4 call-site markers of an alias, expect.not helpers and a parameter named test", () => {
  const alias = "const onFencedPlatform = process.platform === \"win32\" ? it : it.skip;\n";
  const rowsOf = (base: string, head: string) => preservationRowsFor(modified("test/r.test.ts", base, head));

  // @req FR-NODE-252 AC-4
  it("compares each alias call by the markers its definition gives plus the markers written on the call", () => {
    const base = `${alias}describe("d", () => { onFencedPlatform.each(["EPERM"])("answers held on %s", (code) => { expect(code).toBeTruthy(); }); });\n`;
    expect(rowsOf(base, base.replace("onFencedPlatform.each", "onFencedPlatform.skip.each"))).toEqual({
      rows: [{ kind: "existing-test-weakened-or-deleted", path: "test/r.test.ts", case: "d > answers held on %s", change: "skip-added", marker: ".skip" }],
      unchecked: []
    });
    expect(rowsOf(base, base.replace("onFencedPlatform.each", "it.skip.each"))).toEqual({
      rows: [{ kind: "existing-test-weakened-or-deleted", path: "test/r.test.ts", case: "d > answers held on %s", change: "skip-added", marker: ".skip" }],
      unchecked: []
    });
    expect(rowsOf(base, base.replace("onFencedPlatform.each", "it.each")).rows).toEqual([]);
  });

  // @req FR-NODE-252 AC-4
  it("consumes expect.not helpers and names a removed case in that file", () => {
    const base = "describe(\"d\", () => {\n  it(\"first\", () => { expect(acs).toEqual([expect.not.objectContaining({ citations: expect.anything() })]); });\n  it(\"second\", () => { expect(1).toBe(1); });\n});\n";
    const head = "describe(\"d\", () => {\n  it(\"first\", () => { expect(acs).toEqual([expect.not.objectContaining({ citations: expect.anything() })]); });\n});\n";
    expect(rowsOf(base, head)).toEqual({ rows: [{ kind: "existing-test-weakened-or-deleted", path: "test/r.test.ts", case: "d > second", change: "case-removed" }], unchecked: [] });
  });

  // @req FR-NODE-252 AC-4
  it("reads a parameter named test as that parameter inside its function, and test( outside it as a case", () => {
    const base = "const failed = results.filter((test) => test.status === \"failed\").map((test) => test.title);\ntest(\"keeps\", () => { expect(1).toBe(1); });\ntest(\"drops\", () => { expect(1).toBe(1); });\n";
    const head = "const failed = results.filter((test) => test.status === \"failed\").map((test) => test.title);\ntest(\"keeps\", () => { expect(1).toBe(1); });\n";
    expect(rowsOf(base, head)).toEqual({ rows: [{ kind: "existing-test-weakened-or-deleted", path: "test/r.test.ts", case: "drops", change: "case-removed" }], unchecked: [] });
    const bare = (text: string) => text.replace("(test) => test.status", "test => test.status");
    expect(rowsOf(bare(base), bare(head))).toEqual({ rows: [{ kind: "existing-test-weakened-or-deleted", path: "test/r.test.ts", case: "drops", change: "case-removed" }], unchecked: [] });
  });
});

describe("FR-NODE-252 AC-4 a context skip, and the cases after ternaries, arrows and object literals", () => {
  const rowsOf = (base: string, head: string) => preservationRowsFor(modified("test/c.test.ts", base, head));

  // @req FR-NODE-252 AC-4
  it("reports a skip call added on a case's context parameter, named or destructured", () => {
    const named = "it(\"links the home\", async (ctx) => { const linked = await link(); expect(linked).toBe(true); });\n";
    expect(rowsOf(named, named.replace("const linked", "if (!process.env.LINK) ctx.skip(); const linked"))).toEqual({
      rows: [{ kind: "existing-test-weakened-or-deleted", path: "test/c.test.ts", case: "links the home", change: "skip-added", marker: "context.skip()" }],
      unchecked: []
    });
    const destructured = "it(\"pins\", async ({ skip }) => { expect(1).toBe(1); });\n";
    expect(rowsOf(destructured, destructured.replace("expect(1)", "skip(); expect(1)")).rows).toEqual([
      { kind: "existing-test-weakened-or-deleted", path: "test/c.test.ts", case: "pins", change: "skip-added", marker: "context.skip()" }
    ]);
    const kept = "it(\"links\", (context) => { if (!ok) context.skip(); expect(1).toBe(1); });\n";
    expect(rowsOf(kept, kept.replace("expect(1).toBe(1);", "expect(1).toBe(1); expect(2).toBe(2);")).rows).toEqual([]);
  });

  const cases = [
    "describe(\"d\", () => {",
    "  it(\"first\", () => { expect(1).toBe(1); });",
    "  it(\"second\", () => { expect(1).toBe(1); });",
    "});",
    "test(\"third\", () => { expect(1).toBe(1); });"
  ];
  const prefixes = [
    "const label = process.env.CI ? String(name) : \"local\";",
    "const pick = process.env.CI ? (value) : other;",
    "const twice = (x: number): number => x * 2;",
    "const wrap = async (z: string): Promise<void> => { await run(z); };",
    "const table = { key: (v: string) => v, method(a: number): string { return String(a); } };",
    "function helper(a: string): { b: string } { return { b: a }; }",
    "const chosen = flag ? (a: number) => a : (b: number) => b;"
  ];

  // @req FR-NODE-252 AC-4
  it("keeps every case after a ternary, an arrow function or an object literal, so a change to them is reported", () => {
    for (const prefix of prefixes) {
      const base = [prefix, ...cases].join("\n");
      expect(rowsOf(base, base), prefix).toEqual({ rows: [], unchecked: [] });
      for (const title of ["first", "second", "third"]) {
        const head = base.replace(`("${title}"`, `.skip("${title}"`);
        const expected = title === "third" ? "third" : `d > ${title}`;
        expect(rowsOf(base, head).rows, `${prefix} / ${title}`).toEqual([
          { kind: "existing-test-weakened-or-deleted", path: "test/c.test.ts", case: expected, change: "skip-added", marker: ".skip" }
        ]);
      }
    }
  });

  // @req FR-NODE-252 AC-4
  it("lists a file under unchecked when a call holding it sits before a ternary colon", () => {
    const base = ["const label = process.env.CI ? String(it) : \"local\";", ...cases].join("\n");
    expect(rowsOf(base, base.replace("it(\"second\"", "it.skip(\"second\""))).toEqual({ rows: [], unchecked: [{ path: "test/c.test.ts", reason: "unrecognized-test-form" }] });
    // The arrow function's body ends at the ternary's `:`, so the `test` handed to `wrap` is the API.
    const branch = ["const pick = flag ? (test) => test.name : wrap(test);", ...cases].join("\n");
    expect(rowsOf(branch, branch)).toEqual({ rows: [], unchecked: [{ path: "test/c.test.ts", reason: "unrecognized-test-form" }] });
    // Neither group below is a parameter list, so each bare `it` stays a reference to the API:
    // a ternary's `:` ends no return type at the `;`, a call's group takes no `=>`, and a return type
    // holds no parenthesized group.
    for (const prefix of [
      "const pick = flag ? (it) : other;\nconst run = done => {",
      "const pick = flag ? wrap(it) : fallback => fallback;\nconst run = () => {",
      "const pick = flag ? (it) : (y) => y;\nconst run = () => {"
    ]) {
      const text = [prefix, ...cases, "};"].join("\n");
      expect(rowsOf(text, text), prefix).toEqual({ rows: [], unchecked: [{ path: "test/c.test.ts", reason: "unrecognized-test-form" }] });
    }
  });

  // @req FR-NODE-252 AC-4
  it("reads a case call inside a function whose parameter has a case function's name as a case", () => {
    const base = "[1].forEach((it) => {\n  it(\"loops\", () => { expect(1).toBe(1); });\n});\ntest(\"after\", () => { expect(1).toBe(1); });\n";
    expect(rowsOf(base, base.replace("it(\"loops\"", "it.skip(\"loops\"")).rows).toEqual([
      { kind: "existing-test-weakened-or-deleted", path: "test/c.test.ts", case: "loops", change: "skip-added", marker: ".skip" }
    ]);
  });
});

describe("FR-NODE-252 AC-4 a context skip in every combination of title, options, callee and context", () => {
  const titles = [
    { source: "\"plain title\"", key: "plain title" },
    { source: "`template title`", key: "template title" },
    { source: "name", key: "${name}" },
    { source: "fixture.name", key: "${fixture.name}" }
  ];
  const options = ["", "{ timeout: 5000 }, "];
  // An `.each(rows)` callback takes no context, only the row (preservation.fr-node-265.test.ts).
  const callees = [
    { call: "it", parameters: (context: string) => `(${context})` },
    { call: "it.for(ROWS)", parameters: (context: string) => `({ value }, ${context})` },
    { call: "onFencedPlatform", parameters: (context: string) => `(${context})` }
  ];
  const contexts = [
    { parameter: "ctx", skip: "ctx.skip();" },
    { parameter: "context", skip: "context.skip();" },
    { parameter: "{ skip }", skip: "skip();" }
  ];

  // @req FR-NODE-252 AC-4
  it("reports a skip added through the context parameter of the last function argument as exactly that case", () => {
    for (const title of titles) {
      for (const option of options) {
        for (const callee of callees) {
          for (const context of contexts) {
            const body = (extra: string) =>
              [
                "const onFencedPlatform = process.platform === \"win32\" ? it : it.skip;",
                "describe(\"d\", () => {",
                `  ${callee.call}(${title.source}, ${option}async ${callee.parameters(context.parameter)} => { ${extra}expect(1).toBe(1); });`,
                "  it(\"neighbour\", () => { expect(1).toBe(1); });",
                "});"
              ].join("\n");
            const label = `${title.source} / ${option || "no options"} / ${callee.call} / ${context.parameter}`;
            expect(preservationRowsFor(modified("test/x.test.ts", body(""), body(`${context.skip} `))), label).toEqual({
              rows: [{ kind: "existing-test-weakened-or-deleted", path: "test/x.test.ts", case: `d > ${title.key}`, change: "skip-added", marker: "context.skip()" }],
              unchecked: []
            });
          }
        }
      }
    }
  });

  // @req FR-NODE-252 AC-4
  it("takes the context from the last function argument, a bare arrow parameter included, past a trailing timeout", () => {
    for (const call of [
      "it(\"t\", () => undefined, (ctx) => { BODY }, 5000);",
      "it(\"t\", ctx => { BODY });",
      "it(\"t\", async ctx => { BODY }, 120_000);"
    ]) {
      const base = call.replace("BODY", "expect(1).toBe(1);");
      const head = call.replace("BODY", "ctx.skip(); expect(1).toBe(1);");
      expect(preservationRowsFor(modified("test/y.test.ts", base, head)).rows, call).toEqual([
        { kind: "existing-test-weakened-or-deleted", path: "test/y.test.ts", case: "t", change: "skip-added", marker: "context.skip()" }
      ]);
    }
  });
});
