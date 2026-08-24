import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseWorkspace } from "../../src/core/parser/workspace-parser.js";
import { resolveProjectRoot } from "../../src/core/project-root.js";
import {
  classifyReqReferences,
  collectReqReferences,
  extractReqReferences,
  formatReqReferences,
  type ReqReference
} from "../support/req-references.js";

// @req REL-NODE-007 — `@req` citations in src/ and test/ resolve to requirements that exist.
//
// The citations across this repository's sources had no mechanical check at all before this. The
// scan owns its own file reading because that is where the requirement's hardest criterion lives:
// files under both scanned roots carry literal NUL bytes and a plain text search drops them without
// saying so.

const NUL = String.fromCharCode(0);
const REPO_ROOT = process.cwd();

/** The three NUL-carrying files that also cite requirements, measured on 2026-08-17. */
const NUL_FILES_WITH_REFERENCES = [
  "src/core/orchestrator/conflict.ts",
  "src/core/orchestrator/handoff.ts",
  "src/core/orchestrator/resume.ts"
];

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "speckiwi-req-refs-"));
  await mkdir(path.join(root, "nested"), { recursive: true });
  await writeFile(path.join(root, "good.ts"), "// @req FR-ARCH-001 — a live requirement\n", "utf8"); // @req-lint: ignore
  // AC-3: a NUL byte ahead of the citation, which is what makes a text search skip the whole file.
  await writeFile(path.join(root, "binaryish.ts"), `const marker = "${NUL}";\n// @req FR-BOGUS-999 — fabricated\n`, "utf8"); // @req-lint: ignore
  await writeFile(path.join(root, "nested", "retired.ts"), "// @req FR-GONE-002 — retracted but cited\n", "utf8"); // @req-lint: ignore
  await writeFile(path.join(root, "notes.md"), "// @req FR-BOGUS-777 — prose, not source\n", "utf8"); // @req-lint: ignore
  return root;
}

const FIXTURE_KNOWN = new Set(["FR-ARCH-001", "FR-GONE-002"]);
const FIXTURE_DISCARDED = new Set(["FR-GONE-002"]);

async function realReferences(): Promise<ReqReference[]> {
  return collectReqReferences([path.join(REPO_ROOT, "src"), path.join(REPO_ROOT, "test")], { root: REPO_ROOT });
}

describe("REL-NODE-007 AC-1 — an unknown requirement id fails, named by file and line", () => {
  it("reports the fabricated id with its file and line", async () => {
    const root = await fixtureRoot();
    const report = classifyReqReferences(await collectReqReferences([root], { root }), FIXTURE_KNOWN, FIXTURE_DISCARDED);

    expect(report.unknown).toEqual([{ file: "binaryish.ts", line: 2, id: "FR-BOGUS-999" }]);
    expect(formatReqReferences(report.unknown)).toBe("binaryish.ts:2 FR-BOGUS-999");
  });

  it("reads every id on a citation line, not only the first", () => {
    const references = extractReqReferences("// @req FR-NODE-188 / FR-FLOW-134 — two owners\n", "x.ts");

    expect(references.map((reference) => reference.id)).toEqual(["FR-NODE-188", "FR-FLOW-134"]);
    expect(references.every((reference) => reference.line === 1)).toBe(true);
  });

  it("does not invent citations from ids that carry no @req marker", () => {
    // The empty result is only evidence once the marked form of the same line is known to parse:
    // an extractor that returned nothing at all would satisfy the negative case by itself.
    expect(extractReqReferences("// @req FR-ARCH-001 for background\n", "x.ts")).toEqual([{ file: "x.ts", line: 1, id: "FR-ARCH-001" }]);
    expect(extractReqReferences("// see FR-ARCH-001 for background\n", "x.ts")).toEqual([]);
  });
});

describe("REL-NODE-007 AC-2 — a discarded requirement is its own category, not a failure", () => {
  it("separates discarded citations from unknown ids", async () => {
    const root = await fixtureRoot();
    const report = classifyReqReferences(await collectReqReferences([root], { root }), FIXTURE_KNOWN, FIXTURE_DISCARDED);

    expect(report.discarded).toEqual([{ file: "nested/retired.ts", line: 1, id: "FR-GONE-002" }]);
    expect(report.unknown.map((reference) => reference.id)).not.toContain("FR-GONE-002");
  });

  it("a document whose only problem is a discarded citation has nothing to fail on", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "speckiwi-req-refs-ok-"));
    await writeFile(path.join(root, "only.ts"), "// @req FR-GONE-002 — historical citation\n", "utf8"); // @req-lint: ignore

    const report = classifyReqReferences(await collectReqReferences([root], { root }), FIXTURE_KNOWN, FIXTURE_DISCARDED);

    expect(report.unknown).toEqual([]);
    expect(report.discarded).toHaveLength(1);
  });
});

describe("REL-NODE-007 AC-3 — the scan reads files carrying literal NUL bytes", () => {
  it("finds a bad reference behind a NUL byte", async () => {
    const root = await fixtureRoot();
    const references = await collectReqReferences([root], { root });

    expect(await readFile(path.join(root, "binaryish.ts"), "utf8")).toContain(NUL);
    expect(references).toContainEqual({ file: "binaryish.ts", line: 2, id: "FR-BOGUS-999" });
  });

  // These three used to carry a raw NUL, which made every tool that guesses at binaryness skip
  // them; the case above proves the scanner does not, against a fixture that still carries one.
  // NFR-NODE-001 replaced the byte with its escape, so asserting the repository still carries one
  // would now be asserting a defect. What is worth keeping is that the scan reaches these files.
  it("collects references from the sources that once carried a NUL byte", async () => {
    const references = await realReferences();
    const scannedFiles = new Set(references.map((reference) => reference.file));

    for (const file of NUL_FILES_WITH_REFERENCES) {
      expect(scannedFiles, `${file} was skipped by the scan`).toContain(file);
    }
  });
});

