import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as scanner from "../../../src/core/testing/test-citations.js";
import * as support from "../../support/req-references.js";

// FR-NODE-210 AC-1 / AC-3 — one test-citation scanner, in src, and the files it counts as tests.

const {
  DEFAULT_TEST_FILE_GLOBS,
  acceptanceCriterionIdsIn,
  indexTestCitations,
  listTestFiles,
  requirementIdsIn,
  sdsContractIdsIn,
  testFileMatcher
} = scanner;

function matchesAnyGlob(file: string, globs: readonly string[]): boolean {
  return testFileMatcher(globs)(file);
}

async function tree(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "speckiwi-test-citations-"));
  for (const [relative, text] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
    await writeFile(path.join(root, relative), text, "utf8");
  }
  return root;
}

describe("FR-NODE-210 AC-1 — the scanner lives in src and the test support uses it", () => {
  it("FR-NODE-210 AC-1: req-references re-exports the src scanner's functions rather than defining its own", () => {
    expect(support.extractReqReferences).toBe(scanner.extractReqReferences);
    expect(support.collectReqReferences).toBe(scanner.collectReqReferences);
    expect(support.classifyReqReferences).toBe(scanner.classifyReqReferences);
    expect(support.formatReqReferences).toBe(scanner.formatReqReferences);
  });

  it("FR-NODE-210 AC-1: the support file keeps no copy of the id pattern, the marker or the file walk", async () => {
    const text = await readFile(path.join("test", "support", "req-references.ts"), "utf8");
    for (const copy of ["readdir", "readFile", "matchAll", "RegExp", "A-Z0-9", "@req-lint:"]) {
      expect(text.includes(copy), `test/support/req-references.ts still carries '${copy}'`).toBe(false);
    }
  });
});

describe("FR-NODE-210 AC-3 — which files are tests", () => {
  const positives = [
    "src/a.test.ts",
    "a.test.js",
    "pkg/b.spec.jsx",
    "tools/test_parser.py",
    "tools/parser_test.py",
    "cmd/server_test.go",
    "src/main/java/FooTest.java",
    "App/BarTests.cs",
    "test/support/helper.ts",
    "tests/fixtures/data.json",
    "web/components/__tests__/Button.jsx",
    "src/test/java/Foo.java"
  ];
  const negatives = ["src/latest.ts", "src/contest/entry.ts", "src/testing.ts", "docs/testplan.md", "src/Testimony.java", "tools/attest_x.py", "src/protest.go"];

  it("FR-NODE-210 AC-3: the default patterns are the ones the requirement names", () => {
    expect([...DEFAULT_TEST_FILE_GLOBS]).toEqual([
      "**/*.test.*",
      "**/*.spec.*",
      "**/test_*.py",
      "**/*_test.py",
      "**/*_test.go",
      "**/*Test.java",
      "**/*Tests.cs",
      "**/test/**",
      "**/tests/**",
      "**/__tests__/**"
    ]);
    for (const file of positives) expect(matchesAnyGlob(file, DEFAULT_TEST_FILE_GLOBS), file).toBe(true);
    for (const file of negatives) expect(matchesAnyGlob(file, DEFAULT_TEST_FILE_GLOBS), file).toBe(false);
  });

  it("FR-NODE-210 AC-3: skips node_modules, dist and VCS directories, and lists the rest sorted", async () => {
    const root = await tree({
      "src/a.test.ts": "x",
      "test/b.ts": "x",
      "src/c.ts": "x",
      "node_modules/pkg/d.test.js": "x",
      "dist/e.test.js": "x",
      ".git/hooks/f.test.sh": "x",
      ".hg/g.test.py": "x",
      ".svn/h.test.py": "x",
      "lib/node_modules/i.test.js": "x"
    });
    expect(await listTestFiles(root)).toEqual(["src/a.test.ts", "test/b.ts"]);
  });

  it("FR-NODE-210 AC-3: --test-glob replaces the defaults", async () => {
    const root = await tree({ "src/a.test.ts": "x", "spec/models/user_spec.rb": "x", "spec/helper.rb": "x" });
    expect(await listTestFiles(root, ["spec/**/*_spec.rb"])).toEqual(["spec/models/user_spec.rb"]);
    expect(matchesAnyGlob("spec/x.rb", ["spec/?.rb"])).toBe(true);
    expect(matchesAnyGlob("spec/xy.rb", ["spec/?.rb"])).toBe(false);
    expect(matchesAnyGlob("spec/a/b.rb", ["spec/*.rb"])).toBe(false);
  });
});

