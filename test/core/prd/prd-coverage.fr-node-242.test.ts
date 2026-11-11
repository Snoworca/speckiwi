import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { checkPrdReferences, findPrdReferences, hasPrdFileSuffix, parsePrd, prdCoverage } from "../../../src/core/prd/index.js";
import type { RequirementRecord, TraceLink } from "../../../src/core/types.js";
import { buildPrd, DEFAULT_ITEMS, type FixtureItem } from "./prd-fixture.js";

const PATH = "docs/prd/2026-11-04.reset.prd.md";
/** References as links check reads them in a requirement under docs/spec. */
const refsFromSpec = (text: string) => findPrdReferences(text, "docs/spec");

interface RecordInput {
  id: string;
  target?: string;
  status?: string;
  rationale?: string;
  criteria?: string[];
  traceLinks?: TraceLink[];
}

function record(input: RecordInput): RequirementRecord {
  return {
    id: input.id, title: input.id, type: "functional", target: input.target ?? "1.0.0", status: input.status ?? "planned", scope: "AUTH",
    filePath: "docs/spec/10.auth.srs.md", headingLine: 1, metadata: {}, requirement: "statement", rationale: input.rationale ?? "-",
    acceptanceCriteria: (input.criteria ?? []).map((text, index) => ({ id: `AC-${index + 1}`, text, checked: false })),
    verificationEvidence: [], traceLinks: input.traceLinks ?? [], changeNotes: [], tags: []
  } as unknown as RequirementRecord;
}

// Items: PRD-1 intent, PRD-2 in-scope, PRD-3 exclusion, PRD-4 proposal (proposed), PRD-5 goal, PRD-6 rejected in-scope,
// PRD-7 confirmed proposal with Effect in-scope.
const ITEMS: FixtureItem[] = [
  ...DEFAULT_ITEMS,
  { title: "메일 목표", rows: { Kind: "goal", Source: "U-1", State: "confirmed" }, quote: "Password reset email" },
  { title: "거절된 범위", rows: { Kind: "in-scope", Source: "U-1", State: "rejected" }, quote: "로그인 화면에" },
  { title: "Audit log", rows: { Kind: "proposal", State: "confirmed", Reason: "audit default", Effect: "in-scope" } }
];

const doc = parsePrd(buildPrd({ items: ITEMS }), PATH);