describe("REL-NODE-007 AC-5 — a fabricated citation opts out at the site, in one line's scope", () => {
  it("does not report a citation on a line carrying the marker", () => {
    expect(extractReqReferences("await write(`// @req FR-BOGUS-999`); // @req-lint: ignore\n", "x.ts")).toEqual([]);
  });

  it("exempts its own line and nothing else", () => {
    // The negative the hatch lives or dies by. A marker that reached past its line would let a real
    // unresolvable citation ride along behind a neighbouring fixture.
    //
    // The ids here are live ones, and that is forced rather than incidental: lines 2 and 4 must NOT
    // be exempt for the assertion to mean anything, so they are genuine citations of this file and
    // have to resolve like any other. Fabricating them would need the marker that ruins the test.
    const source = [
      "const a = `// @req FR-ARCH-001`; // @req-lint: ignore",
      "const b = `// @req FR-NODE-188`;",
      "// @req-lint: ignore",
      "const c = `// @req FR-FLOW-134`;"
    ].join("\n");

    expect(extractReqReferences(source, "x.ts")).toEqual([
      { file: "x.ts", line: 2, id: "FR-NODE-188" },
      { file: "x.ts", line: 4, id: "FR-FLOW-134" }
    ]);
  });

  it("is not itself a citation, so a bare marker line references nothing", () => {
    expect(extractReqReferences("// @req-lint: ignore\n", "x.ts")).toEqual([]);
    // …and the marker does not blind the scan to a genuine citation elsewhere on its own line.
    expect(extractReqReferences("// @req-lint: ignore is the marker; @req FR-ARCH-001 is a citation\n", "x.ts")).toEqual([]);
  });

  it("keeps this file's own fabricated citations out of the report by exemption, not by disguise", async () => {
    const source = await readFile(path.join(REPO_ROOT, "test/release/req-reference-resolution.rel-node-007.test.ts"), "utf8");

    // These are real text in this file. Nothing hides them from the scan; the same-line marker is
    // the only reason the repository stays clean, which is what makes the hatch load-bearing.
    expect(source).toContain("@req FR-BOGUS-999"); // @req-lint: ignore
    expect(source).toContain("@req FR-GONE-002"); // @req-lint: ignore
    expect(source).not.toContain(`@$\{"req"}`);
  });
});

describe("REL-NODE-007 AC-4 — the check runs inside the normal suite", () => {
  it("is picked up by the unfiltered suite command", async () => {
    const pkg = JSON.parse(await readFile(path.join(REPO_ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> };
    const config = await readFile(path.join(REPO_ROOT, "vitest.config.ts"), "utf8");

    // `npm test` runs vitest with no path filter, so every *.test.ts is in scope.
    expect(pkg.scripts.test).toMatch(/^vitest run\b/);
    expect(pkg.scripts.test).not.toMatch(/\btest\/\S/);

    const excluded = [...config.matchAll(/"\*\*\/([^"*]+)\/\*\*"/g)].map((match) => match[1] as string);
    expect(excluded.length).toBeGreaterThan(0);
    const own = "test/release/req-reference-resolution.rel-node-007.test.ts";
    expect(excluded.filter((entry) => own.includes(entry))).toEqual([]);
  });
});

describe("REL-NODE-007 — the repository resolves", () => {
  it("has no unknown @req reference in src/ or test/", async () => {
    const workspace = await parseWorkspace(await resolveProjectRoot(REPO_ROOT));
    const known = new Set(workspace.records.map((record) => record.id));
    const discarded = new Set(workspace.records.filter((record) => record.status === "discarded").map((record) => record.id));
    const references = await realReferences();

    // Anti-vacuity: a scanner that walked nothing would report a clean repository forever.
    // 926 references across 257 files, 566 requirements, 27 discarded — measured 2026-08-17.
    expect(references.length).toBeGreaterThanOrEqual(900);
    expect(new Set(references.map((reference) => reference.file)).size).toBeGreaterThanOrEqual(250);
    expect(known.size).toBeGreaterThanOrEqual(500);
    expect(discarded.size).toBeGreaterThanOrEqual(20);

    const report = classifyReqReferences(references, known, discarded);
    expect(formatReqReferences(report.unknown)).toBe("");
  });

  it("would report a real citation whose requirement disappeared", async () => {
    const workspace = await parseWorkspace(await resolveProjectRoot(REPO_ROOT));
    const references = await realReferences();
    const cited = references.find((reference) => reference.id.startsWith("FR-NODE-"));
    expect(cited).toBeDefined();
    const missingId = cited?.id as string;

    const known = new Set(workspace.records.map((record) => record.id).filter((id) => id !== missingId));
    const report = classifyReqReferences(references, known, new Set());

    expect(report.unknown.length).toBeGreaterThan(0);
    expect(report.unknown.every((reference) => reference.id === missingId)).toBe(true);
    expect(formatReqReferences(report.unknown)).toContain(`:${report.unknown[0]?.line} ${missingId}`);
  });

  it("would route a real citation to the discarded category once its requirement is retracted", async () => {
    const workspace = await parseWorkspace(await resolveProjectRoot(REPO_ROOT));
    const references = await realReferences();
    const known = new Set(workspace.records.map((record) => record.id));
    const retracted = references.find((reference) => reference.id.startsWith("FR-NODE-"))?.id as string;

    const report = classifyReqReferences(references, known, new Set([retracted]));

    expect(report.unknown).toEqual([]);
    expect(report.discarded.length).toBeGreaterThan(0);
    expect(report.discarded.every((reference) => reference.id === retracted)).toBe(true);
  });
});