describe("FR-NODE-210 AC-2 — a citation is the requirement id and AC-<n> on one line", () => {
  it("FR-NODE-210 AC-2: reads AC ids as whole tokens and never counts an SDS-AC as an AC", () => {
    expect(acceptanceCriterionIdsIn("it('FR-X-001 AC-2 and AC-10', …)")).toEqual(["AC-2", "AC-10"]);
    expect(acceptanceCriterionIdsIn("SDS-AC-2 only")).toEqual([]);
    expect(sdsContractIdsIn("it('SDS-AC-2: … AC-3')")).toEqual(["SDS-AC-2"]);
  });

  it("FR-NODE-210 AC-2: reads ids the requirement grammar allows — digit-led and multi-part scope segments", () => {
    expect(requirementIdsIn("FR-2FA-001 FR-AUTH-2-001 NFR-3DS-0100 FR-NODE-209")).toEqual(["FR-2FA-001", "FR-AUTH-2-001", "NFR-3DS-0100", "FR-NODE-209"]);
    expect(requirementIdsIn("AC-1 UTF-8 v1.0.0")).toEqual([]);
    // An SDS contract id has the same shape and is never a requirement.
    expect(requirementIdsIn("SDS-AC-1 FR-ARCH-001 SDS-AC-12")).toEqual(["FR-ARCH-001"]);
    const index = indexTestCitations([{ path: "test/a.test.ts", text: "it('FR-AUTH-2-001 AC-1', () => {});\n" }]);
    expect(index.acCitations("FR-AUTH-2-001", "AC-1")).toEqual([{ file: "test/a.test.ts", line: 1 }]);
  });

  it("FR-NODE-210 AC-2: indexes citations by requirement, criterion and line, over whole id tokens", () => {
    const index = indexTestCitations([
      {
        path: "test/a.test.ts",
        text: ["describe('FR-ARCH-001 AC-1 — lists', () => {", "  it('FR-ARCH-0011 AC-2', () => {});", "  it('FR-ARCH-001 AC-20', () => {});", "  it('FR-ARCH-001', () => { /* see AC-2 */ });", "  it('AC-2', () => {});", "});"].join("\n")
      },
      { path: "test/b.test.ts", text: `const nul = "${String.fromCharCode(0)}";\nit('FR-ARCH-001 AC-2', () => {});\nit('SDS-AC-1 contract', () => {});\n` }
    ]);
    expect(index.acCitations("FR-ARCH-001", "AC-1")).toEqual([{ file: "test/a.test.ts", line: 1 }]);
    expect(index.acCitations("FR-ARCH-001", "AC-2")).toEqual([
      { file: "test/a.test.ts", line: 4 },
      { file: "test/b.test.ts", line: 2 }
    ]);
    expect(index.acCitations("FR-ARCH-001", "AC-3")).toEqual([]);
    expect(index.sdsCitations("test/b.test.ts", "SDS-AC-1")).toEqual([{ file: "test/b.test.ts", line: 3 }]);
    expect(index.sdsCitations("test/a.test.ts", "SDS-AC-1")).toEqual([]);
  });

  // The citation convention writes a requirement id once, before its ACs, so an AC token belongs to the
  // nearest requirement id before it on the line — never to every id the line names.
  it("FR-NODE-210 AC-2: pairs each AC with the nearest requirement id before it on the line, not with every id", () => {
    const at = { file: "test/a.test.ts", line: 1 };
    const index = indexTestCitations([{ path: "test/a.test.ts", text: "it('FR-X-001 AC-1 AC-3 / FR-X-002 AC-2 (see FR-X-003)', () => {});\n" }]);
    expect(index.acCitations("FR-X-001", "AC-1")).toEqual([at]);
    expect(index.acCitations("FR-X-001", "AC-3")).toEqual([at]);
    expect(index.acCitations("FR-X-002", "AC-2")).toEqual([at]);
    expect(index.acCitations("FR-X-001", "AC-2"), "FR-X-002's AC is not FR-X-001's").toEqual([]);
    expect(index.acCitations("FR-X-002", "AC-1"), "FR-X-001's AC is not FR-X-002's").toEqual([]);
    expect(index.acCitations("FR-X-002", "AC-3")).toEqual([]);
    expect(index.acCitations("FR-X-003", "AC-2"), "an id after every AC owns none of them").toEqual([]);
  });

  it("FR-NODE-210 AC-2: an AC token before any requirement id on its line cites nothing", () => {
    const index = indexTestCitations([{ path: "test/a.test.ts", text: "it('AC-1 (narrowed by FR-X-001)', () => {});\n" }]);
    expect(index.acCitations("FR-X-001", "AC-1")).toEqual([]);
  });
});