describe("FR-NODE-242 PRD coverage", () => {
  // @req FR-NODE-242 AC-2
  it("lists every intent, goal and in-scope item no requirement or criterion of the target cites", () => {
    const records = [record({ id: "FR-AUTH-001", rationale: "AC-1 ← PRD-2", criteria: ["link expires"] })];
    const report = prdCoverage(doc, records, { target: "1.0.0" });
    expect(report.uncitedItems.map((item) => item.id)).toEqual(["PRD-1", "PRD-5", "PRD-7"]);
    expect(report.prd).toBe(doc.pointer);
  });

  // @req FR-NODE-242 AC-2
  it("counts a citation in a criterion, a Trace Doc reference and a qualified path, but not a citation of another PRD file or another target", () => {
    const records = [
      record({ id: "FR-AUTH-001", criteria: ["covers PRD-1"] }),
      record({ id: "FR-AUTH-002", traceLinks: [{ type: "Doc", reference: `${PATH}#PRD-5`, relation: "informed_by", notes: "-" } as TraceLink] }),
      record({ id: "FR-AUTH-003", rationale: "AC-1 ← docs/prd/other.prd.md#PRD-2", criteria: ["x"] }),
      record({ id: "FR-AUTH-004", target: "2.0.0", rationale: "AC-1 ← PRD-7", criteria: ["y"] }),
      record({ id: "FR-AUTH-005", status: "discarded", rationale: "AC-1 ← PRD-7", criteria: ["z"] })
    ];
    const report = prdCoverage(doc, records, { target: "1.0.0" });
    expect(report.uncitedItems.map((item) => item.id)).toEqual(["PRD-2", "PRD-7"]);
  });

  // @req FR-NODE-242 AC-2
  it("lists every criterion of the target with neither a PRD citation nor a fills: basis", () => {
    const records = [
      record({ id: "FR-AUTH-001", rationale: "AC-1 ← PRD-2; AC-3 fills: PRD-2 / hole / a link without expiry cannot be verified", criteria: ["a", "b", "c", "d PRD-1"] }),
      record({ id: "FR-AUTH-002", rationale: "fills: PRD-1 / defect / the request names no recovery path", criteria: ["e", "f"] }),
      record({ id: "FR-AUTH-003", rationale: "AC-1 ← PRD-6; AC-2 ← PRD-99; AC-3 fills: / hole / no item", criteria: ["g", "h", "i"] })
    ];
    const report = prdCoverage(doc, records, { target: "1.0.0" });
    // A requirement-level fills: names no criterion, so it grounds none of them (FR-AUTH-002).
    expect(report.ungroundedCriteria.map((item) => `${item.requirementId}#${item.criterionId}`)).toEqual([
      "FR-AUTH-001#AC-2",
      "FR-AUTH-002#AC-1",
      "FR-AUTH-002#AC-2",
      "FR-AUTH-003#AC-1",
      "FR-AUTH-003#AC-2",
      "FR-AUTH-003#AC-3"
    ]);
  });

  // @req FR-NODE-242 AC-2
  it("pairs each criterion with the citation that follows it on a comma-separated line, and does not ground a rejected item's criterion", () => {
    const records = [
      record({ id: "FR-AUTH-001", rationale: "AC-1 ← PRD-1, AC-2 ← PRD-6", criteria: ["a", "b"] }),
      record({ id: "FR-AUTH-002", rationale: "AC-1 ← PRD-1 (supersedes old AC-2 wording)", criteria: ["c", "d"] }),
      record({ id: "FR-AUTH-003", rationale: "AC-1, AC-2 ← PRD-2", criteria: ["e", "f"] }),
      record({ id: "FR-AUTH-004", rationale: "fills: PRD-6 / hole / extra", criteria: ["g"] })
    ];
    const report = prdCoverage(doc, records, { target: "1.0.0" });
    expect(report.ungroundedCriteria.map((item) => `${item.requirementId}#${item.criterionId}`)).toEqual([
      "FR-AUTH-001#AC-2",
      "FR-AUTH-002#AC-2",
      "FR-AUTH-004#AC-1"
    ]);
  });

  // @req FR-NODE-242 AC-2
  it("keeps a fills: basis when its reason names a criterion", () => {
    const records = [record({ id: "FR-AUTH-001", rationale: "fills: PRD-2 / hole / the request names no expiry, so AC-1 sets one hour", criteria: ["a"] })];
    expect(prdCoverage(doc, records, { target: "1.0.0" }).ungroundedCriteria).toEqual([]);
  });

  // @req FR-NODE-242 AC-2
  it("reads a citation written as this repository's Markdown link, label the path and target relative to docs/spec", () => {
    const records = [record({ id: "FR-AUTH-001", rationale: `AC-1 ← [${PATH}#PRD-2](../prd/2026-11-04.reset.prd.md#PRD-2)`, criteria: ["a"] })];
    const report = prdCoverage(doc, records, { target: "1.0.0" });
    expect(report.ungroundedCriteria).toEqual([]);
    expect(report.uncitedItems.map((item) => item.id)).not.toContain("PRD-2");
    const targetOnly = [record({ id: "FR-AUTH-001", rationale: "AC-1 ← [the reset item](../prd/2026-11-04.reset.prd.md#PRD-2)", criteria: ["a"] })];
    expect(prdCoverage(doc, targetOnly, { target: "1.0.0" }).ungroundedCriteria).toEqual([]);
    // A link cites through its destination only: its text is the link's, not running text.
    const labelOnly = [record({ id: "FR-AUTH-001", rationale: `AC-1 ← [${PATH}#PRD-2](https://example.test/prd)`, criteria: ["a"] })];
    expect(prdCoverage(doc, labelOnly, { target: "1.0.0" }).ungroundedCriteria.map((item) => item.criterionId)).toEqual(["AC-1"]);
  });

  // @req FR-NODE-242 AC-2
  it("does not read a link label or a longer path ending in docs/prd as a citation of this PRD", () => {
    const records = [
      record({ id: "FR-AUTH-001", rationale: "AC-1 ← [PRD-1](docs/prd/other.prd.md#PRD-1)", criteria: ["a"] }),
      record({ id: "FR-AUTH-002", rationale: `AC-1 ← vendor/${PATH}#PRD-2`, criteria: ["b"] })
    ];
    const report = prdCoverage(doc, records, { target: "1.0.0" });
    expect(report.uncitedItems.map((item) => item.id)).toEqual(["PRD-1", "PRD-2", "PRD-5", "PRD-7"]);
    expect(report.ungroundedCriteria.map((item) => item.requirementId)).toEqual(["FR-AUTH-001", "FR-AUTH-002"]);
    expect(refsFromSpec(`vendor/${PATH}#PRD-2`)).toEqual([]);
  });

  // @req FR-NODE-242 AC-2
  it("lists the requirements of the target that cite no PRD item and carry no fills: basis", () => {
    const records = [
      record({ id: "FR-AUTH-001", rationale: "AC-1 ← PRD-2", criteria: ["a"] }),
      record({ id: "FR-AUTH-002", rationale: "-" }),
      record({ id: "FR-AUTH-003", rationale: "fills: PRD-1 / hole / x" }),
      record({ id: "FR-AUTH-004", rationale: "← PRD-6" })
    ];
    const report = prdCoverage(doc, records, { target: "1.0.0" });
    expect(report.uncitedRequirements.map((item) => item.requirementId)).toEqual(["FR-AUTH-002", "FR-AUTH-004"]);
  });

  // @req FR-NODE-242 AC-3
  it("states that it judges only string matches and leaves scope and contradiction to the verifier", () => {
    const report = prdCoverage(doc, [], { target: "1.0.0" });
    expect(report.notJudged).toMatch(/string/i);
    expect(report.notJudged).toMatch(/verifier/i);
    expect(report.notJudged).toMatch(/contradict/i);
    // FR-NODE-302 added the cross-target split, which string comparison decides too.
    expect(Object.keys(report).sort()).toEqual(["assignedToOtherTargets", "missingItems", "notJudged", "prd", "target", "uncitedItems", "uncitedRequirements", "ungroundedCriteria"]);
  });
});

