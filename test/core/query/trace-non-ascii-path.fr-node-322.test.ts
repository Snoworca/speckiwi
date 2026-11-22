import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterAll, describe, expect, it, vi } from "vitest";
import { main } from "../../../src/cli/index.js";
import { traceReferencePath } from "../../../src/core/parser/file-references.js";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { checkLinks } from "../../../src/core/query/links.js";
import { cleanupFixtures, gitWorkspaceRepo, rawGit } from "../../mcp/support/workspace-root-fixture.js";

// @req FR-NODE-322 — a Trace Link path holding non-ASCII letters is a file to links check.
//
// OG (2026-11-21): `docs/decisions/웹서버-교체/없음.md:3` on a Code row passed links check in silence,
// because the trace-path rule admitted ASCII letters only and took the row for a non-file.

vi.setConfig({ testTimeout: 60_000 });

afterAll(async () => {
  await cleanupFixtures();
});

const ARCH_DOC = path.join("docs", "spec", "10.product-architecture.srs.md");
const SELF_ROW = "| Requirement | FR-ARCH-001 | self | Fixture self link |";
const KOREAN = "docs/decisions/웹서버-교체/01.결정.md";
/** `café` spelled with a combining acute accent, as a decomposed file name arrives. */
const DECOMPOSED = "docs/café/menu.md";
/** An extension that starts with a digit still names a file, as long as it holds a letter. */
const ARCHIVE = "docs/릴리스/build.7z";

async function repository(): Promise<string> {
  const directory = await gitWorkspaceRepo("fr-node-322-");
  expect(path.resolve((await resolveProjectRoot(directory)).root)).toBe(path.resolve(directory));
  expect(path.resolve(await rawGit(directory, "rev-parse", "--show-toplevel"))).toBe(path.resolve(directory));
  for (const file of [KOREAN, DECOMPOSED, ARCHIVE]) {
    await mkdir(path.dirname(path.join(directory, file)), { recursive: true });
    await writeFile(path.join(directory, file), "present\n");
  }
  return directory;
}

async function addTraceRows(directory: string, rows: readonly string[]): Promise<void> {
  const file = path.join(directory, ARCH_DOC);
  const text = await readFile(file, "utf8");
  if (!text.includes(SELF_ROW)) throw new Error("fixture changed: no Requirement trace row to append below");
  await writeFile(file, text.replace(SELF_ROW, [SELF_ROW, ...rows].join("\n")), "utf8");
}

async function links(directory: string) {
  return checkLinks(await parseWorkspace(await resolveProjectRoot(directory)));
}

describe("FR-NODE-322 AC-1 — a non-ASCII path is resolved and reported like an ASCII one", () => {
  // @req FR-NODE-322 AC-1
  it("reports a missing Korean path, with and without a line designation", async () => {
    const directory = await repository();
    await addTraceRows(directory, ["| Code | docs/decisions/웹서버-교체/없음.md:3 | implements | - |", "| Document | docs/결정/없음.md | related_to | - |"]);
    const broken = (await links(directory)).broken;
    expect(broken.map((entry) => entry.reference).sort()).toEqual(["docs/decisions/웹서버-교체/없음.md:3", "docs/결정/없음.md"].sort());
    expect(broken.every((entry) => entry.code === "SRS-W074")).toBe(true);
  });

  // @req FR-NODE-322 AC-1
  it("counts an existing non-ASCII path as resolved, not broken", async () => {
    const directory = await repository();
    const baseline = await links(directory);
    await addTraceRows(directory, [`| Code | ${KOREAN}:7,79 | implements | - |`, `| Document | ${DECOMPOSED} | related_to | - |`, `| Document | ${ARCHIVE} | related_to | - |`]);
    const result = await links(directory);
    expect(result.checked).toBe(baseline.checked + 3);
    expect(result.broken).toEqual([]);
  });

  // @req FR-NODE-322 AC-1
  it("reports the missing Korean path through the CLI `links check --json`", async () => {
    const directory = await repository();
    await addTraceRows(directory, ["| Code | docs/decisions/웹서버-교체/없음.md:3 | implements | - |"]);
    const streams = { stdout: new PassThrough(), stderr: new PassThrough() };
    await main(["--root", directory, "links", "check", "--json"], streams);
    const answer = JSON.parse(streams.stdout.read()?.toString() ?? "{}") as { broken?: Array<{ reference: string }> };
    expect((answer.broken ?? []).map((entry) => entry.reference)).toEqual(["docs/decisions/웹서버-교체/없음.md:3"]);
  });
});

describe("FR-NODE-322 AC-2 — the ASCII rule is what it was", () => {
  // @req FR-NODE-322 AC-2 — verification round 2: requiring a letter in every extension stopped
  // checking `docs/man/tool.1`, which FR-NODE-206 AC-1 checks.
  it("still reads an ASCII path with a digit-only extension as a file and reports it when missing", async () => {
    const directory = await repository();
    await mkdir(path.join(directory, "docs", "man"), { recursive: true });
    await writeFile(path.join(directory, "docs", "man", "tool.1"), "present\n");
    const baseline = await links(directory);
    await addTraceRows(directory, ["| Code | docs/man/tool.1 | implements | - |", "| Code | docs/missing.001 | implements | - |", "| Task | T-3.1 | related_to | - |"]);
    const result = await links(directory);
    expect(result.checked).toBe(baseline.checked + 3);
    expect(result.broken.map((entry) => entry.reference).sort()).toEqual(["T-3.1", "docs/missing.001"]);
  });
});

describe("FR-NODE-322 AC-2 — what is not a file stays out", () => {
  const NOT_FILES = [
    "https://예시.kr/문서/a.md",
    "https://example.com/docs/a.md",
    "FR-ARCH-001",
    "T-PH001-02",
    "결정 문서를 참고한다.md",
    "웹서버 교체 결정",
    "작업-설명",
    "검증완료.결과양호",
    "작업-3.1",
    "릴리스5.7.1",
    "see the decision record.md"
  ];

  // @req FR-NODE-322 AC-2
  it.each(NOT_FILES)("does not read %s as a file", (reference) => {
    expect(traceReferencePath(reference)).toBeUndefined();
  });

  // @req FR-NODE-322 AC-2
  it("checks none of them and reports none of them in links check", async () => {
    const directory = await repository();
    const baseline = await links(directory);
    await addTraceRows(directory, NOT_FILES.map((reference) => `| Task | ${reference} | related_to | - |`));
    const result = await links(directory);
    expect(result.checked).toBe(baseline.checked);
    expect(result.broken).toEqual([]);
  });
});