describe("FR-NODE-242 PRD references", () => {
  // @req FR-NODE-242 AC-1
  it("finds docs/prd/<file>.prd.md#PRD-<n> references in text", () => {
    expect(refsFromSpec(`see ${PATH}#PRD-2, and docs/prd/x.prd.md#PRD-10.`)).toEqual([
      { reference: `${PATH}#PRD-2`, path: PATH, itemId: "PRD-2" },
      { reference: "docs/prd/x.prd.md#PRD-10", path: "docs/prd/x.prd.md", itemId: "PRD-10" }
    ]);
  });

  // @req FR-NODE-242 AC-1
  it("reads a PRD reference in a Markdown link or link definition through the shared link scanner", async () => {
    expect(refsFromSpec("see [the item](../prd/x.prd.md#PRD-3) and `[PRD-9](../prd/x.prd.md#PRD-9)`")).toEqual([
      { reference: "docs/prd/x.prd.md#PRD-3", path: "docs/prd/x.prd.md", itemId: "PRD-3" }
    ]);
    expect(refsFromSpec("[item]: ../prd/y.prd.md#PRD-4")).toEqual([{ reference: "docs/prd/y.prd.md#PRD-4", path: "docs/prd/y.prd.md", itemId: "PRD-4" }]);
    const source = await readFile("src/core/prd/citations.ts", "utf8");
    expect(source).toMatch(/from "\.\.\/parser\/markdown-links\.js"/);
  });

  // @req FR-NODE-242 AC-1
  it("reports a Trace Doc reference or a Rationale basis whose file or item does not exist", () => {
    const records = [
      record({ id: "FR-AUTH-001", rationale: `AC-1 ← ${PATH}#PRD-2; AC-2 ← ${PATH}#PRD-42`, criteria: ["a", "b"] }),
      record({ id: "FR-AUTH-002", traceLinks: [{ type: "Doc", reference: "docs/prd/missing.prd.md#PRD-1", relation: "informed_by", notes: "-" } as TraceLink] }),
      record({ id: "FR-AUTH-003", traceLinks: [{ type: "Code", reference: "docs/prd/missing.prd.md#PRD-1", relation: "implements", notes: "-" } as TraceLink] })
    ];
    const problems = checkPrdReferences(records, (prdPath) => (prdPath === PATH ? doc : undefined));
    expect(problems).toEqual([
      { requirementId: "FR-AUTH-001", field: "rationale", reference: `${PATH}#PRD-42`, problem: "missing-item" },
      { requirementId: "FR-AUTH-002", field: "traceLinks", reference: "docs/prd/missing.prd.md#PRD-1", problem: "missing-file" }
    ]);
  });
});

// Each row: a Rationale, the number of criteria, and the criteria that must stay ungrounded. Items:
// PRD-1, PRD-2 usable, PRD-6 rejected. Each AC is judged on its own basis only.
const BASIS_MATRIX: Array<{ name: string; rationale: string; criteria: number; ungrounded: string[] }> = [
  { name: "fills on its own line, then a citation", rationale: "fills: PRD-1 / hole / no expiry\nAC-2 ← PRD-2", criteria: 2, ungrounded: ["AC-1"] },
  { name: "fills reason naming AC-1, then AC-2 ← on the same line", rationale: "fills: PRD-1 / hole / for AC-1, a link must expire. AC-2 ← PRD-2", criteria: 3, ungrounded: ["AC-3"] },
  { name: "fills reason, then a citation after ';'", rationale: "fills: PRD-1 / hole / no expiry; AC-2 ← PRD-2", criteria: 2, ungrounded: ["AC-1"] },
  { name: "Korean fills reason naming AC-1", rationale: "fills: PRD-1 / 구멍 / AC-1 이 없으면 만료를 검증할 수 없다", criteria: 2, ungrounded: ["AC-2"] },
  { name: "fills reason naming no criterion grounds none", rationale: "fills: PRD-1 / hole / the request names no recovery path", criteria: 2, ungrounded: ["AC-1", "AC-2"] },
  { name: "fills reason naming every criterion only in prose", rationale: "fills: PRD-1 / hole / for AC-1 only", criteria: 3, ungrounded: ["AC-2", "AC-3"] },
  { name: "comma list", rationale: "AC-1, AC-2 ← PRD-2", criteria: 3, ungrounded: ["AC-3"] },
  { name: "en-dash range", rationale: "AC-1–AC-3 ← PRD-2", criteria: 4, ungrounded: ["AC-4"] },
  { name: "tilde range", rationale: "AC-2~AC-3 ← PRD-2", criteria: 3, ungrounded: ["AC-1"] },
  { name: "criterion named in a citation's comment", rationale: "AC-1 ← PRD-2 (see AC-3 for timing)", criteria: 3, ungrounded: ["AC-2", "AC-3"] },
  { name: "arrow to a fills basis", rationale: "AC-1 ← fills: PRD-2 / hole / x", criteria: 2, ungrounded: ["AC-2"] },
  { name: "sentences on one line, one rejected", rationale: "AC-1 ← PRD-2. AC-2 ← PRD-6. AC-3 ← PRD-1.", criteria: 3, ungrounded: ["AC-2"] },
  { name: "a citation attached to no criterion", rationale: "PRD-2 covers everything here", criteria: 2, ungrounded: ["AC-1", "AC-2"] },
  { name: "head with no citation, then a fills for another criterion", rationale: "AC-1 ← (see below). fills: PRD-2 / hole / for AC-2", criteria: 2, ungrounded: ["AC-1"] },
  { name: "fills naming a rejected item", rationale: "fills: PRD-6 / hole / for AC-1", criteria: 1, ungrounded: ["AC-1"] },
  { name: "a fills reason ends at ';'", rationale: "fills: PRD-1 / hole / no expiry; AC-2 is new", criteria: 2, ungrounded: ["AC-1", "AC-2"] },
  { name: "a fills reason ends at the line break", rationale: "fills: PRD-1 / hole / no expiry\nAC-2 is new", criteria: 2, ungrounded: ["AC-1", "AC-2"] },
  { name: "a criterion named before a later fills is not in its reason", rationale: "AC-1 ← PRD-2 (unlike AC-3). fills: PRD-1 / hole / no criterion", criteria: 3, ungrounded: ["AC-2", "AC-3"] },
  { name: "a longer token ending in AC-<n> names no criterion", rationale: "fills: PRD-1 / hole / the XAC-2 standard", criteria: 2, ungrounded: ["AC-1", "AC-2"] },
  { name: "a criterion followed by fills:", rationale: "AC-2 fills: PRD-2 / hole / x", criteria: 2, ungrounded: ["AC-1"] },
  { name: "a fills reason naming a range", rationale: "fills: PRD-2 / 결함 / AC-2–AC-3 이 없으면 검증할 수 없다", criteria: 4, ungrounded: ["AC-1", "AC-4"] },
  {
    name: "the 5.3.0 shape: citations then per-criterion fills lines",
    rationale: [
      "AC-1 ← PRD-1 (SRS 처럼 구조화된 md), PRD-2 (원본은 하나).",
      "AC-2 ← PRD-1 (큰 작업 단위), PRD-2.",
      "AC-3 ← PRD-2 (거친 날짜).",
      "AC-4 ← PRD-1.",
      "AC-7 ← PRD-2 (상태는 계산한다).",
      "AC-8 ← PRD-1 (SRS 처럼).",
      "",
      "fills: PRD-1 / hole / for AC-5, a dangling name must be reported. AC-6 ← fills: PRD-2 / hole / a hand edit must be detectable.",
      "fills: PRD-2 / hole / for AC-8, lateness is computed."
    ].join("\n"),
    criteria: 8,
    ungrounded: []
  }
];

describe("FR-NODE-242 per-criterion basis", () => {
  // @req FR-NODE-242 AC-2
  it.each(BASIS_MATRIX)("judges each criterion on its own basis: $name", ({ rationale, criteria, ungrounded }) => {
    const texts = Array.from({ length: criteria }, (_, index) => `criterion ${index + 1}`);
    const ids = (records: RequirementRecord[]) => prdCoverage(doc, records, { target: "1.0.0" }).ungroundedCriteria.map((item) => item.criterionId);
    expect(ids([record({ id: "FR-AUTH-001", rationale, criteria: texts })])).toEqual(ungrounded);
    // Independence: one more criterion with no basis is reported alone and changes no other verdict.
    const extra = `AC-${criteria + 1}`;
    expect(ids([record({ id: "FR-AUTH-001", rationale, criteria: [...texts, "extra"] })])).toEqual([...ungrounded, extra]);
  });

  // @req FR-NODE-242 AC-2
  it("counts a requirement-level fills: as the requirement's basis but not as any criterion's", () => {
    const report = prdCoverage(doc, [record({ id: "FR-AUTH-001", rationale: "fills: PRD-1 / hole / the request names no recovery path", criteria: ["a"] })], { target: "1.0.0" });
    expect(report.uncitedRequirements).toEqual([]);
    expect(report.ungroundedCriteria.map((item) => item.criterionId)).toEqual(["AC-1"]);
  });
});

describe("FR-NODE-242 citation edge cases", () => {
  // @req FR-NODE-242 AC-2
  it("judges a criterion range by comparison, so a huge range end costs nothing and grounds only the criteria the requirement has", () => {
    const started = Date.now();
    const report = prdCoverage(doc, [record({ id: "FR-AUTH-001", rationale: "AC-2–AC-20261104 ← PRD-2", criteria: ["a", "b", "c"] })], { target: "1.0.0" });
    expect(Date.now() - started).toBeLessThan(2000);
    expect(report.ungroundedCriteria.map((item) => item.criterionId)).toEqual(["AC-1"]);
  });

  // @req FR-NODE-242 AC-1, AC-2
  it("reads a link destination as the shared link scanner decodes it, spaces included", () => {
    const spaced = parsePrd(buildPrd({ items: ITEMS }), "docs/prd/a b.prd.md");
    for (const rationale of ["AC-1 ← [PRD-1](../prd/a%20b.prd.md#PRD-1)", "AC-1 ← [PRD-1](<../prd/a b.prd.md#PRD-1>)"]) {
      const report = prdCoverage(spaced, [record({ id: "FR-AUTH-001", rationale, criteria: ["a"] })], { target: "1.0.0" });
      expect(report.ungroundedCriteria, rationale).toEqual([]);
      expect(report.uncitedRequirements, rationale).toEqual([]);
    }
    expect(refsFromSpec("[x](../prd/missing%20file.prd.md#PRD-1)")).toEqual([
      { reference: "docs/prd/missing file.prd.md#PRD-1", path: "docs/prd/missing file.prd.md", itemId: "PRD-1" }
    ]);
  });

  // @req FR-NODE-242 AC-1, AC-2
  it("treats only the lower-case .prd.md suffix as a PRD file, the same way for citations, references and file loading", () => {
    const upper = `${PATH.replace(".prd.md", ".PRD.md")}#PRD-2`;
    expect(refsFromSpec(upper)).toEqual([]);
    expect(refsFromSpec(`[x](../prd/2026-11-04.reset.PRD.md#PRD-2)`)).toEqual([]);
    const report = prdCoverage(doc, [record({ id: "FR-AUTH-001", rationale: `AC-1 ← ${upper}`, criteria: ["a"] })], { target: "1.0.0" });
    expect(report.ungroundedCriteria.map((item) => item.criterionId)).toEqual(["AC-1"]);
    expect(hasPrdFileSuffix("docs/prd/x.prd.md")).toBe(true);
    expect(hasPrdFileSuffix("docs/prd/x.PRD.md")).toBe(false);
    expect(hasPrdFileSuffix("docs/prd/x.prd.MD")).toBe(false);
  });
});

describe("FR-NODE-242 tokenizer boundaries", () => {
  // @req FR-NODE-242 AC-2
  it("reads fills: only as a word, so refills: neither bases a criterion nor makes a head", () => {
    const records = [
      record({ id: "FR-AUTH-001", rationale: "AC-1 ← PRD-1 (the cache refills: PRD-2 for AC-2 is prose)", criteria: ["a", "b"] }),
      record({ id: "FR-AUTH-002", rationale: "AC-1 refills: PRD-2", criteria: ["c"] })
    ];
    const report = prdCoverage(doc, records, { target: "1.0.0" });
    expect(report.ungroundedCriteria.map((item) => `${item.requirementId}#${item.criterionId}`)).toEqual(["FR-AUTH-001#AC-2", "FR-AUTH-002#AC-1"]);
  });

  // @req FR-NODE-242 AC-1, AC-2
  it("takes a link as a citation only when its fragment is an item ID", () => {
    expect(refsFromSpec("[x](../prd/a.prd.md#intro)")).toEqual([]);
    expect(refsFromSpec("[x](../prd/a.prd.md)")).toEqual([]);
  });

  // @req FR-NODE-242 AC-2
  it("resolves Related Docs links from docs/spec, wherever the requirement lives", () => {
    const stepRecord = { ...record({ id: "FR-AUTH-001", criteria: ["a"] }), filePath: "docs/spec/steps/t1/srs.md", relatedDocs: [`[x](../prd/2026-11-04.reset.prd.md#PRD-2)`] } as RequirementRecord;
    expect(prdCoverage(doc, [stepRecord], { target: "1.0.0" }).uncitedRequirements).toEqual([]);
  });
});

describe("FR-NODE-242 block structure and definitions", () => {
  // @req FR-NODE-242 AC-1, AC-2
  it("reads nothing inside a fenced or indented code block", () => {
    const fenced = "AC-1 ← PRD-1\n```\nAC-2 ← PRD-2\n[x](../prd/missing.prd.md#PRD-1)\n```";
    const indented = "AC-1 ← PRD-1\n\n    AC-2 ← PRD-2";
    for (const rationale of [fenced, indented]) {
      const report = prdCoverage(doc, [record({ id: "FR-AUTH-001", rationale, criteria: ["a", "b"] })], { target: "1.0.0" });
      expect(report.ungroundedCriteria.map((item) => item.criterionId), rationale).toEqual(["AC-2"]);
      expect(refsFromSpec(rationale), rationale).toEqual([]);
    }
  });

  // @req FR-NODE-242 AC-1, AC-2
  it("resolves a reference whose definition opens the text", () => {
    const rationale = `[p]: <../prd/2026-11-04.reset.prd.md#PRD-2>\nAC-1 ← [x][p]`;
    const report = prdCoverage(doc, [record({ id: "FR-AUTH-001", rationale, criteria: ["a"] })], { target: "1.0.0" });
    expect(report.ungroundedCriteria).toEqual([]);
  });

  // @req FR-NODE-242 AC-1, AC-2
  it("keeps the first definition of a label and ignores a later one, for coverage and links check alike", () => {
    const rationale = `AC-1 ← [x][p]\n\n[p]: <../prd/2026-11-04.reset.prd.md#PRD-2>\n[p]: <../prd/missing.prd.md#PRD-2>`;
    // The use and the kept definition both name the PRD; the later definition names nothing.
    expect([...new Set(refsFromSpec(rationale).map((ref) => ref.path))]).toEqual([PATH]);
    const report = prdCoverage(doc, [record({ id: "FR-AUTH-001", rationale, criteria: ["a"] })], { target: "1.0.0" });
    expect(report.ungroundedCriteria).toEqual([]);
  });
});

describe("FR-NODE-242 definitions through the shared parser", () => {
  // @req FR-NODE-242 AC-1, AC-2
  it("takes a definition's title on the next line as part of the definition, not as running text", () => {
    const rationale = `AC-1 ← [x][p]\n\n[p]: <../prd/2026-11-04.reset.prd.md#PRD-2>\n  "see PRD-5"`;
    const report = prdCoverage(doc, [record({ id: "FR-AUTH-001", rationale, criteria: ["a"] })], { target: "1.0.0" });
    expect(report.ungroundedCriteria).toEqual([]);
    expect(report.uncitedItems.map((item) => item.id)).toContain("PRD-5");
  });
});
